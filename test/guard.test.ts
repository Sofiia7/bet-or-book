import { describe, expect, it } from 'vitest';
import { extractAddress, isValidAddress, InMemoryRateLimiter } from '../src/guard';

describe('extractAddress', () => {
  it('extracts a bare address', () => {
    const addr = '0x' + 'ab'.repeat(20);
    expect(extractAddress(addr)).toBe(addr);
  });

  it('extracts an address embedded in a URL', () => {
    const addr = '0x' + '12'.repeat(20);
    expect(extractAddress(`https://hyperdash.com/address/${addr}`)).toBe(addr);
  });

  it('lowercases the result', () => {
    const addr = '0x' + 'AB'.repeat(20);
    expect(extractAddress(addr)).toBe(addr.toLowerCase());
  });

  it('returns null when no address is present', () => {
    expect(extractAddress('not an address')).toBeNull();
  });

  it('returns null for a short hex string', () => {
    expect(extractAddress('0x1234')).toBeNull();
  });
});

describe('isValidAddress', () => {
  it('accepts a well-formed address with nothing else in the string', () => {
    expect(isValidAddress('0x' + '0'.repeat(40))).toBe(true);
  });

  it('rejects a string with extra text', () => {
    expect(isValidAddress('address: 0x' + '0'.repeat(40))).toBe(false);
  });
});

describe('InMemoryRateLimiter', () => {
  it('allows up to the configured number of hits in the window', async () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
  });

  it('tracks separate keys independently', async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip2')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
  });
});
