import { extractAddress, extractIp } from './guard';
import { checkAddress } from './api/check';
import { withCache } from './cache';
import { safeKv } from './safeKv';
import { recordCalls } from './credits';
import { WORST_CASE_CALLS } from './budget';
import { spendGuard, requestGate } from './coordinator';
import { createNansenClient, type NansenCallMeta } from './sources/nansen';
import pageHtml from '../web/index.html';
import galleryData from '../data/gallery.json';
import ledgerData from '../data/ledger.json';
import type { Gallery } from './gallery';
import { liveCallsInWindow, type LedgerSummary } from './ledger';
import type { KVLike } from './kv';

const gallery = galleryData as unknown as Gallery;
const scriptedLedger = ledgerData as unknown as LedgerSummary;

interface Env {
  KV: KVLike;
  /** From .dev.vars locally, `wrangler secret put` when deployed. Optional:
   * without it every check runs Hyperliquid-only and says so. */
  NANSEN_API_KEY?: string;
  NANSEN_DAILY_CREDIT_CAP: string;
  NANSEN_CREDIT_FLOOR: string;
  /** The spend cap and the request counter. Both need read-modify-write to
   * be atomic, which is the one thing KV cannot promise. */
  NANSEN_BUDGET: DurableObjectNamespace;
  REQUEST_GATE: DurableObjectNamespace;
}

export { NansenBudget, RequestGate } from './coordinator';

const CHECK_CACHE_TTL_SECONDS = 600;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const LEDGER_MEMO_MS = 60_000;

/** The page has one inline script and inline styles, so 'unsafe-inline'
 * stays; what the policy buys is no framing (clickjacking), no requests to
 * other origins, and no plugin content. */
const PAGE_HEADERS = {
  'content-type': 'text/html;charset=UTF-8',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

/** Per-isolate memo of /api/ledger: it costs up to 14 KV reads, and reads
 * are a daily quota too. */
let ledgerMemo: { at: number; body: unknown } | null = null;

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

      const limiter = requestGate(env.REQUEST_GATE, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
      const ip = extractIp(request);
      if (!(await limiter.allow(ip))) {
        return Response.json({ error: 'too many checks from this address, try again shortly' }, { status: 429 });
      }

      try {
        const result = await withCache(kv, `check:${address}`, CHECK_CACHE_TTL_SECONDS, async () => {
          const day = new Date().toISOString().slice(0, 10);
          const calls: NansenCallMeta[] = [];
          // The credits this check could possibly spend are held before it
          // starts, not counted after it finishes, so a check that overlaps
          // this one sees them as already gone.
          const budget = spendGuard(env.NANSEN_BUDGET, {
            cap: Number(env.NANSEN_DAILY_CREDIT_CAP),
            floor: Number(env.NANSEN_CREDIT_FLOOR),
          });
          let nansenOffReason: string | undefined;
          let hold: string | null = null;
          if (!env.NANSEN_API_KEY) {
            nansenOffReason = 'no API key configured';
          } else {
            const reservation = await budget.reserve(day, WORST_CASE_CALLS);
            if (reservation.ok) hold = reservation.id;
            else nansenOffReason = reservation.reason;
          }
          const nansen =
            nansenOffReason === undefined
              ? createNansenClient(env.NANSEN_API_KEY!, (m) => {
                  calls.push(m);
                })
              : null;
          try {
            const result = await checkAddress(address, { nansen, nansenOffReason });
            return { ...result, nansenCalls: calls.length };
          } finally {
            // Settle first: the hold has to come off whatever else fails.
            // A call with no cost header counts as one credit, the
            // conservative direction for a cap.
            if (hold !== null) {
              const spent = calls.reduce((sum, c) => sum + (c.creditsCost ?? 1), 0);
              const lastKnown = [...calls].reverse().find((c) => c.creditsRemaining !== null);
              const refused = calls.some((c) => c.status === 401 || c.status === 402 || c.status === 403);
              await budget.settle(hold, spent, lastKnown?.creditsRemaining ?? null, refused);
            }
            // KV keeps the per-day totals that /api/ledger reports. They are
            // a record of what happened, not the thing that decides.
            await recordCalls(kv, day, calls);
          }
        });
        return Response.json(result);
      } catch (err) {
        console.error('check failed', err);
        return Response.json({ error: 'could not read this address right now, try again shortly' }, { status: 502 });
      }
    }

    if (url.pathname === '/api/gallery') {
      return Response.json(gallery, { headers: { 'cache-control': 'public, max-age=300' } });
    }

    // Scripted calls (fixtures, smoke runs, the gallery prescan) come bundled
    // from data/ledger.json; the Worker's own calls come from its KV day
    // counters. Under `wrangler dev` the local KV also holds the dev calls
    // that the ledger already lists, so the sum double-counts them there.
    if (url.pathname === '/api/ledger') {
      if (!ledgerMemo || Date.now() - ledgerMemo.at > LEDGER_MEMO_MS) {
        const live = await liveCallsInWindow(kv, new Date().toISOString().slice(0, 10));
        ledgerMemo = {
          at: Date.now(),
          body: { totalCalls: scriptedLedger.calls + live.calls, scripted: scriptedLedger, live },
        };
      }
      return Response.json(ledgerMemo.body, { headers: { 'cache-control': 'public, max-age=60' } });
    }

    if (url.pathname === '/') {
      return new Response(pageHtml, { headers: PAGE_HEADERS });
    }

    return new Response('not found', { status: 404 });
  },
};
