# Bet or Book - Nansen Core Implementation Plan (Phase 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nansen the primary data source behind `/api/check` - complete positions across every Hyperliquid perp dex, 30-day realized PnL, cross-chain holdings, and the hedge leg found through the wallets that funded the account - while every call stays inside the free 1 000-credit budget and Hyperliquid-only mode remains as an honest fallback.

**Architecture:** Same three layers. `src/sources/nansen.ts` is a typed client created per request with the key and a call recorder (no global key, no global state). `src/sources/normalize.ts` maps Nansen responses onto the existing domain types, so `src/engine/*` gains a hedge-side fix and one new feature but no Nansen imports. `src/api/check.ts` reads Nansen and the free Hyperliquid endpoints in parallel with `Promise.allSettled`, so one failed source degrades one feature instead of the whole check. Credits are tracked in `src/credits.ts` over KV.

**Tech Stack:** unchanged - TypeScript, Vitest, Cloudflare Workers, KV.

## Budget, stated once

Measured 18.09 from `data/nansen-calls.jsonl` and the `X-Nansen-Credits-Cost` header: every call made so far cost exactly 1 credit. 10 calls made, 995 credits left, the buildathon needs 1 000 calls. Every successful call counts toward the 1 000 whatever it is for, so development calls are not lost - they only shrink the gallery (Phase 2b) that fills the remainder. The only real waste is a call that fails or costs more than 1 credit. Hence two rules for this plan: (1) a request shape goes live only after it has been checked against the docs or an existing fixture; (2) this plan spends about 21 credits in total: 2 in Task 6 Step 1, about 19 in Task 8.

Per check, Nansen costs 5 calls (positions, PnL summary, own balances, related wallets on Arbitrum and on Ethereum) plus up to 2 (funder balances) only when the headline position is a short that its own holdings do not already hedge.

## What the real fixtures changed versus the design doc

- `profiler/perp-positions` returns 134 positions for Wintermute, 48 of them on HIP-3 dexes (`xyz:NVDA`...). Hyperliquid's `clearinghouseState` without a `dex` parameter reads only the main dex (86). Nansen becomes the positions source; Hyperliquid positions stay only as the fallback, labeled as main-dex-only.
- `profiler/perp-trades` is dropped from the per-check set: 1 000 records covered 16 minutes of Wintermute, and it aggregates partial fills into one trade, so its crossed share (43%) is not comparable with the fill-level threshold calibrated on Hyperliquid's free `userFillsByTime` (24%). The free fills keep feeding book rule (в).
- Spot can hedge only a short. `computeHedgeFeatures` ignores side today, so a long perp plus the same asset on spot would read as "hedged". Fixed in Task 4.
- Abraxas' own address holds no hedge on any chain; its two First Funders hold about $399M of ETH and staked/wrapped ETH (`AETHWETH`, `WEETH`, `WSTETH`, `RSETH`) against a $177.5M ETH short. Ownership through a funding link is inferred, not proven, so this becomes a separate verdict strength, `probable`, never a plain `hedged`.
- `address_label` is read only inside `normalize.ts` to flag exchanges and bridges (links to those are not followed) and never leaves that function. Nansen prohibits showing labels publicly; the captured labels were "High Activity" and "Token Millionaire", neither an exchange.

---

## Task 1: Nansen client

**Files:**
- Create: `src/sources/nansen.ts`
- Test: `test/sources/nansen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/sources/nansen.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import positionsFixture from '../fixtures/nansen/perp-positions-wintermute.json';
import balancesFixture from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';
import { createNansenClient, type NansenCallMeta } from '../../src/sources/nansen';

const KEY = 'test-key-not-real';

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('nansen client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to the right path with the apikey header and returns data', async () => {
    const fn = mockFetch(positionsFixture, 200, { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '995' });
    const client = createNansenClient(KEY);
    const result = await client.perpPositions('0xabc');
    expect(result.asset_positions.length).toBe(134);
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('https://api.nansen.ai/api/v1/profiler/perp-positions');
    expect((init?.headers as Record<string, string>).apikey).toBe(KEY);
    expect(JSON.parse(String(init?.body))).toEqual({ address: '0xabc' });
  });

  it('records every call with the credit headers', async () => {
    mockFetch(positionsFixture, 200, { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '995' });
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    await client.perpPositions('0xabc');
    expect(calls).toEqual([{ path: 'profiler/perp-positions', status: 200, creditsCost: 1, creditsRemaining: 995 }]);
  });

  it('reports whether a balance page was the last one', async () => {
    mockFetch(balancesFixture);
    const client = createNansenClient(KEY);
    const result = await client.currentBalance('0xabc');
    expect(result.rows.length).toBe(69);
    expect(result.complete).toBe(true);
  });

  it('records a failed call and throws without leaking the key', async () => {
    mockFetch({ error: 'unauthorized' }, 401);
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    const err = await client.perpPositions('0xabc').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toContain(KEY);
    expect(calls[0].status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- test/sources/nansen.test.ts`
Expected: FAIL - `src/sources/nansen.ts` does not exist.

- [ ] **Step 3: Implement**

