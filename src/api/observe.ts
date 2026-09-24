/**
 * Everything a check reads, and what it saw: the first of the three stages
 * (23.09 audit, "code and architecture"). All the I/O of a check lives
 * here. Rules and words are src/engine/interpret.ts, and see nothing but the
 * Observation this returns.
 *
 * Reads in stages so that every Nansen credit is spent only where its answer
 * can still change the verdict: positions and PnL always; the account's own
 * balances on other chains only when a hedge could move the answer; linked
 * wallets only when those balances leave it open. Deciding whether a stage
 * is worth paying for needs the features read so far, which is why the
 * features are computed here, as the reads come in, rather than after them.
 */
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
  duplicateSpotTokenNames,
  normalizeNansenPositions,
  normalizeNansenBalances,
  normalizeRelatedWallets,
  normalizeNansenPnl,
} from '../sources/normalize';
import type { NansenClient } from '../sources/nansen';
import type { HlOpenOrder, HlPerpAssetCtx, HlPerpMeta, HlSpotBalance } from '../sources/hyperliquid';
import {
  checkFills,
  checkNansenBalances,
  checkOrders,
  checkPerpMeta,
  checkRelatedWallets,
  checkSpotBalances,
  checkSpotMeta,
  type Checked,
} from '../sources/validate';
import {
  computePositionFeatures,
  computeOrderFeatures,
  computeHedgeFeatures,
  computeLinkedHedge,
  computeSizeVsOi,
  computeTradeFeatures,
  type PositionFeatures,
  type HedgeScope,
  type HedgeCoverage,
  type LinkedHedgeFeatures,
} from '../engine/features';
import { hedgeCanChangeVerdict, DEFAULT_THRESHOLDS, type SourceCoverage } from '../engine/verdict';
import { spotHedgesPerp } from '../engine/assets';
import { formatUsd } from '../engine/evidence';
import { computeVitals, type VitalsItem } from '../engine/vitals';
import { OBSERVATION_SCHEMA_VERSION, ASSET_REGISTRY_VERSION, type Observation } from '../engine/observation';
import type { Position, SpotHolding, LinkedWallet, PnlSummary } from '../types';

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;
/** How small a long's own portfolio has to be before its funding history is
 * worth two credits: past this, the account is not the shape a single
 * viral post highlights, and the signal says less about any one position
 * in it (audit L02a, mirrors the bet rule's own position-count bar). */
const MAX_POSITIONS_FOR_FUNDING_CONTEXT = 5;
/** Share of the headline position below which a caveat is not worth the
 * reader's attention. */
const MATERIAL_SHARE = 0.01;
/** How long one check may keep spending before it answers with what it has.
 * Exported because the Worker builds the abort signal that enforces it on
 * the sockets, and two different numbers would be worse than one. */
export const CHECK_DEADLINE_MS = 45_000;
/** How far behind the check a source's own timestamp may be before the card
 * says so. Positions move; a reading this old is history, not the present. */
const STALE_DATA_MS = 15 * 60_000;

export interface ObserveOptions {
  /** null runs Hyperliquid-only: no key, credit cap reached, or a test. */
  nansen: NansenClient | null;
  /** Why `nansen` is null, in words for the card. */
  nansenOffReason?: string;
  /** The position the reader asked about, rather than the largest one. */
  focus?: { coin: string; side: 'long' | 'short' } | null;
  now?: () => number;
  /** Absolute time past which no further paid stage is started. */
  deadline?: number;
  /** Aborts requests already in flight when that time runs out. The
   * deadline on its own only stops new stages from starting: a pair of
   * reads that had already begun could still run for two upstream timeouts
   * past it (audit R04). */
  signal?: AbortSignal;
}

