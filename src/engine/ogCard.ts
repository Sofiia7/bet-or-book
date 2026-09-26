/**
 * What the social-preview image says, as plain data - no satori, no fonts,
 * no rendering. Kept apart from src/engine/ogRender.ts the same reason
 * src/engine/share.ts is kept apart from the canvas code on the page: one
 * place decides the words and colours, testable without a WASM runtime.
 */
import type { VerdictResult } from './verdict';
import type { ExposureBreakdown } from './breakdown';
import type { PositionFeatures, OrderFeatures, HedgeFeatures } from './features';
import type { CheckResult } from '../api/check';
import { shareCard } from './share';
import { formatPct } from './evidence';
import { constellationInputsForOg, type ConstellationInputs } from './constellation';

/**
 * The picture's own layout, as part of where it is kept.
 *
 * A reading never changes once it has an id, but what its picture says
 * about it did: the 23.09 fixes added the date and the reading's own limit
 * (U02), and every picture already stored under the bare id kept saying
 * neither - served from KV, and marked immutable for a year at whatever
 * cache a crawler sits behind. A new layout is a new key and a new URL, so
 * no stored or cached picture from an older one can stand in for it.
 * Version 4 (26.09 redesign, Task 6) replaces the segmented bar and its
 * dashed "held elsewhere" box with the actual constellation diagram the live
 * page and the in-browser share card both draw - corrected in chat by the
 * user, live, after Task 3 landed: the constellation itself, not a re-
 * themed bar, is what has to appear when a reading's link is shared. A
 * picture cached under any earlier layout version drew the old bar and
 * cannot stand in for this one. Version 5 labels incomplete coverage on
 * the share preview. Version 6 keeps the summary's ellipsis visible even
 * when the prose wraps into three lines.
 */
export const OG_LAYOUT_VERSION = 6;

/** Where one reading's picture is kept, in this layout. */
export const ogCacheKey = (id: string): string => `og:v${OG_LAYOUT_VERSION}:${id}`;

export interface OgCardData {
  badgeText: string;
  accent: string;
  summary: string;
  /** null when there is no position to draw a constellation for - "nothing
   * open right now". Mirrors web/app.js's own renderBreakdown/drawCard gate
   * exactly: isBook, or breakdown.applies with segments, or a long position
   * - non-null exactly when the client would show its own diagram for the
   * same reading (see ogCardData's own isBook/isLong below). The dollar
   * figure a funder holds "elsewhere" no longer gets a separate box on this
   * picture the way it used to: the ghost flag inside this object already
   * draws that as a dashed mirror, and the summary sentence above it on the
   * card already states the figure in words - the old drawBreakdown doc
   * comment's own reasoning ("printing both would be printing it twice in a
   * smaller font") applies here too. */
  constellation: ConstellationInputs | null;
  /** The big centered number and its short label, precomputed here the same
   * way segments/elsewhere used to be: ogRender.ts has no decision logic of
   * its own, only layout. Both null exactly when `constellation` is. */
  constellationStat: { value: string; label: string } | null;
  footerLeft: string;
  /** When the numbers were measured and what kind of reading this is - the
   * Download PNG path had this and the link's own preview did not, so the
   * same card told two different ages of itself depending which picture of
   * it a reader saw (23.09 audit, U02). Empty only on the generic,
   * verdict-less fallback card, which is about no reading in particular. */
  provenance: string;
  /** The most specific standing limit this reading carries, or null when it
   * has none beyond the permanent one. The summary sentence alone can be
   * clipped before a trailing caveat, and the caption is otherwise the only
   * other place this reading's limits are said out loud at all. */
  limitText: string | null;
  /** Whether the reading behind `constellation` is a finished picture - see
   * ExposureBreakdown.dataQuality (kept in sync with that type by hand: this
   * field mirrors it rather than importing it, so a widening there - as
   * 'unverified' did in the 25.09 A03 follow-up, and 'unknown' did in that
   * follow-up's own technical-debt fix - has to be widened here too, even
   * though no rendering code needs to change, or this assignment stops
   * typechecking). 'measured' when there is no breakdown at all. Every
   * other value is marked incomplete beside the diagram. */
  dataQuality: 'measured' | 'partial' | 'unpriced' | 'unverified' | 'unknown';
}

/** The same four fixed hex values Task 1 of the 26.09 redesign put in
 * :root, and web/app.js's own VERDICTS[...].accent now reads (Task 6, Part
 * A) - every surface in the project (live page, share canvas, OG picture)
 * reads from one palette instead of two. Concrete hex, not a CSS var: this
 * card has no cascade to read a var() from. */
