import type { CheckResponse } from '../api/check';
import { badgeQualifier, normalizeReason } from './reasons';
import { formatUsd, formatPct } from './evidence';

export const VERDICT_STYLES = {
  book: { label: 'Book', cls: 'book', headline: 'Market-making evidence in this position’s market.', accent: '#7fa2ff', description: 'Orders on both sides of the market point to trading inventory.' },
  hedged: { label: 'Spot-covered short', cls: 'hedged', headline: 'The offsetting asset is in this same account.', accent: '#4fe0b0', description: 'Matching holdings at this address cover the short.' },
  looks_like_a_bet: { label: 'Looks like a bet', cls: 'bet', headline: 'This looks like a real bet.', accent: '#f2b35c', description: 'A concentrated directional position, with no visible offset found.' },
  unknown: { label: 'Unknown', cls: 'unknown', headline: 'Not enough evidence either way.', accent: '#a3a8b6', description: 'The available evidence leaves an open question.' },
};
const HEADLINES: Record<string, string> = {
  positions_stale: 'The position data is out of date for this check.',
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
export function readingHeadline(r: Pick<CheckResponse, 'verdict' | 'positions'> & Partial<Pick<CheckResponse, 'positionsCoverage' | 'hedge' | 'hedgeCoverage' | 'linkedHedge'>>): string {
  if (r.verdict.reasons.includes('positions_stale')) return HEADLINES.positions_stale;
  if (!r.positions.nPositions) return r.positionsCoverage === 'complete'
    ? 'No open positions found in this reading.'
    : 'No positions found on the checked venues. Other venues are unverified.';
  const reason = normalizeReason(r.verdict.reasons[0]);
  if (r.positions.headlineSide === 'short' && r.positionsCoverage === 'complete' && r.hedge && Number.isFinite(r.hedge.hedgeUsd)) {
    if (reason === 'partial_offset' && r.hedgeCoverage === 'complete') {
      return `Own matching spot covers ${formatPct(r.hedge.hedgeRatio)} of this short. ${formatUsd(Math.max(0, r.positions.headlineNotionalUsd - r.hedge.hedgeUsd))} has no matching spot at this address.`;
    }
    if (reason === 'linked_exposure_unverified' && r.linkedHedge && Number.isFinite(r.linkedHedge.linkedHedgeUsd)) {
      return `${formatUsd(r.linkedHedge.linkedHedgeUsd)} of matching assets sit with funding wallets. Ownership is unverified.`;
    }
    if (reason === 'over_covered' && r.hedgeCoverage === 'complete') {
      return `Own matching spot exceeds this short by ${formatUsd(Math.max(0, r.hedge.hedgeUsd - r.positions.headlineNotionalUsd))}. The account has more spot than short exposure to this asset.`;
    }
  }
  return HEADLINES[normalizeReason(r.verdict.reasons[0]) ?? ''] ?? VERDICT_STYLES[r.verdict.verdict].headline;
}
export function caseQuestion(r: Pick<CheckResponse, 'verdict'>): string {
  if (r.verdict.reasons.includes('maker_flow_only')) return 'Does busy trading prove market-making inventory?';
  if (r.verdict.reasons.includes('linked_exposure_unverified')) return 'Do a funder’s holdings cover this account’s short?';
  return r.verdict.verdict === 'hedged' ? 'Does a large short mean an equally large bearish bet?'
    : r.verdict.verdict === 'book' ? 'Is this position backed by market-making activity?'
    : 'What evidence supports calling this a directional bet?';
}
export function evidenceTakeaway(r: Pick<CheckResponse, 'verdict' | 'positions'>): string {
  const reasons = r.verdict.reasons;
  if (reasons.includes('positions_stale') || reasons.includes('positions_not_complete')) return 'Missing or out-of-date positions leave exposure unresolved; they do not prove an offset is absent.';
  if (!r.positions.nPositions) return 'This reading describes the checked positions at its recorded time, not the wallet’s future activity.';
  if (reasons.includes('linked_exposure_unverified')) return 'A funding transfer establishes a link, not common ownership. These assets do not count as this account’s spot coverage.';
  if (reasons.includes('maker_flow_only')) return 'Maker fills show trading activity. Book needs material buy and sell quotes in this position’s own market.';
  if (reasons.includes('partial_offset')) return 'The uncovered amount is a spot comparison, not proof of total unhedged exposure across all venues.';
  if (reasons.includes('over_covered')) return 'More spot than short changes the visible asset exposure; it does not establish safety or resolve off-chain debt.';
  if (r.verdict.verdict === 'hedged') return 'The short alone overstates visible bearish exposure when matching spot sits at this address. Coverage is not a safety rating.';
  if (r.verdict.verdict === 'book') return 'Book means material two-sided quoting in this market. Its grade counts supporting signals, not a probability of intent.';
  if (r.verdict.verdict === 'looks_like_a_bet') return 'No material offset was found in the checked sources. Hidden exchange, OTC or unlinked-wallet hedges can still exist.';
  return 'The visible evidence does not settle the interpretation. The open question explains what is still missing.';
}
export function exampleDescription(r: Pick<CheckResponse, 'verdict'> & Partial<Pick<CheckResponse, 'historical'>>): string {
  if (r.verdict.reasons.includes('maker_flow_only')) return 'Busy maker-style trading alone does not prove this position is inventory.';
  if (r.verdict.reasons.includes('positions_not_complete')) return 'Some venues were not read. Matching spot alone cannot settle the exposure.';
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
