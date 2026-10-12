import { expect, it } from 'vitest';
import { advanceSavedReading } from '../../src/engine/savedReading';

const saved = { snapshotId: 'original', checkedAt: '2026-10-08T12:00:00Z', label: 'ETH alert', previousSnapshotId: 'earlier' };
it('compares against the reading the user saved, preserving its name', () => {
  expect(advanceSavedReading(saved, { snapshotId: 'new', checkedAt: '2026-10-09T12:00:00Z' }))
    .toEqual({ ...saved, snapshotId: 'new', checkedAt: '2026-10-09T12:00:00Z', previousSnapshotId: 'original' });
});
it('a cache hit does not replace the previous reading with itself', () => {
  expect(advanceSavedReading(saved, { snapshotId: 'original', checkedAt: saved.checkedAt })).toEqual(saved);
});
it('failed snapshot storage cannot bump a real saved reading', () => {
  expect(advanceSavedReading(saved, { snapshotId: 'new', snapshotSaved: false, checkedAt: '2026-10-09T12:00:00Z' })).toBe(saved);
});
it('an older response cannot reverse the bookmark or its comparison', () => {
  expect(advanceSavedReading(saved, { snapshotId: 'older', checkedAt: '2026-10-07T12:00:00Z' })).toBe(saved);
});
it('an invalid date cannot become the new baseline', () => {
  expect(advanceSavedReading(saved, { snapshotId: 'bad', checkedAt: 'invalid' })).toBe(saved);
});
