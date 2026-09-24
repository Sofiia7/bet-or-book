// S06, audit of 23.09: something to count. Every route that decides what a
// reader gets now leaves one JSON line saying what happened, how long it
// took and what it cost - and none of them names the wallet, the client or
// a key.
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import { FakeKV } from './support/fakeKv';
import { emit, readingFields } from '../src/telemetry';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const API_KEY = 'nansen-key-that-must-never-be-logged';
const CLIENT_IP = '198.51.100.23';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

function upstreams() {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.nansen.ai')) {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '900' },
      });
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

/** Every structured line written while `run` runs, parsed. */
async function eventsOf(run: () => Promise<unknown>): Promise<Array<Record<string, unknown>>> {
  const lines: string[] = [];
  const keep = (...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === 'string' && args[0].startsWith('{')) lines.push(args[0]);
  };
  const log = vi.spyOn(console, 'log').mockImplementation(keep);
  const error = vi.spyOn(console, 'error').mockImplementation(keep);
  try {
    await run();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return lines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

const post = (path: string, headers: Record<string, string> = {}) =>
  request(path, { method: 'POST', headers: { 'cf-connecting-ip': CLIENT_IP, ...headers } });

afterEach(() => vi.restoreAllMocks());

describe('a check leaves one line saying what it was and what it cost', () => {
  it('counts a fresh check: its verdict, the reason that decided it, its calls and credits, and whether it was kept', async () => {
    upstreams();
    const env = testEnv({ NANSEN_API_KEY: API_KEY });
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const checks = events.filter((e) => e.event === 'check');
    expect(checks).toHaveLength(1);
    const e = checks[0];
    expect(e.outcome).toBe('fresh');
    expect(typeof e.ms).toBe('number');
    expect(e.verdict).toEqual(expect.any(String));
    expect(e.rules).toEqual(expect.any(String));
    expect(e.nansenCalls).toBeGreaterThan(0);
    expect(e.credits).toBe(e.nansenCalls);
    expect(e.saved).toBe(true);
    expect(e.kvDegraded).toBe(false);
    expect(e.focus).toBe(false);
    expect(e.demo).toBe(false);
    expect(e).not.toHaveProperty('nansenOff');
  });

  it('never writes the wallet, the client address or a key into any line', async () => {
    upstreams();
    const env = testEnv({ NANSEN_API_KEY: API_KEY, DEMO_KEY: 'demo-secret' });
    const events = await eventsOf(async () => {
      await worker.fetch(post(`/api/check?address=${ADDRESS}`), env);
      await worker.fetch(post(`/api/check?address=${ADDRESS}`, { 'x-demo-key': 'demo-secret' }), env);
    });
    const text = JSON.stringify(events);
    expect(events.length).toBeGreaterThan(0);
    expect(text).not.toContain(ADDRESS.slice(2, 12));
    expect(text).not.toContain(CLIENT_IP);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('demo-secret');
  });

  it('counts a repeat as served from what is on record, not as a second check', async () => {
    upstreams();
    const env = testEnv();
    await worker.fetch(post(`/api/check?address=${ADDRESS}`), env);
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('cached');
    expect(e.verdict).toEqual(expect.any(String));
    expect(e).not.toHaveProperty('credits');
  });

  it('says why Nansen was not asked, so budget refusals can be counted', async () => {
    upstreams();
    const env = testEnv({ NANSEN_API_KEY: API_KEY, NANSEN_DAILY_CREDIT_CAP: '0' });
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('fresh');
    expect(e.nansenOff).toBe("today's Nansen credits are used up");
    expect(e.nansenCalls).toBe(0);
    expect(e.source).toBe('hyperliquid');
  });

  it('counts a check refused by the rate limit', async () => {
    upstreams();
    const env = testEnv();
    for (let i = 0; i < 20; i++) {
      await worker.fetch(post(`/api/check?address=0x${String(i).padStart(40, '0')}`, { 'cf-connecting-ip': '192.0.2.1' }), env);
    }
    const events = await eventsOf(() =>
      worker.fetch(post(`/api/check?address=0x${'9'.repeat(40)}`, { 'cf-connecting-ip': '192.0.2.1' }), env),
    );
    const e = events.find((x) => x.event === 'check')!;
    expect(['rate_limited', 'busy']).toContain(e.outcome);
  });

  it('marks every line of a request whose storage failed, and counts the reading that could not be kept', async () => {
    upstreams();
    class BrokenKV extends FakeKV {
      override async get(): Promise<string | null> {
        throw new Error('KV unavailable');
      }
      override async put(): Promise<void> {
        throw new Error('KV unavailable');
      }
    }
    const env = testEnv({ KV: new BrokenKV() });
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('fresh');
    expect(e.kvDegraded).toBe(true);
    expect(e.saved).toBe(false);
  });

  it('counts a check that failed outright', async () => {
    global.fetch = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), testEnv()));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('failed');
  });
});

describe('a picture and a saved reading are counted too', () => {
  it('tells a stand-in from a drawn picture, and a draw from a read', async () => {
    upstreams();
    const env = testEnv();
    const check = await worker.fetch(post(`/api/check?address=${ADDRESS}`), env);
    const { snapshotId } = (await check.json()) as { snapshotId: string };
    const events = await eventsOf(async () => {
      await worker.fetch(request(`/api/og?id=${snapshotId}`, { origin: null }), env);
      await worker.fetch(request(`/api/og?id=${snapshotId}`, { method: 'POST' }), env);
      await worker.fetch(request(`/api/og?id=${snapshotId}`, { method: 'POST' }), env);
      await worker.fetch(request(`/api/og?id=${snapshotId}`, { origin: null }), env);
    });
    expect(events.filter((e) => e.event === 'picture').map((e) => e.outcome)).toEqual([
      'stand_in',
      'drawn',
      'already_drawn',
      'served',
    ]);
  }, 15_000);

  it('counts a link to a reading that could not be found', async () => {
    const events = await eventsOf(() => worker.fetch(request('/api/snapshot?id=0000000000'), testEnv()));
    expect(events.find((e) => e.event === 'snapshot')?.outcome).toBe('missing');
  });
});

describe('the line itself', () => {
  it('goes out at error level for a failure, so the error views find it without a query', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    emit({ event: 'picture', outcome: 'draw_failed', ms: 3, kvDegraded: false });
    emit({ event: 'picture', outcome: 'served', ms: 1, kvDegraded: false });
    expect(error).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ outcome: 'draw_failed' });
  });

  it('takes the reason that decided the verdict, and nothing that describes the account', () => {
    const fields = readingFields({
      verdict: { verdict: 'unknown', strength: null, reasons: ['maker_flow_only', 'hedge_not_checked'] },
      classifierVersion: 'v5',
      degraded: true,
      source: 'nansen',
    });
    expect(fields).toEqual({ verdict: 'unknown', reason: 'maker_flow_only', rules: 'v5', degraded: true, source: 'nansen' });
  });
});
