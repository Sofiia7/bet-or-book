import type { CheckResponse } from '../api/check';
import { badgeQualifier, normalizeReason } from './reasons';

export const VERDICT_STYLES = {
  book: { label: 'Book', cls: 'book', headline: 'This is a market-making book.', accent: '#7fa2ff', description: 'Orders on both sides of the market point to trading inventory.' },
  hedged: { label: 'Hedged', cls: 'hedged', headline: 'The offsetting asset is in this same account.', accent: '#4fe0b0', description: 'Matching holdings at this address cover the short.' },
  looks_like_a_bet: { label: 'Looks like a bet', cls: 'bet', headline: 'This looks like a real bet.', accent: '#f2b35c', description: 'A concentrated directional position, with no visible offset found.' },
  unknown: { label: 'Unknown', cls: 'unknown', headline: 'Not enough evidence either way.', accent: '#a3a8b6', description: 'The available evidence leaves an open question.' },
};
const HEADLINES: Record<string, string> = {
  perp_offset_unresolved: 'Opposing perpetual legs are visible. Their combined exposure is unresolved.',
  liability_not_resolved: 'This account owes the same asset. Spot coverage does not subtract that debt.',
  underlying_not_verified: 'The underlying asset of this market could not be verified.',
  linked_holdings_not_checked: 'The funding-wallet search did not finish.',
  linked_exposure_unverified: 'The matching assets sit in a wallet that funded this account, not in this account.',
  mixed_long_short_book: 'The dollars net out, but across different assets.',
  offset_not_measured: 'The dollars net out; this snapshot cannot say whether the legs offset each other.',
  partial_offset: 'Only part of this position is covered. The rest is still open.',
  over_covered: 'More than covered: on the asset itself, this account is net long.',
  hedge_not_checked: 'Directional exposure is visible. Whether it is hedged could not be checked.',
  unrecognised_assets: 'Some matching assets could not be identified or priced.',
  maker_flow_only: 'A busy account. That does not prove this position is trading inventory.',
  quotes_not_checked: 'The resting orders could not be read on every venue.',
  positions_not_complete: 'Only part of this account’s positions could be read.',
  diversified_book_no_quotes: 'A wide portfolio, without the quoting that would prove inventory.',
  signals_disagree: 'The available signals do not settle this position.',
};
export function readingHeadline(r: Pick<CheckResponse, 'verdict' | 'positions'>): string {
  if (!r.positions.nPositions) return 'Nothing open right now.';
  return HEADLINES[normalizeReason(r.verdict.reasons[0]) ?? ''] ?? VERDICT_STYLES[r.verdict.verdict].headline;
}
export function exampleDescription(r: Pick<CheckResponse, 'verdict'> & Partial<Pick<CheckResponse, 'historical'>>): string {
  return badgeQualifier(r.verdict, !!r.historical) === 'assets sit with funders'
    ? 'Matching assets sit with funding wallets. A transfer does not prove ownership.'
    : VERDICT_STYLES[r.verdict.verdict].description;
}
export function whatWouldChange(r: Pick<CheckResponse, 'verdict' | 'positions' | 'historical' | 'degraded'>): string | null {
  if (!r.positions.nPositions) return null;
  if (r.historical || r.degraded) return 'a fresh, complete reading of positions, holdings and orders.';
  if (r.verdict.verdict === 'hedged') return 'matching spot sold or moved out, a change in the short, or a loan against those holdings.';
  if (r.verdict.verdict === 'looks_like_a_bet') return 'a matching holding, opposing perpetual leg, or material two-sided quoting appearing.';
  if (r.verdict.verdict === 'book') return 'material two-sided quotes disappearing from this position’s own market.';
  return 'new evidence about matching holdings, opposing legs, liabilities or funding-wallet ownership.';
}
