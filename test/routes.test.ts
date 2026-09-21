// S03 and S04, audit of 21.09, plus the route coverage C02 asked for: the
// Worker's own entry point, exercised through real Requests.
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

/** Counts what the check actually reached out to, so "this route spent a
 * credit" is a fact rather than an assumption. */
function routeUpstreams() {
  const seen: string[] = [];
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('api.nansen.ai')) {
      seen.push(u);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '900' },
      });
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    seen.push(`hl:${body.type}`);
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  return seen;
}

afterEach(() => vi.restoreAllMocks());

describe('starting a check is a POST, and everything else is a lookup', () => {
  it('runs a check on POST from this origin', async () => {
    routeUpstreams();
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), testEnv());
    expect(res.status).toBe(200);
    expect(((await res.json()) as { address: string }).address).toBe(ADDRESS);
  });

  it('refuses a POST from another origin', async () => {
    const seen = routeUpstreams();
    const res = await worker.fetch(
      request(`/api/check?address=${ADDRESS}`, { method: 'POST', origin: 'https://evil.example', sameSite: 'cross-site' }),
      testEnv(),
    );
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('answers a GET from the cache and never starts a paid check', async () => {
    const seen = routeUpstreams();
    const env = testEnv();
    const miss = await worker.fetch(request(`/api/check?address=${ADDRESS}`), env);
    expect(miss.status).toBe(404);
    expect(seen).toEqual([]);

    await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const hit = await worker.fetch(request(`/api/check?address=${ADDRESS}`), env);
    expect(hit.status).toBe(200);
    expect(((await hit.json()) as { address: string }).address).toBe(ADDRESS);
  });

  it('never spends on HEAD, whatever a scanner or a prefetch does', async () => {
    const seen = routeUpstreams();
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'HEAD' }), testEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
    expect(seen).toEqual([]);
  });
});

describe('a burst is bounded for everyone at once, not only per address', () => {
  it('refuses checks past the global burst allowance', async () => {
    routeUpstreams();
    const env = testEnv();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const address = `0x${String(i).padStart(40, '0')}`;
      // A different client IP each time, so the per-IP limit is not what is
      // being measured here.
      const res = await worker.fetch(
        request(`/api/check?address=${address}`, {
          method: 'POST',
          headers: { 'cf-connecting-ip': `203.0.113.${i}` },
        }),
        env,
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe('the demo keeps a reserve the public path cannot reach', () => {
  it('stops public checks at the public cap while the demo key still works', async () => {
    routeUpstreams();
    const env = testEnv({ NANSEN_API_KEY: 'k', NANSEN_DAILY_CREDIT_CAP: '14', NANSEN_DEMO_RESERVE: '7', DEMO_KEY: 'secret' });
    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    expect(((await first.json()) as { coverage: string[] }).coverage.join(' ')).not.toContain('Nansen not used');

    const second = await worker.fetch(
      request(`/api/check?address=0x2222222222222222222222222222222222222222`, { method: 'POST' }),
      env,
    );
    expect(((await second.json()) as { coverage: string[] }).coverage.join(' ')).toContain('Nansen not used');

    const demo = await worker.fetch(
      request(`/api/check?address=0x3333333333333333333333333333333333333333&demo=secret`, { method: 'POST' }),
      env,
    );
    expect(((await demo.json()) as { coverage: string[] }).coverage.join(' ')).not.toContain('Nansen not used');
  });
});

describe('the page it serves', () => {
  it('does not allow inline script', async () => {
    const res = await worker.fetch(request('/'), testEnv());
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('serves its script as a file of its own', async () => {
    const res = await worker.fetch(request('/app.js'), testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect((await res.text()).length).toBeGreaterThan(100);
  });

  it('asks search engines not to index a saved reading', async () => {
    // A wallet is public; that someone asked about this one at this moment
    // need not be.
    const env = testEnv();
    routeUpstreams();
    const made = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const { snapshotId } = (await made.json()) as { snapshotId: string };
    const res = await worker.fetch(request(`/api/snapshot?id=${snapshotId}`), env);
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('what the reader is told when something upstream breaks', () => {
  it('does not pass an upstream message through to the page', async () => {
    global.fetch = vi.fn(async () => new Response('Traceback: internal.host:5432 auth failed', { status: 500 })) as never;
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), testEnv());
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).not.toContain('internal.host');
    expect(body).not.toContain('Traceback');
  });
});
