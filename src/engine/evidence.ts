import type {
  PositionFeatures,
  OrderFeatures,
  HedgeFeatures,
  HedgeScope,
  LinkedHedgeFeatures,
  TradeFeatures,
} from './features';
import { DEFAULT_THRESHOLDS, type VerdictResult } from './verdict';
import type { PnlSummary } from '../types';

export type EvidenceSource = 'Nansen' | 'Hyperliquid';

/** One number on the card, with the source that produced it. */
export interface EvidenceItem {
  label: string;
  value: string;
  source: EvidenceSource;
}

export interface EvidenceInput {
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

/** Linked wallets that actually hold the headline asset. */
function matchingFunders(linked: LinkedHedgeFeatures | null): number {
  return linked ? linked.funders.filter((f) => f.matchingUsd > 0).length : 0;
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
    clauses.push(`${fillsText(t)} fills in the last 24 hours, ${formatPct(1 - t.crossedShare)} of them as maker`);
  }
  return `${clauses.join('; ')}. There is nothing to copy.`;
}

function hedgedSummary(input: EvidenceInput): string {
  const { positions: p, hedge: h } = input;
  const reason = input.verdict.reasons[0];
  if (reason === 'balanced_book') {
    return `${plural(p.nPositions, 'position')} net out to ${formatPct(p.netToGross)} of gross exposure: the longs and shorts offset each other.`;
  }
  if (reason === 'linked_wallet_hedge') {
    const total = h.hedgeRatio + (input.linkedHedge?.linkedHedgeRatio ?? 0);
    const k = matchingFunders(input.linkedHedge);
    const holders = k === 1 ? 'a wallet' : `${count(k)} wallets`;
    return (
      `The ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} short is ${formatPct(total)} covered by ` +
      `${p.headlineCoin} held in ${holders} that funded this account. ` +
      'Ownership is inferred from the funding link, not confirmed.'
    );
  }
  const where = input.hedgeScope === 'all-chains' ? 'across chains' : 'on Hyperliquid';
  return (
    `The ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} short is ${formatPct(h.hedgeRatio)} covered by ` +
    `spot ${p.headlineCoin} held by the same account ${where}.`
  );
}

function betSummary(input: EvidenceInput): string {
  const { positions: p } = input;
  const opening = `${formatPct(p.headlineShare)} of the exposure is one ${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} ${p.headlineSide}`;
  if (p.headlineSide !== 'short') return `${opening}, and nothing in this account offsets it.`;
  const where = input.linkedHedge
    ? 'in this account or the wallets that funded it'
    : input.hedgeScope === 'all-chains'
      ? 'in this account on any chain'
      : 'in this account on Hyperliquid';
  const total = input.hedge.hedgeRatio + (input.linkedHedge?.linkedHedgeRatio ?? 0);
  if (total === 0) return `${opening}, and no ${p.headlineCoin} was found ${where}.`;
  return `${opening}, and only ${formatPct(total)} of it is covered by ${p.headlineCoin} ${where}.`;
}

/** Names each bet condition the account fails, in the order the rule lists them. */
function undecidedSummary(input: EvidenceInput): string {
  const { positions: p, orders: o } = input;
  const b = DEFAULT_THRESHOLDS.bet;
  const total = input.hedge.hedgeRatio + (input.linkedHedge?.linkedHedgeRatio ?? 0);
  const misses: string[] = [];
  if (p.nPositions > b.maxPositions) misses.push(plural(p.nPositions, 'position'));
  if (p.netToGross < b.minNetToGross) misses.push(`net ${formatPct(p.netToGross)} of gross`);
  if (p.headlineShare < b.minHeadlineShare) misses.push(`largest position ${formatPct(p.headlineShare)} of exposure`);
  if (total >= b.maxHedgeRatio) misses.push(`${formatPct(total)} hedged`);
  if (o.coinsBothSides > 0) misses.push(`two-sided quotes in ${plural(o.coinsBothSides, 'market')}`);
  const head = 'Not a book, not hedged, and not a clean bet';
  return misses.length > 0 ? `${head}: ${misses.join(', ')}.` : `${head}.`;
}

function hedgeItem(input: EvidenceInput): EvidenceItem | null {
  if (input.hedgeScope === 'none') return null;
  const k = matchingFunders(input.linkedHedge);
  if (input.linkedHedge && k > 0) {
    const total = input.hedge.hedgeRatio + input.linkedHedge.linkedHedgeRatio;
    return { label: 'Hedge found', value: `${formatPct(total)} via ${plural(k, 'funding wallet')}`, source: 'Nansen' };
  }
  if (input.hedgeScope === 'all-chains') {
    return { label: 'Hedge found', value: `${formatPct(input.hedge.hedgeRatio)} (all chains)`, source: 'Nansen' };
  }
  return { label: 'Hedge found', value: `${formatPct(input.hedge.hedgeRatio)} (Hyperliquid spot)`, source: 'Hyperliquid' };
}

function pnlItem(pnl: PnlSummary | null): EvidenceItem | null {
  return pnl ? { label: `Realized PnL, ${pnl.windowDays}d`, value: formatUsd(pnl.realizedPnlUsd), source: 'Nansen' } : null;
}

export function explain(input: EvidenceInput): Explanation {
  const { positions: p, orders: o } = input;
  const posSource: EvidenceSource = input.source === 'nansen' ? 'Nansen' : 'Hyperliquid';
  const present = (items: Array<EvidenceItem | null>) =>
    items.filter((i): i is EvidenceItem => i !== null).slice(0, MAX_EVIDENCE);

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

  const summary =
    input.verdict.verdict === 'hedged'
      ? hedgedSummary(input)
      : input.verdict.verdict === 'looks_like_a_bet'
        ? betSummary(input)
        : undecidedSummary(input);
  return {
    summary,
    evidence: present([
      { label: 'Largest position', value: headlineText(p), source: posSource },
      { label: 'Share of exposure', value: formatPct(p.headlineShare), source: posSource },
      { label: 'Net / gross exposure', value: formatPct(p.netToGross), source: posSource },
      hedgeItem(input),
      pnlItem(input.pnl),
      input.sizeVsOi === null
        ? null
        : { label: 'Size vs open interest', value: formatPct(input.sizeVsOi), source: 'Hyperliquid' },
    ]),
  };
}
