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
    headlineLiqDistanceBasis: null,
    sameAssetOffsetShare: 0,
    ...overrides,
  };
}
function orders(overrides: Partial<OrderFeatures>): OrderFeatures {
  return { restingOrders: 0, bidShare: 0.5, coinsBothSides: 0, ...overrides };
}
function hedge(overrides: Partial<HedgeFeatures>): HedgeFeatures {
  return { hedgeUsd: 0, hedgeRatio: 0, unverifiedUsd: 0, lendingUsd: 0, ...overrides };
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

  it('does not call a half-covered short hedged: half of it is still a short', () => {
    // Three real gallery cards sit at 52.8%, 59.3% and 69.2% coverage.
    const result = computeVerdict({
      positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'HYPE', headlineSide: 'short', headlineNotionalUsd: 7_200_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeUsd: 4_270_000, hedgeRatio: 0.593 }),
    });
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['partial_offset']);
  });

  it('does not call an over-covered short hedged: the account is net long', () => {
    // 194.8% coverage of a $15.4M ETH short leaves $14.6M of ETH long.
    const result = computeVerdict({
      positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'ETH', headlineSide: 'short', headlineNotionalUsd: 15_400_000 }),
      orders: orders({}),
      hedge: hedge({ hedgeUsd: 30_000_000, hedgeRatio: 1.948 }),
    });
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['over_covered']);
  });

  it('allows a hedge to drift with the price before it stops being one', () => {
    const at = (ratio: number) =>
      computeVerdict({
        positions: positions({ nPositions: 1, netToGross: 1, headlineShare: 1, headlineCoin: 'HYPE', headlineSide: 'short', headlineNotionalUsd: 4_000_000 }),
        orders: orders({}),
        hedge: hedge({ hedgeUsd: 4_000_000 * ratio, hedgeRatio: ratio }),
      }).verdict;
    expect(at(0.934)).toBe('hedged');
    expect(at(1)).toBe('hedged');
    expect(at(1.149)).toBe('hedged');
    expect(at(0.849)).toBe('unknown');
    expect(at(1.151)).toBe('unknown');
  });

  it('calls it hedged when the offsetting legs are in the same assets', () => {
    const result = computeVerdict({
      positions: positions({ nPositions: 4, netToGross: 0.1, headlineShare: 0.3, sameAssetOffsetShare: 0.95 }),
      orders: orders({}),
      hedge: hedge({}),
    });
    expect(result.verdict).toBe('hedged');
    expect(result.reasons).toContain('balanced_book');
  });

  it('does not call a book hedged just because its dollars net out across different assets', () => {
    // $1M BTC long against $1M TRUMP short: net zero dollars, two live bets.
    const result = computeVerdict({
      positions: positions({ nPositions: 2, netToGross: 0, headlineShare: 0.5, sameAssetOffsetShare: 0 }),
      orders: orders({}),
      hedge: hedge({}),
    });
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['mixed_long_short_book']);
  });

  it('says so when a snapshot never measured the offset', () => {
    const p = positions({ nPositions: 4, netToGross: 0.1, headlineShare: 0.3 });
    // Entries scanned before the offset was measured carry no such field.
    delete (p as Partial<PositionFeatures>).sameAssetOffsetShare;
    const result = computeVerdict({ positions: p, orders: orders({}), hedge: hedge({}) });
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['offset_not_measured']);
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

  it('never calls a short hedged on a funding wallet\x27s holdings alone', () => {
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
    // A funding transaction shows where the money came from, not who holds
    // it now. Two of the four cards this rule produced in the gallery were
    // funded by an exchange, so the "hedge" was that exchange's reserves.
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['linked_exposure_unverified']);
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

  it('is false for a book whose legs already cancel within their own assets', () => {
    const balanced = positions({ ...concentratedShort, nPositions: 6, netToGross: 0.2, headlineShare: 0.3, sameAssetOffsetShare: 0.9 });
    expect(hedgeCanChangeVerdict({ positions: balanced, orders: orders({}) })).toBe(false);
  });

  it('is true when the dollars net out across different assets: spot could still offset the short', () => {
    const mixed = positions({ ...concentratedShort, nPositions: 6, netToGross: 0.2, headlineShare: 0.3, sameAssetOffsetShare: 0 });
    expect(hedgeCanChangeVerdict({ positions: mixed, orders: orders({}) })).toBe(true);
  });

  it('is false with no positions', () => {
    expect(hedgeCanChangeVerdict({ positions: positions({}), orders: orders({}) })).toBe(false);
  });
});

describe('book rule (c): fills', () => {
  const directional = positions({
    nPositions: 1,
    netToGross: 1,
    headlineShare: 1,
    headlineCoin: 'BTC',
    headlineSide: 'short',
    headlineNotionalUsd: 60_000_000,
  });

  it('does not turn one big directional position into a book on maker flow alone', () => {
    // The signal counts fills across every market the account touches and
    // carries no notional, so 2 000 small quotes elsewhere used to decide
    // what a single $60M BTC short was. It is a fact about the account, not
    // about this position.
    const result = computeVerdict({
      positions: directional,
      orders: orders({}),
      hedge: hedge({}),
      trades: { tradesPerDay: 2000, crossedShare: 0.2, buyShare: 0.53 },
    });
    expect(result.verdict).toBe('unknown');
    expect(result.reasons).toEqual(['maker_flow_only']);
  });

  it('still calls it a book when the positions or the order book agree', () => {
    const spread = positions({ nPositions: 76, netToGross: 0.04, headlineShare: 0.2, headlineCoin: 'BTC' });
    const result = computeVerdict({
      positions: spread,
      orders: orders({}),
      hedge: hedge({}),
      trades: { tradesPerDay: 2000, crossedShare: 0.2, buyShare: 0.53 },
    });
    expect(result.verdict).toBe('book');
    expect(result.reasons).toEqual(['positions', 'trades']);
    expect(result.strength).toBe('strong');
  });

  it('does not call one-sided maker flow a book - that is a position being built', () => {
    // Seen live 18.09: 535 maker fills a day, every one of them "Open Short"
    // on one coin, read as a book by the rule without a side condition.
    const result = computeVerdict({
      positions: directional,
      orders: orders({}),
      hedge: hedge({}),
      trades: { tradesPerDay: 535, crossedShare: 0, buyShare: 0 },
    });
    expect(result.verdict).not.toBe('book');
  });
});
