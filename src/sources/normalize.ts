import type { Position, RestingOrder, SpotHolding, Trade, LinkedWallet, PnlSummary } from '../types';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
  HlFill,
} from './hyperliquid';
import type { NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from './nansen';

export function normalizePositions(state: HlClearinghouseState): Position[] {
  return state.assetPositions.map(({ position }) => {
    const szi = Number(position.szi);
    return {
      coin: position.coin,
      side: szi >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(Number(position.positionValue)),
      entryPx: Number(position.entryPx ?? 0),
      leverage: position.leverage.value,
      liquidationPx: position.liquidationPx === null ? null : Number(position.liquidationPx),
      unrealizedPnlUsd: Number(position.unrealizedPnl),
      cumFundingUsd: Number(position.cumFunding.sinceOpen),
    };
  });
}

export function normalizeOrders(orders: HlOpenOrder[]): RestingOrder[] {
  return orders
    .filter((o) => !o.isTrigger)
    .map((o) => ({
      coin: o.coin,
      side: o.side === 'B' ? 'bid' : 'ask',
      sizeUsd: Number(o.sz) * Number(o.limitPx),
    }));
}

/**
 * Maps a base-token symbol (e.g. "UBTC") to its USD mark price.
 *
 * Contexts are matched to universe entries by pair NAME, not by array
 * index: a live capture on 2026-09-17 showed the context array carrying
 * 845 entries against 328 active universe entries (delisted pairs stay in
 * the context array), so the two are not the same length and must not be
 * zipped positionally.
 *
 * A handful of base tokens are quoted against more than one pair in the
 * same capture (HYPE, UBTC, UETH, ...) - the last pair processed wins for
 * that base token. Fine for a hedge-ratio estimate; if a specific quote
 * pair ever needs to be preferred, this is the place to add that rule.
 */
export function buildSpotPriceIndex(meta: HlSpotMeta, assetCtxs: HlSpotAssetCtx[]): Map<string, number> {
  const tokenNameByIndex = new Map(meta.tokens.map((t) => [t.index, t.name]));
  const ctxByPairName = new Map(assetCtxs.map((ctx) => [ctx.coin, ctx]));
  const priceByCoin = new Map<string, number>();
  for (const pair of meta.universe) {
    const [baseTokenIndex] = pair.tokens;
    const baseName = tokenNameByIndex.get(baseTokenIndex);
    const ctx = ctxByPairName.get(pair.name);
    if (baseName && ctx) {
      priceByCoin.set(baseName, Number(ctx.markPx));
    }
  }
  return priceByCoin;
}

export function normalizeSpotHoldings(
  balances: HlSpotBalance[],
  priceByCoin: Map<string, number>,
): SpotHolding[] {
  return balances
    .filter((b) => b.coin !== 'USDC')
    .map((b) => ({ coin: b.coin, valueUsd: Number(b.total) * (priceByCoin.get(b.coin) ?? 0) }))
    .filter((h) => h.valueUsd > 0);
}

export function normalizeTrades(fills: HlFill[]): Trade[] {
  return fills.map((f) => ({
    coin: f.coin,
    timestamp: f.time,
    crossed: f.crossed,
    side: f.side === 'B' ? 'buy' : 'sell',
    closedPnlUsd: Number(f.closedPnl),
  }));
}

export function normalizeNansenPositions(data: NansenPerpPositions): Position[] {
  return data.asset_positions.map(({ position: p }) => {
    const size = Number(p.size);
    return {
      coin: p.token_symbol,
      side: size >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(Number(p.position_value_usd)),
      entryPx: Number(p.entry_price_usd),
      leverage: p.leverage_value,
      liquidationPx: p.liquidation_price_usd === null ? null : Number(p.liquidation_price_usd),
      unrealizedPnlUsd: Number(p.unrealized_pnl_usd),
      cumFundingUsd: Number(p.cumulative_funding_since_open_usd),
    };
  });
}

export function normalizeNansenBalances(rows: NansenBalance[]): SpotHolding[] {
  return rows
    .filter((r) => r.value_usd > 0)
    .map((r) => ({ coin: r.token_symbol, valueUsd: r.value_usd, chain: r.chain }));
}

const SHARED_SERVICE_LABEL =
  /binance|coinbase|okx|bybit|kraken|bitfinex|kucoin|gate\.io|htx|huobi|mexc|bitget|crypto\.com|exchange|hot wallet|deposit|bridge|cex/i;

export function normalizeRelatedWallets(rows: NansenRelatedWallet[]): LinkedWallet[] {
  return rows.map((r) => ({
    address: r.address.toLowerCase(),
    relation: r.relation,
    chain: r.chain,
    // The label is read here only to decide whether following this link can
    // mean anything, and is dropped: Nansen's rules prohibit showing labels
    // publicly, and nothing downstream of this function ever sees one.
    isSharedService: r.address_label !== null && SHARED_SERVICE_LABEL.test(r.address_label),
  }));
}

export function normalizeNansenPnl(s: NansenPnlSummary, windowDays: number): PnlSummary {
  return {
    realizedPnlUsd: s.realized_pnl_usd,
    winRate: s.win_rate,
    closedTrades: s.closed_trade_count,
    windowDays,
  };
}