```typescript
// src/sources/nansen.ts
// Typed client for the Nansen endpoints Bet or Book uses. Types mirror the
// real responses in test/fixtures/nansen/ (scripts/fetch-nansen-fixtures.ts),
// not the docs alone - the docs and the live API name some fields
// differently. The key is passed in per client and never stored globally or
// put into an error message.
const BASE_URL = 'https://api.nansen.ai/api/v1';

export interface NansenPosition {
  token_symbol: string;
  size: string;
  position_value_usd: string;
  entry_price_usd: string;
  liquidation_price_usd: string | null;
  leverage_value: number;
  leverage_type: string;
  margin_used_usd: string;
  unrealized_pnl_usd: string;
  cumulative_funding_since_open_usd: string;
  return_on_equity: string;
}

export interface NansenPerpPositions {
  asset_positions: Array<{ position: NansenPosition; position_type: string }>;
  margin_summary_account_value_usd: string;
  withdrawable_usd: string;
  timestamp: number;
}

export interface NansenPnlSummary {
  top5_coins: Array<{
    coin: string;
    realized_pnl_usd: number;
    realized_roi: number;
    closed_trade_count: number;
    fees_usd: number;
  }>;
  traded_coin_count: number;
  traded_times: number;
  closed_trade_count: number;
  winning_trade_count: number;
  realized_pnl_usd: number;
  realized_pnl_percent: number;
  win_rate: number;
  fees_usd: number;
}

export interface NansenBalance {
  chain: string;
  address: string;
  token_address: string;
  token_symbol: string;
  token_name: string;
  token_amount: number;
  price_usd: number;
  value_usd: number;
}

export interface NansenRelatedWallet {
  address: string;
  address_label: string | null;
  relation: string;
  transaction_hash: string;
  block_timestamp: string;
  order: number;
  chain: string;
}

export interface NansenCallMeta {
  path: string;
  status: number;
  creditsCost: number | null;
  creditsRemaining: number | null;
}

export type NansenCallRecorder = (meta: NansenCallMeta) => void | Promise<void>;

export interface NansenClient {
  perpPositions(address: string): Promise<NansenPerpPositions>;
  perpPnlSummary(address: string, fromDate: string, toDate: string): Promise<NansenPnlSummary>;
  /** `complete` is false when a full page came back and more holdings may exist. */
  currentBalance(address: string): Promise<{ rows: NansenBalance[]; complete: boolean }>;
  relatedWallets(address: string, chain: string): Promise<NansenRelatedWallet[]>;
}

interface Envelope<T> {
  data: T;
  pagination?: { is_last_page: boolean };
}

function headerNumber(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  return v === null ? null : Number(v);
}

export function createNansenClient(apiKey: string, record: NansenCallRecorder = () => {}): NansenClient {
  async function post<T>(path: string, body: Record<string, unknown>): Promise<Envelope<T>> {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
    });
    await record({
      path,
      status: res.status,
      creditsCost: headerNumber(res, 'x-nansen-credits-cost'),
      creditsRemaining: headerNumber(res, 'x-nansen-credits-remaining'),
    });
    if (!res.ok) {
      throw new Error(`nansen ${path} failed: ${res.status}`);
    }
    return (await res.json()) as Envelope<T>;
  }

  return {
    perpPositions: async (address) => (await post<NansenPerpPositions>('profiler/perp-positions', { address })).data,
    perpPnlSummary: async (address, fromDate, toDate) =>
      (await post<NansenPnlSummary>('profiler/perp-pnl-summary', { address, date: { from: fromDate, to: toDate } })).data,
    currentBalance: async (address) => {
      const r = await post<NansenBalance[]>('profiler/address/current-balance', {
        address,
        chain: 'all',
        hide_spam_token: true,
        pagination: { page: 1, per_page: 100 },
      });
      return { rows: r.data, complete: r.pagination?.is_last_page ?? true };
    },
    relatedWallets: async (address, chain) =>
      (
        await post<NansenRelatedWallet[]>('profiler/address/related-wallets', {
          address,
          chain,
          pagination: { page: 1, per_page: 100 },
        })
      ).data,
  };
}
```

The request bodies are exactly the ones already sent live by `scripts/fetch-nansen-fixtures.ts` (each returned HTTP 200) - no new shape goes live here.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- test/sources/nansen.test.ts` - Expected: PASS, 4 tests. Then `npm run typecheck` - exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/sources/nansen.ts test/sources/nansen.test.ts
git commit -m "feat: typed Nansen client with a per-call credit recorder"
```

---

## Task 2: Nansen normalizers and domain types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/sources/normalize.ts`
- Modify: `test/sources/normalize.test.ts`

- [ ] **Step 1: Extend domain types**

In `src/types.ts`, change `SpotHolding` and add three types:

