export type PositionSide = 'long' | 'short';

export interface Position {
  coin: string;
  side: PositionSide;
  sizeUsd: number;
  entryPx: number;
  leverage: number;
  liquidationPx: number | null;
  unrealizedPnlUsd: number;
  cumFundingUsd: number;
}

export interface RestingOrder {
  coin: string;
  side: 'bid' | 'ask';
  sizeUsd: number;
}

export interface SpotHolding {
  coin: string;
  valueUsd: number;
  /** Chain the holding lives on; absent for Hyperliquid's own spot balances. */
  chain?: string;
  /** Contract address, for on-chain balances. A ticker is a label anyone can
   * reuse, so this is what actually identifies the asset; absent for
   * Hyperliquid spot, whose tickers are its own namespace. */
  tokenAddress?: string;
}

export interface Trade {
  coin: string;
  timestamp: number;
  crossed: boolean;
  side: 'buy' | 'sell';
  closedPnlUsd: number;
  /** Notional of the fill. A count of fills says how often an account acts;
   * only the size says whether that activity is anywhere near the position
   * being asked about. */
  sizeUsd: number;
}

export type ServiceStatus = 'service' | 'not-service' | 'unverified';

export interface LinkedWallet {
  address: string;
  relation: string;
  chain: string;
  /** Whether the link points at an exchange, bridge or similar shared
   * service - following one would attribute other people's money. Nansen
   * sends no label for most addresses, and `unverified` keeps that gap
   * visible instead of reading silence as "a private wallet". */
  serviceStatus: ServiceStatus;
}

export interface PnlSummary {
  realizedPnlUsd: number;
  winRate: number;
  closedTrades: number;
  windowDays: number;
}
