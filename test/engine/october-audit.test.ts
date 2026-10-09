import { describe, expect, it } from 'vitest';
import { readingHeadline, evidenceTakeaway } from '../../src/engine/presentation';
import { verdictInputOf } from '../../src/engine/observation';
import { computeVerdict } from '../../src/engine/verdict';
import { computePositionFeatures, EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import type { CheckResponse } from '../../src/api/check';

const positions = computePositionFeatures([]);
const reading = {
  positions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE,
  trades: { tradesPerDay: 0, crossedShare: 0, buyShare: 0 }, linkedHedge: null,
  hedgeCoverage: 'complete', ordersCoverage: 'complete', positionsCoverage: 'complete',
  checkedAt: '2026-10-09T10:00:00.000Z', positionsAsOf: '2026-10-09T09:59:00.000Z',
  verdict: { verdict: 'unknown', strength: null, reasons: ['no open positions found'] },
} as unknown as CheckResponse;

describe('October audit: date and venue scope survive presentation', () => {
  it('does not describe an empty main-dex fallback as an empty whole account', () => {
    expect(readingHeadline({ ...reading, positionsCoverage: 'partial' })).toContain('Other venues are unverified');
    expect(readingHeadline(reading)).not.toContain('right now');
  });
  it('withholds stale observations using the original check time', () => {
    const stale = { ...reading, positionsAsOf: '2026-10-09T09:45:00.000Z' };
    expect(computeVerdict(verdictInputOf(stale)).reasons).toEqual(['positions_stale']);
    expect(readingHeadline({ ...stale, verdict: computeVerdict(verdictInputOf(stale)) })).toContain('out of date');
    expect(verdictInputOf(reading).positionsStale).toBe(false);
    // Reopening tomorrow does not turn a coherent saved reading into a failed check.
    expect(verdictInputOf({ ...reading, interpretedAt: '2026-10-10T10:00:00.000Z' } as CheckResponse).positionsStale).toBe(false);
  });
  it('withholds a source timestamp implausibly ahead of the check', () => {
    expect(computeVerdict(verdictInputOf({ ...reading, positionsAsOf: '2026-10-09T11:00:00.000Z' })).reasons).toEqual(['positions_stale']);
  });
});

describe('fact-first presentation keeps exposure boundaries', () => {
  const short = { ...reading, positions: { ...reading.positions, nPositions: 1, headlineSide: 'short', headlineNotionalUsd: 100_000 },
    hedge: { ...EMPTY_HEDGE, hedgeUsd: 62_000, hedgeRatio: 0.62 },
    verdict: { verdict: 'unknown', strength: null, reasons: ['partial_offset'] } } as CheckResponse;
  it('shows the measured spot comparison without calling the remainder total unhedged exposure', () => {
    expect(readingHeadline(short)).toBe('Own matching spot covers 62% of this short. $38K has no matching spot at this address.');
    expect(evidenceTakeaway(short)).toContain('not proof of total unhedged exposure');
  });
  it.each(['partial', 'missing'] as const)('does not compute a resolved remainder with %s positions', coverage => {
    expect(readingHeadline({ ...short, positionsCoverage: coverage })).not.toContain('$38K');
  });
  it('does not compute a resolved remainder from incomplete holdings or stale positions', () => {
    expect(readingHeadline({ ...short, hedgeCoverage: 'partial' })).not.toContain('$38K');
    expect(readingHeadline({ ...short, verdict: { ...short.verdict, reasons: ['positions_stale', 'partial_offset'] } })).toContain('out of date');
  });
  it('places ownership beside the funding-wallet amount', () => {
    const linked = { ...short, verdict: { ...short.verdict, reasons: ['linked_exposure_unverified'] },
      linkedHedge: { linkedHedgeUsd: 150_000, linkedHedgeRatio: 1.5, funders: [] } };
    expect(readingHeadline(linked)).toBe('$150K of matching assets sit with funding wallets. Ownership is unverified.');
    expect(evidenceTakeaway(linked)).toContain('do not count');
  });
});
