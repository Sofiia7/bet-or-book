import type { Position, RestingOrder, SpotHolding, Trade } from '../types';
import { spotHedgesPerp } from './assets';

export interface PositionFeatures {
  nPositions: number;
  grossUsd: number;
  netUsd: number;
  netToGross: number;
  headlineCoin: string | null;
  headlineNotionalUsd: number;
  headlineShare: number;
  headlineLiqDistancePct: number | null;
}

export function computePositionFeatures(positions: Position[]): PositionFeatures {
  if (positions.length === 0) {
    return {
      nPositions: 0,
      grossUsd: 0,
      netUsd: 0,
      netToGross: 0,
      headlineCoin: null,
      headlineNotionalUsd: 0,
      headlineShare: 0,
      headlineLiqDistancePct: null,
    };
  }

  const signed = positions.map((p) => (p.side === 'long' ? p.sizeUsd : -p.sizeUsd));
  const grossUsd = positions.reduce((sum, p) => sum + p.sizeUsd, 0);
  const netUsd = Math.abs(signed.reduce((sum, s) => sum + s, 0));
  const netToGross = grossUsd === 0 ? 0 : netUsd / grossUsd;

  const headline = positions.reduce((max, p) => (p.sizeUsd > max.sizeUsd ? p : max), positions[0]);
  const headlineShare = grossUsd === 0 ? 0 : headline.sizeUsd / grossUsd;

  let headlineLiqDistancePct: number | null = null;
  if (headline.liquidationPx !== null && headline.entryPx > 0) {
    headlineLiqDistancePct = Math.abs(headline.liquidationPx - headline.entryPx) / headline.entryPx;
  }

  return {
    nPositions: positions.length,
    grossUsd,
    netUsd,
    netToGross,
    headlineCoin: headline.coin,
    headlineNotionalUsd: headline.sizeUsd,
    headlineShare,
    headlineLiqDistancePct,
  };
}

export interface OrderFeatures {
  restingOrders: number;
  bidShare: number;
  coinsBothSides: number;
}

export function computeOrderFeatures(orders: RestingOrder[]): OrderFeatures {
  if (orders.length === 0) {
    return { restingOrders: 0, bidShare: 0.5, coinsBothSides: 0 };
  }
  const bids = orders.filter((o) => o.side === 'bid').length;
  const bidShare = bids / orders.length;

  const sidesByCoin = new Map<string, Set<'bid' | 'ask'>>();
  for (const order of orders) {
    const set = sidesByCoin.get(order.coin) ?? new Set<'bid' | 'ask'>();
    set.add(order.side);
    sidesByCoin.set(order.coin, set);
  }
  const coinsBothSides = [...sidesByCoin.values()].filter((set) => set.size === 2).length;

  return { restingOrders: orders.length, bidShare, coinsBothSides };
}

export interface HedgeFeatures {
  hedgeUsd: number;
  hedgeRatio: number;
}

export function computeHedgeFeatures(
  headlineCoin: string | null,
  headlineNotionalUsd: number,
  spotHoldings: SpotHolding[],
): HedgeFeatures {
  if (headlineCoin === null || headlineNotionalUsd === 0) {
    return { hedgeUsd: 0, hedgeRatio: 0 };
  }
  const hedgeUsd = spotHoldings
    .filter((h) => spotHedgesPerp(h.coin, headlineCoin))
    .reduce((sum, h) => sum + h.valueUsd, 0);
  return { hedgeUsd, hedgeRatio: hedgeUsd / headlineNotionalUsd };
}

export function computeSizeVsOi(headlineNotionalUsd: number, openInterestUsd: number): number | null {
  if (openInterestUsd <= 0) return null;
  return headlineNotionalUsd / openInterestUsd;
}

export interface TradeFeatures {
  tradesPerDay: number;
  crossedShare: number;
  sampleSize: number;
  /** True when the raw sample hit Hyperliquid's 2000-fill-per-call cap, so
   * tradesPerDay is a lower bound, not an exact count - a full page is a
   * sign there is more history, not that the history ends here. */
  cappedByApiLimit: boolean;
}

const HL_FILLS_PAGE_CAP = 2000;

export function computeTradeFeatures(trades: Trade[], windowHours: number): TradeFeatures {
  if (trades.length === 0) {
    return { tradesPerDay: 0, crossedShare: 0, sampleSize: 0, cappedByApiLimit: false };
  }
  const crossedCount = trades.filter((t) => t.crossed).length;
  return {
    tradesPerDay: (trades.length / windowHours) * 24,
    crossedShare: crossedCount / trades.length,
    sampleSize: trades.length,
    cappedByApiLimit: trades.length >= HL_FILLS_PAGE_CAP,
  };
}
