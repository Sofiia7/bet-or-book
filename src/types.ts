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
}

export interface Trade {
  coin: string;
  timestamp: number;
  crossed: boolean;
  closedPnlUsd: number;
}
