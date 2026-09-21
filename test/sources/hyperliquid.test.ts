import { describe, expect, it, vi, afterEach } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import metaAndAssetCtxsFixture from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
import {
  getClearinghouseState,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getUserFillsByTime,
} from '../../src/sources/hyperliquid';

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('hyperliquid client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('passes an abort signal, so a hanging request cannot hold a check open', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[]'));
    global.fetch = spy as unknown as typeof fetch;
    await getOpenOrders('0xtest');
    expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks for a named perp dex when one is given', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[]'));
    global.fetch = spy as unknown as typeof fetch;

    await getOpenOrders('0xtest');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ type: 'frontendOpenOrders', user: '0xtest' });

    // Without this the request answers for one perp dex only, while Nansen
    // reports positions across all of them.
    await getOpenOrders('0xtest', 'xyz');
    expect(JSON.parse(String(spy.mock.calls[1][1]?.body))).toEqual({
      type: 'frontendOpenOrders',
      user: '0xtest',
      dex: 'xyz',
    });
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

describe('getUserFillsByTime', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses fills from a real captured response', async () => {
    mockFetchOnce(fillsFixture);
    const fills = await getUserFillsByTime('0xtest', 0, 1);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]).toHaveProperty('coin');
    expect(fills[0]).toHaveProperty('crossed');
    expect(fills[0]).toHaveProperty('closedPnl');
    expect(typeof fills[0].crossed).toBe('boolean');
  });
});
