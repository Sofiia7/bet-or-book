import type { Position, PositionSide, RestingOrder, SpotHolding, Trade, LinkedWallet } from '../types';
import { classifyHolding, isLendingReceipt, type AssetMatch } from './assets';

export interface PositionFeatures {
  nPositions: number;
  grossUsd: number;
  netUsd: number;
  netToGross: number;
  headlineCoin: string | null;
  headlineSide: PositionSide | null;
  headlineNotionalUsd: number;
  headlineShare: number;
  /** How far the price has to move from where it is now before the headline
   * position is liquidated. Measured from the entry price only when no mark
   * is available, which `headlineLiqDistanceBasis` says. */
  headlineLiqDistancePct: number | null;
  headlineLiqDistanceBasis: 'mark' | 'entry' | null;
  /** Share of gross exposure that cancels within a single asset: a $1M long
   * and a $1M short in the same coin offset each other, a $1M long in one
   * coin and a $1M short in another do not, however neatly the dollars net
   * out. Zero when nothing cancels, 1 when every leg has a counterpart. */
  sameAssetOffsetShare: number;
}

export function computePositionFeatures(
  positions: Position[],
  /** Current mark price per coin, where it is known. */
  markPxByCoin?: Map<string, number>,
): PositionFeatures {
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
      headlineLiqDistanceBasis: null,
      sameAssetOffsetShare: 0,
    };
  }

  const signed = positions.map((p) => (p.side === 'long' ? p.sizeUsd : -p.sizeUsd));
  const grossUsd = positions.reduce((sum, p) => sum + p.sizeUsd, 0);
  const netUsd = Math.abs(signed.reduce((sum, s) => sum + s, 0));
  const netToGross = grossUsd === 0 ? 0 : netUsd / grossUsd;

  const headline = positions.reduce((max, p) => (p.sizeUsd > max.sizeUsd ? p : max), positions[0]);
  const headlineShare = grossUsd === 0 ? 0 : headline.sizeUsd / grossUsd;

  // Distance to liquidation is a question about now, not about when the
  // position was opened. With entry 100, mark 150 and liquidation 90, the
  // entry-based figure says 10% when the holder has 40% of room, which is a
  // risk they stopped having as soon as the price moved.
  const markPx = markPxByCoin?.get(headline.coin);
  const base = markPx !== undefined && Number.isFinite(markPx) && markPx > 0 ? markPx : headline.entryPx;
  const basis: 'mark' | 'entry' | null = base === markPx ? 'mark' : 'entry';
  let headlineLiqDistancePct: number | null = null;
  let headlineLiqDistanceBasis: 'mark' | 'entry' | null = null;
  if (headline.liquidationPx !== null && base > 0) {
    headlineLiqDistancePct = Math.abs(headline.liquidationPx - base) / base;
    headlineLiqDistanceBasis = basis;
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
    headlineLiqDistanceBasis,
    sameAssetOffsetShare: grossUsd === 0 ? 0 : offsetGrossUsd / grossUsd,
  };
}

export interface OrderFeatures {
  restingOrders: number;
  bidShare: number;
  coinsBothSides: number;
  /** Dollars resting on the book, and the part of that sitting in markets
   * quoted on both sides. A count of orders says how many there are, not
   * whether they amount to anything: fifty $1 orders and fifty $20K orders
   * are the same number and two different accounts. */
  notionalUsd: number;
  twoSidedNotionalUsd: number;
  /** Whether the market of the position being asked about is itself quoted
   * on both sides, and how much rests there. Quoting somewhere else is an
   * activity of the account, not an explanation of this position. */
  headlineTwoSided: boolean;
  headlineQuoteNotionalUsd: number;
}

export const EMPTY_ORDERS: OrderFeatures = {
  restingOrders: 0,
  bidShare: 0.5,
  coinsBothSides: 0,
  notionalUsd: 0,
  twoSidedNotionalUsd: 0,
  headlineTwoSided: false,
  headlineQuoteNotionalUsd: 0,
};

export function computeOrderFeatures(orders: RestingOrder[], headlineCoin: string | null = null): OrderFeatures {
  if (orders.length === 0) return { ...EMPTY_ORDERS };
  const bids = orders.filter((o) => o.side === 'bid').length;
  const bidShare = bids / orders.length;

  const byCoin = new Map<string, { sides: Set<'bid' | 'ask'>; notionalUsd: number }>();
  for (const order of orders) {
    const e = byCoin.get(order.coin) ?? { sides: new Set<'bid' | 'ask'>(), notionalUsd: 0 };
    e.sides.add(order.side);
    e.notionalUsd += Number.isFinite(order.sizeUsd) ? order.sizeUsd : 0;
    byCoin.set(order.coin, e);
  }
  const twoSided = [...byCoin.entries()].filter(([, e]) => e.sides.size === 2);
  const headline = headlineCoin === null ? undefined : byCoin.get(headlineCoin);

  return {
    restingOrders: orders.length,
    bidShare,
    coinsBothSides: twoSided.length,
    notionalUsd: [...byCoin.values()].reduce((sum, e) => sum + e.notionalUsd, 0),
    twoSidedNotionalUsd: twoSided.reduce((sum, [, e]) => sum + e.notionalUsd, 0),
    headlineTwoSided: headline !== undefined && headline.sides.size === 2,
    headlineQuoteNotionalUsd: headline?.notionalUsd ?? 0,
  };
}

