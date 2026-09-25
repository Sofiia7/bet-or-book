/**
 * What the social-preview image says, as plain data - no satori, no fonts,
 * no rendering. Kept apart from src/engine/ogRender.ts the same reason
 * src/engine/share.ts is kept apart from the canvas code on the page: one
 * place decides the words and colours, testable without a WASM runtime.
 */
import type { VerdictResult } from './verdict';
import type { ExposureBreakdown, SegmentKind } from './breakdown';
import type { CheckResult } from '../api/check';
import { shareCard } from './share';
import { formatUsd } from './evidence';

/**
 * The picture's own layout, as part of where it is kept.
 *
 * A reading never changes once it has an id, but what its picture says
 * about it did: the 23.09 fixes added the date and the reading's own limit
 * (U02), and every picture already stored under the bare id kept saying
 * neither - served from KV, and marked immutable for a year at whatever
 * cache a crawler sits behind. A new layout is a new key and a new URL, so
 * no stored or cached picture from an older one can stand in for it.
 * Version 3 draws what a wallet that funded the account holds, beside the
 * bar on a dashed line, as the page and the downloaded picture already did.
 */
export const OG_LAYOUT_VERSION = 3;

/** Where one reading's picture is kept, in this layout. */
export const ogCacheKey = (id: string): string => `og:v${OG_LAYOUT_VERSION}:${id}`;

export interface OgSegment {
  share: number;
  color: string;
  opacity: number;
}

export interface OgCardData {
  badgeText: string;
  accent: string;
  summary: string;
  /** null when the breakdown does not apply - a long, or nothing open - and
   * the image should not try to draw a bar with nothing in it. */
  segments: OgSegment[] | null;
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
  /** What wallets that funded the account hold of the asset, drawn outside
   * the bar and never inside it: the one distinction the card turns on, and
   * the picture used to leave it to the sentence alone. Null when nothing
   * is held elsewhere, or there is no bar to put it beside. */
  elsewhere: { amount: string; caption: string } | null;
  /** Whether the segments above are a finished picture - see
   * ExposureBreakdown.dataQuality (kept in sync with that type by hand: this
   * field mirrors it rather than importing it, so a widening there - as
   * 'unverified' did in the 25.09 A03 follow-up, and 'unknown' did in that
   * follow-up's own technical-debt fix - has to be widened here too, even
   * though no rendering code needs to change, or this assignment stops
   * typechecking). 'measured' when there is no breakdown at all, the same
   * as a card with nothing left to show a caveat about. */
  dataQuality: 'measured' | 'partial' | 'unpriced' | 'unverified' | 'unknown';
}

const ACCENT: Record<VerdictResult['verdict'], string> = {
  book: '#0c447c',
  hedged: '#27500a',
  looks_like_a_bet: '#633806',
  unknown: '#444441',
};

const BADGE_LABEL: Record<VerdictResult['verdict'], string> = {
  book: 'Book',
  hedged: 'Hedged',
  looks_like_a_bet: 'Looks like a bet',
  unknown: 'Unknown',
};

const RESIDUAL_COLOR = '#e6e6e2';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function segmentColor(kind: SegmentKind, accent: string): { color: string; opacity: number } {
  if (kind === 'residual') return { color: RESIDUAL_COLOR, opacity: 1 };
  // Faded further than `residual` itself: this part of the bar was never
  // looked at, which is a fainter claim than "looked at, empty" (23.09
  // audit, L12).
  if (kind === 'not-checked') return { color: RESIDUAL_COLOR, opacity: 0.5 };
  return { color: accent, opacity: kind === 'unverified' ? 0.35 : 1 };
}

export interface OgCardInput {
  address: string;
  verdict: VerdictResult;
  summary: string;
  classifierVersion: string;
  breakdown?: ExposureBreakdown;
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
    provenance: share.provenance,
    limitText: share.limits.length > 1 ? share.limits[1] : null,
  });
}

export function ogCardData(input: OgCardInput): OgCardData {
  const accent = ACCENT[input.verdict.verdict] ?? ACCENT.unknown;
  const badgeText = (BADGE_LABEL[input.verdict.verdict] ?? 'Unknown') + (input.verdict.strength ? ` (${input.verdict.strength})` : '');
  const segments =
    input.breakdown && input.breakdown.applies && input.breakdown.segments.length > 0
      ? input.breakdown.segments.map((seg) => ({ share: seg.share, ...segmentColor(seg.kind, accent) }))
      : null;
  const held = segments && input.breakdown?.elsewhere;
  return {
    badgeText,
    accent,
    summary: input.summary,
    segments,
    dataQuality: input.breakdown?.dataQuality ?? 'measured',
    footerLeft: `${shortAddress(input.address)} · rules ${input.classifierVersion}`,
    provenance: input.provenance,
    limitText: input.limitText,
    elsewhere: held
      ? {
          amount: formatUsd(held.usd),
          caption: `held by ${held.wallets} ${held.wallets === 1 ? 'wallet' : 'wallets'} that funded it, ownership unverified, not counted`,
        }
      : null,
  };
}
