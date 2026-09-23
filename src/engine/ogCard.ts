/**
 * What the social-preview image says, as plain data - no satori, no fonts,
 * no rendering. Kept apart from src/engine/ogRender.ts the same reason
 * src/engine/share.ts is kept apart from the canvas code on the page: one
 * place decides the words and colours, testable without a WASM runtime.
 */
import type { VerdictResult } from './verdict';
import type { ExposureBreakdown, SegmentKind } from './breakdown';

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
  return { color: accent, opacity: kind === 'unverified' ? 0.35 : 1 };
}

export interface OgCardInput {
  address: string;
  verdict: VerdictResult;
  summary: string;
  classifierVersion: string;
  breakdown?: ExposureBreakdown;
}

export function ogCardData(input: OgCardInput): OgCardData {
  const accent = ACCENT[input.verdict.verdict] ?? ACCENT.unknown;
  const badgeText = (BADGE_LABEL[input.verdict.verdict] ?? 'Unknown') + (input.verdict.strength ? ` (${input.verdict.strength})` : '');
  const segments =
    input.breakdown && input.breakdown.applies && input.breakdown.segments.length > 0
      ? input.breakdown.segments.map((seg) => ({ share: seg.share, ...segmentColor(seg.kind, accent) }))
      : null;
  return {
    badgeText,
    accent,
    summary: input.summary,
    segments,
    footerLeft: `${shortAddress(input.address)} · rules ${input.classifierVersion}`,
  };
}
