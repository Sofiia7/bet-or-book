import type { Position, RestingOrder, SpotHolding, Trade, PnlSummary, ServiceStatus } from '../types';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
  HlFill,
} from './hyperliquid';

/**
 * An HTTP 200 is not a contract. An upstream can answer with a body of the
 * wrong shape, and reading it as if it were right is how a working fallback
 * gets skipped: `{}.asset_positions.map` threw a TypeError outside the
 * branch that handles a failed source, so the Hyperliquid fallback never
 * ran. Shape is checked here and the source is re-chosen in api/check.ts.
 */
export class UpstreamShapeError extends Error {
  constructor(what: string) {
    super(`upstream answer has an unexpected shape: ${what}`);
    this.name = 'UpstreamShapeError';
  }
}

function arrayOf(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new UpstreamShapeError(`${field} is not an array`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new UpstreamShapeError(`${field} is not a name`);
  return value;
}

/** Number() reads "", null and [] as 0 and "abc" as NaN without complaining,
 * and either one would travel on into the arithmetic as a real figure. */
function finite(value: unknown, field: string): number {
  if (typeof value === 'string' && value.trim() === '') throw new UpstreamShapeError(`${field} is empty`);
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new UpstreamShapeError(`${field} is ${value === null ? 'null' : typeof value}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UpstreamShapeError(`${field} is not a finite number`);
  return n;
}

export function normalizePositions(state: HlClearinghouseState): Position[] {
  return arrayOf(state?.assetPositions, 'assetPositions').map((entry) => {
    const { position } = entry as { position: HlClearinghouseState['assetPositions'][number]['position'] };
    const szi = finite(position?.szi, 'szi');
    return {
      coin: text(position.coin, 'coin'),
      side: szi >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(finite(position.positionValue, 'positionValue')),
      entryPx: finite(position.entryPx ?? 0, 'entryPx'),
      leverage: finite(position.leverage?.value, 'leverage.value'),
      leverageType: position.leverage?.type === 'isolated' ? 'isolated' : 'cross',
      liquidationPx: position.liquidationPx === null ? null : finite(position.liquidationPx, 'liquidationPx'),
      unrealizedPnlUsd: finite(position.unrealizedPnl, 'unrealizedPnl'),
      cumFundingUsd: finite(position.cumFunding?.sinceOpen, 'cumFunding.sinceOpen'),
    };
  });
}

export function normalizeOrders(orders: HlOpenOrder[]): RestingOrder[] {
  return (arrayOf(orders, 'openOrders') as HlOpenOrder[])
    .filter((o) => !o.isTrigger && !o.reduceOnly)
    .map((o) => ({
      coin: o.coin,
      side: o.side === 'B' ? 'bid' : 'ask',
      sizeUsd: Number(o.sz) * Number(o.limitPx),
      limitPx: Number(o.limitPx),
      timestamp: o.timestamp,
    }));
}

/**
 * Quote tokens whose price is a dollar price. Hyperliquid's spot universe
 * quotes 311 pairs in USDC and another 17 in USDT0, USDH and USDE, and it
 * also lists pairs quoted in other assets entirely: a UETH/UBTC mark of 0.03
 * is about $3 000, and reading it as $0.03 is not a rounding error.
 */
const USD_QUOTE_TOKENS = new Set(['USDC', 'USDT0', 'USDH', 'USDE', 'USDT', 'USD']);

/** USDC first, because it is the deepest and the one the rest are pegged
 * against; any other dollar token will do when there is no USDC pair. */
const quoteRank = (name: string) => (name === 'USDC' ? 0 : 1);

/**
 * Maps a base TOKEN INDEX to its USD mark price.
 *
 * Keyed by index rather than by name because Hyperliquid spot names are not
 * unique - its own SDK says so - and the old name-keyed index let one token
 * be valued at a namesake's price: a balance of 10 000 units of a $1 token
 * came out as $1M of coverage (audit A01, 21.09).
 *
 * Contexts are matched to universe entries by pair NAME, not by array
 * index: a live capture on 2026-09-17 showed the context array carrying
 * 845 entries against 328 active universe entries (delisted pairs stay in
 * the context array), so the two are not the same length and must not be
 * zipped positionally.
 *
 * A token quoted against several dollar pairs takes its USDC price where
 * there is one, per `quoteRank`.
 */
export function buildSpotPriceIndex(meta: HlSpotMeta, assetCtxs: HlSpotAssetCtx[]): Map<number, number> {
  const tokenNameByIndex = new Map(meta.tokens.map((t) => [t.index, t.name]));
  const ctxByPairName = new Map(assetCtxs.map((ctx) => [ctx.coin, ctx]));
  const priceByTokenIndex = new Map<number, number>();
  const rankUsed = new Map<number, number>();

  for (const pair of meta.universe) {
    const [baseTokenIndex, quoteTokenIndex] = pair.tokens;
    const baseName = tokenNameByIndex.get(baseTokenIndex);
    const quoteName = tokenNameByIndex.get(quoteTokenIndex)?.toUpperCase();
    const ctx = ctxByPairName.get(pair.name);
    if (!baseName || !quoteName || !ctx) continue;
    if (!USD_QUOTE_TOKENS.has(quoteName)) continue;

    const markPx = Number(ctx.markPx);
    if (!Number.isFinite(markPx) || markPx <= 0) continue;

    const rank = quoteRank(quoteName);
    const used = rankUsed.get(baseTokenIndex);
    if (used === undefined || rank < used) {
      rankUsed.set(baseTokenIndex, rank);
      priceByTokenIndex.set(baseTokenIndex, markPx);
    }
  }
  return priceByTokenIndex;
}

/**
 * Names that more than one Hyperliquid spot token claims, in this check's
 * own fresh metadata.
 *
 * A ticker in this namespace is trusted by name because nobody outside
 * Hyperliquid can mint into it - but that only holds while each name is
 * still unique. A token index is a coin's real identity; the display name
 * is what this tool actually matches on, and if the exchange ever lists a
 * second token under a name already in use, name-matching alone cannot tell
 * the two apart (23.09 audit, L08 - a reproducible identity gap, not an
 * exploit observed on Hyperliquid: a live `spotMeta` in that audit's own
 * session held 503 tokens with no repeated name).
 */
export function duplicateSpotTokenNames(meta: HlSpotMeta): Set<string> {
  const counts = new Map<string, number>();
  for (const t of meta.tokens) {
    const name = t.name.toUpperCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [name, count] of counts) if (count > 1) duplicates.add(name);
  return duplicates;
}

/**
 * Hyperliquid spot balances, priced by token index.
 *
 * A balance nobody could put a price on is kept and marked `priced: false`.
 * It used to be multiplied by a zero price and then dropped for being
 * worthless, which is the one thing that is certainly not known about it.
 */
export function normalizeSpotHoldings(
  balances: HlSpotBalance[],
  priceByTokenIndex: Map<number, number>,
  ambiguousNames: Set<string> = new Set(),
): SpotHolding[] {
  return (arrayOf(balances, 'spot balances') as HlSpotBalance[])
    .filter((b) => b.coin !== 'USDC')
    .map((b) => {
      const amount = Number(b.total);
      const price = b.token === undefined ? undefined : priceByTokenIndex.get(b.token);
      const priced = price !== undefined && Number.isFinite(amount);
      return {
        coin: b.coin,
        valueUsd: priced ? amount * price! : 0,
        priced,
        amount: Number.isFinite(amount) ? amount : 0,
        source: 'hyperliquid-spot' as const,
        tokenIndex: b.token,
        identityAmbiguous: ambiguousNames.has(b.coin.toUpperCase()),
      };
    })
    // An empty balance is dropped whether or not it had a price; an unpriced
    // one that holds something is kept, because its size is unknown rather
    // than zero.
    .filter((h) => h.amount > 0 && (!h.priced || h.valueUsd > 0));
}

export function normalizeTrades(fills: HlFill[]): Trade[] {
  return fills.map((f) => ({
    coin: f.coin,
    timestamp: f.time,
    crossed: f.crossed,
    side: f.side === 'B' ? 'buy' : 'sell',
    closedPnlUsd: Number(f.closedPnl),
    sizeUsd: Number(f.px) * Number(f.sz),
    dir: f.dir,
  }));
}

const SHARED_SERVICE_LABEL =
  /binance|coinbase|okx|bybit|kraken|bitfinex|kucoin|gate\.io|htx|huobi|mexc|bitget|crypto\.com|exchange|hot wallet|deposit|bridge|cex/i;

/**
 * Addresses confirmed to be shared services by a public block explorer, for
 * the case the source answers with no label at all - which is most of the time.
 * This list is a backstop for addresses seen funding several accounts, not
 * the mechanism: an address missing from it is `unverified`, never proven
 * private. Sources are public explorer labels, recorded with each entry.
 */
const KNOWN_SERVICE_ADDRESSES: Record<string, string> = {
  // Etherscan: "Binance 15". First Funder of 0x28bbaaa5… and 0x8cc94dc8…,
  // whose ~$55.8M of ETH the 18.09 gallery read as those accounts' hedge.
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance 15',
  // Etherscan: "Gate Deposit". First Funder of 0xdf954bbe… and 0xe187055f….
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate Deposit',
};

/** The explorer's name for a confirmed shared service, or null. */
export function knownServiceName(address: string): string | null {
  return KNOWN_SERVICE_ADDRESSES[address.toLowerCase()] ?? null;
}

export function serviceStatusOf(address: string, label: string | null | undefined): ServiceStatus {
  if (knownServiceName(address)) return 'service';
  if (label === null || label === undefined || label.trim() === '') return 'unverified';
  return SHARED_SERVICE_LABEL.test(label) ? 'service' : 'not-service';
}

/** The 30-day PnL from Hyperliquid's `portfolio`: the change in the
 * cumulative perp PnL over `perpMonth`, last point minus first, which counts
 * unrealized PnL as well as closed trades. Anything but a list with a
 * `perpMonth` entry whose `pnlHistory` has at least two `[timestamp, "number"]`
 * points is a missing PnL (UpstreamShapeError), never a PnL of zero. */
export function normalizePortfolioPnl(raw: unknown, windowDays: 30): PnlSummary {
  const month = arrayOf(raw, 'portfolio').find((entry) => Array.isArray(entry) && entry[0] === 'perpMonth') as
    | [string, { pnlHistory?: unknown } | null]
    | undefined;
  if (month === undefined) throw new UpstreamShapeError('portfolio has no perpMonth');
  const points = arrayOf(month[1]?.pnlHistory, 'perpMonth pnlHistory');
  if (points.length < 2) throw new UpstreamShapeError('perpMonth pnlHistory has fewer than two points');
  const values = points.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) throw new UpstreamShapeError('perpMonth pnlHistory point is not a pair');
    const [at, value] = point as [unknown, unknown];
    if (typeof at !== 'number' || !Number.isFinite(at)) throw new UpstreamShapeError('perpMonth pnlHistory timestamp is not a number');
    if (typeof value !== 'string') throw new UpstreamShapeError('perpMonth pnlHistory value is not a string');
    return finite(value, 'perpMonth pnlHistory value');
  });
  const pnlUsd = values[values.length - 1] - values[0];
  if (!Number.isFinite(pnlUsd)) throw new UpstreamShapeError('perpMonth pnlHistory change is not a finite number');
  return { basis: 'realized-and-unrealized', pnlUsd, windowDays };
}
