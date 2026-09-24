import type { Position } from '../types';
import { formatUsd, formatPct, plural, type EvidenceSource } from './evidence';

/** Vitals only ever come from the same two places evidence does. Kept as a
 * narrower alias so this file cannot accidentally claim "Nansen + Hyperliquid"
 * for a single field that only one of them supplied. */
export type VitalsSource = Extract<EvidenceSource, 'Nansen' | 'Hyperliquid'>;

export interface VitalsItem {
  label: string;
  value: string;
  source: VitalsSource;
}

export interface VitalsInput {
  /** The headline position's own record. Nansen and the Hyperliquid
   * fallback both already return leverage, liquidation price and both PnL
   * fields on every position; a verdict never reads them, and until now
   * neither did the card. */
  headline: Position | null;
  /** Mirrors PositionFeatures.headlineLiqDistancePct/Basis (see
   * src/engine/features.ts): unsigned, and null when the position carries
   * no liquidation price at all (cross-margin at very low leverage). */
  headlineLiqDistancePct: number | null;
  headlineLiqDistanceBasis: 'mark' | 'entry' | null;
  /** Where the position record itself came from. */
  positionsSource: VitalsSource;
  /** Always Hyperliquid's own mark price and open interest, whichever
   * source the positions came from. */
  sizeVsOi: number | null;
  /** Notional of the headline coin's own fills that opened or added to the
   * position, and that closed or reduced it - always Hyperliquid's, since
   * Nansen has no per-fill direction. Zero in both is shown as "no fills",
   * not omitted: a static position is itself worth saying. */
  headlineOpenedUsd: number;
  headlineClosedUsd: number;
  /** How many of the headline coin's fills exist at all, regardless of
   * whether their `dir` was one this tool sums. A flip ("Long > Short") or a
   * spot trade counts toward neither Opened nor Closed, and "no fills" used
   * to be printed anyway - a $1M flip read as a static position (23.09
   * audit, L10). Zero here is the only thing "no fills" may describe. */
  headlineFills: number;
  /** Hours the fill sample actually spans, which can be far less than the
   * window asked for on a busy account. */
  tradesSpanHours: number;
}

function formatLeverage(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** One decimal at every magnitude, matching `spanText` in evidence.ts: a
 * span under an hour rounded to whole hours would read as "0h". */
function formatSpan(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  return ` (${hours.toFixed(1)}h)`;
}

function flowText(openedUsd: number, closedUsd: number, fills: number, spanHours: number): string {
  const span = formatSpan(spanHours);
  if (fills <= 0) return `no fills${span}`;
  if (openedUsd <= 0 && closedUsd <= 0) return `${plural(fills, 'fill')}, change in exposure not determined${span}`;
  const parts: string[] = [];
  if (openedUsd > 0) parts.push(`${formatUsd(openedUsd)} opened`);
  if (closedUsd > 0) parts.push(`${formatUsd(closedUsd)} closed`);
  return parts.join(', ') + span;
}

/**
 * Numbers about the headline position itself, not about the verdict this
 * tool reaches on it: leverage and its type, distance to liquidation,
 * unrealized PnL, funding paid or received since the position was opened,
 * and its size against open interest. None of them decide bet, hedge or
 * book, so - unlike `explain`'s evidence array - there is no five-item cap
 * and no "decisive" flag here: a reader deciding whether to copy a position
 * wants all of these next to the answer, not the ones left over after the
 * rule that fired had its say.
 */
export function computeVitals(input: VitalsInput): VitalsItem[] {
  const { headline } = input;
  if (!headline) return [];
  const items: VitalsItem[] = [];
  if (Number.isFinite(headline.leverage) && headline.leverage > 0) {
    items.push({
      label: 'Leverage',
      value: `${formatLeverage(headline.leverage)}x ${headline.leverageType}`,
      source: input.positionsSource,
    });
  }
  if (input.headlineLiqDistancePct !== null && input.headlineLiqDistanceBasis !== null) {
    items.push({
      label: 'Distance to liquidation',
      value: `${formatPct(input.headlineLiqDistancePct)} (from ${input.headlineLiqDistanceBasis})`,
      source: input.positionsSource,
    });
  }
  items.push({ label: 'Unrealized PnL', value: formatUsd(headline.unrealizedPnlUsd), source: input.positionsSource });
  items.push({
    label: 'Funding since open',
    value: formatUsd(headline.cumFundingUsd),
    source: input.positionsSource,
  });
  if (input.sizeVsOi !== null) {
    items.push({ label: 'Size vs open interest', value: formatPct(input.sizeVsOi), source: 'Hyperliquid' });
  }
  items.push({
    label: 'Position flow',
    value: flowText(input.headlineOpenedUsd, input.headlineClosedUsd, input.headlineFills, input.tradesSpanHours),
    source: 'Hyperliquid',
  });
  return items;
}