```typescript
export interface SpotHolding {
  coin: string;
  valueUsd: number;
  /** Chain the holding lives on; absent for Hyperliquid's own spot balances. */
  chain?: string;
}

export interface LinkedWallet {
  address: string;
  relation: string;
  chain: string;
  /** True when the link points at an exchange, bridge or similar shared
   * service - following it would attribute other people's money. */
  isSharedService: boolean;
}

export interface PnlSummary {
  realizedPnlUsd: number;
  winRate: number;
  closedTrades: number;
  windowDays: number;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `test/sources/normalize.test.ts` (imports at the top, block at the bottom):

```typescript
import nansenPositionsFixture from '../fixtures/nansen/perp-positions-wintermute.json';
import funderEthBalancesFixture from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';
import relatedArbFixture from '../fixtures/nansen/related-wallets-abraxas-arbitrum.json';
import pnlFixture from '../fixtures/nansen/perp-pnl-summary-wintermute.json';
import {
  normalizeNansenPositions,
  normalizeNansenBalances,
  normalizeRelatedWallets,
  normalizeNansenPnl,
} from '../../src/sources/normalize';
import type { NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from '../../src/sources/nansen';
```

```typescript
describe('Nansen normalizers', () => {
  it('maps every Nansen position, including HIP-3 dexes, onto Position', () => {
    const positions = normalizeNansenPositions((nansenPositionsFixture as { data: NansenPerpPositions }).data);
    expect(positions.length).toBe(134);
    expect(positions.filter((p) => p.coin.includes(':')).length).toBe(48);
    const eth = positions.find((p) => p.coin === 'ETH');
    expect(eth?.side).toBe('short');
    expect(eth?.sizeUsd).toBeGreaterThan(0);
  });

  it('keeps chain on balances and drops zero-value rows', () => {
    const rows = (funderEthBalancesFixture as { data: NansenBalance[] }).data;
    const holdings = normalizeNansenBalances(rows);
    expect(holdings.every((h) => h.valueUsd > 0)).toBe(true);
    expect(holdings.find((h) => h.coin === 'AETHWETH')?.chain).toBe('ethereum');
  });

  it('flags links to shared services and never returns the label itself', () => {
    const fixtureRows = (relatedArbFixture as { data: NansenRelatedWallet[] }).data;
    const [first] = normalizeRelatedWallets(fixtureRows);
    expect(first.relation).toBe('First Funder');
    expect(first.isSharedService).toBe(false);
    expect(Object.keys(first)).not.toContain('address_label');

    const synthetic = (label: string | null): NansenRelatedWallet => ({
      ...fixtureRows[0],
      address_label: label,
    });
    expect(normalizeRelatedWallets([synthetic('Binance: Hot Wallet')])[0].isSharedService).toBe(true);
    expect(normalizeRelatedWallets([synthetic('Arbitrum Bridge')])[0].isSharedService).toBe(true);
    expect(normalizeRelatedWallets([synthetic('High Activity')])[0].isSharedService).toBe(false);
    expect(normalizeRelatedWallets([synthetic('Token Millionaire')])[0].isSharedService).toBe(false);
  });

  it('maps the PnL summary', () => {
    const pnl = normalizeNansenPnl((pnlFixture as { data: NansenPnlSummary }).data, 30);
    expect(pnl.realizedPnlUsd).toBeCloseTo(-13_625_651.41, 0);
    expect(pnl.winRate).toBeCloseTo(0.4663, 3);
    expect(pnl.closedTrades).toBe(2_423_158);
    expect(pnl.windowDays).toBe(30);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- test/sources/normalize.test.ts` - Expected: FAIL, the four functions are not exported.

- [ ] **Step 4: Implement**

In `src/sources/normalize.ts`, extend the imports (`LinkedWallet`, `PnlSummary` from `../types`; `NansenPerpPositions`, `NansenBalance`, `NansenRelatedWallet`, `NansenPnlSummary` from `./nansen`) and append:

```typescript
export function normalizeNansenPositions(data: NansenPerpPositions): Position[] {
  return data.asset_positions.map(({ position: p }) => {
    const size = Number(p.size);
    return {
      coin: p.token_symbol,
      side: size >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(Number(p.position_value_usd)),
      entryPx: Number(p.entry_price_usd),
      leverage: p.leverage_value,
      liquidationPx: p.liquidation_price_usd === null ? null : Number(p.liquidation_price_usd),
      unrealizedPnlUsd: Number(p.unrealized_pnl_usd),
      cumFundingUsd: Number(p.cumulative_funding_since_open_usd),
    };
  });
}

export function normalizeNansenBalances(rows: NansenBalance[]): SpotHolding[] {
  return rows
    .filter((r) => r.value_usd > 0)
    .map((r) => ({ coin: r.token_symbol, valueUsd: r.value_usd, chain: r.chain }));
}

const SHARED_SERVICE_LABEL =
  /binance|coinbase|okx|bybit|kraken|bitfinex|kucoin|gate\.io|htx|huobi|mexc|bitget|crypto\.com|exchange|hot wallet|deposit|bridge|cex/i;

export function normalizeRelatedWallets(rows: NansenRelatedWallet[]): LinkedWallet[] {
  return rows.map((r) => ({
    address: r.address.toLowerCase(),
    relation: r.relation,
    chain: r.chain,
    // The label is read here only to decide whether following this link can
    // mean anything, and is dropped: Nansen's rules prohibit showing labels
    // publicly, and nothing downstream of this function ever sees one.
    isSharedService: r.address_label !== null && SHARED_SERVICE_LABEL.test(r.address_label),
  }));
}

export function normalizeNansenPnl(s: NansenPnlSummary, windowDays: number): PnlSummary {
  return {
    realizedPnlUsd: s.realized_pnl_usd,
    winRate: s.win_rate,
    closedTrades: s.closed_trade_count,
    windowDays,
  };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- test/sources/normalize.test.ts` - PASS. `npm run typecheck` - exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/sources/normalize.ts test/sources/normalize.test.ts
git commit -m "feat: normalize Nansen positions, balances, linked wallets and PnL"
```

---

## Task 3: Asset aliases seen in real data

**Files:**
- Modify: `src/engine/assets.ts`
- Modify: `test/engine/assets.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('spotHedgesPerp', ...)` block:

```typescript
  it('matches the wrapped and staked ETH seen in Abraxas funder balances', () => {
    for (const sym of ['AETHWETH', 'WEETH', 'WSTETH', 'RSETH']) {
      expect(spotHedgesPerp(sym, 'ETH')).toBe(true);
    }
  });

  it('does not match tokens that merely contain the ticker', () => {
    expect(spotHedgesPerp('ETHFI', 'ETH')).toBe(false);
    expect(spotHedgesPerp('HYPER', 'HYPE')).toBe(false);
  });
```

- [ ] **Step 2: Run to verify the first new test fails**

Run: `npm test -- test/engine/assets.test.ts` - Expected: FAIL on `AETHWETH`/`RSETH`; the substring test already passes (exact matching) and stays as a guard.

- [ ] **Step 3: Extend the table**

```typescript
const SPOT_ALIASES: Record<string, string[]> = {
  BTC: ['UBTC', 'WBTC', 'CBBTC', 'TBTC', 'BTCB', 'LBTC', 'AETHWBTC', 'AARBWBTC'],
  ETH: [
    'UETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH',
    // Seen in real Nansen balances (Abraxas funders, 18.09): Aave's aToken
    // for WETH and Kelp's restaked ETH. The rest of each family by name.
    'AETHWETH', 'AETHWSTETH', 'AETHWEETH', 'AARBWETH', 'RSETH', 'EZETH', 'METH', 'ETHX', 'OSETH',
  ],
  SOL: ['USOL', 'SOL', 'MSOL', 'JITOSOL'],
  HYPE: ['HYPE', 'WHYPE'],
};
```

- [ ] **Step 4: Run to verify they pass**, then **Step 5: Commit**

```bash
git add src/engine/assets.ts test/engine/assets.test.ts
git commit -m "feat: recognize Aave and restaked ETH wrappers seen in real balances"
```

---

## Task 4: Hedge only counts against a short, and the linked-wallet hedge

**Files:**
- Modify: `src/engine/features.ts`
- Modify: `test/engine/features.test.ts`
- Modify: `src/api/check.ts` (the one existing call of `computeHedgeFeatures`)

- [ ] **Step 1: Write the failing tests**

In `test/engine/features.test.ts`: every existing `computeHedgeFeatures(coin, notional, spot)` call becomes `computeHedgeFeatures(coin, 'short', notional, spot)` (the existing cases are shorts by construction). Add:

```typescript
  it('does not treat spot of the same asset as a hedge of a LONG perp', () => {
    const spot: SpotHolding[] = [{ coin: 'UBTC', valueUsd: 40_000_000 }];
    const result = computeHedgeFeatures('BTC', 'long', 190_000_000, spot);
    expect(result.hedgeUsd).toBe(0);
    expect(result.hedgeRatio).toBe(0);
  });
```

and a new block:

```typescript
describe('computeLinkedHedge', () => {
  const funder = (address: string, holdings: SpotHolding[], isSharedService = false) => ({
    wallet: { address, relation: 'First Funder', chain: 'ethereum', isSharedService },
    holdings,
  });

  it('sums matching holdings of linked wallets against a short', () => {
    const result = computeLinkedHedge('ETH', 'short', 100_000_000, [
      funder('0xa', [{ coin: 'WSTETH', valueUsd: 60_000_000, chain: 'ethereum' }, { coin: 'USDC', valueUsd: 9_000_000 }]),
      funder('0xb', [{ coin: 'AETHWETH', valueUsd: 20_000_000, chain: 'ethereum' }]),
    ]);
    expect(result.linkedHedgeUsd).toBe(80_000_000);
    expect(result.linkedHedgeRatio).toBeCloseTo(0.8, 6);
    expect(result.funders.map((f) => f.matchingUsd)).toEqual([60_000_000, 20_000_000]);
  });

  it('ignores shared-service wallets and long headlines', () => {
    const holdings = [{ coin: 'WETH', valueUsd: 50_000_000 }];
    expect(computeLinkedHedge('ETH', 'short', 100_000_000, [funder('0xa', holdings, true)]).linkedHedgeUsd).toBe(0);
    expect(computeLinkedHedge('ETH', 'long', 100_000_000, [funder('0xa', holdings)]).linkedHedgeUsd).toBe(0);
  });
});
```

Also add `headlineSide` to the `computePositionFeatures` expectations: the first test (`identifies the headline position...`) additionally expects `result.headlineSide).toBe('short')`, and the empty-account test expects `headlineSide` to be `null`. Import `computeLinkedHedge` alongside the others.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- test/engine/features.test.ts` - Expected: FAIL (new arity, `computeLinkedHedge` missing, `headlineSide` missing).

- [ ] **Step 3: Implement**

In `src/engine/features.ts`: add `headlineSide: PositionSide | null` to `PositionFeatures` (`null` for an empty account, `headline.side` otherwise; import `PositionSide` and `LinkedWallet` from `../types`). Replace `computeHedgeFeatures` and add `computeLinkedHedge`:

```typescript
/** Spot can offset only a short: holding the asset while also long the perp
 * is more of the same bet, not a hedge. */
export function computeHedgeFeatures(
  headlineCoin: string | null,
  headlineSide: PositionSide | null,
  headlineNotionalUsd: number,
  holdings: SpotHolding[],
): HedgeFeatures {
  if (headlineCoin === null || headlineSide !== 'short' || headlineNotionalUsd === 0) {
    return { hedgeUsd: 0, hedgeRatio: 0 };
  }
  const hedgeUsd = holdings
    .filter((h) => spotHedgesPerp(h.coin, headlineCoin))
    .reduce((sum, h) => sum + h.valueUsd, 0);
  return { hedgeUsd, hedgeRatio: hedgeUsd / headlineNotionalUsd };
}

export interface LinkedHedgeFeatures {
  linkedHedgeUsd: number;
  linkedHedgeRatio: number;
  funders: Array<{ address: string; relation: string; chain: string; matchingUsd: number }>;
}

/** Holdings of wallets linked by a funding transaction. Ownership through
 * such a link is inferred, not proven - the verdict layer treats this as a
 * separate, weaker kind of evidence than the account's own holdings. */
export function computeLinkedHedge(
  headlineCoin: string | null,
  headlineSide: PositionSide | null,
  headlineNotionalUsd: number,
  linked: Array<{ wallet: LinkedWallet; holdings: SpotHolding[] }>,
): LinkedHedgeFeatures {
  const followed = linked.filter((l) => !l.wallet.isSharedService);
  const funders = followed.map((l) => ({
    address: l.wallet.address,
    relation: l.wallet.relation,
    chain: l.wallet.chain,
    matchingUsd:
      headlineCoin === null || headlineSide !== 'short'
        ? 0
        : l.holdings.filter((h) => spotHedgesPerp(h.coin, headlineCoin)).reduce((s, h) => s + h.valueUsd, 0),
  }));
  const linkedHedgeUsd = funders.reduce((s, f) => s + f.matchingUsd, 0);
  return {
    linkedHedgeUsd,
    linkedHedgeRatio: headlineNotionalUsd > 0 ? linkedHedgeUsd / headlineNotionalUsd : 0,
    funders,
  };
}
```

In `src/api/check.ts`, the existing call becomes `computeHedgeFeatures(positionFeatures.headlineCoin, positionFeatures.headlineSide, positionFeatures.headlineNotionalUsd, spotHoldings)` (Task 6 replaces this file's body; this keeps it compiling between commits).

- [ ] **Step 4: Run** `npm test` (all files) and `npm run typecheck` - both clean. **Step 5: Commit**

```bash
git add src/engine/features.ts test/engine/features.test.ts src/api/check.ts
git commit -m "fix: spot hedges only a short; add the linked-wallet hedge feature"
```

---

## Task 5: Verdict - a probable hedge through linked wallets

**Files:**
- Modify: `src/engine/verdict.ts`
- Modify: `test/engine/verdict.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
  it('calls it a probable hedge when linked wallets cover the short and the account itself does not', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 14, netToGross: 1, headlineShare: 0.44, headlineCoin: 'ETH', headlineSide: 'short', headlineNotionalUsd: 177_500_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeRatio: 0 }),
      linkedHedge: { linkedHedgeRatio: 2.25 },
    });
    expect(result.verdict).toBe('hedged');
    expect(result.strength).toBe('probable');
    expect(result.reasons).toEqual(['linked_wallet_hedge']);
  });

  it('does not call a concentrated account a bet when linked wallets partly hedge it', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'BTC', headlineSide: 'short', headlineNotionalUsd: 10_000_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeRatio: 0 }),
      linkedHedge: { linkedHedgeRatio: 0.2 },
    });
    expect(result.verdict).toBe('unknown');
  });
