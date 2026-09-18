# Bet or Book - Phase 2b: lazy reads, evidence, gallery, ledger, README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working Nansen-first engine into the submission: every Nansen call made only where it can change the verdict, a card that explains itself with named sources and the "Powered by Nansen API" attribution, a pre-scanned gallery of the biggest Hyperliquid positions that also completes the 1 000-call requirement, a call ledger, and a README.

**Architecture:** `checkAddress` becomes staged: positions and PnL first (in parallel with the free Hyperliquid reads), then own cross-chain balances only when a pure verdict helper says a hedge could still change the answer, then linked wallets only when the own hedge leaves it open. A new pure module `src/engine/evidence.ts` turns a result into one data-driven sentence and 3-5 evidence items with their source. `scripts/prescan.ts` runs the exact same `checkAddress` over the biggest positions found through Hyperliquid's free leaderboard and writes `data/gallery.json`, which the Worker bundles and serves at `/api/gallery`.

**Tech Stack:** unchanged - TypeScript, Vitest, Cloudflare Workers + KV, tsx for scripts.

## Budget, stated once

On 18.09: 31 calls made (12 fixture captures + 19 through `wrangler dev`), 974 credits left, every call 1 credit. The buildathon needs 1 000 calls inside 14-27.09, so 969 more. Sofia's word on 18.09: "continue to the end with the live key, I will top up if needed".

Two documented facts from `docs.nansen.ai/getting-started/credits` (read 18.09): all endpoints we use cost 1 credit; the free plan tops the balance up to 10 credits daily when it falls below 10. What the API returns when credits run out is not documented - Task 3 treats 401/402/403 as "stop using Nansen for today".

Spend in this plan: Task 6 about 11 credits (three known addresses, live), Task 8 everything down to a reserve of 30 (for the deployed smoke test and the demo recording), later tasks nothing.

---

## Task 1: Verdict helper - can a hedge read still change the answer?

**Files:**
- Modify: `src/engine/verdict.ts`
- Test: `test/engine/verdict.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing describe file)

```typescript
import { hedgeCanChangeVerdict } from '../../src/engine/verdict';

