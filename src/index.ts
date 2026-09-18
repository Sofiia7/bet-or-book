import { extractAddress, extractIp, KVRateLimiter } from './guard';
import { checkAddress } from './api/check';
import { withCache } from './cache';
import { safeKv } from './safeKv';
import { recordCalls, nansenAllowed } from './credits';
import { createNansenClient, type NansenCallMeta } from './sources/nansen';
import pageHtml from '../web/index.html';
import type { KVLike } from './kv';

interface Env {
  KV: KVLike;
  /** From .dev.vars locally, `wrangler secret put` when deployed. Optional:
   * without it every check runs Hyperliquid-only and says so. */
  NANSEN_API_KEY?: string;
  NANSEN_DAILY_CREDIT_CAP: string;
  NANSEN_CREDIT_FLOOR: string;
}

const CHECK_CACHE_TTL_SECONDS = 600;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const kv = safeKv(env.KV);

    if (url.pathname === '/api/check') {
      const raw = url.searchParams.get('address') ?? '';
      const address = extractAddress(raw);
      if (!address) {
        return Response.json(
          { error: 'no valid Hyperliquid address found in the address parameter' },
          { status: 400 },
        );
      }

      const limiter = new KVRateLimiter(kv, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
      const ip = extractIp(request);
      if (!(await limiter.allow(ip))) {
        return Response.json({ error: 'too many checks from this address, try again shortly' }, { status: 429 });
      }

      try {
        const result = await withCache(kv, `check:${address}`, CHECK_CACHE_TTL_SECONDS, async () => {
          const day = new Date().toISOString().slice(0, 10);
          const calls: NansenCallMeta[] = [];
          const useNansen =
            !!env.NANSEN_API_KEY &&
            (await nansenAllowed(kv, day, Number(env.NANSEN_DAILY_CREDIT_CAP), Number(env.NANSEN_CREDIT_FLOOR)));
          const nansen = useNansen
            ? createNansenClient(env.NANSEN_API_KEY!, (m) => {
                calls.push(m);
              })
            : null;
          try {
            return await checkAddress(address, { nansen });
          } finally {
            await recordCalls(kv, day, calls);
          }
        });
        return Response.json(result);
      } catch (err) {
        console.error('check failed', err);
        return Response.json({ error: 'could not read this address right now, try again shortly' }, { status: 502 });
      }
    }

    if (url.pathname === '/') {
      return new Response(pageHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
    }

    return new Response('not found', { status: 404 });
  },
};
