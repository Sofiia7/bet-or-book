/**
 * What a saved reading has to carry before the current rules may be run over
 * it again.
 *
 * Re-running the classifier over a stored aggregate is a cheap and useful
 * thing to do - a rules fix should not cost the credits the scan cost. It is
 * not, however, a re-check of the account, and the 21.09 audit found the two
 * being presented as one: 269 of 277 gallery cards carried no per-token
 * evidence, no record of what the hedge sum left out and no order notional,
 * yet every one of them was stamped with the current classifier version. The
 * stamp said the modern chain of reasoning had been applied; it could not
 * have been, because the inputs it reads were never recorded.
 *
 * So an observation now carries its own schema version, and anything older
 * is checked field by field. Where the missing field could not have changed
 * the answer - an order count too small to fire any rule, a hedge read that
 * never touched an on-chain balance - it is not asked for. Where it could,
 * the entry keeps the verdict it was given, keeps the version of the rules
 * that gave it, and is marked historical rather than quietly re-judged.
 */
import type { CheckResponse } from '../api/check';
import type { SourceCoverage } from './verdict';
import { DEFAULT_THRESHOLDS } from './verdict';

/**
 * The shape of a stored observation.
 *
 * 1: the 18.09 scan. Aggregates only.
 * 2: adds hedgeCoverage, positionsAsOf and a classifier version.
 * 3: adds order notional, the per-source hedge split, what the asset
 *    registry could not identify, and how completely each source was read.
 */
export const OBSERVATION_SCHEMA_VERSION = 3;

/** The contract allowlist and alias table that read the holdings. Bumped
 * whenever a token is added, because "not recognised" is a statement about
 * this list and the list changes. */
export const ASSET_REGISTRY_VERSION = 2;

type Stored = Partial<CheckResponse> & Pick<CheckResponse, 'positions' | 'orders' | 'hedge'>;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * How completely each source was read, for an entry written before those
 * fields existed. The scan recorded its failures in plain words at the time,
 * so they are read back from there rather than assumed away.
 */
export function legacySourceCoverage(e: Stored): { orders: SourceCoverage; positions: SourceCoverage } {
  const notes = (e.coverage ?? []).join(' | ');
  return {
    orders:
      e.ordersCoverage ??
      (/Resting orders on the .* dex could not be read/.test(notes) ? 'partial' : 'complete'),
    positions:
      e.positionsCoverage ??
      (/positions read from Hyperliquid, main dex only|read from Hyperliquid alone/i.test(notes)
        ? 'partial'
        : 'complete'),
  };
}

/**
 * Field paths the current rules read that this observation does not carry
 * and that cannot be recovered from what it does. An empty list means the
 * entry may be re-judged; anything in it means the entry is history.
 */
export function missingForCurrentRules(e: Stored): string[] {
  if (e.observationSchemaVersion === OBSERVATION_SCHEMA_VERSION) return [];
  const missing: string[] = [];

  // Two-sided quoting decides a book now, and only its notional can say
  // whether the quoting was material. An order count below the rule's floor
  // could never have fired it, so nothing is lost there.
  if (
    !isNumber(e.orders.twoSidedNotionalUsd) &&
    e.orders.restingOrders >= DEFAULT_THRESHOLDS.book.minRestingOrders
  ) {
    missing.push('orders.twoSidedNotionalUsd');
  }

  // A hedge sum with no record of what it left out cannot be told apart from
  // one that left out nothing. Only an on-chain read could have left
  // anything out: Hyperliquid spot carries no contract to fail to recognise.
  const shortWithHedge = e.positions.headlineSide === 'short' && e.positions.headlineNotionalUsd > 0;
  if (shortWithHedge && e.hedgeScope === 'all-chains' && !isNumber(e.hedge.unverifiedUsd)) {
    missing.push('hedge.unverifiedUsd');
  }

  return missing;
}

/** Why an entry is being kept as history rather than re-read. */
export function historicalReason(missing: string[]): string {
  return (
    'This reading was taken before the current rules existed and does not record ' +
    `${missing.join(' or ')}, so it cannot be re-judged without checking the account again.`
  );
}
