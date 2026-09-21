// Decides whether a spot holding counts as the same underlying asset as a
// Hyperliquid perp position. See docs/specs/2026-09-17-bet-or-book-design.md
// section 3.

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

const KNOWN_CONTRACTS: Record<string, Record<string, KnownToken>> = {
  ethereum: {
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
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': { underlying: 'ETH' },
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

/**
 * True when a spot balance in `spotCoin` should count toward the hedge leg
 * of a perp position in `perpCoin`.
 *
 * A holding that carries a contract address is judged by that address: it
 * has to be one of the contracts above, on the chain it claims. A holding
 * with no address is a Hyperliquid spot balance, whose ticker comes from
 * Hyperliquid's own universe and is not something a stranger can mint, so
 * there the alias list still decides.
 */
export function spotHedgesPerp(
  spotCoin: string,
  perpCoin: string,
  on?: { chain?: string; tokenAddress?: string },
): boolean {
  const perp = perpCoin.toUpperCase();
  if (on?.tokenAddress !== undefined) {
    return known(on.chain, on.tokenAddress)?.underlying === perp;
  }

  const spot = spotCoin.toUpperCase();
  const aliases = SPOT_ALIASES[perp];
  if (aliases) {
    return spot === perp || aliases.includes(spot);
  }
  return spot === perp;
}

/** True when a holding claims to be the perp's asset by name but its
 * contract is not one this tool knows, so it was left out of the hedge. */
export function looksLikeButUnverified(
  spotCoin: string,
  perpCoin: string,
  on?: { chain?: string; tokenAddress?: string },
): boolean {
  if (on?.tokenAddress === undefined) return false;
  if (spotHedgesPerp(spotCoin, perpCoin, on)) return false;
  return spotHedgesPerp(spotCoin, perpCoin);
}
