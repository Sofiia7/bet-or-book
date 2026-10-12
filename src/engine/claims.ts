import type { CheckResponse } from '../api/check';
import { formatUsd } from './evidence';

export const CLAIMS = {
  directional: 'This position is a directional bet',
  spot: 'Own spot holdings cover this short',
  ownership: 'Funding-wallet holdings belong to this account',
  inventory: 'This position is market-maker inventory',
} as const;
export type Claim = keyof typeof CLAIMS;
export interface ClaimResult { status: 'Evidence supports' | 'Evidence conflicts' | 'Not established'; explanation: string }
export function isClaim(value: unknown): value is Claim {
  return typeof value === 'string' && Object.hasOwn(CLAIMS, value);
}

/** Evaluates a bounded assertion against saved evidence, never infers intent. */
export function checkClaim(r: CheckResponse, claim: Claim): ClaimResult {
  const unknown = (explanation: string): ClaimResult => ({ status: 'Not established', explanation });
  if (claim === 'ownership') return unknown('A funding transfer proves a link, not common ownership. Funder assets are not counted as this account’s holdings.');
  if (r.positions.nPositions === 0) return unknown('No position was found in this reading. Its date and checked venues limit this result.');
  if (r.historical || r.degraded || r.verdict.reasons.includes('positions_stale')) return unknown('This reading has historical, incomplete or stale evidence. Open the source limits before interpreting the assertion.');
  if (claim === 'spot') {
    if (r.positions.headlineSide !== 'short') return { status: 'Evidence conflicts', explanation: 'This reading is of a long. Owning spot does not offset a long position.' };
    if (r.verdict.verdict === 'hedged') return { status: 'Evidence supports', explanation: `${formatUsd(r.hedge.hedgeUsd)} of matching holdings were found at this address. Coverage does not establish safety or include hidden liabilities.` };
    return unknown('The reading does not establish spot coverage of this short. Check amounts, source completeness and unverified assets; Unknown does not mean no hedge exists.');
  }
  if (claim === 'inventory') return r.verdict.verdict === 'book'
    ? { status: 'Evidence supports', explanation: 'Material two-sided quoting supports market-making activity in this market. It does not prove that the whole position is inventory or reveal the owner’s intent.' }
    : unknown('The checked quotes and fills do not establish inventory. Activity elsewhere or a funding link cannot prove this assertion.');
  return r.verdict.verdict === 'looks_like_a_bet'
    ? { status: 'Evidence supports', explanation: 'The visible exposure looks directional under this reading’s rules. Exchange, OTC and unlinked-wallet hedges remain invisible.' }
    : unknown('This reading does not establish an unoffset directional position. Coverage, opposing legs, quotes or missing evidence can leave the assertion unresolved.');
}
