import { describe, expect, it } from 'vitest';
import { computePositionFeatures, EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import { computeVerdict, hedgeCanChangeVerdict } from '../../src/engine/verdict';
import { exposureBreakdown } from '../../src/engine/breakdown';
import type { Position } from '../../src/types';

const leg = (coin: string, side: 'long' | 'short', sizeUsd: number): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 1, liquidationPx: null,
  leverageType: 'cross', unrealizedPnlUsd: 0, cumFundingUsd: 0,
});

describe('27 September: absence gates and exposure limits', () => {
  const positions = computePositionFeatures([leg('ETH', 'short', 1_000_000)]);
  const base = { positions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE };
  it.each(['partial', 'missing'] as const)('does not turn a %s funder search into a Bet', (coverage) => {
    for (const nPositions of [1, 11]) {
      expect(computeVerdict({ ...base, positions: { ...positions, nPositions },
        linkedHedgeCoverage: coverage }).reasons).toEqual(['linked_holdings_not_checked']);
    }
  });
  it('allows a complete empty search and does not let an unnecessary funder search veto a proven spot leg', () => {
    expect(computeVerdict({ ...base, linkedHedgeCoverage: 'complete' }).verdict).toBe('looks_like_a_bet');
    expect(computeVerdict({ ...base, hedge: { ...EMPTY_HEDGE, hedgeUsd: 1_000_000, hedgeRatio: 1 },
      linkedHedgeCoverage: 'missing' }).verdict).toBe('hedged');
  });
  it.each([0, 0.95, 1.2])('does not settle exposure from a spot ratio of %s while same-asset debt is unmodelled', (hedgeRatio) => {
    const hedge = { ...EMPTY_HEDGE, hedgeRatio, hedgeUsd: hedgeRatio * 1_000_000, hasUnresolvedLiability: true };
    expect(computeVerdict({ ...base, hedge }).reasons).toEqual(['liability_not_resolved']);
    expect(exposureBreakdown(positions, hedge, null).dataQuality).toBe('unknown');
  });
  it('still recognises observed material quoting in an unverified HIP-3 market', () => {
    const market = computePositionFeatures([leg('xyz:ETH', 'short', 1_000_000)]);
    const orders = { ...EMPTY_ORDERS, restingOrders: 60, coinsBothSides: 6,
      headlineTwoSided: true, headlineTwoSidedNotionalUsd: 120_000 };
    expect(computeVerdict({ positions: market, orders, hedge: EMPTY_HEDGE }).verdict).toBe('book');
  });
});

describe('27 September: a portfolio aggregate must not prove a selected position is hedged', () => {
  it('withholds a hedge label for an unrelated ETH short inside a matched BTC portfolio', () => {
    const positions = computePositionFeatures([
      leg('BTC', 'long', 10_000_000), leg('BTC', 'short', 10_000_000), leg('ETH', 'short', 1_000_000),
    ], undefined, { coin: 'ETH', side: 'short' });
    expect(positions.sameAssetOffsetShare).toBeGreaterThan(0.95);
    const input = { positions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE };
    expect(computeVerdict(input).verdict).toBe('unknown');
    expect(hedgeCanChangeVerdict(input)).toBe(false);
    expect(computeVerdict({ ...input, positionsCoverage: 'partial' }).verdict).toBe('unknown');
  });

  it('does not prove neutrality from a partial opposing-perp aggregate plus a full spot leg', () => {
    const positions = computePositionFeatures([leg('ETH', 'short', 1_000_000), leg('ETH', 'long', 500_000)]);
    expect(computeVerdict({ positions, orders: EMPTY_ORDERS,
      hedge: { ...EMPTY_HEDGE, hedgeUsd: 1_000_000, hedgeRatio: 1 },
    }).verdict).toBe('unknown');
  });

  it('does not interpret an unverified HIP-3 underlying as no matching spot', () => {
    const positions = computePositionFeatures([leg('xyz:ETH', 'short', 1_000_000)]);
    expect(computeVerdict({ positions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE }).verdict).toBe('unknown');
  });
});
