/**
 * What stands against the headline position, as quantities a picture can be
 * drawn from.
 *
 * The 21.09 audit's first complaint about the card was that five identical
 * tiles of numbers make the reader assemble the answer themselves, and its
 * suggestion was a diagram: the position, what this address holds against
 * it, and - on a separate, dashed connection - what a wallet that merely
 * funded this one holds. The distinction between those last two is the
 * single most important thing on the card, and a row of percentages is a
 * poor way to carry it.
 *
 * The arithmetic lives here rather than in the drawing code so the picture
 * has nothing to decide, and so the split can be tested without a canvas.
 */
import type { PositionFeatures, HedgeFeatures, HedgeCoverage, LinkedHedgeFeatures } from './features';
import { DEFAULT_THRESHOLDS } from './verdict';

/** A band of the position bar. They are drawn in this order and always sum
 * to the headline notional. */
export type SegmentKind =
  /** Offset by something this address holds, identified. */
  | 'covered'
  /** Matched by dollars whose asset could not be established. Not coverage,
   * and not an absence either. */
  | 'unverified'
  /** Nothing found against it, and the search for it was complete. */
  | 'residual'
  /** The search for a hedge here was itself incomplete or failed, so this
   * part of the bar is not "found to have nothing against it" - it is
   * "not looked at". Drawing it the same as `residual` said "checked, empty"
   * for a source that never answered (23.09 audit, L12). */
  | 'not-checked';

export interface Segment {
  kind: SegmentKind;
  usd: number;
  share: number;
}

export interface ExposureBreakdown {
  /** False when spot cannot offset this position at all - a long, or no
   * position - and the diagram should not be drawn. */
  applies: boolean;
  coin: string | null;
  side: 'long' | 'short' | null;
  headlineUsd: number;
  segments: Segment[];
  /** Coverage past the size of the position: the account is long the asset
   * its headline position is short, and that is not a bigger hedge. */
  excessUsd: number;
  /** Matching assets held by wallets that funded this one. Deliberately not
   * a segment: a funding transfer says where money came from, not who holds
   * it now, so it is drawn beside the bar on a dashed connection. */
  elsewhere: { usd: number; wallets: number; ownership: 'unverified' } | null;
  /** Whether the segments above are a finished picture. 'measured' once the
   * hedge search ran to completion, every matching holding had a price to
   * weigh, and identified holdings explain the position well enough that
   * computeVerdict would not withhold a verdict for unrecognised assets
   * either. 'partial' when the holdings read itself did not finish - true
   * even when what was found already covers the position, since the next
   * page could still hold more of the same asset and a zero residual then
   * says nothing about the part never read. 'unpriced' when a holding
   * matched the position's asset but had no price, so its dollars sit in
   * neither `covered` nor `unverified`. 'unverified' when a material share
   * of the position (by computeVerdict's own DEFAULT_THRESHOLDS.hedged.
   * maxUnverifiedShare) is matched to holdings this tool could not
   * identify - the same condition, mirrored exactly, that makes
   * computeVerdict return 'unrecognised_assets' instead of a confident
   * verdict (25.09 audit, A03 follow-up: this field originally only checked
   * `unpricedMatches`, so a fresh live check with a large unverified share
   * could read 'measured' here while the classifier itself withheld its
   * verdict for the identical reason - a real gap found by this branch's
   * own final review, not by the original audit). None of these can be
   * inferred from whether some segment happens to be nonzero - a renderer
   * must read this field directly (25.09 audit, A03).
   *
   * 'unknown' is never produced by this function itself - every branch above
   * resolves to one of the other four values. It exists only as a value
   * scripts/reexplain.ts stamps directly onto old, frozen entries whose
   * breakdown predates this field, meaning literally "no claim is made
   * either way" - not a fifth kind of measured uncertainty alongside the
   * other four (technical debt from the 25.09 audit follow-up). */
  dataQuality: 'measured' | 'partial' | 'unpriced' | 'unverified' | 'unknown';
}

/** Below this share of the position a funder's holding is dust, and "held by
 * 2 wallets" should not stand for a dollar of it. */
const MIN_ELSEWHERE_SHARE = 0.01;

export function exposureBreakdown(
  positions: PositionFeatures,
  hedge: HedgeFeatures,
  linked: LinkedHedgeFeatures | null,
  hedgeCoverage: HedgeCoverage = 'complete',
): ExposureBreakdown {
  const headlineUsd = positions.headlineNotionalUsd;
  const applies = positions.nPositions > 0 && positions.headlineSide === 'short' && headlineUsd > 0;
  // Mirrors computeVerdict's own unrecognised_assets check (src/engine/
  // verdict.ts) exactly, so this field's sense of "not fully identified"
  // never disagrees with the classifier's.
  const unverifiedShare = headlineUsd > 0 ? (hedge.unverifiedUsd ?? 0) / headlineUsd : 0;
  // A long has nothing to measure, so it is trivially 'measured'. Otherwise
  // an unfinished holdings read outranks a merely-unpriced match, which
  // outranks a material but priced-and-found unverified share: none of the
  // three can be inferred from the segments below, which is the whole point
  // of this field (25.09 audit, A03).
  const dataQuality: ExposureBreakdown['dataQuality'] = !applies
    ? 'measured'
    : hedgeCoverage === 'missing' || hedgeCoverage === 'partial'
      ? 'partial'
      : (hedge.unpricedMatches ?? 0) > 0
        ? 'unpriced'
        : unverifiedShare >= DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare
          ? 'unverified'
          : 'measured';
  const empty: ExposureBreakdown = {
    applies,
    coin: positions.headlineCoin,
    side: positions.headlineSide,
    headlineUsd,
    segments: [],
    excessUsd: 0,
    elsewhere: null,
    dataQuality,
  };
  if (!applies) return empty;

  // Coverage is capped at the position: anything past it is the account
  // being long the asset, which is its own statement and not a longer bar.
  const covered = Math.min(hedge.hedgeUsd, headlineUsd);
  const excessUsd = Math.max(0, hedge.hedgeUsd - headlineUsd);
  const unverified = Math.min(hedge.unverifiedUsd ?? 0, headlineUsd - covered);
  const residual = headlineUsd - covered - unverified;

  const segments: Segment[] = [];
  const push = (kind: SegmentKind, usd: number) => {
    if (usd > 0) segments.push({ kind, usd, share: usd / headlineUsd });
  };
  push('covered', covered);
  push('unverified', unverified);
  // A read that failed or stopped early can only have hidden a hedge, never
  // invented one - so what neither `covered` nor `unverified` explains is
  // "not looked at" under a partial or missing read, not "looked at and
  // empty". `complete` (and the historical default above, for entries from
  // before this was tracked) draws it as `residual`, unchanged.
  push(hedgeCoverage === 'missing' || hedgeCoverage === 'partial' ? 'not-checked' : 'residual', residual);

  const matching = (linked?.funders ?? []).filter((f) => f.matchingUsd >= MIN_ELSEWHERE_SHARE * headlineUsd);
  const elsewhereUsd = matching.reduce((sum, f) => sum + f.matchingUsd, 0);

  return {
    ...empty,
    segments,
    excessUsd,
    elsewhere: elsewhereUsd > 0 ? { usd: elsewhereUsd, wallets: matching.length, ownership: 'unverified' } : null,
  };
}
