// Maps a Hyperliquid perp coin (e.g. "BTC") to the spot token symbols that
// count as the same underlying asset, so a spot holding can be read as a
// hedge of a perp position. See docs/specs/2026-09-17-bet-or-book-design.md
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
 * True when a spot balance in `spotCoin` should count toward the hedge leg
 * of a perp position in `perpCoin`. Majors use a known alias list; anything
 * else falls back to an exact ticker match.
 */
export function spotHedgesPerp(spotCoin: string, perpCoin: string): boolean {
  const spot = spotCoin.toUpperCase();
  const perp = perpCoin.toUpperCase();
  const aliases = SPOT_ALIASES[perp];
  if (aliases) {
    return spot === perp || aliases.includes(spot);
  }
  return spot === perp;
}
