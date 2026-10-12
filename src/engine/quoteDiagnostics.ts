import type { RestingOrder } from '../types';
import type { CheckResponse } from '../api/check';

/** Descriptive distance, not an arbitrary eligibility/probability threshold. */
export function quoteGeometry(orders: RestingOrder[], coin: string | null, mark: number | undefined, reference: 'mark' | 'mid' = 'mark') {
  if (!coin || !mark || !Number.isFinite(mark) || mark <= 0) return null;
  const known = orders.filter(o => o.coin === coin && o.limitPx && o.limitPx > 0 && Number.isFinite(o.limitPx) && o.sizeUsd > 0);
  const total = known.reduce((sum, o) => sum + o.sizeUsd, 0);
  if (!total) return null;
  const distances = known.map(o => ({ distance: Math.abs(o.limitPx! / mark - 1) * 10_000, usd: o.sizeUsd }));
  return { reference, markPx: mark, pricedQuoteUsd: total,
    weightedDistanceBps: distances.reduce((sum, d) => sum + d.distance * d.usd, 0) / total,
    nearestDistanceBps: Math.min(...distances.map(d => d.distance)),
    farthestDistanceBps: Math.max(...distances.map(d => d.distance)) };
}

export interface QuoteSample { at: string; coin: string; matchedUsd: number; samples: number; firstAt: string }
export function nextQuoteSample(previous: QuoteSample | null, reading: CheckResponse): QuoteSample | null {
  if (previous && (!Number.isFinite(Date.parse(previous.at)) || !Number.isFinite(Date.parse(previous.firstAt)) || !Number.isInteger(previous.samples) || previous.samples < 1 || previous.samples > 100 || typeof previous.coin !== 'string')) previous = null;
  if (!reading.positions.headlineCoin || !reading.orders.headlineTwoSided || reading.ordersCoverage !== 'complete') return null;
  const current = { at: reading.checkedAt, coin: reading.positions.headlineCoin, matchedUsd: reading.orders.headlineTwoSidedNotionalUsd, samples: 1, firstAt: reading.checkedAt };
  const delta = previous ? Date.parse(current.at) - Date.parse(previous.at) : Infinity;
  if (!previous || previous.coin !== current.coin || delta < 0 || delta > 30 * 60_000) return current;
  if (delta < 60_000) return previous;
  return { ...current, samples: Math.min(100, previous.samples + 1), firstAt: previous.firstAt };
}
