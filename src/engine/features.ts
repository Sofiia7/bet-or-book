import type { Position, PositionSide, RestingOrder, SpotHolding, Trade, LinkedWallet } from '../types';
import { spotHedgesPerp } from './assets';

export interface PositionFeatures {
  nPositions: number;
  grossUsd: number;
  netUsd: number;
  netToGross: number;
  headlineCoin: string | null;
  headlineSide: PositionSide | null;
  headlineNotionalUsd: number;
  headlineShare: number;
  headlineLiqDistancePct: number | null;
  /** Share of gross exposure that cancels within a single asset: a $1M long
   * and a $1M short in the same coin offset each other, a $1M long in one
   * coin and a $1M short in another do not, however neatly the dollars net
   * out. Zero when nothing cancels, 1 when every leg has a counterpart. */
  sameAssetOffsetShare: number;
}

export function computePositionFeatures(positions: Position[]): PositionFeatures {
  if (positions.length === 0) {
    return {
      nPositions: 0,
      grossUsd: 0,
      netUsd: 0,
      netToGross: 0,
      headlineCoin: null,
      headlineSide: null,
      headlineNotionalUsd: 0,
      headlineShare: 0,
      headlineLiqDistancePct: null,
      sameAssetOffsetShare: 0,
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

  // Per coin, the smaller side is matched by the larger one, so twice it is
  // the gross that cancels. Summed over coins this separates a real offset
  // from a book that merely adds up to zero dollars across unrelated assets.
  const byCoin = new Map<string, { long: number; short: number }>();
  for (const p of positions) {
    const e = byCoin.get(p.coin) ?? { long: 0, short: 0 };
    e[p.side] += p.sizeUsd;
    byCoin.set(p.coin, e);
  }
  const offsetGrossUsd = [...byCoin.values()].reduce((sum, e) => sum + 2 * Math.min(e.long, e.short), 0);

  return {
    nPositions: positions.length,
    grossUsd,
    netUsd,
    netToGross,
    headlineCoin: headline.coin,
    headlineSide: headline.side,
    headlineNotionalUsd: headline.sizeUsd,
    headlineShare,
    headlineLiqDistancePct,
    sameAssetOffsetShare: grossUsd === 0 ? 0 : offsetGrossUsd / grossUsd,
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

/** What a hedge ratio was measured over: `none` when the headline is not a
 * short (spot cannot offset it, so the ratio is zero by definition),
 * `all-chains` when the account's balances on every chain were read,
 * `hyperliquid` when only its Hyperliquid spot was. */
export type HedgeScope = 'none' | 'hyperliquid' | 'all-chains';

/** How completely the account's own matching holdings were established.
 * `partial` and `missing` can only ever hide holdings, never invent them, so
 * a high ratio measured under either is a lower bound worth trusting while a
 * low one says nothing. */
export type HedgeCoverage = 'complete' | 'partial' | 'missing' | 'not-applicable';

/** Spot can offset only a short: holding the asset while also long the perp
 * is more of the same bet, not a hedge. */
export function computeHedgeFeatures(
  headlineCoin: string | null,
  headlineSide: PositionSide | null,
  headlineNotionalUsd: number,
  holdings: SpotHolding[],
): HedgeFeatures {
  if (headlineCoin === null || headlineSide !== 'short' || headlineNotionalUsd === 0) {
    return { hedgeUsd: 0, hedgeRatio: 0 };
  }
  const hedgeUsd = holdings
    .filter((h) => spotHedgesPerp(h.coin, headlineCoin))
    .reduce((sum, h) => sum + h.valueUsd, 0);
  return { hedgeUsd, hedgeRatio: hedgeUsd / headlineNotionalUsd };
}

export interface LinkedHedgeFeatures {
  linkedHedgeUsd: number;
  linkedHedgeRatio: number;
  funders: Array<{ address: string; relation: string; chain: string; matchingUsd: number }>;
}

/** Holdings of wallets linked by a funding transaction. Ownership through
 * such a link is inferred, not proven - the verdict layer treats this as a
 * separate, weaker kind of evidence than the account's own holdings. */
export function computeLinkedHedge(
  headlineCoin: string | null,
  headlineSide: PositionSide | null,
  headlineNotionalUsd: number,
  linked: Array<{ wallet: LinkedWallet; holdings: SpotHolding[] }>,
): LinkedHedgeFeatures {
  const followed = linked.filter((l) => l.wallet.serviceStatus !== 'service');
  const funders = followed.map((l) => ({
    address: l.wallet.address,
    relation: l.wallet.relation,
    chain: l.wallet.chain,
    matchingUsd:
      headlineCoin === null || headlineSide !== 'short'
        ? 0
        : l.holdings.filter((h) => spotHedgesPerp(h.coin, headlineCoin)).reduce((s, h) => s + h.valueUsd, 0),
  }));
  const linkedHedgeUsd = funders.reduce((s, f) => s + f.matchingUsd, 0);
  return {
    linkedHedgeUsd,
    linkedHedgeRatio: headlineNotionalUsd > 0 ? linkedHedgeUsd / headlineNotionalUsd : 0,
    funders,
  };
}

export function computeSizeVsOi(headlineNotionalUsd: number, openInterestUsd: number): number | null {
  if (openInterestUsd <= 0) return null;
  return headlineNotionalUsd / openInterestUsd;
}

export interface TradeFeatures {
  tradesPerDay: number;
  crossedShare: number;
  /** Share of fills that were buys. A market maker buys the bid and sells
   * the ask, so its flow runs both ways; a position being built with
   * post-only orders is maker flow in one direction. */
  buyShare: number;
  sampleSize: number;
  /** True when the raw sample hit Hyperliquid's 2000-fill-per-call cap, so
   * tradesPerDay is a lower bound, not an exact count - a full page is a
   * sign there is more history, not that the history ends here. */
  cappedByApiLimit: boolean;
}

const HL_FILLS_PAGE_CAP = 2000;

export function computeTradeFeatures(trades: Trade[], windowHours: number): TradeFeatures {
  if (trades.length === 0) {
    return { tradesPerDay: 0, crossedShare: 0, buyShare: 0.5, sampleSize: 0, cappedByApiLimit: false };
  }
  const crossedCount = trades.filter((t) => t.crossed).length;
  const buyCount = trades.filter((t) => t.side === 'buy').length;
  return {
    tradesPerDay: (trades.length / windowHours) * 24,
    crossedShare: crossedCount / trades.length,
    buyShare: buyCount / trades.length,
    sampleSize: trades.length,
    cappedByApiLimit: trades.length >= HL_FILLS_PAGE_CAP,
  };
}
