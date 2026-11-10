import { chargeRequest, requestBudgetOf } from '../requestBudget';
import { RETRY_MAX_WAIT_MS, RETRY_STATUSES, pause, retryWaitMs } from './retry';

const BASE_URL = 'https://api.hyperliquid.xyz/info';
/** Without a timeout a hanging response holds the check open for minutes;
 * failing fast lets the page say "try again shortly". */
const TIMEOUT_MS = 10_000;
export async function getQuoteMid(coin: string, signal?: AbortSignal): Promise<number | null> {
  const raw = await postInfo<{ coin: string; time: number; levels: Array<Array<{ px: string }>> }>({ type: 'l2Book', coin }, signal);
  if (raw.coin !== coin || !Number.isFinite(raw.time) || Math.abs(Date.now() - raw.time) > 60_000) return null;
  const bid = Number(raw.levels?.[0]?.[0]?.px), ask = Number(raw.levels?.[1]?.[0]?.px);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid ? (bid + ask) / 2 : null;
}

export interface HlPosition {
  coin: string;
  szi: string;
  entryPx: string | null;
  leverage: { type: 'cross' | 'isolated'; value: number };
  liquidationPx: string | null;
  positionValue: string;
  unrealizedPnl: string;
  cumFunding: { allTime: string; sinceOpen: string; sinceChange: string };
  marginUsed: string;
  maxLeverage: number;
  returnOnEquity: string;
}

export interface HlClearinghouseState {
  assetPositions: Array<{ position: HlPosition; type: string }>;
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  withdrawable: string;
  time: number;
}

export interface HlOpenOrder {
  coin: string;
  side: 'B' | 'A';
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  reduceOnly: boolean;
  isTrigger: boolean;
  orderType: string;
}

export interface HlSpotBalance {
  coin: string;
  /** Absent on some rows in real answers (recorded fixtures carry several):
   * a balance with no index cannot be priced, and is kept as unpriced. */
  token?: number;
  /** Negative for a borrowed token under portfolio margin. */
  total: string;
  hold: string;
  entryNtl: string;
  /** Hyperliquid portfolio margin, seen live on 24.09: how much of this
   * token is lent to the account, how much the account has pledged, and the
   * loan-to-value it is allowed against it. */
  borrowed?: string;
  supplied?: string;
  ltv?: string;
}

/**
 * One trading pair's live stats from spotMetaAndAssetCtxs. `coin` is the
 * pair's own display name (e.g. "PURR/USDC", or "@1" for a non-canonical
 * pair) - it is what ties a context back to a `HlSpotMeta.universe` entry,
 * since the two arrays are not reliably the same length (the context array
 * also carries delisted pairs, confirmed against a live response captured
 * 2026-09-17: 845 contexts for 328 active universe entries).
 */
export interface HlSpotAssetCtx {
  coin: string;
  dayNtlVlm: string;
  markPx: string;
  midPx: string | null;
  prevDayPx: string;
}

export interface HlSpotMeta {
  tokens: Array<{ name: string; index: number }>;
  universe: Array<{ name: string; tokens: [number, number] }>;
}

export interface HlPerpAssetCtx {
  dayNtlVlm: string;
  funding: string;
  markPx: string;
  midPx: string | null;
  openInterest: string;
  oraclePx: string;
  prevDayPx: string;
  premium: string | null;
}

export interface HlPerpMeta {
  universe: Array<{ name: string; maxLeverage: number }>;
}

export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: 'B' | 'A';
  time: number;
  closedPnl: string;
  crossed: boolean;
  fee: string;
  oid: number;
  tid: number;
  /** "Open Long" / "Close Short" / "Buy" and their siblings. Hyperliquid's
   * own vocabulary, not a closed enum this tool controls, so it is read as
   * a plain string and only ever matched by an "Open"/"Close" prefix. */
  dir: string;
}

/** This call's own timeout, plus whatever deadline the whole check runs
 * under: a request still in flight when the check runs out of time is one
 * whose answer the reader will never see. */
function deadlineFor(signal?: AbortSignal): AbortSignal {
  const own = AbortSignal.timeout(TIMEOUT_MS);
  return signal === undefined ? own : AbortSignal.any([own, signal]);
}

