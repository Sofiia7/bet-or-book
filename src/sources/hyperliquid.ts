const BASE_URL = 'https://api.hyperliquid.xyz/info';
/** Without a timeout a hanging response holds the check open for minutes;
 * failing fast lets the page say "try again shortly". */
const TIMEOUT_MS = 10_000;

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
  token: number;
  total: string;
  hold: string;
  entryNtl: string;
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
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: deadlineFor(signal),
  });
  if (!res.ok) {
    throw new Error(`hyperliquid ${String(body.type)} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getClearinghouseState(user: string, signal?: AbortSignal): Promise<HlClearinghouseState> {
  return postInfo<HlClearinghouseState>({ type: 'clearinghouseState', user }, signal);
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

export async function getPerpMetaAndAssetCtxs(signal?: AbortSignal): Promise<[HlPerpMeta, HlPerpAssetCtx[]]> {
  return postInfo<[HlPerpMeta, HlPerpAssetCtx[]]>({ type: 'metaAndAssetCtxs' }, signal);
}

export async function getUserFillsByTime(
  user: string,
  startTime: number,
  endTime: number,
  signal?: AbortSignal,
): Promise<HlFill[]> {
  return postInfo<HlFill[]>({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false }, signal);
}
