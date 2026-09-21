// A06, audit of 21.09: re-running the rules over an old aggregate is not
// the same act as re-reading the account. An observation that does not carry
// what the current rules read cannot be re-judged, and saying so is the
// whole point.
import { describe, expect, it } from 'vitest';
import { missingForCurrentRules, legacySourceCoverage, OBSERVATION_SCHEMA_VERSION } from '../../src/engine/observation';
import { EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import type { CheckResponse } from '../../src/api/check';

const base = (over: Partial<CheckResponse> = {}): CheckResponse =>
  ({
    address: '0xabc',
    positions: {
      nPositions: 1, grossUsd: 1e6, netUsd: 1e6, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
      headlineNotionalUsd: 1e6, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null,
      sameAssetOffsetShare: 0,
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