```

(`headlineSide` now exists on `PositionFeatures`; add `headlineSide: null` to the `positions()` helper defaults.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** - in `src/engine/verdict.ts`:

1. Rename `BookStrength` to `VerdictStrength = 'likely' | 'strong' | 'probable' | null` (`strength` on `VerdictResult` uses it; `likely`/`strong` stay book-only, `probable` is hedge-via-link only).
2. Add `linkedHedge?: { linkedHedgeRatio: number }` to `VerdictInput`.
3. After the existing hedged block, before the bet block:

```typescript
  const linkedRatio = input.linkedHedge?.linkedHedgeRatio ?? 0;
  if (input.hedge.hedgeRatio + linkedRatio >= h.minHedgeRatio) {
    return { verdict: 'hedged', strength: 'probable', reasons: ['linked_wallet_hedge'] };
  }
```

4. In the bet condition, `input.hedge.hedgeRatio < b.maxHedgeRatio` becomes `input.hedge.hedgeRatio + linkedRatio < b.maxHedgeRatio`.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. **Step 5: Commit**

```bash
git add src/engine/verdict.ts test/engine/verdict.test.ts
git commit -m "feat: probable hedge verdict when linked wallets cover a short"
```

---

## Task 6: checkAddress with Nansen as the primary source

**Files:**
- Modify: `scripts/fetch-nansen-fixtures.ts` (two new captures)
- Create: `test/fixtures/hyperliquid/abraxas/*.json` (free captures)
- Modify: `src/api/check.ts`
- Create: `test/api/check.test.ts`
- Modify: `src/index.ts` (call site only)

- [ ] **Step 1: Capture the missing fixtures**

Nansen (2 credits, same request shapes as the existing captures): add `perp-positions-abraxas` (`profiler/perp-positions`, `{ address: ABRAXAS }`) and `perp-pnl-summary-abraxas` (`profiler/perp-pnl-summary`, 30-day window) to `CALLS`, then:

```bash
npx tsx scripts/fetch-nansen-fixtures.ts --only=perp-positions-abraxas,perp-pnl-summary-abraxas
```

Hyperliquid (free): save `clearinghouseState`, `frontendOpenOrders`, `spotClearinghouseState` and `userFillsByTime` (last 24h) for the Abraxas address into `test/fixtures/hyperliquid/abraxas/` with a one-off `node -e` fetch, the same way `fills-24h.json` was captured.

Read the new positions fixture before writing the test: note the headline coin and side. The expectation below assumes an ETH short is still the headline, as on 17.09; if the live account changed, recompute the expectation from the fixture and say so in the commit message.

- [ ] **Step 2: Write the failing test** - `test/api/check.test.ts` routes every `fetch` to a fixture (Hyperliquid by `type`, Nansen by `path|address|chain`) and runs the whole pipeline offline:

```typescript
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { createNansenClient } from '../../src/sources/nansen';
// ...imports of every fixture listed in the routes below

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const FUNDER_ARB = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';

function route(hl: Record<string, unknown>, nansen: Record<string, unknown>) {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (u.includes('api.hyperliquid.xyz')) {
      if (!(body.type in hl)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(hl[body.type]), { status: 200 });
    }
    const key = `${u.split('/api/v1/')[1]}|${String(body.address).toLowerCase()}|${body.chain ?? ''}`;
    if (!(key in nansen)) throw new Error(`unrouted Nansen ${key}`);
    return new Response(JSON.stringify(nansen[key]), { status: 200, headers: { 'x-nansen-credits-cost': '1' } });
  }) as unknown as typeof fetch;
}

describe('checkAddress (offline, real fixtures)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('finds the Abraxas hedge through its funders', async () => {
    route(
      { clearinghouseState: abxClearinghouse, frontendOpenOrders: abxOrders, spotClearinghouseState: abxSpot,
        spotMetaAndAssetCtxs: spotMeta, metaAndAssetCtxs: perpMeta, userFillsByTime: abxFills },
      {
        [`profiler/perp-positions|${ABRAXAS}|`]: abxPositions,
        [`profiler/perp-pnl-summary|${ABRAXAS}|`]: abxPnl,
        [`profiler/address/current-balance|${ABRAXAS}|all`]: abxBalances,
        [`profiler/address/related-wallets|${ABRAXAS}|arbitrum`]: abxRelArb,
        [`profiler/address/related-wallets|${ABRAXAS}|ethereum`]: abxRelEth,
        [`profiler/address/current-balance|${FUNDER_ARB}|all`]: funderArbBalances,
        [`profiler/address/current-balance|${FUNDER_ETH}|all`]: funderEthBalances,
      },
    );
    let calls = 0;
    const result = await checkAddress(ABRAXAS, { nansen: createNansenClient('k', () => { calls++; }) });
    expect(result.source).toBe('nansen');
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.strength).toBe('probable');
    expect(result.linkedHedge?.funders.length).toBe(2);
    expect(result.linkedHedge?.linkedHedgeRatio).toBeGreaterThan(2);
    expect(calls).toBe(7);
  });

  it('falls back to Hyperliquid positions and says so when Nansen positions fail', async () => {
    // same routes, minus the perp-positions entry: the router throws for it,
    // which the client turns into a failed call
    // ...
    // expect(result.source).toBe('hyperliquid');
    // expect(result.coverage.some((c) => c.includes('main dex'))).toBe(true);
  });

  it('runs Hyperliquid-only when no Nansen client is given', async () => {
    // expect(result.source).toBe('hyperliquid'); expect(result.linkedHedge).toBeNull(); expect(result.pnl).toBeNull();
  });
});
```

The two shorter tests reuse the same `route(...)` call with the named entry removed (second test) or with no Nansen client (third); write them out in full in the file - they are elided here only because they repeat the first test's routes.

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Implement** `src/api/check.ts`:

```typescript
// imports: the Hyperliquid getters (including getClearinghouseState), all
// normalizers, all feature functions including computeLinkedHedge,
// computeVerdict, and the NansenClient type.

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;

export interface CheckOptions {
  nansen: NansenClient | null;
  now?: () => number;
}

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  linkedHedge: LinkedHedgeFeatures | null;
  trades: TradeFeatures;
  pnl: PnlSummary | null;
  sizeVsOi: number | null;
  source: 'nansen' | 'hyperliquid';
  /** Plain-language notes on anything that could not be read. */
  coverage: string[];
  checkedAt: string;
}

