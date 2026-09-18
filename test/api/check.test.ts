import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import {
  createNansenClient,
  type NansenCallMeta,
  type NansenClient,
  type NansenPerpPositions,
  type NansenPnlSummary,
  type NansenBalance,
  type NansenRelatedWallet,
} from '../../src/sources/nansen';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxPositions from '../fixtures/nansen/perp-positions-abraxas.json';
import abxPnl from '../fixtures/nansen/perp-pnl-summary-abraxas.json';
import abxBalances from '../fixtures/nansen/current-balance-abraxas-all.json';
import abxRelArb from '../fixtures/nansen/related-wallets-abraxas-arbitrum.json';
import abxRelEth from '../fixtures/nansen/related-wallets-abraxas-ethereum.json';
import funderArbBalances from '../fixtures/nansen/current-balance-abraxas-funder-all.json';
import funderEthBalances from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const FUNDER_ARB = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';

const HL_ROUTES: Record<string, unknown> = {
  clearinghouseState: abxClearinghouse,
  frontendOpenOrders: abxOrders,
  spotClearinghouseState: abxSpot,
  spotMetaAndAssetCtxs: spotMeta,
  metaAndAssetCtxs: perpMeta,
  userFillsByTime: abxFills,
};

const NANSEN_ROUTES: Record<string, unknown> = {
  [`profiler/perp-positions|${ABRAXAS}|`]: abxPositions,
  [`profiler/perp-pnl-summary|${ABRAXAS}|`]: abxPnl,
  [`profiler/address/current-balance|${ABRAXAS}|all`]: abxBalances,
  [`profiler/address/related-wallets|${ABRAXAS}|arbitrum`]: abxRelArb,
  [`profiler/address/related-wallets|${ABRAXAS}|ethereum`]: abxRelEth,
  [`profiler/address/current-balance|${FUNDER_ARB}|all`]: funderArbBalances,
  [`profiler/address/current-balance|${FUNDER_ETH}|all`]: funderEthBalances,
};

/** Routes every fetch to a captured fixture. Nansen keys listed in
 * `failNansen` answer HTTP 500; anything unrouted throws, so a request the
 * code was not expected to make fails the test loudly. */
function route(failNansen: string[] = []) {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (u.includes('api.hyperliquid.xyz')) {
      if (!(body.type in HL_ROUTES)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(HL_ROUTES[body.type]), { status: 200 });
    }
    const key = `${u.split('/api/v1/')[1]}|${String(body.address).toLowerCase()}|${body.chain ?? ''}`;
    if (failNansen.includes(key)) {
      return new Response('{}', { status: 500, headers: { 'x-nansen-credits-cost': '0' } });
    }
    if (!(key in NANSEN_ROUTES)) throw new Error(`unrouted Nansen ${key}`);
    return new Response(JSON.stringify(NANSEN_ROUTES[key]), { status: 200, headers: { 'x-nansen-credits-cost': '1' } });
  }) as unknown as typeof fetch;
}

/** A client that answers from memory and counts calls per method - for
 * asserting which reads a check skips, not what Nansen returns. */
function fakeNansen(opts: { positions: NansenPerpPositions; balances?: NansenBalance[] }) {
  return {
    perpPositions: vi.fn(async () => opts.positions),
    perpPnlSummary: vi.fn(async () => abxPnl.data as unknown as NansenPnlSummary),
    currentBalance: vi.fn(async () => ({ rows: opts.balances ?? [], complete: true })),
    relatedWallets: vi.fn(async () => [] as NansenRelatedWallet[]),
  } satisfies NansenClient;
}

function syntheticPositions(list: Array<{ coin: string; size: number; valueUsd: number }>): NansenPerpPositions {
  return {
    asset_positions: list.map((p) => ({
      position: {
        token_symbol: p.coin,
        size: String(p.size),
        position_value_usd: String(p.valueUsd),
        entry_price_usd: '100',
        liquidation_price_usd: null,
        leverage_value: 5,
        leverage_type: 'cross',
        margin_used_usd: '0',
        unrealized_pnl_usd: '0',
        cumulative_funding_since_open_usd: '0',
        return_on_equity: '0',
      },
      position_type: 'oneWay',
    })),
    margin_summary_account_value_usd: '0',
    withdrawable_usd: '0',
    timestamp: 0,
  };
}

