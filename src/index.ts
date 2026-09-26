import { extractAddress, extractIp } from './guard';
import { checkAddress, CHECK_DEADLINE_MS } from './api/check';
import { withCache } from './cache';
import { safeKv } from './safeKv';
import { WORST_CASE_CALLS } from './budget';
import { spendGuard, requestGate } from './coordinator';
import { createNansenClient, meansOutOfCredits, type NansenCallMeta } from './sources/nansen';
import { CLASSIFIER_VERSION } from './engine/verdict';
import { ASSET_REGISTRY_VERSION } from './engine/observation';
import type { CheckResponse } from './api/check';
import { snapshotId, snapshotKey, isSnapshotId, SNAPSHOT_TTL_SECONDS, shortHash } from './snapshot';
import { shareCard } from './engine/share';
import { compareReadings } from './engine/compare';
import pageHtml from '../web/index.html';
import pageScript from '../web/app.js';
import galleryData from '../data/gallery.json';
import featuredData from '../data/featured.json';
import ledgerData from '../data/ledger.json';
import { galleryIndex, previousReadingId, type Gallery, type GalleryIndex } from './gallery';
import { BUILDATHON_WINDOW, type LedgerSummary } from './ledger';
import type { KVLike } from './kv';
import type { SafeKV } from './safeKv';
import { ogCardFor, ogCacheKey, OG_LAYOUT_VERSION } from './engine/ogCard';
import { emit, readingFields, type CheckEvent, type PictureEvent, type SnapshotEvent } from './telemetry';
import { ruleExplanation, badgeQualifier } from './engine/reasons';
import { openQuestion } from './engine/openQuestion';
import { nansenContribution } from './engine/nansenContribution';
import { renderOgPng, type OgFont } from './engine/ogRender';
import interRegular from '../assets/inter-regular.woff';
import interBold from '../assets/inter-bold.woff';
// @ts-expect-error -- a .wasm import has no declared module type; Wrangler
// compiles it to a WebAssembly.Module at build time, which is exactly what
// resvg-wasm's initWasm accepts.
import resvgWasmModule from '../node_modules/@resvg/resvg-wasm/index_bg.wasm';
import ogFallbackPng from '../assets/og-fallback.png';

const gallery = galleryData as unknown as Gallery;

/** A reading as it leaves the Worker, with four things worked out here from
 * what it already holds, so the page has the words without keeping its own
 * copy of the rules: the rule behind the verdict (U06), the question it
 * leaves open, what Nansen added to it - the last two asked for by the
 * 23.09 audit before submission - and the short qualifier for the Unknown
 * badge itself (24.09 audit U02 + L10). */
function explained<T extends CheckResponse>(r: T): T {
  return {
    ...r,
    rule: ruleExplanation(r.verdict, r.historical !== undefined),
    openQuestion: openQuestion(r),
    nansen: nansenContribution(r),
    badgeQualifier: badgeQualifier(r.verdict, r.historical !== undefined),
  };
}
/** Gallery cards by snapshot id, so a shared link to one opens the card that
 * was shared and not a fresh check of that account. */
/** A handful of readings made fresh and picked by hand, one of each kind of
 * answer, shown first to a visitor with no address of their own. The scan
 * below them is days old and read before vitals existed, so on its own it
 * showed a new visitor mostly the older product (23.09 audit, U05). */
const featured = featuredData as unknown as Gallery;
const galleryIdOf = (e: CheckResponse) => e.snapshotId ?? snapshotId(e.address, e.checkedAt);
/** Every reading that ships with the Worker, by id, and what it is: a card
 * from the gallery scan, or a demonstration reading - saved like any live
 * one, and worded as one. Either answers without touching storage. */
const bundledById = new Map<string, { card: CheckResponse; kind: 'gallery' | 'saved' }>([
  ...gallery.entries.map((e) => [galleryIdOf(e), { card: e, kind: 'gallery' as const }] as const),
  ...featured.entries.map((e) => [galleryIdOf(e), { card: e, kind: 'saved' as const }] as const),
]);
/** What the page lists, as one line per card. A reading that has since been
 * read again is kept - it is the other half of any comparison, and its link
 * stays good - but listing it as well would show the same account twice. */
