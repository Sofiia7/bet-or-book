import { expect, it } from 'vitest';
import featured from '../data/featured.json';
import type { CheckResponse } from '../src/api/check';
import { featuredQuestion, usableFeaturedRefresh } from '../scripts/featured-refresh-policy';

const previous = featured.entries.find(e => !e.superseded)! as CheckResponse;
const next = { ...previous, checkedAt: '2026-10-09T17:00:00Z' };
it('pins a default-headline example to its original asset and side', () => {
  expect(featuredQuestion({ ...previous, focus: null })).toEqual({ coin: previous.positions.headlineCoin, side: previous.positions.headlineSide });
  expect(usableFeaturedRefresh(previous, next)).toBe(true);
  expect(usableFeaturedRefresh(previous, { ...next, positions: { ...next.positions, headlineCoin: 'BTC' } })).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, positions: { ...next.positions, headlineSide: 'short' } })).toBe(false);
});
it('keeps a dated example when the selected position closed or evidence is incomplete', () => {
  expect(usableFeaturedRefresh(previous, { ...next, positions: { ...next.positions, headlineCoin: null, headlineSide: null, nPositions: 0 } })).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, positionsCoverage: 'partial' })).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, degraded: true })).toBe(false);
});
it('cannot replace an example with older evidence or another wallet', () => {
  expect(usableFeaturedRefresh(previous, previous)).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, address: '0x' + '1'.repeat(40) })).toBe(false);
});
