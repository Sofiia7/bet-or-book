import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getUserFillsByTime,
  dexOf,
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
import {
  computeVerdict,
  hedgeCanChangeVerdict,
  DEFAULT_THRESHOLDS,
  CLASSIFIER_VERSION,
  type VerdictResult,
} from '../engine/verdict';
import { explain, formatUsd, type EvidenceItem } from '../engine/evidence';
import type { Position, SpotHolding, LinkedWallet, PnlSummary } from '../types';

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;
/** Share of the headline position below which a caveat is not worth the
 * reader's attention. */
const MATERIAL_SHARE = 0.01;
/** How long one check may keep spending before it answers with what it has. */
const CHECK_DEADLINE_MS = 45_000;
/** How far behind the check a source's own timestamp may be before the card
 * says so. Positions move; a reading this old is history, not the present. */
const STALE_DATA_MS = 15 * 60_000;

export interface CheckOptions {
  /** null runs Hyperliquid-only: no key, credit cap reached, or a test. */
  nansen: NansenClient | null;
  /** Why `nansen` is null, in words for the card. */
  nansenOffReason?: string;
  now?: () => number;
  /** Absolute time past which no further paid stage is started. */
  deadline?: number;
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
  /** When the source says the positions were measured, which is not the same
   * as when this check asked for them. Null when the source gives no time. */
  positionsAsOf: string | null;
  /** The rules that read all of this. See CLASSIFIER_VERSION. */
  classifierVersion: string;
  /** True when a source that feeds a rule was missing or cut short, so the
   * answer is worth less and should not be cached for as long. */
  degraded: boolean;
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
export type CheckResponse = CheckResult & {
  nansenCalls: number;
  /** Where this exact reading can be opened again. See src/snapshot.ts. */
  snapshotId?: string;
};

/** Reads in stages so that every Nansen credit is spent only where its answer
 * can still change the verdict: positions and PnL always; the account's own
 * balances on other chains only when a hedge could move the answer; linked
 * wallets only when those balances leave it open. */
export async function checkAddress(address: string, opts: CheckOptions): Promise<CheckResult> {
  const now = (opts.now ?? Date.now)();
  // Four paid stages at the 20 s Nansen timeout, plus the free reads, can
  // outlast any reader's patience and hold a budget reservation the whole
  // time. Past the deadline the remaining paid stages are skipped and said
  // to be skipped, which is a partial answer rather than a slow wrong one.
  const deadline = opts.deadline ?? now + CHECK_DEADLINE_MS;
  const outOfTime = () => Date.now() > deadline;
  const day = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const coverage: string[] = [];
  const nansen = opts.nansen;

  // The free reads go first: if Hyperliquid is down, the check fails before a
  // single credit is spent.
  // These four decide things, so losing one has to fail the check rather
  // than quietly answer from less. Open interest is the exception: it
  // decorates the card and decides nothing, so it is read separately and
  // allowed to be missing.
  const [rawOrders, spotBalances, spotMetaPair, rawFills, perpMetaRes] = await Promise.all([
    getOpenOrders(address),
    getSpotBalances(address),
    getSpotMeta(),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now),
    getPerpMetaAndAssetCtxs().then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
  ]);
  if (!perpMetaRes.ok) coverage.push('Open interest unavailable, so size versus open interest is not shown');

  let source: CheckResult['source'] = 'hyperliquid';
  let positions: Position[] | null = null;
  let pnl: PnlSummary | null = null;
  let measuredAt: number | null = null;
  // Set wherever a source that feeds a rule could not be read in full.
  let degraded = false;
  /** A coverage note. `failure` marks the ones that make the answer worth
   * less, as opposed to the ones that merely describe what was found. */
  const note = (text: string, failure = false) => {
    coverage.push(text);
    if (failure) degraded = true;
  };

  if (nansen) {
    const [pos, pnlRes] = await Promise.allSettled([
      nansen.perpPositions(address),
      nansen.perpPnlSummary(address, day(PNL_WINDOW_DAYS), day(0)),
    ]);
    // A 200 with the wrong body has to end up in the same place as a failed
    // request, not in a TypeError that skips the fallback entirely.
    if (pos.status === 'fulfilled') {
      try {
        positions = normalizeNansenPositions(pos.value);
        source = 'nansen';
        measuredAt = Number.isFinite(pos.value.timestamp) && pos.value.timestamp > 0 ? pos.value.timestamp : null;
      } catch (err) {
        console.error('nansen positions', err);
        degraded = true;
        coverage.push(
          'Nansen positions came back in an unexpected shape: positions read from Hyperliquid, main dex only',
        );
      }
    } else {
      degraded = true;
      coverage.push('Nansen positions unavailable: positions read from Hyperliquid, main dex only');
    }
    if (pnlRes.status === 'fulfilled') {
      try {
        pnl = normalizeNansenPnl(pnlRes.value, PNL_WINDOW_DAYS);
      } catch (err) {
        console.error('nansen pnl', err);
        coverage.push('Realized PnL came back in an unexpected shape');
      }
    } else {
      coverage.push('Realized PnL unavailable');
    }
  } else {
    const why = opts.nansenOffReason ? ` (${opts.nansenOffReason})` : '';
    coverage.push(`Nansen not used${why}: main-dex positions only, no other chains, no linked wallets`);
  }
  if (positions === null) {
    const state = await getClearinghouseState(address);
    positions = normalizePositions(state);
    measuredAt = Number.isFinite(state.time) && state.time > 0 ? state.time : null;
  }