// A featured reading is a fresher re-read of one of these accounts. Once it
// exists, the gallery's own (older) current row for the same address is a
// second, staler answer about the same account shown next to the fresh one -
// the older rules' rows in the archive are a different, intentional case and
// are left alone (24.09 audit, L03).
const featuredAddresses = new Set(featured.entries.filter((e) => !e.superseded).map((e) => e.address.toLowerCase()));
const gallerySansFeatured: Gallery = {
  ...gallery,
  entries: gallery.entries.filter((e) => e.historical || !featuredAddresses.has(e.address.toLowerCase())),
};
const listedGallery: GalleryIndex & { featured: GalleryIndex['entries'] } = {
  ...galleryIndex(gallerySansFeatured, galleryIdOf),
  featured: galleryIndex(featured, galleryIdOf).entries,
};
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
 * (clickjacking), no requests to other origins and no plugin content.
 * Google Fonts (26.09 redesign) needs its own two carve-outs: the
 * stylesheet comes from fonts.googleapis.com, the woff2 files it points at
 * come from fonts.gstatic.com - two different origins, so style-src and
 * font-src each need exactly the one they serve, nothing wider. */
const PAGE_HEADERS = {
  'content-type': 'text/html;charset=UTF-8',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const SCRIPT_HEADERS = {
  'content-type': 'text/javascript;charset=UTF-8',
  'x-content-type-options': 'nosniff',
  'cache-control': 'public, max-age=300',
};

/** A reading's own picture. The reading never changes under its id and the
 * layout is part of the key (OG_LAYOUT_VERSION), so once a picture exists
 * it is cached for good, in the browser and at whatever CDN a crawler sits
 * behind. */
const OG_IMAGE_HEADERS = {
  'content-type': 'image/png',
  'cache-control': 'public, max-age=31536000, immutable',
};

/** The standing picture, served while a reading's own does not exist yet -
 * or cannot be found yet: KV can take a minute to show a new write in every
 * region. It used to go out marked immutable for a year, so a crawler that
 * came a little early kept the stand-in for good (23.09 audit, S04). */
const OG_STAND_IN_HEADERS = {
  'content-type': 'image/png',
  'cache-control': 'public, max-age=60',
};

const OG_FONTS: OgFont[] = [
  { name: 'Inter', data: interRegular, weight: 400, style: 'normal' },
  { name: 'Inter', data: interBold, weight: 700, style: 'normal' },
];

/**
 * A reading's picture as already drawn, or null.
 *
 * This is all a crawler's request ever does. satori and resvg together take
 * roughly 26-28 ms warm and up to 127 ms on a cold isolate (measured, see
 * docs/architecture.md), and the Workers free plan allows 10 ms per request.
 * Drawing used to happen right here, inside a try/catch, on the theory that
 * the worst case was the stand-in picture. It was not: a request over its
 * CPU limit is stopped by the runtime, which answers the crawler with Error
 * 1102, and no catch block runs (23.09 audit, S04). So the crawler's request
 * only reads, and drawing happens in a request of its own - see drawOgPng.
 */
async function storedOgPng(kv: SafeKV, id: string): Promise<Uint8Array | null> {
  const cached = await kv.get(ogCacheKey(id));
  return cached === null ? null : new Uint8Array(Buffer.from(cached, 'base64'));
}

/**
 * Draws one reading's picture and keeps it, in a request whose answer
 * nothing displays: the page asks for it once a live reading is saved, and
 * again when the reader reaches for a share button, before any crawler has
 * the link. If the runtime stops this request for CPU, the reader's page
 * does not notice, and a crawler still gets the stand-in rather than an
 * error. A paid plan's 30 s budget clears the render with room to spare.
 */
async function drawOgPng(card: CheckResponse, kind: 'saved' | 'gallery'): Promise<Uint8Array> {
  return renderOgPng(ogCardFor(card, kind), OG_FONTS, resvgWasmModule);
}

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
 * A saved reading that could not be found here. That is not the same as
 * one that never existed: KV can take up to a minute to show a new write in
 * a region that has not seen it yet, and a link is shared - and opened, and
 * fetched by a crawler - within that minute all the time. Reproduced on
 * workerd with a lagging KV (test/runtime/workerd.test.ts, 23.09 audit S05):
 * the answer said "never existed" and carried nothing to stop a cache
 * keeping it. It is no-store now, and it says what it can actually know.
 */
const notFoundYet = () =>
  Response.json(
    {
      error:
        'that reading could not be found here: it may have expired, or, if it was saved in the last minute, ' +
        'it may not have reached this region yet',
    },
    { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } },
  );

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

