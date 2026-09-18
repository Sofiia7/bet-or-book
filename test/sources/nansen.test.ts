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
