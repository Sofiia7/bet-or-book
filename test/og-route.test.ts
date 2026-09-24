// S04, audit of 23.09: a link's picture on the Workers free plan.
//
// satori and resvg need 26-127 ms of CPU and the free plan allows 10 ms per
// request. A try/catch around the render cannot promise the fallback when
// the runtime stops the isolate for CPU: the crawler gets Error 1102, not
// the picture. So the crawler's request never renders at all - it reads a
// picture that already exists or gets the standing one, briefly cached - and
// drawing happens in a request of its own that nothing displays.
//
// Every test here starts from an empty KV, the cold path the audit asked
// for, rather than from a gallery whose pictures were uploaded beforehand.
import { describe, expect, it, vi, afterEach } from 'vitest';

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/engine/ogRender', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/engine/ogRender')>();
  return {
    ...real,
    renderOgPng: async (...args: Parameters<typeof real.renderOgPng>) => {
      renders.count++;
      return real.renderOgPng(...args);
    },
  };
});

import worker from '../src/index';
import { testEnv, request } from './support/worker';
import { ogCacheKey } from '../src/engine/ogCard';
import ogFallbackPng from '../assets/og-fallback.png';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const FALLBACK = Buffer.from(new Uint8Array(ogFallbackPng as ArrayBuffer)).toString('base64');

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [{ name: 'ETH', szDecimals: 4, maxLeverage: 25 }] }, [{ markPx: '2000', openInterest: '1000000' }]],
  clearinghouseState: {
    assetPositions: [
      {
        type: 'oneWay',
        position: {
          coin: 'ETH',
          szi: '-500',
          entryPx: '2000',
          positionValue: '1000000',
          unrealizedPnl: '0',
          returnOnEquity: '0',
          liquidationPx: '3000',
          marginUsed: '100000',
          maxLeverage: 25,
          leverage: { type: 'cross', value: 10 },
          cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
        },
      },
    ],
    marginSummary: { accountValue: '2000000', totalNtlPos: '1000000', totalRawUsd: '0', totalMarginUsed: '100000' },
    time: Date.now(),
  },
};

function hyperliquidOnly() {
  global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

async function liveReading(env: ReturnType<typeof testEnv>): Promise<string> {
  hyperliquidOnly();
  const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
  const body = (await res.json()) as { snapshotId?: string; snapshotSaved?: boolean };
  expect(body.snapshotSaved).toBe(true);
  return body.snapshotId!;
}

const b64 = async (res: Response) => Buffer.from(new Uint8Array(await res.arrayBuffer())).toString('base64');

afterEach(() => {
  vi.restoreAllMocks();
  renders.count = 0;
});

describe('the crawler never waits on a render (23.09 audit, S04)', () => {
  it('serves the standing picture for a live reading that has none yet, and does not draw one', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    renders.count = 0;

    const res = await worker.fetch(request(`/api/og?id=${id}`, { origin: null }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await b64(res)).toBe(FALLBACK);
    expect(renders.count).toBe(0);
    expect(await env.KV.get(ogCacheKey(id))).toBeNull();
  });

  it('does not let a stand-in picture be cached as if it were the reading\'s own', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    const res = await worker.fetch(request(`/api/og?id=${id}`, { origin: null }), env);
    const cache = res.headers.get('cache-control') ?? '';
    expect(cache).not.toContain('immutable');
    const maxAge = Number(/max-age=(\d+)/.exec(cache)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(300);
  });

  it('keeps the stand-in short-lived for an id no reading has yet, which may still be on its way', async () => {
    // KV takes up to a minute to show a write everywhere, so "not found" a
    // moment after a check is not the same as "never existed".
    const res = await worker.fetch(request('/api/og?id=0000000000', { origin: null }), testEnv());
    expect(await b64(res)).toBe(FALLBACK);
    expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
    expect(renders.count).toBe(0);
  });

  it('does not cache the stand-in for good even for something that is not an id at all', async () => {
    const res = await worker.fetch(request('/api/og?id=not-a-real-id-at-all', { origin: null }), testEnv());
    expect(await b64(res)).toBe(FALLBACK);
    expect(res.headers.get('cache-control') ?? '').not.toContain('immutable');
  });
});

describe('drawing is a separate request, whose failure nothing displays', () => {
  it('draws on a request from this site, and serves that picture from then on, cached for good', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    renders.count = 0;

    const warm = await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env);
    expect(warm.status).toBe(204);
    expect(renders.count).toBe(1);
    const stored = await env.KV.get(ogCacheKey(id));
    expect(stored).not.toBeNull();

    const res = await worker.fetch(request(`/api/og?id=${id}`, { origin: null }), env);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = await b64(res);
    expect(bytes).toBe(stored);
    expect(bytes).not.toBe(FALLBACK);
    expect(renders.count).toBe(1);
  }, 15_000);

  it('does not draw the same picture twice', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    renders.count = 0;
    await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env);
    const again = await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env);
    expect(again.status).toBe(204);
    expect(renders.count).toBe(1);
  }, 15_000);

  it('refuses to draw for another site', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    renders.count = 0;
    const res = await worker.fetch(
      request(`/api/og?id=${id}`, { method: 'POST', origin: 'https://evil.example', sameSite: 'cross-site' }),
      env,
    );
    expect(res.status).toBe(403);
    expect(renders.count).toBe(0);
  });

  it('has nothing to draw for a reading that does not exist', async () => {
    const res = await worker.fetch(request('/api/og?id=0000000000', { method: 'POST' }), testEnv());
    expect(res.status).toBe(404);
    expect(renders.count).toBe(0);
  });

  it('refuses something that is not an id before it touches storage', async () => {
    const res = await worker.fetch(request('/api/og?id=../../etc', { method: 'POST' }), testEnv());
    expect(res.status).toBe(400);
  });

  it('draws a gallery card as a gallery card, the way the offline pre-render does', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string }>;
    };
    const id = list.entries[0].snapshotId;
    const warm = await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env);
    expect(warm.status).toBe(204);
    expect(renders.count).toBe(1);
  }, 15_000);
});

describe('a picture kept from an older layout is not served as this one', () => {
  it('ignores a picture stored under the bare id before the date and limit were added (U02)', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    await env.KV.put(`og:${id}`, Buffer.from('an older layout').toString('base64'));
    const res = await worker.fetch(request(`/api/og?id=${id}`, { origin: null }), env);
    expect(await b64(res)).toBe(FALLBACK);
  });

  it('serves a picture pre-rendered under the current layout\'s key as a plain cache read', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
    await env.KV.put(ogCacheKey(id), png);
    const res = await worker.fetch(request(`/api/og?id=${id}`, { origin: null }), env);
    expect(await b64(res)).toBe(png);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(renders.count).toBe(0);
  });

  it('points a shared page at the picture under a URL that names the layout', async () => {
    const env = testEnv();
    const id = await liveReading(env);
    const html = await (await worker.fetch(request(`/?s=${id}`), env)).text();
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="[^"]*/api/og\\?id=${id}&amp;v=\\d+">`));
  });
});
