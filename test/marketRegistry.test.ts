import { expect, it } from 'vitest';
import { parsePerpVenues } from '../src/marketRegistry';
it('validates venue provenance and does not turn registry membership into asset identity', () => {
  const row = { name: 'xyz', fullName: 'XYZ', deployer: '0x' + '1'.repeat(40), oracleUpdater: null };
  expect(parsePerpVenues([null, row])).toEqual([row]);
  expect(() => parsePerpVenues([row, row])).toThrow('Duplicate');
  expect(() => parsePerpVenues([{ ...row, deployer: 'wallet' }])).toThrow();
  expect(parsePerpVenues([row])[0]).not.toHaveProperty('underlyingVerified');
});
