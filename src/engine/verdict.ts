import type { PositionFeatures, OrderFeatures, HedgeFeatures, HedgeCoverage } from './features';

export type Verdict = 'book' | 'hedged' | 'looks_like_a_bet' | 'unknown';
/** `likely`/`strong` grade a book by how many independent signals agree.
 * There is no grade for a hedge: either the account holds the offsetting
 * asset itself or the position is not called hedged at all. */
export type VerdictStrength = 'likely' | 'strong' | null;

export interface VerdictThresholds {
  book: {
    minPositions: number;
    maxNetToGross: number;
    minRestingOrders: number;
    minBidShare: number;
    maxBidShare: number;
    minCoinsBothSides: number;
    minTradesPerDay: number;
    maxCrossedShare: number;
    minFillBuyShare: number;
    maxFillBuyShare: number;
  };
  hedged: {
    /** A hedge is a band, not a floor: below it the position is only partly
     * offset, above it the account is net long the asset it is short. */
    minHedgeRatio: number;
    maxHedgeRatio: number;
    /** Below this the account's own holdings explain so little that the
     * wallets which funded it are worth a look. */
    linkedLookupBelowRatio: number;
    minPositionsForBalancedBook: number;
    maxPositionsForBalancedBook: number;
    minSameAssetOffsetShare: number;
  };
  bet: {
    maxPositions: number;
    minNetToGross: number;
    minHeadlineShare: number;
    maxHedgeRatio: number;
  };
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  book: {
    minPositions: 20,
    maxNetToGross: 0.35,
    minRestingOrders: 50,
    minBidShare: 0.25,
    maxBidShare: 0.75,
    minCoinsBothSides: 5,
    minTradesPerDay: 200,
    maxCrossedShare: 0.4,
    // Added 18.09 after the gallery scan: without a side condition, one-way
    // maker flow (535 fills, all "Open Short"; 2 000 fills, all "Sell") read
    // as a book. Same window as the bid share of resting orders.
    minFillBuyShare: 0.25,
    maxFillBuyShare: 0.75,
  },
  hedged: {
    // A hedge put on at parity drifts as the price moves, so a band rather
    // than a point. Outside it the residual is the story: 59% coverage of a
    // $7.2M short leaves $2.9M short, 195% leaves $14.6M long. In the 18.09
    // gallery seven cards sit between 93% and 100%, three below 70% and five
    // above 122% - three different situations the old 50% floor merged.
    minHedgeRatio: 0.85,
    maxHedgeRatio: 1.15,
    linkedLookupBelowRatio: 0.5,
    minPositionsForBalancedBook: 2,
    maxPositionsForBalancedBook: 19,
    // Dollars that net out prove nothing on their own; this is the share of
    // gross that has to cancel inside individual assets before a book counts
    // as offset rather than as two live bets that happen to be equal in size.
    minSameAssetOffsetShare: 0.8,
  },
  bet: {
    maxPositions: 5,
    minNetToGross: 0.8,
    minHeadlineShare: 0.5,
    maxHedgeRatio: 0.1,
  },
};

export interface VerdictInput {
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  /** Trade-history signal (book rule (в)), from Hyperliquid's fill-level
   * `userFillsByTime`. Its thresholds are calibrated on fills; Nansen's
   * perp-trades aggregates fills per order and must not be fed in here. */
  trades?: { tradesPerDay: number; crossedShare: number; buyShare: number };
  /** Hedge held by wallets linked through a funding transaction. */
  linkedHedge?: { linkedHedgeRatio: number };
  /** How completely the hedge was looked for. Absent means complete, which
   * is what every caller inside this repo passes explicitly. */
  hedgeCoverage?: HedgeCoverage;
}

export interface VerdictResult {
  verdict: Verdict;
  strength: VerdictStrength;
  reasons: string[];
}

type StructureInput = Pick<VerdictInput, 'positions' | 'orders' | 'trades'>;

function bookSignals(input: StructureInput, t: VerdictThresholds['book']): string[] {
  const signals: string[] = [];
  if (input.positions.nPositions >= t.minPositions && input.positions.netToGross <= t.maxNetToGross) {
    signals.push('positions');
  }
  if (
    input.orders.restingOrders >= t.minRestingOrders &&
    input.orders.bidShare >= t.minBidShare &&
    input.orders.bidShare <= t.maxBidShare &&
    input.orders.coinsBothSides >= t.minCoinsBothSides
  ) {
    signals.push('orders');
  }
  if (
    input.trades &&
    input.trades.tradesPerDay >= t.minTradesPerDay &&
    input.trades.crossedShare <= t.maxCrossedShare &&
    input.trades.buyShare >= t.minFillBuyShare &&
    input.trades.buyShare <= t.maxFillBuyShare
  ) {
    signals.push('trades');
  }
  return signals;
}

/** A handful of positions whose dollars roughly cancel. Says nothing yet
 * about which assets they are in. */
function isDollarBalanced(input: StructureInput, thresholds: VerdictThresholds): boolean {
  const h = thresholds.hedged;
  return (
    input.positions.nPositions >= h.minPositionsForBalancedBook &&
    input.positions.nPositions <= h.maxPositionsForBalancedBook &&
    input.positions.netToGross <= thresholds.book.maxNetToGross
  );
}