  // A timestamp from the source is the time the numbers describe; checkedAt
  // is only when this check asked. Stamping one with the other is how an
  // hour-old reading gets served as the current state of an account.
  if (measuredAt !== null && now - measuredAt >= STALE_DATA_MS) {
    const minutes = Math.round((now - measuredAt) / 60_000);
    coverage.push(`Positions were measured ${minutes} minutes before this check, not at the moment of it`);
  }

  const positionFeatures = computePositionFeatures(positions);

  // frontendOpenOrders answers for one perp dex and spot. Nansen reports
  // positions on every HIP-3 dex as well, so without asking those by name an
  // account quoting both sides of a HIP-3 market reads as quoting nothing -
  // which is one of the conditions for calling a position a clean bet.
  const resting = normalizeOrders(rawOrders);
  const hip3Dexes = [...new Set(positions.map((p) => dexOf(p.coin)).filter((d): d is string => d !== null))];
  if (hip3Dexes.length > 0) {
    const perDex = await Promise.allSettled(hip3Dexes.map((dex) => getOpenOrders(address, dex)));
    perDex.forEach((r, i) => {
      if (r.status === 'fulfilled') resting.push(...normalizeOrders(r.value));
      else note(`Resting orders on the ${hip3Dexes[i]} dex could not be read`, true);
    });
  }
  const orderFeatures = computeOrderFeatures(resting);
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
  if (nansen && hedgeMatters && outOfTime()) {
    note('This check ran out of time before it could read holdings on other chains', true);
  } else if (nansen && hedgeMatters) {
    try {
      const bal = await nansen.currentBalance(address);
      ownChain = normalizeNansenBalances(bal.rows);
      otherChainsRead = true;
      hedgeCoverage = bal.complete ? 'complete' : 'partial';
      if (!bal.complete) note('Holdings on other chains: first 100 tokens only', true);
    } catch {
      hedgeCoverage = 'missing';
      note('Holdings on other chains unavailable', true);
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

  const funderLookupWorthIt =
    nansen !== null && hedgeMatters && hedgeFeatures.hedgeRatio < DEFAULT_THRESHOLDS.hedged.linkedLookupBelowRatio;
  let linkedHedge: LinkedHedgeFeatures | null = null;
  if (funderLookupWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at the wallets that funded the account', true);
  } else if (funderLookupWorthIt) {
    linkedHedge = await readLinkedHedge(nansen!, address, positionFeatures, note);
  }

  let openInterestUsd = 0;
  if (perpMetaRes.ok) {
    const [perpMeta, perpAssetCtxs] = perpMetaRes.v;
    const headlineIndex = perpMeta.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
    openInterestUsd =
      headlineIndex >= 0
        ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx)
        : 0;
    if (headlineIndex < 0 && positionFeatures.headlineCoin?.includes(':')) {
      coverage.push('Size versus open interest not computed for a HIP-3 dex market');
    }
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
    positionsAsOf: measuredAt === null ? null : new Date(measuredAt).toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
    degraded,
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
  note: (text: string, failure?: boolean) => void,
): Promise<LinkedHedgeFeatures | null> {
  const links: LinkedWallet[] = [];
  const related = await Promise.allSettled([
    nansen.relatedWallets(address, 'arbitrum'),
    nansen.relatedWallets(address, 'ethereum'),
  ]);
  let linksTruncated = false;
  for (const r of related) {
    if (r.status === 'fulfilled') {
      try {
        links.push(...normalizeRelatedWallets(r.value.rows));
        if (!r.value.complete) linksTruncated = true;
      } catch (err) {
        console.error('nansen related wallets', err);
        note('Linked wallets came back in an unexpected shape on one chain', true);
      }
    } else {
      note('Linked wallets unavailable on one chain', true);
    }
  }
  if (linksTruncated) note('Funding links: first 100 only, so this is not every wallet that funded the account', true);

  const firstFunders = links.filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase());
  const skipped = firstFunders.filter((w) => w.serviceStatus === 'service').length;
  if (skipped > 0) note(`${skipped} funding link(s) lead to an exchange or bridge and were not followed`);
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
    note(
      unverified === 1
        ? '1 funding wallet carries no Nansen label: whether it is a private wallet or an exchange address is unverified'
        : `${unverified} funding wallets carry no Nansen label: whether they are private wallets or exchange addresses is unverified`,
    );
  }

  const balances = await Promise.allSettled(candidates.map((w) => nansen.currentBalance(w.address)));
  const linked = candidates.flatMap((wallet, i) => {
    const b = balances[i];
    if (b.status === 'fulfilled') return [{ wallet, holdings: normalizeNansenBalances(b.value.rows) }];
    note('One linked wallet could not be read', true);
    return [];
  });
  return computeLinkedHedge(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    linked,
  );
}
