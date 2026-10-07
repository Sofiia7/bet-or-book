import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/engine/verdict';

describe("the live board filter uses the classifier coverage boundary", () => {
  it('MATERIAL_GAP_SHARE in web/app.js matches DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare', () => {
    const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    const materialGap = source.match(/const MATERIAL_GAP_SHARE = ([\d.]+);/);
    expect(materialGap).not.toBeNull();
    expect(source).toContain("e.hedgeRatio < MATERIAL_GAP_SHARE");
    expect(Number(materialGap![1])).toBe(DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare);
  });
});
