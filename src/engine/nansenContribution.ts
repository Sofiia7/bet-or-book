/**
 * What Nansen added to one reading, said as facts about that reading.
 *
 * The 23 September audit scored the data integration lower than it had to
 * be for one reason: Nansen decides things here, and a visitor could not see
 * which. This lists what Nansen supplied to this particular reading -
 * positions on every dex, balances on every chain, funding links, funding
 * history, realized PnL - and says which of them the rule that answered
 * actually needed. A reading made after positions came from Hyperliquid's own
 * dexes (it carries `positionsVenues`) is never credited with the positions:
 * only what Nansen still supplies is listed.
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

/** Everything Nansen supplies besides the positions: balances on other
 * chains, funding links, funding history and realized PnL. Adds one sentence
 * each to `items` and returns the lead those parts set, or `lead` as it was
 * passed in when none of them sets one. Shared by both kinds of reading, so
 * the sentences are the same whichever kind is being described. */
function suppliedBesidesPositions(r: CheckResponse, items: string[], lead: string | null): string | null {
  const coin = r.positions.headlineCoin ?? 'the asset';
  const reason = r.verdict.reasons?.[0];

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
      // A known-tokens reading never gets here (its links are the
      // explorer's): the links and their balances are both Nansen's.
      items.push(
        `Funding links: ${plural(funders.length, 'wallet')} that funded this account ${hold} ${formatUsd(usd)} of ` +
          `${coin}, on ${chains}. A funding transfer is not ownership, so none of it is counted.` +
          (without ? ` Without these links, the same numbers would read as "${named(without)}".` : '') +
          // The dollar figure found is real either way - it is a floor, not a
          // false claim - but a funder search that did not fully run may
          // still be hiding more of the picture (spec review after A06).
          (r.linkedHedgeCoverage === 'partial' ? ' Another funding wallet could not be read in full, so this is a floor.' : ''),
      );
      const wallets = plural(funders.length, 'funding wallet');
      lead = without
        ? `${wallets} ${hold} ${formatUsd(usd)} of ${coin}; without them this would read as "${named(without)}"`
        : `${wallets} ${hold} ${formatUsd(usd)} of ${coin}, ownership unconfirmed`;
    } else if (r.linkedHedgeCoverage === 'missing' || r.linkedHedgeCoverage === 'partial') {
      items.push(`Funding links: could not be read in full, so whether the funding wallets hold ${coin} is not known.`);
    } else if (r.linkedHedgeCoverage === 'complete') {
      items.push(`Funding links: read; the wallets that funded this account hold no ${coin}.`);
    }
  }

  // Funding history, for the long a hedge search never reaches.
  const funded = (r.vitals ?? []).find((v) => v.label === 'Earliest funding found' && v.source === 'Nansen');
  if (funded) items.push(`${funded.label}: ${funded.value}. Context; no verdict turns on it.`);

  // Only the old tile: a saved reading's `Realized PnL` row is Nansen's. A
  // new reading's PnL tile is Hyperliquid's (source 'Hyperliquid', no
  // `Realized PnL` label), so it is never listed here as something Nansen
  // supplied.
  const pnl = (r.evidence ?? []).find((e) => e.label.startsWith('Realized PnL') && e.source === 'Nansen');
  if (pnl) items.push(`${pnl.label}: ${pnl.value}. Context; no verdict turns on it.`);

  return lead;
}

/** The lead when none of Nansen's parts set one. */
const FALLBACK_LEAD = 'context from other chains and funding history';

/** A reading whose positions were read from every Hyperliquid dex by
 * Hyperliquid itself (it carries `positionsVenues`). Nansen did not supply
 * the positions, so nothing here credits it with them: when `source` is not
 * 'nansen' it supplied nothing at all, and otherwise only the parts that
 * `suppliedBesidesPositions` lists. */
function contributionToAllDexReading(r: CheckResponse, calls: number): NansenContribution | null {
  if (r.source !== 'nansen') {
    const why = (r.coverage ?? []).find((c) => c.startsWith('Nansen'));
    return {
      lead: 'not used for this reading',
      items: [
        // Some of the notes are whole sentences that already end in a period.
        ...(why ? [why.endsWith('.') ? why : `${why}.`] : []),
        'Positions are read from Hyperliquid dex by dex, which needs no Nansen. Balances on other chains and ' +
          'links between wallets were not read, so a hedge held off Hyperliquid is not visible.',
      ],
      calls,
    };
  }

  const items: string[] = [];
  const lead = suppliedBesidesPositions(r, items, null);
  if (items.length === 0) return null;
  return { lead: lead ?? FALLBACK_LEAD, items, calls };
}

/** A reading made after the funding links moved to the block explorer:
 * Nansen supplied nothing to it. A `known-tokens` reading is always one (its
 * other-chain balances are the public nodes', its links the explorer's), and
 * so is any reading read from every dex that carries no Nansen source and no
 * note about Nansen. A "not used" sentence would be false for these: the
 * links between wallets were read, from the explorer. */
function madeWithoutNansen(r: CheckResponse): boolean {
  if (r.hedgeScope === 'known-tokens') return true;
  return (
    r.positionsVenues !== undefined &&
    r.source !== 'nansen' &&
    !(r.coverage ?? []).some((c) => c.startsWith('Nansen'))
  );
}

export function nansenContribution(r: CheckResponse): NansenContribution | null {
  const calls = r.nansenCalls ?? 0;
  if (r.positions.nPositions === 0 && calls === 0) return null;
  if (madeWithoutNansen(r)) return null;

  if (r.positionsVenues) return contributionToAllDexReading(r, calls);

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

  const n = r.positions.nPositions;
  const isBet = r.verdict.verdict === 'looks_like_a_bet';
  const items: string[] = [];
  let lead: string | null = null;

  // Positions: the one read every rule depends on.
  const hip3 = (r.positions.candidates ?? []).map((c) => c.coin).filter((c) => c.includes(':'));
  const mainDex = r.mainDexPositionCount ?? null;
  const dexComparison =
    mainDex !== null && mainDex !== n
      ? `Hyperliquid's own free endpoint shows ${plural(mainDex, 'position')} on the main dex alone.`
      : "Hyperliquid's own free endpoint reads the main dex only.";
  items.push(
    `Positions on every Hyperliquid dex, HIP-3 included: ${plural(n, 'open position')}` +
      (hip3.length ? `, among the largest ${hip3.slice(0, 2).join(' and ')}` : '') +
      `. ${dexComparison}` +
      (isBet ? ' The bet rule needs every position read, so it could only be applied with these.' : ''),
  );
  if (isBet) lead = `every dex read, ${plural(n, 'position')} in all, which the bet rule needs`;

  // Everything else Nansen supplied: other-chain balances, funding links,
  // funding history and realized PnL.
  lead = suppliedBesidesPositions(r, items, lead);

  return {
    lead: lead ?? `positions on every dex, ${plural(n, 'open position')}`,
    items,
    calls,
  };
}
