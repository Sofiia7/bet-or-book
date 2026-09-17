import type { PositionFeatures, OrderFeatures, HedgeFeatures } from './features';

export type Verdict = 'book' | 'hedged' | 'looks_like_a_bet' | 'unknown';
export type BookStrength = 'likely' | 'strong' | null;

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
  };
  hedged: {
    minHedgeRatio: number;
    minPositionsForBalancedBook: number;
    maxPositionsForBalancedBook: number;
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
  },
  hedged: {
    minHedgeRatio: 0.5,
    minPositionsForBalancedBook: 2,
    maxPositionsForBalancedBook: 19,
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
  /** Trade-history signal (book rule (в)). Wired in once Phase 2 adds paginated trade history. */
  trades?: { tradesPerDay: number; crossedShare: number };
}

export interface VerdictResult {
  verdict: Verdict;
  strength: BookStrength;
  reasons: string[];
}

function bookSignals(input: VerdictInput, t: VerdictThresholds['book']): string[] {
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
    input.trades.crossedShare <= t.maxCrossedShare
  ) {
    signals.push('trades');
  }
  return signals;
}

export function computeVerdict(
  input: VerdictInput,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): VerdictResult {
  if (input.positions.nPositions === 0) {
    return { verdict: 'unknown', strength: null, reasons: ['no open positions found'] };
  }

  const book = bookSignals(input, thresholds.book);
  if (book.length >= 1) {
    return { verdict: 'book', strength: book.length >= 2 ? 'strong' : 'likely', reasons: book };
  }

  const h = thresholds.hedged;
  const balancedBook =
    input.positions.nPositions >= h.minPositionsForBalancedBook &&
    input.positions.nPositions <= h.maxPositionsForBalancedBook &&
    input.positions.netToGross <= thresholds.book.maxNetToGross;
  if (input.hedge.hedgeRatio >= h.minHedgeRatio || balancedBook) {
    return {
      verdict: 'hedged',
      strength: null,
      reasons: input.hedge.hedgeRatio >= h.minHedgeRatio ? ['hedge_leg'] : ['balanced_book'],
    };
  }

  const b = thresholds.bet;
  const looksLikeABet =
    input.positions.nPositions <= b.maxPositions &&
    input.positions.netToGross >= b.minNetToGross &&
    input.positions.headlineShare >= b.minHeadlineShare &&
    input.hedge.hedgeRatio < b.maxHedgeRatio &&
    input.orders.coinsBothSides === 0;
  if (looksLikeABet) {
    return { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] };
  }

  return {
    verdict: 'unknown',
    strength: null,
    reasons: ['signals disagree: not enough evidence for book, hedge, or bet'],
  };
}
