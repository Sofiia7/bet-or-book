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
  fromRules: string;
  toRules: string;
  because: 'the reading changed' | 'the rules changed' | 'both the reading and the rules changed';
}

export interface Comparison {
  address: string;
  from: { observedAt: string; snapshotId?: string; classifierVersion: string };
  to: { observedAt: string; snapshotId?: string; classifierVersion: string };
  changes: FieldChange[];
  verdictChange: VerdictChange | null;
}

const when = (r: CheckResponse): string => r.observedAt ?? r.checkedAt;

const direction = (a: number, b: number): FieldChange['direction'] =>
  b > a ? 'up' : b < a ? 'down' : 'sideways';

/** A move too small to be worth a line. Prices drift; a card that reports
 * every basis point of drift as news is a card nobody reads twice. */
const MATERIAL = 0.02;

export function compareReadings(x: CheckResponse, y: CheckResponse): Comparison {
  if (x.address.toLowerCase() !== y.address.toLowerCase()) {
    throw new Error('two readings of the same address are needed to compare them');
  }
  // Whichever order they arrive in, the older one is "from".
  const [from, to] = when(x) <= when(y) ? [x, y] : [y, x];

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
  const readingMoved = changes.length > 0;
  const verdictChange =
    from.verdict.verdict === to.verdict.verdict
      ? null
      : {
          from: from.verdict.verdict,
          to: to.verdict.verdict,
          fromRules: from.classifierVersion,
          toRules: to.classifierVersion,
          because: (rulesMoved && readingMoved
            ? 'both the reading and the rules changed'
            : rulesMoved
              ? 'the rules changed'
              : 'the reading changed') as VerdictChange['because'],
        };

  return {
    address: to.address,
    from: { observedAt: when(from), snapshotId: from.snapshotId, classifierVersion: from.classifierVersion },
    to: { observedAt: when(to), snapshotId: to.snapshotId, classifierVersion: to.classifierVersion },
    changes,
    verdictChange,
  };
}
