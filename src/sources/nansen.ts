// Typed client for the Nansen endpoints Bet or Book uses. Types mirror the
// real responses in test/fixtures/nansen/ (scripts/fetch-nansen-fixtures.ts),
// not the docs alone - the docs and the live API name some fields
// differently. The key is passed in per client and never stored globally or
// put into an error message.
const BASE_URL = 'https://api.nansen.ai/api/v1';

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

export interface NansenPerpPositions {
  asset_positions: Array<{ position: NansenPosition; position_type: string }>;
  margin_summary_account_value_usd: string;
  withdrawable_usd: string;
  timestamp: number;
}

export interface NansenPnlSummary {
  top5_coins: Array<{
    coin: string;
    realized_pnl_usd: number;
    realized_roi: number;
    closed_trade_count: number;
    fees_usd: number;
  }>;
  traded_coin_count: number;
  traded_times: number;
  closed_trade_count: number;
  winning_trade_count: number;
  realized_pnl_usd: number;
  realized_pnl_percent: number;
  win_rate: number;
  fees_usd: number;
}

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

export interface NansenRelatedWallet {
  address: string;
  address_label: string | null;
  relation: string;
  transaction_hash: string;
  block_timestamp: string;
  order: number;
  chain: string;
}

export interface NansenCallMeta {
  path: string;
  status: number;
  creditsCost: number | null;
  creditsRemaining: number | null;
}

export type NansenCallRecorder = (meta: NansenCallMeta) => void | Promise<void>;

export interface NansenClient {
  perpPositions(address: string): Promise<NansenPerpPositions>;
  perpPnlSummary(address: string, fromDate: string, toDate: string): Promise<NansenPnlSummary>;
  /** `complete` is false when a full page came back and more holdings may exist. */
  currentBalance(address: string): Promise<{ rows: NansenBalance[]; complete: boolean }>;
  relatedWallets(address: string, chain: string): Promise<NansenRelatedWallet[]>;
}

interface Envelope<T> {
  data: T;
  pagination?: { is_last_page: boolean };
}

function headerNumber(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  return v === null ? null : Number(v);
}

export function createNansenClient(apiKey: string, record: NansenCallRecorder = () => {}): NansenClient {
  async function post<T>(path: string, body: Record<string, unknown>): Promise<Envelope<T>> {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
    });
    await record({
      path,
      status: res.status,
      creditsCost: headerNumber(res, 'x-nansen-credits-cost'),
      creditsRemaining: headerNumber(res, 'x-nansen-credits-remaining'),
    });
    if (!res.ok) {
      throw new Error(`nansen ${path} failed: ${res.status}`);
    }
    return (await res.json()) as Envelope<T>;
  }

  return {
    perpPositions: async (address) => (await post<NansenPerpPositions>('profiler/perp-positions', { address })).data,
    perpPnlSummary: async (address, fromDate, toDate) =>
      (await post<NansenPnlSummary>('profiler/perp-pnl-summary', { address, date: { from: fromDate, to: toDate } }))
        .data,
    currentBalance: async (address) => {
      const r = await post<NansenBalance[]>('profiler/address/current-balance', {
        address,
        chain: 'all',
        hide_spam_token: true,
        pagination: { page: 1, per_page: 100 },
      });
      return { rows: r.data, complete: r.pagination?.is_last_page ?? true };
    },
    relatedWallets: async (address, chain) =>
      (
        await post<NansenRelatedWallet[]>('profiler/address/related-wallets', {
          address,
          chain,
          pagination: { page: 1, per_page: 100 },
        })
      ).data,
  };
}
