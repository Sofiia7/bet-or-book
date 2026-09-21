import { describe, expect, it } from 'vitest';
import { spotHedgesPerp, isLendingReceipt } from '../../src/engine/assets';

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
