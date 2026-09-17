import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
} from '../sources/hyperliquid';
import { normalizePositions, normalizeOrders, buildSpotPriceIndex, normalizeSpotHoldings } from '../sources/normalize';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeSizeVsOi,
  type PositionFeatures,
  type OrderFeatures,
  type HedgeFeatures,
} from '../engine/features';
import { computeVerdict, type VerdictResult } from '../engine/verdict';

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  sizeVsOi: number | null;
  source: 'hyperliquid';
  checkedAt: string;
}

export async function checkAddress(address: string): Promise<CheckResult> {
  const [clearinghouse, rawOrders, spotBalances, spotMetaPair, perpMetaPair] = await Promise.all([
    getClearinghouseState(address),
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getPerpMetaAndAssetCtxs(),
  ]);

  const positionFeatures = computePositionFeatures(normalizePositions(clearinghouse));

  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));

  const [spotMeta, spotAssetCtxs] = spotMetaPair;
  const priceIndex = buildSpotPriceIndex(spotMeta, spotAssetCtxs);
  const spotHoldings = normalizeSpotHoldings(spotBalances.balances, priceIndex);
  const hedgeFeatures = computeHedgeFeatures(
    positionFeatures.headlineCoin,
    positionFeatures.headlineNotionalUsd,
    spotHoldings,
  );

  const [perpMeta, perpAssetCtxs] = perpMetaPair;
  const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
  const openInterestUsd =
    headlineIndex >= 0 ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx) : 0;

  const verdict = computeVerdict({ positions: positionFeatures, orders: orderFeatures, hedge: hedgeFeatures });

  return {
    address,
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    sizeVsOi: computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd),
    source: 'hyperliquid',
    checkedAt: new Date().toISOString(),
  };
}
