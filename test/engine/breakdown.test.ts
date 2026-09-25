// The picture the audit asked for: what actually stands against the headline
// position, split by who holds it and whether this tool could identify it.
// The arithmetic is here so the drawing has nothing to decide.
import { describe, expect, it } from 'vitest';
import { exposureBreakdown } from '../../src/engine/breakdown';
import { EMPTY_HEDGE, type PositionFeatures, type HedgeFeatures, type LinkedHedgeFeatures } from '../../src/engine/features';

const positions = (over: Partial<PositionFeatures> = {}): PositionFeatures => ({
  nPositions: 1, grossUsd: 1e8, netUsd: 1e8, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
  headlineNotionalUsd: 1e8, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null, netSide: null,
  sameAssetOffsetShare: 0,
    candidates: [], ...over,
});
const hedge = (over: Partial<HedgeFeatures> = {}): HedgeFeatures => ({ ...EMPTY_HEDGE, ...over });
const funders = (usd: number, n = 2): LinkedHedgeFeatures => ({
  linkedHedgeUsd: usd,
  linkedHedgeRatio: usd / 1e8,
  funders: Array.from({ length: n }, (_, i) => ({ address: `0x${i}`, relation: 'First Funder', chain: 'ethereum', matchingUsd: usd / n })),
});

describe('the position is split into what stands against it', () => {
  it('splits a partly covered short into covered and residual', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6 }), null);
    expect(b.segments).toEqual([
      { kind: 'covered', usd: 60e6, share: 0.6 },
      { kind: 'residual', usd: 40e6, share: 0.4 },
    ]);
  });

  it('shows dollars it could not identify as their own band, not as coverage', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 30e6, hedgeRatio: 0.3, unverifiedUsd: 20e6 }), null);
    expect(b.segments.map((s) => s.kind)).toEqual(['covered', 'unverified', 'residual']);
    expect(b.segments[1].usd).toBe(20e6);
    expect(b.segments[2].usd).toBe(50e6);
  });

  it('does not let unidentified dollars overflow the position', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 80e6, hedgeRatio: 0.8, unverifiedUsd: 90e6 }), null);
    expect(b.segments.reduce((sum, s) => sum + s.usd, 0)).toBe(1e8);
    expect(b.segments.find((s) => s.kind === 'residual')).toBeUndefined();
  });

  it('reports coverage past parity as an excess rather than a bigger bar', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 150e6, hedgeRatio: 1.5 }), null);
    expect(b.segments).toEqual([{ kind: 'covered', usd: 1e8, share: 1 }]);
    expect(b.excessUsd).toBe(50e6);
  });
});

describe('what someone else holds is beside the bar, not in it', () => {
  it('keeps funder holdings out of the segments and names them separately', () => {
    const b = exposureBreakdown(positions(), hedge(), funders(405e6));
    expect(b.segments).toEqual([{ kind: 'residual', usd: 1e8, share: 1 }]);
    expect(b.elsewhere).toEqual({ usd: 405e6, wallets: 2, ownership: 'unverified' });
  });

  it('leaves it out when no funder holds anything worth mentioning', () => {
    expect(exposureBreakdown(positions(), hedge(), funders(0, 2)).elsewhere).toBeNull();
    expect(exposureBreakdown(positions(), hedge(), null).elsewhere).toBeNull();
  });
});

describe('an incomplete hedge read is not looked at, not found empty (23.09 audit, L12)', () => {
  it('draws the unexplained part as not-checked when the read was partial', () => {
    const b = exposureBreakdown(positions(), hedge(), null, 'partial');
    expect(b.segments).toEqual([{ kind: 'not-checked', usd: 1e8, share: 1 }]);
  });

  it('draws the unexplained part as not-checked when the read failed outright', () => {
    const b = exposureBreakdown(positions(), hedge(), null, 'missing');
    expect(b.segments).toEqual([{ kind: 'not-checked', usd: 1e8, share: 1 }]);
  });

  it('still draws residual, not not-checked, once the read is complete', () => {
    const b = exposureBreakdown(positions(), hedge(), null, 'complete');
    expect(b.segments).toEqual([{ kind: 'residual', usd: 1e8, share: 1 }]);
  });

  it('defaults to residual for a call that predates hedgeCoverage being tracked', () => {
    const b = exposureBreakdown(positions(), hedge(), null);
    expect(b.segments).toEqual([{ kind: 'residual', usd: 1e8, share: 1 }]);
  });

  it('only marks the unexplained remainder, not dollars already covered or unverified', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6 }), null, 'partial');
    expect(b.segments).toEqual([
      { kind: 'covered', usd: 60e6, share: 0.6 },
      { kind: 'not-checked', usd: 40e6, share: 0.4 },
    ]);
  });
});

