import { expect, it } from 'vitest';
import featured from '../../data/featured.json';
import type { CheckResponse } from '../../src/api/check';
import { meaningfulChanges } from '../../src/engine/alertChanges';
const before = featured.entries.find(e => e.snapshotId === '0aio3f82kqsu9') as unknown as CheckResponse;
const after = { ...before, snapshotId: 'new-reading', checkedAt: '2026-10-09T12:00:00Z', observedAt: '2026-10-09T12:00:00Z' };
it('does not notify for a rules-only reinterpretation', () => {
  expect(meaningfulChanges(before, { ...after, classifierVersion: 'v999' })).toEqual([]);
});
it('does not treat a cache hit as a new event', () => {
  expect(meaningfulChanges(before, { ...after, snapshotId: before.snapshotId })).toEqual([]);
});
it('reports material size changes and completeness rather than every price tick', () => {
  expect(meaningfulChanges(before, { ...after, positions: { ...before.positions, headlineNotionalUsd: before.positions.headlineNotionalUsd * 0.8 } }).join(' ')).toContain('position size');
  expect(meaningfulChanges(before, { ...after, degraded: true })).toContain('Data quality became incomplete.');
  expect(meaningfulChanges(before, { ...after, positions: { ...before.positions, headlineNotionalUsd: before.positions.headlineNotionalUsd * 1.001 } })).toEqual([]);
});
it('never calls a different chosen asset a change in the previous position', () => {
  expect(meaningfulChanges(before, { ...after, focus: { coin: 'ETH', side: 'short' } })).toEqual([]);
});