const ACCENT: Record<VerdictResult['verdict'], string> = {
  book: '#7fa2ff',
  hedged: '#4fe0b0',
  looks_like_a_bet: '#f2b35c',
  unknown: '#a3a8b6',
};

const BADGE_LABEL: Record<VerdictResult['verdict'], string> = {
  book: 'Book',
  hedged: 'Hedged',
  looks_like_a_bet: 'Looks like a bet',
  unknown: 'Unknown',
};

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** The short label under the big number - ported from web/app.js's
 * constellationStatLabelFor unchanged. */
function constellationStatLabel(verdict: VerdictResult['verdict']): string {
  if (verdict === 'book') return 'quoted both sides';
  return verdict === 'unknown' ? 'covered by this address' : 'covered';
}

export interface OgCardInput {
  address: string;
  verdict: VerdictResult;
  summary: string;
  classifierVersion: string;
  breakdown?: ExposureBreakdown;
  /** The same fields constellationInputsForOg reads on the client's own `d`
   * (positions/orders/hedge) - carried here so ogCardData can compute
   * `constellation` itself, the same place segments/elsewhere used to be
   * computed, rather than making every caller do it. Narrowed to exactly
   * what this module reads (the gate below, and constellationInputsForOg's
   * own ConstellationSource) rather than the full feature types, so a
   * caller - this file's own tests included - never has to fabricate
   * unrelated fields like `candidates` or `sameAssetOffsetShare` just to
   * satisfy the type. ogCardFor still passes the full, real feature objects
   * through unchanged: a wider object is always assignable to a narrower
   * picked shape. */
  positions: Pick<PositionFeatures, 'nPositions' | 'headlineNotionalUsd' | 'headlineShare' | 'headlineSide'>;
  orders: Pick<OrderFeatures, 'headlineTwoSidedNotionalUsd'>;
  hedge: Pick<HedgeFeatures, 'hedgeRatio'>;
  /** From src/engine/share.ts's shareCard() - the same function that already
   * decides this for the page and for Download PNG, so this picture cannot
   * drift from either of them by having its own, third opinion. */
  provenance: string;
  limitText: string | null;
}

/**
 * One reading's picture, in the words shareCard already chose for the page
 * and for Download PNG: `provenance` carries the date, `limits[1]` the most
 * specific caveat this reading has beyond the permanent one every reading
 * carries (23.09 audit, U02).
 *
 * `kind` is where the reading came from, not who is drawing it: the Worker
 * and the offline pre-render used to call a gallery card a "saved reading"
 * and "from the gallery scan" respectively, so the same card had two
 * pictures depending on which of them drew it first.
 */
export function ogCardFor(card: CheckResult, kind: 'saved' | 'gallery'): OgCardData {
  const share = shareCard(card, { kind });
  return ogCardData({
    address: card.address,
    verdict: card.verdict,
    summary: card.summary,
    classifierVersion: card.classifierVersion,
    breakdown: card.breakdown,
    positions: card.positions,
    orders: card.orders,
    hedge: card.hedge,
    provenance: share.provenance,
    limitText: share.limits.length > 1 ? share.limits[1] : null,
  });
}

export function ogCardData(input: OgCardInput): OgCardData {
  const accent = ACCENT[input.verdict.verdict] ?? ACCENT.unknown;
  const badgeText = (BADGE_LABEL[input.verdict.verdict] ?? 'Unknown') + (input.verdict.strength ? ` (${input.verdict.strength})` : '');

  // Mirrors web/app.js's renderBreakdown/drawCard gate exactly (Task 2 and
  // Task 6 Part A), so this picture never disagrees with the page or the
  // in-browser share card about whether there is a diagram to draw at all.
  const isBook = input.verdict.verdict === 'book';
  const b = input.breakdown;
  const isLong = !isBook && (!b || !b.applies) && input.positions.nPositions > 0 && input.positions.headlineSide === 'long';
  const showConstellation = isBook || (!!b && b.applies && b.segments.length > 0) || isLong;
  const constellation = showConstellation ? constellationInputsForOg(input) : null;
  const quality = input.breakdown?.dataQuality ?? (input.breakdown?.applies ? 'unknown' : 'measured');
  const constellationStat = constellation
    ? { value: constellation.coverage > 0 && constellation.coverage < 0.001 ? '<0.1%' : formatPct(constellation.coverage), label: quality === 'measured' ? constellationStatLabel(input.verdict.verdict) : 'found coverage' }
    : null;

  return {
    badgeText,
    accent,
    summary: input.summary,
    constellation,
    constellationStat,
    dataQuality: quality,
    footerLeft: `${shortAddress(input.address)} · rules ${input.classifierVersion}`,
    provenance: input.provenance,
    limitText: input.limitText,
  };
}
