import { describe, expect, it } from 'vitest';
import { computeVerdict, hedgeCanChangeVerdict, DEFAULT_THRESHOLDS } from '../../src/engine/verdict';
import type { PositionFeatures, OrderFeatures, HedgeFeatures } from '../../src/engine/features';

function positions(overrides: Partial<PositionFeatures>): PositionFeatures {
  return {
    nPositions: 0,
    grossUsd: 0,
    netUsd: 0,
    netToGross: 0,
    headlineCoin: null,
    headlineSide: null,
    headlineNotionalUsd: 0,
    headlineShare: 0,
    headlineLiqDistancePct: null,
    ...overrides,
  };
}
function orders(overrides: Partial<OrderFeatures>): OrderFeatures {
  return { restingOrders: 0, bidShare: 0.5, coinsBothSides: 0, ...overrides };
}
function hedge(overrides: Partial<HedgeFeatures>): HedgeFeatures {
  return { hedgeUsd: 0, hedgeRatio: 0, ...overrides };
}

describe('computeVerdict', () => {
  it('returns unknown when there are no open positions', () => {
    const result = computeVerdict({ positions: positions({}), orders: orders({}), hedge: hedge({}) });
    expect(result.verdict).toBe('unknown');
  });

  it('calls it a book from position spread alone (Wintermute-shaped account)', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 76, netToGross: 0.04, headlineShare: 0.2, headlineCoin: 'BTC', headlineNotionalUsd: 40_000_000 }),
      orders: orders({}),
      hedge: hedge({}),
    });
    expect(result.verdict).toBe('book');
    expect(result.strength).toBe('likely');
  });

  it('calls it a strong book when both position spread and order-book signals agree', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 76, netToGross: 0.04, headlineShare: 0.2, headlineCoin: 'BTC', headlineNotionalUsd: 40_000_000 }),
      orders: orders({ restingOrders: 1732, bidShare: 0.51, coinsBothSides: 40 }),
      hedge: hedge({}),
    });
    expect(result.verdict).toBe('book');
    expect(result.strength).toBe('strong');
  });

  it('calls it hedged when a spot leg covers most of the headline position', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'ASTER', headlineNotionalUsd: 7_500_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeUsd: 7_500_000, hedgeRatio: 1 }),
    });
    expect(result.verdict).toBe('hedged');
    expect(result.reasons).toContain('hedge_leg');
  });

  it('calls it hedged when a handful of positions roughly net out even without a spot leg', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 4, netToGross: 0.1, headlineShare: 0.3 }),
      orders: orders({}),
      hedge: hedge({}),
    });
    expect(result.verdict).toBe('hedged');
    expect(result.reasons).toContain('balanced_book');
  });

  it('calls it a bet for one concentrated leveraged position with no hedge and no quotes', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'BTC', headlineNotionalUsd: 1_250_000_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeRatio: 0 }),
    });
    expect(result.verdict).toBe('looks_like_a_bet');
  });

  it('falls back to unknown when a small account is too concentrated for a hedge but not clean enough for a bet', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 2, netToGross: 0.6, headlineShare: 0.7, headlineCoin: 'BTC', headlineNotionalUsd: 500_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeRatio: 0.05 }),
    });
    expect(result.verdict).toBe('unknown');
  });

  it('exposes the default thresholds so calibration can diff against them', () => {
    expect(DEFAULT_THRESHOLDS.book.minPositions).toBe(20);
    expect(DEFAULT_THRESHOLDS.bet.maxPositions).toBe(5);
  });

  it('calls it a probable hedge when linked wallets cover the short and the account itself does not', () => {
    const result = computeVerdict({
      positions: positions({
        nPositions: 14,
        netToGross: 1,
        headlineShare: 0.44,
        headlineCoin: 'ETH',
        headlineSide: 'short',
        headlineNotionalUsd: 177_500_000,
      }),
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
      positions: positions({
        nPositions: 1,
        netToGross: 1,
        headlineShare: 1,
        headlineCoin: 'BTC',
        headlineSide: 'short',
        headlineNotionalUsd: 10_000_000,
      }),
      orders: orders({}),
      hedge: hedge({ hedgeRatio: 0 }),
      linkedHedge: { linkedHedgeRatio: 0.2 },
    });
    expect(result.verdict).toBe('unknown');
  });
});

describe('hedgeCanChangeVerdict', () => {
  const concentratedShort = positions({
    nPositions: 1,
    netToGross: 1,
    headlineShare: 1,
    headlineCoin: 'ETH',
    headlineSide: 'short',
    headlineNotionalUsd: 100_000_000,
  });

  it('is true for a concentrated short with no book signal', () => {
    expect(hedgeCanChangeVerdict({ positions: concentratedShort, orders: orders({}) })).toBe(true);
  });

  it('is false for a long headline - spot offsets only a short', () => {
    expect(
      hedgeCanChangeVerdict({ positions: { ...concentratedShort, headlineSide: 'long' }, orders: orders({}) }),
    ).toBe(false);
  });

  it('is false when a book signal already fired', () => {
    const many = positions({ ...concentratedShort, nPositions: 40, netToGross: 0.1, headlineShare: 0.1 });
    expect(hedgeCanChangeVerdict({ positions: many, orders: orders({}) })).toBe(false);
  });

  it('is false for a balanced book', () => {
    const balanced = positions({ ...concentratedShort, nPositions: 6, netToGross: 0.2, headlineShare: 0.3 });
    expect(hedgeCanChangeVerdict({ positions: balanced, orders: orders({}) })).toBe(false);
  });

  it('is false with no positions', () => {
    expect(hedgeCanChangeVerdict({ positions: positions({}), orders: orders({}) })).toBe(false);
  });
});
