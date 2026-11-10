// Decides whether a spot holding counts as the same underlying asset as a
// Hyperliquid perp position. See docs/specs/2026-09-17-bet-or-book-design.md
// section 3.
import type { HoldingSource } from '../types';

const SPOT_ALIASES: Record<string, string[]> = {
  BTC: ['UBTC', 'WBTC', 'CBBTC', 'TBTC', 'BTCB', 'LBTC', 'AETHWBTC', 'AARBWBTC'],
  ETH: [
    'UETH', 'WETH', 'STETH', 'WSTETH', 'WEETH', 'RETH', 'CBETH',
    // Seen in real Nansen balances (Abraxas funders, 18.09): Aave's aToken
    // for WETH and Kelp's restaked ETH. The rest of each family by name.
    'AETHWETH', 'AETHWSTETH', 'AETHWEETH', 'AARBWETH', 'RSETH', 'EZETH', 'METH', 'ETHX', 'OSETH',
  ],
  SOL: ['USOL', 'SOL', 'MSOL', 'JITOSOL'],
  HYPE: ['HYPE', 'WHYPE'],
};

/**
 * Contracts this tool is willing to read as the underlying asset, by chain.
 *
 * A ticker is a label anyone can put on a token they deploy, so an on-chain
 * balance that merely calls itself WETH proves nothing. Only an address on
 * this list counts toward a hedge; anything else is left out and said so on
 * the card, which is the safe direction to be wrong in - a hedge that is
 * under-counted is visible, one inflated by a look-alike is not.
 *
 * `lending` marks a deposit receipt from a lending market. The balance is
 * real, but it can be collateral against a loan, and no endpoint this tool
 * reads shows the debt. Counting it as a hedge without saying so is how a
 * leveraged position gets described as delta neutral.
 *
 * Addresses marked "observed" appear in the captured Nansen responses under
 * test/fixtures. The rest are the canonical deployments. The list is
 * deliberately short: adding an address to it is a decision to trust it.
 */
interface KnownToken {
  underlying: string;
  /** Ticker, as shown on a card and read from public nodes. */
  symbol: string;
  decimals: number;
  lending?: true;
}

/** The placeholder Nansen puts where a chain's own coin has no contract. It
 * is the same string on every chain, and leaving it off one of them was not
 * a missing wrapper but a missing ETH: a $1M short against $1M of Ethereum
 * ETH came out as an uncovered bet (audit A01, 21.09). */
export const NATIVE_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const KNOWN_CONTRACTS: Record<string, Record<string, KnownToken>> = {
  hyperevm: {
    [NATIVE_PLACEHOLDER]: { underlying: 'HYPE', symbol: 'HYPE', decimals: 18 },
    // Hyperliquid's immutable canonical WHYPE system contract.
    '0x5555555555555555555555555555555555555555': { underlying: 'HYPE', symbol: 'WHYPE', decimals: 18 },
  },
  solana: {
    // Nansen's native placeholder and the canonical wrapped SOL mint.
    [NATIVE_PLACEHOLDER]: { underlying: 'SOL', symbol: 'SOL', decimals: 9 },
    'So11111111111111111111111111111111111111112': { underlying: 'SOL', symbol: 'WSOL', decimals: 9 },
  },
  ethereum: {
    [NATIVE_PLACEHOLDER]: { underlying: 'ETH', symbol: 'ETH', decimals: 18 },
    // observed, Abraxas funder, 18.09: Aave v3 aEthWETH, $117.5M of the
    // $405M that used to be reported as that account's ETH hedge.
    '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8': { underlying: 'ETH', symbol: 'aEthWETH', decimals: 18, lending: true },
    // observed, same response: ether.fi weETH and Lido wstETH.
    '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee': { underlying: 'ETH', symbol: 'weETH', decimals: 18 },
    '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { underlying: 'ETH', symbol: 'wstETH', decimals: 18 },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { underlying: 'ETH', symbol: 'WETH', decimals: 18 },
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { underlying: 'ETH', symbol: 'stETH', decimals: 18 },
    '0xae78736cd615f374d3085123a210448e74fc6393': { underlying: 'ETH', symbol: 'rETH', decimals: 18 },
    '0xbe9895146f7af43049ca1c1ae358b0541ea49704': { underlying: 'ETH', symbol: 'cbETH', decimals: 18 },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { underlying: 'BTC', symbol: 'WBTC', decimals: 8 },
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { underlying: 'BTC', symbol: 'cbBTC', decimals: 8 },
  },
  arbitrum: {
    // observed, Abraxas funder, 18.09: the native-asset placeholder Nansen
    // uses for ETH itself.
    [NATIVE_PLACEHOLDER]: { underlying: 'ETH', symbol: 'ETH', decimals: 18 },
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { underlying: 'ETH', symbol: 'WETH', decimals: 18 },
    '0x5979d7b546e38e414f7e9822514be443a4800529': { underlying: 'ETH', symbol: 'wstETH', decimals: 18 },
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { underlying: 'BTC', symbol: 'WBTC', decimals: 8 },
  },
};

