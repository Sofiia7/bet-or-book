import { expect, it } from 'vitest';
import { quoteGeometry, nextQuoteSample } from '../../src/engine/quoteDiagnostics';
import featured from '../../data/featured.json';
import type { CheckResponse } from '../../src/api/check';
it('measures distance only for priced quotes in the selected market', () => {
  const result = quoteGeometry([{ coin: 'ETH', side: 'buy', sizeUsd: 100, limitPx: 99 }, { coin: 'ETH', side: 'sell', sizeUsd: 100, limitPx: 102 }] as any, 'ETH', 100)!;
  expect(result.weightedDistanceBps).toBeCloseTo(150);
  expect(quoteGeometry([], 'ETH', 0)).toBeNull();
});
it('counts separated observations without inferring continuous quoting or duplicating a cache hit', () => {
  const reading = { ...featured.entries[0], checkedAt: '2026-10-09T10:00:00Z', ordersCoverage: 'complete', orders: { headlineTwoSided: true, headlineTwoSidedNotionalUsd: 100 } } as unknown as CheckResponse;
  const first = nextQuoteSample(null, reading)!;
  expect(nextQuoteSample(first, reading)).toEqual(first);
  expect(nextQuoteSample(first, { ...reading, checkedAt: '2026-10-09T10:02:00Z' })?.samples).toBe(2);
  expect(nextQuoteSample(first, { ...reading, checkedAt: '2026-10-09T11:00:00Z' })?.samples).toBe(1);
  expect(nextQuoteSample(first, { ...reading, ordersCoverage: 'partial' })).toBeNull();
});
