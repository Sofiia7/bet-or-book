import type { Position, RestingOrder, SpotHolding, Trade, LinkedWallet, PnlSummary, ServiceStatus } from '../types';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
  HlFill,
} from './hyperliquid';
import type { NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from './nansen';
import { isValidAddress } from '../guard';

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
      liquidationPx: position.liquidationPx === null ? null : finite(position.liquidationPx, 'liquidationPx'),
      unrealizedPnlUsd: finite(position.unrealizedPnl, 'unrealizedPnl'),
      cumFundingUsd: finite(position.cumFunding?.sinceOpen, 'cumFunding.sinceOpen'),
    };
  });
}

export function normalizeOrders(orders: HlOpenOrder[]): RestingOrder[] {
  return (arrayOf(orders, 'openOrders') as HlOpenOrder[])
    .filter((o) => !o.isTrigger)
    .map((o) => ({
      coin: o.coin,
      side: o.side === 'B' ? 'bid' : 'ask',
      sizeUsd: Number(o.sz) * Number(o.limitPx),
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
 * Hyperliquid spot balances, priced by token index.
 *
 * A balance nobody could put a price on is kept and marked `priced: false`.
 * It used to be multiplied by a zero price and then dropped for being
 * worthless, which is the one thing that is certainly not known about it.
 */
export function normalizeSpotHoldings(
  balances: HlSpotBalance[],
  priceByTokenIndex: Map<number, number>,
): SpotHolding[] {
  return (arrayOf(balances, 'spot balances') as HlSpotBalance[])
    .filter((b) => b.coin !== 'USDC')
    .map((b) => {
      const amount = Number(b.total);
      const price = priceByTokenIndex.get(b.token);
      const priced = price !== undefined && Number.isFinite(amount);
      return {
        coin: b.coin,
        valueUsd: priced ? amount * price! : 0,
        priced,
        amount: Number.isFinite(amount) ? amount : 0,
        source: 'hyperliquid-spot' as const,
        tokenIndex: b.token,
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
  }));
}

export function normalizeNansenPositions(data: NansenPerpPositions): Position[] {
  return arrayOf(data?.asset_positions, 'asset_positions').map((entry) => {
    const { position: p } = entry as NansenPerpPositions['asset_positions'][number];
    const size = finite(p?.size, 'size');
    return {
      coin: text(p.token_symbol, 'token_symbol'),
      side: size >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(finite(p.position_value_usd, 'position_value_usd')),
      entryPx: finite(p.entry_price_usd, 'entry_price_usd'),
      leverage: finite(p.leverage_value, 'leverage_value'),
      liquidationPx: p.liquidation_price_usd === null ? null : finite(p.liquidation_price_usd, 'liquidation_price_usd'),
      unrealizedPnlUsd: finite(p.unrealized_pnl_usd, 'unrealized_pnl_usd'),
      cumFundingUsd: finite(p.cumulative_funding_since_open_usd, 'cumulative_funding_since_open_usd'),
    };
  });
}

/**
 * On-chain balances from Nansen.
 *
 * Every row is tagged `onchain` whether or not it carries a contract, so a
 * row that arrives without one is an unidentified on-chain token rather than
 * a Hyperliquid ticker. The old code inferred the namespace from whether an
 * address was present, and a malformed row calling itself WETH was accepted
 * by name alone (audit A01, 21.09).
 */
export function normalizeNansenBalances(rows: NansenBalance[]): SpotHolding[] {
  return (arrayOf(rows, 'balances') as NansenBalance[])
    .filter((r) => Number.isFinite(r?.value_usd) && r.value_usd > 0)
    .map((r) => ({
      coin: typeof r.token_symbol === 'string' ? r.token_symbol : '',
      valueUsd: r.value_usd,
      priced: true,
      source: 'onchain' as const,
      amount: Number.isFinite(r.token_amount) ? r.token_amount : undefined,
      chain: typeof r.chain === 'string' ? r.chain : undefined,
      tokenAddress: typeof r.token_address === 'string' ? r.token_address : undefined,
    }));
}

const SHARED_SERVICE_LABEL =
  /binance|coinbase|okx|bybit|kraken|bitfinex|kucoin|gate\.io|htx|huobi|mexc|bitget|crypto\.com|exchange|hot wallet|deposit|bridge|cex/i;

/**
 * Addresses confirmed to be shared services by a public block explorer, for
 * the case Nansen answers with no label at all - which is most of the time.
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

function serviceStatusOf(address: string, label: string | null | undefined): ServiceStatus {
  if (knownServiceName(address)) return 'service';
  if (label === null || label === undefined || label.trim() === '') return 'unverified';
  return SHARED_SERVICE_LABEL.test(label) ? 'service' : 'not-service';
}

export function normalizeRelatedWallets(rows: NansenRelatedWallet[]): LinkedWallet[] {
  return (arrayOf(rows, 'relatedWallets') as NansenRelatedWallet[])
    // An address from an upstream becomes a request path and a line on a
    // card. It is checked on the way in rather than trusted for having
    // arrived over TLS: anything that is not 20 bytes of hex is not an
    // address, whatever the row calls it.
    .filter((r) => typeof r?.address === 'string' && isValidAddress(r.address))
    .map((r) => ({
    address: r.address.toLowerCase(),
    relation: r.relation,
    chain: r.chain,
    // The label is read here only to decide whether following this link can
    // mean anything, and is dropped: Nansen's rules prohibit showing labels
    // publicly, and nothing downstream of this function ever sees one.
    serviceStatus: serviceStatusOf(r.address, r.address_label),
  }));
}

/** A PnL body is three numbers, and an empty object has none of them. It
 * used to pass straight through and put `$NaN` on the card. */
export function normalizeNansenPnl(s: NansenPnlSummary, windowDays: number): PnlSummary {
  return {
    realizedPnlUsd: finite(s?.realized_pnl_usd, 'realized_pnl_usd'),
    winRate: finite(s.win_rate, 'win_rate'),
    closedTrades: finite(s.closed_trade_count, 'closed_trade_count'),
    windowDays,
  };
}