export async function checkAddress(address: string, opts: CheckOptions): Promise<CheckResult> {
  const now = (opts.now ?? Date.now)();
  const day = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const coverage: string[] = [];
  const nansen = opts.nansen;

  const [rawOrders, spotBalances, spotMetaPair, perpMetaPair, rawFills] = await Promise.all([
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getPerpMetaAndAssetCtxs(),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now),
  ]);

  let source: CheckResult['source'] = 'hyperliquid';
  let positions: Position[] | null = null;
  let pnl: PnlSummary | null = null;
  let ownChain: SpotHolding[] = [];
  let links: LinkedWallet[] = [];

  if (nansen) {
    const [pos, pnlRes, bal, relArb, relEth] = await Promise.allSettled([
      nansen.perpPositions(address),
      nansen.perpPnlSummary(address, day(PNL_WINDOW_DAYS), day(0)),
      nansen.currentBalance(address),
      nansen.relatedWallets(address, 'arbitrum'),
      nansen.relatedWallets(address, 'ethereum'),
    ]);
    if (pos.status === 'fulfilled') {
      positions = normalizeNansenPositions(pos.value);
      source = 'nansen';
    } else {
      coverage.push('Nansen positions unavailable: positions read from Hyperliquid, main dex only');
    }
    if (pnlRes.status === 'fulfilled') pnl = normalizeNansenPnl(pnlRes.value, PNL_WINDOW_DAYS);
    else coverage.push('Realized PnL unavailable');
    if (bal.status === 'fulfilled') {
      ownChain = normalizeNansenBalances(bal.value.rows);
      if (!bal.value.complete) coverage.push('Holdings on other chains: first 100 tokens only');
    } else coverage.push('Holdings on other chains unavailable');
    for (const r of [relArb, relEth]) {
      if (r.status === 'fulfilled') links.push(...normalizeRelatedWallets(r.value));
      else coverage.push('Linked wallets unavailable on one chain');
    }
  } else {
    coverage.push('Nansen not used: main-dex positions only, no other chains, no linked wallets');
  }
  if (positions === null) positions = normalizePositions(await getClearinghouseState(address));

  const positionFeatures = computePositionFeatures(positions);
  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));
  const [spotMeta, spotAssetCtxs] = spotMetaPair;
  const hlSpot = normalizeSpotHoldings(spotBalances.balances, buildSpotPriceIndex(spotMeta, spotAssetCtxs));
  const hedgeFeatures = computeHedgeFeatures(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    [...hlSpot, ...ownChain],
  );

  // Funders are worth a credit each only when they could change the answer:
  // the headline is a short and the account does not already hedge it.
  let linkedHedge: LinkedHedgeFeatures | null = null;
  if (nansen) {
    const firstFunders = links.filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase());
    const skipped = firstFunders.filter((w) => w.isSharedService).length;
    if (skipped > 0) coverage.push(`${skipped} funding link(s) lead to an exchange or bridge and were not followed`);
    const candidates = firstFunders
      .filter((w) => !w.isSharedService)
      .filter((w, i, all) => all.findIndex((x) => x.address === w.address) === i)
      .slice(0, MAX_FUNDERS);
    const worthIt = positionFeatures.headlineSide === 'short' && hedgeFeatures.hedgeRatio < 0.5 && candidates.length > 0;
    if (worthIt) {
      const balances = await Promise.allSettled(candidates.map((w) => nansen.currentBalance(w.address)));
      const linked = candidates.flatMap((wallet, i) => {
        const b = balances[i];
        if (b.status === 'fulfilled') return [{ wallet, holdings: normalizeNansenBalances(b.value.rows) }];
        coverage.push('One linked wallet could not be read');
        return [];
      });
      linkedHedge = computeLinkedHedge(
        positionFeatures.headlineCoin,
        positionFeatures.headlineSide,
        positionFeatures.headlineNotionalUsd,
        linked,
      );
    }
  }

  const tradeFeatures = computeTradeFeatures(normalizeTrades(rawFills), TRADES_WINDOW_HOURS);
  const [perpMeta, perpAssetCtxs] = perpMetaPair;
  const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
  const openInterestUsd =
    headlineIndex >= 0 ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx) : 0;
  if (headlineIndex < 0 && positionFeatures.headlineCoin?.includes(':')) {
    coverage.push('Size versus open interest not computed for a HIP-3 dex market');
  }

  const verdict = computeVerdict({
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: { tradesPerDay: tradeFeatures.tradesPerDay, crossedShare: tradeFeatures.crossedShare },
    linkedHedge: linkedHedge ? { linkedHedgeRatio: linkedHedge.linkedHedgeRatio } : undefined,
  });

  return {
    address,
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    linkedHedge,
    trades: tradeFeatures,
    pnl,
    sizeVsOi: computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd),
    source,
    coverage,
    checkedAt: new Date(now).toISOString(),
  };
}
```

In `src/index.ts` the only change in this task is the call: `checkAddress(address, { nansen: null })` (Task 7 wires the real client).

- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. **Step 6: Commit**

```bash
git add scripts/fetch-nansen-fixtures.ts test/fixtures src/api/check.ts test/api/check.test.ts src/index.ts data/nansen-calls.jsonl
git commit -m "feat: Nansen-first checkAddress with per-source fallback and funder lookup"
```

---

## Task 7: Worker wiring - key, credit ledger, daily cap, KV that fails soft

**Files:**
- Create: `src/credits.ts`, `test/credits.test.ts`
- Create: `src/safeKv.ts`, `test/safeKv.test.ts`
- Modify: `src/index.ts`, `wrangler.toml`

Why KV must fail soft: Workers KV on the free plan allows 1 000 writes a day. The rate limiter writes on every request, the cache on every miss. When the quota runs out, `put` throws, and today that exception would turn every check into an error. A guard is an abuse guard, not a single point of failure.

- [ ] **Step 1: Failing tests** - `test/safeKv.test.ts`: a `FakeKV` subclass whose `get`/`put` throw; `safeKv(throwing).get('k')` resolves `null`, `safeKv(throwing).put(...)` resolves without throwing. `test/credits.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { recordCalls, nansenAllowed } from '../src/credits';