/**
 * Whether a request carries the operator key for the demo reserve.
 *
 * Compared as SHA-256 digests, so the comparison takes the same time however
 * much of the key a guess gets right, and neither length nor content leaks
 * through it. An unset or empty DEMO_KEY matches nothing, including an empty
 * header (23.09 audit, S03).
 */
async function isOperator(request: Request, env: Env): Promise<boolean> {
  const expected = env.DEMO_KEY;
  const provided = request.headers.get('x-demo-key');
  if (!expected || !provided) return false;
  const digest = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let differs = 0;
  for (let i = 0; i < a.length; i++) differs |= a[i] ^ b[i];
  return differs === 0;
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
function withSocialTags(html: string, card: CheckResponse, url: URL, id: string): string {
  const p = card.positions;
  const what = p.headlineCoin === null ? 'No open position' : `${p.headlineCoin} ${p.headlineSide}`;
  const title = `${what}: ${VERDICT_WORDS[card.verdict.verdict] ?? 'checked'}`;
  // `id` is the query parameter this reading was actually found under, not
  // `card.snapshotId` - an older gallery entry can carry no id of its own
  // even though the map it lives in is keyed by one (audit-era data). The
  // layout goes in the URL as well as the key: a crawler's cache holds a
  // picture by URL, for a year, and a new layout has to be a new address.
  const image = `${url.origin}/api/og?id=${encodeURIComponent(id)}&v=${OG_LAYOUT_VERSION}`;
  return html.replace(
    SOCIAL_BLOCK,
    [
      '<meta property="og:type" content="article">',
      '<meta property="og:site_name" content="Bet or Book">',
      `<meta property="og:title" content="${escapeAttr(title)}">`,
      `<meta property="og:description" content="${escapeAttr(card.summary)}">`,
      `<meta property="og:url" content="${escapeAttr(url.toString())}">`,
      `<meta property="og:image" content="${escapeAttr(image)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:image" content="${escapeAttr(image)}">`,
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
      // Which position the reader asked about, if any. A coin is a short
      // ticker and a side is one of two words; anything else is not a
      // request, it is noise, and is dropped rather than passed on.
      const rawCoin = url.searchParams.get('coin') ?? '';
      const rawSide = url.searchParams.get('side') ?? '';
      const focus =
        /^[A-Za-z0-9:_-]{1,24}$/.test(rawCoin) && (rawSide === 'long' || rawSide === 'short')
          ? { coin: rawCoin.toUpperCase(), side: rawSide as 'long' | 'short' }
          : null;

      // The rules are part of the key, and so is the question: a verdict
      // cached before a deploy is an answer from rules that no longer
      // exist, and an answer about the ETH short is not an answer about the
      // BTC long at the same address.
      const asked = focus ? `:${focus.coin}:${focus.side}` : '';
      // The rules are one axis a cached answer can go stale on; the asset
      // registry (which contracts count as a hedge) is another. Without this,
      // a deploy that adds a token to the registry could still answer a
      // recognised holding as unrecognised for up to ten minutes (24.09
      // audit, L08).
      const cacheKey = `check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}${asked}`;

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

      // A reserve the public path cannot reach, so an afternoon of visitors
      // cannot leave the demo with a Hyperliquid-only answer. A header, not
      // `?demo=`: a query string ends up in browser history, server access
      // logs and - the specific way this was found - the URL bar of a
      // screen recording made for this project's own submission video. An
      // unset or empty DEMO_KEY must never itself become a demo pass, which
      // `!==undefined` alone did not rule out (23.09 audit, S03).
      const demo = await isOperator(request, env);

      // One line for every check request that got this far, whatever it
      // got (23.09 audit, S06). See src/telemetry.ts for what is in it and,
      // as carefully, what is not.
      const started = Date.now();
      const counted = (outcome: CheckEvent['outcome'], more: Partial<CheckEvent> = {}) =>
        emit({
          event: 'check',
          outcome,
          ms: Date.now() - started,
          kvDegraded: kv.degraded,
          focus: focus !== null,
          demo,
          ...more,
        });

      if (!fromThisSite(request, url)) {
        counted('cross_site');
        return Response.json({ error: 'checks are started from this site' }, { status: 403 });
      }

      // A POST that only replays a reading already on record is exactly as
      // free as the GET path above - it costs a KV read, nothing else - so
      // it should not spend a place in the rate limiter meant to bound how
      // often a new, expensive check may start (23.09 audit, S02).
      const alreadyCached = await kv.get(cacheKey);
      if (alreadyCached !== null) {
        counted('cached', readingFields(JSON.parse(alreadyCached) as CheckResponse));
        return new Response(alreadyCached, { headers: { 'content-type': 'application/json' } });
      }

      // A coin/side that is not actually open still mints its own cache key
      // and its own fresh paid check, however many different ones are tried
      // - every one of them was going to fall back to the same largest
      // position anyway. When a plain reading of this address is already on
      // record, its candidates already say which positions exist, so an ask
      // outside that list can be answered from it for free instead of
      // spending a new check to learn the same "not open" a second time.
      if (focus) {
        const largestCached = await kv.get(`check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}`);
        if (largestCached !== null) {
          const parsed = JSON.parse(largestCached) as CheckResponse;
          const known = parsed.positions.candidates.some(
            (c) => c.coin.toUpperCase() === focus.coin.toUpperCase() && c.side === focus.side,
          );
          // `candidates` is the five largest positions, not necessarily all
          // of them (src/engine/features.ts, MAX_CANDIDATES = 5). Absence
          // from a truncated list proves nothing - only when nPositions is
          // itself five or fewer is `candidates` the complete roster, and
          // only then can "not in it" become "not open" without a fresh
          // check (25.09 audit, A02).
          const candidatesAreComplete = parsed.positions.nPositions <= parsed.positions.candidates.length;
          if (!known && candidatesAreComplete) {
            const note = `No ${focus.coin} ${focus.side} is open at this address; this answer is about the largest position instead`;
            counted('not_open', readingFields(parsed));
            return Response.json({
              ...explained(parsed),
              coverage: parsed.coverage.includes(note) ? parsed.coverage : [note, ...parsed.coverage],
              // Shown next to the answer, not among the notes: the question
              // asked is not the one this answers (see src/api/check.ts).
              coverageNotes: parsed.coverageNotes?.some((n) => n.text === note)
                ? parsed.coverageNotes
                : [{ text: note, failure: true }, ...(parsed.coverageNotes ?? [])],
            });
          }
        }
      }

      // The reserve exists so the demo path still works while the public
      // one is busy - which it cannot do if reaching it first requires
      // getting past the same public limits it is meant to stand apart
      // from. So this checks the operator key before either limiter, and a
      // demo request skips both: the reserve is what protects it from
      // public load, not a place in the public queue.
      if (!demo) {
        const limiter = requestGate(env.REQUEST_GATE, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
        const ip = extractIp(request);
        if (!(await limiter.allow(ip))) {
          counted('rate_limited');
          return Response.json(
            { error: 'too many checks from this address, try again shortly' },
            { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_SECONDS) } },
          );
        }
        const burst = requestGate(env.REQUEST_GATE, GLOBAL_BURST_MAX, GLOBAL_BURST_WINDOW_SECONDS);
        if (!(await burst.allow('all-clients'))) {
          counted('busy');
          return Response.json(
            { error: 'this site is busy right now, try again in a few seconds' },
            { status: 429, headers: { 'retry-after': String(GLOBAL_BURST_WINDOW_SECONDS) } },
          );
        }
      }

      // Filled in only when this request is the one that made the reading;
      // an answer that came from the cache or from a check already running
      // for the same question cost this request nothing. The `as` keeps
      // TypeScript from deciding it is still null after the await: it is
      // assigned inside the producer below.
      let fresh = null as Pick<CheckEvent, 'nansenCalls' | 'credits' | 'nansenOff'> | null;
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
              focus,
              deadline: startedAt + CHECK_DEADLINE_MS,
              signal: timeout,
            });
            const id = snapshotId(address, result.checkedAt, result.classifierVersion, result.focus);
            // The "what changed" comparison used to fire only for the 22
            // gallery cards a script had re-read by hand; a reader who just
            // checks the same address twice never saw it (audit J05). This
            // is that mechanism for every address: whatever this address's
            // last live reading of the same question was, before this one
            // claims the title.
            //
            // "Same question" means the same explicit pick, or both left to
            // the largest position - never one against the other. Before
            // this, switching from an ETH short to a BTC long at one address
            // shared a single `latest:${address}` pointer, so the next check
            // of either one superseded the other and a manual pick compared
            // as if the account itself had moved (23.09 audit, L02).
            const question = result.focus ? `${result.focus.coin}:${result.focus.side}` : 'largest';
            const latestKey = `latest:${address}:${question}`;
            // With no live reading of this question on record yet, the last
            // one is whichever the Worker ships with - a demonstration
            // reading or a gallery card, both of the largest position - so
            // the first live check of an address someone has already seen
            // on this page says what changed since (23.09 audit, U05).
            const previousId =
              (await kv.get(latestKey)) ??
              (result.focus ? null : previousReadingId([...featured.entries, ...gallery.entries], address, galleryIdOf));
            // Explained last, once it knows how many calls it took: what
            // Nansen added says so, and the reading is what it reads it from.
            const saved: CheckResponse = explained({
              ...result,
              nansenCalls: calls.length,
              snapshotId: id,
              ...(previousId !== null && previousId !== id ? { supersedes: previousId } : {}),
            });
            // Kept so the link can open this reading rather than start a new
            // one. A failed write costs the share link, not the answer - but
            // the page has to be told, or it offers a link to nothing.
            const stored = await kv.put(snapshotKey(id), JSON.stringify(saved), {
              expirationTtl: SNAPSHOT_TTL_SECONDS,
            });
            if (!stored) return { ...explained({ ...result, nansenCalls: calls.length }), snapshotSaved: false };
            // The pointer only moves once this reading is durably the
            // newest one: a save that failed above already returned, so it
            // can never bump a real reading off the position of "latest".
            await kv.put(latestKey, id, { expirationTtl: SNAPSHOT_TTL_SECONDS });
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
            const spent = calls.reduce((sum, c) => sum + (c.creditsCost ?? 1), 0);
            fresh = {
              nansenCalls: calls.length,
              credits: spent,
              ...(nansenOffReason !== undefined ? { nansenOff: nansenOffReason } : {}),
            };
            if (hold !== null) {
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
        counted(
          fresh ? 'fresh' : 'cached',
          fresh ? { ...readingFields(result), ...fresh, saved: result.snapshotSaved === true } : readingFields(result),
        );
        return Response.json(result);
      } catch (err) {
        console.error('check failed', err);
        counted('failed', fresh ?? {});
        return Response.json({ error: 'could not read this address right now, try again shortly' }, { status: 502 });
      }
    }

    // A saved reading, by id. Gallery cards and the demonstration readings
    // ship with the Worker, so they answer without touching storage; live
    // checks are in KV.
    if (url.pathname === '/api/snapshot') {
      const id = url.searchParams.get('id') ?? '';
      if (!isSnapshotId(id)) return Response.json({ error: 'not a snapshot id' }, { status: 400 });
      const started = Date.now();
      const counted = (outcome: SnapshotEvent['outcome']) =>
        emit({ event: 'snapshot', outcome, ms: Date.now() - started, kvDegraded: kv.degraded });
      const bundled = bundledById.get(id);
      if (bundled) {
        counted('bundled');
        return Response.json(
          {
            ...explained(bundled.card),
            kind: bundled.kind,
            share: shareCard(bundled.card, { kind: bundled.kind, origin: url.origin, snapshotId: id }),
          },
          { headers: SNAPSHOT_HEADERS },
        );
      }
      const raw = await kv.get(snapshotKey(id));
      if (raw === null) {
        counted('missing');
        return notFoundYet();
      }
      counted('stored');
      // What was stored called itself live, because it was when it was made.
      // Opened again by a link, it is a saved reading, and the card has to
      // say which of the two the reader is looking at.
      const card = JSON.parse(raw) as CheckResponse;
      return Response.json(
        { ...explained(card), kind: 'saved', share: shareCard(card, { kind: 'saved', origin: url.origin, snapshotId: id }) },
        { headers: SNAPSHOT_HEADERS },
      );
    }

    // A reading's own social-preview picture. GET is what a crawler sends
    // for the og:image URL a shared link carries, and it only ever reads:
    // the picture if it has been drawn, the standing one if not. POST is
    // this site's own page asking for the picture to be drawn now, in a
    // request of its own whose failure nothing displays (23.09 audit, S04).
    if (url.pathname === '/api/og') {
      const id = url.searchParams.get('id') ?? '';
      const started = Date.now();
      const counted = (outcome: PictureEvent['outcome']) =>
        emit({ event: 'picture', outcome, ms: Date.now() - started, kvDegraded: kv.degraded });
      if (method === 'POST') {
        if (!fromThisSite(request, url)) {
          counted('refused');
          return Response.json({ error: 'pictures are drawn for this site' }, { status: 403 });
        }
        if (!isSnapshotId(id)) return Response.json({ error: 'not a snapshot id' }, { status: 400 });
        if ((await kv.get(ogCacheKey(id))) !== null) {
          counted('already_drawn');
          return new Response(null, { status: 204 });
        }
        const bundled = bundledById.get(id);
        const card = bundled?.card ?? (await readSnapshot(kv, id));
        if (!card) {
          counted('no_reading');
          return notFoundYet();
        }
        // Only a real draw is counted: asking about a picture that already
        // exists costs one KV read and is answered above.
        const limiter = requestGate(env.REQUEST_GATE, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
        if (!(await limiter.allow(`og:${extractIp(request)}`))) {
          counted('rate_limited');
          return Response.json(
            { error: 'too many pictures from this address, try again shortly' },
            { status: 429, headers: { 'retry-after': String(RATE_LIMIT_WINDOW_SECONDS) } },
          );
        }
        let png: Uint8Array;
        try {
          png = await drawOgPng(card, bundled?.kind ?? 'saved');
        } catch (err) {
          console.error('og render failed', id, err);
          counted('draw_failed');
          return Response.json({ error: 'could not draw that picture' }, { status: 500 });
        }
        // A bundled card is as permanent as the bundle it ships in; a live
        // reading's picture lives exactly as long as the reading.
        const kept = await kv.put(
          ogCacheKey(id),
          Buffer.from(png).toString('base64'),
          bundled ? undefined : { expirationTtl: SNAPSHOT_TTL_SECONDS },
        );
        if (!kept) {
          counted('save_failed');
          return Response.json({ error: 'drew that picture but could not keep it' }, { status: 503 });
        }
        counted('drawn');
        return new Response(null, { status: 204 });
      }
      const png = isSnapshotId(id) ? await storedOgPng(kv, id) : null;
      counted(png ? 'served' : 'stand_in');
      const res = png
        ? new Response(png, { headers: OG_IMAGE_HEADERS })
        : new Response(ogFallbackPng, { headers: OG_STAND_IN_HEADERS });
      return method === 'HEAD' ? headOf(res) : res;
    }

    // Two readings of one address, side by side. Reads what is already
    // stored and never starts a check: a comparison is a third thing made
    // out of two existing ones, and it costs nothing.
    if (url.pathname === '/api/compare') {
      const a = url.searchParams.get('a') ?? '';
      const b = url.searchParams.get('b') ?? '';
      if (!isSnapshotId(a) || !isSnapshotId(b)) {
        return Response.json({ error: 'two snapshot ids are needed' }, { status: 400 });
      }
      const read = async (id: string) => bundledById.get(id)?.card ?? (await readSnapshot(kv, id));
      const [left, right] = await Promise.all([read(a), read(b)]);
      if (!left || !right) {
        // The newer of the two was usually saved moments ago, which is
        // exactly when this region may not see it yet (see notFoundYet).
        return Response.json(
          { error: 'one of those readings could not be found here: it may have expired, or not have reached this region yet' },
          { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } },
        );
      }
      try {
        return Response.json(compareReadings(left, right), { headers: SNAPSHOT_HEADERS });
      } catch {
        return Response.json({ error: 'those two readings are of different addresses' }, { status: 400 });
      }
    }

    // Whether this browser's operator key reaches the demo reserve - checked
    // on its own, before the demo, so a wrong or missing key is found then
    // rather than on camera (23.09 audit, S03). Costs nothing and says
    // nothing but yes or no.
    if (url.pathname === '/api/demo-access') {
      if (method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405, headers: { allow: 'POST' } });
      if (!fromThisSite(request, url)) return Response.json({ error: 'from this site only' }, { status: 403 });
      return new Response(null, { status: (await isOperator(request, env)) ? 204 : 403 });
    }

    if (url.pathname === '/api/gallery') {
      return Response.json(listedGallery, { headers: { 'cache-control': 'public, max-age=300' } });
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
        const card = bundledById.get(shared)?.card ?? (await readSnapshot(kv, shared));
        if (card) return new Response(withSocialTags(page, card, url, shared), { headers: PAGE_HEADERS });
      }
      return new Response(page, { headers: PAGE_HEADERS });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'no such endpoint' }, { status: 404 });
    }
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  },
};
