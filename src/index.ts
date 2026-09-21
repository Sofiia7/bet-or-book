import { extractAddress, extractIp } from './guard';
import { checkAddress, CHECK_DEADLINE_MS } from './api/check';
import { withCache } from './cache';
import { safeKv } from './safeKv';
import { WORST_CASE_CALLS } from './budget';
import { spendGuard, requestGate } from './coordinator';
import { createNansenClient, meansOutOfCredits, type NansenCallMeta } from './sources/nansen';
import { CLASSIFIER_VERSION } from './engine/verdict';
import type { CheckResponse } from './api/check';
import { snapshotId, snapshotKey, isSnapshotId, SNAPSHOT_TTL_SECONDS, shortHash } from './snapshot';
import { shareCard } from './engine/share';
import pageHtml from '../web/index.html';
import pageScript from '../web/app.js';
import galleryData from '../data/gallery.json';
import ledgerData from '../data/ledger.json';
import type { Gallery } from './gallery';
import { BUILDATHON_WINDOW, type LedgerSummary } from './ledger';
import type { KVLike } from './kv';

const gallery = galleryData as unknown as Gallery;
/** Gallery cards by snapshot id, so a shared link to one opens the card that
 * was shared and not a fresh check of that account. */
const galleryById = new Map(
  gallery.entries.map((e) => [e.snapshotId ?? snapshotId(e.address, e.checkedAt), e] as const),
);
const scriptedLedger = ledgerData as unknown as LedgerSummary;

/**
 * The page asks for its script by content, so a deploy cannot leave a reader
 * running the previous one against the current API for the length of a cache
 * header. The script itself answers to any version, because the only thing
 * the query does is make the URL change when the file does.
 */
const SCRIPT_PATH = `/app.js?v=${shortHash(pageScript)}`;
const page = pageHtml.replace('src="/app.js"', `src="${SCRIPT_PATH}"`);

