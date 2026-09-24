// 23.09 audit, "structure and range checks": a check fed an answer that is
// not what the source promises. A wrong row is left out, counted, and lowers
// what the reading claims; a wrong envelope fails the check the way a failed
// request does; and a loan Hyperliquid reports is said rather than lost.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { UpstreamShapeError } from '../../src/sources/normalize';
import type { NansenClient, NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from '../../src/sources/nansen';
import marginSpot from '../fixtures/hyperliquid/spot-balances-portfolio-margin.json';

const ADDRESS = '0x1111111111111111111111111111111111111111';

/** HYPE at $45 against USDC, and nothing else listed. */
const HYPE_MARKET = [
  {
    tokens: [
      { name: 'USDC', index: 0 },
      { name: 'HYPE', index: 150 },
    ],
    universe: [{ name: '@107', tokens: [150, 0], index: 107 }],
  },
  [{ coin: '@107', markPx: '45.0' }],
];

const QUIET: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: HYPE_MARKET,
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

function route(answers: Record<string, unknown> = {}, hip3Orders: unknown = []) {
  const hl = { ...QUIET, ...answers };
  global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.type === 'frontendOpenOrders' && body.dex) return new Response(JSON.stringify(hip3Orders), { status: 200 });
    if (!(body.type in hl)) throw new Error(`unrouted ${body.type}`);
    return new Response(JSON.stringify(hl[body.type]), { status: 200 });
  }) as unknown as typeof fetch;
}

function nansenWith(coin: string, side: 'long' | 'short', size = 1, valueUsd = 1_000_000): NansenClient {
  return {
    perpPositions: async () =>
      ({
        asset_positions: [
          {
            position: {
              token_symbol: coin,
              size: String(side === 'long' ? size : -size),
              position_value_usd: String(valueUsd),
              entry_price_usd: '45',
              liquidation_price_usd: null,
              leverage_value: 5,
              unrealized_pnl_usd: '0',
              cumulative_funding_since_open_usd: '0',
            },
          },
        ],
        timestamp: Date.now(),
      }) as unknown as NansenPerpPositions,
    perpPnlSummary: async () => ({ realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 }) as NansenPnlSummary,
    currentBalance: async () => ({ rows: [] as NansenBalance[], complete: true }),
    relatedWallets: async () => ({ rows: [] as NansenRelatedWallet[], complete: true }),
  };
}

const order = { coin: 'ETH', side: 'B', limitPx: '2500', sz: '1', oid: 1, timestamp: 1, isTrigger: false };
const fill = {
  coin: 'ETH',
  side: 'B',
  px: '2500',
  sz: '1',
  time: Date.now() - 3_600_000,
  crossed: true,
  dir: 'Open Long',
  closedPnl: '0',
};
const failures = (r: { coverageNotes: Array<{ text: string; failure: boolean }> }) =>
  r.coverageNotes.filter((n) => n.failure).map((n) => n.text);

afterEach(() => vi.restoreAllMocks());

describe('a broken row is left out, counted, and lowers the claim', () => {
  it('will not call a position a clean bet when one of the account\'s orders could not be read', async () => {
    route();
    const clean = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') });
    expect(clean.verdict.verdict).toBe('looks_like_a_bet');

    route({ frontendOpenOrders: [{ ...order, sz: 'abc' }] });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') });
    expect(result.ordersCoverage).toBe('partial');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('quotes_not_checked');
    expect(result.degraded).toBe(true);
    expect(failures(result)).toContainEqual(expect.stringContaining('1 resting order came back malformed'));
  });

  it('says how many fills were left out of the trading figures', async () => {
    route({ userFillsByTime: [fill, { ...fill, px: 'NaN' }] });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') });
    expect(result.trades.tradesPerDay).toBe(1);
    expect(result.degraded).toBe(true);
    expect(failures(result)).toContainEqual(expect.stringContaining('1 of 2 fills came back malformed'));
  });

  it('counts a HIP-3 dex that answered with something other than orders as a dex that did not answer', async () => {
    route({}, { error: 'not a list' });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('xyz:ETH', 'long') });
    expect(result.ordersCoverage).toBe('partial');
    expect(result.verdict.reasons).toContain('quotes_not_checked');
    expect(failures(result)).toContain('Resting orders on the xyz dex could not be read');
  });

  it('leaves a short\'s cover open rather than at zero when a spot balance could not be read', async () => {
    route({ spotClearinghouseState: { balances: [{ coin: 'HYPE', token: 150, total: 'lots' }] } });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('HYPE', 'short') });
    expect(result.hedgeCoverage).toBe('partial');
    expect(failures(result)).toContainEqual(expect.stringContaining('1 spot balance on Hyperliquid came back malformed'));
  });
});

