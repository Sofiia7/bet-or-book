import type {
  PositionFeatures,
  OrderFeatures,
  HedgeFeatures,
  HedgeScope,
  HedgeCoverage,
  LinkedHedgeFeatures,
  TradeFeatures,
} from './features';
import { DEFAULT_THRESHOLDS, type VerdictResult } from './verdict';
import type { PnlSummary } from '../types';

export type EvidenceSource = 'Nansen' | 'Hyperliquid' | 'Nansen + Hyperliquid';

/** One number on the card, with the source that produced it. */
export interface EvidenceItem {
  label: string;
  value: string;
  source: EvidenceSource;
  /** The row the verdict actually turned on. A shared image has room for
   * four columns and used to take the first four, which for the Abraxas
   * card left out the one that decided it (audit U01). */
  decisive?: boolean;
}

export interface EvidenceInput {
  verdict: VerdictResult;
  positions: PositionFeatures;
  orders: OrderFeatures;
  hedge: HedgeFeatures;
  hedgeScope: HedgeScope;
  hedgeCoverage: HedgeCoverage;
  linkedHedge: LinkedHedgeFeatures | null;
  trades: TradeFeatures;
  pnl: PnlSummary | null;
  sizeVsOi: number | null;
  source: 'nansen' | 'hyperliquid';
}

export interface Explanation {
  /** One sentence built from the numbers that decided the verdict. */
  summary: string;
  /** At most five items; anything whose data is missing is left out. */
  evidence: EvidenceItem[];
}

const MAX_EVIDENCE = 5;

export function formatUsd(n: number): string {
  const a = Math.abs(n);
  if (a < 0.5) return '$0';
  const sign = n < 0 ? '-' : '';
  if (a >= 999_950_000) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 999_500) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 999.5) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

export function formatPct(x: number): string {
  const p = x * 100;
  if (p === 0) return '0%';
  return `${Math.abs(p) >= 10 ? Math.round(p) : p.toFixed(1)}%`;
}

function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function plural(n: number, word: string): string {
  return `${count(n)} ${word}${n === 1 ? '' : 's'}`;
}

function headlineText(p: PositionFeatures): string {
  return `${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} ${p.headlineSide}`;
}

function fillsText(t: TradeFeatures): string {
  return `${count(t.sampleSize)}${t.cappedByApiLimit ? '+' : ''}`;
}

/** How long the fills actually cover. Two thousand of them can land inside
 * a few minutes, so "in the last 24 hours" would be the window that was
 * asked for, not the window that was seen. Entries written before this was
 * measured fall back to the window. */
function spanText(t: TradeFeatures): string {
  return typeof t.spanHours === 'number' && Number.isFinite(t.spanHours) && t.spanHours > 0
    ? `over ${t.spanHours.toFixed(1)} hours`
    : 'in the last 24 hours';
}

/** Busy is not the same as making a market in the position being asked
 * about, and the fill count alone cannot tell them apart. */
function makerFlowSummary(input: EvidenceInput): string {
  const { positions: p, trades: t } = input;
  const share =
    typeof t.headlineShareOfFills === 'number' && Number.isFinite(t.headlineShareOfFills)
      ? `, ${formatPct(t.headlineShareOfFills)} of them in ${p.headlineCoin}`
      : '';
  return (
    `${fillsText(t)} fills ${spanText(t)}, ${formatPct(t.buyShare)} buys and ` +
    `${formatPct(1 - t.crossedShare)} as maker${share}. That is a busy account, but nothing here shows ` +
    `the ${headlineText(p)} is inventory rather than a position.`
  );
}

/** A funding wallet counts as holding the hedge from 1% of the headline up:
 * "via 2 funding wallets" should not stand for one wallet and $1 of dust. */
const MIN_FUNDER_SHARE = 0.01;

/** Linked wallets that hold a meaningful amount of the headline asset. */
function matchingFunders(linked: LinkedHedgeFeatures | null, headlineNotionalUsd: number): number {
  if (!linked) return 0;
  return linked.funders.filter((f) => f.matchingUsd > 0 && f.matchingUsd >= MIN_FUNDER_SHARE * headlineNotionalUsd)
    .length;
}

