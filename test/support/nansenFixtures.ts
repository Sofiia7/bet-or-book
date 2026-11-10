// The shapes of the Nansen answers recorded in September (test/fixtures/nansen/).
// Nothing in the Worker asks Nansen for anything any more; tests written
// against those recordings still describe their accounts with them - the
// positions every dex reports (test/support/positions.ts) and what a wallet
// holds on chain (test/support/onchain.ts) - so the shapes live here, with
// the tests, and nowhere in src/.

export interface NansenPosition {
  token_symbol: string;
  size: string;
  position_value_usd: string;
  entry_price_usd: string;
  liquidation_price_usd: string | null;
  leverage_value: number;
  leverage_type: string;
  margin_used_usd: string;
  unrealized_pnl_usd: string;
  cumulative_funding_since_open_usd: string;
  return_on_equity: string;
}

/** Nansen's perp-positions answer. */
export interface NansenPerpPositions {
  asset_positions: Array<{ position: NansenPosition; position_type: string }>;
  margin_summary_account_value_usd: string;
  withdrawable_usd: string;
  timestamp: number;
}

/** One row of Nansen's current-balance answer. */
export interface NansenBalance {
  chain: string;
  address: string;
  token_address: string;
  token_symbol: string;
  token_name: string;
  token_amount: number;
  price_usd: number;
  value_usd: number;
}

/** One row of Nansen's related-wallets answer. */
export interface NansenRelatedWallet {
  address: string;
  address_label: string | null;
  relation: string;
  transaction_hash: string;
  block_timestamp: string;
  order: number;
  chain: string;
}
