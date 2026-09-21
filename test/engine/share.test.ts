// U01, audit of 21.09: a shared picture travels without the page around it,
// and the page's standing warning about what nobody can see was being left
// behind. What a card says has to survive being turned into an image.
import { describe, expect, it } from 'vitest';
import { shareCard, PERMANENT_LIMIT } from '../../src/engine/share';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';
import type { CheckResult } from '../../src/api/check';
import type { EvidenceItem } from '../../src/engine/evidence';

const positions: PositionFeatures = {
  nPositions: 1, grossUsd: 1e8, netUsd: 1e8, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
  headlineNotionalUsd: 1e8, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null,
  sameAssetOffsetShare: 0,
};

const evidence: EvidenceItem[] = [
  { label: 'Largest position', value: '$100.0M ETH short', source: 'Nansen' },
  { label: 'Share of exposure', value: '100%', source: 'Nansen' },
  { label: 'Net / gross exposure', value: '100%', source: 'Nansen' },
  { label: 'Hedge found', value: '0%', source: 'Nansen' },
  { label: 'Linked wallets', value: '$405.0M ETH in 2 wallets, owner unconfirmed', source: 'Nansen', decisive: true },
];

const result = (over: Partial<CheckResult> = {}): CheckResult =>
  ({
    address: '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36',
    verdict: { verdict: 'unknown', strength: null, reasons: ['linked_exposure_unverified'] },
    positions,
    orders: { ...EMPTY_ORDERS },
    hedge: { ...EMPTY_HEDGE },
    evidence,
    coverage: [],
    coverageNotes: [],
    checkedAt: '2026-09-21T12:00:00.000Z',
    observedAt: '2026-09-21T11:58:00.000Z',
    classifierVersion: 'v3',
    ...over,
  }) as unknown as CheckResult;

describe('the standing limit is on every card', () => {
  it('keeps it even when nothing else went wrong', () => {
    const card = shareCard(result(), { kind: 'live' });
    expect(card.limits[0]).toBe(PERMANENT_LIMIT);
    // The old line was "Everything this tool reads was read in full", which
    // is true of the reading and false about the account.
    expect(card.limits.join(' ')).not.toContain('read in full');
  });

  it('keeps it in front of whatever else the check could not read', () => {
    const card = shareCard(
      result({
        coverageNotes: [
          { text: 'Open interest unavailable', failure: false },
          { text: 'Holdings on other chains unavailable', failure: true },
        ],
      }),
      { kind: 'live' },
    );
    expect(card.limits[0]).toBe(PERMANENT_LIMIT);
    // A gap that cost the answer something comes before one that did not.
    expect(card.limits[1]).toContain('Holdings on other chains');
  });

  it('says how many it left out rather than implying there were none', () => {
    const notes = Array.from({ length: 6 }, (_, i) => ({ text: `note ${i}`, failure: true }));
    const card = shareCard(result({ coverageNotes: notes }), { kind: 'live' });
    expect(card.limits.length).toBeLessThanOrEqual(3);
    expect(card.more).toBeGreaterThan(0);
  });
});

describe('a card carries what it is a reading of', () => {
  it('states the observation time and where the reading came from', () => {
    const card = shareCard(result(), { kind: 'saved', origin: 'https://bet-or-book.test', snapshotId: 'abc123xyz45' });
    expect(card.provenance).toContain('21 Sept');
    expect(card.provenance).toContain('saved reading');
    expect(card.link).toBe('https://bet-or-book.test/?s=abc123xyz45');
  });

  it('says a live reading is a live one, and offers no link without an id', () => {
    const card = shareCard(result(), { kind: 'live' });
    expect(card.provenance).toContain('checked live');
    expect(card.link).toBeNull();
  });

  it('marks a historical card as read by the rules of its time', () => {
    const card = shareCard(
      result({ historical: { reason: 'predates the rules', missing: ['hedge.unverifiedUsd'] }, classifierVersion: 'v2' }),
      { kind: 'gallery' },
    );
    expect(card.provenance).toContain('v2');
    expect(card.limits.join(' ')).toContain('predates the rules');
  });
});

describe('the picture shows the evidence that decided it', () => {
  it('includes the decisive row even when it is not among the first four', () => {
    const card = shareCard(result(), { kind: 'live' });
    expect(card.evidence).toHaveLength(4);
    expect(card.evidence.map((e) => e.label)).toContain('Linked wallets');
  });

  it('falls back to the given order when nothing is marked decisive', () => {
    const plain = evidence.map((e) => ({ ...e, decisive: undefined }));
    const card = shareCard(result({ evidence: plain }), { kind: 'live' });
    expect(card.evidence.map((e) => e.label)).toEqual([
      'Largest position',
      'Share of exposure',
      'Net / gross exposure',
      'Hedge found',
    ]);
  });
});
