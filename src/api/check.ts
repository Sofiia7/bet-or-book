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
  type HedgeCoverage,
  type LinkedHedgeFeatures,
  type TradeFeatures,
} from '../engine/features';
import { computeVerdict, hedgeCanChangeVerdict, DEFAULT_THRESHOLDS, type VerdictResult } from '../engine/verdict';
import { explain, formatUsd, type EvidenceItem } from '../engine/evidence';
import type { Position, SpotHolding, LinkedWallet, PnlSummary } from '../types';

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;
/** Share of the headline position below which a caveat is not worth the
 * reader's attention. */
const MATERIAL_SHARE = 0.01;

export interface CheckOptions {
  /** null runs Hyperliquid-only: no key, credit cap reached, or a test. */
  nansen: NansenClient | null;
  /** Why `nansen` is null, in words for the card. */
  nansenOffReason?: string;
  now?: () => number;
}

export interface CheckResult {
  address: string;
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  hedgeScope: HedgeScope;
  /** How completely the hedge was looked for, so that a gap in the reading
   * is never served as a finding about the account. */
  hedgeCoverage: HedgeCoverage;
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

/** What /api/check and the gallery serve: the result plus how many Nansen
 * calls producing it took, counted by the caller's recorder. */
export type CheckResponse = CheckResult & { nansenCalls: number };

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
    const why = opts.nansenOffReason ? ` (${opts.nansenOffReason})` : '';
    coverage.push(`Nansen not used${why}: main-dex positions only, no other chains, no linked wallets`);
  }
  if (positions === null) positions = normalizePositions(await getClearinghouseState(address));

  const positionFeatures = computePositionFeatures(positions);
  const orderFeatures = computeOrderFeatures(normalizeOrders(rawOrders));
  const tradeFeatures = computeTradeFeatures(normalizeTrades(rawFills), TRADES_WINDOW_HOURS, positionFeatures.headlineCoin);
  const tradeSignal = {
    tradesPerDay: tradeFeatures.tradesPerDay,
    crossedShare: tradeFeatures.crossedShare,
    buyShare: tradeFeatures.buyShare,
  };
  const hedgeMatters = hedgeCanChangeVerdict({ positions: positionFeatures, orders: orderFeatures, trades: tradeSignal });

  let ownChain: SpotHolding[] = [];
  let otherChainsRead = false;
  // Only a short can be offset by spot, so for anything else there is no
  // hedge to look for. For a short, Hyperliquid balances alone are a partial
  // answer until Nansen fills in the other chains.
  let hedgeCoverage: HedgeCoverage = positionFeatures.headlineSide === 'short' ? 'partial' : 'not-applicable';
  if (nansen && hedgeMatters) {
    try {
      const bal = await nansen.currentBalance(address);
      ownChain = normalizeNansenBalances(bal.rows);
      otherChainsRead = true;
      hedgeCoverage = bal.complete ? 'complete' : 'partial';
      if (!bal.complete) coverage.push('Holdings on other chains: first 100 tokens only');
    } catch {
      hedgeCoverage = 'missing';
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
  // Two things the hedge number cannot say on its own, mentioned only when
  // they are large enough to matter: real balances carry dust, and a $57
  // footnote against a $184M position is noise, not coverage.
  const material = MATERIAL_SHARE * positionFeatures.headlineNotionalUsd;
  if (hedgeFeatures.unverifiedUsd >= material) {
    coverage.push(
      `${formatUsd(hedgeFeatures.unverifiedUsd)} of holdings named like ${positionFeatures.headlineCoin} ` +
        'were left out: their contract is not one this tool recognises',
    );
  }
  if (hedgeFeatures.lendingUsd >= material) {
    coverage.push(
      `${formatUsd(hedgeFeatures.lendingUsd)} of the matching assets is a lending-market deposit; ` +
        'anything borrowed against it does not show here',
    );
  }

  const hedgeScope: HedgeScope =
    positionFeatures.headlineSide !== 'short' ? 'none' : otherChainsRead ? 'all-chains' : 'hyperliquid';

  const linkedHedge =
    nansen && hedgeMatters && hedgeFeatures.hedgeRatio < DEFAULT_THRESHOLDS.hedged.linkedLookupBelowRatio
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
    trades: tradeSignal,
    linkedHedge: linkedHedge ? { linkedHedgeRatio: linkedHedge.linkedHedgeRatio } : undefined,
    hedgeCoverage,
  });

  const measured = {
    verdict,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    hedgeScope,
    hedgeCoverage,
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
  let linksTruncated = false;
  for (const r of related) {
    if (r.status === 'fulfilled') {
      links.push(...normalizeRelatedWallets(r.value.rows));
      if (!r.value.complete) linksTruncated = true;
    } else {
      coverage.push('Linked wallets unavailable on one chain');
    }
  }
  if (linksTruncated) coverage.push('Funding links: first 100 only, so this is not every wallet that funded the account');

  const firstFunders = links.filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase());
  const skipped = firstFunders.filter((w) => w.serviceStatus === 'service').length;
  if (skipped > 0) coverage.push(`${skipped} funding link(s) lead to an exchange or bridge and were not followed`);
  const candidates = firstFunders
    .filter((w) => w.serviceStatus !== 'service')
    .filter((w, i, all) => all.findIndex((x) => x.address === w.address) === i)
    .slice(0, MAX_FUNDERS);
  if (candidates.length === 0) return null;

  // Nansen returns address_label: null for most addresses, so "no label" is
  // the normal answer, not evidence that a wallet is private. Say so on the
  // card: an unlabelled funder may well be an exchange deposit address.
  const unverified = candidates.filter((w) => w.serviceStatus === 'unverified').length;
  if (unverified > 0) {
    coverage.push(
      unverified === 1
        ? '1 funding wallet carries no Nansen label: whether it is a private wallet or an exchange address is unverified'
        : `${unverified} funding wallets carry no Nansen label: whether they are private wallets or exchange addresses is unverified`,
    );
  }

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
