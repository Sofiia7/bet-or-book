// The picture the audit asked for: what actually stands against the headline
// position, split by who holds it and whether this tool could identify it.
// The arithmetic is here so the drawing has nothing to decide.
import { describe, expect, it } from 'vitest';
import { exposureBreakdown } from '../../src/engine/breakdown';
import { EMPTY_HEDGE, type PositionFeatures, type HedgeFeatures, type LinkedHedgeFeatures } from '../../src/engine/features';

const positions = (over: Partial<PositionFeatures> = {}): PositionFeatures => ({
  nPositions: 1, grossUsd: 1e8, netUsd: 1e8, netToGross: 1, headlineCoin: 'ETH', headlineSide: 'short',
  headlineNotionalUsd: 1e8, headlineShare: 1, headlineLiqDistancePct: null, headlineLiqDistanceBasis: null,
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
