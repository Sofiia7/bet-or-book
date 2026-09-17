import { describe, expect, it, vi, afterEach } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import metaAndAssetCtxsFixture from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
} from '../../src/sources/hyperliquid';

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('hyperliquid client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses clearinghouseState from a real captured response', async () => {
    mockFetchOnce(clearinghouseFixture);
    const state = await getClearinghouseState('0xtest');
    expect(state.assetPositions.length).toBeGreaterThan(0);
    const first = state.assetPositions[0].position;
    expect(first).toHaveProperty('coin');
    expect(first).toHaveProperty('szi');
    expect(state.marginSummary).toHaveProperty('accountValue');
  });

  it('parses open orders from a real captured response', async () => {
    mockFetchOnce(openOrdersFixture);
    const orders = await getOpenOrders('0xtest');
    expect(orders.length).toBeGreaterThan(0);
    expect(['B', 'A']).toContain(orders[0].side);
    expect(orders[0]).toHaveProperty('coin');
    expect(orders[0]).toHaveProperty('limitPx');
  });

  it('parses spot balances from a real captured response', async () => {
    mockFetchOnce(spotBalancesFixture);
    const result = await getSpotBalances('0xtest');
    expect(result.balances.length).toBeGreaterThan(0);
    expect(result.balances[0]).toHaveProperty('coin');
    expect(result.balances[0]).toHaveProperty('total');
  });

  it('parses spot meta and asset contexts from a real captured response', async () => {
    mockFetchOnce(spotMetaFixture);
    const [meta, ctxs] = await getSpotMeta();
    expect(meta.universe.length).toBeGreaterThan(0);
    expect(meta.tokens.length).toBeGreaterThan(0);
    // The asset-context array can be longer than the active universe - it
    // also carries delisted pairs - so every universe pair must still be
    // found by name, not by a matching array length.
    const ctxNames = new Set(ctxs.map((c) => c.coin));
    for (const pair of meta.universe) {
      expect(ctxNames.has(pair.name)).toBe(true);
    }
  });

  it('parses perp meta and asset contexts from a real captured response', async () => {
    mockFetchOnce(metaAndAssetCtxsFixture);
    const [meta, ctxs] = await getPerpMetaAndAssetCtxs();
    expect(meta.universe.length).toBeGreaterThan(0);
    expect(ctxs.length).toBe(meta.universe.length);
  });

  it('throws a clear error when Hyperliquid responds with a non-200 status', async () => {
    mockFetchOnce('rate limited', 429);
    await expect(getClearinghouseState('0xtest')).rejects.toThrow(/429/);
  });
});
