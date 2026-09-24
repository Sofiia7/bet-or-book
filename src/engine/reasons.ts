/**
 * What each rule says, in words a reader can hold the card against.
 *
 * "How this was decided" used to open onto a raw reason code -
 * `directional_concentration`, `hedge_leg` - and a link to a table in the
 * README. That is an answer for someone auditing the classifier, not for
 * someone deciding whether to believe the card (23.09 audit, U06). The code
 * stays, under technical details; this is the sentence above it.
 *
 * The numbers come from the same thresholds the rules use, so the sentence
 * cannot drift from the rule it describes. The text lives here rather than
 * on the page for the same reason: the audit found reason strings repeated
 * on the backend and the frontend, where a fix to one did not reach the
 * other.
 */
import { DEFAULT_THRESHOLDS as T, type ReasonCode, type VerdictResult } from './verdict';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`);

/** Words for every reason the rules can put first. Typed against the rules'
 * own list, so a new reason does not compile until it has a sentence. The two
 * signs that only ever grade a book are below, with their own wording. */
const WHY: Record<Exclude<ReasonCode, 'positions' | 'trades'>, string> = {
  'no open positions found': 'Nothing is open at this address right now, so there is no position to judge.',

  // A book: quoting is what decides it, the rest only grades it.
  orders:
    `Called a book because this account quotes the position's own market on both sides - resting buy and sell ` +
    `orders worth at least ${usd(T.book.minTwoSidedNotionalUsd)} and ${pct(T.book.minTwoSidedNotionalShareOfHeadline)} ` +
    `of the position - which is what a market maker's inventory looks like.`,

  balanced_book:
    `Called hedged because the account's own positions offset each other in the same assets: at least ` +
    `${pct(T.hedged.minSameAssetOffsetShare)} of the exposure cancels within the same coins.`,
  hedge_leg:
    `Called hedged because this same account holds the asset itself, between ${pct(T.hedged.minHedgeRatio)} and ` +
    `${pct(T.hedged.maxHedgeRatio)} of the short's size. That is coverage on this account's visible balances; ` +
    `it says nothing about debt, margin or what happens at liquidation.`,

  over_covered:
    `Not called hedged: the account holds more of the asset than the short - over ${pct(T.hedged.maxHedgeRatio)} ` +
    `of its size - so on this asset it leans long, not neutral.`,
  hedge_not_checked:
    'No verdict: the account\'s holdings could not be read in full, so whether the short is covered is not known. ' +
    'That is a gap in the reading, not a finding about the account.',
  unrecognised_assets:
    `No verdict: holdings worth ${pct(T.hedged.maxUnverifiedShare)} of the position or more could not be ` +
    `identified or priced, so any coverage figure would be a guess.`,
  maker_flow_only:
    'No verdict: the account trades a lot on both sides, which describes the account rather than this position, ' +
    'and nothing else settled whether the position is covered.',
  partial_offset:
    `No verdict: between ${pct(T.bet.maxHedgeRatio)} and ${pct(T.hedged.minHedgeRatio)} of the position is ` +
    `covered in this account. Part of it is offset; the rest is still open.`,
  quotes_not_checked:
    'This would read as a bet, but not every venue\'s resting orders could be read, and "quotes nothing" ' +
    'needs all of them read.',
  positions_not_complete:
    'This would read as a bet, but the positions came from one venue only, and "nothing else is open" ' +
    'needs every venue read.',

  directional_concentration:
    `Looks like a bet: at most ${T.bet.maxPositions} positions, this one at least ${pct(T.bet.minHeadlineShare)} of ` +
    `the exposure, ${pct(T.bet.minNetToGross)} or more of it pointing one way, under ` +
    `${pct(T.bet.maxHedgeRatio)} covered, and no two-sided quotes.`,
  directional_portfolio:
    `Looks like a bet: the portfolio as a whole points one way - net at least ${pct(T.bet.minNetToGross)} of ` +
    `gross - with nothing quoted on both sides and under ${pct(T.bet.maxHedgeRatio)} covered. One stance spread ` +
    `over several positions.`,

  offset_not_measured:
    'No verdict: the long and short dollars roughly cancel, but this reading cannot tell whether the legs offset ' +
    'each other.',
  mixed_long_short_book:
    'No verdict: the long and short dollars roughly cancel, but in different assets. That is a portfolio, not a hedge.',
  diversified_book_no_quotes:
    `No verdict: ${T.book.minPositions} or more positions, spread like a market maker's book, with no two-sided ` +
    `quotes to confirm it.`,
  linked_exposure_unverified:
    'No verdict: the matching asset sits in wallets that funded this account. A funding link shows where the money ' +
    'came from, not who holds it now, so it cannot count as this account\'s hedge.',
  'signals disagree: not enough evidence for book, hedge, or bet':
    'No verdict: the signs point different ways, and none of them is enough for a book, a hedge or a bet.',
};

