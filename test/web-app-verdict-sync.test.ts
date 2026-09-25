// 25.09 audit, A04 follow-up: web/app.js's caption used a different number
// (1.05) than the classifier's real hedge-band boundary (DEFAULT_THRESHOLDS
// .hedged.maxHedgeRatio, 1.15) for the same line on the same diagram - two
// numbers standing for one rule, quietly drifting apart. The fix gave
// web/app.js its own HEDGE_BAND_MIN/MAX copy (it cannot import
// src/engine/verdict.ts - that file is served to the Worker as plain Text,
// see wrangler.toml's rule for web/app.js), with a comment on each side
// pointing at the other. A comment is not enforcement: this test reads the
// literal numbers out of the page's own source text and checks them against
// the rule they are meant to mirror, so a retune of one copy without the
// other fails a test instead of shipping a diagram that disagrees with the
// badge again.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/engine/verdict';

describe("the page's hedge-band constants do not drift from the classifier (25.09 audit, A04)", () => {
  it('HEDGE_BAND_MIN/MAX in web/app.js match DEFAULT_THRESHOLDS.hedged exactly', () => {
    const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    const min = source.match(/const HEDGE_BAND_MIN = ([\d.]+);/);
    const max = source.match(/const HEDGE_BAND_MAX = ([\d.]+);/);
    expect(min).not.toBeNull();
    expect(max).not.toBeNull();
    expect(Number(min![1])).toBe(DEFAULT_THRESHOLDS.hedged.minHedgeRatio);
    expect(Number(max![1])).toBe(DEFAULT_THRESHOLDS.hedged.maxHedgeRatio);
  });

  it('MATERIAL_GAP_SHARE in web/app.js matches DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare', () => {
    const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    const materialGap = source.match(/const MATERIAL_GAP_SHARE = ([\d.]+);/);
    expect(materialGap).not.toBeNull();
    expect(Number(materialGap![1])).toBe(DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare);
  });
});
