/**
 * What Nansen added to one reading, said as facts about that reading.
 *
 * The 23 September audit scored the data integration lower than it had to
 * be for one reason: Nansen decides things here, and a visitor could not see
 * which. This lists what Nansen supplied to this particular reading -
 * positions on every dex, balances on every chain, funding links, funding
 * history, realized PnL - and says which of them the rule that answered
 * actually needed.
 *
 * It never claims that Nansen "found" a different situation. The audit was
 * specific: a bet refused for want of a complete position read is a gap
 * closed, not a discovery. Where the funding links are what stops a
 * verdict, the same rules are run over the same numbers without them, and
 * the sentence says what those numbers would have read as - the one
 * counterfactual this reading can compute honestly, because the links are
 * the only input that comes from Nansen alone.
 */
import type { CheckResponse } from '../api/check';
import { CLASSIFIER_VERSION, computeVerdict, type VerdictResult } from './verdict';
import { verdictInputOf } from './observation';
import { formatUsd } from './evidence';

export interface NansenContribution {
  /** The one Nansen finding this answer leaned on most, short enough to sit
   * on the line a reader sees without opening anything. */
  lead: string;
  /** Everything Nansen supplied to this reading, one sentence each. */
  items: string[];
  calls: number;
}

const LABEL: Record<string, string> = {
  book: 'Book',
  hedged: 'Hedged',
  looks_like_a_bet: 'Looks like a bet',
  unknown: 'Unknown',
};

const named = (v: VerdictResult) => `${LABEL[v.verdict] ?? v.verdict}${v.strength ? ` (${v.strength})` : ''}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The verdict these same numbers would get with the funding links taken
 * out, or null when that cannot be said honestly: the rules have changed
 * since the reading, or re-running them with the links does not give back
 * the verdict the reading carries. */
function withoutFundingLinks(r: CheckResponse): VerdictResult | null {
  if (r.historical || r.classifierVersion !== CLASSIFIER_VERSION || !r.linkedHedge || !r.trades) return null;
  const input = verdictInputOf(r);
  const withLinks = computeVerdict(input);
  if (withLinks.verdict !== r.verdict.verdict || withLinks.reasons[0] !== r.verdict.reasons[0]) return null;
  const without = computeVerdict({ ...input, linkedHedge: undefined });
  return without.verdict === withLinks.verdict && without.strength === withLinks.strength ? null : without;
}

export function nansenContribution(r: CheckResponse): NansenContribution | null {
  const calls = r.nansenCalls ?? 0;
  if (r.positions.nPositions === 0 && calls === 0) return null;

  if (r.source !== 'nansen') {
    const why = (r.coverage ?? []).find((c) => c.startsWith('Nansen'));
    return {
      lead: 'not used for this reading',
      items: [
        ...(why ? [`${why}.`] : []),
        "Positions come from Hyperliquid's own endpoint, which reads the main dex only, so a rule that needs " +
          'every position read does not answer here.',
      ],
      calls,
    };
  }

  const coin = r.positions.headlineCoin ?? 'the asset';
  const n = r.positions.nPositions;
  const reason = r.verdict.reasons?.[0];
  const isBet = r.verdict.verdict === 'looks_like_a_bet';
  const items: string[] = [];
  let lead: string | null = null;

  // Positions: the one read every rule depends on.
  const hip3 = (r.positions.candidates ?? []).map((c) => c.coin).filter((c) => c.includes(':'));
  items.push(
    `Positions on every Hyperliquid dex, HIP-3 included: ${plural(n, 'open position')}` +
      (hip3.length ? `, among the largest ${hip3.slice(0, 2).join(' and ')}` : '') +
      ". Hyperliquid's own free endpoint reads the main dex only." +
      (isBet ? ' The bet rule needs every position read, so it could only be applied with these.' : ''),
  );
  if (isBet) lead = `every dex read, ${plural(n, 'position')} in all, which the bet rule needs`;

  // Balances on every chain: what lets a short's cover be called complete.
  if (r.hedgeScope === 'all-chains') {
    const onchain = r.hedge.hedgeUsdBySource?.onchain ?? 0;
    const material = 0.01 * r.positions.headlineNotionalUsd;
    // "On-chain", because a short's cover can also be spot on Hyperliquid
    // itself, which is a different read and says a different thing.
    const found =
      onchain >= material
        ? `${formatUsd(onchain)} of ${coin} on-chain at this address, counted toward the cover`
        : onchain >= 1
          ? `next to no ${coin} on-chain at this address (${formatUsd(onchain)})`
          : `no ${coin} on-chain at this address`;
    if (r.hedgeCoverage === 'complete') {
      items.push(
        `Balances on every chain Nansen covers: ${found}. A short is only judged on its cover once the ` +
          "account's holdings are read in full, and this is the read that completes them.",
      );
      if (r.verdict.verdict === 'hedged' && reason === 'hedge_leg') {
        lead =
          onchain >= material
            ? `${formatUsd(onchain)} of the ${coin} cover found on other chains`
            : `every other chain checked, so the Hyperliquid ${coin} is the whole cover`;
      }
    } else if (r.hedgeCoverage === 'partial') {
      items.push(`Balances on other chains: ${found}, from the first page only, so the cover is a floor.`);
    } else if (r.hedgeCoverage === 'missing') {
      items.push('Balances on other chains: Nansen did not answer, so whether the short is covered is not known.');
    }
  }

  // Funding links: Nansen alone can supply them, and they can stop a verdict.
  if (r.linkedHedge) {
    const funders = r.linkedHedge.funders ?? [];
    const usd = r.linkedHedge.linkedHedgeUsd;
    if (usd > 0 && funders.length > 0) {
      const chains = [...new Set(funders.map((f) => f.chain))].join(' and ');
      const without = withoutFundingLinks(r);
      const hold = funders.length === 1 ? 'holds' : 'hold';
      items.push(
        `Funding links: ${plural(funders.length, 'wallet')} that funded this account ${hold} ${formatUsd(usd)} of ` +
          `${coin}, on ${chains}. A funding transfer is not ownership, so none of it is counted.` +
          (without ? ` Without these links, the same numbers would read as "${named(without)}".` : ''),
      );
      lead = without
        ? `${plural(funders.length, 'funding wallet')} ${hold} ${formatUsd(usd)} of ${coin}; without them this would read as "${named(without)}"`
        : `${plural(funders.length, 'funding wallet')} ${hold} ${formatUsd(usd)} of ${coin}, ownership unconfirmed`;
    } else {
      items.push(`Funding links: read; the wallets that funded this account hold no ${coin}.`);
    }
  }

  // Funding history, for the long a hedge search never reaches.
  const funded = (r.vitals ?? []).find((v) => v.label === 'Earliest funding found' && v.source === 'Nansen');
  if (funded) items.push(`${funded.label}: ${funded.value}. Context; no verdict turns on it.`);

  const pnl = (r.evidence ?? []).find((e) => e.label.startsWith('Realized PnL') && e.source === 'Nansen');
  if (pnl) items.push(`${pnl.label}: ${pnl.value}. Context; no verdict turns on it.`);

  return {
    lead: lead ?? `positions on every dex, ${plural(n, 'open position')}`,
    items,
    calls,
  };
}
