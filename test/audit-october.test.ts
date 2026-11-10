import { afterEach, describe, expect, it, vi } from 'vitest';
import { spotHedgesPerp, canonicalAsset } from '../src/engine/assets';
import { computePositionFeatures, EMPTY_HEDGE } from '../src/engine/features';
import { exposureBreakdown } from '../src/engine/breakdown';
import { normalizeOrders } from '../src/sources/normalize';
import type { Position } from '../src/types';
import type { HlOpenOrder } from '../src/sources/hyperliquid';
import orders from './fixtures/hyperliquid/open-orders.json';

describe('October audit regressions', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('excludes reduce-only exits from evidence of two-sided market making', () => {
    const rows = orders as HlOpenOrder[];
    expect(normalizeOrders(rows.map(row => ({ ...row, reduceOnly: true })))).toEqual([]);
    expect(normalizeOrders(rows.map(row => ({ ...row, isTrigger: false, reduceOnly: false })))).toHaveLength(rows.length);
  });
  it('recognizes canonical HYPE on HyperEVM without trusting a copied ticker', () => {
    expect(spotHedgesPerp('WHYPE', 'HYPE', { source: 'onchain', chain: 'hyperevm', tokenAddress: '0x5555555555555555555555555555555555555555' })).toBe(true);
    expect(spotHedgesPerp('WHYPE', 'HYPE', { source: 'onchain', chain: 'hyperevm', tokenAddress: '0x' + 'a'.repeat(40) })).toBe(false);
  });
  it('preserves case-sensitive Solana mint identity', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    expect(spotHedgesPerp('SOL', 'SOL', { source: 'onchain', chain: 'solana', tokenAddress: mint })).toBe(true);
    expect(spotHedgesPerp('SOL', 'SOL', { source: 'onchain', chain: 'solana', tokenAddress: mint.toLowerCase() })).toBe(false);
  });
  it('recognizes same-asset opposing crypto legs across dexes without merging arbitrary names', () => {
    const base: Position = { coin: 'ETH', side: 'long', sizeUsd: 100, entryPx: 1, leverage: 1, leverageType: 'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 };
    expect(computePositionFeatures([base, { ...base, coin: 'xyz:ETH', side: 'short' }]).sameAssetOffsetShare).toBe(1);
    expect(canonicalAsset('xyz:ACME')).toBe('XYZ:ACME');
  });
  it('does not establish a HIP-3 underlying from a familiar ticker alone', () => {
    const base: Position = { coin: 'xyz:AAPL', side: 'long', sizeUsd: 100, entryPx: 1, leverage: 1, leverageType: 'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 };
    expect(exposureBreakdown(computePositionFeatures([base]), EMPTY_HEDGE, null).dataQuality).toBe('unknown');
    expect(exposureBreakdown(computePositionFeatures([{ ...base, coin: 'xyz:ETH' }]), EMPTY_HEDGE, null).dataQuality).toBe('unknown');
  });
});
