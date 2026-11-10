import { describe, expect, it, vi, afterEach } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import metaAndAssetCtxsFixture from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
import perpDexsFixture from '../fixtures/hyperliquid/perp-dexs.json';
import portfolioFixture from '../fixtures/hyperliquid/portfolio-abraxas.json';
import clearinghouseXyzFixture from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import {
  getClearinghouseState,
  dexNamesOf,
  getOpenOrders,
  getSpotBalances,
  getSpotMeta,
  getPerpMetaAndAssetCtxs,
  getPortfolio,
  getUserFillsByTime,
} from '../../src/sources/hyperliquid';
import { normalizePositions } from '../../src/sources/normalize';

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

  it('sends dex only when one is named', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(clearinghouseXyzFixture)));
    global.fetch = spy as unknown as typeof fetch;

    await getClearinghouseState('0xt');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ type: 'clearinghouseState', user: '0xt' });

    await getClearinghouseState('0xt', undefined, 'xyz');
    expect(JSON.parse(String(spy.mock.calls[1][1]?.body))).toEqual({
      type: 'clearinghouseState',
      user: '0xt',
      dex: 'xyz',
    });

    // An empty dex means the main dex, which is asked for by leaving the field out.
    await getClearinghouseState('0xt', undefined, '');
    expect(JSON.parse(String(spy.mock.calls[2][1]?.body))).toEqual({ type: 'clearinghouseState', user: '0xt' });
  });

  it('parses a named-dex clearinghouse answer from a real capture', async () => {
    mockFetchOnce(clearinghouseXyzFixture);
    const state = await getClearinghouseState('0xt', undefined, 'xyz');
    const positions = normalizePositions(state);
    expect(positions.length).toBeGreaterThan(0);
    for (const p of positions) expect(p.coin.startsWith('xyz:')).toBe(true);
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

describe('getPortfolio', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('asks for the portfolio of one user and returns the list of periods as sent', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(portfolioFixture.portfolio)));
    global.fetch = spy as unknown as typeof fetch;
    const periods = await getPortfolio('0xtest');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ type: 'portfolio', user: '0xtest' });
    expect(periods.map(([period]) => period)).toEqual([
      'day', 'week', 'month', 'allTime', 'perpDay', 'perpWeek', 'perpMonth', 'perpAllTime',
    ]);
    const month = periods.find(([period]) => period === 'perpMonth')![1];
    expect(month.pnlHistory.length).toBeGreaterThan(1);
    expect(typeof month.pnlHistory[0][0]).toBe('number');
    expect(typeof month.pnlHistory[0][1]).toBe('string');
    expect(spy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on a non-200 status', async () => {
    mockFetchOnce('down', 503);
    await expect(getPortfolio('0xtest', AbortSignal.abort())).rejects.toThrow(/portfolio failed: 503/);
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

describe('dexNamesOf', () => {
  it('skips the main dex and keeps registry order', () => {
    expect(dexNamesOf(perpDexsFixture)).toEqual(['xyz', 'flx', 'vntl', 'hyna', 'km', 'abcd', 'cash', 'para', 'mkts', 'io']);
  });

  it('rejects a malformed registry', () => {
    expect(() => dexNamesOf({})).toThrow();
    expect(() => dexNamesOf([null])).toThrow('hyperliquid perpDexs: no named dex');
    expect(() => dexNamesOf([])).toThrow('hyperliquid perpDexs: no named dex');

    // One entry without a valid name makes the whole list untrustworthy:
    // the reader reports partial coverage rather than a silently shorter list.
    expect(() => dexNamesOf([null, { name: 'xyz' }, { deployer: '0xabc' }])).toThrow();
    expect(() => dexNamesOf([null, { name: 'has space' }])).toThrow();
    expect(() => dexNamesOf([null, 'xyz'])).toThrow();
  });

  it('ignores fields other than the name', () => {
    // A venue whose deployer is missing must not make every reading partial.
    expect(dexNamesOf([null, { name: 'xyz', fullName: 'XYZ' }, { name: 'flx' }])).toEqual(['xyz', 'flx']);
  });
});

describe('hyperliquid retry', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** A fetch stub that answers each call with the next response in the list. */
  function stubSequence(responses: Array<() => Response>) {
    let call = 0;
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => responses[Math.min(call++, responses.length - 1)]());
    global.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  it('retries once on 429 using retry-after', async () => {
    const spy = stubSequence([
      () => new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }),
      () => new Response(JSON.stringify(clearinghouseXyzFixture)),
    ]);
    const state = await getClearinghouseState('0xt');
    expect(state.assetPositions.length).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry twice', async () => {
    const spy = stubSequence([() => new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })]);
    await expect(getClearinghouseState('0xt')).rejects.toThrow(/clearinghouseState failed: 429/);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the signal is already aborted', async () => {
    // The check's deadline has passed: a second request would answer nobody.
    const spy = stubSequence([() => new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })]);
    await expect(getClearinghouseState('0xt', AbortSignal.abort())).rejects.toThrow(/429/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a status that is not transient', async () => {
    const spy = stubSequence([() => new Response('bad request', { status: 400 })]);
    await expect(getClearinghouseState('0xt')).rejects.toThrow(/400/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reads retry-after given as an HTTP date', async () => {
    const later = new Date(Date.now() + 30_000).toUTCString();
    const spy = stubSequence([() => new Response('rate limited', { status: 429, headers: { 'retry-after': later } })]);
    await expect(getClearinghouseState('0xt')).rejects.toThrow(/429/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips the retry when retry-after asks for a long wait', async () => {
    const spy = stubSequence([() => new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } })]);
    await expect(getClearinghouseState('0xt')).rejects.toThrow(/429/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
