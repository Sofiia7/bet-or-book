import { describe, expect, it } from 'vitest';
import { ogCardData } from '../../src/engine/ogCard';
import type { VerdictResult } from '../../src/engine/verdict';
import type { ExposureBreakdown } from '../../src/engine/breakdown';

function verdict(overrides: Partial<VerdictResult> = {}): VerdictResult {
  return { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'], ...overrides };
}

/** The base fixture is a long: nPositions 1, headlineSide 'long', no
 * breakdown - the same "$42.1M ZEC long" the summary text below describes,
 * and, since Task 6, itself a real constellation case (coverage 0, spot
 * cannot offset a long) rather than a no-diagram one. Tests that need a
 * genuinely diagram-less reading (nothing open) or a short/hedge-shaped one
 * override `positions`/`orders`/`hedge`/`breakdown` explicitly rather than
 * relying on this default. */
function input(overrides: Record<string, unknown> = {}) {
  return {
    address: '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36',
    verdict: verdict(),
    summary: '93% of the exposure is one $42.1M ZEC long.',
    classifierVersion: 'v4',
    breakdown: undefined as ExposureBreakdown | undefined,
    positions: { nPositions: 1, headlineNotionalUsd: 42_100_000, headlineShare: 0.93, headlineSide: 'long' as const },
    orders: { headlineTwoSidedNotionalUsd: 0 },
    hedge: { hedgeRatio: 0 },
    provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4',
    limitText: null as string | null,
    ...overrides,
  };
}

describe('ogCardData', () => {
  it('names the badge with its strength when there is one', () => {
    const d = ogCardData(input({ verdict: verdict({ verdict: 'book', strength: 'strong', reasons: ['orders'] }) }));
    expect(d.badgeText).toBe('Book (strong)');
  });

  it('names the badge with no strength for a hedge', () => {
    const d = ogCardData(input({ verdict: verdict({ verdict: 'hedged', strength: null, reasons: ['hedge_leg'] }) }));
    expect(d.badgeText).toBe('Hedged');
  });

  it('picks the accent colour that matches the page for each verdict (26.09 redesign: the dark-theme fixed hex, same four values web/app.js\'s VERDICTS[...].accent now reads)', () => {
    expect(ogCardData(input({ verdict: verdict({ verdict: 'book' }) })).accent).toBe('#7fa2ff');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'hedged' }) })).accent).toBe('#4fe0b0');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'looks_like_a_bet' }) })).accent).toBe('#f2b35c');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'unknown' }) })).accent).toBe('#a3a8b6');
  });

  it('carries the summary sentence untouched', () => {
    const d = ogCardData(input());
    expect(d.summary).toBe('93% of the exposure is one $42.1M ZEC long.');
  });

  it('shortens the address for the footer, with the rules version', () => {
    const d = ogCardData(input());
    expect(d.footerLeft).toBe('0xb83d...6e36 · rules v4');
  });

  it('carries the date and reading kind through untouched, from shareCard (23.09 audit, U02)', () => {
    const d = ogCardData(input());
    expect(d.provenance).toBe('Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4');
  });

  it('carries a specific caveat when the reading has one, and none when it does not', () => {
    expect(ogCardData(input()).limitText).toBeNull();
    const d = ogCardData(input({ limitText: 'Snapshot from the gallery scan, read by the rules of the time (v3).' }));
    expect(d.limitText).toBe('Snapshot from the gallery scan, read by the rules of the time (v3).');
  });

  it('draws no constellation when there are no open positions - the one case with nothing to draw', () => {
    const d = ogCardData(
      input({
        positions: { nPositions: 0, headlineNotionalUsd: 0, headlineShare: 0, headlineSide: null },
        breakdown: { applies: false, coin: null, side: null, headlineUsd: 0, segments: [], excessUsd: 0, elsewhere: null, dataQuality: 'measured' },
      }),
    );
    expect(d.constellation).toBeNull();
    expect(d.constellationStat).toBeNull();
  });

  it('draws a constellation with flat 0 coverage for a long - breakdown.applies is false, but this is not the no-diagram case (26.09 redesign, Task 6: the old segments-array test for this exact input asserted the opposite, before the diagram gained a long-position treatment in Task 2)', () => {
    const d = ogCardData(input()); // base fixture: nPositions 1, headlineSide 'long', no breakdown
    expect(d.constellation).not.toBeNull();
    expect(d.constellation?.coverage).toBe(0);
    expect(d.constellation?.ghost).toBe(false);
    expect(d.constellationStat).toEqual({ value: '0%', label: 'covered' });
  });

  it('draws a constellation for a book verdict regardless of breakdown.applies, densely, using matched-both-sides coverage', () => {
    const d = ogCardData(
      input({
        verdict: verdict({ verdict: 'book', strength: 'strong', reasons: ['orders'] }),
        positions: { nPositions: 40, headlineNotionalUsd: 52_023_382, headlineShare: 0.33, headlineSide: 'short' as const },
        orders: { headlineTwoSidedNotionalUsd: 41_608_599 },
      }),
    );
    expect(d.constellation).toEqual({ seed: expect.any(Number), coverage: expect.closeTo(0.7998, 3), ghost: false, bookDensity: true });
    expect(d.constellationStat?.label).toBe('quoted both sides');
  });

  it('draws a constellation for a short with hedge.hedgeRatio as coverage, clamped to [0,1]', () => {
    const d = ogCardData(
      input({
        verdict: verdict({ verdict: 'hedged', strength: null, reasons: ['hedge_leg'] }),
        positions: { nPositions: 1, headlineNotionalUsd: 100, headlineShare: 1, headlineSide: 'short' as const },
        breakdown: { applies: true, coin: 'ETH', side: 'short', headlineUsd: 100, segments: [{ kind: 'covered', usd: 99, share: 0.99 }], excessUsd: 0, elsewhere: null, dataQuality: 'measured' },
        hedge: { hedgeRatio: 1.4 },
      }),
    );
    expect(d.constellation?.coverage).toBe(1);
    expect(d.constellationStat).toEqual({ value: '100%', label: 'covered' });
  });

  it('labels a partial holdings read as found coverage on the share image', () => {
    const d = ogCardData(
      input({
        positions: { nPositions: 1, headlineNotionalUsd: 100, headlineShare: 1, headlineSide: 'short' as const },
        breakdown: { applies: true, coin: 'ETH', side: 'short', headlineUsd: 100, segments: [{ kind: 'covered', usd: 0.01, share: 0.0001 }, { kind: 'not-checked', usd: 99.99, share: 0.9999 }], excessUsd: 0, elsewhere: null, dataQuality: 'partial' },
        hedge: { hedgeRatio: 0.0001 },
      }),
    );
    expect(d.dataQuality).toBe('partial');
    expect(d.constellationStat).toEqual({ value: '<0.1%', label: 'found coverage' });
  });

  it('reports measured when the breakdown does not apply, same as a plain missing breakdown', () => {
    expect(ogCardData(input({ breakdown: undefined })).dataQuality).toBe('measured');
  });
});

