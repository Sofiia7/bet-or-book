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
  lending?: true;
}

/** The placeholder Nansen puts where a chain's own coin has no contract. It
 * is the same string on every chain, and leaving it off one of them was not
 * a missing wrapper but a missing ETH: a $1M short against $1M of Ethereum
 * ETH came out as an uncovered bet (audit A01, 21.09). */
const NATIVE_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const KNOWN_CONTRACTS: Record<string, Record<string, KnownToken>> = {
  ethereum: {
    [NATIVE_PLACEHOLDER]: { underlying: 'ETH' },
    // observed, Abraxas funder, 18.09: Aave v3 aEthWETH, $117.5M of the
    // $405M that used to be reported as that account's ETH hedge.
    '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8': { underlying: 'ETH', lending: true },
    // observed, same response: ether.fi weETH and Lido wstETH.
    '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee': { underlying: 'ETH' },
    '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { underlying: 'ETH' },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { underlying: 'ETH' }, // WETH
    '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { underlying: 'ETH' }, // stETH
    '0xae78736cd615f374d3085123a210448e74fc6393': { underlying: 'ETH' }, // rETH
    '0xbe9895146f7af43049ca1c1ae358b0541ea49704': { underlying: 'ETH' }, // cbETH
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { underlying: 'BTC' }, // WBTC
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { underlying: 'BTC' }, // cbBTC
  },
  arbitrum: {
    // observed, Abraxas funder, 18.09: the native-asset placeholder Nansen
    // uses for ETH itself.
    [NATIVE_PLACEHOLDER]: { underlying: 'ETH' },
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { underlying: 'ETH' }, // WETH
    '0x5979d7b546e38e414f7e9822514be443a4800529': { underlying: 'ETH' }, // wstETH
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { underlying: 'BTC' }, // WBTC
  },
};

const known = (chain: string | undefined, tokenAddress: string | undefined): KnownToken | null => {
  if (chain === undefined || tokenAddress === undefined) return null;
  return KNOWN_CONTRACTS[chain.toLowerCase()]?.[tokenAddress.toLowerCase()] ?? null;
};

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
 * for every chain, and the registry covers two of them, so "no match here"
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
}

export function classifyHolding(holding: HoldingLike, perpCoin: string): AssetMatch {
  const perp = perpCoin.toUpperCase();
  if (!nameMatches(holding.coin, perp) && !spotHedgesPerp(holding.coin, perp, holding)) return 'unrelated';
  if (spotHedgesPerp(holding.coin, perp, holding)) {
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
  const perp = perpCoin.toUpperCase();
  const onchain = on?.source === 'onchain' || (on?.source === undefined && on?.tokenAddress !== undefined);
  if (onchain) {
    return known(on!.chain, on!.tokenAddress)?.underlying === perp;
  }
  return nameMatches(spotCoin, perp);
}

/** True when a holding claims to be the perp's asset by name but this tool
 * could not establish that it is, so it was left out of the hedge. */
export function looksLikeButUnverified(holding: HoldingLike, perpCoin: string): boolean {
  const state = classifyHolding(holding, perpCoin);
  return state === 'unknown-contract' || state === 'unsupported-chain';
}
