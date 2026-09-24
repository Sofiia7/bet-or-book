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
    netSide: 'short',
    candidates: [],
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

  it('does not let $150K of material quoting in five other markets classify an unquoted ETH short (23.09 audit, L01)', () => {
    // Live repro: a $1M ETH short with no ETH orders at all, and 50 orders
    // worth $150K split across five markets that are not ETH. Every account-
    // wide gate the old rule checked - order count, bid/ask balance, markets
    // touched, total notional - passed, and it read as inventory for a
    // position the account had never quoted.
    const elsewhere: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
      coin: `OTHER${Math.floor(i / 10)}`,
      side: i % 2 === 0 ? 'bid' : 'ask',
      sizeUsd: 3_000,
    }));
    const v = computeVerdict({
      positions: positions({}),
      orders: computeOrderFeatures(elsewhere, 'ETH'),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).not.toBe('book');
  });

  it('does not let a $250K bid against a $25 ask in the headline market count as material quoting (23.09 audit, L01)', () => {
    // Four other markets supply a clean account-wide signal - 50 orders,
    // five markets touched, an even bid/ask count - so only the headline
    // market's own $250,025 decides whether it is material. Summing the two
    // sides instead of doubling the smaller one used to call $250,025
    // material; almost none of it has a counterpart.
    const other: RestingOrder[] = Array.from({ length: 40 }, (_, i) => ({
      coin: `OTHER${Math.floor(i / 10)}`,
      side: i % 2 === 0 ? 'bid' : 'ask',
      sizeUsd: 3_000,
    }));
    const headline: RestingOrder[] = [
      ...Array.from({ length: 5 }, () => ({ coin: 'ETH', side: 'bid' as const, sizeUsd: 50_000 })),
      ...Array.from({ length: 5 }, () => ({ coin: 'ETH', side: 'ask' as const, sizeUsd: 5 })),
    ];
    const v = computeVerdict({
      positions: positions({}),
      orders: computeOrderFeatures([...other, ...headline], 'ETH'),
      hedge: hedge(),
      hedgeCoverage: 'complete',
    });
    expect(v.verdict).not.toBe('book');
  });

  it('calls it a book when the two-sided quoting is material against the position', () => {
    // Bucket 0 is the headline market itself (23.09 audit, L01): quoting
    // elsewhere describes the account, not this position.
    const real: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
      coin: Math.floor(i / 10) === 0 ? 'ETH' : `M${Math.floor(i / 10)}`,
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
      coin: Math.floor(i / 10) === 0 ? 'ETH' : `M${Math.floor(i / 10)}`,
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

describe('L01 (22.09 audit): a directional portfolio is a bet even past the position-count and share bars', () => {
  const wide = positions({ nPositions: 8, netToGross: 1, headlineShare: 0.3, headlineNotionalUsd: 300_000 });
  const complete = { hedgeCoverage: 'complete' as const, ordersCoverage: 'complete' as const, positionsCoverage: 'complete' as const };

  it('calls a wide all-short portfolio with no quotes and no hedge a bet', () => {
    const v = computeVerdict({ positions: wide, orders: orders(), hedge: hedge(), ...complete });
    expect(v.verdict).toBe('looks_like_a_bet');
    expect(v.reasons).toContain('directional_portfolio');
  });

  it('does the same for an all-long portfolio, where a hedge could never apply', () => {
    const v = computeVerdict({
      positions: { ...wide, headlineSide: 'long' },
      orders: orders(),
      hedge: hedge(),
      ...complete,
      hedgeCoverage: 'not-applicable',
    });
    expect(v.verdict).toBe('looks_like_a_bet');
    expect(v.reasons).toContain('directional_portfolio');
  });

  it('does not fire when the legs do not actually point the same way', () => {
    const v = computeVerdict({ positions: { ...wide, netToGross: 0.5 }, orders: orders(), hedge: hedge(), ...complete });
    expect(v.reasons).not.toContain('directional_portfolio');
  });

  it('does not fire when the account quotes both sides somewhere', () => {
    const twoSided = computeOrderFeatures(
      [
        { coin: 'OTHER', side: 'bid', sizeUsd: 100 },
        { coin: 'OTHER', side: 'ask', sizeUsd: 100 },
      ],
      'ETH',
    );
    const v = computeVerdict({ positions: wide, orders: twoSided, hedge: hedge(), ...complete });
    expect(v.reasons).not.toContain('directional_portfolio');
  });

  it('withholds it when the resting orders could not be read in full', () => {
    const v = computeVerdict({ positions: wide, orders: orders(), hedge: hedge(), ...complete, ordersCoverage: 'partial' });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('quotes_not_checked');
  });

  it('withholds it when the positions could not be read in full', () => {
    const v = computeVerdict({ positions: wide, orders: orders(), hedge: hedge(), ...complete, positionsCoverage: 'partial' });
    expect(v.verdict).toBe('unknown');
    expect(v.reasons).toContain('positions_not_complete');
  });

  it('still prefers the funding-link finding when that fires too', () => {
    const v = computeVerdict({
      positions: wide,
      orders: orders(),
      hedge: hedge(),
      ...complete,
      linkedHedge: { linkedHedgeRatio: 0.5 },
    });
    expect(v.reasons).toContain('linked_exposure_unverified');
    expect(v.reasons).not.toContain('directional_portfolio');
  });

  it('leaves a small concentrated position to the existing bet reason', () => {
    const narrow = positions({ nPositions: 3, netToGross: 1, headlineShare: 0.8 });
    const v = computeVerdict({ positions: narrow, orders: orders(), hedge: hedge(), ...complete });
    expect(v.reasons).toContain('directional_concentration');
    expect(v.reasons).not.toContain('directional_portfolio');
  });
});

describe('the hedge read is only paid for when it can still move the answer', () => {
  it('skips it once material two-sided quoting has settled the account', () => {
    const real: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({
      coin: Math.floor(i / 10) === 0 ? 'ETH' : `M${Math.floor(i / 10)}`,
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