export async function observe(address: string, opts: ObserveOptions): Promise<Observation> {
  const clock = opts.now ?? Date.now;
  const now = clock();
  // Four paid stages at the 20 s Nansen timeout, plus the free reads, can
  // outlast any reader's patience and hold a budget reservation the whole
  // time. Past the deadline the remaining paid stages are skipped and said
  // to be skipped, which is a partial answer rather than a slow wrong one.
  //
  // One clock, the caller's: mixing an injected `now` with a direct
  // Date.now() made the time budget untestable and the two could disagree.
  const deadline = opts.deadline ?? now + CHECK_DEADLINE_MS;
  const outOfTime = () => clock() > deadline;
  const day = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const coverage: string[] = [];
  const coverageNotes: Array<{ text: string; failure: boolean }> = [];
  const nansen = opts.nansen;

  // The free reads go first: if Hyperliquid is down, the check fails before a
  // single credit is spent.
  // These four decide things, so losing one has to fail the check rather
  // than quietly answer from less. Open interest is the exception: it
  // decorates the card and decides nothing, so it is read separately and
  // allowed to be missing.
  const signal = opts.signal;
  const [rawOrders, spotBalances, spotMetaPair, rawFills, perpMetaRes] = await Promise.all([
    getOpenOrders(address, undefined, signal),
    getSpotBalances(address, signal),
    getSpotMeta(signal),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now, signal),
    getPerpMetaAndAssetCtxs(signal).then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
  ]);
  // Every answer's shape is checked before any of it is used
  // (src/sources/validate.ts). A wrong envelope throws here, which fails the
  // check exactly as a failed request would; a wrong row is left out and
  // counted, and the count is said below where it lowers a claim.
  const ordersRead = checkOrders(rawOrders);
  const spotRead = checkSpotBalances(spotBalances);
  const spotMetaRead = checkSpotMeta(spotMetaPair);
  const fillsRead = checkFills(rawFills);
  // Open interest decides nothing, so perp metadata that is the wrong shape
  // is the same as perp metadata that never came: not shown.
  let perpMeta: [HlPerpMeta, HlPerpAssetCtx[]] | null = null;
  if (perpMetaRes.ok) {
    try {
      perpMeta = checkPerpMeta(perpMetaRes.v);
    } catch (err) {
      console.error('perp metadata', err);
    }
  }
  if (!perpMeta) coverage.push('Open interest unavailable, so size versus open interest is not shown');

  let source: Observation['source'] = 'hyperliquid';
  let positions: Position[] | null = null;
  let pnl: PnlSummary | null = null;
  let measuredAt: number | null = null;
  // Set wherever a source that feeds a rule could not be read in full.
  let degraded = false;
  /** A coverage note. `failure` marks the ones that make the answer worth
   * less, as opposed to the ones that merely describe what was found. */
  const note = (text: string, failure = false) => {
    coverage.push(text);
    coverageNotes.push({ text, failure });
    if (failure) degraded = true;
  };

  if (nansen && outOfTime()) {
    // The free reads alone can use up the budget when Hyperliquid is slow,
    // and the first paid stage used to start regardless.
    note('This check ran out of time before it could read positions from Nansen', true);
  } else if (nansen) {
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
  } else if (nansen === null) {
    const why = opts.nansenOffReason ? ` (${opts.nansenOffReason})` : '';
    // A cheaper check is still a check with sources missing from it, and the
    // answer it produces is not worth the ten-minute cache of a whole one.
    note(`Nansen not used${why}: main-dex positions only, no other chains, no linked wallets`, true);
  }
  // Nansen reports every HIP-3 dex; Hyperliquid's own clearinghouse answers
  // for the main perp dex only. A fallback reading is therefore part of the
  // portfolio, not the portfolio, and no rule may treat it as the whole.
  let positionsCoverage: SourceCoverage = 'complete';
  if (positions === null) {
    const state = await getClearinghouseState(address, signal);
    positions = normalizePositions(state);
    measuredAt = Number.isFinite(state.time) && state.time > 0 ? state.time : null;
    positionsCoverage = 'partial';
    coverage.push('Positions read from Hyperliquid alone: a position on a HIP-3 dex would not appear here');
  }

  // A timestamp from the source is the time the numbers describe; checkedAt
  // is only when this check asked. Stamping one with the other is how an
  // hour-old reading gets served as the current state of an account.
  if (measuredAt !== null && now - measuredAt >= STALE_DATA_MS) {
    const minutes = Math.round((now - measuredAt) / 60_000);
    // Not a caveat but a defect in the reading: a verdict about where an
    // account stands now, computed from where it stood an hour ago, is worth
    // less and must not be cached for as long as a current one.
    note(`Positions were measured ${minutes} minutes before this check, not at the moment of it`, true);
  }

  // Mark prices, so distance to liquidation is measured from where the price
  // is rather than from where the position was opened.
  const markPxByCoin = new Map<string, number>();
  if (perpMeta) {
    const [perpUniverse, perpAssetCtxs] = perpMeta;
    perpUniverse.universe.forEach((asset, i) => {
      const markPx = Number(perpAssetCtxs[i]?.markPx);
      if (Number.isFinite(markPx) && markPx > 0) markPxByCoin.set(asset.name, markPx);
    });
  }
  const positionFeatures = computePositionFeatures(positions, markPxByCoin, opts.focus);
  // Asking about a position that is not open is worth saying out loud: the
  // answer below is about a different position from the one requested. Coin
  // alone used to decide this, so an ETH long asked for against an ETH short
  // silently kept `focus: {ETH, long}` while the card showed the short and
  // said nothing had changed (23.09 audit, U03).
  const askedFor = opts.focus ?? null;
  const focus =
    askedFor &&
    positionFeatures.headlineCoin?.toUpperCase() === askedFor.coin.toUpperCase() &&
    positionFeatures.headlineSide === askedFor.side
      ? askedFor
      : null;
  if (askedFor && focus === null) {
    const text = `No ${askedFor.coin} ${askedFor.side} is open at this address; this answer is about the largest position instead`;
    coverage.push(text);
    // Nothing failed to read, so the answer is not degraded - but it is not
    // an answer to the question asked, and that has to stand next to it
    // rather than among the notes a reader opens on purpose (23.09 U06).
    coverageNotes.push({ text, failure: true });
  }

  // frontendOpenOrders answers for one perp dex and spot. Nansen reports
  // positions on every HIP-3 dex as well, so without asking those by name an
  // account quoting both sides of a HIP-3 market reads as quoting nothing -
  // which is one of the conditions for calling a position a clean bet.
  const resting = normalizeOrders(ordersRead.rows);
  let malformedOrders = ordersRead.malformed;
  let ordersCoverage: SourceCoverage = 'complete';
  const hip3Dexes = [...new Set(positions.map((p) => dexOf(p.coin)).filter((d): d is string => d !== null))];
  if (hip3Dexes.length > 0) {
    const perDex = await Promise.allSettled(hip3Dexes.map((dex) => getOpenOrders(address, dex, signal)));
    perDex.forEach((r, i) => {
      let read: Checked<HlOpenOrder> | null = null;
      if (r.status === 'fulfilled') {
        try {
          read = checkOrders(r.value);
        } catch (err) {
          console.error('hip-3 orders', err);
        }
      }
      if (read) {
        resting.push(...normalizeOrders(read.rows));
        malformedOrders += read.malformed;
      } else {
        // "It quotes nothing" is one of the conditions for calling a
        // position a clean bet, and a dex that would not answer - or
        // answered with something that is not a list of orders - has not
        // been shown to be quiet.
        ordersCoverage = 'partial';
        note(`Resting orders on the ${hip3Dexes[i]} dex could not be read`, true);
      }
    });
  }
  // An order that is not an order is left out, and an account whose orders
  // were not all readable has not been shown to quote nothing.
  if (malformedOrders > 0) {
    ordersCoverage = 'partial';
    note(
      `${malformedOrders} resting ${malformedOrders === 1 ? 'order' : 'orders'} came back malformed and ` +
        'were left out, so "quotes nothing" cannot be said',
      true,
    );
  }
  const orderFeatures = computeOrderFeatures(resting, positionFeatures.headlineCoin);
  // A HIP-3 dex this account merely quotes on, with no open position, is not
  // in `hip3Dexes` at all - nothing here asks Hyperliquid to name every dex
  // that exists, only the ones a position points at. "Complete" is therefore
  // a claim about the venues checked, not about every venue there is. It
  // only matters once the venues checked come back quiet - a bet or book
  // rule is about to read that silence as "quotes nothing" - so the caveat
  // is stated exactly there rather than on every reading (23.09 audit, L06).
  if (ordersCoverage === 'complete' && orderFeatures.coinsBothSides === 0) {
    note(
      'No two-sided quoting found on the venues checked - the main dex and any HIP-3 dex this account holds a ' +
        'position on. A dex it only quotes, with no position of its own, would not appear here',
    );
  }
  const tradeFeatures = computeTradeFeatures(normalizeTrades(fillsRead.rows), TRADES_WINDOW_HOURS, positionFeatures.headlineCoin);
  if (fillsRead.malformed > 0) {
    note(
      `${fillsRead.malformed} of ${fillsRead.malformed + fillsRead.rows.length} fills came back malformed and were ` +
        'left out of the trading and position-flow figures',
      true,
    );
  }
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
      const read = checkNansenBalances(bal.rows);
      ownChain = normalizeNansenBalances(read.rows);
      otherChainsRead = true;
      hedgeCoverage = bal.complete && read.malformed === 0 ? 'complete' : 'partial';
      if (!bal.complete) note('Holdings on other chains: first 100 tokens only', true);
      if (read.malformed > 0) {
        note(
          `${read.malformed} of the account's balances on other chains came back malformed and were left out, ` +
            'so the cover found there is a floor',
          true,
        );
      }
    } catch {
      hedgeCoverage = 'missing';
      note('Holdings on other chains unavailable', true);
    }
  }
  const [spotMeta, spotAssetCtxs] = spotMetaRead.meta;
  const spotPrices = buildSpotPriceIndex(spotMeta, spotAssetCtxs);
  const hlSpot = normalizeSpotHoldings(spotRead.rows, spotPrices, duplicateSpotTokenNames(spotMeta));
  if (spotRead.malformed > 0) {
    // For a short these balances are part of the hedge search, and one that
    // could not be read leaves the cover unknown rather than zero.
    if (hedgeCoverage === 'complete') hedgeCoverage = 'partial';
    note(
      `${spotRead.malformed} spot ${spotRead.malformed === 1 ? 'balance' : 'balances'} on Hyperliquid came back ` +
        'malformed and were left out',
      true,
    );
  }
  if (spotMetaRead.malformed > 0) {
    note(
      `${spotMetaRead.malformed} entries of Hyperliquid's spot metadata came back malformed and were left out; ` +
        'a balance in one of those tokens reads as unpriced',
    );
  }
  for (const n of borrowingNotes(spotRead.rows, spotPrices, positionFeatures)) note(n.text, n.failure);
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

  // Spot cannot hedge a long, so the funder search above never runs for one
  // - but a long's own funding history is Nansen context a hedge search can
  // never reach, and it is cheap to ask for exactly the small, simple
  // accounts a viral post usually highlights (audit L02a).
  const fundingContextWorthIt =
    nansen !== null &&
    positionFeatures.headlineSide === 'long' &&
    positionFeatures.nPositions > 0 &&
    positionFeatures.nPositions <= MAX_POSITIONS_FOR_FUNDING_CONTEXT;
  let fundingContext: VitalsItem | null = null;
  if (fundingContextWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at when the account was first funded', true);
  } else if (fundingContextWorthIt) {
    fundingContext = await readFundingContext(nansen!, address, now, note);
  }

  let openInterestUsd = 0;
  if (perpMeta) {
    const [perpUniverse, perpAssetCtxs] = perpMeta;
    const headlineIndex = perpUniverse.universe.findIndex((a) => a.name === positionFeatures.headlineCoin);
    openInterestUsd =
      headlineIndex >= 0
        ? Number(perpAssetCtxs[headlineIndex].openInterest) * Number(perpAssetCtxs[headlineIndex].markPx)
        : 0;
    if (headlineIndex < 0 && positionFeatures.headlineCoin?.includes(':')) {
      coverage.push('Size versus open interest not computed for a HIP-3 dex market');
    }
  }

  const sizeVsOi = computeSizeVsOi(positionFeatures.headlineNotionalUsd, openInterestUsd);
  // The same object computePositionFeatures picked as the headline, found
  // again by coin and side: a Hyperliquid account nets to one position per
  // market, so the pair is unique and this recovers it without widening
  // PositionFeatures (which verdict.ts also reads) with fields no rule uses.
  const headlinePosition =
    positionFeatures.headlineCoin === null
      ? null
      : (positions.find((p) => p.coin === positionFeatures.headlineCoin && p.side === positionFeatures.headlineSide) ??
        null);
  const vitals = computeVitals({
    headline: headlinePosition,
    headlineLiqDistancePct: positionFeatures.headlineLiqDistancePct,
    headlineLiqDistanceBasis: positionFeatures.headlineLiqDistanceBasis,
    positionsSource: source === 'nansen' ? 'Nansen' : 'Hyperliquid',
    sizeVsOi,
    headlineOpenedUsd: tradeFeatures.headlineOpenedUsd,
    headlineClosedUsd: tradeFeatures.headlineClosedUsd,
    headlineFills: tradeFeatures.headlineFills,
    tradesSpanHours: tradeFeatures.spanHours,
  });
  if (fundingContext) vitals.push(fundingContext);

  // Notes pushed straight onto `coverage` before `note` existed describe
  // what was found rather than what failed, so they default to that.
  for (const text of coverage) {
    if (!coverageNotes.some((n) => n.text === text)) coverageNotes.push({ text, failure: false });
  }

  return {
    address,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    hedgeScope,
    hedgeCoverage,
    ordersCoverage,
    positionsCoverage,
    linkedHedge,
    trades: tradeFeatures,
    pnl,
    sizeVsOi,
    source,
    focus,
    positionsAsOf: measuredAt === null ? null : new Date(measuredAt).toISOString(),
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    assetRegistryVersion: ASSET_REGISTRY_VERSION,
    observedAt: measuredAt === null ? new Date(now).toISOString() : new Date(measuredAt).toISOString(),
    degraded,
    vitals,
    coverage,
    coverageNotes,
    checkedAt: new Date(now).toISOString(),
  };
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
        const read = checkRelatedWallets(r.value.rows);
        links.push(...normalizeRelatedWallets(read.rows));
        if (!r.value.complete) linksTruncated = true;
        // A funder left out is a funder whose holdings were never looked at.
        if (read.malformed > 0) note(`${read.malformed} funding links came back malformed on one chain and were left out`, true);
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
  let truncatedFunder = false;
  const linked = candidates.flatMap((wallet, i) => {
    const b = balances[i];
    if (b.status !== 'fulfilled') {
      note('One linked wallet could not be read', true);
      return [];
    }
    // The main data is already in hand at this point. A funder balance is
    // extra context, and an extra source answering with the wrong shape
    // used to throw here, outside any guard, and lose the whole check.
    try {
      const read = checkNansenBalances(b.value.rows);
      const holdings = normalizeNansenBalances(read.rows);
      if (!b.value.complete || read.malformed > 0) truncatedFunder = true;
      return [{ wallet, holdings }];
    } catch (err) {
      console.error('nansen funder balances', err);
      note('One funding wallet came back in an unexpected shape and was left out', true);
      return [];
    }
  });
  if (truncatedFunder) {
    note('A funding wallet was not read in full - its first 100 tokens only, or rows that came back malformed - so its holdings may be understated', true);
  }
  return computeLinkedHedge(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    linked,
  );
}

