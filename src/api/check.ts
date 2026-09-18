import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getUserFillsByTime,
} from '../sources/hyperliquid';
import {
  normalizePositions,
  normalizeOrders,
  normalizeTrades,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
} from '../sources/normalize';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeSizeVsOi,
  computeTradeFeatures,
  type PositionFeatures,
  type OrderFeatures,
  type HedgeFeatures,
  type TradeFeatures,
} from '../engine/features';
import { computeVerdict, type VerdictResult } from '../engine/verdict';

const TRADES_WINDOW_HOURS = 24;

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  trades: TradeFeatures;
  sizeVsOi: number | null;
  source: 'hyperliquid';
  checkedAt: string;
}

export async function checkAddress(address: string): Promise<CheckResult> {
  const now = Date.now();
  const [clearinghouse, rawOrders, spotBalances, spotMetaPair, perpMetaPair, rawFills] = await Promise.all([
    getClearinghouseState(address),
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getPerpMetaAndAssetCtxs(),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3600 * 1000, now),
  ]);

  const positionFeatures = computePositionFeatures(normalizePositions(clearinghouse));

  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));

  const [spotMeta, spotAssetCtxs] = spotMetaPair;
  const priceIndex = buildSpotPriceIndex(spotMeta, spotAssetCtxs);
  const spotHoldings = normalizeSpotHoldings(spotBalances.balances, priceIndex);
  const hedgeFeatures = computeHedgeFeatures(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    spotHoldings,
  );

  const tradeFeatures = computeTradeFeatures(normalizeTrades(rawFills), TRADES_WINDOW_HOURS);

  const [perpMeta, perpAssetCtxs] = perpMetaPair;
  const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
  const openInterestUsd =
    headlineIndex >= 0 ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx) : 0;

  const verdict = computeVerdict({
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: { tradesPerDay: tradeFeatures.tradesPerDay, crossedShare: tradeFeatures.crossedShare },
  });

  return {
    address,
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: tradeFeatures,
    sizeVsOi: computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd),
    source: 'hyperliquid',
    checkedAt: new Date().toISOString(),
  };
}