function balanceRow(symbol: string, valueUsd: number): NansenBalance {
  return {
    chain: 'ethereum',
    address: ABRAXAS,
    token_address: '0x0',
    token_symbol: symbol,
    token_name: symbol,
    token_amount: 1,
    price_usd: valueUsd,
    value_usd: valueUsd,
  };
}

describe('checkAddress (offline, real fixtures)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('finds the Abraxas hedge through its funders', async () => {
    route();
    const calls: NansenCallMeta[] = [];
    const result = await checkAddress(ABRAXAS, {
      nansen: createNansenClient('k', (m) => {
        calls.push(m);
      }),
    });
    expect(result.source).toBe('nansen');
    expect(result.positions.nPositions).toBe(17);
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.positions.headlineSide).toBe('short');
    expect(result.hedge.hedgeRatio).toBeLessThan(0.01);
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.strength).toBe('probable');
    expect(result.verdict.reasons).toEqual(['linked_wallet_hedge']);
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    expect(result.linkedHedge?.linkedHedgeRatio).toBeGreaterThan(2);
    expect(result.pnl?.realizedPnlUsd).toBeLessThan(0);
    expect(calls.length).toBe(7);
    expect(result.coverage).toEqual([]);
    expect(result.summary).toMatch(/ETH short is \d+% covered by ETH held in 2 wallets that funded this account/);
    expect(result.summary).toContain('Ownership is inferred from the funding link, not confirmed.');
    expect(result.evidence.find((e) => e.label === 'Hedge found')?.value).toMatch(/via 2 funding wallets$/);
  });

  it('falls back to Hyperliquid positions and says so when Nansen positions fail', async () => {
    route([`profiler/perp-positions|${ABRAXAS}|`]);
    const result = await checkAddress(ABRAXAS, { nansen: createNansenClient('k') });
    expect(result.source).toBe('hyperliquid');
    expect(result.positions.nPositions).toBe(14);
    expect(result.coverage.some((c) => c.includes('main dex'))).toBe(true);
  });

  it('reads nothing past positions and PnL for a book', async () => {
    route();
    // Thirty offsetting positions fire book rule (а) on positions alone. Not
    // Wintermute's real set: its Nansen net/gross is 0.80, and what makes it a
    // book live is its orders and fills, which these Abraxas fixtures lack.
    const offsetting = Array.from({ length: 30 }, (_, i) => ({
      coin: `C${i}`,
      size: i % 2 === 0 ? 10 : -10,
      valueUsd: 1_000_000,
    }));
    const nansen = fakeNansen({ positions: syntheticPositions(offsetting) });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.verdict.verdict).toBe('book');
    expect(nansen.perpPositions).toHaveBeenCalledTimes(1);
    expect(nansen.perpPnlSummary).toHaveBeenCalledTimes(1);
    expect(nansen.currentBalance).not.toHaveBeenCalled();
    expect(nansen.relatedWallets).not.toHaveBeenCalled();
  });

  it('reads nothing past positions and PnL when the headline is a long', async () => {
    route();
    const nansen = fakeNansen({ positions: syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }]) });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.positions.headlineSide).toBe('long');
    expect(result.hedgeScope).toBe('none');
    expect(nansen.currentBalance).not.toHaveBeenCalled();
    expect(nansen.relatedWallets).not.toHaveBeenCalled();
  });

  it('stops after own balances when they already hedge the short', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [balanceRow('WETH', 60_000_000)],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.reasons).toEqual(['hedge_leg']);
    expect(result.hedgeScope).toBe('all-chains');
    expect(nansen.currentBalance).toHaveBeenCalledTimes(1);
    expect(nansen.relatedWallets).not.toHaveBeenCalled();
  });

  it('runs Hyperliquid-only when no Nansen client is given', async () => {
    route();
    const result = await checkAddress(ABRAXAS, { nansen: null });
    expect(result.source).toBe('hyperliquid');
    expect(result.linkedHedge).toBeNull();
    expect(result.pnl).toBeNull();
    expect(result.coverage.some((c) => c.startsWith('Nansen not used'))).toBe(true);
  });
});
