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

/**
 * One line of the gallery's list: what a row shows and nothing more.
 *
 * /api/gallery used to send every card whole - every explanation, every
 * evidence row, every coverage note, 730 KB of JSON - so the page could draw
 * twenty-five rows of one line each. A card is opened on click through
 * /api/snapshot, which answers gallery ids from the bundle for free (23.09
 * audit, "code and architecture"). Account PnL is not in a row any more: the
 * account's thirty days are not evidence about what one position is (U06).
 */
export interface GalleryRow {
  snapshotId: string;
  address: string;
  checkedAt: string;
  classifierVersion: string;
  verdict: Pick<CheckResponse['verdict'], 'verdict' | 'strength'>;
  positions: Pick<CheckResponse['positions'], 'headlineCoin' | 'headlineSide' | 'headlineNotionalUsd' | 'nPositions'>;
  historical?: { reason: string };
  supersedes?: string;
}

export interface GalleryIndex {
  scannedAt: string | null;
  finishedAt: string | null;
  universe: string;
  entries: GalleryRow[];
}

/**
 * The id of the reading a new one of `address` follows in `earlier`: the
 * newest there that has not itself been replaced and asked the same
 * question - the largest position, since a scan never asks about a
 * particular one. What a card compares itself against when it says what
 * changed (src/engine/compare.ts).
 */
export function previousReadingId(
  earlier: CheckResponse[],
  address: string,
  idOf: (e: CheckResponse) => string,
): string | null {
  const same = earlier
    .filter((e) => e.address === address && !e.superseded && !e.focus)
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1));
  return same.length ? idOf(same[0]) : null;
}

/** The list the page draws: every reading that has not since been read
 * again, as rows. `idOf` is how the Worker keys a card that predates stored
 * ids, so a row always opens the card it names. */
export function galleryIndex(gallery: Gallery, idOf: (e: CheckResponse) => string): GalleryIndex {
  return {
    scannedAt: gallery.scannedAt,
    finishedAt: gallery.finishedAt,
    universe: gallery.universe,
    entries: gallery.entries
      .filter((e) => !e.superseded)
      .map((e) => ({
        snapshotId: idOf(e),
        address: e.address,
        checkedAt: e.checkedAt,
        classifierVersion: e.classifierVersion,
        verdict: { verdict: e.verdict.verdict, strength: e.verdict.strength },
        positions: {
          headlineCoin: e.positions.headlineCoin,
          headlineSide: e.positions.headlineSide,
          headlineNotionalUsd: e.positions.headlineNotionalUsd,
          nPositions: e.positions.nPositions,
        },
        ...(e.historical ? { historical: { reason: e.historical.reason } } : {}),
        ...(e.supersedes ? { supersedes: e.supersedes } : {}),
      })),
  };
}
