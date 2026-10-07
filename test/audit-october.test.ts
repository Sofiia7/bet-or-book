import { afterEach, describe, expect, it, vi } from 'vitest';
import { spotHedgesPerp, canonicalAsset } from '../src/engine/assets';
import { computePositionFeatures, EMPTY_HEDGE } from '../src/engine/features';
import { exposureBreakdown } from '../src/engine/breakdown';
import { normalizeOrders } from '../src/sources/normalize';
import { createNansenClient, type NansenCallMeta } from '../src/sources/nansen';
import type { Position } from '../src/types';
import type { HlOpenOrder } from '../src/sources/hyperliquid';
import positions from './fixtures/nansen/perp-positions-wintermute.json';
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
  it('does not describe a known stock market as an unidentified crypto underlying', () => {
    const base: Position = { coin: 'xyz:AAPL', side: 'long', sizeUsd: 100, entryPx: 1, leverage: 1, leverageType: 'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 };
    expect(exposureBreakdown(computePositionFeatures([base]), EMPTY_HEDGE, null).dataQuality).toBe('measured');
    expect(exposureBreakdown(computePositionFeatures([{ ...base, coin: 'xyz:ETH' }]), EMPTY_HEDGE, null).dataQuality).toBe('unknown');
  });
  it('retries a transient Nansen refusal once and accounts for both attempts', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(positions), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const calls: NansenCallMeta[] = [];
    await createNansenClient('test', meta => { calls.push(meta); }).perpPositions('0xabc');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calls.map(meta => meta.status)).toEqual([429, 200]);
  });
  it('never waits past a long Retry-After or spends another attempt before it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '60' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(createNansenClient('test').perpPositions('0xabc')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds paginated own balances at three pages and preserves incomplete coverage', async () => {
    const row = { token_symbol: 'ETH' };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: Array(100).fill(row), pagination: { is_last_page: false } })));
    vi.stubGlobal('fetch', fetch);
    const result = await createNansenClient('test').currentBalance('0xabc', 99);
    expect(result.rows).toHaveLength(300);
    expect(result.complete).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
