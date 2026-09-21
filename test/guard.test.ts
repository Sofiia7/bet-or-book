import { describe, expect, it } from 'vitest';
import { extractAddress, extractAddresses, isValidAddress, InMemoryRateLimiter } from '../src/guard';

describe('extractAddress, hex boundaries', () => {
  const addr = '0x' + 'ab'.repeat(20);

  it('does not cut an address out of a transaction hash', () => {
    // A 66-character hash pasted from a post used to yield its first 42
    // characters, which is a real, entirely unrelated address. The reader
    // would have been shown an analysis of somebody else's account with
    // nothing on the page saying so.
    const tx = '0x301e31c65ba768352a640eeff27758bbd0de6f87c03988e87aeb223eac937084';
    expect(extractAddress(tx)).toBeNull();
  });

  it('still finds an address next to punctuation and in a link', () => {
    expect(extractAddress(addr)).toBe(addr);
    expect(extractAddress(`see ${addr}, it is short ETH`)).toBe(addr);
    expect(extractAddress(`https://hypurrscan.io/address/${addr}?tab=positions`)).toBe(addr);
  });

  it('refuses an oversized input rather than scanning it', () => {
    expect(extractAddress('x'.repeat(5000) + addr)).toBeNull();
  });

  it('reports every address it found, so the caller can say which it used', () => {
    const other = '0x' + 'cd'.repeat(20);
    expect(extractAddresses(`${addr} and ${other}`)).toEqual([addr, other]);
    expect(extractAddresses('nothing here')).toEqual([]);
  });
});

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
