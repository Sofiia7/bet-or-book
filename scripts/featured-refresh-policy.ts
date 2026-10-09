import type { CheckResponse } from '../src/api/check';

export function featuredQuestion(reading: CheckResponse) {
  return reading.focus ?? (reading.positions.headlineCoin && reading.positions.headlineSide
    ? { coin: reading.positions.headlineCoin, side: reading.positions.headlineSide } : null);
}
/** A refreshed example must still answer the question its previous link taught. */
export function usableFeaturedRefresh(previous: CheckResponse, next: CheckResponse): boolean {
  const question = featuredQuestion(previous);
  return !!question && next.address === previous.address && next.source === 'nansen'
    && !next.degraded && next.positionsCoverage === 'complete'
    && !next.verdict.reasons.includes('positions_stale')
    && next.positions.headlineCoin === question.coin && next.positions.headlineSide === question.side
    && Date.parse(next.checkedAt) > Date.parse(previous.checkedAt);
}
