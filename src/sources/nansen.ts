// Typed client for the Nansen endpoints Bet or Book uses. Types mirror the
// real responses in test/fixtures/nansen/ (scripts/fetch-nansen-fixtures.ts),
// not the docs alone - the docs and the live API name some fields
// differently. The key is passed in per client and never stored globally or
// put into an error message.
const BASE_URL = 'https://api.nansen.ai/api/v1';
/** A timed-out call may still be charged; it fails one read, and the check
 * says what it could not read instead of hanging. */
const TIMEOUT_MS = 20_000;

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
  relatedWallets(address: string, chain: string): Promise<{ rows: NansenRelatedWallet[]; complete: boolean }>;
}

interface Envelope<T> {
  data: T;
  pagination?: { is_last_page: boolean };
}

function headerNumber(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  return v === null ? null : Number(v);
}

const PAGE_SIZE = 100;

/** Nansen is not documented to always answer with a pagination block, and
 * "no pagination" is not the same statement as "that was everything". A page
 * short of the limit proves there is no more; a full one proves nothing. */
function isLastPage(pagination: { is_last_page: boolean } | undefined, rows: number): boolean {
  return pagination?.is_last_page ?? rows < PAGE_SIZE;
}

/** Status recorded for a call that was sent but never answered: a timeout or
 * a dropped connection. Nansen may have served and charged it, so it counts
 * as spent rather than as nothing having happened. */
export const NO_ANSWER = 0;

/** Statuses Nansen may use when it will not serve a call. What it returns
 * when credits run out is not documented, so any of these might mean "the
 * account is empty" - but not all of them do. */
const REFUSED = new Set([401, 402, 403]);

/**
 * True when a refusal is about money rather than about this one endpoint.
 *
 * Seen live on 21 September: a key holding 1 100 credits answered 403 on
 * perp-pnl-summary, which is simply not on its plan, and the breaker read
 * that as an empty account and stopped a scan that had every credit it
 * needed. A refusal that comes with credits still on the clock is a
 * permission, not a balance, and only the balance is worth stopping for.
 */
function meansOutOfCredits(status: number, creditsRemaining: number | null): boolean {
  if (!REFUSED.has(status)) return false;
  return creditsRemaining === null || creditsRemaining <= 0;
}

export { meansOutOfCredits };

export function createNansenClient(apiKey: string, record: NansenCallRecorder = () => {}): NansenClient {
  // One client serves one check, so a refusal here stops that check rather
  // than only the calls after the next budget read. The audit watched five
  // more requests go out against the same 402.
  let refused = false;

  async function post<T>(path: string, body: Record<string, unknown>): Promise<Envelope<T>> {
    if (refused) throw new Error('nansen refused an earlier call in this check');

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      await record({ path, status: NO_ANSWER, creditsCost: null, creditsRemaining: null });
      throw err;
    }

    const creditsRemaining = headerNumber(res, 'x-nansen-credits-remaining');
    if (meansOutOfCredits(res.status, creditsRemaining)) refused = true;
    await record({
      path,
      status: res.status,
      creditsCost: headerNumber(res, 'x-nansen-credits-cost'),
      creditsRemaining,
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
        pagination: { page: 1, per_page: PAGE_SIZE },
      });
      return { rows: r.data, complete: isLastPage(r.pagination, r.data.length) };
    },
    relatedWallets: async (address, chain) => {
      const r = await post<NansenRelatedWallet[]>('profiler/address/related-wallets', {
        address,
        chain,
        pagination: { page: 1, per_page: PAGE_SIZE },
      });
      return { rows: r.data, complete: isLastPage(r.pagination, r.data.length) };
    },
  };
}