const FUNDING_CONTEXT_CHAINS = ['arbitrum', 'ethereum'] as const;

/** When a long's own wallet was first funded, and by what kind of address -
 * two calls, only for a small account. Never a hedge: a hedge search does
 * not apply to a long at all, so this is the one piece of Nansen context a
 * lone long can still carry.
 *
 * Named "Earliest funding found" rather than "First funded" - and scoped to
 * the chain it was found on - because it is neither the account's first
 * activity on every chain, nor the date the position or the Hyperliquid
 * account itself was created, only the earliest First Funder record on the
 * two chains this checks. A read that failed on one of them used to be
 * noted elsewhere on the card while this line kept its unqualified claim,
 * so a one-day-old Ethereum record could read as the account's age even
 * when Arbitrum was never actually checked (23.09 audit, L09). */
async function readFundingContext(
  nansen: NansenClient,
  address: string,
  now: number,
  note: (text: string, failure?: boolean) => void,
): Promise<VitalsItem | null> {
  const related = await Promise.allSettled(
    FUNDING_CONTEXT_CHAINS.map((chain) => nansen.relatedWallets(address, chain)),
  );
  const links: LinkedWallet[] = [];
  const uncheckedChains: string[] = [];
  related.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      try {
        const read = checkRelatedWallets(r.value.rows);
        links.push(...normalizeRelatedWallets(read.rows));
        if (read.malformed > 0) note(`${read.malformed} funding records came back malformed on one chain and were left out`);
      } catch (err) {
        console.error('nansen related wallets (funding context)', err);
        note('Funding history came back in an unexpected shape on one chain');
        uncheckedChains.push(FUNDING_CONTEXT_CHAINS[i]);
      }
    } else {
      note('Funding history unavailable on one chain');
      uncheckedChains.push(FUNDING_CONTEXT_CHAINS[i]);
    }
  });
  // The earliest First Funder found, whichever of the two chains it is on -
  // not "the earliest across every chain", which nothing here checked.
  const first = links
    .filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase() && w.fundedAt !== null)
    .sort((a, b) => (a.fundedAt as number) - (b.fundedAt as number))[0];
  if (!first) return null;
  const days = Math.max(0, Math.round((now - (first.fundedAt as number)) / 86_400_000));
  const when = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const who =
    first.serviceStatus === 'service'
      ? 'an exchange or bridge'
      : first.serviceStatus === 'unverified'
        ? 'an unlabelled wallet'
        : 'another wallet';
  const scope = uncheckedChains.length > 0 ? `, ${uncheckedChains.join(' and ')} not read` : '';
  return { label: 'Earliest funding found', value: `${when} on ${first.chain}${scope}, by ${who}`, source: 'Nansen' };
}

