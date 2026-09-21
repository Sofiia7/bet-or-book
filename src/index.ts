import { extractAddress, extractIp } from './guard';
import { checkAddress } from './api/check';
import { withCache } from './cache';
import { safeKv } from './safeKv';
import { recordCalls } from './credits';
import { WORST_CASE_CALLS } from './budget';
import { spendGuard, requestGate } from './coordinator';
import { createNansenClient, meansOutOfCredits, type NansenCallMeta } from './sources/nansen';
import { CLASSIFIER_VERSION } from './engine/verdict';
import type { CheckResponse } from './api/check';
import { snapshotId, snapshotKey, isSnapshotId, SNAPSHOT_TTL_SECONDS } from './snapshot';
import pageHtml from '../web/index.html';
import galleryData from '../data/gallery.json';
import ledgerData from '../data/ledger.json';
import type { Gallery } from './gallery';
import { liveCallsInWindow, type LedgerSummary } from './ledger';
import type { KVLike } from './kv';

const gallery = galleryData as unknown as Gallery;
/** Gallery cards by snapshot id, so a shared link to one opens the card that
 * was shared and not a fresh check of that account. */
const galleryById = new Map(
  gallery.entries.map((e) => [e.snapshotId ?? snapshotId(e.address, e.checkedAt), e] as const),
);
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
/** An answer assembled from sources that were missing or cut short is worth
 * less than a whole one, so it is not served for as long. */
const DEGRADED_CACHE_TTL_SECONDS = 60;
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

/** A configured number, or a fallback chosen so that a misconfiguration
 * costs nothing rather than everything. */
function numberOr(raw: string | undefined, fallback: number, name: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} is not a number: ${JSON.stringify(raw)}; using ${fallback}`);
    return fallback;
  }
  return n;
}

const SOCIAL_BLOCK = /<!--SOCIAL-->[\s\S]*?<!--\/SOCIAL-->/;

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function readSnapshot(kv: KVLike, id: string): Promise<CheckResponse | null> {
  const raw = await kv.get(snapshotKey(id));
  return raw === null ? null : (JSON.parse(raw) as CheckResponse);
}

/**
 * Rewrites the page's social tags for one saved reading. A crawler follows a
 * shared link, does not run JavaScript, and must not be able to make this
 * site spend a credit; serving it the reading's own words costs neither.
 */
function withSocialTags(html: string, card: CheckResponse, url: URL): string {
  const p = card.positions;
  const what = p.headlineCoin === null ? 'No open position' : `${p.headlineCoin} ${p.headlineSide}`;
  const title = `${what}: ${VERDICT_WORDS[card.verdict.verdict] ?? 'checked'}`;
  return html.replace(
    SOCIAL_BLOCK,
    [
      '<meta property="og:type" content="article">',
      '<meta property="og:site_name" content="Bet or Book">',
      `<meta property="og:title" content="${escapeAttr(title)}">`,
      `<meta property="og:description" content="${escapeAttr(card.summary)}">`,
      `<meta property="og:url" content="${escapeAttr(url.toString())}">`,
      '<meta name="twitter:card" content="summary">',
    ].join('\n'),
  );
}

/** What each verdict is called in a shared link's title. */
const VERDICT_WORDS: Record<string, string> = {
  book: 'a market maker’s book',
  hedged: 'hedged in this same account',
  looks_like_a_bet: 'looks like a real bet',
  unknown: 'not settled by what could be read',
};

/** Per-isolate memo of /api/ledger: it costs up to 14 KV reads, and reads
 * are a daily quota too. */
let ledgerMemo: { at: number; body: unknown } | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Nothing here writes, so nothing here needs a method that writes.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json({ error: 'only GET is supported' }, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
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
        return Response.json(
          { error: 'too many checks from this address, try again shortly' },
          { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_SECONDS) } },
        );
      }

      try {
        // The rules are part of the key. A verdict cached before a deploy is
        // an answer from rules that no longer exist, and serving it until the
        // TTL runs out would quietly mix two vintages on one page.
        const cacheKey = `check:${CLASSIFIER_VERSION}:${address}`;
        const ttl = (r: CheckResponse) => (r.degraded ? DEGRADED_CACHE_TTL_SECONDS : CHECK_CACHE_TTL_SECONDS);
        const result = await withCache(kv, cacheKey, ttl, async () => {
          const day = new Date().toISOString().slice(0, 10);
          const calls: NansenCallMeta[] = [];
          // The credits this check could possibly spend are held before it
          // starts, not counted after it finishes, so a check that overlaps
          // this one sees them as already gone.
          const budget = spendGuard(env.NANSEN_BUDGET, {
            // A cap that is not a number must not read as no cap: every
            // comparison against NaN is false, which would have meant every
            // check allowed. A misconfigured cap spends nothing instead.
            cap: numberOr(env.NANSEN_DAILY_CREDIT_CAP, 0, 'NANSEN_DAILY_CREDIT_CAP'),
            floor: numberOr(env.NANSEN_CREDIT_FLOOR, Number.MAX_SAFE_INTEGER, 'NANSEN_CREDIT_FLOOR'),
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
            const saved: CheckResponse = {
              ...result,
              nansenCalls: calls.length,
              snapshotId: snapshotId(address, result.checkedAt),
            };
            // Kept so the link can open this reading rather than start a new
            // one. A failed write costs the share link, not the answer.
            await kv.put(snapshotKey(saved.snapshotId!), JSON.stringify(saved), {
              expirationTtl: SNAPSHOT_TTL_SECONDS,
            });
            return saved;
          } finally {
            // Settle first: the hold has to come off whatever else fails.
            // A call with no cost header counts as one credit, the
            // conservative direction for a cap.
            if (hold !== null) {
              const spent = calls.reduce((sum, c) => sum + (c.creditsCost ?? 1), 0);
              const lastKnown = [...calls].reverse().find((c) => c.creditsRemaining !== null);
              // A refusal that still reports credits is about one endpoint,
              // not about the balance, and must not stop tomorrow too.
              const refused = calls.some((c) => meansOutOfCredits(c.status, c.creditsRemaining));
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

    // A saved reading, by id. Gallery cards ship with the Worker, so they
    // answer without touching storage; live checks are in KV.
    if (url.pathname === '/api/snapshot') {
      const id = url.searchParams.get('id') ?? '';
      if (!isSnapshotId(id)) return Response.json({ error: 'not a snapshot id' }, { status: 400 });
      const fromGallery = galleryById.get(id);
      if (fromGallery) {
        return Response.json(fromGallery, { headers: { 'cache-control': 'public, max-age=3600' } });
      }
      const raw = await kv.get(snapshotKey(id));
      if (raw === null) {
        return Response.json({ error: 'that snapshot has expired or never existed' }, { status: 404 });
      }
      return new Response(raw, {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
      });
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
      const shared = url.searchParams.get('s') ?? '';
      if (isSnapshotId(shared)) {
        const card = galleryById.get(shared) ?? (await readSnapshot(kv, shared));
        if (card) return new Response(withSocialTags(pageHtml, card, url), { headers: PAGE_HEADERS });
      }
      return new Response(pageHtml, { headers: PAGE_HEADERS });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'no such endpoint' }, { status: 404 });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  },
};
