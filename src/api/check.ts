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
  normalizeNansenPositions,
  normalizeNansenBalances,
  normalizeRelatedWallets,
  normalizeNansenPnl,
} from '../sources/normalize';
import type { NansenClient } from '../sources/nansen';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeLinkedHedge,
  computeSizeVsOi,
  computeTradeFeatures,
  type PositionFeatures,
  type OrderFeatures,
  type HedgeFeatures,
  type HedgeScope,
  type LinkedHedgeFeatures,
  type TradeFeatures,
} from '../engine/features';
import { computeVerdict, hedgeCanChangeVerdict, DEFAULT_THRESHOLDS, type VerdictResult } from '../engine/verdict';
import { explain, type EvidenceItem } from '../engine/evidence';
import type { Position, SpotHolding, LinkedWallet, PnlSummary } from '../types';

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;

export interface CheckOptions {
  /** null runs Hyperliquid-only: no key, credit cap reached, or a test. */
  nansen: NansenClient | null;
  now?: () => number;
}

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  hedgeScope: HedgeScope;
  linkedHedge: LinkedHedgeFeatures | null;
  trades: TradeFeatures;
  pnl: PnlSummary | null;
  sizeVsOi: number | null;
  source: 'nansen' | 'hyperliquid';
  /** One sentence built from the numbers that decided the verdict. */
  summary: string;
  /** Up to five numbers for the card, each with its source. */
  evidence: EvidenceItem[];
  /** Plain-language notes on anything that could not be read. */
  coverage: string[];
  checkedAt: string;
}

/** Reads in stages so that every Nansen credit is spent only where its answer
 * can still change the verdict: positions and PnL always; the account's own
 * balances on other chains only when a hedge could move the answer; linked
 * wallets only when those balances leave it open. */
export async function checkAddress(address: string, opts: CheckOptions): Promise<CheckResult> {
  const now = (opts.now ?? Date.now)();
  const day = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const coverage: string[] = [];
  const nansen = opts.nansen;

  // The free reads go first: if Hyperliquid is down, the check fails before a
  // single credit is spent.
  const [rawOrders, spotBalances, spotMetaPair, perpMetaPair, rawFills] = await Promise.all([
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getPerpMetaAndAssetCtxs(),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now),
  ]);

  let source: CheckResult['source'] = 'hyperliquid';
  let positions: Position[] | null = null;
  let pnl: PnlSummary | null = null;

  if (nansen) {
    const [pos, pnlRes] = await Promise.allSettled([
      nansen.perpPositions(address),
      nansen.perpPnlSummary(address, day(PNL_WINDOW_DAYS), day(0)),
    ]);
    if (pos.status === 'fulfilled') {
      positions = normalizeNansenPositions(pos.value);
      source = 'nansen';
    } else {
      coverage.push('Nansen positions unavailable: positions read from Hyperliquid, main dex only');
    }
    if (pnlRes.status === 'fulfilled') pnl = normalizeNansenPnl(pnlRes.value, PNL_WINDOW_DAYS);
    else coverage.push('Realized PnL unavailable');
  } else {
    coverage.push('Nansen not used: main-dex positions only, no other chains, no linked wallets');
  }
  if (positions === null) positions = normalizePositions(await getClearinghouseState(address));

  const positionFeatures = computePositionFeatures(positions);
  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));
  const tradeFeatures = computeTradeFeatures(normalizeTrades(rawFills), TRADES_WINDOW_HOURS);
  const hedgeMatters = hedgeCanChangeVerdict({
    positions: positionFeatures,
    orders: orderFeatures,
    trades: { tradesPerDay: tradeFeatures.tradesPerDay, crossedShare: tradeFeatures.crossedShare },
  });

  let ownChain: SpotHolding[] = [];
  let otherChainsRead = false;
  if (nansen && hedgeMatters) {
    try {
      const bal = await nansen.currentBalance(address);
      ownChain = normalizeNansenBalances(bal.rows);
      otherChainsRead = true;
      if (!bal.complete) coverage.push('Holdings on other chains: first 100 tokens only');
    } catch {
      coverage.push('Holdings on other chains unavailable');
    }
  }
  const [spotMeta, spotAssetCtxs] = spotMetaPair;
  const hlSpot = normalizeSpotHoldings(spotBalances.balances, buildSpotPriceIndex(spotMeta, spotAssetCtxs));
  const hedgeFeatures = computeHedgeFeatures(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    [...hlSpot, ...ownChain],
  );
  const hedgeScope: HedgeScope =
    positionFeatures.headlineSide !== 'short' ? 'none' : otherChainsRead ? 'all-chains' : 'hyperliquid';

  const linkedHedge =
    nansen && hedgeMatters && hedgeFeatures.hedgeRatio < DEFAULT_THRESHOLDS.hedged.minHedgeRatio
      ? await readLinkedHedge(nansen, address, positionFeatures, coverage)
      : null;

  const [perpMeta, perpAssetCtxs] = perpMetaPair;
  const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
  const openInterestUsd =
    headlineIndex >= 0
      ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx)
      : 0;
  if (headlineIndex < 0 && positionFeatures.headlineCoin?.includes(':')) {
    coverage.push('Size versus open interest not computed for a HIP-3 dex market');
  }

  const verdict = computeVerdict({
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    trades: { tradesPerDay: tradeFeatures.tradesPerDay, crossedShare: tradeFeatures.crossedShare },
    linkedHedge: linkedHedge ? { linkedHedgeRatio: linkedHedge.linkedHedgeRatio } : undefined,
  });

  const measured = {
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    hedgeScope,
    linkedHedge,
    trades: tradeFeatures,
    pnl,
    sizeVsOi: computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd),
    source,
  };
  const { summary, evidence } = explain(measured);
  return { address, ...measured, summary, evidence, coverage, checkedAt: new Date(now).toISOString() };
}

/** Two credits for the funding links, then one per funder followed: First
 * Funders only, never an exchange or bridge, at most two. Returns null when
 * no link is worth following. */
async function readLinkedHedge(
  nansen: NansenClient,
  address: string,
  positionFeatures: PositionFeatures,
  coverage: string[],
): Promise<LinkedHedgeFeatures | null> {
  const links: LinkedWallet[] = [];
  const related = await Promise.allSettled([
    nansen.relatedWallets(address, 'arbitrum'),
    nansen.relatedWallets(address, 'ethereum'),
  ]);
  for (const r of related) {
    if (r.status === 'fulfilled') links.push(...normalizeRelatedWallets(r.value));
    else coverage.push('Linked wallets unavailable on one chain');
  }

  const firstFunders = links.filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase());
  const skipped = firstFunders.filter((w) => w.isSharedService).length;
  if (skipped > 0) coverage.push(`${skipped} funding link(s) lead to an exchange or bridge and were not followed`);
  const candidates = firstFunders
    .filter((w) => !w.isSharedService)
    .filter((w, i, all) => all.findIndex((x) => x.address === w.address) === i)
    .slice(0, MAX_FUNDERS);
  if (candidates.length === 0) return null;

  const balances = await Promise.allSettled(candidates.map((w) => nansen.currentBalance(w.address)));
  const linked = candidates.flatMap((wallet, i) => {
    const b = balances[i];
    if (b.status === 'fulfilled') return [{ wallet, holdings: normalizeNansenBalances(b.value.rows) }];
    coverage.push('One linked wallet could not be read');
    return [];
  });
  return computeLinkedHedge(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    linked,
  );
}