/**
 * Look-alike staking tokens: contracts whose name says "ETH" and whose
 * protocol exchange rate is at least 1 ETH each, but which this tool does not
 * trust as cover.
 *
 * A short on ETH can be hedged, or can be one leg of a restaking farm (long
 * rsETH or ezETH against a short ETH on Hyperliquid), and the two look alike
 * on the account's own side. Nansen used to return the whole token list, so
 * such holdings reached the `unrecognised_assets` rule as holdings the tool
 * could not identify. The nodes are asked about contracts only, so without
 * this list that safety net is gone and a farm can read "Looks like a bet".
 *
 * Each is valued at the ETH mark one for one (rate 1). The protocol exchange
 * rate of each is at least 1 ETH, so that understates the value held; a market
 * price on a DEX can sit below the protocol rate, so it is a protocol-rate
 * floor, not a market quote. The error can only make the withhold less likely
 * to trigger, never create cover.
 *
 * They are kept apart from KNOWN_CONTRACTS on purpose. That table is the
 * trusted cover list: `spotHedgesPerp` and `isLendingReceipt` read it, and an
 * address added to it is a decision to count its balance as a hedge. Nothing
 * here is counted as cover: `classifyHolding` finds none of these in the
 * registry, so each reads as an unknown contract and its value feeds
 * `unverifiedUsd`. Only the nodes read them, and only on the chains below
 * (symbol(), name() and decimals() verified on public nodes, 2026-11-09).
 */
const WATCHLIST_CONTRACTS: Record<string, Record<string, KnownToken>> = {
  ethereum: {
    '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7': { underlying: 'ETH', symbol: 'rsETH', decimals: 18 },
    '0xbf5495efe5db9ce00f80364c8b423567e58d2110': { underlying: 'ETH', symbol: 'ezETH', decimals: 18 },
    '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa': { underlying: 'ETH', symbol: 'mETH', decimals: 18 },
    '0xa35b1b31ce002fbf2058d22f30f95d405200a15b': { underlying: 'ETH', symbol: 'ETHx', decimals: 18 },
    '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38': { underlying: 'ETH', symbol: 'osETH', decimals: 18 },
  },
  arbitrum: {
    '0x4186bfc76e2e237523cbc30fd220fe055156b41f': { underlying: 'ETH', symbol: 'rsETH', decimals: 18 },
    '0x2416092f143378750bb29b79ed961ab195cceea5': { underlying: 'ETH', symbol: 'ezETH', decimals: 18 },
  },
};

const known = (chain: string | undefined, tokenAddress: string | undefined): KnownToken | null => {
  if (chain === undefined || tokenAddress === undefined) return null;
  const network = chain.toLowerCase();
  // Base58 mint addresses are case-sensitive; EVM hexadecimal addresses are not.
  const address = network === 'solana' ? tokenAddress : tokenAddress.toLowerCase();
  return KNOWN_CONTRACTS[network]?.[address] ?? null;
};

/** The registry's contracts on one chain, for reading balances from a node.
 * The chain's own coin (the placeholder) is not a contract and is left out;
 * see nativeToken. */
export function registryTokens(
  chain: string,
): Array<{ tokenAddress: string; symbol: string; decimals: number; underlying: string; lending: boolean }> {
  return Object.entries(KNOWN_CONTRACTS[chain.toLowerCase()] ?? {})
    .filter(([address]) => address !== NATIVE_PLACEHOLDER)
    .map(([tokenAddress, token]) => ({
      tokenAddress,
      symbol: token.symbol,
      decimals: token.decimals,
      underlying: token.underlying,
      lending: token.lending === true,
    }));
}

/** The look-alike staking tokens read on one chain: asked about on the same
 * Multicall3 call as the registry, and never trusted as cover (see
 * WATCHLIST_CONTRACTS). Empty for a chain with none. */
export function watchlistTokens(
  chain: string,
): Array<{ tokenAddress: string; symbol: string; decimals: number; underlying: string }> {
  return Object.entries(WATCHLIST_CONTRACTS[chain.toLowerCase()] ?? {}).map(([tokenAddress, token]) => ({
    tokenAddress,
    symbol: token.symbol,
    decimals: token.decimals,
    underlying: token.underlying,
  }));
}

/** True when this contract is one of the watchlist's look-alike staking tokens
 * on this chain. Case-insensitive, like the registry lookup. */
