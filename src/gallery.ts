import type { CheckResponse } from './api/check';

/** Snapshot written by scripts/prescan.ts and bundled into the Worker. Each
 * entry is exactly what /api/check returned for that address at its own
 * `checkedAt`. */
export interface Gallery {
  scannedAt: string | null;
  finishedAt: string | null;
  universe: string;
  entries: CheckResponse[];
}
