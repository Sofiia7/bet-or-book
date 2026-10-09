import { expect, it } from 'vitest';
import { marketDefinition } from '../../src/engine/marketIdentity';
import { missingForCurrentRules } from '../../src/engine/observation';
import featured from '../../data/featured.json';
const venue = { name: 'xyz', fullName: 'XYZ', deployer: '0x88806a71d74ad0a510b350545c9ae490912f0888', oracleUpdater: null };
const now = Date.parse('2026-10-09T12:00:00Z');
it('binds a documented market to its deployment and operator, never just the ticker', () => {
  expect(marketDefinition('xyz:AAPL', venue, now).status).toBe('documented');
  expect(marketDefinition('xyz:AAPL:extra', venue, now).status).toBe('unreviewed');
  expect(marketDefinition('other:AAPL', { ...venue, name: 'other' }, now).status).toBe('unreviewed');
  expect(marketDefinition('xyz:AAPL', { ...venue, deployer: '0x' + '1'.repeat(40) }, now).status).toBe('operator-mismatch');
  expect(marketDefinition('xyz:AAPL', { ...venue, oracleUpdater: '0x' + '1'.repeat(40) }, now).status).toBe('operator-mismatch');
  expect(marketDefinition('xyz:ETH', venue, now).spotEquivalent).toBe(false);
  expect(marketDefinition('xyz:ETH', venue, now).status).toBe('unreviewed');
});
it('cannot establish identity after review expiry, before review or without the live registry', () => {
  expect(marketDefinition('xyz:AAPL', venue, Date.parse('2026-10-16')).status).toBe('review-expired');
  expect(marketDefinition('xyz:AAPL', venue, Date.parse('2026-10-08')).status).toBe('unreviewed');
  expect(marketDefinition('xyz:AAPL', null, now).status).toBe('registry-missing');
});
it('does not silently rejudge an old HIP-3 reading missing operator-bound definition', () => {
  const old = featured.entries[0];
  expect(missingForCurrentRules({ ...old, observationSchemaVersion: 7, positions: { ...old.positions, headlineCoin: 'xyz:AAPL', headlineUnderlyingVerified: true } } as any)).toContain('marketDefinition');
});
