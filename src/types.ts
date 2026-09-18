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
}

export interface Trade {
  coin: string;
  timestamp: number;
  crossed: boolean;
  closedPnlUsd: number;
}

export interface LinkedWallet {
  address: string;
  relation: string;
  chain: string;
  /** True when the link points at an exchange, bridge or similar shared
   * service - following it would attribute other people's money. */
  isSharedService: boolean;
}

export interface PnlSummary {
  realizedPnlUsd: number;
  winRate: number;
  closedTrades: number;
  windowDays: number;
}
