import { extractAddress, extractIp, KVRateLimiter } from './guard';
import { checkAddress } from './api/check';
import { withCache } from './cache';
import pageHtml from '../web/index.html';
import type { KVLike } from './kv';

interface Env {
  KV: KVLike;
}

const CHECK_CACHE_TTL_SECONDS = 600;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/check') {
      const raw = url.searchParams.get('address') ?? '';
      const address = extractAddress(raw);
      if (!address) {
        return Response.json(
          { error: 'no valid Hyperliquid address found in the address parameter' },
          { status: 400 },
        );
      }

      const limiter = new KVRateLimiter(env.KV, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
      const ip = extractIp(request);
      if (!(await limiter.allow(ip))) {
        return Response.json({ error: 'too many checks from this address, try again shortly' }, { status: 429 });
      }

      try {
        const result = await withCache(env.KV, `check:${address}`, CHECK_CACHE_TTL_SECONDS, () =>
          checkAddress(address, { nansen: null }),
        );
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
