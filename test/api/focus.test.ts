// "A post says BTC, and the biggest position at that address is ETH."
// The check answers about one position; until now that was always the
// largest one, and the reader had no way to ask about the one they came for.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { computePositionFeatures } from '../../src/engine/features';
import type { Position } from '../../src/types';
import type { NansenClient, NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from '../../src/sources/nansen';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const p = (coin: string, side: 'long' | 'short', sizeUsd: number): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 5, leverageType: 'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
});

describe('which position the features are about', () => {
  const positions = [p('ETH', 'short', 50_000_000), p('BTC', 'long', 10_000_000), p('SOL', 'short', 1_000_000)];

  it('takes the largest when nothing is asked for', () => {
    const f = computePositionFeatures(positions);
    expect(f.headlineCoin).toBe('ETH');
    expect(f.headlineSide).toBe('short');
  });

  it('takes the one asked for', () => {
    const f = computePositionFeatures(positions, undefined, { coin: 'BTC', side: 'long' });
    expect(f.headlineCoin).toBe('BTC');
    expect(f.headlineSide).toBe('long');
    expect(f.headlineNotionalUsd).toBe(10_000_000);
    // Gross and net are the account's, whichever position is in focus.
    expect(f.grossUsd).toBe(61_000_000);
  });

  it('falls back to the largest when the asked-for position is not open', () => {
    const f = computePositionFeatures(positions, undefined, { coin: 'DOGE', side: 'long' });
    expect(f.headlineCoin).toBe('ETH');
  });

  it('lists the positions worth offering, largest first', () => {
    const f = computePositionFeatures(positions);
    expect(f.candidates).toEqual([
      { coin: 'ETH', side: 'short', sizeUsd: 50_000_000 },
      { coin: 'BTC', side: 'long', sizeUsd: 10_000_000 },
      { coin: 'SOL', side: 'short', sizeUsd: 1_000_000 },
    ]);
  });

  it('offers at most five, so the list stays a choice rather than a dump', () => {
    const many = Array.from({ length: 12 }, (_, i) => p(`C${i}`, 'long', 1_000_000 - i));
    expect(computePositionFeatures(many).candidates).toHaveLength(5);
  });
});

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

function route() {
  global.fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

const nansen = (): NansenClient => ({
  perpPositions: async () =>
    ({
      asset_positions: [
        { position: { token_symbol: 'ETH', size: '-1', position_value_usd: '50000000', entry_price_usd: '100', liquidation_price_usd: null, leverage_value: 5, unrealized_pnl_usd: '0', cumulative_funding_since_open_usd: '0' } },
        { position: { token_symbol: 'BTC', size: '1', position_value_usd: '10000000', entry_price_usd: '100', liquidation_price_usd: null, leverage_value: 5, unrealized_pnl_usd: '0', cumulative_funding_since_open_usd: '0' } },
      ],
      timestamp: Date.now(),
    }) as unknown as NansenPerpPositions,
  perpPnlSummary: async () => ({ realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 }) as NansenPnlSummary,
  currentBalance: async () => ({ rows: [] as NansenBalance[], complete: true }),
  relatedWallets: async () => ({ rows: [] as NansenRelatedWallet[], complete: true }),
});

afterEach(() => vi.restoreAllMocks());

describe('a check can be asked about a particular position', () => {
  it('answers about the largest by default and lists the alternatives', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansen() });
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.positions.candidates.map((c) => c.coin)).toEqual(['ETH', 'BTC']);
    expect(result.focus).toBeNull();
  });

  it('answers about the one it was asked for, and says it was asked', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansen(), focus: { coin: 'BTC', side: 'long' } });
    expect(result.positions.headlineCoin).toBe('BTC');
    expect(result.focus).toEqual({ coin: 'BTC', side: 'long' });
    expect(result.summary).toContain('BTC');
  });

  it('says so when the position asked for is not open at that address', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansen(), focus: { coin: 'DOGE', side: 'long' } });
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.coverage.join(' ')).toContain('DOGE');
  });
});
