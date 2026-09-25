// S03 and S04, audit of 21.09, plus the route coverage C02 asked for: the
// Worker's own entry point, exercised through real Requests.
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { testEnv, request, ORIGIN } from './support/worker';
import { ogCacheKey, OG_LAYOUT_VERSION } from '../src/engine/ogCard';
import ogFallbackPng from '../assets/og-fallback.png';
import clearinghouseFixture from './fixtures/hyperliquid/clearinghouse-many-positions.json';

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
      request(`/api/check?address=0x3333333333333333333333333333333333333333`, {
        method: 'POST',
        headers: { 'x-demo-key': 'secret' },
      }),
      env,
    );
    expect(((await demo.json()) as { coverage: string[] }).coverage.join(' ')).not.toContain('Nansen not used');
  });

  it('does not accept the key in the query string any more (23.09 audit, S03)', async () => {
    // A query string ends up in browser history, access logs and a demo
    // recording's own URL bar - the header is the point of the fix.
    routeUpstreams();
    const env = testEnv({ NANSEN_API_KEY: 'k', NANSEN_DAILY_CREDIT_CAP: '14', NANSEN_DEMO_RESERVE: '7', DEMO_KEY: 'secret' });
    await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const exhausted = await worker.fetch(
      request(`/api/check?address=0x4444444444444444444444444444444444444444`, { method: 'POST' }),
      env,
    );
    expect(((await exhausted.json()) as { coverage: string[] }).coverage.join(' ')).toContain('Nansen not used');

    const viaQuery = await worker.fetch(
      request(`/api/check?address=0x5555555555555555555555555555555555555555&demo=secret`, { method: 'POST' }),
      env,
    );
    expect(((await viaQuery.json()) as { coverage: string[] }).coverage.join(' ')).toContain('Nansen not used');
  });

  it('does not let an unset or empty DEMO_KEY grant the reserve to anyone', async () => {
    routeUpstreams();
    const env = testEnv({ NANSEN_API_KEY: 'k', NANSEN_DAILY_CREDIT_CAP: '14', NANSEN_DEMO_RESERVE: '7', DEMO_KEY: '' });
    await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const exhausted = await worker.fetch(
      request(`/api/check?address=0x6666666666666666666666666666666666666666`, { method: 'POST' }),
      env,
    );
    expect(((await exhausted.json()) as { coverage: string[] }).coverage.join(' ')).toContain('Nansen not used');

    const emptyHeader = await worker.fetch(
      request(`/api/check?address=0x7777777777777777777777777777777777777777`, {
        method: 'POST',
        headers: { 'x-demo-key': '' },
      }),
      env,
    );
    expect(((await emptyHeader.json()) as { coverage: string[] }).coverage.join(' ')).toContain('Nansen not used');
  });

  it('lets a demo request through even while the public burst limit is exhausted (23.09 audit, S03)', async () => {
    // The reserve is supposed to survive a busy public afternoon - which it
    // cannot if reaching it needs the same limiter the public traffic just
    // used up.
    routeUpstreams();
    const env = testEnv({
      NANSEN_API_KEY: 'k',
      NANSEN_DAILY_CREDIT_CAP: '14',
      NANSEN_DEMO_RESERVE: '7',
      DEMO_KEY: 'secret',
    });
    let lastStatus = 200;
    for (let i = 0; i < 15; i++) {
      const res = await worker.fetch(
        request(`/api/check?address=0x${String(i).padStart(40, '0')}`, {
          method: 'POST',
          headers: { 'cf-connecting-ip': `203.0.113.${i}` },
        }),
        env,
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429); // the public burst limit is now exhausted

    const demo = await worker.fetch(
      request(`/api/check?address=0x8888888888888888888888888888888888888888`, {
        method: 'POST',
        headers: { 'x-demo-key': 'secret' },
      }),
      env,
    );
    expect(demo.status).toBe(200);
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

describe('the page and its script are deployed together', () => {
  it('points at a script URL that changes when the script does', async () => {
    const res = await worker.fetch(request('/'), testEnv());
    const html = await res.text();
    // Without this the script is cached for five minutes while the page and
    // the API move on, which is exactly long enough for a reader to run the
    // previous version against the current one.
    expect(html).toMatch(/src="\/app\.js\?v=[0-9a-z]+"/);
  });

  it('serves the script whatever version is asked for', async () => {
    const res = await worker.fetch(request('/app.js?v=anything'), testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });
});

describe('asking about a particular position', () => {
  it('passes the chosen position through and keys the cache by it', async () => {
    const seen = routeUpstreams();
    const env = testEnv();
    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}&coin=ETH&side=short`, { method: 'POST' }), env);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { focus: unknown }).focus).toBeNull(); // no such position in this fixture
    const before = seen.length;
    // A different position is a different question, so it is not answered
    // out of the first one's cache entry.
    await worker.fetch(request(`/api/check?address=${ADDRESS}&coin=BTC&side=long`, { method: 'POST' }), env);
    expect(seen.length).toBeGreaterThan(before);
  });

  it('ignores a position parameter that is not one', async () => {
    routeUpstreams();
    const res = await worker.fetch(
      request(`/api/check?address=${ADDRESS}&coin=${'x'.repeat(40)}&side=sideways`, { method: 'POST' }),
      testEnv(),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { focus: unknown }).focus).toBeNull();
  });

  it('checks a real sixth position instead of declaring it absent from a cached top-5 (25.09 audit, A02)', async () => {
    // routeUpstreams()'s own HL fixture (top of this file) has no positions
    // at all; this test needs a real account with more than five, so it
    // builds its own fetch mock around the shared many-positions fixture
    // instead (37 positions; WLD, 6th largest by value, is a real open
    // short that MAX_CANDIDATES = 5 leaves out of `candidates`).
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.nansen.ai')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const byType: Record<string, unknown> = { ...HL, clearinghouseState: clearinghouseFixture };
      return new Response(JSON.stringify(byType[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const env = testEnv();

    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const firstBody = (await first.json()) as { positions: { candidates: Array<{ coin: string }> } };
    expect(firstBody.positions.candidates.map((c) => c.coin)).not.toContain('WLD');

    // Asking about WLD specifically must not answer "not open" purely
    // because it fell outside the cached top-5 - it must actually check.
    const second = await worker.fetch(
      request(`/api/check?address=${ADDRESS}&coin=WLD&side=short`, { method: 'POST' }),
      env,
    );
    const secondBody = (await second.json()) as { positions: { headlineCoin: string }; coverage: string[] };
    expect(secondBody.positions.headlineCoin).toBe('WLD');
    expect(secondBody.coverage.join(' ')).not.toContain('No WLD short is open');
  });
});

describe('putting two readings of one address side by side', () => {
  it('compares a gallery card with the reading it replaced', async () => {
    const env = testEnv();
    const list = await (await worker.fetch(request('/api/gallery'), env)).json() as {
      entries: Array<{ snapshotId: string; supersedes?: string }>;
    };
    const pair = list.entries.find((e) => e.supersedes)!;
    const res = await worker.fetch(request(`/api/compare?a=${pair.supersedes}&b=${pair.snapshotId}`), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      from: { observedAt: string; snapshotId?: string };
      to: { observedAt: string; snapshotId?: string };
      changes: unknown[];
    };
    // "from" is the older reading, but not always by observedAt: since the
    // 23.09 audit's L03 fix, a rule change can re-judge the same observation
    // under a new id (scripts/reexplain.ts), and the two share one
    // observedAt. Only a live re-check moves it.
    expect(body.from.observedAt <= body.to.observedAt).toBe(true);
    expect(body.from.snapshotId).toBe(pair.supersedes);
    expect(body.to.snapshotId).toBe(pair.snapshotId);
    expect(Array.isArray(body.changes)).toBe(true);
  });

  it('refuses two readings of different addresses', async () => {
    const env = testEnv();
    const list = await (await worker.fetch(request('/api/gallery'), env)).json() as {
      entries: Array<{ snapshotId: string; address: string }>;
    };
    const [a, b] = [list.entries[0], list.entries.find((e) => e.address !== list.entries[0].address)!];
    const res = await worker.fetch(request(`/api/compare?a=${a.snapshotId}&b=${b.snapshotId}`), env);
    expect(res.status).toBe(400);
  });

  it('says which reading it could not find', async () => {
    const res = await worker.fetch(request('/api/compare?a=0000000000&b=1111111111'), testEnv());
    expect(res.status).toBe(404);
  });

  it('never starts a check to answer a comparison', async () => {
    const seen = routeUpstreams();
    await worker.fetch(request('/api/compare?a=0000000000&b=1111111111'), testEnv());
    expect(seen).toEqual([]);
  });
});

describe('a live check remembers the reading it replaces (22.09 audit, J05)', () => {
  it('supersedes this address\'s own last live reading, not only a gallery card', async () => {
    routeUpstreams();
    const env = testEnv();
    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const firstBody = (await first.json()) as { snapshotId: string; supersedes?: string };
    expect(firstBody.supersedes).toBeUndefined();

    // The ten-minute cache would otherwise replay the first reading: this
    // stands in for that window passing, so the second POST runs a real
    // second check rather than serving the first one back.
    env.KV.now = () => Date.now() + 700_000;

    const second = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const secondBody = (await second.json()) as { snapshotId: string; supersedes?: string };
    expect(secondBody.snapshotId).not.toBe(firstBody.snapshotId);
    expect(secondBody.supersedes).toBe(firstBody.snapshotId);

    const cmp = await worker.fetch(request(`/api/compare?a=${firstBody.snapshotId}&b=${secondBody.snapshotId}`), env);
    expect(cmp.status).toBe(200);
  });

  it('does not supersede a reading that failed to save', async () => {
    routeUpstreams();
    const env = testEnv();
    const failingKv = env.KV;
    const realPut = failingKv.put.bind(failingKv);
    let calls = 0;
    failingKv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
      calls++;
      if (key.startsWith('snapshot:') && calls === 1) throw new Error('kv put failed');
      return realPut(key, value, opts);
    };
    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const firstBody = (await first.json()) as { snapshotSaved?: boolean; supersedes?: string };
    expect(firstBody.snapshotSaved).toBe(false);

    env.KV.now = () => Date.now() + 700_000;
    const second = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const secondBody = (await second.json()) as { supersedes?: string };
    // Nothing real to point back at: the failed reading was never the
    // address's "latest", so the pointer never moved off whatever it was.
    expect(secondBody.supersedes).toBeUndefined();
  });

  it('does not supersede itself when nothing has moved and the pointer already matches', async () => {
    routeUpstreams();
    const env = testEnv();
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const body = (await res.json()) as { snapshotId: string; supersedes?: string };
    expect(body.supersedes).toBeUndefined();
    expect(body.snapshotId).toBeTruthy();
  });

  it('does not let switching to a different position at the same address supersede it (23.09 audit, L02)', async () => {
    // Two real positions, ETH short and BTC long. Checking BTC after ETH is
    // a different question, not a change at the address - the old shared
    // `latest:${address}` pointer read it as one.
    const hlPosition = (coin: string, szi: string, positionValue: string) => ({
      type: 'oneWay',
      position: {
        coin,
        szi,
        entryPx: '100',
        leverage: { type: 'cross', value: 5 },
        liquidationPx: null,
        positionValue,
        unrealizedPnl: '0',
        cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
        marginUsed: '0',
        maxLeverage: 20,
        returnOnEquity: '0',
      },
    });
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'clearinghouseState') {
        return new Response(
          JSON.stringify({
            assetPositions: [hlPosition('ETH', '-500', '1000000'), hlPosition('BTC', '10', '100000')],
            marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
            withdrawable: '0',
            time: Date.now(),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const env = testEnv();

    const eth = await worker.fetch(request(`/api/check?address=${ADDRESS}&coin=ETH&side=short`, { method: 'POST' }), env);
    const ethBody = (await eth.json()) as { snapshotId: string; supersedes?: string };
    expect(ethBody.supersedes).toBeUndefined();

    env.KV.now = () => Date.now() + 700_000;
    const btc = await worker.fetch(request(`/api/check?address=${ADDRESS}&coin=BTC&side=long`, { method: 'POST' }), env);
    const btcBody = (await btc.json()) as { snapshotId: string; supersedes?: string };
    // The different question, not the ETH reading, is what BTC has none of.
    expect(btcBody.supersedes).toBeUndefined();

    // Asking about ETH again, though, still supersedes the first ETH reading.
    env.KV.now = () => Date.now() + 1_400_000;
    const ethAgain = await worker.fetch(
      request(`/api/check?address=${ADDRESS}&coin=ETH&side=short`, { method: 'POST' }),
      env,
    );
    const ethAgainBody = (await ethAgain.json()) as { snapshotId: string; supersedes?: string };
    expect(ethAgainBody.supersedes).toBe(ethBody.snapshotId);
  });
});

describe('a rate limit bounds new checks, not free reads of one already on record (23.09 audit, S02)', () => {
  it('still answers a repeat POST of an already-cached reading once the burst limit is exhausted', async () => {
    routeUpstreams();
    const env = testEnv();
    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    expect(first.status).toBe(200);

    // Exhaust the global burst with other addresses, each its own IP so the
    // per-IP limit is not what is being measured.
    for (let i = 0; i < 12; i++) {
      await worker.fetch(
        request(`/api/check?address=0x${String(i).padStart(40, '9')}`, {
          method: 'POST',
          headers: { 'cf-connecting-ip': `203.0.113.${i}` },
        }),
        env,
      );
    }
    const blocked = await worker.fetch(
      request('/api/check?address=0x1010101010101010101010101010101010101010', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.99' },
      }),
      env,
    );
    expect(blocked.status).toBe(429); // confirms the burst really is exhausted

    const repeat = await worker.fetch(
      request(`/api/check?address=${ADDRESS}`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.100' } }),
      env,
    );
    expect(repeat.status).toBe(200);
  });

  it('answers a coin/side that is not open from the address\'s own cached reading, for free', async () => {
    const hlPosition = (coin: string, szi: string, positionValue: string) => ({
      type: 'oneWay',
      position: {
        coin, szi, entryPx: '100', leverage: { type: 'cross', value: 5 }, liquidationPx: null,
        positionValue, unrealizedPnl: '0', cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
        marginUsed: '0', maxLeverage: 20, returnOnEquity: '0',
      },
    });
    const seen = { calls: 0 };
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'clearinghouseState') {
        seen.calls++;
        return new Response(
          JSON.stringify({
            assetPositions: [hlPosition('ETH', '-500', '1000000')],
            marginSummary: { accountValue: '0', totalMarginUsed: '0', totalNtlPos: '0', totalRawUsd: '0' },
            withdrawable: '0',
            time: Date.now(),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const env = testEnv();

    const plain = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    expect(plain.status).toBe(200);
    const callsAfterFirst = seen.calls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const bogus = await worker.fetch(
      request(`/api/check?address=${ADDRESS}&coin=DOGE&side=long`, { method: 'POST' }),
      env,
    );
    expect(bogus.status).toBe(200);
    const bogusBody = (await bogus.json()) as {
      focus: unknown;
      positions: { headlineCoin: string };
      coverage: string[];
      coverageNotes: Array<{ text: string; failure: boolean }>;
    };
    // No new Hyperliquid read - answered from the plain reading already on
    // record, not a fresh check of an ask that was never going to resolve.
    expect(seen.calls).toBe(callsAfterFirst);
    expect(bogusBody.focus).toBeNull();
    expect(bogusBody.positions.headlineCoin).toBe('ETH');
    expect(bogusBody.coverage.join(' ')).toContain('No DOGE long is open');
    // Flagged, so the page shows it beside the answer (23.09 audit, U06).
    expect(bogusBody.coverageNotes).toContainEqual({
      text: expect.stringContaining('No DOGE long is open'),
      failure: true,
    });
  });
});

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('a reading\'s own social-preview picture (22.09 audit, item 7)', () => {
  // Since 23.09 (S04) a crawler's GET never draws: the picture is drawn by a
  // POST from this site's own page, and GET serves what that drew. The cold
  // path itself is covered in test/og-route.test.ts.
  const FALLBACK = Buffer.from(new Uint8Array(ogFallbackPng as ArrayBuffer)).toString('base64');

  it('draws a real PNG for a gallery card, real satori and resvg, no mocks', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string }>;
    };
    const id = list.entries[0].snapshotId;
    expect((await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env)).status).toBe(204);
    const res = await worker.fetch(request(`/api/og?id=${id}`), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    expect(Buffer.from(bytes).toString('base64')).not.toBe(FALLBACK);
  }, 15_000);

  it('draws a real PNG for a freshly live-checked address too, not only a gallery card', async () => {
    routeUpstreams();
    const env = testEnv();
    const check = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const { snapshotId } = (await check.json()) as { snapshotId: string };
    expect((await worker.fetch(request(`/api/og?id=${snapshotId}`, { method: 'POST' }), env)).status).toBe(204);
    const res = await worker.fetch(request(`/api/og?id=${snapshotId}`), env);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
    expect(Buffer.from(bytes).toString('base64')).not.toBe(FALLBACK);
  }, 15_000);

  it('serves the standing fallback picture for an id that is not a snapshot id at all', async () => {
    const res = await worker.fetch(request('/api/og?id=not-a-real-id-at-all'), testEnv());
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
  });

  it('serves the standing fallback picture for a snapshot id that does not exist', async () => {
    const res = await worker.fetch(request('/api/og?id=0000000000'), testEnv());
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_MAGIC);
  });

  it('keeps a drawn picture in KV, so every later request reads it rather than drawing again', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string }>;
    };
    const id = list.entries[1].snapshotId;
    expect(await env.KV.get(ogCacheKey(id))).toBeNull();
    await worker.fetch(request(`/api/og?id=${id}`, { method: 'POST' }), env);
    const cached = await env.KV.get(ogCacheKey(id));
    expect(cached).not.toBeNull();
    // A gallery card's picture is as permanent as the card itself.
    expect(env.KV.ttlOf(ogCacheKey(id))).toBeNull();
    // A later request reads the same cached bytes back rather than drawing
    // again - proven by the response matching the cache exactly, not by a
    // spy, since satori and resvg are called for real here.
    const res2 = await worker.fetch(request(`/api/og?id=${id}`), env);
    const bytes2 = new Uint8Array(await res2.arrayBuffer());
    expect(Buffer.from(bytes2).toString('base64')).toBe(cached);
  }, 15_000);

  it('carries og:image and a summary_large_image twitter card on a shared reading\'s page', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string }>;
    };
    const id = list.entries[0].snapshotId;
    const html = await (await worker.fetch(request(`/?s=${id}`), env)).text();
    expect(html).toContain(
      `<meta property="og:image" content="${ORIGIN}/api/og?id=${id}&amp;v=${OG_LAYOUT_VERSION}">`,
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });
});

describe('an operator way into the demo reserve that never touches a URL (23.09 audit, S03)', () => {
  const access = (env: ReturnType<typeof testEnv>, key: string | null, init: { origin?: string | null; sameSite?: string } = {}) =>
    worker.fetch(
      request('/api/demo-access', { method: 'POST', ...init, headers: key === null ? {} : { 'x-demo-key': key } }),
      env,
    );

  it('says yes to the right key, before any check spends anything', async () => {
    const seen = routeUpstreams();
    const res = await access(testEnv({ DEMO_KEY: 'operator-secret' }), 'operator-secret');
    expect(res.status).toBe(204);
    expect(seen).toEqual([]);
  });

  it('says no to a wrong key, a near miss, and no key at all', async () => {
    const env = testEnv({ DEMO_KEY: 'operator-secret' });
    expect((await access(env, 'operator-secreT')).status).toBe(403);
    // One character short. (A trailing space would not be a near miss: the
    // Fetch spec strips whitespace around a header value before anyone sees it.)
    expect((await access(env, 'operator-secre')).status).toBe(403);
    expect((await access(env, null)).status).toBe(403);
  });

  it('grants nothing when the server has no key set, however the request asks', async () => {
    expect((await access(testEnv({ DEMO_KEY: '' }), '')).status).toBe(403);
    expect((await access(testEnv(), 'anything')).status).toBe(403);
  });

  it('answers only this site, and only a POST', async () => {
    const env = testEnv({ DEMO_KEY: 'operator-secret' });
    expect((await access(env, 'operator-secret', { origin: 'https://evil.example', sameSite: 'cross-site' })).status).toBe(403);
    const get = await worker.fetch(request('/api/demo-access', { headers: { 'x-demo-key': 'operator-secret' } }), env);
    expect(get.status).toBe(405);
  });
});