describe('a broken envelope', () => {
  it('fails the check, the way a source that is down does', async () => {
    route({ userFillsByTime: { error: 'rate limited' } });
    await expect(checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') })).rejects.toBeInstanceOf(UpstreamShapeError);
  });

  it('except where nothing is decided: perp metadata of the wrong shape only hides open interest', async () => {
    route({ metaAndAssetCtxs: { universe: 'none' } });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') });
    expect(result.verdict.verdict).toBe('looks_like_a_bet');
    expect(result.coverage).toContain('Open interest unavailable, so size versus open interest is not shown');
  });
});

describe('a loan Hyperliquid reports is said, not lost', () => {
  it('names the loan behind a covered short and still counts the spot held against it', async () => {
    // The demonstration account for "Hedged", as Hyperliquid answered for it
    // on 24.09: 443,316 HYPE supplied as collateral, 17,967,395 USDC owed.
    route({ spotClearinghouseState: marginSpot });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('HYPE', 'short', 457_000, 20_565_000) });
    expect(result.hedge.hedgeRatio).toBeCloseTo(0.97, 2);
    expect(result.verdict.verdict).toBe('hedged');
    const loan = result.coverageNotes.find((n) => n.text.startsWith('Borrowed on Hyperliquid'));
    expect(loan).toEqual({
      text:
        'Borrowed on Hyperliquid under portfolio margin: 17,967,395 USDC. 443,316 HYPE of the spot held against the ' +
        'short is supplied as collateral. Spot balances are counted net of what is borrowed, and a loan taken ' +
        'anywhere else would not appear here',
      failure: false,
    });
    expect(result.degraded).toBe(false);
  });

  it('puts a loan in the position\'s own coin next to the answer: owed and not held, it works as a short', async () => {
    route({ spotClearinghouseState: { balances: [{ coin: 'HYPE', token: 150, total: '-1000.0', hold: '0.0', borrowed: '1000.0' }] } });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('HYPE', 'long') });
    expect(failures(result)).toContain(
      '1,000 HYPE is owed on Hyperliquid spot - borrowed and not held, which works as a short against this long. ' +
        'This reading does not count a loan as cover',
    );
    expect(result.degraded).toBe(true);
    expect(result.coverage.join(' ')).not.toContain('Borrowed on Hyperliquid');
  });

  it('says a loan in a short\'s own coin adds to the short', async () => {
    route({ spotClearinghouseState: { balances: [{ coin: 'HYPE', token: 150, total: '-2.5', borrowed: '2.5' }] } });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('HYPE', 'short') });
    expect(failures(result)).toContainEqual(expect.stringContaining('2.5 HYPE is owed on Hyperliquid spot'));
    expect(failures(result)).toContainEqual(expect.stringContaining('which adds to this short'));
  });

  it('says nothing about loans when there are none', async () => {
    route({ spotClearinghouseState: { balances: [{ coin: 'HYPE', token: 150, total: '10.0', hold: '0.0' }] } });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('HYPE', 'short') });
    expect(result.coverage.join(' ')).not.toMatch(/borrowed|owed/i);
  });
});
