import type { CheckResponse } from '../src/api/check';

export function featuredQuestion(reading: CheckResponse) {
  return reading.focus ?? (reading.positions.headlineCoin && reading.positions.headlineSide
    ? { coin: reading.positions.headlineCoin, side: reading.positions.headlineSide } : null);
}
/** A note saying the new reading left something out that the example may
 * show: a funding-link chain unread or cut short, or the 30-day PnL skipped.
 * On a long these are context notes, not failures, so `degraded` does not
 * catch them. */
const THINNER = /^(Funding links on |PnL was not read)/;
function isThinner(r: CheckResponse): boolean {
  const texts = [...(r.coverage ?? []), ...(r.coverageNotes ?? []).map((n) => n.text)];
  return texts.some((t) => THINNER.test(t));
}

/** A refreshed example must still answer the question its previous link taught,
 * and must not be a thinner reading than the one it replaces. */
export function usableFeaturedRefresh(previous: CheckResponse, next: CheckResponse): boolean {
  const question = featuredQuestion(previous);
  // A full reading: every dex answered, nothing failed (`degraded`: on a
  // short whose funder search runs, an unread funding-link chain is a
  // failure), and no read was left out even where it is only context (on a
  // long, an unread funding-link chain or a skipped PnL is a non-failure
  // note, so it is checked by its text). It used to require `source`
  // 'nansen' as well; a check makes no Nansen call now (stage 3).
  return !!question && next.address === previous.address
    && next.positionsCoverage === 'complete'
    && !next.degraded
    && !isThinner(next)
    && !next.verdict.reasons.includes('positions_stale')
    && next.positions.headlineCoin === question.coin && next.positions.headlineSide === question.side
    && Date.parse(next.checkedAt) > Date.parse(previous.checkedAt);
}
