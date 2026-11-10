import { describe, expect, it } from 'vitest';
import {
  classifyHolding,
  isLendingReceipt,
  isWatchlistToken,
  registryTokens,
  spotHedgesPerp,
  watchlistTokens,
} from '../../src/engine/assets';
import { computeHedgeFeatures, computeLinkedHedge } from '../../src/engine/features';

describe('spotHedgesPerp, on-chain holdings', () => {
  // A ticker is a label anyone can reuse; a contract address is the asset.
  const AETHWETH = '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8';
  const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';

  it('counts a holding whose contract is one it knows', () => {
    expect(spotHedgesPerp('AETHWETH', 'ETH', { chain: 'ethereum', tokenAddress: AETHWETH })).toBe(true);
    expect(spotHedgesPerp('WSTETH', 'ETH', { chain: 'ethereum', tokenAddress: WSTETH })).toBe(true);
    // Checksummed the way Nansen sends them.
    expect(spotHedgesPerp('WSTETH', 'ETH', { chain: 'ethereum', tokenAddress: WSTETH.toUpperCase() })).toBe(true);
  });

  it('refuses a token that only calls itself WETH', () => {
    expect(
      spotHedgesPerp('WETH', 'ETH', { chain: 'ethereum', tokenAddress: '0x' + 'de' + 'ad'.repeat(19) }),
    ).toBe(false);
  });

  it('refuses a known contract presented on the wrong chain', () => {
    expect(spotHedgesPerp('WSTETH', 'ETH', { chain: 'arbitrum', tokenAddress: WSTETH })).toBe(false);
  });

  it('still matches by ticker when there is no contract to check', () => {
    // Hyperliquid spot balances are its own namespace and carry no address.
    expect(spotHedgesPerp('UBTC', 'BTC')).toBe(true);
    expect(spotHedgesPerp('UBTC', 'BTC', { chain: undefined, tokenAddress: undefined })).toBe(true);
  });

  it('knows which of them are a loan receipt rather than a holding', () => {
    expect(isLendingReceipt('ethereum', AETHWETH)).toBe(true);
    expect(isLendingReceipt('ethereum', WSTETH)).toBe(false);
    expect(isLendingReceipt('ethereum', undefined)).toBe(false);
  });
});