/** Snapshots written before the offset was measured carry no such field, and
 * "not measured" must not read as "measured zero". */
function offsetShare(input: StructureInput): number | null {
  const share = input.positions.sameAssetOffsetShare;
  return typeof share === 'number' && Number.isFinite(share) ? share : null;
}

/** A balanced book whose legs really do cancel: a $1M BTC long against a $1M
 * TRUMP short nets to zero dollars and still leaves both bets running, so
 * dollar balance alone is not an offset. */
function isSameAssetBook(input: StructureInput, thresholds: VerdictThresholds): boolean {
  const share = offsetShare(input);
  return share !== null && share >= thresholds.hedged.minSameAssetOffsetShare && isDollarBalanced(input, thresholds);
}

/** A hedge read costs a credit, so it is worth making only when its answer
 * could move the verdict: positions exist, no book signal fired, the book is
 * not already balanced, and the headline is a short - spot offsets nothing
 * else. Mirrors the order of the rules in computeVerdict. */
export function hedgeCanChangeVerdict(
  input: StructureInput,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    input.positions.nPositions > 0 &&
    input.positions.headlineSide === 'short' &&
    bookSignals(input, thresholds.book).length === 0 &&
    !isSameAssetBook(input, thresholds)
  );
}

export function computeVerdict(
  input: VerdictInput,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): VerdictResult {
  if (input.positions.nPositions === 0) {
    return { verdict: 'unknown', strength: null, reasons: ['no open positions found'] };
  }

  // A book is a claim about the position in front of the user, so it needs
  // evidence about the account's actual book: how its positions are spread,
  // or what it is quoting. The fill count is neither. It is taken across
  // every market the account touches and carries no notional, so hundreds of
  // small quotes on another coin could settle the character of one large
  // position elsewhere. It corroborates, it does not decide.
  const book = bookSignals(input, thresholds.book);
  const structural = book.filter((s) => s !== 'trades');
  if (structural.length >= 1) {
    return { verdict: 'book', strength: book.length >= 2 ? 'strong' : 'likely', reasons: book };
  }
  if (book.length >= 1) {
    return { verdict: 'unknown', strength: null, reasons: ['maker_flow_only'] };
  }

  const h = thresholds.hedged;
  const ratio = input.hedge.hedgeRatio;
  const hedgedByLeg = ratio >= h.minHedgeRatio && ratio <= h.maxHedgeRatio;
  const balancedBook = isSameAssetBook(input, thresholds);
  if (hedgedByLeg || balancedBook) {
    return { verdict: 'hedged', strength: null, reasons: [hedgedByLeg ? 'hedge_leg' : 'balanced_book'] };
  }

  // Partly offset is still a position, and over-covered is a position the
  // other way round. Neither of them is "not a directional view".
  if (ratio > h.maxHedgeRatio) {
    return { verdict: 'unknown', strength: null, reasons: ['over_covered'] };
  }
  // Everything below this point reads a low ratio as a fact about the
  // account. That only holds if the holdings were actually read: a failed or
  // truncated read can hide a hedge, and "we did not look" must not come out
  // as "there is nothing there".
  const hedgeCoverage = input.hedgeCoverage ?? 'complete';
  if (hedgeCoverage === 'missing' || hedgeCoverage === 'partial') {
    return { verdict: 'unknown', strength: null, reasons: ['hedge_not_checked'] };
  }

  if (ratio >= thresholds.bet.maxHedgeRatio) {
    return { verdict: 'unknown', strength: null, reasons: ['partial_offset'] };
  }

  const linkedRatio = input.linkedHedge?.linkedHedgeRatio ?? 0;
  const b = thresholds.bet;
  const looksLikeABet =
    input.positions.nPositions <= b.maxPositions &&
    input.positions.netToGross >= b.minNetToGross &&
    input.positions.headlineShare >= b.minHeadlineShare &&
    input.hedge.hedgeRatio + linkedRatio < b.maxHedgeRatio &&
    input.orders.coinsBothSides === 0;
  if (looksLikeABet) {
    return { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] };
  }

  // Dollars that cancel across unrelated assets are a portfolio, not a
  // hedge. Naming which of the two it is beats calling both "hedged".
  if (isDollarBalanced(input, thresholds)) {
    return {
      verdict: 'unknown',
      strength: null,
      reasons: [offsetShare(input) === null ? 'offset_not_measured' : 'mixed_long_short_book'],
    };
  }

  // Matching assets in a wallet that funded this account are not this
  // account's hedge. A funding transaction says where the money came from,
  // not who holds it now, and the funder is often an exchange - in the 18.09
  // gallery two of the four "probable hedge" cards were funded by one. Linked
  // holdings can therefore only withhold a verdict, never grant one.
  if (linkedRatio >= b.maxHedgeRatio) {
    return { verdict: 'unknown', strength: null, reasons: ['linked_exposure_unverified'] };
  }

  return {
    verdict: 'unknown',
    strength: null,
    reasons: ['signals disagree: not enough evidence for book, hedge, or bet'],
  };
}
