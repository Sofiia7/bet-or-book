/**
 * What an upstream answer has to look like before any of it is used.
 *
 * The normalizers already refused a position row with a non-number in it,
 * but resting orders, spot balances and fills went into the arithmetic
 * unchecked: an order size of "abc" became NaN inside a notional sum, a side
 * that was neither "B" nor "A" became a sell, and a fills answer was not even
 * checked to be a list (23.09 audit, "structure and range checks, especially
 * balances, orders, fills"). Two rules here:
 *
 * - An answer whose envelope is wrong - not a list where a list belongs - is
 *   not read at all. It throws UpstreamShapeError, the same path a failed
 *   request takes, so a source that is garbage and a source that is down end
 *   up in the same place.
 * - A row that is wrong is left out and counted, and the count lowers what
 *   the reading may claim: a source with rows left out was read in part.
 *
 * What looks wrong and is not, calibrated against the recorded answers in
 * test/fixtures and against live answers for eight accounts on 24.09: a
 * negative spot `total` is a loan under Hyperliquid portfolio margin, not a
 * broken row (seen live: -9.57M USDC with 17.97M `borrowed`); a negative
 * `hold` comes with it; a spot row with no token index is a balance nobody
 * can price, which the normalizer already keeps as unpriced. A validator
 * that refused any of those would have turned the demonstration reading of
 * a 97%-covered HYPE short into "hedge not checked".
 */
import type { HlOpenOrder, HlSpotBalance, HlFill, HlSpotMeta, HlSpotAssetCtx, HlPerpMeta, HlPerpAssetCtx } from './hyperliquid';
import type { NansenBalance, NansenRelatedWallet } from './nansen';
import { UpstreamShapeError } from './normalize';
import { isValidAddress } from '../guard';

export interface Checked<T> {
  rows: T[];
  /** Rows left out because they were not what the source promises. */
  malformed: number;
}

type Row = Record<string, unknown>;

/** A number, or a string holding one - Hyperliquid sends decimals as
 * strings. Null for anything else, including "" and NaN, which Number()
 * would quietly read as 0 and NaN. */
function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const positive = (value: unknown) => (numeric(value) ?? 0) > 0;
const nonNegativeOrAbsent = (value: unknown) => value === undefined || (numeric(value) ?? -1) >= 0;
const named = (value: unknown) => typeof value === 'string' && value.trim() !== '';
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function partition<T>(raw: unknown, what: string, ok: (row: Row) => boolean): Checked<T> {
  if (!Array.isArray(raw)) throw new UpstreamShapeError(`${what} is not a list`);
  const rows: T[] = [];
  let malformed = 0;
  for (const row of raw) {
    if (isRow(row) && ok(row)) rows.push(row as T);
    else malformed++;
  }
  return { rows, malformed };
}

/** A resting order: a market, a side, a positive price and size. A trigger
 * order rests at no price yet and never counts as quoting, so only its
 * market is asked for. */
export function checkOrders(raw: unknown): Checked<HlOpenOrder> {
  return partition(raw, 'open orders', (o) => {
    if (!named(o.coin)) return false;
    if (o.isTrigger === true) return true;
    return (o.side === 'B' || o.side === 'A') && positive(o.limitPx) && positive(o.sz);
  });
}

/** A spot balance: a named coin with a numeric total of either sign (a
 * negative one is a loan), and, where present, a token index, a numeric
 * hold, and non-negative borrowed and supplied amounts. */
export function checkSpotBalances(raw: unknown): Checked<HlSpotBalance> {
  if (!isRow(raw)) throw new UpstreamShapeError('spot state is not an object');
  return partition(raw.balances, 'spot balances', (b) => {
    if (!named(b.coin) || numeric(b.total) === null) return false;
    if (b.hold !== undefined && numeric(b.hold) === null) return false;
    if (b.token !== undefined && !(Number.isInteger(b.token) && (b.token as number) >= 0)) return false;
    if (!nonNegativeOrAbsent(b.borrowed) || !nonNegativeOrAbsent(b.supplied)) return false;
    if (b.ltv !== undefined) {
      const ltv = numeric(b.ltv);
      if (ltv === null || ltv < 0 || ltv > 1) return false;
    }
    return true;
  });
}

