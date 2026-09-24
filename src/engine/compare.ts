/**
 * Two readings of the same address, side by side.
 *
 * A card is a statement about a moment, and the interesting question after
 * a headline is usually "and is that still true?". Answering it needs two
 * readings and one distinction the 21.09 audit was firm about: a verdict
 * that changed because the account did something, and a verdict that
 * changed because this tool started reading it differently, look identical
 * on a card and are not the same event at all. So the comparison says which
 * it was, and says "both" rather than guessing when both moved.
 *
 * Everything here reads two stored readings. Nothing is fetched, nothing is
 * charged, and neither reading is modified: a comparison is a third thing.
 */
import type { CheckResponse } from '../api/check';
import type { VerdictStrength } from './verdict';
import { formatUsd, formatPct } from './evidence';

export interface FieldChange {
  field: string;
  from: string;
  to: string;
  direction: 'up' | 'down' | 'sideways';
}

export interface VerdictChange {
  from: string;
  to: string;
  /** A book's grade. "Book (strong)" to "Book (likely)" is the answer on
   * the badge changing, even though the verdict itself did not. */
  fromStrength: VerdictStrength;
  toStrength: VerdictStrength;
  fromRules: string;
  toRules: string;
  because:
    | 'the reading changed'
    | 'the rules changed'
    | 'both the reading and the rules changed'
    | 'the cause could not be established';
}

export interface Comparison {
  address: string;
  from: { observedAt: string; snapshotId?: string; classifierVersion: string };
  to: { observedAt: string; snapshotId?: string; classifierVersion: string };
  /** True when the two readings answer different questions - one asked
   * about a position the other did not, or the largest-position default
   * against a manual pick - rather than two readings of the same one.
   * `changes` and `verdictChange` are empty/null whenever this is true: a
   * dollar figure moving between two different positions is not news about
   * either of them (23.09 audit, L02). */
  questionChanged: boolean;
  changes: FieldChange[];
  verdictChange: VerdictChange | null;
  /** The two were read by different versions of the rules. Said on its own
   * when the answer did not move, since "the answer did not change" is
   * otherwise read as the same rules agreeing twice. */
  rulesChanged: boolean;
}

const when = (r: CheckResponse): string => r.observedAt ?? r.checkedAt;

const direction = (a: number, b: number): FieldChange['direction'] =>
  b > a ? 'up' : b < a ? 'down' : 'sideways';

/** A move too small to be worth a line. Prices drift; a card that reports
 * every basis point of drift as news is a card nobody reads twice. */
const MATERIAL = 0.02;

/** Whether two readings were asked the same thing: both left to the
 * account's largest position, or both a manual pick of the same coin and
 * side. The largest position is allowed to change who it is between two
 * readings of that same "show me the biggest" question - that is a real
 * event - but a manual ETH pick and a manual BTC pick are two different
 * questions however similar the two cards look. */
function sameQuestion(a: CheckResponse['focus'] | undefined, b: CheckResponse['focus'] | undefined): boolean {
  const af = a ?? null;
  const bf = b ?? null;
  if (af === null || bf === null) return af === bf;
  return af.coin.toUpperCase() === bf.coin.toUpperCase() && af.side === bf.side;
}