describe('credits', () => {
  it('accumulates one day of calls in a single KV entry', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-18', [
      { path: 'a', status: 200, creditsCost: 1, creditsRemaining: 990 },
      { path: 'b', status: 200, creditsCost: 1, creditsRemaining: 989 },
    ]);
    await recordCalls(kv, '2026-09-18', [{ path: 'c', status: 200, creditsCost: 1, creditsRemaining: 988 }]);
    const day = JSON.parse((await kv.get('nansen:day:2026-09-18'))!);
    expect(day).toEqual({ calls: 3, credits: 3, lastRemaining: 988 });
  });

  it('refuses Nansen once the daily cap or the remaining-credit floor is reached', async () => {
    const kv = new FakeKV();
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(true);
    await kv.put('nansen:day:2026-09-18', JSON.stringify({ calls: 300, credits: 300, lastRemaining: 600 }));
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(false);
    await kv.put('nansen:day:2026-09-18', JSON.stringify({ calls: 10, credits: 10, lastRemaining: 5 }));
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

```typescript
// src/safeKv.ts
import type { KVLike } from './kv';

/** Wraps KV so a quota or outage error degrades to "not cached / not
 * limited" instead of failing the request. Errors are logged, not thrown. */
export function safeKv(kv: KVLike): KVLike {
  return {
    async get(key) {
      try {
        return await kv.get(key);
      } catch (err) {
        console.error('kv get failed', key, err);
        return null;
      }
    },
    async put(key, value, options) {
      try {
        await kv.put(key, value, options);
      } catch (err) {
        console.error('kv put failed', key, err);
      }
    },
  };
}
```

```typescript
// src/credits.ts
import type { KVLike } from './kv';
import type { NansenCallMeta } from './sources/nansen';

interface DayStats {
  calls: number;
  credits: number;
  lastRemaining: number | null;
}

const dayKey = (day: string) => `nansen:day:${day}`;

async function readDay(kv: KVLike, day: string): Promise<DayStats> {
  const raw = await kv.get(dayKey(day));
  return raw ? (JSON.parse(raw) as DayStats) : { calls: 0, credits: 0, lastRemaining: null };
}

/** One read-modify-write per request, not per call: KV free tier allows 1 000
 * writes a day. Approximate under concurrency, like the rate limiter. */
export async function recordCalls(kv: KVLike, day: string, calls: NansenCallMeta[]): Promise<void> {
  if (calls.length === 0) return;
  const stats = await readDay(kv, day);
  stats.calls += calls.length;
  stats.credits += calls.reduce((s, c) => s + (c.creditsCost ?? 1), 0);
  const last = [...calls].reverse().find((c) => c.creditsRemaining !== null);
  if (last) stats.lastRemaining = last.creditsRemaining;
  await kv.put(dayKey(day), JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 40 });
}

export async function nansenAllowed(kv: KVLike, day: string, dailyCap: number, floor: number): Promise<boolean> {
  const stats = await readDay(kv, day);
  if (stats.credits >= dailyCap) return false;
  if (stats.lastRemaining !== null && stats.lastRemaining <= floor) return false;
  return true;
}
```

`recordCalls` counts a missing cost header as 1 credit - the conservative direction for a spend cap.

`wrangler.toml` gains:

```toml
[vars]
NANSEN_DAILY_CREDIT_CAP = "300"
NANSEN_CREDIT_FLOOR = "5"
```

`src/index.ts`: `Env` gains `NANSEN_API_KEY?: string; NANSEN_DAILY_CREDIT_CAP: string; NANSEN_CREDIT_FLOOR: string`. Wrap `env.KV` once with `safeKv` and use the wrapped value for the limiter, the cache and the credits. In the `/api/check` branch, inside the cache producer:

```typescript
const day = new Date().toISOString().slice(0, 10);
const calls: NansenCallMeta[] = [];
const useNansen =
  !!env.NANSEN_API_KEY &&
  (await nansenAllowed(kv, day, Number(env.NANSEN_DAILY_CREDIT_CAP), Number(env.NANSEN_CREDIT_FLOOR)));
const nansen = useNansen ? createNansenClient(env.NANSEN_API_KEY!, (m) => { calls.push(m); }) : null;
try {
  return await checkAddress(address, { nansen });
} finally {
  await recordCalls(kv, day, calls);
}
```

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`. **Step 5: Commit**

```bash
git add src/safeKv.ts src/credits.ts test/safeKv.test.ts test/credits.test.ts src/index.ts wrangler.toml
git commit -m "feat: wire the Nansen key with a daily credit cap; KV errors degrade instead of failing"
```

---

## Task 8: Live smoke and recalibration (about 19 credits)

**Files:**
- Modify: `docs/wiki/calibration.md`

- [ ] **Step 1:** `npm run dev` in the background (it reads `NANSEN_API_KEY` from `.dev.vars`). Check the three calibration addresses once each with `curl "http://127.0.0.1:8787/api/check?address=..."`. Read each response: `source` must be `nansen`, `coverage` should be empty or name exactly what is missing.

- [ ] **Step 2:** Read the spend from the Worker's own ledger: `curl -s "http://127.0.0.1:8787/cdn-cgi/local/explorer/api/storage/kv/namespaces/placeholder-local-dev-id/values/nansen:day:$(date -u +%F)"` (path per the local explorer's OpenAPI; list keys first if it differs). Expected: about 17-19 calls, 1 credit each.

- [ ] **Step 3:** Append to `docs/wiki/calibration.md` a dated section "after Nansen": the three verdicts before/after, positions counted by Nansen versus Hyperliquid, the Abraxas linked-hedge breakdown by funder, and the credits this task spent. Stop the dev server (this project's process tree only).

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/calibration.md
git commit -m "docs: recalibrate against Nansen - HIP-3 positions, PnL, linked-wallet hedge"
```

---

## Self-review notes

- **Spec coverage:** section 3's hedge and linked-wallet rows, section 4 rules 1-2 (failed source named, fallback labeled), 5 (coverage notes), 6 (labels never shown: dropped inside `normalizeRelatedWallets`), section 5's endpoint table (perp-trades removed with the reason above), section 6's credit cap. Phase 2b covers the page, the card, the gallery and the ledger endpoint.
- **Placeholder scan:** the two shorter tests in Task 6 are described rather than written out because they reuse the first test's route table verbatim; the step says to write them in full.
- **Type consistency:** `NansenCallMeta` (Task 1) is consumed by `credits.ts` (Task 7); `LinkedWallet`/`PnlSummary` (Task 2) by features (Task 4) and `check.ts` (Task 6); `headlineSide` (Task 4) by the verdict tests (Task 5) and `check.ts` (Task 6); `VerdictStrength` replaces `BookStrength` everywhere it was imported (only `verdict.ts` and via `VerdictResult`).
- **Budget:** Task 6 Step 1 spends 2 credits, Task 8 about 19. After this plan: about 974 credits left, all of it for the gallery in Phase 2b, which stops when the `X-Nansen-Credits-Remaining` header reaches the floor.
