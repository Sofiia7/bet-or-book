// A01-A04, audit of 21.09: a verdict may not be stronger than the reading
// it rests on. Each of these cases used to produce a confident answer out of
// an incomplete or immaterial observation.
import { describe, expect, it } from 'vitest';
import { computeVerdict, hedgeCanChangeVerdict } from '../../src/engine/verdict';
import { computeOrderFeatures, EMPTY_HEDGE, type PositionFeatures, type OrderFeatures, type HedgeFeatures } from '../../src/engine/features';
import type { RestingOrder } from '../../src/types';

function positions(overrides: Partial<PositionFeatures>): PositionFeatures {
  return {
    nPositions: 1,
    grossUsd: 1_000_000,
    netUsd: 1_000_000,
    netToGross: 1,
    headlineCoin: 'ETH',
    headlineSide: 'short',
    headlineNotionalUsd: 1_000_000,
    headlineShare: 1,
    headlineLiqDistancePct: null,
    headlineLiqDistanceBasis: null,
    sameAssetOffsetShare: 0,
    ...overrides,
  };
}
const orders = (o: Partial<OrderFeatures> = {}): OrderFeatures => ({ ...computeOrderFeatures([]), ...o });
const hedge = (o: Partial<HedgeFeatures> = {}): HedgeFeatures => ({ ...EMPTY_HEDGE, ...o });

describe('A02: a coverage gap is checked before the hedge band, not after it', () => {
  it('does not call a short hedged on the strength of one page of holdings', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ hedgeUsd: 1_000_000, hedgeRatio: 1 }),
      hedgeCoverage: 'partial',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('hedge_not_checked');
  });

  it('keeps calling it hedged when the holdings really were read in full', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ hedgeUsd: 1_000_000, hedgeRatio: 1 }),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('hedged');
  });

  it('still reports over-coverage under a partial read, which more holdings can only confirm', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ hedgeUsd: 3_000_000, hedgeRatio: 3 }),
      hedgeCoverage: 'partial',
    });
    expect(v.reasons).toContain('over_covered');
  });
});

describe('A01: material holdings this tool could not identify withhold the finding', () => {
  it('does not call a short an uncovered bet while $1M of it may be covered', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ unverifiedUsd: 1_000_000 }),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('unrecognised_assets');
  });

  it('ignores dust that could not be identified', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ unverifiedUsd: 500 }),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('looks_like_a_bet');
  });

  it('treats a matching holding nobody could price as a gap too', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge({ unpricedMatches: 1 }),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('unknown');
  });
});

describe('A03: a book is a claim about quoting, not about counting positions', () => {
  const micro: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
    coin: `OTHER${Math.floor(i / 10)}`,
    side: i % 2 === 0 ? 'bid' : 'ask',
    sizeUsd: 1,
  }));

  it('does not let $50 of quotes elsewhere classify a $1M position', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: computeOrderFeatures(micro, 'ETH'),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).not.toBe('book');
  });

  it('calls it a book when the two-sided quoting is material against the position', () => {
    const real: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
      coin: `M${Math.floor(i / 10)}`,
      side: i % 2 === 0 ? 'bid' : 'ask',
      sizeUsd: 20_000,
    }));
    const v = computeVerdict({
      positions: positions({}),
      orders: computeOrderFeatures(real, 'ETH'),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('book');
  });

  it('does not call twenty unrelated positions a book with no quotes at all', () => {
    const v = computeVerdict({
      positions: positions({ nPositions: 20, netToGross: 0, headlineShare: 0.05, sameAssetOffsetShare: 0 }),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).not.toBe('book');
  });

  it('names a dollar-balanced spread of different assets as the portfolio it is', () => {
    const v = computeVerdict({
      positions: positions({ nPositions: 19, netToGross: 0, headlineShare: 0.05, sameAssetOffsetShare: 0 }),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('mixed_long_short_book');
  });

  it('describes a wide position spread with no quotes rather than dropping it', () => {
    const v = computeVerdict({
      positions: positions({ nPositions: 76, netToGross: 0.04, headlineShare: 0.2 }),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('diversified_book_no_quotes');
  });

  it('counts the position spread toward strength once quoting has decided it', () => {
    const real: RestingOrder[] = Array.from({ length: 60 }, (_, i) => ({
      coin: `M${Math.floor(i / 10)}`,
      side: i % 2 === 0 ? 'bid' : 'ask',
      sizeUsd: 20_000,
    }));
    const v = computeVerdict({
      positions: positions({ nPositions: 76, netToGross: 0.04, headlineShare: 0.2 }),
      orders: computeOrderFeatures(real, 'ETH'),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).toBe('book');
    expect(v.strength).toBe('strong');
    expect(v.reasons).toContain('positions');
  });
});

describe('A04: a rule may not rely on an input that was never read', () => {
  it('withholds a directional verdict when the resting orders could not be read', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
      ordersCoverage: 'missing',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('quotes_not_checked');
  });

  it('withholds a directional verdict when only part of the portfolio was read', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
      positionsCoverage: 'partial',
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('positions_not_complete');
  });

  it('still answers when both were read in full', () => {
    const v = computeVerdict({
      positions: positions({}),
      orders: orders(),
      hedge: hedge(),
      hedgeCoverage: 'complete',
      ordersCoverage: 'complete',
      positionsCoverage: 'complete',
    });
    expect(v.verdict).toBe('looks_like_a_bet');
  });
});

describe('the hedge read is only paid for when it can still move the answer', () => {
  it('skips it once material two-sided quoting has settled the account', () => {
    const real: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
      coin: `M${Math.floor(i / 10)}`,
      side: i % 2 === 0 ? 'bid' : 'ask',
      sizeUsd: 20_000,
    }));
    expect(hedgeCanChangeVerdict({ positions: positions({}), orders: computeOrderFeatures(real, 'ETH') })).toBe(false);
  });

  it('still pays for it when only the position count looked book-like', () => {
    expect(
      hedgeCanChangeVerdict({ positions: positions({ nPositions: 76, netToGross: 0.04 }), orders: orders() }),
    ).toBe(true);
  });
});