describe('spotHedgesPerp', () => {
  it('matches known BTC wrappers', () => {
    expect(spotHedgesPerp('UBTC', 'BTC')).toBe(true);
    expect(spotHedgesPerp('WBTC', 'BTC')).toBe(true);
    expect(spotHedgesPerp('CBBTC', 'BTC')).toBe(true);
  });

  it('matches known ETH liquid-staking wrappers', () => {
    expect(spotHedgesPerp('WSTETH', 'ETH')).toBe(true);
    expect(spotHedgesPerp('WEETH', 'ETH')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(spotHedgesPerp('ubtc', 'btc')).toBe(true);
  });

  it('does not match an unrelated token', () => {
    expect(spotHedgesPerp('USDC', 'BTC')).toBe(false);
  });

  it('falls back to an exact ticker match for coins with no alias table', () => {
    expect(spotHedgesPerp('FART', 'FART')).toBe(true);
    expect(spotHedgesPerp('FART', 'BONK')).toBe(false);
  });

  it('matches the wrapped and staked ETH seen in Abraxas funder balances', () => {
    for (const sym of ['AETHWETH', 'WEETH', 'WSTETH', 'RSETH']) {
      expect(spotHedgesPerp(sym, 'ETH')).toBe(true);
    }
  });

  it('does not match tokens that merely contain the ticker', () => {
    expect(spotHedgesPerp('ETHFI', 'ETH')).toBe(false);
    expect(spotHedgesPerp('HYPER', 'HYPE')).toBe(false);
  });
});

// Look-alike staking tokens: read from the nodes so that a restaking farm shows
// up as holdings this tool could not identify, and never counted as cover.
describe('the look-alike staking watchlist', () => {
  const WATCHLIST: Array<{ chain: 'ethereum' | 'arbitrum'; symbol: string; tokenAddress: string }> = [
    { chain: 'ethereum', symbol: 'rsETH', tokenAddress: '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7' },
    { chain: 'ethereum', symbol: 'ezETH', tokenAddress: '0xbf5495efe5db9ce00f80364c8b423567e58d2110' },
    { chain: 'ethereum', symbol: 'mETH', tokenAddress: '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa' },
    { chain: 'ethereum', symbol: 'ETHx', tokenAddress: '0xa35b1b31ce002fbf2058d22f30f95d405200a15b' },
    { chain: 'ethereum', symbol: 'osETH', tokenAddress: '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38' },
    { chain: 'arbitrum', symbol: 'rsETH', tokenAddress: '0x4186bfc76e2e237523cbc30fd220fe055156b41f' },
    { chain: 'arbitrum', symbol: 'ezETH', tokenAddress: '0x2416092f143378750bb29b79ed961ab195cceea5' },
  ];

  it('lists the five Ethereum tokens, the two Arbitrum tokens and none on HyperEVM, all 18-decimal ETH', () => {
    expect(watchlistTokens('ethereum').map((t) => t.symbol)).toEqual(['rsETH', 'ezETH', 'mETH', 'ETHx', 'osETH']);
    expect(watchlistTokens('arbitrum').map((t) => t.symbol)).toEqual(['rsETH', 'ezETH']);
    expect(watchlistTokens('hyperevm')).toEqual([]);
    expect(watchlistTokens('solana')).toEqual([]);
    expect(watchlistTokens('Ethereum')).toHaveLength(5);
    for (const token of [...watchlistTokens('ethereum'), ...watchlistTokens('arbitrum')]) {
      expect(token.underlying).toBe('ETH');
      expect(token.decimals).toBe(18);
      expect(token.tokenAddress).toBe(token.tokenAddress.toLowerCase());
    }
    expect(WATCHLIST.map(({ chain, tokenAddress }) => [chain, tokenAddress])).toEqual(
      [...watchlistTokens('ethereum').map((t) => ['ethereum', t.tokenAddress]), ...watchlistTokens('arbitrum').map((t) => ['arbitrum', t.tokenAddress])],
    );
  });

  it('knows a watchlist contract by chain and address, and nothing else', () => {
    for (const { chain, tokenAddress } of WATCHLIST) {
      expect(isWatchlistToken(chain, tokenAddress)).toBe(true);
      expect(isWatchlistToken(chain.toUpperCase(), tokenAddress.toUpperCase().replace('0X', '0x'))).toBe(true);
    }
    // Ethereum's rsETH is not Arbitrum's; a registry token, the native coin, a stranger and a missing field are not on it.
    expect(isWatchlistToken('arbitrum', WATCHLIST[0].tokenAddress)).toBe(false);
    expect(isWatchlistToken('hyperevm', WATCHLIST[0].tokenAddress)).toBe(false);
    expect(isWatchlistToken('ethereum', registryTokens('ethereum')[0].tokenAddress)).toBe(false);
    expect(isWatchlistToken('ethereum', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toBe(false);
    expect(isWatchlistToken('ethereum', '0x' + 'de'.repeat(20))).toBe(false);
    expect(isWatchlistToken(undefined, WATCHLIST[0].tokenAddress)).toBe(false);
    expect(isWatchlistToken('ethereum', undefined)).toBe(false);
  });

  it('is kept apart from the trusted registry: no watchlist contract is in it', () => {
    for (const chain of ['ethereum', 'arbitrum', 'hyperevm']) {
      const trusted = new Set(registryTokens(chain).map((t) => t.tokenAddress));
      for (const token of watchlistTokens(chain)) expect(trusted.has(token.tokenAddress)).toBe(false);
    }
  });

  it.each(WATCHLIST)('$symbol on $chain is never cover: unknown-contract, not a match, not a lending receipt', ({ chain, symbol, tokenAddress }) => {
    const holding = { coin: symbol, source: 'onchain' as const, priced: true, chain, tokenAddress };
    expect(classifyHolding(holding, 'ETH')).toBe('unknown-contract');
    expect(spotHedgesPerp(symbol, 'ETH', holding)).toBe(false);
    expect(isLendingReceipt(chain, tokenAddress)).toBe(false);
    // Checksummed the way a wallet shows it: the contract is still the same one.
    expect(classifyHolding({ ...holding, tokenAddress: tokenAddress.toUpperCase().replace('0X', '0x') }, 'ETH')).toBe('unknown-contract');
    // Not related to a BTC position at all.
    expect(classifyHolding(holding, 'BTC')).toBe('unrelated');
  });

  it('feeds unverifiedUsd and never hedgeUsd, so a short held against rsETH is not covered', () => {
    const rsEth = { coin: 'rsETH', source: 'onchain' as const, priced: true, chain: 'ethereum', tokenAddress: WATCHLIST[0].tokenAddress, valueUsd: 12_000_000 };
    const ezEth = { coin: 'ezETH', source: 'onchain' as const, priced: true, chain: 'arbitrum', tokenAddress: WATCHLIST[6].tokenAddress, valueUsd: 3_000_000 };
    const hedge = computeHedgeFeatures('ETH', 'short', 100_000_000, [rsEth, ezEth]);
    expect(hedge.hedgeUsd).toBe(0);
    expect(hedge.hedgeRatio).toBe(0);
    expect(hedge.unverifiedUsd).toBe(15_000_000);
    expect(hedge.unverifiedOnUnsupportedChainUsd).toBe(0);
    expect(hedge.unpricedMatches).toBe(0);
    expect(hedge.hedgeUsdBySource).toEqual({ hyperliquidSpot: 0, onchain: 0 });
  });

  it('adds nothing to a funder matching dollars', () => {
    const rsEth = { coin: 'rsETH', source: 'onchain' as const, priced: true, chain: 'ethereum', tokenAddress: WATCHLIST[0].tokenAddress, valueUsd: 50_000_000 };
    const linked = computeLinkedHedge('ETH', 'short', 100_000_000, [
      {
        wallet: { address: '0xfunder', chain: 'ethereum', relation: 'First Funder', serviceStatus: 'unverified' } as never,
        holdings: [rsEth],
      },
    ]);
    expect(linked.linkedHedgeUsd).toBe(0);
    expect(linked.funders[0].matchingUsd).toBe(0);
  });
});
