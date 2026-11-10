// What a withheld "unrecognised assets" reading says when the holdings behind
// it could not be PRICED rather than identified. Since the balances come from
// public nodes, an unrecognised look-alike token (rsETH, ezETH...) that has no
// price - Hyperliquid has no mark for the asset, or a staking rate could not be
// read - counts in `unpricedMatches` while its `unverifiedUsd` stays 0, and it
// is not a "matching balance" either. The two sentences that used to describe
// only the identified-but-unrecognised case (the card's summary and "Still
// open") have to say what is true of this one, and keep their words for the
// case they were written for.
import { describe, expect, it } from 'vitest';
import { explain, PRICE_GAPS, type EvidenceInput } from '../../src/engine/evidence';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';
import { openQuestion } from '../../src/engine/openQuestion';

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
    netSide: 'short',
    candidates: [],
    ...overrides,
  };
}

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    verdict: { verdict: 'unknown', strength: null, reasons: ['unrecognised_assets'] },
    positions: positions(),
    orders: { ...EMPTY_ORDERS },
    hedge: { ...EMPTY_HEDGE },
    hedgeScope: 'known-tokens',
    hedgeCoverage: 'complete',
    linkedHedge: null,
    trades: {
      tradesPerDay: 0, crossedShare: 0, buyShare: 0.5, sampleSize: 0, cappedByApiLimit: false,
      notionalUsd: 0, spanHours: 0, headlineFills: 0, headlineShareOfFills: 0, headlineOpenedUsd: 0, headlineClosedUsd: 0,
    },
    pnl: null,
    sizeVsOi: null,
    source: 'hyperliquid',
    ...overrides,
  };
}

const reading = (overrides: Partial<EvidenceInput> = {}) => {
  const i = input(overrides);
  return { verdict: i.verdict, positions: i.positions, hedge: i.hedge, historical: undefined };
};

describe('holdings that could only not be priced', () => {
  // The only unpriced holding is a look-alike token: its dollars are 0, so
  // `unverifiedUsd` is 0 and `unpricedMatches` is 1.
  const unpricedLookAlike = { ...EMPTY_HEDGE, unverifiedUsd: 0, unpricedMatches: 1 };

  it('the card says they could not be priced, not that they could not be identified or that a match had no price', () => {
    const { summary } = explain(input({ hedge: unpricedLookAlike }));
    expect(summary).toBe(
      '1 holding named like ETH could not be priced (Hyperliquid had no price for the asset, or the staking rate could not be read), ' +
        'so whether the $100.0M ETH short is offset is not established. Coverage confirmed so far: 0%.',
    );
    expect(summary).not.toMatch(/matching balance|could not be identified/);
  });

  it('counts several of them in the plural', () => {
    const { summary } = explain(input({ hedge: { ...unpricedLookAlike, unpricedMatches: 3 } }));
    expect(summary).toContain('3 holdings named like ETH could not be priced');
  });

  it('keeps the dollars of identified-but-unrecognised holdings first and adds the unpriced ones after them', () => {
    const { summary } = explain(input({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 20_000_000, unpricedMatches: 2 } }));
    expect(summary).toBe(
      '$20.0M of holdings named like ETH are in tokens or on chains this tool could not identify, ' +
        'so whether the $100.0M ETH short is offset is not established. Coverage confirmed so far: 0%. ' +
        '2 holdings named like ETH could not be priced, so their size is unknown.',
    );
    expect(explain(input({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 20_000_000, unpricedMatches: 1 } })).summary).toContain(
      '1 holding named like ETH could not be priced, so its size is unknown.',
    );
  });

  it('keeps the old sentence where unrecognised dollars are what withheld it and nothing was unpriced', () => {
    const { summary } = explain(input({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 20_000_000 } }));
    expect(summary).toBe(
      '$20.0M of holdings named like ETH are in tokens or on chains this tool could not identify, ' +
        'so whether the $100.0M ETH short is offset is not established. Coverage confirmed so far: 0%.',
    );
  });

  it('says the unpriced holding withheld it when unrecognised dollars are present but below the material share', () => {
    // $3 against a $100M position is dust: the rule did not fire on it.
    const { summary } = explain(input({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 3, unpricedMatches: 1 } }));
    expect(summary).toContain('1 holding named like ETH could not be priced');
    expect(summary).not.toContain('$3 of holdings');
  });

  it('keeps an older reading\'s wording, where an unpriced holding was a matching balance', () => {
    for (const hedgeScope of ['all-chains', 'hyperliquid'] as const) {
      const { summary } = explain(input({ hedgeScope, source: 'nansen', hedge: { ...EMPTY_HEDGE, unverifiedUsd: 0, unpricedMatches: 1 } }));
      expect(summary).toBe(
        'Some holdings could not be identified, so whether the $100.0M ETH short is offset is not established. ' +
          'Coverage confirmed so far: 0%. 1 matching balance had no price, so their size is unknown.',
      );
    }
  });

  it('"Still open" does not render a $0 of holdings', () => {
    const q = openQuestion(reading({ hedge: unpricedLookAlike }));
    expect(q).toBe(
      'how much is held in 1 holding named like ETH that could not be priced. ' +
        'Hyperliquid had no price for the asset, or the staking rate could not be read; checking again may price it.',
    );
    expect(q).not.toContain('$0');
  });

  it('says the two causes in one wording, on the card and under "Still open"', () => {
    expect(PRICE_GAPS).toBe('Hyperliquid had no price for the asset, or the staking rate could not be read');
    expect(explain(input({ hedge: unpricedLookAlike })).summary).toContain(PRICE_GAPS);
    expect(openQuestion(reading({ hedge: unpricedLookAlike }))).toContain(PRICE_GAPS);
  });

  it('"Still open" counts several and keeps the dollars sentence for the identified-but-unrecognised case', () => {
    const several = openQuestion(reading({ hedge: { ...unpricedLookAlike, unpricedMatches: 2 } }));
    expect(several).toBe(
      'how much is held in 2 holdings named like ETH that could not be priced. ' +
        'Hyperliquid had no price for the asset, or the staking rate could not be read; checking again may price them.',
    );
    expect(openQuestion(reading({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 12_000_000 } }))).toBe(
      'what the $12.0M of holdings named like ETH really are: their contracts are not ones this tool recognises.',
    );
    // Unrecognised dollars that withheld it keep their sentence even when something was unpriced as well.
    expect(openQuestion(reading({ hedge: { ...EMPTY_HEDGE, unverifiedUsd: 12_000_000, unpricedMatches: 1 } }))).toContain('what the $12.0M of holdings');
  });
});
