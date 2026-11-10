// Spot holdings read straight from public JSON-RPC nodes: one Multicall3 call
// per chain per wallet, over the tokens of the asset registry plus a short
// watchlist of look-alike staking tokens, priced with Hyperliquid's own mark
// prices. Replaces the Nansen balances request.
import { NATIVE_PLACEHOLDER, nativeToken, registryTokens, watchlistTokens } from '../engine/assets';
import { isRequestBudgetExceeded } from '../requestBudget';
import type { SpotHolding } from '../types';
import {
  MULTICALL3,
  SELECTORS,
  decodeAggregate3,
  encodeAggregate3,
  ethCall,
  uint256Of,
  withAddress,
  type Call3,
} from './evm';

export type HoldingsChain = 'ethereum' | 'arbitrum' | 'hyperevm';
export const HOLDINGS_CHAINS: readonly HoldingsChain[] = ['ethereum', 'arbitrum', 'hyperevm'];

export const RPC_URLS: Record<HoldingsChain, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  hyperevm: 'https://rpc.hyperliquid.xyz/evm',
};

export const CHAIN_NAMES: Record<HoldingsChain, string> = {
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  hyperevm: 'HyperEVM',
};

export interface UnderlyingPrices {
  ETH?: number;
  BTC?: number;
  HYPE?: number;
}

/** The main perp dex's marks for the three underlyings a holding can be
 * priced by. A mark that is not a positive finite number is left out, which
 * leaves the holding unpriced rather than worth zero. */
export function underlyingPricesFrom(markPxByCoin: Map<string, number>): UnderlyingPrices {
  const prices: UnderlyingPrices = {};
  for (const coin of ['ETH', 'BTC', 'HYPE'] as const) {
    const mark = markPxByCoin.get(coin);
    if (mark !== undefined && Number.isFinite(mark) && mark > 0) prices[coin] = mark;
  }
  return prices;
}

export interface OnchainHoldings {
  holdings: SpotHolding[];
  read: HoldingsChain[];
  failed: Array<{ chain: HoldingsChain; reason: 'limit' | 'error' }>;
  /** Tokens whose balance sub-call failed or answered something other than one word. */
  unreadTokens: number;
}

type RateSymbol = 'wstETH' | 'rETH' | 'cbETH' | 'weETH';

/** Liquid-staking tokens worth more than one unit of their underlying: the
 * contract and function that says how much, read on Ethereum only. */