describe('a position spot cannot offset says so instead of drawing an empty bar', () => {
  it('has nothing to break down for a long', () => {
    const b = exposureBreakdown(positions({ headlineSide: 'long' }), hedge(), null);
    expect(b.applies).toBe(false);
  });

  it('has nothing to break down with no position at all', () => {
    const b = exposureBreakdown(positions({ nPositions: 0, headlineCoin: null, headlineNotionalUsd: 0 }), hedge(), null);
    expect(b.applies).toBe(false);
  });
});

describe('a data-quality flag the diagram can trust on its own (25.09 audit, A03)', () => {
  it('is measured once the read is complete and nothing is left unpriced', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6 }), null, 'complete');
    expect(b.dataQuality).toBe('measured');
  });

  it('is partial when the read did not finish, even though what was found already covers the position', () => {
    // Full dollar coverage and an unfinished read at once: residual is
    // exactly zero, so a renderer reading only the segments sees nothing
    // wrong. The flag has to say so on its own.
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 100e6, hedgeRatio: 1 }), null, 'partial');
    expect(b.segments).toEqual([{ kind: 'covered', usd: 1e8, share: 1 }]);
    expect(b.dataQuality).toBe('partial');
  });

  it('is unpriced when a matching holding has no price, even though nothing sits in the unverified segment', () => {
    // unpricedMatches is a count with no dollar value of its own - it is not
    // part of unverifiedUsd, and covered only sums holdings that did price -
    // so today's segments alone say "100% residual, nothing found" for a
    // case where a match was in fact found.
    const b = exposureBreakdown(positions(), hedge({ unpricedMatches: 1 }), null, 'complete');
    expect(b.segments).toEqual([{ kind: 'residual', usd: 1e8, share: 1 }]);
    expect(b.dataQuality).toBe('unpriced');
  });

  it('is measured for a long, which has nothing left to measure', () => {
    const b = exposureBreakdown(positions({ headlineSide: 'long' }), hedge(), null, 'partial');
    expect(b.dataQuality).toBe('measured');
  });

  it('prefers partial over unpriced when both are true at once', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6, unpricedMatches: 1 }), null, 'partial');
    expect(b.dataQuality).toBe('partial');
  });

  it('is partial when the read failed outright, same as when it was merely partial', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 100e6, hedgeRatio: 1 }), null, 'missing');
    expect(b.dataQuality).toBe('partial');
  });

  it('is unverified when a material share is matched to holdings this tool could not identify, mirroring computeVerdict\'s own unrecognised_assets check', () => {
    // 15% unverified, above DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare (0.1) -
    // verdict.ts withholds a confident verdict for exactly this reason
    // ('unrecognised_assets'), and dataQuality must agree.
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6, unverifiedUsd: 15e6 }), null, 'complete');
    expect(b.dataQuality).toBe('unverified');
  });

  it('stays measured when the unverified share is below the material threshold', () => {
    // 5% unverified, below the 0.1 threshold - dust, not a withheld finding.
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 90e6, hedgeRatio: 0.9, unverifiedUsd: 5e6 }), null, 'complete');
    expect(b.dataQuality).toBe('measured');
  });

  it('prefers partial over unverified when both are true at once', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6, unverifiedUsd: 15e6 }), null, 'partial');
    expect(b.dataQuality).toBe('partial');
  });

  it('prefers unpriced over unverified when both are true at once', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6, unverifiedUsd: 15e6, unpricedMatches: 1 }), null, 'complete');
    expect(b.dataQuality).toBe('unpriced');
  });
});
