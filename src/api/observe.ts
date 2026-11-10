/**
 * Everything a check reads, and what it saw: the first of the three stages
 * (23.09 audit, "code and architecture"). All the I/O of a check lives
 * here. Rules and words are src/engine/interpret.ts, and see nothing but the
 * Observation this returns.
 *
 * Positions come from Hyperliquid itself, every perp dex of it
 * (src/sources/positions.ts), and cost nothing. Balances on other chains come
 * from public nodes (src/sources/onchain.ts), read only when a hedge could
 * move the answer. The 30-day PnL is Hyperliquid's own `portfolio`, one
 * request, read when context is requested. The funding links and a long's
 * funding history come from a block explorer (src/sources/explorer.ts), read
 * only where the answer can still change the verdict or is asked for: linked
 * wallets only when the account's own balances leave the answer open, funding
 * history only when context is requested. Deciding whether a read is worth
 * making needs the features read so far, which is why the features are
 * computed here, as the reads come in, rather than after them.
 */
import {
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getUserFillsByTime,
  getPerpDexRegistry,
  getPortfolio,
  getQuoteMid,
  dexOf,
} from '../sources/hyperliquid';
import {
  normalizeOrders,
  normalizeTrades,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
  duplicateSpotTokenNames,
  normalizePortfolioPnl,
} from '../sources/normalize';
import { readFundingLinks, type ChainRead, type ExplorerConfig, type FundingChain } from '../sources/explorer';
import { isRequestBudgetExceeded, requestBudgetOf, REQUEST_LIMIT_REASON } from '../requestBudget';
import { readAllDexPositions, type PositionsReader } from '../sources/positions';
import {
  CHAIN_NAMES,
  HOLDINGS_CHAINS,
  readOnchainHoldings,
  underlyingPricesFrom,
  type HoldingsChain,
  type OnchainHoldings,
  type UnderlyingPrices,
} from '../sources/onchain';
import type { HlOpenOrder, HlPerpAssetCtx, HlPerpMeta, HlSpotBalance } from '../sources/hyperliquid';
import {
  checkFills,
  checkOrders,
  checkPerpMeta,
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
import {
  NATIVE_PLACEHOLDER,
  isWatchlistToken,
  nativeToken,
  registryTokens,
  spotHedgesPerp,
  watchlistTokens,
} from '../engine/assets';
import { parsePerpVenues } from '../marketRegistry';
import { quoteGeometry } from '../engine/quoteDiagnostics';
import { marketDefinition } from '../engine/marketIdentity';
import { formatUsd, formatPct } from '../engine/evidence';
import { computeVitals, type VitalsItem } from '../engine/vitals';
import { OBSERVATION_SCHEMA_VERSION, ASSET_REGISTRY_VERSION, type Observation } from '../engine/observation';
import type { Position, SpotHolding, PnlSummary } from '../types';

const TRADES_WINDOW_HOURS = 24;
const PNL_WINDOW_DAYS = 30;
const MAX_FUNDERS = 2;
/** How small a long's own portfolio has to be before its funding history is
 * worth two requests: past this, the account is not the shape a single
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
  /** Optional PnL/funding context, read unless this is false: the PnL is one
   * Hyperliquid request, a long's funding history two or three explorer
   * requests. */
  includeContext?: boolean;
  /** How the block explorer is reached for the funding links. Without a key
   * only Ethereum can be read, and Arbitrum is said to be not read. */
  explorer?: ExplorerConfig;
  /** The position the reader asked about, rather than the largest one. */
  focus?: { coin: string; side: 'long' | 'short' } | null;
  now?: () => number;
  /** Absolute time past which no further optional read is started. */
  deadline?: number;
  /** Aborts requests already in flight when that time runs out. The
   * deadline on its own only stops new stages from starting: a pair of
   * reads that had already begun could still run for two upstream timeouts
   * past it (audit R04). */
  signal?: AbortSignal;
  /** Reads the account's positions on every Hyperliquid dex. A live read by
   * default; the Worker passes one that reuses a complete reading of the
   * same address for a minute (src/sources/positions.ts). */
  readPositions?: PositionsReader;
}

/** Requests the account's holdings on other chains need: one per chain. */
const HOLDINGS_RESERVE = 3;
/** Requests the funder search needs: the explorer's three reads (Ethereum, Arbitrum,
 * and the Ethereum-chain label of the Arbitrum sender), then 2 funders x 3 chains. */
