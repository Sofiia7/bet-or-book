import { describe, expect, it } from 'vitest';
import featuredData from '../../data/featured.json';
import {
  buildConstellationModel,
  constellationInputsForOg,
  constellationSvg,
  seedFromAddress,
  type ConstellationSource,
} from '../../src/engine/constellation';

/** Only the fields this test reads out of data/featured.json - the real file
 * carries far more (evidence, vitals, pnl...), same narrowing precedent as
 * test/featured.test.ts's own `as unknown as Gallery` cast. */
interface FeaturedEntry {
  address: string;
  superseded?: boolean;
  verdict: { verdict: string };
  positions: { headlineNotionalUsd: number; headlineShare: number };
  orders: { headlineTwoSidedNotionalUsd: number };
  hedge: { hedgeRatio: number };
  breakdown?: { applies: boolean; elsewhere: { usd: number; wallets: number } | null };
}

const entries = (featuredData as unknown as { entries: FeaturedEntry[] }).entries.filter((e) => !e.superseded);

function byVerdict(verdict: string): FeaturedEntry {
  const e = entries.find((x) => x.verdict.verdict === verdict);
  if (!e) throw new Error(`No shown featured entry for verdict ${verdict} - data/featured.json may have changed`);
  return e;
}

describe('buildConstellationModel is deterministic', () => {
  it('produces identical arrays for the same seed and N', () => {
    const a = buildConstellationModel(12345, 32);
    const b = buildConstellationModel(12345, 32);
    expect(a).toEqual(b);
  });

  it('produces a different envelope for a different seed (sanity: the seed actually matters)', () => {
    const a = buildConstellationModel(1, 32);
    const b = buildConstellationModel(2, 32);
    expect(a).not.toEqual(b);
  });

  it('produces the requested number of samples', () => {
    const m = buildConstellationModel(7, 42);
    expect(m.env).toHaveLength(42);
    expect(m.jitter).toHaveLength(42);
    expect(m.mids).toHaveLength(42);
    expect(m.bokeh).toHaveLength(9);
  });
});

/**
 * web/app.js's own constellationInputsFor cannot be imported into this
 * Node/vitest test: it is a plain browser script that registers real DOM
 * event listeners at load time (e.g. $('check').addEventListener(...),
 * where $ is document.getElementById), which throws outside a browser
 * before any pure function in the file could be reached. So this cross-
 * checks constellationInputsForOg's OUTPUT against expectations derived
 * independently from each real reading's own raw fields (data/featured.json,
 * read fresh 26 September) - not by re-invoking the function under test a
 * second time, and not by re-invoking the client's function at all - so an
 * agreement here is a real cross-check of the ported logic against the
 * client's documented behaviour (see constellationInputsForOg's own doc
 * comment, which restates that behaviour verdict by verdict), not a
 * tautology.
 */
describe('constellationInputsForOg matches the client constellationInputsFor, traced against the four real featured readings (26.09 redesign, Task 6)', () => {
  it('book: coverage is matched-both-sides notional over the headline notional, dense, no ghost', () => {
    const e = byVerdict('book');
    const expectedCoverage = Math.min(1, e.orders.headlineTwoSidedNotionalUsd / e.positions.headlineNotionalUsd);
    expect(expectedCoverage).toBeGreaterThan(0);
    expect(expectedCoverage).toBeLessThan(1);
    const result = constellationInputsForOg(e as ConstellationSource);
    expect(result.seed).toBe(seedFromAddress(e.address));
    expect(result.coverage).toBeCloseTo(expectedCoverage, 10);
    expect(result.ghost).toBe(false);
    expect(result.bookDensity).toBe(true);
  });

  it('long/bet: coverage is flat 0 - spot cannot offset a long - no ghost, not dense', () => {
    const e = byVerdict('looks_like_a_bet');
    // Confirms this reading really is on the isLong path (breakdown does not
    // apply), not merely a coincidence of which reading happens to be first.
    expect(e.breakdown?.applies).toBe(false);
    const result = constellationInputsForOg(e as ConstellationSource);
    expect(result.coverage).toBe(0);
    expect(result.ghost).toBe(false);
    expect(result.bookDensity).toBe(false);
  });

  it('hedged: coverage is hedge.hedgeRatio, no elsewhere so no ghost', () => {
    const e = byVerdict('hedged');
    expect(e.breakdown?.elsewhere).toBeNull();
    expect(e.hedge.hedgeRatio).toBeGreaterThan(0.8);
    const result = constellationInputsForOg(e as ConstellationSource);
    expect(result.coverage).toBeCloseTo(e.hedge.hedgeRatio, 10);
    expect(result.ghost).toBe(false);
    expect(result.bookDensity).toBe(false);
  });

  it('unknown/funders: coverage is hedge.hedgeRatio (near zero), ghost true because breakdown.elsewhere exists', () => {
    const e = byVerdict('unknown');
    expect(e.breakdown?.elsewhere).toBeTruthy();
    const result = constellationInputsForOg(e as ConstellationSource);
    expect(result.coverage).toBeCloseTo(e.hedge.hedgeRatio, 10);
    expect(result.coverage).toBeLessThan(0.01);
    expect(result.ghost).toBe(true);
    expect(result.bookDensity).toBe(false);
  });

  it('clamps a hedge ratio past 100% to a coverage of exactly 1, never drawing past the left side', () => {
    const result = constellationInputsForOg({
      address: '0xover',
      verdict: { verdict: 'unknown' },
      positions: { headlineNotionalUsd: 100, headlineShare: 1 },
      orders: { headlineTwoSidedNotionalUsd: 0 },
      hedge: { hedgeRatio: 1.4 },
      breakdown: { applies: true, elsewhere: null },
    });
    expect(result.coverage).toBe(1);
  });
});

describe('constellationSvg', () => {
  const inputs = { seed: 42, coverage: 0.6, ghost: false, bookDensity: false };

  it('produces a well-formed, deterministic SVG string for the same inputs', () => {
    const a = constellationSvg(inputs, 1000, 260);
    const b = constellationSvg(inputs, 1000, 260);
    expect(a).toBe(b);
    expect(a).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1000" height="260"/);
    expect(a.endsWith('</svg>')).toBe(true);
  });

  it('draws a dashed ghost mirror only when ghost is true', () => {
    const withGhost = constellationSvg({ seed: 1, coverage: 0, ghost: true, bookDensity: false }, 800, 200);
    const withoutGhost = constellationSvg({ seed: 1, coverage: 0, ghost: false, bookDensity: false }, 800, 200);
    expect(withGhost).toContain('stroke-dasharray');
    expect(withoutGhost).not.toContain('stroke-dasharray');
  });

  it('draws more points when bookDensity is true - the same denser-looking cue the client uses', () => {
    const dense = constellationSvg({ seed: 5, coverage: 0.8, ghost: false, bookDensity: true }, 900, 240);
    const sparse = constellationSvg({ seed: 5, coverage: 0.8, ghost: false, bookDensity: false }, 900, 240);
    const countCircles = (svg: string) => (svg.match(/<circle/g) || []).length;
    expect(countCircles(dense)).toBeGreaterThan(countCircles(sparse));
  });

  it('never places a point outside the canvas bounds, even at full coverage', () => {
    const svg = constellationSvg({ seed: 99, coverage: 1, ghost: true, bookDensity: true }, 700, 180);
    const xs = [...svg.matchAll(/cx="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(701);
    }
  });
});
