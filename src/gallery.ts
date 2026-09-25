import type { CheckResponse } from './api/check';
import type { HedgeCoverage } from './engine/features';
import { badgeQualifier } from './engine/reasons';

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
  /** How much of the headline position this address's own holdings cover.
   * Zero for a long (spot cannot offset one) and for anything the hedge
   * search never ran on. Lets a ratings board rank covered/uncovered shorts
   * without opening every card (24.09 mechanic: ratings board). */
  hedgeRatio: number;
  /** How completely the hedge search behind `hedgeRatio` actually finished.
   * A ratio measured under `partial`/`missing` is a floor, not a finding -
   * without this a ranking cannot tell a real 0% from a read that gave up
   * before it started (25.09 audit, A01). */
  hedgeCoverage: HedgeCoverage;
  /** Headline notional divided by the market's open interest, or null when
   * open interest could not be read for that reading. */
  sizeVsOi: number | null;
  /** Dollars of genuinely two-sided quoting in the headline market itself -
   * the number the Book rule actually turns on (v5). Zero for every verdict
   * but Book, since that is the only path `computeVerdict` reaches it from. */
  headlineTwoSidedNotionalUsd: number;
  /** The same short reason the big card's badge carries next to "Unknown"
   * (src/engine/reasons.ts, badgeQualifier) - null when there is none to
   * give. Computed fresh here from the stored verdict, the same way
   * `snapshotId` above is computed by `idOf(e)`: unlike `hedgeCoverage`,
   * the qualifier was never itself a stored field on a `CheckResponse` -
   * `explained()` (src/index.ts) only adds it to a reading served whole,
   * which a gallery row never is. Without this a board or a recent-checks
   * chip could only ever say the bare word "Unknown", which the big card
   * for the same reading never does (25.09 audit, A07). */
  badgeQualifier: string | null;
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
        hedgeRatio: e.hedge.hedgeRatio,
        hedgeCoverage: e.hedgeCoverage,
        sizeVsOi: e.sizeVsOi,
        // Missing (not zero) on any entry scanned before the 23.09 audit's
        // L01 fix added this field to OrderFeatures - every such entry is
        // already excluded from "current" by missingForCurrentRules (a book
        // verdict needs exactly this number, so a legacy book-shaped entry
        // is marked historical rather than silently re-judged), so a ranking
        // that filters by verdict === 'book' before sorting by this value
        // never actually sees the default; it is a safety net, not a claim
        // that a legacy entry quotes nothing.
        headlineTwoSidedNotionalUsd: e.orders.headlineTwoSidedNotionalUsd ?? 0,
        // Not a stored field (see the doc comment on GalleryRow) - a pure
        // function of the verdict this entry already carries, recomputed
        // here rather than forwarded.
        badgeQualifier: badgeQualifier(e.verdict, e.historical !== undefined),
        ...(e.historical ? { historical: { reason: e.historical.reason } } : {}),
        ...(e.supersedes ? { supersedes: e.supersedes } : {}),
      })),
  };
}
