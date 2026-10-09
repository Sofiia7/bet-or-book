export interface SavedReading {
  snapshotId: string | null;
  checkedAt: string | null;
  previousSnapshotId?: string | null;
}

/** Advance a browser bookmark only to a durably saved, non-older reading. */
export function advanceSavedReading<T extends SavedReading>(saved: T, reading: {
  snapshotId?: string; snapshotSaved?: boolean; checkedAt: string;
}): T {
  if (!reading.snapshotId || reading.snapshotSaved === false || !Number.isFinite(Date.parse(reading.checkedAt))) return saved;
  if (saved.checkedAt && Date.parse(reading.checkedAt) < Date.parse(saved.checkedAt)) return saved;
  return { ...saved, snapshotId: reading.snapshotId, checkedAt: reading.checkedAt,
    previousSnapshotId: saved.snapshotId && saved.snapshotId !== reading.snapshotId
      ? saved.snapshotId : saved.previousSnapshotId || null };
}
