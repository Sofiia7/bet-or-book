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
    /** Two-sided quoting has to amount to something both in itself and
     * against the position being asked about. Neither figure is calibrated
     * against an independent sample; they are a floor on materiality, not a
     * measurement of how likely an account is to be a market maker. */
    minTwoSidedNotionalUsd: number;
    minTwoSidedNotionalShareOfHeadline: number;
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
    /** Share of the headline position that may sit in holdings this tool
     * could not identify before the coverage number stops being a finding
     * and becomes a lower bound. */
    maxUnverifiedShare: number;
  };
  bet: {
    maxPositions: number;
    minNetToGross: number;
    minHeadlineShare: number;
    maxHedgeRatio: number;
  };
}

/**
 * The vintage of the rules below. A verdict is only meaningful together with
 * the rules that produced it, so it travels with one: cached answers from
 * before a deploy are not served as if they came from after it, and a saved
 * card says which rules read it.
 *
 * v1 produced the 18 September gallery scan. v2 is this file after the 19.09
 * audit: funding wallets no longer make a hedge, a balanced book needs its
 * legs in the same assets, a hedge is a band rather than a floor, an
 * unchecked hedge is not an absent one, and fills alone no longer make a
 * book.
 *
 * v3 follows the 21.09 audit. A book needs two-sided quoting worth something
 * against the position rather than a count of positions; the completeness of
 * the holdings read is checked before the hedge band and not only after it;
 * holdings whose asset could not be established withhold the finding instead
 * of counting as zero; and a rule that asserts an absence - no quotes, no
 * other positions - needs the source it is about to have been read in full.
 */
export const CLASSIFIER_VERSION = 'v3';

export const DEFAULT_THRESHOLDS: VerdictThresholds = {
  book: {
    minPositions: 20,
    maxNetToGross: 0.35,
    minRestingOrders: 50,
    minBidShare: 0.25,
    maxBidShare: 0.75,
    minCoinsBothSides: 5,
    // Added 21.09 after the audit: 50 resting orders of $1 each, in markets
    // the account holds no position in, satisfied every other condition and
    // classified a $1M short as inventory. A quote that cannot absorb
    // anything is not a market being made.
    minTwoSidedNotionalUsd: 10_000,
    minTwoSidedNotionalShareOfHeadline: 0.1,
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
    // A tenth of the position is the same size at which a hedge stops being
    // called nothing (bet.maxHedgeRatio); holdings that big and unidentified
    // could move the answer, so the answer waits.
    maxUnverifiedShare: 0.1,
  },
  bet: {
    maxPositions: 5,
    minNetToGross: 0.8,
    minHeadlineShare: 0.5,
    maxHedgeRatio: 0.1,
  },
};

/** How completely one source was read. A rule that makes a negative claim -
 * "nothing offsets this", "it quotes nothing" - needs `complete` on the
 * input that claim is about; anything less can only hide evidence. */
export type SourceCoverage = 'complete' | 'partial' | 'missing';

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
  /** How completely the account's resting orders were read. A failed HIP-3
   * dex leaves this `partial`, and "it quotes nothing" is then a statement
   * about the reading rather than about the account. */
  ordersCoverage?: SourceCoverage;
  /** How completely the account's positions were read. Hyperliquid's own
   * clearinghouse answers for the main dex only, so a fallback reading
   * cannot see a HIP-3 leg and cannot support a claim about concentration. */
  positionsCoverage?: SourceCoverage;
}

export interface VerdictResult {
  verdict: Verdict;
  strength: VerdictStrength;
  reasons: string[];
}

type StructureInput = Pick<VerdictInput, 'positions' | 'orders' | 'trades'>;

/** Dollars of two-sided quoting that make the quoting material against the
 * position being asked about. */
function materialQuoteFloor(input: StructureInput, t: VerdictThresholds['book']): number {
  return Math.max(t.minTwoSidedNotionalUsd, t.minTwoSidedNotionalShareOfHeadline * input.positions.headlineNotionalUsd);
}

