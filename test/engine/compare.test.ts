// Two readings of the same address, three days apart. The point of putting
// them side by side is to separate two things that look identical on a card:
// the account did something, and this tool changed its mind.
import { describe, expect, it } from 'vitest';
import { compareReadings } from '../../src/engine/compare';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';
import type { CheckResponse } from '../../src/api/check';

const positions = (over: Partial<PositionFeatures> = {}): PositionFeatures => ({
  nPositions: 1, grossUsd: 1e8, netUsd: 1e8, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
  headlineNotionalUsd: 1e8, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null, netSide: 'short',
  sameAssetOffsetShare: 0, candidates: [], ...over,
});

const reading = (over: Partial<CheckResponse> = {}): CheckResponse =>
  ({
    address: '0xabc',
    verdict: { verdict: 'unknown', strength: null, reasons: ['linked_exposure_unverified'] },
    positions: positions(),
    orders: { ...EMPTY_ORDERS },
    hedge: { ...EMPTY_HEDGE },
    classifierVersion: 'v3',
    observedAt: '2026-09-18T12:00:00.000Z',
    checkedAt: '2026-09-18T12:00:00.000Z',
    ...over,
  }) as unknown as CheckResponse;

describe('what moved between two readings', () => {
  it('reports the position growing, with the size of the move', () => {
    const c = compareReadings(
      reading(),
      reading({ positions: positions({ headlineNotionalUsd: 2.5e8 }), observedAt: '2026-09-21T12:00:00.000Z' }),
    );
    const size = c.changes.find((x) => x.field === 'position size');
    expect(size).toMatchObject({ from: '$100.0M', to: '$250.0M', direction: 'up' });
  });

  it('reports a side flip as the different thing it is', () => {
    const c = compareReadings(reading(), reading({ positions: positions({ headlineSide: 'long' }) }));
    expect(c.changes.find((x) => x.field === 'side')).toMatchObject({ from: 'short', to: 'long' });
  });

  it('reports coverage by this address separately from anything else', () => {
    const c = compareReadings(
      reading(),
      reading({ hedge: { ...EMPTY_HEDGE, hedgeUsd: 5e7, hedgeRatio: 0.5 } }),
    );
    expect(c.changes.find((x) => x.field === 'covered by this address')).toMatchObject({ from: '0%', to: '50%' });
  });

  it('reports quoting starting or stopping', () => {
    const c = compareReadings(
      reading(),
      reading({ orders: { ...EMPTY_ORDERS, restingOrders: 300, coinsBothSides: 12, twoSidedNotionalUsd: 4e7 } }),
    );
    expect(c.changes.find((x) => x.field === 'two-sided quoting')).toMatchObject({ from: '$0', to: '$40.0M' });
  });

  it('says nothing moved when nothing did', () => {
    const c = compareReadings(reading(), reading({ checkedAt: '2026-09-21T12:00:00.000Z' }));
    expect(c.changes).toEqual([]);
    expect(c.verdictChange).toBeNull();
  });
});

describe('a change nobody could see is not a change', () => {
  it('drops a move that rounds to the same thing on the card', () => {
    // Live: coverage went from $609 to $671 of a $200M short. Both render
    // as 0.0%, and "0.0% went down to 0.0%" is noise dressed as news.
    const c = compareReadings(
      reading({ hedge: { ...EMPTY_HEDGE, hedgeUsd: 609, hedgeRatio: 609 / 1e8 } }),
      reading({ hedge: { ...EMPTY_HEDGE, hedgeUsd: 671, hedgeRatio: 671 / 1e8 } }),
    );
    expect(c.changes).toEqual([]);
  });
});

describe('a change in the answer is attributed to data or to rules', () => {
  it('calls it the account moving when the rules are the same', () => {
    const c = compareReadings(
      reading(),
      reading({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 1e8, hedgeRatio: 1 },
      }),
    );
    expect(c.verdictChange).toMatchObject({ from: 'unknown', to: 'hedged', because: 'the reading changed' });
  });

  it('calls it the rules changing when they did', () => {
    const c = compareReadings(
      reading({ classifierVersion: 'v2' }),
      reading({ verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] } }),
    );
    expect(c.verdictChange).toMatchObject({ because: 'the rules changed', fromRules: 'v2', toRules: 'v3' });
  });

  it('will not put the two down to one cause when both moved', () => {
    const c = compareReadings(
      reading({ classifierVersion: 'v2' }),
      reading({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 1e8, hedgeRatio: 1 },
      }),
    );
    expect(c.verdictChange?.because).toBe('both the reading and the rules changed');
  });

  it('does not credit a data gap to a wording fix when the change is not one of the displayed fields (23.09 audit, L11)', () => {
    // positionsCoverage moves from partial to complete alongside the rules -
    // computeVerdict reads it, but it is not one of the five-ish fields this
    // card diffs, so the old check saw no reading-side change at all.
    const c = compareReadings(
      reading({ classifierVersion: 'v2', positionsCoverage: 'partial' }),
      reading({
        verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] },
        positionsCoverage: 'complete',
      }),
    );
    expect(c.changes).toEqual([]);
    expect(c.verdictChange?.because).toBe('both the reading and the rules changed');
  });

  it('says the cause could not be established when neither the rules nor any input moved', () => {
    // A defensive case: computeVerdict is meant to be a pure function of its
    // inputs, so this should not arise from real data - only from a bug.
    // Guessing "the reading changed" here would blame the account for
    // nothing observable, and "the rules changed" would blame a version
    // string that never moved.
    const c = compareReadings(
      reading(),
      reading({ verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] } }),
    );
    expect(c.verdictChange?.because).toBe('the cause could not be established');
  });
});

