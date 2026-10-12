import type { CheckResponse } from '../api/check';
import { compareReadings } from './compare';

export function meaningfulChanges(before: CheckResponse, after: CheckResponse): string[] {
  if (before.snapshotId === after.snapshotId || Date.parse(after.checkedAt) <= Date.parse(before.checkedAt)) return [];
  const c = compareReadings(before, after);
  if (c.questionChanged) return [];
  const notices = c.changes.map(ch => `${ch.field}: ${ch.from} → ${ch.to}`);
  if (c.verdictChange && c.verdictChange.because !== 'the rules changed') {
    notices.unshift('Interpretation changed because ' + c.verdictChange.because + '.');
  }
  if (before.degraded !== after.degraded) notices.unshift(after.degraded ? 'Data quality became incomplete.' : 'Data quality became complete.');
  return notices;
}