/** A fill: a market, a side, a positive price and size, a time, whether it
 * crossed, a direction and a realized PnL. */
export function checkFills(raw: unknown): Checked<HlFill> {
  return partition(raw, 'fills', (f) => {
    const time = numeric(f.time);
    return (
      named(f.coin) &&
      (f.side === 'B' || f.side === 'A') &&
      positive(f.px) &&
      positive(f.sz) &&
      time !== null &&
      time > 0 &&
      typeof f.crossed === 'boolean' &&
      typeof f.dir === 'string' &&
      numeric(f.closedPnl) !== null
    );
  });
}

/** Spot metadata: named tokens with an index, and pairs of two token
 * indexes. Every balance is priced from it, so a wrong envelope fails the
 * read; a wrong entry is left out, and a balance in that token reads as
 * unpriced rather than as some other token's price. */
export function checkSpotMeta(raw: unknown): { meta: [HlSpotMeta, HlSpotAssetCtx[]]; malformed: number } {
  if (!Array.isArray(raw) || !isRow(raw[0]) || !Array.isArray(raw[1])) {
    throw new UpstreamShapeError('spot metadata is not [meta, contexts]');
  }
  const tokens = partition<HlSpotMeta['tokens'][number]>(
    raw[0].tokens,
    'spot tokens',
    (t) => named(t.name) && Number.isInteger(t.index) && (t.index as number) >= 0,
  );
  const universe = partition<HlSpotMeta['universe'][number]>(
    raw[0].universe,
    'spot pairs',
    (p) =>
      named(p.name) &&
      Array.isArray(p.tokens) &&
      p.tokens.length === 2 &&
      p.tokens.every((i) => Number.isInteger(i) && (i as number) >= 0),
  );
  const contexts = partition<HlSpotAssetCtx>(raw[1], 'spot contexts', (c) => named(c.coin));
  return {
    meta: [{ ...(raw[0] as object), tokens: tokens.rows, universe: universe.rows } as HlSpotMeta, contexts.rows],
    malformed: tokens.malformed + universe.malformed + contexts.malformed,
  };
}

/** Perp metadata: a universe of named markets beside their contexts. Open
 * interest and mark prices come from it; nothing is decided by it, so the
 * caller treats a wrong one as missing. */
export function checkPerpMeta(raw: unknown): [HlPerpMeta, HlPerpAssetCtx[]] {
  if (!Array.isArray(raw) || !isRow(raw[0]) || !Array.isArray(raw[0].universe) || !Array.isArray(raw[1])) {
    throw new UpstreamShapeError('perp metadata is not [meta, contexts]');
  }
  return raw as unknown as [HlPerpMeta, HlPerpAssetCtx[]];
}

/** A Nansen balance: a chain, an amount of zero or more, and a dollar value
 * that is either absent or zero or more. An unpriced row is valid (23.09
 * audit, L05): its size is unknown, not zero. */
export function checkNansenBalances(raw: unknown): Checked<NansenBalance> {
  return partition(raw, 'balances', (r) => {
    const amount = numeric(r.token_amount);
    const value = r.value_usd === null || r.value_usd === undefined ? 0 : numeric(r.value_usd);
    return named(r.chain) && amount !== null && amount >= 0 && value !== null && value >= 0;
  });
}

/** A funding link: an address that is one, a relation, a chain, and a time
 * that parses when there is one. */
export function checkRelatedWallets(raw: unknown): Checked<NansenRelatedWallet> {
  return partition(raw, 'related wallets', (r) => {
    const when = r.block_timestamp;
    return (
      typeof r.address === 'string' &&
      isValidAddress(r.address) &&
      named(r.relation) &&
      named(r.chain) &&
      (when === undefined || when === null || (typeof when === 'string' && Number.isFinite(Date.parse(when))))
    );
  });
}
