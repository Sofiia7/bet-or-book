# Bet or Book - Trades Signal and Web Page Implementation Plan (Phase 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close book rule (в) - the trades-based book signal that Phase 1 deferred - using Hyperliquid's own free `userFillsByTime`, no Nansen key required. Then build the actual web page against the already-working `/api/check` endpoint, so there is a demoable product today instead of waiting on Nansen credentials.

**Architecture:** Same three-layer split as Phase 1. One new source call (`getUserFillsByTime`), one new pure feature function (`computeTradeFeatures`), one new field wired into `checkAddress`, and a static page served by the same Worker.

**Tech Stack:** Same as Phase 1 - TypeScript, Vitest, Cloudflare Workers, no framework for the page (vanilla HTML/CSS/JS, no build step, so it works unchanged once Phase 2 swaps the data source).

**Why now, out of order from the original Phase 1 plan:** the Phase 1 plan (`2026-09-17-bet-or-book-core-engine.md`) deferred `tradesPerDay`/`crossedShare` to Phase 2, assuming they needed Nansen's paginated trade history. A live check against Wintermute's real account (documented in Task 2 below) showed Hyperliquid's own free `userFillsByTime` already carries `crossed` and enough volume to feed this signal today. Nansen's `profiler/perp-trades` remains the Phase 2 upgrade for reading further back than Hyperliquid's own history and for chains other than Hyperliquid.

---

## Task 1: Fills client and domain type

**Files:**
- Modify: `src/sources/hyperliquid.ts` (add `getUserFillsByTime`)
- Modify: `src/types.ts` (add `Trade`)
- Create: `test/fixtures/hyperliquid/fills-24h.json`
- Modify: `test/sources/hyperliquid.test.ts`

- [ ] **Step 1: Capture a real fills fixture**

Run (reusing the Wintermute address already used for Phase 1 calibration - it is the account known to generate enough volume to exercise the 2000-fill cap):
```bash
cd /c/Server/bet_or_book
node -e '
const fs = require("fs");
async function post(body) {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
  });
  return res.json();
}
(async () => {
  const now = Date.now();
  const dayAgo = now - 24*3600*1000;
  const fills = await post({type:"userFillsByTime", user:"0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00", startTime: dayAgo, endTime: now, aggregateByTime: false});
  fs.writeFileSync("test/fixtures/hyperliquid/fills-24h.json", JSON.stringify(fills, null, 2) + "\n");
  console.log("saved", fills.length, "fills");
})();
'
```
Expected: `saved 2000 fills` (or close to it) and the file exists. If the count comes back under 2000, that is fine too - note the actual number, it just means Task 2's cap-detection test needs a synthetic fixture instead of relying on this one to demonstrate the capped case (see Task 2 Step 1).

- [ ] **Step 2: Write the failing test**

Add to `test/sources/hyperliquid.test.ts` (new import at the top, new `describe` block at the bottom):

```typescript
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
```

```typescript
describe('getUserFillsByTime', () => {
  it('parses fills from a real captured response', async () => {
    mockFetchOnce(fillsFixture);
    const fills = await getUserFillsByTime('0xtest', 0, 1);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]).toHaveProperty('coin');
    expect(fills[0]).toHaveProperty('crossed');
    expect(fills[0]).toHaveProperty('closedPnl');
    expect(typeof fills[0].crossed).toBe('boolean');
  });
});
```

Also add `getUserFillsByTime` to the existing import list at the top of the file.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/sources/hyperliquid.test.ts`
Expected: FAIL - `getUserFillsByTime` is not exported yet.

- [ ] **Step 4: Add the type and client function**

In `src/sources/hyperliquid.ts`, add:

```typescript
export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  closedPnl: string;
  crossed: boolean;
  fee: string;
  oid: number;
  tid: number;
}