const RATE_CALLS: Array<{ symbol: RateSymbol; target: string; selector: string }> = [
  { symbol: 'wstETH', target: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', selector: SELECTORS.stEthPerToken },
  { symbol: 'rETH', target: '0xae78736cd615f374d3085123a210448e74fc6393', selector: SELECTORS.getExchangeRate },
  { symbol: 'cbETH', target: '0xbe9895146f7af43049ca1c1ae358b0541ea49704', selector: SELECTORS.exchangeRate },
  { symbol: 'weETH', target: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee', selector: SELECTORS.getRate },
];

const RATE_SYMBOLS: ReadonlySet<string> = new Set(RATE_CALLS.map((r) => r.symbol));

interface ChainToken {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  underlying: string;
}

/** The tokens read on a chain: the native coin first, then the registry's
 * tokens, then the watchlist's look-alike staking tokens. A watchlist token
 * is read like any other and priced one for one with its underlying. The
 * protocol exchange rate of each is at least 1 ETH, so that understates the
 * value held (a market price on a DEX can sit below the protocol rate); the
 * error can only make the withhold less likely to trigger, never create
 * cover, and the token is not in the registry, so it is never counted as
 * cover (src/engine/assets.ts). */
function tokensOf(chain: HoldingsChain): ChainToken[] {
  const native = nativeToken(chain);
  const list: ChainToken[] = [];
  if (native) list.push({ tokenAddress: NATIVE_PLACEHOLDER, symbol: native.symbol, decimals: 18, underlying: native.underlying });
  return [...list, ...registryTokens(chain), ...watchlistTokens(chain)];
}

/** The Multicall3 sub-calls for one chain and wallet: the native balance,
 * `balanceOf` per registry token, `balanceOf` per watchlist token, then
 * (Ethereum only) the four rate calls. */
export function holdingsCalls(chain: HoldingsChain, wallet: string): Call3[] {
  const calls: Call3[] = tokensOf(chain).map((token) =>
    token.tokenAddress === NATIVE_PLACEHOLDER
      ? { target: MULTICALL3, callData: withAddress(SELECTORS.getEthBalance, wallet) }
      : { target: token.tokenAddress, callData: withAddress(SELECTORS.balanceOf, wallet) },
  );
  return chain === 'ethereum' ? [...calls, ...RATE_CALLS.map((r) => ({ target: r.target, callData: r.selector }))] : calls;
}

/** Whole units, without losing a large balance: the bigint is brought down to
 * six decimals before it becomes a Number. */
function wholeUnits(raw: bigint, decimals: number): number {
  return Number(raw / 10n ** BigInt(decimals - 6)) / 1e6;
}

interface Balance {
  token: ChainToken;
  amount: number;
}

interface ChainRead {
  balances: Balance[];
  unreadTokens: number;
  rates: Partial<Record<RateSymbol, number>>;
}

async function readChain(chain: HoldingsChain, wallet: string, signal?: AbortSignal): Promise<ChainRead> {
  const tokens = tokensOf(chain);
  const calls = holdingsCalls(chain, wallet);
  const answer = await ethCall(RPC_URLS[chain], MULTICALL3, encodeAggregate3(calls), signal);
  const results = decodeAggregate3(answer, calls.length);
  const balances: Balance[] = [];
  let unreadTokens = 0;
  tokens.forEach((token, i) => {
    const raw = results[i].success ? uint256Of(results[i].returnData) : null;
    if (raw === null) {
      unreadTokens++;
      return;
    }
    if (raw > 0n) balances.push({ token, amount: wholeUnits(raw, token.decimals) });
  });
  const rates: Partial<Record<RateSymbol, number>> = {};
  if (chain === 'ethereum') {
    // The rate calls follow every balance call, the watchlist's included.
    RATE_CALLS.forEach((rate, i) => {
      const result = results[tokens.length + i];
      const raw = result.success ? uint256Of(result.returnData) : null;
      if (raw !== null && raw > 0n) rates[rate.symbol] = wholeUnits(raw, 18);
    });
  }
  return { balances, unreadTokens, rates };
}

export async function readOnchainHoldings(
  address: string,
  prices: UnderlyingPrices,
  signal?: AbortSignal,
): Promise<OnchainHoldings> {
  // Started in order and without an await in between, so a budget that only
  // affords some of the sends refuses the last chains, not an arbitrary one.
  const settled = await Promise.allSettled(HOLDINGS_CHAINS.map((chain) => readChain(chain, address, signal)));
  const out: OnchainHoldings = { holdings: [], read: [], failed: [], unreadTokens: 0 };
  const reads = new Map<HoldingsChain, ChainRead>();
  settled.forEach((result, i) => {
    const chain = HOLDINGS_CHAINS[i];
    if (result.status === 'fulfilled') {
      reads.set(chain, result.value);
      out.read.push(chain);
      out.unreadTokens += result.value.unreadTokens;
    } else {
      out.failed.push({ chain, reason: isRequestBudgetExceeded(result.reason) ? 'limit' : 'error' });
    }
  });
  // Arbitrum's wstETH is worth what Ethereum's wstETH contract says. A
  // watchlist token has no rate call: one for one, an understatement of the
  // value held (its protocol rate is at least 1 ETH).
  const ethereumRates = reads.get('ethereum')?.rates ?? {};
  for (const chain of HOLDINGS_CHAINS) {
    const read = reads.get(chain);
    if (!read) continue;
    for (const { token, amount } of read.balances) {
      const rate = RATE_SYMBOLS.has(token.symbol) ? ethereumRates[token.symbol as RateSymbol] : 1;
      const mark = prices[token.underlying as keyof UnderlyingPrices];
      const priced = rate !== undefined && mark !== undefined;
      out.holdings.push({
        coin: token.symbol,
        valueUsd: priced ? amount * rate * mark : 0,
        source: 'onchain',
        priced,
        amount,
        chain,
        tokenAddress: token.tokenAddress.toLowerCase(),
      });
    }
  }
  return out;
}
