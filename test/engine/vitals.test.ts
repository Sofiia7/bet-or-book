import { describe, expect, it } from 'vitest';
import { computeVitals, type VitalsInput } from '../../src/engine/vitals';
import type { Position } from '../../src/types';

function position(overrides: Partial<Position> = {}): Position {
  return {
    coin: 'ETH',
    side: 'short',
    sizeUsd: 100_000_000,
    entryPx: 2500,
    leverage: 5,
    leverageType: 'cross',
    liquidationPx: 3400,
    unrealizedPnlUsd: -1_200_000,
    cumFundingUsd: -340_000,
    ...overrides,
  };
}

function input(overrides: Partial<VitalsInput> = {}): VitalsInput {
  return {
    headline: position(),
    headlineLiqDistancePct: 0.36,
    headlineLiqDistanceBasis: 'mark',
    positionsSource: 'Nansen',
    sizeVsOi: 0.032,
    headlineOpenedUsd: 1_400_000,
    headlineClosedUsd: 300_000,
    headlineFills: 2,
    tradesSpanHours: 3.4,
    ...overrides,
  };
}

describe('computeVitals', () => {
  it('returns nothing when there is no headline position', () => {
    expect(computeVitals(input({ headline: null }))).toEqual([]);
  });

  it('reports leverage with its type', () => {
    const v = computeVitals(input());
    expect(v).toContainEqual({ label: 'Leverage', value: '5x cross', source: 'Nansen' });
  });

  it('names the source the positions themselves came from, not always Nansen', () => {
    const v = computeVitals(input({ positionsSource: 'Hyperliquid' }));
    expect(v).toContainEqual(expect.objectContaining({ label: 'Leverage', source: 'Hyperliquid' }));
  });

  it('reports distance to liquidation with the basis it was measured from', () => {
    const v = computeVitals(input());
    expect(v).toContainEqual({ label: 'Distance to liquidation', value: '36% (from mark)', source: 'Nansen' });
  });

  it('falls back to the entry-price basis when no mark price is available', () => {
    const v = computeVitals(input({ headlineLiqDistanceBasis: 'entry' }));
    expect(v).toContainEqual(expect.objectContaining({ value: '36% (from entry)' }));
  });

  it('omits distance to liquidation when the position carries no liquidation price', () => {
    const v = computeVitals(input({ headlineLiqDistancePct: null, headlineLiqDistanceBasis: null }));
    expect(v.some((i) => i.label === 'Distance to liquidation')).toBe(false);
  });

  it('reports unrealized PnL, negative sign and all', () => {
    const v = computeVitals(input());
    expect(v).toContainEqual({ label: 'Unrealized PnL', value: '-$1.2M', source: 'Nansen' });
  });

  it('reports funding since open', () => {
    const v = computeVitals(input());
    expect(v).toContainEqual({ label: 'Funding since open', value: '-$340K', source: 'Nansen' });
  });

  it('reports positive funding received as a positive number', () => {
    const v = computeVitals(input({ headline: position({ cumFundingUsd: 82_000 }) }));
    expect(v).toContainEqual(expect.objectContaining({ label: 'Funding since open', value: '$82K' }));
  });

  it('reports size versus open interest, always attributed to Hyperliquid', () => {
    const v = computeVitals(input({ positionsSource: 'Nansen', sizeVsOi: 0.41 }));
    expect(v).toContainEqual({ label: 'Size vs open interest', value: '41%', source: 'Hyperliquid' });
  });

  it('omits size versus open interest when it could not be computed', () => {
    const v = computeVitals(input({ sizeVsOi: null }));
    expect(v.some((i) => i.label === 'Size vs open interest')).toBe(false);
  });

  it('reports the headline coin\'s own recent flow, opened and closed, with the span it covers', () => {
    const v = computeVitals(input());
    expect(v).toContainEqual({ label: 'Position flow', value: '$1.4M opened, $300K closed (3.4h)', source: 'Hyperliquid' });
  });

  it('names only the side that actually happened', () => {
    const v = computeVitals(input({ headlineClosedUsd: 0 }));
    expect(v).toContainEqual(expect.objectContaining({ label: 'Position flow', value: '$1.4M opened (3.4h)' }));
  });

  it('says so when the headline coin saw no fills at all - itself a finding, not a gap', () => {
    const v = computeVitals(input({ headlineOpenedUsd: 0, headlineClosedUsd: 0, headlineFills: 0 }));
    expect(v).toContainEqual(expect.objectContaining({ label: 'Position flow', value: 'no fills (3.4h)' }));
  });

  it('does not call it "no fills" when a fill happened but did not open or close - a flip (23.09 audit, L10)', () => {
    // "Long > Short" on Hyperliquid is neither Open nor Close, so both sums
    // are zero even though the position clearly changed hands.
    const v = computeVitals(input({ headlineOpenedUsd: 0, headlineClosedUsd: 0, headlineFills: 1 }));
    expect(v).toContainEqual(
      expect.objectContaining({ label: 'Position flow', value: '1 fill, change in exposure not determined (3.4h)' }),
    );
  });

  it('keeps one decimal at every magnitude, so a span under an hour does not round to zero', () => {
    const v = computeVitals(input({ tradesSpanHours: 0.52 }));
    expect(v.find((i) => i.label === 'Position flow')?.value).toMatch(/\(0\.5h\)$/);
  });

  it('is always attributed to Hyperliquid: fills are never a Nansen field', () => {
    const v = computeVitals(input({ positionsSource: 'Nansen' }));
    expect(v.find((i) => i.label === 'Position flow')?.source).toBe('Hyperliquid');
  });

  it('has no five-item cap: a position still gets all six vitals', () => {
    const v = computeVitals(input());
    expect(v.length).toBe(6);
  });
});