/** A coin amount the way a reader counts it: whole units once there are a
 * hundred of them, four significant digits below that. */
function amountText(n: number): string {
  return n >= 100
    ? Math.round(n).toLocaleString('en-US')
    : Number(n.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}

/**
 * Loans Hyperliquid shows under portfolio margin, said rather than lost.
 *
 * A borrowed balance arrives as a negative spot `total`, and the holdings
 * normaliser drops a balance that is not above zero, so a debt of millions
 * used to read as nothing at all. Seen live on 24.09: the demonstration
 * account for "Hedged" owes 17,967,395 USDC against the HYPE it holds
 * against its HYPE short - the carry trade Hyperliquid's own documentation
 * describes, and still a covered short, so the note only describes it.
 *
 * A loan in the headline coin itself is different. Owed and not held, it is
 * a short of that coin: it offsets a long and adds to a short, and no rule
 * here counts a loan either way, so that one stands next to the answer.
 */
function borrowingNotes(
  rows: HlSpotBalance[],
  priceByTokenIndex: Map<number, number>,
  headline: Pick<PositionFeatures, 'headlineCoin' | 'headlineSide'>,
): Array<{ text: string; failure: boolean }> {
  const notes: Array<{ text: string; failure: boolean }> = [];
  const isHeadline = (b: HlSpotBalance) =>
    headline.headlineCoin !== null && spotHedgesPerp(b.coin, headline.headlineCoin, { source: 'hyperliquid-spot' });
  const loans: string[] = [];
  for (const b of rows) {
    const net = Number(b.total);
    const borrowed = Number(b.borrowed ?? 0);
    const owed = borrowed > 0 ? borrowed : net < 0 ? -net : 0;
    if (owed === 0) continue;
    if (isHeadline(b) && net < 0) {
      const held = `${amountText(-net)} ${b.coin} is owed on Hyperliquid spot - borrowed and not held`;
      notes.push({
        text:
          headline.headlineSide === 'long'
            ? `${held}, which works as a short against this long. This reading does not count a loan as cover`
            : `${held}, which adds to this short. The figures here are the perp position alone`,
        failure: true,
      });
      continue;
    }
    const price = b.token === undefined ? undefined : priceByTokenIndex.get(b.token);
    loans.push(`${amountText(owed)} ${b.coin}${price === undefined ? '' : ` (${formatUsd(owed * price)})`}`);
  }
  if (loans.length > 0) {
    const pledged =
      headline.headlineSide === 'short'
        ? rows.filter((b) => isHeadline(b) && Number(b.supplied ?? 0) > 0)
        : [];
    const collateral = pledged
      .map((b) => ` ${amountText(Number(b.supplied))} ${b.coin} of the spot held against the short is supplied as collateral.`)
      .join('');
    notes.push({
      text:
        `Borrowed on Hyperliquid under portfolio margin: ${loans.join(', ')}.${collateral} ` +
        'Spot balances are counted net of what is borrowed, and a loan taken anywhere else would not appear here',
      failure: false,
    });
  }
  return notes;
}
