import { describe, expect, it } from 'vitest';
import { spotHedgesPerp } from '../../src/engine/assets';

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
});