describe('hedgeCanChangeVerdict', () => {
  const concentratedShort = positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'ETH', headlineSide: 'short', headlineNotionalUsd: 100_000_000 });

  it('is true for a concentrated short with no book signal', () => {
    expect(hedgeCanChangeVerdict({ positions: concentratedShort, orders: orders({}) })).toBe(true);
  });
  it('is false for a long headline - spot offsets only a short', () => {
    expect(hedgeCanChangeVerdict({ positions: { ...concentratedShort, headlineSide: 'long' }, orders: orders({}) })).toBe(false);
  });
  it('is false when a book signal already fired', () => {
    const many = positions({ nPositions: 40, netToGross: 0.1, headlineShare: 0.1, headlineCoin: 'ETH', headlineSide: 'short', headlineNotionalUsd: 1 });
    expect(hedgeCanChangeVerdict({ positions: many, orders: orders({}) })).toBe(false);
  });
  it('is false for a balanced book', () => {
    const balanced = positions({ nPositions: 6, netToGross: 0.2, headlineShare: 0.3, headlineCoin: 'ETH', headlineSide: 'short', headlineNotionalUsd: 1 });
    expect(hedgeCanChangeVerdict({ positions: balanced, orders: orders({}) })).toBe(false);
  });
  it('is false with no positions', () => {
    expect(hedgeCanChangeVerdict({ positions: positions({}), orders: orders({}) })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail** - `npx vitest run test/engine/verdict.test.ts`, expected: `hedgeCanChangeVerdict is not a function`.

- [ ] **Step 3: Implement** - extract `isBalancedBook`, narrow `bookSignals` to the structural fields, add the helper; `computeVerdict` uses `isBalancedBook`:

```typescript
type StructureInput = Pick<VerdictInput, 'positions' | 'orders' | 'trades'>;

function isBalancedBook(input: StructureInput, thresholds: VerdictThresholds): boolean {
  const h = thresholds.hedged;
  return (
    input.positions.nPositions >= h.minPositionsForBalancedBook &&
    input.positions.nPositions <= h.maxPositionsForBalancedBook &&
    input.positions.netToGross <= thresholds.book.maxNetToGross
  );
}

/** A hedge read costs a credit, so it is worth making only when its answer
 * could move the verdict: positions exist, no book signal fired, the book is
 * not already balanced, and the headline is a short - spot offsets nothing
 * else. Mirrors the order of the rules in computeVerdict. */
export function hedgeCanChangeVerdict(
  input: StructureInput,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    input.positions.nPositions > 0 &&
    input.positions.headlineSide === 'short' &&
    bookSignals(input, thresholds.book).length === 0 &&
    !isBalancedBook(input, thresholds)
  );
}
```

- [ ] **Step 4: Run** - all verdict tests pass.
- [ ] **Step 5: Commit** - `feat: verdict helper that says when a hedge read can still change the answer`

## Task 2: Staged reads in checkAddress

**Files:**
- Modify: `src/api/check.ts`, `src/engine/features.ts` (type `HedgeScope`)
- Test: `test/api/check.test.ts`

Order of reads:
1. In parallel: the five free Hyperliquid reads, Nansen `perp-positions`, Nansen `perp-pnl-summary`.
2. `hedgeCanChangeVerdict` false -> stop reading Nansen. True -> own `current-balance` (chain `all`).
3. Own hedge below `DEFAULT_THRESHOLDS.hedged.minHedgeRatio` -> `related-wallets` on Arbitrum and Ethereum, then up to two First Funders' `current-balance`.

`CheckResult` gains `hedgeScope: 'none' | 'hyperliquid' | 'all-chains'`: `none` when the headline is not a short (hedge is zero by definition), `all-chains` when Nansen balances were read, `hyperliquid` otherwise.

- [ ] **Step 1: Write the failing tests** - a fake `NansenClient` built from `vi.fn` counts calls per method; Hyperliquid stays routed to the Abraxas fixtures.

```typescript
function fakeNansen(opts: { positions: NansenPerpPositions; balances?: NansenBalance[] }) {
  return {
    perpPositions: vi.fn(async () => opts.positions),
    perpPnlSummary: vi.fn(async () => abxPnl.data as NansenPnlSummary),
    currentBalance: vi.fn(async () => ({ rows: opts.balances ?? [], complete: true })),
    relatedWallets: vi.fn(async () => [] as NansenRelatedWallet[]),
  };
}

it('reads nothing past positions and PnL for a book', async () => { /* Wintermute positions fixture -> verdict book, currentBalance and relatedWallets never called */ });
it('reads nothing past positions and PnL when the headline is a long', async () => { /* one long BTC -> hedgeScope none, currentBalance not called */ });
it('stops after own balances when they already hedge the short', async () => { /* one ETH short $100M, balances 60M WETH -> hedged hedge_leg, relatedWallets not called, hedgeScope all-chains */ });
```

The existing Abraxas test keeps asserting 7 calls and `hedged (probable)`.

- [ ] **Step 2: Run to see them fail** (`currentBalance` is called today for every check).
- [ ] **Step 3: Implement** the staged flow (code in the commit; the funder rules - First Funder only, not a shared service, deduplicated, at most two - are unchanged).
- [ ] **Step 4: Run** full suite and typecheck.
- [ ] **Step 5: Commit** - `feat: read Nansen balances and linked wallets only when they can change the verdict`

## Task 3: Stop for the day on 401/402/403

**Files:** Modify `src/credits.ts`; Test `test/credits.test.ts`

- [ ] **Step 1: Failing test**

```typescript
it('stops Nansen for the rest of the day after an auth or payment refusal', async () => {
  const kv = new FakeKV();
  await recordCalls(kv, '2026-09-20', [{ path: 'profiler/perp-positions', status: 402, creditsCost: null, creditsRemaining: null }]);
  expect(await nansenAllowed(kv, '2026-09-20', 300, 5)).toBe(false);
  expect(await nansenAllowed(kv, '2026-09-21', 300, 5)).toBe(true);
});
```

- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement** - in `recordCalls`, after the header update: `if (calls.some((c) => c.status === 401 || c.status === 402 || c.status === 403)) stats.lastRemaining = 0;`. The day key already resets it tomorrow, which is also when the free plan's daily top-up lands.
- [ ] **Step 4: Run.**
- [ ] **Step 5: Commit** - `feat: a refused Nansen call stops Nansen reads until the next day`

## Task 4: Evidence - one sentence and 3-5 sourced numbers

**Files:**
- Create: `src/engine/evidence.ts`, `test/engine/evidence.test.ts`
- Modify: `src/api/check.ts` (adds `summary` and `evidence` to `CheckResult`)

`explain(input)` returns `{ summary: string; evidence: EvidenceItem[] }`, `EvidenceItem = { label, value, source: 'Nansen' | 'Hyperliquid' }`. Sentences per verdict:

| Verdict / reason | Summary |
|---|---|
| unknown, no positions | `No open positions right now, so there is nothing to classify.` |
| book | clauses for each fired signal joined with `; ` - `134 open positions net out to 9% of gross exposure`, `212 resting orders quote both sides of 31 markets`, `2,000+ fills in the last 24 hours, 76% of them as maker` - then `. There is nothing to copy.` |
| hedged, hedge_leg | `The $X COIN short is N% covered by COIN held by the same account on Hyperliquid` / `across chains` |
| hedged, balanced_book | `N positions net out to P% of gross exposure: the longs and shorts offset each other.` |
| hedged, probable | `The $X COIN short is N% covered by COIN held in K wallet(s) that funded this account. Ownership is inferred from the funding link, not confirmed.` |
| looks like a bet | `P% of the exposure is one SIDE COIN position of $X, and nothing in this account offsets it.` (long) / `..., and no COIN was found in this account or the wallets that funded it.` (short) |
| unknown, disagree | `N open positions, net P% of gross, largest $X SIDE COIN: not a book, not hedged, not concentrated enough to call a bet.` |

Evidence: for a book - open positions, net/gross, resting orders, fills 24h, realized PnL 30d; otherwise - largest position, share of exposure, hedge found (with scope), realized PnL 30d, size vs open interest. Items whose data is missing are left out; at most five.

- [ ] Steps: failing tests on formatted strings for each row of the table (USD as `$179.4M`, `-$15.5M`, `$950K`; percent with no decimals at or above 10%, one below), implement, wire into `checkAddress`, run, commit `feat: data-driven summary and sourced evidence for every verdict`.

## Task 5: Prescan script

**Files:** Create `scripts/prescan.ts`

- Reads the key from `.dev.vars` (never printed). Loads Hyperliquid's free leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`), takes the top `--pool` accounts by account value (default 1 000), reads each one's `clearinghouseState` (free, main dex) and ranks them by largest open position.
- Runs the Worker's own `checkAddress` on each, in that order, sequentially, at least 6 s apart (Hyperliquid weight budget 1 200/min; one check is about 80-180).
- Every Nansen call goes to `data/nansen-calls.jsonl` with `source: "prescan"`.
- Stops when the last `x-nansen-credits-remaining` is at or below `--reserve` (default 30), on any 401/402/403, or after 3 checks in a row that lost Nansen positions.
- Writes `data/gallery.json` after every check (`--resume` skips addresses already in it), so an interrupted run never pays twice.
- `--addresses=a,b,c` scans exactly those, for the smoke test.
- Hyperliquid 429s are retried inside the script with backoff (the Worker keeps failing fast).

## Task 6: Live smoke through the script (about 11 credits)

- [ ] `npx tsx scripts/prescan.ts --addresses=<Wintermute>,<Abraxas>,<ZEC account> --reserve=30 --out=data/smoke.json`
- [ ] Expected: Wintermute `book`, 2 calls; ZEC account `looks_like_a_bet`, 2 calls; Abraxas `hedged (probable)`, 7 calls. Anything else stops the plan before Task 8.

## Task 7: Gallery route and the page

**Files:** Modify `src/index.ts`, `web/index.html`; Create `data/gallery.json` (placeholder), `src/json.d.ts` if needed.

- `GET /api/gallery` returns the bundled `data/gallery.json`.
- Card: badge with strength, server summary, evidence grid with a source tag on each item, funding-wallet block with explorer links and "Powered by Nansen API" next to it, coverage notes, footer naming both sources, "Powered by Nansen API" on the card image.
- Gallery section: counts by verdict, filter chips, rows ranked by largest position; a row opens its snapshot card, labeled with the scan time, with a "Check live" button.
- Verified in the browser on the three smoke-test entries before the full prescan.

## Task 8: Full prescan

- [ ] Run in the background, watch `data/nansen-calls.jsonl` grow, stop at the reserve.
- [ ] Record counts by verdict and anything surprising in `docs/wiki/calibration.md`.

## Task 9: Ledger

- `scripts/ledger.ts` sums `data/nansen-calls.jsonl` into `data/ledger.json` (calls, credits, by endpoint, by source, window 14-27.09). The 19 calls made through `wrangler dev` on 18.09 go into the jsonl as four aggregate lines by endpoint with a `count` field (3 positions, 3 PnL, 7 balances, 6 related-wallets - matches the local KV counter `{"calls":19,"credits":19}`).
- `GET /api/ledger` returns the bundled summary plus the deployed Worker's own KV day counters inside the window. The page footer prints the total.

## Task 10: README, security, demo script

- README in English: what it answers, the verdict rules, which Nansen endpoint drives which rule, credits per check, what it cannot see, gallery numbers, run locally in 10 minutes, deploy, attribution.
- Spec section 9: re-check of all twelve checklist items after Phase 2b, `npm audit`, secret scan of the whole git history.
- Demo script for a 30-60 s silent recording.
- Stop and ask Sofia for a separate yes on: Cloudflare KV namespace + secret + `wrangler deploy`, public GitHub repo, the X post.