/** A short phrase for the Unknown badge itself - "Unknown · assets sit with
 * funders" - so the badge says more than "Unknown" before anything is
 * opened. Only ever shown when `verdict.verdict === 'unknown'`; deliberately
 * silent on 'no open positions found' (nothing to qualify) and on the two
 * reasons that only ever grade a Book. Typed against the same `ReasonCode`
 * union `WHY` already is, so a new reason cannot ship without a phrase here
 * either (24.09 audit U02 + L10: one dictionary, not one on the server and a
 * second, drifting one on the page). */
const BADGE_QUALIFIER: Record<Exclude<ReasonCode, 'positions' | 'trades' | 'no open positions found'>, string> = {
  orders: 'market-making activity',
  balanced_book: 'offsetting positions',
  hedge_leg: 'hedge found',
  over_covered: 'more than covered',
  hedge_not_checked: 'hedge not checked',
  unrecognised_assets: 'assets unverified',
  maker_flow_only: 'busy, not proven inventory',
  partial_offset: 'partly covered',
  quotes_not_checked: 'orders not fully read',
  positions_not_complete: 'positions not fully read',
  directional_concentration: 'looks directional',
  directional_portfolio: 'looks directional',
  offset_not_measured: 'offset not measured',
  mixed_long_short_book: 'mixed assets',
  diversified_book_no_quotes: 'book-shaped, no quotes',
  linked_exposure_unverified: 'assets sit with funders',
  'signals disagree: not enough evidence for book, hedge, or bet': 'signals disagree',
};

/** The short badge qualifier for one verdict, or null when there is none -
 * no reasons at all, the sole "no open positions" reason, or a historical
 * reading (whose rules may not have a phrase here). */
export function badgeQualifier(verdict: VerdictResult, historical = false): string | null {
  if (historical) return null;
  const first = verdict.reasons?.[0];
  return first !== undefined && first in BADGE_QUALIFIER ? BADGE_QUALIFIER[first as keyof typeof BADGE_QUALIFIER] : null;
}

/** What grades a book beyond the quoting that decides it. */
const BOOK_ALSO: Record<'positions' | 'trades', string> = {
  positions: 'a spread of positions typical of a book',
  trades: 'busy two-sided trading',
};

/**
 * The rule behind a verdict, as one or two plain sentences, or null for a
 * reason this version has no words for - a code from rules that have since
 * changed, which the page then shows as the code alone.
 */
export function ruleExplanation(verdict: VerdictResult, historical = false): string | null {
  if (historical) {
    return 'Read by an earlier version of the rules, kept as it was then. Checking the address again reads it under the current ones.';
  }
  const reasons = verdict.reasons ?? [];
  // A book's reasons list every signal that fired, in the order they are
  // checked; quoting is the one that decides, wherever it sits in the list.
  if (verdict.verdict === 'book' && reasons.includes('orders')) {
    const also = reasons
      .map((r) => (r === 'positions' || r === 'trades' ? BOOK_ALSO[r] : undefined))
      .filter((s): s is string => s !== undefined);
    return also.length ? `${WHY.orders} Also seen: ${also.join(' and ')}.` : WHY.orders;
  }
  const first = reasons[0];
  return first !== undefined && first in WHY ? WHY[first as keyof typeof WHY] : null;
}