function bookSummary(input: EvidenceInput): string {
  const { positions: p, orders: o, trades: t } = input;
  const clauses: string[] = [];
  if (input.verdict.reasons.includes('positions')) {
    clauses.push(`${plural(p.nPositions, 'open position')} net out to ${formatPct(p.netToGross)} of gross exposure`);
  }
  if (input.verdict.reasons.includes('orders')) {
    clauses.push(`${plural(o.restingOrders, 'resting order')} quote both sides of ${plural(o.coinsBothSides, 'market')}`);
  }
  if (input.verdict.reasons.includes('trades')) {
    clauses.push(
      `${fillsText(t)} fills ${spanText(t)}, ${formatPct(t.buyShare)} of them buys, ${formatPct(1 - t.crossedShare)} as maker`,
    );
  }
  // No "there is nothing to copy": what this account is doing is described,
  // and whether to copy it is the reader's call, not a finding.
  return `${clauses.join('; ')}.`;
}

function hedgedSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h } = input;
  const reason = input.verdict.reasons[0];
  if (reason === 'balanced_book') {
    return (
      `${plural(p.nPositions, 'position')} net out to ${formatPct(p.netToGross)} of gross exposure, ` +
      `and ${formatPct(p.sameAssetOffsetShare)} of it cancels within the same assets.`
    );
  }
  return (
    `The ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} short is ${formatPct(h.hedgeRatio)} covered by ` +
    `${formatUsd(h.hedgeUsd)} of spot ${p.headlineCoin} held by this address ${holdingsScope(input)}.` +
    lendingCaveat(input)
  );
}

/** Where the account's own holdings were looked for. "All chains" is what
 * was asked for, not what can be read back: the contract registry covers two
 * of them, so the honest phrase names the source rather than the universe. */
function holdingsScope(input: EvidenceInput): string {
  return input.hedgeScope === 'all-chains' ? 'on Nansen-supported chains' : 'on Hyperliquid';
}

/** What a lending deposit inside the counted leg forces the sentence to add.
 * A deposit receipt is a real balance and a possible loan at the same time,
 * and no endpoint read here shows the debt. */
function lendingCaveat(input: EvidenceInput, share = 0.1): string {
  const h = input.hedge;
  const lending = h.lendingUsd ?? 0;
  if (h.hedgeUsd <= 0 || lending < share * h.hedgeUsd) return '';
  return (
    ` ${formatUsd(lending)} of that sits in a lending market, and anything borrowed against it is ` +
    'not read here, so this is visible coverage rather than a net position.'
  );
}

/** Coverage short of a hedge: what is left over is still a position. 59% of
 * a $7.2M short leaves $2.9M short. */
function partialOffsetSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h } = input;
  return (
    `The ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} short is ${formatPct(h.hedgeRatio)} covered by ` +
    `spot ${p.headlineCoin} held by this address ${holdingsScope(input)}, ` +
    `which leaves ${formatUsd(p.headlineNotionalUsd - h.hedgeUsd)} of it short.`
  );
}

/** Coverage past parity: the spot leg is the larger one, so the account is
 * long the asset its headline position is short. */
function overCoveredSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h } = input;
  return (
    `The ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} short is more than covered: ` +
    `${formatUsd(h.hedgeUsd)} of spot ${p.headlineCoin} held by this address ${holdingsScope(input)} ` +
    `leaves it net long ${formatUsd(h.hedgeUsd - p.headlineNotionalUsd)} of ${p.headlineCoin}.`
  );
}

/** A book whose dollars net out without its legs cancelling: the balance is
 * a property of the portfolio, not protection for any one position in it. */
function mixedBookSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  const head = `${plural(p.nPositions, 'position')} net out to ${formatPct(p.netToGross)} of gross exposure`;
  const detail =
    p.sameAssetOffsetShare > 0
      ? `only ${formatPct(p.sameAssetOffsetShare)} of that exposure cancels within one asset`
      : 'the long and short legs are in different assets';
  return `${head}, but ${detail}: a dollar balance across different assets is a portfolio, not a hedge.`;
}

/** Scanned before the offset was measured: the gap is stated, not filled in. */
function unmeasuredOffsetSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  return (
    `${plural(p.nPositions, 'position')} net out to ${formatPct(p.netToGross)} of gross exposure, ` +
    'but this snapshot did not record which assets the legs are in, ' +
    'so whether they offset each other was not established.'
  );
}

/** Matching assets sitting in a wallet that funded the account. Reported as
 * what it is - someone else's address holding the same asset - and kept out
 * of the account's own coverage number. */
function linkedSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h, linkedHedge } = input;
  const k = matchingFunders(linkedHedge, p.headlineNotionalUsd);
  const holders = k === 1 ? '1 wallet that funded it holds' : `${count(k)} wallets that funded it hold`;
  // Below the dust threshold a percentage renders as "0.0%", which reads as
  // a measurement rather than as "next to nothing".
  const own =
    h.hedgeRatio >= MIN_FUNDER_SHARE
      ? `${p.headlineCoin} at this address covers ${formatPct(h.hedgeRatio)} of the ${headlineText(p)}.`
      : h.hedgeRatio > 0
        ? `Less than 1% of the ${headlineText(p)} is covered by ${p.headlineCoin} at this address.`
        : `No ${p.headlineCoin} at this address offsets the ${headlineText(p)}.`;
  return (
    `${own} ${holders} ${formatUsd(linkedHedge?.linkedHedgeUsd ?? 0)} of ${p.headlineCoin}, ` +
    'but funding does not establish ownership, so it is not counted as a hedge.'
  );
}

/** A directional stance spread over several positions rather than sitting
 * in one. The bet rule's own sentence names "one $X position"; here the
 * finding is the portfolio's direction, so the spread leads and the largest
 * leg is named second. */
function directionalPortfolioSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  const head =
    `${plural(p.nPositions, 'open position')}, all pointing the same way, net out to ` +
    `${formatPct(p.netToGross)} of gross exposure`;
  const largest = `the largest is ${headlineText(p)} (${formatPct(p.headlineShare)} of it)`;
  if (p.headlineSide !== 'short') {
    return `${head}; ${largest}. No two-sided quoting. Spot cannot offset a long, and debts or other derivatives are not read here.`;
  }
  const where = input.hedgeScope === 'all-chains' ? 'at this address on Nansen-supported chains' : 'at this address on Hyperliquid';
  const own = input.hedge.hedgeRatio;
  const cov =
    own === 0
      ? `no ${p.headlineCoin} was found ${where}`
      : `only ${formatPct(own)} of it is covered by ${p.headlineCoin} ${where}`;
  return `${head}; ${largest}. No two-sided quoting, and ${cov}. Debts and other derivatives are not read here.`;
}

function betSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  const opening = `${formatPct(p.headlineShare)} of the exposure is one ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} ${p.headlineSide}`;
  // Only spot holdings of the same asset are read here. Debts, other
  // derivatives and positions on venues this tool does not see could all
  // stand against a long, so the sentence says what was looked at.
  if (p.headlineSide !== 'short')
    return `${opening}. Spot cannot offset a long, and debts or other derivatives are not read here.`;
  // Only what this account holds. A funding wallet's balance belongs to
  // whoever owns that wallet, and the link does not say who that is; it gets
  // its own row rather than being folded into the account's coverage.
  const where =
    input.hedgeScope === 'all-chains' ? 'at this address on Nansen-supported chains' : 'at this address on Hyperliquid';
  const own = input.hedge.hedgeRatio;
  const caveat = ' Debts and other derivatives are not read here.';
  if (own === 0) return `${opening}, and no ${p.headlineCoin} was found ${where}.${caveat}`;
  return `${opening}, and only ${formatPct(own)} of it is covered by ${p.headlineCoin} ${where}.${caveat}`;
}

/** Names each bet condition the account fails, in the order the rule lists them. */
function undecidedSummary(input: EvidenceInput): string {
  const { positions: p, orders: o } = input;
  const b = DEFAULT_THRESHOLDS.bet;
  const total = input.hedge.hedgeRatio;
  const misses: string[] = [];
  if (p.nPositions > b.maxPositions) misses.push(plural(p.nPositions, 'position'));
  if (p.netToGross < b.minNetToGross) misses.push(`net ${formatPct(p.netToGross)} of gross`);
  if (p.headlineShare < b.minHeadlineShare) misses.push(`largest position ${formatPct(p.headlineShare)} of exposure`);
  if (total >= b.maxHedgeRatio) misses.push(`${formatPct(total)} hedged`);
  if (o.coinsBothSides > 0) misses.push(`two-sided quotes in ${plural(o.coinsBothSides, 'market')}`);
  // Naming the position matters more now that the reader can choose which
  // one to ask about: "not a clean bet" with no subject is an answer to a
  // question they may not have asked.
  const head = `The ${headlineText(p)} is not a book, not hedged, and not a clean bet`;
  return misses.length > 0 ? `${head}: ${misses.join(', ')}.` : `${head}.`;
}

/**
 * Who produced the counted dollars, rather than who was asked.
 *
 * Having called Nansen is not the same as Nansen having found this: in all
 * seven of the 18.09 "hedged" cards the underlying was HYPE, which
 * Hyperliquid's own spot endpoint reports for free. Entries written before
 * the split was recorded fall back to the scope, which is what they knew.
 */
