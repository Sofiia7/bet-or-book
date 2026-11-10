// A06, audit of 21.09: re-running the rules over an old aggregate is not
// the same act as re-reading the account. An observation that does not carry
// what the current rules read cannot be re-judged, and saying so is the
// whole point.
import { describe, expect, it } from 'vitest';
import { missingForCurrentRules, legacySourceCoverage, verdictInputOf, OBSERVATION_SCHEMA_VERSION } from '../../src/engine/observation';
import { EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import { computeVerdict } from '../../src/engine/verdict';
import { interpret, present, words } from '../../src/engine/interpret';
import featuredData from '../../data/featured.json';
import type { Gallery } from '../../src/gallery';
import type { CheckResponse } from '../../src/api/check';

// The bundled demonstration readings were made before `positionsVenues`
// existed: real stored observations, one of each kind of answer.
const stored = (featuredData as unknown as Gallery).entries.filter((e) => !e.superseded);

const base = (over: Partial<CheckResponse> = {}): CheckResponse =>
  ({
    address: '0xabc',
    positions: {
      nPositions: 1, grossUsd: 1e6, netUsd: 1e6, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
      headlineNotionalUsd: 1e6, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null,
      sameAssetOffsetShare: 0,
    candidates: [],
    },
    orders: { ...EMPTY_ORDERS },
    hedge: { ...EMPTY_HEDGE },
    hedgeScope: 'all-chains',
    hedgeCoverage: 'complete',
    coverage: [],
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    ...over,
  }) as unknown as CheckResponse;

describe('an observation is checked against what the rules now read', () => {
  it('passes one written by the current reader', () => {
    expect(missingForCurrentRules(base())).toEqual([]);
  });

  it('does not rejudge pre-loan observations as if no liability was found', () => {
    const e = base({ observationSchemaVersion: 3 });
    delete e.hedge.hasUnresolvedLiability;
    expect(missingForCurrentRules(e)).toContain('hedge.hasUnresolvedLiability');
  });

  it('can rejudge schema 5 when the loan read was clean and funder coverage is recorded', () => {
    const e = base({ observationSchemaVersion: 5, linkedHedgeCoverage: 'complete' });
    delete e.hedge.hasUnresolvedLiability;
    expect(missingForCurrentRules(e)).toEqual([]);
    e.coverage = ['1,000 HYPE is owed on Hyperliquid spot - borrowed and not held'];
    expect(missingForCurrentRules(e)).toContain('hedge.hasUnresolvedLiability');
  });

  it('does not invent completeness for a legacy funding-wallet search', () => {
    const e = base({ observationSchemaVersion: 5, linkedHedgeCoverage: undefined });
    expect(missingForCurrentRules(e)).toContain('linkedHedgeCoverage');
  });

  it('flags a hedge aggregate with no record of what was left out', () => {
    const e = base({ hedge: { hedgeUsd: 5e5, hedgeRatio: 0.5 } as never, observationSchemaVersion: undefined });
    expect(missingForCurrentRules(e)).toContain('hedge.unverifiedUsd');
  });

  it('does not ask for that record where no on-chain balance was ever read', () => {
    // Hyperliquid-only scope means no contract could have been unrecognised.
    const e = base({
      hedge: { hedgeUsd: 5e5, hedgeRatio: 0.5 } as never,
      hedgeScope: 'hyperliquid',
      observationSchemaVersion: undefined,
    });
    expect(missingForCurrentRules(e)).not.toContain('hedge.unverifiedUsd');
  });

  it('flags a book-sized order count with no notional behind it', () => {
    const e = base({
      orders: { restingOrders: 1732, bidShare: 0.5, coinsBothSides: 40 } as never,
      observationSchemaVersion: undefined,
    });
    expect(missingForCurrentRules(e)).toContain('orders.twoSidedNotionalUsd');
  });

  it('does not ask for it where too few orders rested to decide anything', () => {
    const e = base({
      orders: { restingOrders: 3, bidShare: 0.5, coinsBothSides: 1 } as never,
      observationSchemaVersion: undefined,
    });
    expect(missingForCurrentRules(e)).not.toContain('orders.twoSidedNotionalUsd');
  });

});

describe('a stored observation written before positionsVenues was recorded', () => {
  it('a stored observation without positionsVenues still reads', () => {
    expect(stored.length).toBeGreaterThan(0);
    for (const e of stored) {
      expect(e, e.address).not.toHaveProperty('positionsVenues');
      // The same functions a live reading goes through give the same answer.
      expect(computeVerdict(verdictInputOf(e)), e.address).toEqual(e.verdict);
      expect(words(e).evidence, e.address).toEqual(e.evidence);
      expect(missingForCurrentRules(e), e.address).toEqual(
        missingForCurrentRules({ ...e, positionsVenues: { asked: 1, answered: 1, registryRead: true } }),
      );
      // Presenting it does not invent the field, not even as `undefined`.
      const shown = present(interpret(e, e.interpretedAt), { kind: 'live' });
      expect(Object.keys(shown), e.address).not.toContain('positionsVenues');
      expect(shown.evidence, e.address).toEqual(e.evidence);
    }
  });

  it('carries positionsVenues through present() when the observation has it', () => {
    const positionsVenues = { asked: 5, answered: 4, registryRead: true };
    const e = stored[0];
    const shown = present(interpret({ ...e, positionsVenues }, e.interpretedAt), { kind: 'live' });
    expect(shown.positionsVenues).toEqual(positionsVenues);
    // The position tiles now say where the positions were really read.
    expect(shown.evidence.find((i) => i.label === 'Largest position')?.source).toBe('Hyperliquid');
  });
});

describe('coverage fields a scan predates are read back from its own notes', () => {
  it('reads a failed HIP-3 order read out of the notes it wrote at the time', () => {
    const failed = base({
      ordersCoverage: undefined,
      coverage: ['Resting orders on the xyz dex could not be read'],
    });
    expect(legacySourceCoverage(failed).orders).toBe('partial');
    expect(missingForCurrentRules(failed)).toEqual([]);
  });

  it('reads a Hyperliquid fallback as a main-dex-only position read', () => {
    const fallback = base({
      positionsCoverage: undefined,
      coverage: ['Nansen positions unavailable: positions read from Hyperliquid, main dex only'],
    });
    expect(legacySourceCoverage(fallback).positions).toBe('partial');
  });

  it('leaves a clean scan complete', () => {
    const clean = base({ ordersCoverage: undefined, positionsCoverage: undefined });
    expect(legacySourceCoverage(clean)).toEqual({ orders: 'complete', positions: 'complete' });
  });
});

describe('a known-tokens reading is checked like an all-chains one', () => {
  it('lists a missing unverifiedUsd', () => {
    const e = base({ hedge: { hedgeUsd: 5e5, hedgeRatio: 0.5 } as never, hedgeScope: 'known-tokens', observationSchemaVersion: undefined });
    expect(missingForCurrentRules(e)).toContain('hedge.unverifiedUsd');
  });
});
