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

/** Two-sided quotes on the xyz dex, which frontendOpenOrders does not return
 * unless it is asked for that dex by name. */
const HIP3_ORDERS: Record<string, unknown[]> = {
  xyz: [
    { coin: 'xyz:SP500', side: 'B', sz: '10', limitPx: '5000', isTrigger: false, oid: 1, timestamp: 0 },
    { coin: 'xyz:SP500', side: 'A', sz: '10', limitPx: '5100', isTrigger: false, oid: 2, timestamp: 0 },
  ],
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
      // Orders on a named HIP-3 dex are a separate request with its own answer.
      if (body.type === 'frontendOpenOrders' && body.dex) {
        return new Response(JSON.stringify(HIP3_ORDERS[String(body.dex)] ?? []), { status: 200 });
      }
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
function fakeNansen(opts: {
  positions: NansenPerpPositions;
  balances?: NansenBalance[];
  balancesComplete?: boolean;
  balancesFail?: boolean;
}) {
  return {
    perpPositions: vi.fn(async () => opts.positions),
    perpPnlSummary: vi.fn(async () => abxPnl.data as unknown as NansenPnlSummary),
    currentBalance: vi.fn(async () => {
      if (opts.balancesFail) throw new Error('current-balance unavailable');
      return { rows: opts.balances ?? [], complete: opts.balancesComplete ?? true };
    }),
    relatedWallets: vi.fn(async () => ({ rows: [] as NansenRelatedWallet[], complete: true })),
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

/** Canonical WETH on Ethereum: the holdings model judges a balance by its
 * contract, so a placeholder address is now correctly not counted as ETH. */
const WETH_ETHEREUM = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

function balanceRow(symbol: string, valueUsd: number, tokenAddress = WETH_ETHEREUM): NansenBalance {
  return {
    chain: 'ethereum',
    address: ABRAXAS,
    token_address: tokenAddress,
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

  it('does not turn the wallets that funded Abraxas into its hedge', async () => {
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
    // Nansen sends address_label: null for both funders, so nothing here says
    // these wallets belong to Abraxas rather than to an exchange.
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['linked_exposure_unverified']);
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    expect(result.linkedHedge?.linkedHedgeRatio).toBeGreaterThan(2);
    expect(result.pnl?.realizedPnlUsd).toBeLessThan(0);
    expect(calls.length).toBe(7);
    expect(result.coverage).toEqual([
      '2 funding wallets carry no Nansen label: whether they are private wallets or exchange addresses is unverified',
    ]);
    expect(result.summary).toMatch(/^Less than 1% of the \$[\d.]+M ETH short is covered by ETH in this account\./);
    expect(result.summary).toContain('funding does not establish ownership');
    expect(result.evidence.find((e) => e.label === 'Hedge found')?.value).toBe('0.0% (all chains)');
    expect(result.evidence.find((e) => e.label === 'Linked wallets')?.value).toMatch(/owner unconfirmed$/);
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
      balances: [balanceRow('WETH', 95_000_000)],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.reasons).toEqual(['hedge_leg']);
    expect(result.hedgeScope).toBe('all-chains');
    expect(nansen.currentBalance).toHaveBeenCalledTimes(1);
    expect(nansen.relatedWallets).not.toHaveBeenCalled();
  });

  it('falls back to Hyperliquid when Nansen answers 200 with the wrong shape', async () => {
    route();
    const nansen = {
      ...fakeNansen({ positions: syntheticPositions([]) }),
      // A 200 is not a contract. This used to throw a TypeError on .map
      // outside the rejected branch, so the fallback never ran.
      perpPositions: vi.fn(async () => ({}) as unknown as NansenPerpPositions),
    };
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.source).toBe('hyperliquid');
    expect(result.positions.nPositions).toBe(14);
    expect(result.coverage.some((c) => c.includes('unexpected shape'))).toBe(true);
  });

  it('falls back when a number in the Nansen answer is not a number', async () => {
    route();
    const broken = syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]);
    broken.asset_positions[0].position.position_value_usd = 'not a number';
    const nansen = { ...fakeNansen({ positions: syntheticPositions([]) }), perpPositions: vi.fn(async () => broken) };
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.source).toBe('hyperliquid');
    expect(result.coverage.some((c) => c.includes('unexpected shape'))).toBe(true);
  });

  it('reads resting orders on every dex the account has a position on', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'xyz:SP500', size: -100, valueUsd: 38_000_000 }]),
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    // Without asking the xyz dex by name, this account looks like it quotes
    // nothing at all, which is one of the conditions for calling it a bet.
    expect(result.orders.coinsBothSides).toBe(1);
    expect(result.coverage.some((c) => c.includes('xyz'))).toBe(false);
  });

  it('says so when a HIP-3 dex will not answer for its orders', async () => {
    route();
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'frontendOpenOrders' && body.dex) return new Response('nope', { status: 500 });
      return (realFetch as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'xyz:SP500', size: -100, valueUsd: 38_000_000 }]),
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.coverage).toContain('Resting orders on the xyz dex could not be read');
  });

  it('does not count a token that only calls itself WETH, and says so', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [balanceRow('WETH', 95_000_000, '0x' + 'de'.repeat(20))],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.coverage).toContain(
      '$95.0M of holdings named like ETH were left out: their contract is not one this tool recognises',
    );
    expect(result.verdict.verdict).not.toBe('hedged');
  });

  it('counts an Aave deposit as a hedge but says the loan against it is invisible', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      // The real aEthWETH contract, seen in the Abraxas funder balances.
      balances: [balanceRow('AETHWETH', 95_000_000, '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8')],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.coverage).toContain(
      '$95.0M of the matching assets is a lending-market deposit; anything borrowed against it does not show here',
    );
  });

  it('calls a 60%-covered short partly offset, and still spends nothing on funders', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [balanceRow('WETH', 60_000_000)],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['partial_offset']);
    // The account's own holdings already explain more than half of it, so
    // the wallets that funded it are not worth a credit.
    expect(nansen.relatedWallets).not.toHaveBeenCalled();
  });

  it('still calls a short a bet when the hedge was checked in full and found nothing', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [],
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.verdict.verdict).toBe('looks_like_a_bet');
  });

  it('does not call a short a bet when the hedge read failed', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balancesFail: true,
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.hedgeCoverage).toBe('missing');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
    expect(result.summary).toContain('could not be checked');
  });

  it('does not call a short a bet when only the first page of holdings was read', async () => {
    route();
    const nansen = fakeNansen({
      positions: syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [],
      balancesComplete: false,
    });
    const result = await checkAddress(ABRAXAS, { nansen });
    expect(result.hedgeCoverage).toBe('partial');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
  });

  it('does not call a short a bet from Hyperliquid spot alone', async () => {
    route();
    const result = await checkAddress(ABRAXAS, { nansen: null });
    // Abraxas is short ETH and holds no ETH on Hyperliquid; without the other
    // chains that is a gap in the reading, not an absence of a hedge.
    expect(result.positions.headlineSide).toBe('short');
    expect(result.hedgeCoverage).toBe('partial');
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('runs Hyperliquid-only when no Nansen client is given', async () => {
    route();
    const result = await checkAddress(ABRAXAS, { nansen: null });
    expect(result.source).toBe('hyperliquid');
    expect(result.linkedHedge).toBeNull();
    expect(result.pnl).toBeNull();
    expect(result.coverage.some((c) => c.startsWith('Nansen not used'))).toBe(true);
  });

  it('names why Nansen was not used when the caller says so', async () => {
    route();
    const result = await checkAddress(ABRAXAS, { nansen: null, nansenOffReason: "today's Nansen credits are used up" });
    expect(result.coverage[0]).toBe(
      "Nansen not used (today's Nansen credits are used up): main-dex positions only, no other chains, no linked wallets",
    );
  });
});