export async function getUserFillsByTime(user: string, startTime: number, endTime: number): Promise<HlFill[]> {
  return postInfo<HlFill[]>({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false });
}
```

Confirm this matches the fixture captured in Step 1 (open `test/fixtures/hyperliquid/fills-24h.json` and check the field names on the first entry) before moving on - the fixture is the source of truth.

In `src/types.ts`, add:

```typescript
export interface Trade {
  coin: string;
  timestamp: number;
  crossed: boolean;
  closedPnlUsd: number;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/sources/hyperliquid.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/sources/hyperliquid.ts src/types.ts test/sources/hyperliquid.test.ts test/fixtures/hyperliquid/fills-24h.json
git commit -m "feat: fetch recent fills from Hyperliquid's free userFillsByTime"
```

---

## Task 2: Trade features - the deferred book signal (в)

**Files:**
- Modify: `src/sources/normalize.ts` (add `normalizeTrades`)
- Modify: `src/engine/features.ts` (add `computeTradeFeatures`)
- Modify: `test/sources/normalize.test.ts`
- Modify: `test/engine/features.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/engine/features.test.ts`:

```typescript
import { computeTradeFeatures } from '../../src/engine/features';
import type { Trade } from '../../src/types';

describe('computeTradeFeatures', () => {
  it('returns zeroed features for no trades', () => {
    const result = computeTradeFeatures([], 24);
    expect(result.tradesPerDay).toBe(0);
    expect(result.sampleSize).toBe(0);
    expect(result.cappedByApiLimit).toBe(false);
  });

  it('scales a partial-day sample up to a per-day rate', () => {
    const trades: Trade[] = Array.from({ length: 100 }, (_, i) => ({
      coin: 'BTC',
      timestamp: i,
      crossed: i % 2 === 0,
      closedPnlUsd: 0,
    }));
    const result = computeTradeFeatures(trades, 12);
    expect(result.tradesPerDay).toBe(200);
    expect(result.crossedShare).toBeCloseTo(0.5, 6);
    expect(result.sampleSize).toBe(100);
    expect(result.cappedByApiLimit).toBe(false);
  });

  it('flags the result as a floor when the sample hits Hyperliquid\'s 2000-fill cap', () => {
    const trades: Trade[] = Array.from({ length: 2000 }, (_, i) => ({
      coin: 'BTC',
      timestamp: i,
      crossed: i % 4 === 0,
      closedPnlUsd: 0,
    }));
    const result = computeTradeFeatures(trades, 24);
    expect(result.cappedByApiLimit).toBe(true);
    expect(result.tradesPerDay).toBe(2000);
    expect(result.crossedShare).toBeCloseTo(0.25, 6);
  });
});
```

Add to `test/sources/normalize.test.ts`:

```typescript
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
import { normalizeTrades } from '../../src/sources/normalize';
import type { HlFill } from '../../src/sources/hyperliquid';

describe('normalizeTrades', () => {
  it('converts every raw fill into the domain Trade shape', () => {
    const trades = normalizeTrades(fillsFixture as HlFill[]);
    expect(trades.length).toBe((fillsFixture as HlFill[]).length);
    for (const t of trades) {
      expect(typeof t.crossed).toBe('boolean');
      expect(typeof t.closedPnlUsd).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/engine/features.test.ts test/sources/normalize.test.ts`
Expected: FAIL - `computeTradeFeatures` and `normalizeTrades` are not exported yet.

- [ ] **Step 3: Implement**

In `src/sources/normalize.ts`, add:

```typescript
export function normalizeTrades(fills: HlFill[]): Trade[] {
  return fills.map((f) => ({
    coin: f.coin,
    timestamp: f.time,
    crossed: f.crossed,
    closedPnlUsd: Number(f.closedPnl),
  }));
}
```

(add `HlFill` to the existing `import type { ... } from './hyperliquid'` line, and `Trade` to the existing `import type { ... } from '../types'` line)

In `src/engine/features.ts`, add:

```typescript
export interface TradeFeatures {
  tradesPerDay: number;
  crossedShare: number;
  sampleSize: number;
  /** True when the raw sample hit Hyperliquid's 2000-fill-per-call cap, so
   * tradesPerDay is a lower bound, not an exact count - a full page is a
   * sign there is more history, not that the history ends here. */
  cappedByApiLimit: boolean;
}

const HL_FILLS_PAGE_CAP = 2000;

export function computeTradeFeatures(trades: Trade[], windowHours: number): TradeFeatures {
  if (trades.length === 0) {
    return { tradesPerDay: 0, crossedShare: 0, sampleSize: 0, cappedByApiLimit: false };
  }
  const crossedCount = trades.filter((t) => t.crossed).length;
  return {
    tradesPerDay: (trades.length / windowHours) * 24,
    crossedShare: crossedCount / trades.length,
    sampleSize: trades.length,
    cappedByApiLimit: trades.length >= HL_FILLS_PAGE_CAP,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/engine/features.test.ts test/sources/normalize.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sources/normalize.ts src/engine/features.ts test/engine/features.test.ts test/sources/normalize.test.ts
git commit -m "feat: trades-per-day and crossed-share feature (book rule в), capped honestly at Hyperliquid's 2000-fill limit"
```

---

## Task 3: Wire trades into checkAddress

**Files:**
- Modify: `src/api/check.ts`

No new unit test - `checkAddress` is orchestration of already-tested pieces, exercised by the Step 2 live smoke test below (same pattern as Phase 1 Task 9).

- [ ] **Step 1: Add the fills call and trade features to checkAddress**

In `src/api/check.ts`:

```typescript
import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getUserFillsByTime,
} from '../sources/hyperliquid';
import {
  normalizePositions,
  normalizeOrders,
  normalizeTrades,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
} from '../sources/normalize';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeSizeVsOi,
  computeTradeFeatures,
  type PositionFeatures,
  type OrderFeatures,
  type HedgeFeatures,
  type TradeFeatures,
} from '../engine/features';
import { computeVerdict, type VerdictResult } from '../engine/verdict';

const TRADES_WINDOW_HOURS = 24;

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  trades: TradeFeatures;
  sizeVsOi: number | null;
  source: 'hyperliquid';
  checkedAt: string;
}

export async function checkAddress(address: string): Promise<CheckResult> {
  const now = Date.now();
  const [clearinghouse, rawOrders, spotBalances, spotMetaPair, perpMetaPair, rawFills] = await Promise.all([
    getClearinghouseState(address),
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getPerpMetaAndAssetCtxs(),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3600 * 1000, now),
  ]);

  const positionFeatures = computePositionFeatures(normalizePositions(clearinghouse));

  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));

  const [spotMeta, spotAssetCtxs] = spotMetaPair;
  const priceIndex = buildSpotPriceIndex(spotMeta, spotAssetCtxs);
  const spotHoldings = normalizeSpotHoldings(spotBalances.balances, priceIndex);
  const hedgeFeatures = computeHedgeFeatures(
    positionFeatures.headlineCoin,
    positionFeatures.headlineNotionalUsd,
    spotHoldings,
  );

  const tradeFeatures = computeTradeFeatures(normalizeTrades(rawFills), TRADES_WINDOW_HOURS);

  const [perpMeta, perpAssetCtxs] = perpMetaPair;
  const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
  const openInterestUsd =
    headlineIndex >= 0 ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx) : 0;

  const verdict = computeVerdict({
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: { tradesPerDay: tradeFeatures.tradesPerDay, crossedShare: tradeFeatures.crossedShare },
  });

  return {
    address,
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: tradeFeatures,
    sizeVsOi: computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd),
    source: 'hyperliquid',
    checkedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Smoke-test live and recalibrate**

Run: `npm run typecheck` (exits 0), then `npm test` (all still pass - no existing test asserts the old `CheckResult` shape without `trades`, so this is additive).

Start `npm run dev` in the background, then re-run the same three calibration addresses from `docs/wiki/calibration.md`:
```bash
for addr in 0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00 0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36 0xbf732ea04197942783e34730ed6e0f6099575d58; do
  echo "=== $addr ==="
  curl -s "http://localhost:8787/api/check?address=$addr"
  echo ""
done
```
Read each response. Stop the dev server (find and kill only this project's `node`/`workerd` process tree, the same way Phase 1 did it - never a blind kill of all `node.exe`).

Append a short dated note to `docs/wiki/calibration.md` under a new `## 2026-09-17, after adding the trades signal` heading: for each of the three addresses, whether the verdict or its reasons changed, and the new `trades` block. Do not overwrite the original table - add below it.

- [ ] **Step 3: Commit**

```bash
git add src/api/check.ts docs/wiki/calibration.md
git commit -m "feat: wire the trades signal into /api/check and recalibrate"
```

---

## Task 4: Web page

**Files:**
- Create: `web/index.html`
- Modify: `src/index.ts`
- Modify: `wrangler.toml`

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bet or Book</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; line-height: 1.5; }
  h1 { font-size: 22px; font-weight: 500; }
  .sub { color: #666; margin-top: -8px; }
  .row { display: flex; gap: 8px; margin: 20px 0; }
  input { flex: 1; padding: 10px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 8px; font-family: monospace; }
  button { padding: 10px 16px; font-size: 14px; border: 1px solid #ccc; border-radius: 8px; background: none; cursor: pointer; }
  button:hover { background: #f2f2f2; }
  .card { border: 1px solid #ccc; border-radius: 12px; padding: 16px 20px; display: none; }
  .badge { display: inline-block; font-size: 13px; font-weight: 500; padding: 4px 12px; border-radius: 8px; }
  .badge-book { background: #e6f1fb; color: #0c447c; }
  .badge-hedged { background: #eaf3de; color: #27500a; }
  .badge-bet { background: #faeeda; color: #633806; }
  .badge-unknown { background: #f1efe8; color: #444441; }
  .headline { font-size: 18px; font-weight: 500; margin: 10px 0 2px; }
  .explain { color: #666; margin: 0 0 12px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin: 16px 0; }
  .stat { background: #f7f7f7; border-radius: 8px; padding: 10px 12px; }
  .stat-label { font-size: 12px; color: #666; }
  .stat-value { font-size: 20px; font-weight: 500; }
  .cannot-see { background: #faeeda; color: #633806; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-top: 12px; }
  .footer { font-size: 12px; color: #999; margin-top: 12px; }
  .error { color: #a32d2d; font-size: 14px; display: none; }
</style>
</head>
<body>
<h1>Bet or book</h1>
<p class="sub">Should you copy this whale? Paste a Hyperliquid address.</p>

<div class="row">
  <input id="address" type="text" placeholder="0x... or a link containing one" autocomplete="off" spellcheck="false">
  <button id="check">Check</button>
</div>
<p class="error" id="error"></p>

<div class="card" id="card">
  <span class="badge" id="badge"></span>
  <p class="headline" id="headline"></p>
  <p class="explain" id="explain"></p>
  <div class="stats" id="stats"></div>
  <p class="cannot-see" id="cannot-see"></p>
  <p class="footer" id="footer"></p>
</div>

<script>
function extractAddress(input) {
  const m = input.trim().match(/0x[0-9a-fA-F]{40}/);
  return m ? m[0] : null;
}

const VERDICT_COPY = {
  book: { label: 'Book', cls: 'badge-book', headline: 'This is a market-making book.', explain: 'There is nothing to copy - this account quotes both sides.' },
  hedged: { label: 'Hedged', cls: 'badge-hedged', headline: 'This position is not a directional view.', explain: 'A hedge leg covers most of the exposure, or the book roughly nets out.' },
  looks_like_a_bet: { label: 'Looks like a bet', cls: 'badge-bet', headline: 'This looks like a real bet.', explain: 'A hedge on a centralized exchange would be invisible to us.' },
  unknown: { label: 'Unknown', cls: 'badge-unknown', headline: 'Not enough evidence either way.', explain: 'The signals disagree, or there is not enough data to call it.' },
};

function fmtUsd(n) {
  if (n === null || n === undefined) return '-';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtPct(n) {
  if (n === null || n === undefined) return '-';
  return (n * 100).toFixed(1) + '%';
}

async function runCheck() {
  const raw = document.getElementById('address').value;
  const addr = extractAddress(raw);
  const errorEl = document.getElementById('error');
  const cardEl = document.getElementById('card');
  if (!addr) {
    errorEl.textContent = 'Enter a Hyperliquid address (or a link containing one) first.';
    errorEl.style.display = 'block';
    cardEl.style.display = 'none';
    return;
  }
  errorEl.style.display = 'none';

  const res = await fetch('/api/check?address=' + encodeURIComponent(addr));
  const data = await res.json();
  if (!res.ok) {
    errorEl.textContent = data.error || 'Something went wrong.';
    errorEl.style.display = 'block';
    cardEl.style.display = 'none';
    return;
  }

  const v = VERDICT_COPY[data.verdict.verdict] || VERDICT_COPY.unknown;
  const badge = document.getElementById('badge');
  badge.textContent = v.label + (data.verdict.strength ? ' (' + data.verdict.strength + ')' : '');
  badge.className = 'badge ' + v.cls;
  document.getElementById('headline').textContent = v.headline;
  document.getElementById('explain').textContent = v.explain;

  const stats = document.getElementById('stats');
  stats.innerHTML = '';
  const rows = [
    ['Open positions', data.positions.nPositions],
    ['Net / gross exposure', fmtPct(data.positions.netToGross)],
    ['Resting orders', data.orders.restingOrders],
    ['Headline position', fmtUsd(data.positions.headlineNotionalUsd) + ' ' + (data.positions.headlineCoin || '')],
    ['Hedge ratio', fmtPct(data.hedge.hedgeRatio)],
    ['Trades / day' + (data.trades.cappedByApiLimit ? ' (at least)' : ''), Math.round(data.trades.tradesPerDay)],
  ];
  for (const [label, value] of rows) {
    const div = document.createElement('div');
    div.className = 'stat';
    div.innerHTML = '<div class="stat-label"></div><div class="stat-value"></div>';
    div.querySelector('.stat-label').textContent = label;
    div.querySelector('.stat-value').textContent = value;
    stats.appendChild(div);
  }

  document.getElementById('cannot-see').textContent =
    'What we cannot see: positions on centralized exchanges and OTC deals, and wallets not linked on-chain to this address.';
  document.getElementById('footer').textContent =
    'Source: ' + data.source + ' - checked ' + new Date(data.checkedAt).toLocaleString();

  cardEl.style.display = 'block';
}

document.getElementById('check').addEventListener('click', runCheck);
document.getElementById('address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
</script>
</body>
</html>
```

- [ ] **Step 2: Serve it from the Worker**

Add a KV-free static-asset binding is overkill for one file - inline it instead. Modify `src/index.ts`:

```typescript
import { extractAddress } from './guard';
import { checkAddress } from './api/check';
import pageHtml from '../web/index.html';

export default {
  async fetch(request: Request): Promise<Response> {
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
      try {
        const result = await checkAddress(address);
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
```

Add a module rule to `wrangler.toml` so wrangler bundles the HTML file as a text import:

```toml
rules = [
  { type = "Text", globs = ["**/*.html"], fallthrough = false },
]
```

Add the matching ambient type so TypeScript accepts the `.html` import - create `src/html.d.ts`:

```typescript
declare module '*.html' {
  const content: string;
  export default content;
}
```

- [ ] **Step 3: Smoke-test**

Run: `npm run typecheck`
Expected: exits 0.

Start `npm run dev` in the background.

Run: `curl -s http://localhost:8787/ | head -5`
Expected: the page's `<!DOCTYPE html>` and `<title>Bet or Book</title>`.

Open the Browser pane at `http://localhost:8787/`, paste in one of the three calibration addresses (e.g. `0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00`), click Check, and confirm the card renders with a "Book" badge and populated stats.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/nope`
Expected: `404`.

Stop the dev server (this project's process tree only).

- [ ] **Step 4: Commit**

```bash
git add web/index.html src/index.ts src/html.d.ts wrangler.toml
git commit -m "feat: serve a single-page UI for /api/check"
```

---

## Self-review notes

- **Spec coverage:** closes book rule (в) from `docs/specs/2026-09-17-bet-or-book-design.md` section 3 (deferred by the Phase 1 plan), and delivers a first cut of section 2's UI scenario and section 4 rule 5 ("what we cannot see" shown always) and rule 3 (a capped page is flagged, never silently truncated).
- **Placeholder scan:** none - every step has runnable code or an exact command.
- **Type consistency:** `Trade` defined once in `src/types.ts` (Task 1) and consumed by `src/sources/normalize.ts` and `src/engine/features.ts` (Task 2) without redefinition; `TradeFeatures` defined once in `src/engine/features.ts` and imported into `src/api/check.ts` (Task 3); `CheckResult` gains a `trades` field additively, nothing existing renamed.
- **Out of scope, still Phase 2:** Nansen client, the gallery/prescan and its 1,000-call requirement, the credit ledger, KV-backed rate limiting and caching, the shareable card image, and `wrangler deploy`. These need the Nansen key and credits and are planned separately once available.