const LINKS_RESERVE = 9;
/** The block explorer's chains by name, for the card. */
const FUNDING_CHAIN_NAMES: Record<FundingChain, string> = { ethereum: 'Ethereum', arbitrum: 'Arbitrum' };
const KEPT_FOR_VERDICT = 'the check kept its remaining requests for the reads that decide the verdict';
/** "A", "A and B", "A, B and C". */
function listText(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The recognised tokens in the order the scope note lists them. The
 * registry's own order is by chain and address, so it is not used for display;
 * a symbol the registry gains that is not listed here is added at the end. */
const TOKEN_DISPLAY_ORDER = ['ETH', 'WETH', 'stETH', 'wstETH', 'rETH', 'cbETH', 'weETH', 'aEthWETH', 'WBTC', 'cbBTC', 'HYPE', 'WHYPE'];
const TOKEN_DISPLAY_NAMES: Record<string, string> = { aEthWETH: 'Aave WETH deposits' };
/** The look-alike staking tokens in the order the scope note lists them. */
const LOOKALIKE_DISPLAY_ORDER = ['rsETH', 'ezETH', 'mETH', 'ETHx', 'osETH'];

/** What a holdings read from public nodes covers, said whenever one ran: the
 * chains it did read, in their usual order, the tokens recognised on those
 * chains, the look-alike staking tokens looked for on them (never counted as
 * cover), and no others. */
function knownTokensNote(read: HoldingsChain[]): string {
  const chainsRead = HOLDINGS_CHAINS.filter((c) => read.includes(c));
  const present = new Set<string>();
  const lookalikes = new Set<string>();
  for (const chain of chainsRead) {
    const native = nativeToken(chain);
    if (native) present.add(native.symbol);
    for (const token of registryTokens(chain)) present.add(token.symbol);
    for (const token of watchlistTokens(chain)) lookalikes.add(token.symbol);
  }
  const ordered = (set: Set<string>, order: string[]) => [
    ...order.filter((symbol) => set.has(symbol)),
    ...[...set].filter((symbol) => !order.includes(symbol)),
  ];
  const tokens = ordered(present, TOKEN_DISPLAY_ORDER).map((symbol) => TOKEN_DISPLAY_NAMES[symbol] ?? symbol).join(', ');
  // Said only for the chains actually read, like the recognised list: a
  // chain that was not read looked for nothing.
  const lookedFor =
    lookalikes.size > 0
      ? `look-alike staking tokens (${ordered(lookalikes, LOOKALIKE_DISPLAY_ORDER).join(', ')}) ` +
        'were looked for but are never counted as cover; '
      : '';
  return (
    `Balances on other chains: only the tokens this tool recognises (${tokens}) on ` +
    `${listText(chainsRead.map((c) => CHAIN_NAMES[c]))} were read; ${lookedFor}other tokens and other chains were not`
  );
}

/** A funding wallet's holding the read could not value - no Hyperliquid mark
 * for its underlying, or no liquid-staking rate - left out at $0, which is
 * not a finding that the wallet holds none. */
const UNPRICED_FUNDER_NOTE =
  'A funding wallet holds tokens this tool recognises that could not be priced, so its holdings may be understated';

/** The chains of a holdings read that the request limit refused, by name. */
const refusedChains = (read: OnchainHoldings): string[] =>
  read.failed.filter((f) => f.reason === 'limit').map((f) => CHAIN_NAMES[f.chain]);

/** The underlyings (ETH, BTC, HYPE) of holdings left unpriced because
 * Hyperliquid's mark for them was not read, registry tokens and look-alike
 * staking tokens alike. A holding unpriced for another reason - a
 * liquid-staking rate that did not answer - is not one of them. */
function unmarkedUnderlyings(holdings: OnchainHoldings['holdings'], prices: UnderlyingPrices): string[] {
  const missing = new Set<string>();
  for (const { priced, chain, tokenAddress } of holdings) {
    if (priced !== false || chain === undefined || tokenAddress === undefined) continue;
    const underlying =
      tokenAddress === NATIVE_PLACEHOLDER
        ? nativeToken(chain)?.underlying
        : (registryTokens(chain).find((t) => t.tokenAddress === tokenAddress) ??
            watchlistTokens(chain).find((t) => t.tokenAddress === tokenAddress))?.underlying;
    if (underlying !== undefined && prices[underlying as keyof UnderlyingPrices] === undefined) missing.add(underlying);
  }
  return (['ETH', 'BTC', 'HYPE'] as const).filter((u) => missing.has(u));
}

/** How many requests a check must keep back from the descriptive reads so the
 * ones that decide the verdict still fit: the orders still to be read on named
 * dexes, and for a short the holdings reads that can still offset it, plus the
 * funder search (the explorer's three reads, then the funders' holdings). */
function ruleReserve(pendingOrderDexes: number, side: 'long' | 'short' | null): number {
  return pendingOrderDexes + (side === 'short' ? HOLDINGS_RESERVE + LINKS_RESERVE : 0);
}

/** What the card says about one explorer chain that was not read in full;
 * null for a chain read to the end. */
function fundingChainNote(read: ChainRead): string | null {
  const name = FUNDING_CHAIN_NAMES[read.chain];
  if (read.status === 'read') {
    return read.complete
      ? null
      : `Funding links on ${name}: the first page held no incoming transaction with a value, so the earliest funder may be missing`;
  }
  if (read.reason === 'limit') return `Funding links on ${name} were not read: ${REQUEST_LIMIT_REASON}`;
  if (read.reason === 'no-key') return `Funding links on ${name} were not read: no explorer key is configured`;
  return `Funding links on ${name} could not be read`;
}

export async function observe(address: string, opts: ObserveOptions): Promise<Observation> {
  const clock = opts.now ?? Date.now;
  const now = clock();
  // The optional reads, each at its own timeout, plus the free reads, can
  // outlast any reader's patience. Past the deadline the remaining optional
  // reads are skipped and said to be skipped, which is a partial answer
  // rather than a slow wrong one.
  //
  // One clock, the caller's: mixing an injected `now` with a direct
  // Date.now() made the time budget untestable and the two could disagree.
  const deadline = opts.deadline ?? now + CHECK_DEADLINE_MS;
  const outOfTime = () => clock() > deadline;
  const coverage: string[] = [];
  const coverageNotes: Array<{ text: string; failure: boolean }> = [];
  const explorer: ExplorerConfig = opts.explorer ?? {};

  // Hyperliquid's own reads go first: if it is down, the check fails before
  // any other source is asked.
  // Orders, spot balances and positions must answer. Fills and spot prices
  // may fail, but then their coverage is explicitly incomplete. Perp
  // metadata decorates the card and prices the on-chain holdings (marks), and
  // may be unavailable; unpriced holdings are then said to be unpriced.
  const signal = opts.signal;
  const budget = requestBudgetOf(signal);
  const readPositions: PositionsReader = opts.readPositions ?? ((a, s) => readAllDexPositions(a, { signal: s }));
  const [rawOrders, spotBalances, spotMetaPair, rawFills, perpMetaRes, positionsRead] = await Promise.all([
    getOpenOrders(address, undefined, signal),
    getSpotBalances(address, signal),
    getSpotMeta(signal).then(v => ({ ok: true as const, v }), () => ({ ok: false as const, v: null })),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now, signal)
      .then(v => ({ ok: true as const, v }), () => ({ ok: false as const, v: null })),
    getPerpMetaAndAssetCtxs(signal).then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
    // Every dex: the main one must answer, or this rejects and the check
    // fails like any source that is down; a named dex that does not answer
    // makes the reading partial and is named below.
    readPositions(address, signal),
  ]);
  // Every answer's shape is checked before any of it is used
  // (src/sources/validate.ts). A wrong envelope throws here, which fails the
  // check exactly as a failed request would; a wrong row is left out and
  // counted, and the count is said below where it lowers a claim.
  const ordersRead = checkOrders(rawOrders);
  const spotRead = checkSpotBalances(spotBalances);
  let spotMetaMissing = !spotMetaPair.ok;
  let fillsMissing = !rawFills.ok;
  const spotMetaRead = (() => { try { if (spotMetaPair.ok) return checkSpotMeta(spotMetaPair.v); } catch { spotMetaMissing = true; } return checkSpotMeta([{ tokens: [], universe: [] }, []]); })();
  const fillsRead = (() => { try { if (rawFills.ok) return checkFills(rawFills.v); } catch { fillsMissing = true; } return checkFills([]); })();
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

  let pnl: PnlSummary | null = null;
  // Set wherever a source that feeds a rule could not be read in full.
  let degraded = false;
  /** A coverage note. `failure` marks the ones that make the answer worth
   * less, as opposed to the ones that merely describe what was found. */
  const note = (text: string, failure = false) => {
    coverage.push(text);
    coverageNotes.push({ text, failure });
    if (failure) degraded = true;
  };
  if (spotMetaMissing) note('Spot prices unavailable: balances are kept as unpriced; coverage cannot be established from them', true);
  if (fillsMissing) note('Recent fills unavailable: trading activity and position flow could not be read', true);

  // A dex that was not read, or a list of dexes that was not read, is a
  // place a position could be that nobody looked: the reading is partial
  // there, and no rule may treat it as the whole portfolio.
  const positions: Position[] = positionsRead.positions;
  const positionsCoverage: SourceCoverage = positionsRead.coverage;
  const measuredAt =
    typeof positionsRead.measuredAt === 'number' && Number.isFinite(positionsRead.measuredAt) && positionsRead.measuredAt > 0
      ? positionsRead.measuredAt
      : null;
  for (const dex of positionsRead.failed) {
    note(`Positions on the ${dex} dex could not be read, so this reading may be missing positions there`, true);
  }
  if (!positionsRead.venues.registryRead) {
    note('The list of Hyperliquid dexes could not be read: positions on named (HIP-3) dexes are not included', true);
  }

  if (opts.includeContext === false) {
    note('Optional PnL and funding-age context not requested; this does not affect exposure evidence');
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
  if (measuredAt !== null && measuredAt - now > 60_000) {
    note('The position source reports a future timestamp; its time cannot be reconciled with this check', true);
  }

  // Mark prices, so distance to liquidation is measured from where the price
  // is rather than from where the position was opened.
  const markPxByCoin = new Map<string, number>();
  const contextByCoin = new Map<string, HlPerpAssetCtx>();
  // Only the headline reads a named dex's marks (its liquidation distance) and
  // asset context (its vitals), so market data is read for its dex alone. The
  // headline is picked first, from the main dex's marks, which only matter for
  // a headline on the main dex.
  const mainMarks = new Map<string, number>();
  if (perpMeta) {
    perpMeta[0].universe.forEach((asset, i) => {
      const markPx = Number(perpMeta[1][i]?.markPx);
      if (Number.isFinite(markPx) && markPx > 0) mainMarks.set(asset.name, markPx);
    });
  }
  const firstPick = computePositionFeatures(positions, mainMarks, opts.focus);
  const headlineDex = dexOf(firstPick.headlineCoin || '');
  const hip3Dexes = [...new Set(positions.map((p) => dexOf(p.coin)).filter((d): d is string => d !== null))];
  const metadata = perpMeta ? [perpMeta] : [];
  // What the descriptive reads leave for the ones that decide the verdict,
  // before the named dexes' orders are read.
  const reserveBeforeOrders = ruleReserve(hip3Dexes.length, firstPick.headlineSide);
  if (headlineDex !== null && budget && !budget.affords(1, reserveBeforeOrders)) {
    note(`Market data for the ${headlineDex} dex was not read: ${KEPT_FOR_VERDICT}`);
  } else if (headlineDex !== null) {
    try { metadata.push(checkPerpMeta(await getPerpMetaAndAssetCtxs(signal, headlineDex))); } catch { /* risk metrics stay unavailable */ }
  }

  // The 30-day PnL is Hyperliquid's own `portfolio`, one request, and is
  // context: asked for only when the reading wants it, and never a reason to
  // lose the check or to lower a verdict. Like the other descriptive reads it
  // gives way to the reads that decide the verdict, and is skipped when the
  // check is out of time; either is said, as context.
  if (opts.includeContext !== false) {
    if (outOfTime()) {
      note('PnL was not read: this check ran out of time');
    } else if (budget && !budget.affords(1, reserveBeforeOrders)) {
      note(`PnL was not read: ${KEPT_FOR_VERDICT}`);
    } else {
      try {
        const raw = await getPortfolio(address, signal);
        // A 200 with the wrong body is a missing PnL, not a TypeError that
        // loses the check, and never a PnL of zero.
        try {
          pnl = normalizePortfolioPnl(raw, PNL_WINDOW_DAYS);
        } catch (err) {
          console.error('hyperliquid portfolio', err);
          coverage.push('PnL came back in an unexpected shape');
        }
      } catch (err) {
        console.error('hyperliquid portfolio', err);
        coverage.push('PnL unavailable');
      }
    }
  }
  for (const [perpUniverse, perpAssetCtxs] of metadata) {
    perpUniverse.universe.forEach((asset, i) => {
      const markPx = Number(perpAssetCtxs[i]?.markPx);
      if (Number.isFinite(markPx) && markPx > 0) markPxByCoin.set(asset.name, markPx);
      if (perpAssetCtxs[i]) contextByCoin.set(asset.name, perpAssetCtxs[i]);
    });
  }
  const positionFeatures = computePositionFeatures(positions, markPxByCoin, opts.focus);
  const venue = dexOf(positionFeatures.headlineCoin || '');
  let marketProvenance: Observation['marketProvenance'];
  let definition: Observation['marketDefinition'];
  if (venue) {
    try {
      const entry = parsePerpVenues(positionsRead.registry ?? await getPerpDexRegistry(signal)).find(v => v.name === venue);
      definition = marketDefinition(positionFeatures.headlineCoin!, entry ?? null, now);
      positionFeatures.headlineUnderlyingVerified = definition.status === 'documented';
      marketProvenance = { venue, status: 'complete', listed: !!entry, deployer: entry?.deployer || null, oracleUpdater: entry?.oracleUpdater || null,
        underlyingVerified: positionFeatures.headlineUnderlyingVerified === true, at: new Date(now).toISOString() };
    } catch (err) {
      definition = marketDefinition(positionFeatures.headlineCoin!, null, now);
      marketProvenance = { venue, status: 'missing', listed: null, deployer: null, oracleUpdater: null, underlyingVerified: false, at: new Date(now).toISOString() };
      note(isRequestBudgetExceeded(err)
        ? `The HIP-3 venue registry was not read: ${REQUEST_LIMIT_REASON}; deployer and oracle updater are not established`
        : 'HIP-3 venue registry unavailable; deployer and oracle updater are not established');
    }
  }
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
    const scope = positionsCoverage === 'complete' ? 'at this address in this reading' : 'on the checked venues in this reading; other venues are unverified';
    const text = `No ${askedFor.coin} ${askedFor.side} is open ${scope}; this answer is about the largest position instead`;
    coverage.push(text);
    // Nothing failed to read, so the answer is not degraded - but it is not
    // an answer to the question asked, and that has to stand next to it
    // rather than among the notes a reader opens on purpose (23.09 U06).
    coverageNotes.push({ text, failure: true });
  }

  // frontendOpenOrders answers for one perp dex and spot. The positions come
  // from every HIP-3 dex as well, so without asking those by name an account
  // quoting both sides of a HIP-3 market reads as quoting nothing - which is
  // one of the conditions for calling a position a clean bet.
  const resting = normalizeOrders(ordersRead.rows);
  let malformedOrders = ordersRead.malformed;
  let ordersCoverage: SourceCoverage = 'complete';
  if (hip3Dexes.length > 0) {
    const perDex = await Promise.allSettled(hip3Dexes.map((dex) => getOpenOrders(address, dex, signal)));
    perDex.forEach((r, i) => {
      let read: Checked<HlOpenOrder> | null = null;
      const refused = r.status === 'rejected' && isRequestBudgetExceeded(r.reason);
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
        note(
          refused
            ? `Resting orders on the ${hip3Dexes[i]} dex were not read: ${REQUEST_LIMIT_REASON}`
            : `Resting orders on the ${hip3Dexes[i]} dex could not be read`,
          true,
        );
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
  let quoteMid: number | null = null;
  if (orderFeatures.headlineTwoSided && positionFeatures.headlineCoin && !outOfTime()) {
    if (budget && !budget.affords(1, ruleReserve(0, positionFeatures.headlineSide))) {
      note(`The order book mid was not read: ${KEPT_FOR_VERDICT}`);
    } else try { quoteMid = await getQuoteMid(positionFeatures.headlineCoin, signal); } catch { /* descriptive fallback to mark, never changes verdict */ }
  }
  // A HIP-3 dex this account merely quotes on, with no open position, is not
  // in `hip3Dexes` at all - orders are asked for only on the dexes a position
  // points at, not on every dex there is. "Complete" is therefore
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
  const hasLiability = spotRead.rows.some(b => Number(b.total) < 0 && positionFeatures.headlineCoin !== null && spotHedgesPerp(b.coin, positionFeatures.headlineCoin, { source: 'hyperliquid-spot' }));
  const hedgeMatters = hedgeCanChangeVerdict({ positions: positionFeatures, orders: orderFeatures, trades: tradeSignal, hedge: { hasUnresolvedLiability: hasLiability } });

  // The registry tokens and the look-alike staking tokens on Ethereum,
  // Arbitrum and HyperEVM are priced with the main dex's own marks, already in
  // hand: no request is spent on prices.
  const prices = underlyingPricesFrom(mainMarks);
  let ownChain: SpotHolding[] = [];
  let otherChainsRead = false;
  // Only a short can be offset by spot, so for anything else there is no
  // hedge to look for. For a short, Hyperliquid balances alone are a partial
  // answer until the public nodes fill in the other chains.
  let hedgeCoverage: HedgeCoverage = positionFeatures.headlineSide === 'short' ? 'partial' : 'not-applicable';
  if (hedgeMatters && outOfTime()) {
    note('This check ran out of time before it could read holdings on other chains', true);
  } else if (hedgeMatters) {
    const own = await readOnchainHoldings(address, prices, signal);
    ownChain = own.holdings;
    otherChainsRead = own.read.length > 0;
    // A chain not read, or a token on one that came back unreadable, can
    // only have hidden cover: the read is complete only when neither happened.
    hedgeCoverage =
      own.read.length === 0
        ? 'missing'
        : own.read.length === HOLDINGS_CHAINS.length && own.unreadTokens === 0
          ? 'complete'
          : 'partial';
    if (otherChainsRead) note(knownTokensNote(own.read));
    for (const { chain, reason } of own.failed) {
      note(
        reason === 'limit'
          ? `Holdings on ${CHAIN_NAMES[chain]} were not read: ${REQUEST_LIMIT_REASON}`
          : `Holdings on ${CHAIN_NAMES[chain]} could not be read`,
        true,
      );
    }
    if (own.unreadTokens > 0) {
      note(
        own.unreadTokens === 1
          ? '1 token balance on other chains came back unreadable and was left out, so the cover found there is a floor'
          : `${own.unreadTokens} token balances on other chains came back unreadable and were left out, so the cover ` +
              'found there is a floor',
        true,
      );
    }
    for (const coin of unmarkedUnderlyings(own.holdings, prices)) {
      note(`Holdings on other chains could not be priced: Hyperliquid's ${coin} price was not read`, true);
    }
  }
  const [spotMeta, spotAssetCtxs] = spotMetaRead.meta;
  const spotPrices = buildSpotPriceIndex(spotMeta, spotAssetCtxs);
  const hlSpot = normalizeSpotHoldings(spotRead.rows, spotPrices, duplicateSpotTokenNames(spotMeta));
  if (spotRead.malformed > 0) {
    // A malformed balance can hide spot cover for a short or a negative
    // balance (same-asset debt) against a long.
    if (hedgeCoverage === 'complete' || positionFeatures.headlineSide === 'long') hedgeCoverage = 'partial';
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
  hedgeFeatures.hasUnresolvedLiability = spotRead.rows.some(
    (b) => Number(b.total) < 0 && positionFeatures.headlineCoin !== null &&
      spotHedgesPerp(b.coin, positionFeatures.headlineCoin, { source: 'hyperliquid-spot' }),
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
    positionFeatures.headlineSide !== 'short' ? 'none' : otherChainsRead ? 'known-tokens' : 'hyperliquid';

  // A short this lightly covered could have its cover in a wallet that funded
  // it. The funding links are the explorer's; a chain it cannot read (no key
  // for Arbitrum, a refusal, the request limit) leaves the search partial,
  // which no rule reads as clean.
  const funderLookupWorthIt =
    hedgeMatters && hedgeFeatures.hedgeRatio < DEFAULT_THRESHOLDS.hedged.linkedLookupBelowRatio;
  let linkedHedge: LinkedHedgeFeatures | null = null;
  let linkedHedgeCoverage: HedgeCoverage = 'not-applicable';
  if (funderLookupWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at the wallets that funded the account', true);
    linkedHedgeCoverage = 'missing';
  } else if (funderLookupWorthIt) {
    const result = await readLinkedHedge(explorer, address, positionFeatures, prices, note, signal);
    linkedHedge = result.features;
    linkedHedgeCoverage = result.coverage;
  }

  // Spot cannot hedge a long, so the funder search above never runs for one
  // - but a long's own funding history is context a hedge search can never
  // reach, and it is cheap to ask for exactly the small, simple accounts a
  // viral post usually highlights (audit L02a).
  const fundingContextWorthIt =
    opts.includeContext !== false &&
    positionFeatures.headlineSide === 'long' &&
    positionFeatures.nPositions > 0 &&
    positionFeatures.nPositions <= MAX_POSITIONS_FOR_FUNDING_CONTEXT;
  let fundingContext: VitalsItem | null = null;
  if (fundingContextWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at when the account was first funded', true);
  } else if (fundingContextWorthIt) {
    fundingContext = await readFundingContext(explorer, address, now, note, signal);
  }

  const headlineContext = contextByCoin.get(positionFeatures.headlineCoin ?? '');
  const openInterestUsd = headlineContext ? Number(headlineContext.openInterest) * Number(headlineContext.markPx) : 0;

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
    // Every position record comes from Hyperliquid's own dexes.
    positionsSource: 'Hyperliquid',
    sizeVsOi,
    headlineOpenedUsd: tradeFeatures.headlineOpenedUsd,
    headlineClosedUsd: tradeFeatures.headlineClosedUsd,
    headlineFills: tradeFeatures.headlineFills,
    tradesSpanHours: tradeFeatures.spanHours,
  });
  if (fundingContext) vitals.push(fundingContext);
  // Optional risk/activity data; none of these numbers can grant a verdict.
  const finiteField = (value: unknown) => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  if (headlineContext) {
    const funding = finiteField(headlineContext.funding);
    const oracle = finiteField(headlineContext.oraclePx);
    const mark = finiteField(headlineContext.markPx);
    if (funding !== null && oracle !== null && oracle > 0 && mark !== null && mark > 0) {
      // Funding settles hourly on oracle-valued size, rather than mark notional.
      const hourly = (positionFeatures.headlineSide === 'short' ? 1 : -1) * funding * positionFeatures.headlineNotionalUsd * oracle / mark;
      vitals.push({ label: 'Estimated funding / day', value: `${hourly * 24 >= 0 ? 'Receive' : 'Pay'} ${formatUsd(Math.abs(hourly * 24))} at current hourly rate`, source: 'Hyperliquid' });
    }
    const volume = finiteField(headlineContext.dayNtlVlm);
    if (volume !== null && volume > 0) vitals.push({ label: 'Size vs market volume, 24h', value: formatPct(positionFeatures.headlineNotionalUsd / volume), source: 'Hyperliquid' });
    const premium = finiteField(headlineContext.premium);
    if (premium !== null) vitals.push({ label: 'Perp premium', value: formatPct(premium), source: 'Hyperliquid' });
  }
  if (!fillsMissing && fillsRead.malformed === 0 && fillsRead.rows.length > 0) {
    const span = tradeFeatures.spanHours.toFixed(1) + 'h sample';
    for (const [field, label] of [['closedPnl', 'Realized PnL'], ['fee', 'Trading fees']] as const) {
      const values = fillsRead.rows.map(row => finiteField(row[field]));
      if (values.every((value): value is number => value !== null)) vitals.push({ label: `${label}, ${span}`, value: formatUsd(values.reduce((sum, value) => sum + value, 0)), source: 'Hyperliquid' });
    }
  }
  {
    // Only the positions in the main-dex answer were checked on the way in;
    // everything else in it is read as unknown and shown only if it is a
    // real number.
    const main = positionsRead.mainState as
      | { marginSummary?: { accountValue?: unknown; totalNtlPos?: unknown; totalMarginUsed?: unknown }; withdrawable?: unknown }
      | null
      | undefined;
    const equity = finiteField(main?.marginSummary?.accountValue);
    const notional = finiteField(main?.marginSummary?.totalNtlPos);
    if (equity !== null && equity > 0 && notional !== null) vitals.push({ label: 'Main-dex account leverage', value: (notional / equity).toFixed(1) + 'x', source: 'Hyperliquid' });
    const withdrawable = finiteField(main?.withdrawable);
    if (withdrawable !== null) vitals.push({ label: 'Main-dex withdrawable', value: formatUsd(withdrawable), source: 'Hyperliquid' });
    const margin = finiteField(main?.marginSummary?.totalMarginUsed);
    if (margin !== null) vitals.push({ label: 'Main-dex margin used', value: formatUsd(margin), source: 'Hyperliquid' });
  }
  if (fillsMissing) {
    const flow = vitals.find(v => v.label === 'Position flow');
    if (flow) flow.value = 'Unavailable this time';
  }

  for (let i = coverage.length - 1; i >= 0; i--) if (coverage.indexOf(coverage[i]) !== i) coverage.splice(i, 1);
    for (let i = coverageNotes.length - 1; i >= 0; i--) {
      if (coverageNotes.findIndex(n => n.text === coverageNotes[i].text) !== i) coverageNotes.splice(i, 1);
    }

  // Notes pushed straight onto `coverage` before `note` existed describe
  // what was found rather than what failed, so they default to that.
  for (const text of coverage) {
    if (!coverageNotes.some((n) => n.text === text)) coverageNotes.push({ text, failure: false });
  }

  return {
    address,
    ...(marketProvenance ? { marketProvenance } : {}),
    ...(definition ? { marketDefinition: definition } : {}),
    quoteGeometry: quoteGeometry(resting, positionFeatures.headlineCoin, quoteMid ?? markPxByCoin.get(positionFeatures.headlineCoin || ''), quoteMid === null ? 'mark' : 'mid'),
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    hedgeScope,
    hedgeCoverage,
    ordersCoverage,
    positionsCoverage,
    linkedHedge,
    linkedHedgeCoverage,
    trades: tradeFeatures,
    pnl,
    sizeVsOi,
    // Every read is Hyperliquid's, the public nodes' or the explorer's: none
    // is Nansen's any more. 'nansen' stays on the readings saved before.
    source: 'hyperliquid',
    positionsVenues: {
      asked: positionsRead.venues.asked,
      answered: positionsRead.venues.answered,
      registryRead: positionsRead.venues.registryRead,
    },
    mainDexPositionCount: positionsRead.mainDexCount,
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

/** The funding links on Ethereum and Arbitrum, read from the block explorer
 * (two requests, and a third for the label of an Arbitrum sender), then each
 * funder followed read from public nodes, one request per chain: First
 * Funders only, never an exchange or bridge, at most two. Returns null when no
 * link is worth following. */
async function readLinkedHedge(
  explorer: ExplorerConfig,
  address: string,
  positionFeatures: PositionFeatures,
  prices: UnderlyingPrices,
  note: (text: string, failure?: boolean) => void,
  signal?: AbortSignal,
): Promise<{ features: LinkedHedgeFeatures | null; coverage: HedgeCoverage }> {
  const { links, chains } = await readFundingLinks(address, explorer, signal);
  for (const read of chains) {
    const text = fundingChainNote(read);
    if (text !== null) note(text, true);
  }
  // How completely the search for candidates itself ran, before any
  // candidate is even chosen: no chain read leaves nothing to go on, the same
  // as a balance read that fails outright below; one chain not read, or read
  // but cut short, still leaves something real to trust, so it ranks the same
  // as a truncated read rather than a failed one (spec review after 25.09
  // audit, A06).
  const readChains = chains.filter((c) => c.status === 'read');
  const enumerationCoverage: HedgeCoverage =
    readChains.length === 0
      ? 'missing'
      : readChains.length === chains.length && readChains.every((c) => c.status === 'read' && c.complete)
        ? 'complete'
        : 'partial';

  const firstFunders = links.filter((w) => w.relation === 'First Funder' && w.address !== address.toLowerCase());
  const skipped = firstFunders.filter((w) => w.serviceStatus === 'service').length;
  if (skipped > 0) note(`${skipped} funding link(s) lead to an exchange or bridge and were not followed`);
  const candidates = firstFunders
    .filter((w) => w.serviceStatus !== 'service')
    .filter((w, i, all) => all.findIndex((x) => x.address === w.address) === i)
    .slice(0, MAX_FUNDERS);
  // No candidate worth following is not the same as no search worth
  // trusting: a search that ran cleanly and genuinely found nothing (or
  // found only exchanges) is `complete`, not the `not-applicable` the caller
  // defaults to for a lookup it never even tried.
  if (candidates.length === 0) return { features: null, coverage: enumerationCoverage };

  // The explorer labels few addresses, so "no exchange label" is the normal
  // answer, not evidence that a wallet is private. Say so on the card: an
  // unlabelled funder may well be an exchange deposit address.
  const unverified = candidates.filter((w) => w.serviceStatus === 'unverified').length;
  if (unverified > 0) {
    note(
      unverified === 1
        ? '1 funding wallet has no exchange label here: whether it is a private wallet or an exchange address is unverified'
        : `${unverified} funding wallets have no exchange label here: whether they are private wallets or exchange addresses is unverified`,
    );
  }

  // Started in order, so a request limit reached here refuses the last
  // funder's chains rather than an arbitrary one. A node that does not answer,
  // or answers with something that is not a balance, is a chain not read
  // (src/sources/onchain.ts); nothing here throws.
  const reads = await Promise.all(candidates.map((w) => readOnchainHoldings(w.address, prices, signal)));
  let truncatedFunder = false;
  let failedFunder = false;
  const linked = candidates.flatMap((wallet, i) => {
    const read = reads[i];
    // A chain the request limit refused is named with that reason; one that
    // failed for any other reason is not a fact about the limit.
    const refused = refusedChains(read);
    const failedOtherwise = read.failed.some((f) => f.reason !== 'limit');
    if (read.read.length === 0) {
      failedFunder = true;
      note(
        !failedOtherwise
          ? `One linked wallet was not read: ${REQUEST_LIMIT_REASON}`
          : refused.length > 0
            ? `One linked wallet could not be read; its holdings on ${listText(refused)} were not read: ${REQUEST_LIMIT_REASON}`
            : 'One linked wallet could not be read',
        true,
      );
      return [];
    }
    if (read.failed.length > 0 || read.unreadTokens > 0) {
      truncatedFunder = true;
      note(
        refused.length > 0 && !failedOtherwise && read.unreadTokens === 0
          ? `A funding wallet's holdings on ${listText(refused)} were not read: ${REQUEST_LIMIT_REASON}, so its ` +
              'holdings may be understated'
          : "A funding wallet's holdings on some chains or tokens could not be read, so its holdings may be understated" +
              (refused.length > 0 ? `; on ${listText(refused)} they were not read: ${REQUEST_LIMIT_REASON}` : ''),
        true,
      );
    }
    // computeLinkedHedge counts priced matches only, so a holding the read
    // could not value would vanish from the search while it read complete.
    // A look-alike staking token is never cover, priced or not, so one the
    // read could not value loses the search nothing and is not counted here.
    if (read.holdings.some((h) => h.priced === false && !isWatchlistToken(h.chain, h.tokenAddress))) {
      truncatedFunder = true;
      note(UNPRICED_FUNDER_NOTE, true);
    }
    return [{ wallet, holdings: read.holdings }];
  });
  // A candidate whose balance could not be read at all can only have hidden
  // a funder's holding, never invented one - so this coverage state follows
  // the exact same logic hedgeCoverage already uses for the account's own
  // holdings, just for the funder search instead (25.09 audit, A06).
  const balanceCoverage: HedgeCoverage =
    failedFunder && linked.length === 0 ? 'missing' : failedFunder || truncatedFunder ? 'partial' : 'complete';
  // Either stage of the search can independently drag the whole reading
  // down - a balance read that went perfectly cannot make up for a chain
  // that was never enumerated in the first place - so the worse of the two
  // stands for the search as a whole (spec review after A06).
  const coverage: HedgeCoverage =
    balanceCoverage === 'missing' || enumerationCoverage === 'missing'
      ? 'missing'
      : balanceCoverage === 'partial' || enumerationCoverage === 'partial'
        ? 'partial'
        : 'complete';
  return {
    features: computeLinkedHedge(
      positionFeatures.headlineCoin,
      positionFeatures.headlineSide,
      positionFeatures.headlineNotionalUsd,
      linked,
    ),
    coverage,
  };
}

/** When a long's own wallet was first funded, and by what kind of address -
 * two explorer requests (three when an Arbitrum sender is looked up), only for
 * a small account. Never a hedge: a hedge
 * search does not apply to a long at all, so this is the one piece of funding
 * context a lone long can still carry.
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
  explorer: ExplorerConfig,
  address: string,
  now: number,
  note: (text: string, failure?: boolean) => void,
  signal?: AbortSignal,
): Promise<VitalsItem | null> {
  const { links, chains } = await readFundingLinks(address, explorer, signal);
  // Context, not a failure: no verdict turns on a long's funding history.
  for (const read of chains) {
    const text = fundingChainNote(read);
    if (text !== null) note(text);
  }
  // A chain not read at all, and a chain read but cut short (its first page
  // held nothing with a value and more lay behind it): in both the earliest
  // funding on that chain may be missing, so both are named in the qualifier.
  const uncheckedChains = chains.filter((c) => c.status !== 'read' || !c.complete).map((c) => c.chain);
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
  return { label: 'Earliest funding found', value: `${when} on ${first.chain}${scope}, by ${who}`, source: 'Explorer' };
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
