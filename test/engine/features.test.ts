import { describe, expect, it } from 'vitest';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeSizeVsOi,
  computeTradeFeatures,
} from '../../src/engine/features';
import type { Position, RestingOrder, SpotHolding, Trade } from '../../src/types';

describe('computePositionFeatures', () => {
  it('returns zeroed features for an empty account', () => {
    const result = computePositionFeatures([]);
    expect(result.nPositions).toBe(0);
    expect(result.headlineCoin).toBeNull();
  });

  it('identifies the headline position and its share of gross exposure', () => {
    const positions: Position[] = [
      { coin: 'BTC', side: 'short', sizeUsd: 190_000_000, entryPx: 60000, leverage: 3, liquidationPx: 68000, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
      { coin: 'ETH', side: 'long', sizeUsd: 9_050_000, entryPx: 3000, leverage: 2, liquidationPx: 2400, unrealizedPnlUsd: 0, cumFundingUsd: 0 },
    ];
    const result = computePositionFeatures(positions);
    expect(result.nPositions).toBe(2);
    expect(result.headlineCoin).toBe('BTC');
    expect(result.grossUsd).toBe(199_050_000);
    expect(result.headlineShare).toBeCloseTo(190_000_000 / 199_050_000, 6);
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
    const result = computeHedgeFeatures('BTC', 190_000_000, spot);
    expect(result.hedgeUsd).toBe(40_000_000);
    expect(result.hedgeRatio).toBeCloseTo(40_000_000 / 190_000_000, 6);
  });

  it('returns zero when there is no headline position', () => {
    const result = computeHedgeFeatures(null, 0, [{ coin: 'UBTC', valueUsd: 1000 }]);
    expect(result.hedgeUsd).toBe(0);
    expect(result.hedgeRatio).toBe(0);
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

  it("flags the result as a floor when the sample hits Hyperliquid's 2000-fill cap", () => {
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