export interface HedgeFeatures {
  hedgeUsd: number;
  hedgeRatio: number;
  /** Holdings that carry the right ticker but whose asset this tool could
   * not establish, so they were left out. Stated rather than silently
   * dropped: a material amount of these means the coverage number is a lower
   * bound and "nothing offsets this position" is not something to say. */
  unverifiedUsd: number;
  /** The part of `unverifiedUsd` that sits on a chain the contract registry
   * does not cover at all, as opposed to an unrecognised token on a chain it
   * does. The first is a gap in this tool, the second a judgement about the
   * token. */
  unverifiedOnUnsupportedChainUsd: number;
  /** Matching holdings that no price could be put on. Their size is unknown,
   * so they are counted, not valued. */
  unpricedMatches: number;
  /** Which endpoint each counted dollar came from. The card used to sign the
   * whole figure "Nansen" whenever Nansen had been asked, including the part
   * that came from Hyperliquid's own spot balances. */
  hedgeUsdBySource: { hyperliquidSpot: number; onchain: number };
  /** Of what was counted, how much is a lending-market deposit. Real, but a
   * loan taken against it is not visible from any endpoint read here. */
  lendingUsd: number;
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

/** No hedge, measured. Every field zero, which is what a position spot
 * cannot offset at all is entitled to. */
export const EMPTY_HEDGE: HedgeFeatures = {
  hedgeUsd: 0,
  hedgeRatio: 0,
  unverifiedUsd: 0,
  unverifiedOnUnsupportedChainUsd: 0,
  unpricedMatches: 0,
  hedgeUsdBySource: { hyperliquidSpot: 0, onchain: 0 },
  lendingUsd: 0,
};

/** Spot can offset only a short: holding the asset while also long the perp
 * is more of the same bet, not a hedge. */
export function computeHedgeFeatures(
  headlineCoin: string | null,
  headlineSide: PositionSide | null,
  headlineNotionalUsd: number,
  holdings: SpotHolding[],
): HedgeFeatures {
  if (headlineCoin === null || headlineSide !== 'short' || headlineNotionalUsd === 0) {
    return { ...EMPTY_HEDGE };
  }
  const by = (state: AssetMatch) => holdings.filter((h) => classifyHolding(h, headlineCoin) === state);
  const sum = (hs: SpotHolding[]) => hs.reduce((total, h) => total + h.valueUsd, 0);

  const counted = by('match');
  const hedgeUsd = sum(counted);
  const unknownContract = by('unknown-contract');
  const unsupportedChain = by('unsupported-chain');
  return {
    hedgeUsd,
    hedgeRatio: hedgeUsd / headlineNotionalUsd,
    unverifiedUsd: sum(unknownContract) + sum(unsupportedChain),
    unverifiedOnUnsupportedChainUsd: sum(unsupportedChain),
    unpricedMatches: by('unpriced').length,
    hedgeUsdBySource: {
      hyperliquidSpot: sum(counted.filter((h) => h.source === 'hyperliquid-spot')),
      onchain: sum(counted.filter((h) => h.source === 'onchain')),
    },
    lendingUsd: sum(counted.filter((h) => isLendingReceipt(h.chain, h.tokenAddress))),
  };
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
        : l.holdings
            .filter((h) => classifyHolding(h, headlineCoin) === 'match')
            .reduce((s, h) => s + h.valueUsd, 0),
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
  /** Notional traded across every market in the sample. */
  notionalUsd: number;
  /** Hours actually covered by the fills, which can be far less than the
   * window asked for: 2 000 fills can all land inside a few minutes. */
  spanHours: number;
  /** Fills in the market of the headline position, and their share of the
   * sample. A busy account whose flow is all somewhere else says nothing
   * about the position in front of the user. */
  headlineFills: number;
  headlineShareOfFills: number;
}

const HL_FILLS_PAGE_CAP = 2000;

export function computeTradeFeatures(
  trades: Trade[],
  windowHours: number,
  headlineCoin: string | null = null,
): TradeFeatures {
  if (trades.length === 0) {
    return {
      tradesPerDay: 0,
      crossedShare: 0,
      buyShare: 0.5,
      sampleSize: 0,
      cappedByApiLimit: false,
      notionalUsd: 0,
      spanHours: 0,
      headlineFills: 0,
      headlineShareOfFills: 0,
    };
  }
  const crossedCount = trades.filter((t) => t.crossed).length;
  const buyCount = trades.filter((t) => t.side === 'buy').length;
  const times = trades.map((t) => t.timestamp);
  const headlineFills = headlineCoin === null ? 0 : trades.filter((t) => t.coin === headlineCoin).length;
  return {
    tradesPerDay: (trades.length / windowHours) * 24,
    crossedShare: crossedCount / trades.length,
    buyShare: buyCount / trades.length,
    sampleSize: trades.length,
    cappedByApiLimit: trades.length >= HL_FILLS_PAGE_CAP,
    notionalUsd: trades.reduce((sum, t) => sum + (Number.isFinite(t.sizeUsd) ? t.sizeUsd : 0), 0),
    spanHours: (Math.max(...times) - Math.min(...times)) / 3_600_000,
    headlineFills,
    headlineShareOfFills: headlineFills / trades.length,
  };
}