export function compareReadings(x: CheckResponse, y: CheckResponse): Comparison {
  if (x.address.toLowerCase() !== y.address.toLowerCase()) {
    throw new Error('two readings of the same address are needed to compare them');
  }
  // Whichever order they arrive in, the older one is "from".
  const [from, to] = when(x) <= when(y) ? [x, y] : [y, x];

  if (!sameQuestion(from.focus, to.focus)) {
    return {
      address: to.address,
      from: { observedAt: when(from), snapshotId: from.snapshotId, classifierVersion: from.classifierVersion },
      to: { observedAt: when(to), snapshotId: to.snapshotId, classifierVersion: to.classifierVersion },
      questionChanged: true,
      changes: [],
      verdictChange: null,
      rulesChanged: from.classifierVersion !== to.classifierVersion,
    };
  }

  const changes: FieldChange[] = [];
  const pushNumber = (field: string, a: number, b: number, format: (n: number) => string) => {
    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale === 0 || Math.abs(b - a) / scale < MATERIAL) return;
    const from = format(a);
    const to = format(b);
    // $609 to $671 of a $200M short is a 10% move and renders as "0.0% to
    // 0.0%" either way. A line the reader cannot see the difference in is
    // not news about the account; it is news about rounding.
    if (from === to) return;
    changes.push({ field, from, to, direction: direction(a, b) });
  };

  if (from.positions.headlineCoin !== to.positions.headlineCoin) {
    changes.push({
      field: 'largest position',
      from: from.positions.headlineCoin ?? 'none',
      to: to.positions.headlineCoin ?? 'none',
      direction: 'sideways',
    });
  }
  if (from.positions.headlineSide !== to.positions.headlineSide) {
    changes.push({
      field: 'side',
      from: from.positions.headlineSide ?? 'none',
      to: to.positions.headlineSide ?? 'none',
      direction: 'sideways',
    });
  }
  pushNumber('position size', from.positions.headlineNotionalUsd, to.positions.headlineNotionalUsd, formatUsd);
  pushNumber('covered by this address', from.hedge.hedgeRatio, to.hedge.hedgeRatio, formatPct);
  pushNumber(
    'two-sided quoting',
    from.orders.twoSidedNotionalUsd ?? 0,
    to.orders.twoSidedNotionalUsd ?? 0,
    formatUsd,
  );
  pushNumber(
    'held by wallets that funded it',
    from.linkedHedge?.linkedHedgeUsd ?? 0,
    to.linkedHedge?.linkedHedgeUsd ?? 0,
    formatUsd,
  );

  const rulesMoved = from.classifierVersion !== to.classifierVersion;
  // Attribution used to rest on the same five-ish fields the card shows -
  // largest position, side, size, coverage, two-sided quoting, linked hedge
  // - so a change to something computeVerdict actually reads but this card
  // does not display (source completeness, position count, bid share,
  // markets touched, fills) went unnoticed. Two readings whose rules and
  // positionsCoverage both moved came back "because the rules changed",
  // crediting a data gap to a wording fix. This compares every field
  // computeVerdict takes, before rounding or the display threshold, so
  // "something in the data moved" cannot be missed for not being on screen
  // (23.09 audit, L11).
  const verdictInputsOf = (r: CheckResponse) =>
    JSON.stringify({
      positions: r.positions,
      orders: r.orders,
      hedge: r.hedge,
      hedgeCoverage: r.hedgeCoverage,
      ordersCoverage: r.ordersCoverage,
      positionsCoverage: r.positionsCoverage,
      trades: r.trades ? { tradesPerDay: r.trades.tradesPerDay, crossedShare: r.trades.crossedShare, buyShare: r.trades.buyShare } : null,
      linkedHedgeRatio: r.linkedHedge?.linkedHedgeRatio ?? null,
    });
  const dataMoved = verdictInputsOf(from) !== verdictInputsOf(to);
  // The grade counts as the answer: a badge that went from "Book (strong)"
  // to "Book (likely)" is not a card on which nothing changed.
  const verdictChange =
    from.verdict.verdict === to.verdict.verdict && (from.verdict.strength ?? null) === (to.verdict.strength ?? null)
      ? null
      : {
          from: from.verdict.verdict,
          to: to.verdict.verdict,
          fromStrength: from.verdict.strength ?? null,
          toStrength: to.verdict.strength ?? null,
          fromRules: from.classifierVersion,
          toRules: to.classifierVersion,
          because: (rulesMoved && dataMoved
            ? 'both the reading and the rules changed'
            : rulesMoved
              ? 'the rules changed'
              : dataMoved
                ? 'the reading changed'
                // Neither the rules nor any input computeVerdict reads
                // moved, and yet the verdict differs: computeVerdict is
                // meant to be a pure function of exactly these fields, so
                // this should not happen. Guessing a cause anyway would be
                // worse than saying so.
                : 'the cause could not be established') as VerdictChange['because'],
        };

  return {
    address: to.address,
    from: { observedAt: when(from), snapshotId: from.snapshotId, classifierVersion: from.classifierVersion },
    to: { observedAt: when(to), snapshotId: to.snapshotId, classifierVersion: to.classifierVersion },
    questionChanged: false,
    changes,
    verdictChange,
    rulesChanged: rulesMoved,
  };
}
