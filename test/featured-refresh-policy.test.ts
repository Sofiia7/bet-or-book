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
it('keeps a dated example when a Hyperliquid dex did not answer, whatever the source', () => {
  const venues = { asked: 6, answered: 5, registryRead: true };
  // One dex failed: the positions are partial, with or without Nansen.
  expect(usableFeaturedRefresh(previous, { ...next, source: 'nansen', positionsCoverage: 'partial', positionsVenues: venues })).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, source: 'hyperliquid', positionsCoverage: 'partial', positionsVenues: venues })).toBe(false);
  // Every dex answered and nothing was cut short: a refreshed example. A
  // check makes no Nansen call now, so its source is 'hyperliquid'.
  expect(usableFeaturedRefresh(previous, { ...next, source: 'hyperliquid', positionsCoverage: 'complete', positionsVenues: { ...venues, answered: 6 } })).toBe(true);
  // An unread funding-link chain makes the reading degraded: kept.
  expect(usableFeaturedRefresh(previous, { ...next, source: 'hyperliquid', positionsCoverage: 'complete', positionsVenues: { ...venues, answered: 6 }, degraded: true })).toBe(false);
});
it('cannot replace an example with older evidence or another wallet', () => {
  expect(usableFeaturedRefresh(previous, previous)).toBe(false);
  expect(usableFeaturedRefresh(previous, { ...next, address: '0x' + '1'.repeat(40) })).toBe(false);
});
it('keeps a dated example when the new reading is thinner: a funding-link chain or the PnL was not read', () => {
  // A long's unread explorer chain and a skipped PnL are context notes, not
  // failures, so the reading is not degraded; a featured example must still
  // not be replaced by it.
  const clean = { ...next, degraded: false, coverage: [], coverageNotes: [] };
  expect(usableFeaturedRefresh(previous, clean)).toBe(true);
  for (const text of [
    'Funding links on Arbitrum were not read: no explorer key is configured',
    'PnL was not read: this check ran out of time',
  ]) {
    expect(usableFeaturedRefresh(previous, { ...clean, coverageNotes: [{ text, failure: false }] }), text).toBe(false);
    expect(usableFeaturedRefresh(previous, { ...clean, coverage: [text] }), text).toBe(false);
  }
});
