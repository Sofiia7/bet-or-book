// Two readings of the same address, three days apart. The point of putting
// them side by side is to separate two things that look identical on a card:
// the account did something, and this tool changed its mind.
import { describe, expect, it } from 'vitest';
import { compareReadings } from '../../src/engine/compare';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';
import type { CheckResponse } from '../../src/api/check';

const positions = (over: Partial<PositionFeatures> = {}): PositionFeatures => ({
  nPositions: 1, grossUsd: 1e8, netUsd: 1e8, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
  headlineNotionalUsd: 1e8, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null,
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
