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
import type { SourceCoverage, VerdictInput } from './verdict';
import { DEFAULT_THRESHOLDS } from './verdict';
import type {
  HedgeCoverage,
  HedgeFeatures,
  HedgeScope,
  LinkedHedgeFeatures,
  OrderFeatures,
  PositionFeatures,
  TradeFeatures,
} from './features';
import type { VitalsItem } from './vitals';
import type { PnlSummary } from '../types';

/**
 * What one check saw, before any rule has read it: every number the rules
 * take, how completely each source answered, and what could not be read.
 *
 * The first shape of this project read the sources, decided the verdict and
 * wrote the card in one long function, so what was seen and what was
 * concluded from it could not be told apart in code. The 23.09 audit asked
 * for the three to be separate: an observation (src/api/observe.ts, all the
 * I/O), the rules over it, and the words and picture made from both
 * (src/engine/interpret.ts, no I/O). A saved reading is an observation plus
 * one interpretation of it, which is what lets a rules change re-read a
 * stored observation without pretending to have checked the account again.
 */
export interface Observation {
  address: string;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  hedgeScope: HedgeScope;
  /** How completely the hedge was looked for, so that a gap in the reading
   * is never served as a finding about the account. */
  hedgeCoverage: HedgeCoverage;
  /** How completely the resting orders were read. `partial` when a HIP-3
   * dex would not answer: the account may be quoting where nobody looked. */
  ordersCoverage: SourceCoverage;
  /** How completely the positions were read. Hyperliquid's own clearinghouse
   * answers for the main perp dex, so a fallback reading is `partial`. */
  positionsCoverage: SourceCoverage;
  linkedHedge: LinkedHedgeFeatures | null;
  trades: TradeFeatures;
  pnl: PnlSummary | null;
  sizeVsOi: number | null;
  source: 'nansen' | 'hyperliquid';
  /** How many open positions Hyperliquid's own free main-dex endpoint shows
   * for this account, read only when `source` is `'nansen'` (when it is not,
   * this number would just restate `positions.nPositions`). Null when that
   * source failed or was not asked, or when Nansen itself was the fallback.
   * Presentational only - no rule reads it - so it needs no schema-version
   * bump. Lets the Nansen-contribution line show the exact HIP-3 gap the
   * README already claims ("134 against 86 on Hyperliquid's own main-dex
   * endpoint") on every reading, not only in prose (24.09 audit, L05). */
  mainDexPositionCount: number | null;
  /** The position this answer is about, when the reader chose one. Null
   * means the largest, which is what the check picks on its own. Part of
   * the reading, so it travels into the saved snapshot with it. */
  focus: { coin: string; side: 'long' | 'short' } | null;
  /** When the source says the positions were measured, which is not the same
   * as when this check asked for them. Null when the source gives no time. */
  positionsAsOf: string | null;
  /** The shape of the observation itself, as opposed to the reading of it.
   * A stored entry from an older schema is missing inputs the current rules
   * need, and re-running those rules over it would be a claim, not a check. */
  observationSchemaVersion: number;
  /** The contract allowlist that decided which holdings counted. */
  assetRegistryVersion: number;
  /** When the sources say the numbers were measured. A re-explain never
   * moves it. */
  observedAt: string;
  /** True when a source that feeds a rule was missing or cut short, so the
   * answer is worth less and should not be cached for as long. */
  degraded: boolean;
  /** Numbers about the headline position itself - leverage, distance to
   * liquidation, unrealized PnL, funding since open, size vs open interest -
   * rather than about the verdict. Both sources already return the first
   * four on every position; nothing here costs an extra credit. */
  vitals: VitalsItem[];
  /** Plain-language notes on anything that could not be read. */
  coverage: string[];
  /** The same notes, each saying whether it cost the answer something. A
   * shared card has room for two or three of these and has to choose the
   * ones that matter, which a flat list of sentences cannot support. */
  coverageNotes: Array<{ text: string; failure: boolean }>;
  checkedAt: string;
}

/**
 * The rules' input, built from an observation in exactly one place.
 *
 * The live check, the gallery re-explain, the "without these funding links"
 * counterfactual and the tests that hold the gallery to the rules each used
 * to assemble this by hand - four copies of one mapping, any of which could
 * have been fixed without the others.
 */
export function verdictInputOf(
  o: Pick<
    Observation,
    'positions' | 'orders' | 'hedge' | 'trades' | 'linkedHedge' | 'hedgeCoverage' | 'ordersCoverage' | 'positionsCoverage'
  >,
): VerdictInput {
  return {
    positions: o.positions,
    orders: o.orders,
    hedge: o.hedge,
    trades: { tradesPerDay: o.trades.tradesPerDay, crossedShare: o.trades.crossedShare, buyShare: o.trades.buyShare },
    linkedHedge: o.linkedHedge ? { linkedHedgeRatio: o.linkedHedge.linkedHedgeRatio } : undefined,
    hedgeCoverage: o.hedgeCoverage,
    ordersCoverage: o.ordersCoverage,
    positionsCoverage: o.positionsCoverage,
  };
}

/**
 * The shape of a stored observation.
 *
 * 1: the 18.09 scan. Aggregates only.
 * 2: adds hedgeCoverage, positionsAsOf and a classifier version.
 * 3: adds order notional, the per-source hedge split, what the asset
 *    registry could not identify, and how completely each source was read.
 * 4: adds whether the headline market itself was quoted on both sides, and
 *    how much of that was genuinely matched (23.09 audit, L01). A book
 *    verdict now needs this; an entry that never recorded it cannot be told
 *    apart from one that would have failed the check, and defaulting it to
 *    "not quoted" is a guess dressed as a re-read.
 * 5: every row checked before use, and loans Hyperliquid reports under
 *    portfolio margin listed among the notes (24.09). No field was added -
 *    what changed is what the notes cover: in an earlier entry, no loan
 *    listed means none was looked for, not none found.
 */
export const OBSERVATION_SCHEMA_VERSION = 5;

/** The first observation that looked for loans on Hyperliquid. */
export const LOANS_READ_FROM_SCHEMA = 5;

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

  // A book also needs the headline market itself quoted both sides - the
  // same floor as above, because below it the account-wide signal could
  // never have fired the rule regardless of the headline market. Without
  // this field, re-judging cannot tell "the headline market was quiet" from
  // "this was never recorded", and defaulting to the first is a guess.
  if (
    !isNumber(e.orders.headlineTwoSidedNotionalUsd) &&
    e.orders.restingOrders >= DEFAULT_THRESHOLDS.book.minRestingOrders
  ) {
    missing.push('orders.headlineTwoSidedNotionalUsd');
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
