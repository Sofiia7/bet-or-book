/**
 * The question a reading leaves open, and what would settle it.
 *
 * A verdict says what the data supports. It does not say what is still
 * unknown about the position, and that is the part a reader deciding
 * whether to copy it needs next: "the spot cover is there, but whether any
 * of it is owed back is not visible" is more use than a third paragraph of
 * caveats. The 23 September audit asked for exactly this, in words, from
 * data a reading already has - one sentence, specific to the reason the
 * rules gave, with this reading's own numbers where they help.
 */
import type { CheckResponse } from '../api/check';
import type { ReasonCode } from './verdict';
import { formatPct, formatUsd } from './evidence';

type Reading = Pick<CheckResponse, 'verdict' | 'positions' | 'hedge' | 'historical'>;

const coinOf = (r: Reading) => r.positions.headlineCoin ?? 'the asset';

const UNSEEN_HEDGE =
  'a hedge held on an exchange, agreed over the counter, or in a wallet with no on-chain link to this one. ' +
  'None of those is visible here.';

const PAIR_OR_VIEWS =
  'whether the long and short legs are meant to offset each other. No rule here can tell a pair trade ' +
  'from two separate views.';

/** One per reason the rules can put first; the compiler holds this to the
 * rules' own list (ReasonCode), as it does the rule sentences. */
const OPEN: Record<Exclude<ReasonCode, 'positions' | 'trades'>, (r: Reading) => string | null> = {
  'no open positions found': () => null,
  orders: (r) =>
    `whether this ${coinOf(r)} ${r.positions.headlineSide ?? 'position'} is inventory the book will lay off or a ` +
    'view it chose to keep. One reading of its orders cannot tell; watching the quoting over days would.',
  balanced_book: () =>
    'whether the offsetting legs stay together. Positions that cancel now can be closed one at a time.',
  hedge_leg: (r) =>
    `whether any of that ${coinOf(r)} is owed to someone. Debts are not read here, and ${coinOf(r)} that was ` +
    'borrowed would not offset the short.',
  over_covered: (r) =>
    `what the ${coinOf(r)} beyond the short is for: a view on ${coinOf(r)}, or collateral for something not read here.`,
  hedge_not_checked: () => 'the holdings this reading could not finish. Checking again may complete them.',
  unrecognised_assets: (r) =>
    `what the ${formatUsd(r.hedge.unverifiedUsd ?? 0)} of holdings named like ${coinOf(r)} really are: their ` +
    'contracts are not ones this tool recognises.',
  maker_flow_only: (r) =>
    `whether the account quotes the ${coinOf(r)} market itself over time. Busy trading describes the account, ` +
    'not this position.',
  partial_offset: (r) => `what the uncovered ${formatPct(Math.max(0, 1 - r.hedge.hedgeRatio))} of the position is for.`,
  quotes_not_checked: () => 'the resting orders on the venue that did not answer. Checking again may read them.',
  positions_not_complete: () =>
    'the positions on other Hyperliquid dexes, which only Nansen reads here. Checking again when Nansen answers ' +
    'would complete them.',
  directional_concentration: () => UNSEEN_HEDGE,
  directional_portfolio: () => UNSEEN_HEDGE,
  offset_not_measured: () => PAIR_OR_VIEWS,
  mixed_long_short_book: () => PAIR_OR_VIEWS,
  diversified_book_no_quotes: () =>
    'whether the account quotes on a venue not read here. A spread like a book, with nothing quoted, is a ' +
    'shape rather than a finding.',
  linked_exposure_unverified: (r) =>
    `who controls the wallets that funded this account. A funding transfer shows where the money came from, ` +
    `not who holds the ${coinOf(r)} now.`,
  'signals disagree: not enough evidence for book, hedge, or bet': () =>
    'which of the signs matters for this position. A second reading later may settle it.',
};

/** The open question for one reading, to follow "Still open:", or null when
 * there is nothing to ask - no position, or a reason from rules that have
 * since changed. */
export function openQuestion(r: Reading): string | null {
  if (r.historical) return 'how the current rules read this account. That needs a fresh check of it.';
  const reasons = r.verdict.reasons ?? [];
  if (r.verdict.verdict === 'book' && reasons.includes('orders')) return OPEN.orders(r);
  const first = reasons[0];
  if (first === undefined || !(first in OPEN)) return null;
  return OPEN[first as keyof typeof OPEN](r);
}
