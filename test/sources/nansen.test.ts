import { describe, expect, it, vi, afterEach } from 'vitest';
import positionsFixture from '../fixtures/nansen/perp-positions-wintermute.json';
import balancesFixture from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';
import { createNansenClient, type NansenCallMeta } from '../../src/sources/nansen';

const KEY = 'test-key-not-real';

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers }),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('nansen client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to the right path with the apikey header and returns data', async () => {
    const fn = mockFetch(positionsFixture, 200, { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '995' });
    const client = createNansenClient(KEY);
    const result = await client.perpPositions('0xabc');
    expect(result.asset_positions.length).toBe(134);
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('https://api.nansen.ai/api/v1/profiler/perp-positions');
    expect((init?.headers as Record<string, string>).apikey).toBe(KEY);
    expect(JSON.parse(String(init?.body))).toEqual({ address: '0xabc' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('records every call with the credit headers', async () => {
    mockFetch(positionsFixture, 200, { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '995' });
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    await client.perpPositions('0xabc');
    expect(calls).toEqual([{ path: 'profiler/perp-positions', status: 200, creditsCost: 1, creditsRemaining: 995 }]);
  });

  it('reports whether a balance page was the last one', async () => {
    mockFetch(balancesFixture);
    const client = createNansenClient(KEY);
    const result = await client.currentBalance('0xabc');
    expect(result.rows.length).toBe(69);
    expect(result.complete).toBe(true);
  });

  it('treats a full page with no pagination block as possibly incomplete', async () => {
    // Nansen is not documented to always send pagination back. A short page
    // is proof there is no more; a page filled to the limit is not.
    const rows = Array.from({ length: 100 }, () => (balancesFixture as { data: unknown[] }).data[0]);
    mockFetch({ data: rows });
    const full = await createNansenClient(KEY).currentBalance('0xabc');
    expect(full.complete).toBe(false);

    mockFetch({ data: rows.slice(0, 99) });
    const short = await createNansenClient(KEY).currentBalance('0xabc');
    expect(short.complete).toBe(true);
  });

  it('reports whether the funding links were the last page', async () => {
    mockFetch({ data: [], pagination: { is_last_page: false } });
    const more = await createNansenClient(KEY).relatedWallets('0xabc', 'ethereum');
    expect(more.complete).toBe(false);

    mockFetch({ data: [], pagination: { is_last_page: true } });
    const done = await createNansenClient(KEY).relatedWallets('0xabc', 'ethereum');
    expect(done.complete).toBe(true);
    expect(done.rows).toEqual([]);
  });

  it('records a call that never came back, because it may still have been charged', async () => {
    global.fetch = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    await expect(client.perpPositions('0xabc')).rejects.toThrow();
    // Status 0 is "attempted, outcome unknown". Nansen may well have served
    // and charged it; leaving no record was the only certainly wrong answer.
    expect(calls).toEqual([{ path: 'profiler/perp-positions', status: 0, creditsCost: null, creditsRemaining: null }]);
  });

  it('stops calling after Nansen refuses, instead of spending five more times', async () => {
    const fn = mockFetch({ error: 'payment required' }, 402);
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    await expect(client.perpPositions('0xabc')).rejects.toThrow();
    await expect(client.currentBalance('0xabc')).rejects.toThrow('nansen refused an earlier call in this check');
    await expect(client.relatedWallets('0xabc', 'ethereum')).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
  });

  it('records a failed call and throws without leaking the key', async () => {
    mockFetch({ error: 'unauthorized' }, 401);
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(KEY, (m) => {
      calls.push(m);
    });
    const err = await client.perpPositions('0xabc').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toContain(KEY);
    expect(calls[0].status).toBe(401);
  });
});