function hedgeSource(input: EvidenceInput): EvidenceSource {
  const by = input.hedge.hedgeUsdBySource;
  // Nothing counted, or an entry from before the split was recorded: the
  // scope is all that is known about where the search happened.
  if (!by || (by.onchain <= 0 && by.hyperliquidSpot <= 0)) {
    return input.hedgeScope === 'all-chains' ? 'Nansen' : 'Hyperliquid';
  }
  if (by.onchain > 0 && by.hyperliquidSpot > 0) return 'Nansen + Hyperliquid';
  if (by.onchain > 0) return 'Nansen';
  return 'Hyperliquid';
}

function hedgeItem(input: EvidenceInput): EvidenceItem | null {
  if (input.hedgeScope === 'none') return null;
  const where = input.hedgeScope === 'all-chains' ? 'Nansen-supported chains' : 'Hyperliquid spot';
  return {
    label: 'Hedge found',
    value: `${formatPct(input.hedge.hedgeRatio)} (${where})`,
    source: hedgeSource(input),
  };
}

function linkedItem(input: EvidenceInput): EvidenceItem | null {
  const { linkedHedge, positions: p } = input;
  const k = matchingFunders(linkedHedge, p.headlineNotionalUsd);
  if (!linkedHedge || k === 0) return null;
  return {
    label: 'Linked wallets',
    value: `${formatUsd(linkedHedge.linkedHedgeUsd)} ${p.headlineCoin} in ${plural(k, 'wallet')}, owner unconfirmed`,
    source: 'Nansen',
  };
}

/** A gap in the reading, stated as one. Which gap it was matters: a failed
 * request and a deliberately cheaper check are not the same thing. */
function hedgeNotCheckedSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  const why =
    input.hedgeCoverage === 'missing'
      ? 'the read of its holdings on other chains failed'
      : input.hedgeScope === 'all-chains'
        ? 'only the first page of its holdings could be read'
        : 'only its Hyperliquid balances were read, and a hedge on another chain would not show';
  const found =
    input.hedge.hedgeUsd > 0
      ? ` At least ${formatUsd(input.hedge.hedgeUsd)} of matching spot was found, which is a floor on the ` +
        'coverage rather than a measurement of it.'
      : '';
  return (
    `${formatPct(p.headlineShare)} of the exposure is one ${headlineText(p)}, ` +
    `and whether it is hedged could not be established: ${why}.${found}`
  );
}

/** Holdings that were read but could not be tied to an asset. The dollars
 * are real; what they are is not settled, so neither is the coverage. */
function unrecognisedAssetsSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h } = input;
  const unpriced =
    (h.unpricedMatches ?? 0) > 0
      ? ` ${plural(h.unpricedMatches, 'matching balance')} had no price, so their size is unknown.`
      : '';
  const named =
    h.unverifiedUsd > 0
      ? `${formatUsd(h.unverifiedUsd)} of holdings named like ${p.headlineCoin} are in tokens or on chains ` +
        'this tool could not identify'
      : 'Some holdings could not be identified';
  return (
    `${named}, so whether the ${headlineText(p)} is offset is not established. ` +
    `Coverage confirmed so far: ${formatPct(h.hedgeRatio)}.${unpriced}`
  );
}

/** A spread wide enough to look like a book, with nothing quoted to say so. */
function diversifiedNoQuotesSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  return (
    `${plural(p.nPositions, 'open position')} net out to ${formatPct(p.netToGross)} of gross exposure, ` +
    'which is the shape of a book - but there is no two-sided quoting behind it, so whether the ' +
    `${headlineText(p)} is inventory or a position of its own is not established.`
  );
}

/** The bet rule asserts the account quotes nothing, and one of the venues it
 * could be quoting on would not answer. */
function quotesNotCheckedSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  return (
    `${formatPct(p.headlineShare)} of the exposure is one ${headlineText(p)}, but the resting orders ` +
    'of this account could not be read in full, so whether it quotes both sides of this market is unknown.'
  );
}

/** Positions came from the main perp dex alone, so concentration across the
 * whole portfolio is not something this reading can establish. */
function positionsNotCompleteSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  return (
    `Of what could be read, ${formatPct(p.headlineShare)} of the exposure is one ${headlineText(p)} - ` +
    'but only the main perp dex was read, and a HIP-3 position would not appear here, ' +
    'so this is not the whole portfolio.'
  );
}

/** Each reason a verdict can be withheld for says something specific; the
 * generic "not enough evidence" sentence is the fallback, not the rule. */
