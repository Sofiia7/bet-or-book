const BASE_URL = 'https://api.hyperliquid.xyz/info';

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

async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`hyperliquid ${String(body.type)} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getClearinghouseState(user: string): Promise<HlClearinghouseState> {
  return postInfo<HlClearinghouseState>({ type: 'clearinghouseState', user });
}

export async function getOpenOrders(user: string): Promise<HlOpenOrder[]> {
  return postInfo<HlOpenOrder[]>({ type: 'frontendOpenOrders', user });
}

export async function getSpotBalances(user: string): Promise<{ balances: HlSpotBalance[] }> {
  return postInfo<{ balances: HlSpotBalance[] }>({ type: 'spotClearinghouseState', user });
}

export async function getSpotMeta(): Promise<[HlSpotMeta, HlSpotAssetCtx[]]> {
  return postInfo<[HlSpotMeta, HlSpotAssetCtx[]]>({ type: 'spotMetaAndAssetCtxs' });
}

export async function getPerpMetaAndAssetCtxs(): Promise<[HlPerpMeta, HlPerpAssetCtx[]]> {
  return postInfo<[HlPerpMeta, HlPerpAssetCtx[]]>({ type: 'metaAndAssetCtxs' });
}
