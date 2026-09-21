// A05 and U02, audit of 21.09: the sentence on the card may not claim more
// than the reading behind it, and a number may not be signed by a source
// that did not produce all of it.
import { describe, expect, it } from 'vitest';
import { explain, type EvidenceInput } from '../../src/engine/evidence';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';

function positions(overrides: Partial<PositionFeatures> = {}): PositionFeatures {
  return {
    nPositions: 1,
    grossUsd: 100_000_000,
    netUsd: 100_000_000,
    netToGross: 1,
    headlineCoin: 'ETH',
    headlineSide: 'short',
    headlineNotionalUsd: 100_000_000,
    headlineShare: 1,
    headlineLiqDistancePct: null,
    headlineLiqDistanceBasis: null,
    sameAssetOffsetShare: 0,
    ...overrides,
  };
}

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    verdict: { verdict: 'unknown', strength: null, reasons: [] },
    positions: positions(),
    orders: { ...EMPTY_ORDERS },
    hedge: { ...EMPTY_HEDGE },
    hedgeScope: 'all-chains',
    hedgeCoverage: 'complete',
    linkedHedge: null,
    trades: {
      tradesPerDay: 0, crossedShare: 0, buyShare: 0.5, sampleSize: 0, cappedByApiLimit: false,
      notionalUsd: 0, spanHours: 0, headlineFills: 0, headlineShareOfFills: 0,
    },
    pnl: null,
    sizeVsOi: null,
    source: 'nansen',
    ...overrides,
  };
}

describe('coverage is described as what was seen, not as a position being neutral', () => {
  it('calls a hedge visible coverage rather than a settled net position', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 100_000_000, hedgeRatio: 1 },
      }),
    );
    expect(e.summary).toContain('held by this address');
    expect(e.summary).not.toContain('all chains');
  });

  it('will not leave a loan-backed leg sounding neutral', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 100_000_000, hedgeRatio: 1, lendingUsd: 90_000_000 },
      }),
    );
    expect(e.summary).toContain('lending');
    expect(e.summary.toLowerCase()).toContain('borrowed');
  });

  it('does not claim a long has nothing against it anywhere', () => {
    const e = explain(
      input({
        verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] },
        positions: positions({ headlineSide: 'long' }),
        hedgeScope: 'none',
      }),
    );
    // The old sentence was "nothing in this account offsets it", which is
    // wider than what any endpoint read here can establish.
    expect(e.summary).not.toContain('nothing in this account offsets it');
    expect(e.summary).toContain('not read here');
  });
});

describe('a withheld verdict says which gap withheld it', () => {
  const cases: Array<[string, string]> = [
    ['unrecognised_assets', 'could not identify'],
    ['diversified_book_no_quotes', 'no two-sided quoting'],
    ['quotes_not_checked', 'resting orders'],
    ['positions_not_complete', 'HIP-3'],
  ];
  for (const [reason, phrase] of cases) {
    it(`explains ${reason}`, () => {
      const e = explain(
        input({
          verdict: { verdict: 'unknown', strength: null, reasons: [reason] },
          hedge: { ...EMPTY_HEDGE, unverifiedUsd: 20_000_000 },
          positions: positions({ nPositions: 30, netToGross: 0.1, headlineShare: 0.2 }),
        }),
      );
      expect(e.summary).toContain(phrase);
    });
  }

  it('reports what a partial read did find instead of discarding it', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['hedge_not_checked'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 95_000_000, hedgeRatio: 0.95 },
        hedgeCoverage: 'partial',
      }),
    );
    expect(e.summary).toContain('At least');
    expect(e.summary).toContain('$95.0M');
  });
});

describe('U02: the source line matches who produced the number', () => {
  it('signs a mixed hedge with both sources', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: {
          ...EMPTY_HEDGE,
          hedgeUsd: 100_000_000,
          hedgeRatio: 1,
          hedgeUsdBySource: { hyperliquidSpot: 40_000_000, onchain: 60_000_000 },
        },
      }),
    );
    const item = e.evidence.find((i) => i.label === 'Hedge found');
    expect(item?.source).toBe('Nansen + Hyperliquid');
  });

  it('signs a hedge that came only from Hyperliquid spot with Hyperliquid', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: {
          ...EMPTY_HEDGE,
          hedgeUsd: 100_000_000,
          hedgeRatio: 1,
          hedgeUsdBySource: { hyperliquidSpot: 100_000_000, onchain: 0 },
        },
      }),
    );
    expect(e.evidence.find((i) => i.label === 'Hedge found')?.source).toBe('Hyperliquid');
  });

  it('says which chains were actually searched, not "all"', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 100_000_000, hedgeRatio: 1, hedgeUsdBySource: { hyperliquidSpot: 0, onchain: 100_000_000 } },
      }),
    );
    expect(e.evidence.find((i) => i.label === 'Hedge found')?.value).toContain('Nansen-supported chains');
  });
});

describe('the row a verdict turns on is marked as such', () => {
  const decisiveLabel = (e: { evidence: Array<{ label: string; decisive?: boolean }> }) =>
    e.evidence.find((i) => i.decisive)?.label;

  it('marks the funding wallets when they are why the answer was withheld', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['linked_exposure_unverified'] },
        linkedHedge: {
          linkedHedgeUsd: 405_000_000,
          linkedHedgeRatio: 4.05,
          funders: [{ address: '0xaaa', relation: 'First Funder', chain: 'ethereum', matchingUsd: 405_000_000 }],
        },
      }),
    );
    expect(decisiveLabel(e)).toBe('Linked wallets');
  });

  it('marks the hedge when coverage is what decided it', () => {
    for (const reason of ['hedge_leg', 'partial_offset', 'over_covered', 'hedge_not_checked', 'unrecognised_assets']) {
      const e = explain(
        input({
          verdict: { verdict: 'unknown', strength: null, reasons: [reason] },
          hedge: { ...EMPTY_HEDGE, hedgeUsd: 50_000_000, hedgeRatio: 0.5 },
        }),
      );
      expect(decisiveLabel(e)).toBe('Hedge found');
    }
  });

  it('marks nothing in particular when the answer rests on the position itself', () => {
    const e = explain(
      input({ verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] } }),
    );
    expect(decisiveLabel(e)).toBe('Largest position');
  });
});
