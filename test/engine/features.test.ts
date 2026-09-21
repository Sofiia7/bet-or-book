import { describe, expect, it } from 'vitest';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeSizeVsOi,
  computeTradeFeatures,
  computeLinkedHedge,
} from '../../src/engine/features';
import type { Position, RestingOrder, SpotHolding, Trade, ServiceStatus } from '../../src/types';

describe('computePositionFeatures', () => {
  it('returns zeroed features for an empty account', () => {
    const result = computePositionFeatures([]);
    expect(result.nPositions).toBe(0);
    expect(result.headlineCoin).toBeNull();
    expect(result.headlineSide).toBeNull();
  });

  it('identifies the headline position and its share of gross exposure', () => {
    const positions: Position[] = [
      { coin: 'BTC', side: 'short', sizeUsd: 190_000_000, entryPx: 60000, leverage: 3, liquidationPx: 68000, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
      { coin: 'ETH', side: 'long', sizeUsd: 9_050_000, entryPx: 3000, leverage: 2, liquidationPx: 2400, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
    ];
    const result = computePositionFeatures(positions);
    expect(result.nPositions).toBe(2);
    expect(result.headlineCoin).toBe('BTC');
    expect(result.headlineSide).toBe('short');
    expect(result.grossUsd).toBe(199_050_000);
    expect(result.headlineShare).toBeCloseTo(190_000_000 / 199_050_000, 6);
  });

  it('separates exposure that cancels within one asset from a dollar-balanced mix', () => {
    const p = (coin: string, side: 'long' | 'short', sizeUsd: number): Position => ({
      coin, side, sizeUsd, entryPx: 1, leverage: 1, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
    });
    // $1M BTC long against $1M TRUMP short nets to zero dollars and hedges
    // nothing: each asset can still move on its own.
    const mixed = computePositionFeatures([p('BTC', 'long', 1_000_000), p('TRUMP', 'short', 1_000_000)]);
    expect(mixed.netToGross).toBe(0);
    expect(mixed.sameAssetOffsetShare).toBe(0);

    // The same dollars, both legs in BTC, really do cancel.
    const real = computePositionFeatures([p('BTC', 'long', 1_000_000), p('BTC', 'short', 1_000_000)]);
    expect(real.netToGross).toBe(0);
    expect(real.sameAssetOffsetShare).toBe(1);

    // Half of the gross cancels in ETH, the rest is an outright SOL long.
    const partly = computePositionFeatures([
      p('ETH', 'long', 1_000_000), p('ETH', 'short', 1_000_000), p('SOL', 'long', 2_000_000),
    ]);
    expect(partly.sameAssetOffsetShare).toBeCloseTo(0.5, 6);
  });

  it('computes net-to-gross close to zero for a balanced book', () => {
    const positions: Position[] = [
      { coin: 'BTC', side: 'long', sizeUsd: 100, entryPx: 60000, leverage: 1, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
      { coin: 'BTC', side: 'short', sizeUsd: 95, entryPx: 60000, leverage: 1, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
    ];
    const result = computePositionFeatures(positions);
    expect(result.netToGross).toBeCloseTo(5 / 195, 6);
  });

  it('computes net-to-gross at 1 for a single one-directional position', () => {
    const positions: Position[] = [
      { coin: 'BTC', side: 'long', sizeUsd: 100, entryPx: 60000, leverage: 5, liquidationPx: 50000, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
    ];
    const result = computePositionFeatures(positions);
    expect(result.netToGross).toBe(1);
    expect(result.headlineLiqDistancePct).toBeCloseTo((60000 - 50000) / 60000, 6);
  });
});

describe('computeOrderFeatures', () => {
  it('returns a neutral bidShare when there are no orders', () => {
    const result = computeOrderFeatures([]);
    expect(result.restingOrders).toBe(0);
    expect(result.bidShare).toBe(0.5);
  });

  it('counts coins quoted on both sides', () => {
    const orders: RestingOrder[] = [
      { coin: 'BTC', side: 'bid', sizeUsd: 1000 },
      { coin: 'BTC', side: 'ask', sizeUsd: 1000 },
      { coin: 'ETH', side: 'bid', sizeUsd: 500 },
    ];
    const result = computeOrderFeatures(orders);
    expect(result.restingOrders).toBe(3);
    expect(result.coinsBothSides).toBe(1);
    expect(result.bidShare).toBeCloseTo(2 / 3, 6);
  });
});

describe('computeHedgeFeatures', () => {
  it('sums spot holdings that alias to the headline coin', () => {
    const spot: SpotHolding[] = [
      { coin: 'UBTC', valueUsd: 40_000_000 },
      { coin: 'USDC', valueUsd: 5_000_000 },
    ];
    const result = computeHedgeFeatures('BTC', 'short', 190_000_000, spot);
    expect(result.hedgeUsd).toBe(40_000_000);
    expect(result.hedgeRatio).toBeCloseTo(40_000_000 / 190_000_000, 6);
  });

  it('returns zero when there is no headline position', () => {
    const result = computeHedgeFeatures(null, null, 0, [{ coin: 'UBTC', valueUsd: 1000 }]);
    expect(result.hedgeUsd).toBe(0);
    expect(result.hedgeRatio).toBe(0);
  });

  it('does not treat spot of the same asset as a hedge of a LONG perp', () => {
    const spot: SpotHolding[] = [{ coin: 'UBTC', valueUsd: 40_000_000 }];
    const result = computeHedgeFeatures('BTC', 'long', 190_000_000, spot);
    expect(result.hedgeUsd).toBe(0);
    expect(result.hedgeRatio).toBe(0);
  });
});

describe('computeLinkedHedge', () => {
  const funder = (address: string, holdings: SpotHolding[], serviceStatus: ServiceStatus = 'not-service') => ({
    wallet: { address, relation: 'First Funder', chain: 'ethereum', serviceStatus },
    holdings,
  });

  it('sums matching holdings of linked wallets against a short', () => {
    const result = computeLinkedHedge('ETH', 'short', 100_000_000, [
      funder('0xa', [
        { coin: 'WSTETH', valueUsd: 60_000_000, chain: 'ethereum' },
        { coin: 'USDC', valueUsd: 9_000_000 },
      ]),
      funder('0xb', [{ coin: 'AETHWETH', valueUsd: 20_000_000, chain: 'ethereum' }]),
    ]);
    expect(result.linkedHedgeUsd).toBe(80_000_000);
    expect(result.linkedHedgeRatio).toBeCloseTo(0.8, 6);
    expect(result.funders.map((f) => f.matchingUsd)).toEqual([60_000_000, 20_000_000]);
  });

  it('ignores shared-service wallets and long headlines', () => {
    const holdings = [{ coin: 'WETH', valueUsd: 50_000_000 }];
    expect(computeLinkedHedge('ETH', 'short', 100_000_000, [funder('0xa', holdings, 'service')]).linkedHedgeUsd).toBe(0);
    expect(computeLinkedHedge('ETH', 'long', 100_000_000, [funder('0xa', holdings)]).linkedHedgeUsd).toBe(0);
  });
});

describe('computeSizeVsOi', () => {
  it('divides headline notional by open interest', () => {
    expect(computeSizeVsOi(24_108_771, 2_868_000_000)).toBeCloseTo(24_108_771 / 2_868_000_000, 8);
  });

  it('returns null when open interest is not known', () => {
    expect(computeSizeVsOi(1000, 0)).toBeNull();
  });
});

describe('computeTradeFeatures', () => {
  it('says how much of the flow was in the position being asked about', () => {
    const hour = 3_600_000;
    const fill = (coin: string, timestamp: number, sizeUsd: number): Trade => ({
      coin,
      timestamp,
      crossed: false,
      side: 'buy',
      closedPnlUsd: 0,
      sizeUsd,
    });
    // Three hundred small quotes on SOL and one big ETH fill: the account is
    // busy, but almost none of that busyness is this position.
    const trades = [
      ...Array.from({ length: 300 }, (_, i) => fill('SOL', i * 1000, 2_000)),
      fill('ETH', 6 * hour, 40_000_000),
    ];
    const result = computeTradeFeatures(trades, 24, 'ETH');
    expect(result.sampleSize).toBe(301);
    expect(result.notionalUsd).toBe(40_600_000);
    expect(result.headlineFills).toBe(1);
    expect(result.headlineShareOfFills).toBeCloseTo(1 / 301, 6);
    // The window asked for 24 hours; the fills only cover the first six.
    expect(result.spanHours).toBeCloseTo(6, 3);
  });

  it('reports no headline share when there is no headline coin', () => {
    const result = computeTradeFeatures(
      [{ coin: 'BTC', timestamp: 0, crossed: false, side: 'buy', closedPnlUsd: 0, sizeUsd: 100 }],
      24,
      null,
    );
    expect(result.headlineFills).toBe(0);
    expect(result.headlineShareOfFills).toBe(0);
  });

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
      side: i % 4 === 0 ? 'buy' : 'sell',
      closedPnlUsd: 0,
      sizeUsd: 1_000,
    }));
    const result = computeTradeFeatures(trades, 12);
    expect(result.tradesPerDay).toBe(200);
    expect(result.crossedShare).toBeCloseTo(0.5, 6);
    expect(result.buyShare).toBeCloseTo(0.25, 6);
    expect(result.sampleSize).toBe(100);
    expect(result.cappedByApiLimit).toBe(false);
  });

  it("flags the result as a floor when the sample hits Hyperliquid's 2000-fill cap", () => {
    const trades: Trade[] = Array.from({ length: 2000 }, (_, i) => ({
      coin: 'BTC',
      timestamp: i,
      crossed: i % 4 === 0,
      side: 'buy',
      closedPnlUsd: 0,
      sizeUsd: 1_000,
    }));
    const result = computeTradeFeatures(trades, 24);
    expect(result.cappedByApiLimit).toBe(true);
    expect(result.tradesPerDay).toBe(2000);
    expect(result.crossedShare).toBeCloseTo(0.25, 6);
  });
});