function bookSignals(input: StructureInput, t: VerdictThresholds['book']): string[] {
  const signals: string[] = [];
  if (input.positions.nPositions >= t.minPositions && input.positions.netToGross <= t.maxNetToGross) {
    signals.push('positions');
  }
  if (
    input.orders.restingOrders >= t.minRestingOrders &&
    input.orders.bidShare >= t.minBidShare &&
    input.orders.bidShare <= t.maxBidShare &&
    input.orders.coinsBothSides >= t.minCoinsBothSides &&
    (input.orders.twoSidedNotionalUsd ?? 0) >= materialQuoteFloor(input, t)
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
 * could move the verdict: positions exist, the quoting has not already
 * settled the account, the book is not already balanced, and the headline is
 * a short - spot offsets nothing else. Mirrors the order of the rules in
 * computeVerdict, so it has to follow it when those change: a wide position
 * spread no longer decides anything on its own, so it no longer stops the
 * hedge read either. */
export function hedgeCanChangeVerdict(
  input: StructureInput,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    input.positions.nPositions > 0 &&
    input.positions.headlineSide === 'short' &&
    !bookSignals(input, thresholds.book).includes('orders') &&
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

  // A book is a claim about the position in front of the user: that it is
  // inventory a market maker is carrying. What can carry that claim is
  // evidence of the account making a market - two-sided quoting large enough
  // to matter against the position. A wide spread of positions and a busy
  // fill count describe the account; neither of them decides, because both
  // are counts with no notional behind them and both are taken across every
  // market the account touches rather than this one.
  const book = bookSignals(input, thresholds.book);
  if (book.includes('orders')) {
    return { verdict: 'book', strength: book.length >= 2 ? 'strong' : 'likely', reasons: book };
  }
  if (book.includes('trades')) {
    return { verdict: 'unknown', strength: null, reasons: ['maker_flow_only'] };
  }

  const h = thresholds.hedged;
  const ratio = input.hedge.hedgeRatio;
  const hedgedByLeg = ratio >= h.minHedgeRatio && ratio <= h.maxHedgeRatio;

  // A balanced book is a statement about the positions themselves, so it
  // does not wait on the holdings read.
  if (isSameAssetBook(input, thresholds)) {
    return { verdict: 'hedged', strength: null, reasons: ['balanced_book'] };
  }

  // Over-covered first: holdings that were missed can only add to the spot
  // leg, so a leg already past parity stays past it however much was missed.
  // It is the one conclusion an incomplete read can still support.
  if (ratio > h.maxHedgeRatio) {
    return { verdict: 'unknown', strength: null, reasons: ['over_covered'] };
  }

  // Everything below reads the ratio as a fact about the account, including
  // the band that calls it hedged. A ratio of 100% on the first page of
  // holdings is $X found against $X, not a measurement of the whole
  // exposure: the next page may hold twice as much of the same asset.
  const hedgeCoverage = input.hedgeCoverage ?? 'complete';
  if (hedgeCoverage === 'missing' || hedgeCoverage === 'partial') {
    return { verdict: 'unknown', strength: null, reasons: ['hedge_not_checked'] };
  }
  // Holdings that were read but could not be identified are the same kind of
  // gap: the dollars are there, what they are is not established, and a
  // material amount of them is enough to withhold the finding.
  const unverifiedShare =
    input.positions.headlineNotionalUsd > 0
      ? (input.hedge.unverifiedUsd ?? 0) / input.positions.headlineNotionalUsd
      : 0;
  if (unverifiedShare >= h.maxUnverifiedShare || (input.hedge.unpricedMatches ?? 0) > 0) {
    return { verdict: 'unknown', strength: null, reasons: ['unrecognised_assets'] };
  }

  if (hedgedByLeg) {
    return { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] };
  }

  // Partly offset is still a position, and over-covered is a position the
  // other way round. Neither of them is "not a directional view".
  if (ratio >= thresholds.bet.maxHedgeRatio) {
    return { verdict: 'unknown', strength: null, reasons: ['partial_offset'] };
  }

  const linkedRatio = input.linkedHedge?.linkedHedgeRatio ?? 0;
  const b = thresholds.bet;
  const concentrated =
    input.positions.nPositions <= b.maxPositions &&
    input.positions.netToGross >= b.minNetToGross &&
    input.positions.headlineShare >= b.minHeadlineShare &&
    input.hedge.hedgeRatio + linkedRatio < b.maxHedgeRatio &&
    input.orders.coinsBothSides === 0;
  if (concentrated) {
    // The bet rule is made of negative claims - few positions, no quotes -
    // and a negative claim needs the source it is about to have been read.
    // A HIP-3 dex that answered 503 is not an account that quotes nothing,
    // and a main-dex-only position read is not a whole portfolio.
    if ((input.ordersCoverage ?? 'complete') !== 'complete') {
      return { verdict: 'unknown', strength: null, reasons: ['quotes_not_checked'] };
    }
    if ((input.positionsCoverage ?? 'complete') !== 'complete') {
      return { verdict: 'unknown', strength: null, reasons: ['positions_not_complete'] };
    }
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

  // A spread wide enough that the account looks like it runs a book, with
  // nothing quoted to confirm it. Said as what it is rather than folded into
  // "signals disagree", which is where it used to land once the position
  // count stopped deciding on its own.
  if (book.includes('positions')) {
    return { verdict: 'unknown', strength: null, reasons: ['diversified_book_no_quotes'] };
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