const SUMMARY_BY_REASON: Record<string, ((input: EvidenceInput) => string) | undefined> = {
  linked_exposure_unverified: linkedSummary,
  mixed_long_short_book: mixedBookSummary,
  offset_not_measured: unmeasuredOffsetSummary,
  hedge_not_checked: hedgeNotCheckedSummary,
  unrecognised_assets: unrecognisedAssetsSummary,
  diversified_book_no_quotes: diversifiedNoQuotesSummary,
  quotes_not_checked: quotesNotCheckedSummary,
  positions_not_complete: positionsNotCompleteSummary,
  maker_flow_only: makerFlowSummary,
  partial_offset: partialOffsetSummary,
  over_covered: overCoveredSummary,
  directional_portfolio: directionalPortfolioSummary,
};

function pnlItem(pnl: PnlSummary | null): EvidenceItem | null {
  if (!pnl) return null;
  const value = pnl.closedTrades === 0 ? 'no closed trades' : formatUsd(pnl.realizedPnlUsd);
  return { label: `Realized PnL, ${pnl.windowDays}d`, value, source: 'Nansen' };
}

/**
 * The label of the row this verdict actually turns on, so a shared image
 * carries it however far down the list it falls. The reasons map to what was
 * read: a hedge reason is about the coverage row, an unverified funding link
 * is about the funders row, and everything else rests on the position.
 */
const DECISIVE_LABEL_BY_REASON: Record<string, string> = {
  hedge_leg: 'Hedge found',
  partial_offset: 'Hedge found',
  over_covered: 'Hedge found',
  hedge_not_checked: 'Hedge found',
  unrecognised_assets: 'Hedge found',
  linked_exposure_unverified: 'Linked wallets',
  orders: 'Resting orders',
  maker_flow_only: 'Fills, last 24h',
  directional_portfolio: 'Net / gross exposure',
};

function markDecisive(items: EvidenceItem[], reasons: string[]): EvidenceItem[] {
  const label = reasons.map((r) => DECISIVE_LABEL_BY_REASON[r]).find((l) => l !== undefined);
  const chosen = items.find((i) => i.label === label) ?? items[0];
  return items.map((i) => (i === chosen ? { ...i, decisive: true } : i));
}

export function explain(input: EvidenceInput): Explanation {
  const { positions: p, orders: o } = input;
  const posSource: EvidenceSource = input.source === 'nansen' ? 'Nansen' : 'Hyperliquid';
  const present = (items: Array<EvidenceItem | null>) =>
    markDecisive(items.filter((i): i is EvidenceItem => i !== null), input.verdict.reasons).slice(0, MAX_EVIDENCE);

  if (p.nPositions === 0) {
    return {
      summary: 'No open positions right now, so there is nothing to classify.',
      evidence: present([{ label: 'Open positions', value: '0', source: posSource }, pnlItem(input.pnl)]),
    };
  }

  if (input.verdict.verdict === 'book') {
    return {
      summary: bookSummary(input),
      evidence: present([
        { label: 'Open positions', value: count(p.nPositions), source: posSource },
        { label: 'Net / gross exposure', value: formatPct(p.netToGross), source: posSource },
        {
          label: 'Resting orders',
          value: count(o.restingOrders) + (o.coinsBothSides > 0 ? `, two-sided in ${plural(o.coinsBothSides, 'market')}` : ''),
          source: 'Hyperliquid',
        },
        { label: 'Fills, last 24h', value: fillsText(input.trades), source: 'Hyperliquid' },
        pnlItem(input.pnl),
      ]),
    };
  }

  const byReason = input.verdict.reasons.map((r) => SUMMARY_BY_REASON[r]).find((fn) => fn !== undefined);
  const summary =
    input.verdict.verdict === 'hedged'
      ? hedgedSummary(input)
      : input.verdict.verdict === 'looks_like_a_bet'
        ? (byReason ?? betSummary)(input)
        : byReason
          ? byReason(input)
          : undecidedSummary(input);
  return {
    summary,
    evidence: present([
      { label: 'Largest position', value: headlineText(p), source: posSource },
      { label: 'Share of exposure', value: formatPct(p.headlineShare), source: posSource },
      { label: 'Net / gross exposure', value: formatPct(p.netToGross), source: posSource },
      hedgeItem(input),
      linkedItem(input),
      pnlItem(input.pnl),
      input.sizeVsOi === null
        ? null
        : { label: 'Size vs open interest', value: formatPct(input.sizeVsOi), source: 'Hyperliquid' },
    ]),
  };
}