export function isWatchlistToken(chain: string | undefined, tokenAddress: string | undefined): boolean {
  if (chain === undefined || tokenAddress === undefined) return false;
  return WATCHLIST_CONTRACTS[chain.toLowerCase()]?.[tokenAddress.toLowerCase()] !== undefined;
}

/** The coin an EVM chain pays gas in, or null for a chain no node is read on. */
export function nativeToken(chain: string): { symbol: string; underlying: string } | null {
  const network = chain.toLowerCase();
  if (network !== 'ethereum' && network !== 'arbitrum' && network !== 'hyperevm') return null;
  const token = KNOWN_CONTRACTS[network]?.[NATIVE_PLACEHOLDER];
  return token ? { symbol: token.symbol, underlying: token.underlying } : null;
}

/** True when this balance is a lending-market deposit receipt, so any loan
 * taken against it is invisible here. */
export function isLendingReceipt(chain: string | undefined, tokenAddress: string | undefined): boolean {
  return known(chain, tokenAddress)?.lending === true;
}

/** True when a ticker is one this tool would read as `perpCoin`. A name is
 * only ever evidence inside a namespace nobody else can mint into. */
function nameMatches(spotCoin: string, perp: string): boolean {
  const spot = spotCoin.toUpperCase();
  const aliases = SPOT_ALIASES[perp];
  return aliases ? spot === perp || aliases.includes(spot) : spot === perp;
}

/** True when the registry knows this chain at all. `chain: all` asks Nansen
 * for every chain, and the registry covers only a few of them, so "no match here"
 * is often a gap in this list rather than a fact about the account. */
const chainCovered = (chain: string | undefined): boolean =>
  chain !== undefined && KNOWN_CONTRACTS[chain.toLowerCase()] !== undefined;

/** Where a holding stands relative to the perp position being asked about.
 *
 * `match` is the only state that may be added up as coverage. The three
 * that follow it are gaps of different shapes, and naming which one it is
 * beats folding them all into a zero: the reader can tell a token this tool
 * refuses to trust from a chain it never learned and from a balance nobody
 * could put a price on. */
export type AssetMatch = 'match' | 'unknown-contract' | 'unsupported-chain' | 'unpriced' | 'unrelated';

export interface HoldingLike {
  coin: string;
  source: HoldingSource;
  priced?: boolean;
  chain?: string;
  tokenAddress?: string;
  identityAmbiguous?: boolean;
}

export function classifyHolding(holding: HoldingLike, perpCoin: string): AssetMatch {
  const perp = canonicalAsset(perpCoin);
  if (!nameMatches(holding.coin, perp) && !spotHedgesPerp(holding.coin, perp, holding)) return 'unrelated';
  if (spotHedgesPerp(holding.coin, perp, holding)) {
    // A name this tool would otherwise trust outright, except Hyperliquid's
    // own fresh listing has more than one token under it right now: which
    // one this balance actually is is not established, the same gap an
    // unrecognised on-chain contract leaves - so it withholds the same way,
    // rather than being counted as a clean match by name alone (23.09
    // audit, L08).
    if (holding.identityAmbiguous) return 'unknown-contract';
    return holding.priced === false ? 'unpriced' : 'match';
  }
  if (holding.source === 'hyperliquid-spot') return holding.priced === false ? 'unpriced' : 'unrelated';
  return chainCovered(holding.chain) ? 'unknown-contract' : 'unsupported-chain';
}

/**
 * True when a spot balance in `spotCoin` should count toward the hedge leg
 * of a perp position in `perpCoin`.
 *
 * An on-chain holding is judged by its contract address: it has to be one of
 * the contracts above, on the chain it claims, and a row that arrives without
 * an address is simply not identified. A Hyperliquid spot balance carries no
 * address by design - its ticker comes from Hyperliquid's own universe, which
 * is not something a stranger can mint into - so there the alias list decides.
 *
 * `source` is what tells the two apart. It used to be inferred from whether
 * an address was present, which meant a malformed on-chain row was read as a
 * Hyperliquid ticker and counted by name.
 */
export function spotHedgesPerp(
  spotCoin: string,
  perpCoin: string,
  on?: { source?: HoldingSource; chain?: string; tokenAddress?: string },
): boolean {
  const perp = canonicalAsset(perpCoin);
  const onchain = on?.source === 'onchain' || (on?.source === undefined && on?.tokenAddress !== undefined);
  if (onchain) {
    return known(on!.chain, on!.tokenAddress)?.underlying === perp;
  }
  return nameMatches(spotCoin, perp);
}

/** Group known crypto underlyings across perp dexes; retain opaque names. */
export function canonicalAsset(coin: string, mainCoins?: Set<string>): string {
  const name = coin.toUpperCase();
  const suffix = name.split(':').at(-1)!;
  return suffix in SPOT_ALIASES || mainCoins?.has(suffix) ? suffix : name;
}