describe('what a funder holds, on the picture as on the page (26.09 redesign: the ghost mirror inside the constellation replaces the old separate dashed box - see OgCardData.constellation\'s own doc comment for why no separate amount/caption field replaced it)', () => {
  const shortWithElsewhere = (elsewhere: { usd: number; wallets: number } | null) => ({
    verdict: verdict({ verdict: 'unknown', reasons: ['linked_exposure_unverified'] }),
    positions: { nPositions: 1, headlineNotionalUsd: 209_121_627, headlineShare: 0.35, headlineSide: 'short' as const },
    breakdown: {
      applies: true,
      coin: 'ETH',
      side: 'short' as const,
      headlineUsd: 209_121_627,
      segments: [{ kind: 'residual' as const, usd: 209_121_627, share: 1 }],
      excessUsd: 0,
      elsewhere: elsewhere ? { ...elsewhere, ownership: 'unverified' as const } : null,
      dataQuality: 'measured' as const,
    },
    hedge: { hedgeRatio: 0 },
  });

  it('sets ghost true when a funder holds a matching amount', () => {
    const d = ogCardData(input(shortWithElsewhere({ usd: 443_676_085, wallets: 2 })));
    expect(d.constellation?.ghost).toBe(true);
  });

  it('sets ghost false when nothing is held elsewhere', () => {
    const d = ogCardData(input(shortWithElsewhere(null)));
    expect(d.constellation?.ghost).toBe(false);
  });

  it('draws no constellation at all for a short with no breakdown - an old reading from before breakdown existed cannot say whether one would have applied, and headlineSide alone is not enough to draw isLong\'s flat-0 treatment, which is specifically for a long', () => {
    const d = ogCardData(
      input({
        verdict: verdict({ verdict: 'unknown', reasons: ['linked_exposure_unverified'] }),
        positions: { nPositions: 1, headlineNotionalUsd: 209_121_627, headlineShare: 0.35, headlineSide: 'short' as const },
        breakdown: undefined,
        hedge: { hedgeRatio: 0 },
      }),
    );
    expect(d.constellation).toBeNull();
  });
});
