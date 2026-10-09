import { expect, it } from 'vitest';
import featured from '../../data/featured.json';
import type { CheckResponse } from '../../src/api/check';
import { checkClaim, isClaim } from '../../src/engine/claims';
const reading = (id: string) => featured.entries.find(e => e.snapshotId === id) as unknown as CheckResponse;
const bet = reading('0aio3f82kqsu9');
it('does not turn funder balances into ownership evidence', () => {
  const result = checkClaim(reading('12pk1a43rv3a1'), 'ownership');
  expect(result.status).toBe('Not established');
  expect(result.explanation).toContain('not common ownership');
});
it('supports visible directional exposure without asserting hidden hedges are absent', () => {
  const result = checkClaim(bet, 'directional');
  expect(result.status).toBe('Evidence supports');
  expect(result.explanation).toContain('remain invisible');
});
it('a long cannot be offset by own long spot', () => {
  expect(checkClaim(bet, 'spot').status).toBe('Evidence conflicts');
});
it('supports a covered short without calling it safe', () => {
  const result = checkClaim(reading('3aus98sj8cz7u'), 'spot');
  expect(result.status).toBe('Evidence supports');
  expect(result.explanation).toContain('does not establish safety');
});
it('withholds support when the same verdict came from incomplete or historical data', () => {
  expect(checkClaim({ ...bet, degraded: true }, 'directional').status).toBe('Not established');
  expect(checkClaim({ ...bet, historical: { reason: 'old', missing: ['hedge'] } }, 'directional').status).toBe('Not established');
});
it('busy flow alone does not establish inventory', () => {
  expect(checkClaim(reading('3eq8gsnsfh8ci'), 'inventory').status).toBe('Not established');
});
it('rejects arbitrary assertions and inherited properties in shared URL parameters', () => {
  expect(isClaim('ownership')).toBe(true);
  expect(isClaim('constructor')).toBe(false);
  expect(isClaim('<script>')).toBe(false);
});