describe('the two readings have to be of the same thing', () => {
  it('refuses two different addresses', () => {
    expect(() => compareReadings(reading(), reading({ address: '0xdef' }))).toThrow(/same address/);
  });

  it('puts the older one first however they are handed over', () => {
    const older = reading({ observedAt: '2026-09-18T12:00:00.000Z' });
    const newer = reading({ observedAt: '2026-09-21T12:00:00.000Z' });
    expect(compareReadings(newer, older).from.observedAt).toBe(older.observedAt);
    expect(compareReadings(older, newer).to.observedAt).toBe(newer.observedAt);
  });
});

describe('a different question is not a change at the address (23.09 audit, L02)', () => {
  it('does not report a manual BTC pick against a manual ETH pick as the position changing', () => {
    const c = compareReadings(
      reading({ focus: { coin: 'ETH', side: 'short' }, positions: positions({ headlineNotionalUsd: 1e6 }) }),
      reading({
        focus: { coin: 'BTC', side: 'long' },
        positions: positions({ headlineCoin: 'BTC', headlineSide: 'long', headlineNotionalUsd: 1e5 }),
        observedAt: '2026-09-21T12:00:00.000Z',
      }),
    );
    expect(c.questionChanged).toBe(true);
    expect(c.changes).toEqual([]);
    expect(c.verdictChange).toBeNull();
  });

  it('does not report a manual pick against the largest-position default as the position changing', () => {
    const c = compareReadings(
      reading({ focus: null }),
      reading({ focus: { coin: 'ETH', side: 'short' }, observedAt: '2026-09-21T12:00:00.000Z' }),
    );
    expect(c.questionChanged).toBe(true);
  });

  it('still lets the largest position change who it is, when neither reading was a manual pick', () => {
    const c = compareReadings(
      reading({ focus: null }),
      reading({
        focus: null,
        positions: positions({ headlineCoin: 'BTC', headlineSide: 'long', headlineNotionalUsd: 1e5 }),
        observedAt: '2026-09-21T12:00:00.000Z',
      }),
    );
    expect(c.questionChanged).toBe(false);
    expect(c.changes.find((x) => x.field === 'largest position')).toMatchObject({ from: 'ETH', to: 'BTC' });
  });
});

describe('a change of grade, and a change of rules that moved nothing', () => {
  // Found opening a demonstration reading on 24 September: a v4 "Book
  // (strong)" and a v5 "Book (likely)" of the same account came back as
  // "the answer did not change", which the badge on screen contradicted.
  it('reports a book losing its grade as the answer changing, and why', () => {
    const c = compareReadings(
      reading({
        verdict: { verdict: 'book', strength: 'strong', reasons: ['orders', 'trades'] },
        classifierVersion: 'v4',
      }),
      reading({
        verdict: { verdict: 'book', strength: 'likely', reasons: ['orders'] },
        classifierVersion: 'v5',
        positions: positions({ headlineNotionalUsd: 5e7 }),
        observedAt: '2026-09-24T07:45:00.000Z',
      }),
    );
    expect(c.verdictChange).toMatchObject({
      from: 'book',
      to: 'book',
      fromStrength: 'strong',
      toStrength: 'likely',
      because: 'both the reading and the rules changed',
    });
  });

  it('says the rules moved even when the answer did not', () => {
    const c = compareReadings(
      reading({ classifierVersion: 'v4' }),
      reading({ classifierVersion: 'v5', observedAt: '2026-09-24T07:45:00.000Z' }),
    );
    expect(c.verdictChange).toBeNull();
    expect(c.rulesChanged).toBe(true);
  });

  it('does not claim the rules moved when they did not', () => {
    const c = compareReadings(reading(), reading({ observedAt: '2026-09-24T07:45:00.000Z' }));
    expect(c.rulesChanged).toBe(false);
  });
});