interface Env {
  KV: KVLike;
  /** From .dev.vars locally, `wrangler secret put` when deployed. Optional:
   * without it every check runs Hyperliquid-only and says so. */
  NANSEN_API_KEY?: string;
  NANSEN_DAILY_CREDIT_CAP: string;
  NANSEN_CREDIT_FLOOR: string;
  /** Credits of the daily cap that public checks may not touch, so a demo
   * still runs after a busy afternoon. Optional; absent means none. */
  NANSEN_DEMO_RESERVE?: string;
  /** Lets one request reach past the public cap into that reserve. Set with
   * `wrangler secret put`; without it the reserve is simply unreachable. */
  DEMO_KEY?: string;
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
/** A second limit across every client at once. The per-address window
 * bounds one visitor; it does nothing about a hundred of them, or one
 * visitor on a hundred addresses, emptying the day's credits in a minute
 * while everyone else gets the free answer (audit S03). */
const GLOBAL_BURST_MAX = 10;
const GLOBAL_BURST_WINDOW_SECONDS = 10;
const LEDGER_MEMO_MS = 60_000;

/** The script now lives in its own file, so no inline script is allowed at
 * all: an injected <script> has nothing to execute under. Inline styles
 * stay, which is a far smaller surface. The policy also buys no framing
 * (clickjacking), no requests to other origins and no plugin content. */
const PAGE_HEADERS = {
  'content-type': 'text/html;charset=UTF-8',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const SCRIPT_HEADERS = {
  'content-type': 'text/javascript;charset=UTF-8',
  'x-content-type-options': 'nosniff',
  'cache-control': 'public, max-age=300',
};

/**
 * A saved reading is not a secret - the wallet is public - but that someone
 * asked about this address at this moment need not be indexed and kept.
 */
const SNAPSHOT_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=3600',
  'x-robots-tag': 'noindex',
};

/**
 * True when this request did not come from another site's page.
 *
 * Starting a check spends money, so it is a POST from this origin rather
 * than a GET anything can trigger. A browser states where a request came
 * from; a tool such as curl states nothing, and is allowed through on the
 * strength of the rate limits, because refusing it would only mean refusing
 * anyone using the API on purpose. What this stops is a page elsewhere
 * spending this site's credits, and a crawler doing it by accident.
 */
function fromThisSite(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  return origin === null || origin === url.origin;
}

/** A HEAD answer carries the headers of the GET it stands for and no body. */
const headOf = (res: Response) => new Response(null, { status: res.status, headers: res.headers });

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
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      return Response.json({ error: 'only GET, HEAD and POST are supported' }, {
        status: 405,
        headers: { allow: 'GET, HEAD, POST' },
      });
    }
    const kv = safeKv(env.KV);

    if (url.pathname === '/app.js') {
      if (method === 'POST') return Response.json({ error: 'no such endpoint' }, { status: 405 });
      const res = new Response(pageScript, { headers: SCRIPT_HEADERS });
      return method === 'HEAD' ? headOf(res) : res;
    }

    if (url.pathname === '/api/check') {
      const raw = url.searchParams.get('address') ?? '';
      const address = extractAddress(raw);
      if (!address) {
        return Response.json(
          { error: 'no valid Hyperliquid address found in the address parameter' },
          { status: 400 },
        );
      }
      // The rules are part of the key. A verdict cached before a deploy is
      // an answer from rules that no longer exist, and serving it until the
      // TTL runs out would quietly mix two vintages on one page.
      const cacheKey = `check:${CLASSIFIER_VERSION}:${address}`;

      // Reading an answer that already exists and starting a new one that
      // costs money are two different acts, so they are two different
      // methods. A scanner, a link preview or a browser prefetch can only
      // ever perform the first: GET and HEAD used to run the paid branch,
      // and the comment above them said nothing here writes.
      if (method !== 'POST') {
        const cached = await kv.get(cacheKey);
        const res =
          cached === null
            ? Response.json(
                { error: 'no recent reading of this address; POST to /api/check to run one' },
                { status: 404 },
              )
            : new Response(cached, { headers: { 'content-type': 'application/json' } });
        return method === 'HEAD' ? headOf(res) : res;
      }

      if (!fromThisSite(request, url)) {
        return Response.json({ error: 'checks are started from this site' }, { status: 403 });
      }

      const limiter = requestGate(env.REQUEST_GATE, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
      const ip = extractIp(request);
      if (!(await limiter.allow(ip))) {
        return Response.json(
          { error: 'too many checks from this address, try again shortly' },
          { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_SECONDS) } },
        );
      }
      const burst = requestGate(env.REQUEST_GATE, GLOBAL_BURST_MAX, GLOBAL_BURST_WINDOW_SECONDS);
      if (!(await burst.allow('all-clients'))) {
        return Response.json(
          { error: 'this site is busy right now, try again in a few seconds' },
          { status: 429, headers: { 'retry-after': String(GLOBAL_BURST_WINDOW_SECONDS) } },
        );
      }

      // A reserve the public path cannot reach, so an afternoon of visitors
      // cannot leave the demo with a Hyperliquid-only answer.
      const demo = env.DEMO_KEY !== undefined && url.searchParams.get('demo') === env.DEMO_KEY;

      try {
        const ttl = (r: CheckResponse) => (r.degraded ? DEGRADED_CACHE_TTL_SECONDS : CHECK_CACHE_TTL_SECONDS);
        const result = await withCache(kv, cacheKey, ttl, async () => {
          const day = new Date().toISOString().slice(0, 10);
          const calls: NansenCallMeta[] = [];
          // The credits this check could possibly spend are held before it
          // starts, not counted after it finishes, so a check that overlaps
          // this one sees them as already gone.
          // A cap that is not a number must not read as no cap: every
          // comparison against NaN is false, which would have meant every
          // check allowed. A misconfigured cap spends nothing instead.
          const dailyCap = numberOr(env.NANSEN_DAILY_CREDIT_CAP, 0, 'NANSEN_DAILY_CREDIT_CAP');
          const reserve = numberOr(env.NANSEN_DEMO_RESERVE, 0, 'NANSEN_DEMO_RESERVE');
          const budget = spendGuard(env.NANSEN_BUDGET, {
            cap: demo ? dailyCap : Math.max(0, dailyCap - reserve),
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
          // One deadline for the reader's wait, enforced both as a clock
          // the stages consult and as a signal on the sockets themselves.
          const startedAt = Date.now();
          const timeout = AbortSignal.timeout(CHECK_DEADLINE_MS);
          const nansen =
            nansenOffReason === undefined
              ? createNansenClient(
                  env.NANSEN_API_KEY!,
                  (m) => {
                    calls.push(m);
                  },
                  timeout,
                )
              : null;
          try {
            const result = await checkAddress(address, {
              nansen,
              nansenOffReason,
              deadline: startedAt + CHECK_DEADLINE_MS,
              signal: timeout,
            });
            const id = snapshotId(address, result.checkedAt, result.classifierVersion);
            const saved: CheckResponse = { ...result, nansenCalls: calls.length, snapshotId: id };
            // Kept so the link can open this reading rather than start a new
            // one. A failed write costs the share link, not the answer - but
            // the page has to be told, or it offers a link to nothing.
            const stored = await kv.put(snapshotKey(id), JSON.stringify(saved), {
              expirationTtl: SNAPSHOT_TTL_SECONDS,
            });
            if (!stored) return { ...result, nansenCalls: calls.length, snapshotSaved: false };
            // The link goes on the picture, so it can only be added once the
            // reading it points at is really there.
            return {
              ...saved,
              snapshotSaved: true,
              share: shareCard(saved, { kind: 'live', origin: url.origin, snapshotId: id }),
            };
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
              await budget.settle(hold, spent, lastKnown?.creditsRemaining ?? null, refused, lastKnown?.at);
            }
            // What was actually called, counted in the same object as the
            // money. It used to be a read-modify-write on one KV key, which
            // loses counts whenever two checks finish together - and this is
            // the number the buildathon submission rests on.
            await budget.record(day, calls);
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
        return Response.json(
          { ...fromGallery, share: shareCard(fromGallery, { kind: 'gallery', origin: url.origin, snapshotId: id }) },
          { headers: SNAPSHOT_HEADERS },
        );
      }
      const raw = await kv.get(snapshotKey(id));
      if (raw === null) {
        return Response.json({ error: 'that snapshot has expired or never existed' }, {
          status: 404,
          headers: { 'x-robots-tag': 'noindex' },
        });
      }
      // What was stored called itself live, because it was when it was made.
      // Opened again by a link, it is a saved reading, and the card has to
      // say which of the two the reader is looking at.
      const card = JSON.parse(raw) as CheckResponse;
      return Response.json(
        { ...card, share: shareCard(card, { kind: 'saved', origin: url.origin, snapshotId: id }) },
        { headers: SNAPSHOT_HEADERS },
      );
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
        const budget = spendGuard(env.NANSEN_BUDGET, { cap: 0, floor: 0 });
        const report = await budget.report(BUILDATHON_WINDOW.from, BUILDATHON_WINDOW.to);
        const live = {
          calls: report.calls.attempted,
          successful: report.calls.successful,
          // Credits the API priced, and credits assumed for calls it did
          // not. Two different kinds of number, reported as two.
          creditsQuoted: report.calls.creditsQuoted,
          creditsAssumed: report.calls.creditsAssumed,
          byEndpoint: report.calls.byEndpoint,
          byDay: report.byDay,
        };
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
        if (card) return new Response(withSocialTags(page, card, url), { headers: PAGE_HEADERS });
      }
      return new Response(page, { headers: PAGE_HEADERS });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'no such endpoint' }, { status: 404 });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  },
};
