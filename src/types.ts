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

/** Which namespace a holding's ticker belongs to. Read from the endpoint
 * that produced the row rather than guessed from whether a contract address
 * happens to be present: a malformed on-chain row with no address used to
 * fall through to "this must be Hyperliquid spot" and be counted by name. */
export type HoldingSource = 'hyperliquid-spot' | 'onchain';

export interface SpotHolding {
  coin: string;
  /** USD value, or 0 when no price was found - see `priced`. */
  valueUsd: number;
  source: HoldingSource;
  /** False when the balance is real but no USD price could be put on it.
   * That is an unmeasured holding, not an empty one, and the two must not
   * both come out as zero. Absent means a price was established. */
  priced?: boolean;
  /** Units held, where the source reports them. Kept because an unpriced
   * balance still has a size, and "how much" is the first thing anyone asks
   * about one. */
  amount?: number;
  /** Hyperliquid's own token index. Spot names are not unique there, so the
   * index, not the name, is what a price belongs to. */
  tokenIndex?: number;
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