async function postInfo<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: deadlineFor(signal),
    });
  chargeRequest(signal, 'hyperliquid');
  let res = await send();
  // One retry, only while the check still has time left: a second request
  // after the deadline would answer nobody.
  // The retry is a request like any other: it is sent only when the check's
  // budget affords it, and charged.
  if (!res.ok && RETRY_STATUSES.has(res.status) && !signal?.aborted && (requestBudgetOf(signal)?.affords(1) ?? true)) {
    const wait = retryWaitMs(res);
    if (wait <= RETRY_MAX_WAIT_MS) {
      await res.body?.cancel().catch(() => {});
      await pause(wait, signal);
      if (!signal?.aborted) {
        chargeRequest(signal, 'hyperliquid');
        res = await send();
      }
    }
  }
  if (!res.ok) {
    throw new Error(`hyperliquid ${String(body.type)} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** `dex` names a HIP-3 perp dex ("xyz"); empty or absent asks for the main
 * dex, which Hyperliquid answers when the field is left out. */
export async function getClearinghouseState(user: string, signal?: AbortSignal, dex?: string): Promise<HlClearinghouseState> {
  return postInfo<HlClearinghouseState>({ type: 'clearinghouseState', user, ...(dex ? { dex } : {}) }, signal);
}

/** Resting orders. Without `dex` Hyperliquid answers for one perp dex and
 * spot, which is not the whole account once HIP-3 markets are in play: those
 * live on their own dexes and have to be asked for by name. */
export async function getOpenOrders(user: string, dex?: string, signal?: AbortSignal): Promise<HlOpenOrder[]> {
  return postInfo<HlOpenOrder[]>(
    dex === undefined ? { type: 'frontendOpenOrders', user } : { type: 'frontendOpenOrders', user, dex },
    signal,
  );
}

/** The dex part of a HIP-3 market name ("xyz:SP500" -> "xyz"), or null for a
 * market on the main perp dex. */
export function dexOf(coin: string): string | null {
  const at = coin.indexOf(':');
  return at > 0 ? coin.slice(0, at) : null;
}

export async function getSpotBalances(user: string, signal?: AbortSignal): Promise<{ balances: HlSpotBalance[] }> {
  return postInfo<{ balances: HlSpotBalance[] }>({ type: 'spotClearinghouseState', user }, signal);
}

export async function getSpotMeta(signal?: AbortSignal): Promise<[HlSpotMeta, HlSpotAssetCtx[]]> {
  return postInfo<[HlSpotMeta, HlSpotAssetCtx[]]>({ type: 'spotMetaAndAssetCtxs' }, signal);
}

export async function getPerpMetaAndAssetCtxs(signal?: AbortSignal, dex?: string): Promise<[HlPerpMeta, HlPerpAssetCtx[]]> {
  return postInfo<[HlPerpMeta, HlPerpAssetCtx[]]>({ type: 'metaAndAssetCtxs', ...(dex ? { dex } : {}) }, signal);
}

export async function getPerpDexRegistry(signal?: AbortSignal): Promise<unknown> {
  return postInfo<unknown>({ type: 'perpDexs' }, signal);
}

/** The named perp dexes in a `perpDexs` answer, in registry order (the main
 * dex, the registry's `null` entry, is not one of them). Reads only the names:
 * the registry's other fields are not needed to ask a dex for positions, and
 * one odd field on one venue must not make every reading partial. A list that
 * cannot be read throws rather than coming back shorter, since a missing dex
 * would be a missing position. */
export function dexNamesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('hyperliquid perpDexs: not a list');
  const names: string[] = [];
  for (const entry of raw) {
    if (entry === null) continue;
    const name = typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(name)) {
      throw new Error('hyperliquid perpDexs: invalid dex name');
    }
    names.push(name);
  }
  // A registry with no named dex is not a registry read: HIP-3 dexes exist, so
  // an answer without one would pass for a complete read of the main dex only.
  if (names.length === 0) throw new Error('hyperliquid perpDexs: no named dex');
  return names;
}

/** One period of `portfolio`: cumulative account value and PnL since the
 * period's start, as `[timestampMs, "decimal string"]` points, and volume. */
export interface HlPortfolioPeriod {
  accountValueHistory: Array<[number, string]>;
  pnlHistory: Array<[number, string]>;
  vlm: string;
}

/** The account's value and PnL over time, for `day, week, month, allTime` and
 * the same four for perps alone (`perpDay` ... `perpAllTime`): a list of
 * `[period, history]` pairs. One request. */
export async function getPortfolio(user: string, signal?: AbortSignal): Promise<Array<[string, HlPortfolioPeriod]>> {
  return postInfo<Array<[string, HlPortfolioPeriod]>>({ type: 'portfolio', user }, signal);
}

export async function getUserFillsByTime(
  user: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<HlFill[]> {
  return postInfo<HlFill[]>({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false }, signal);
}
