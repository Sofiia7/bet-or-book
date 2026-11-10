import { afterEach, describe, expect, it, vi } from 'vitest';
import perpDexsFixture from '../fixtures/hyperliquid/perp-dexs.json';
import mainFixture from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import xyzFixture from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import { readAllDexPositions, reusePositions, type AllDexPositions, type PositionsReader } from '../../src/sources/positions';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import { FakeKV } from '../support/fakeKv';
import type { KVLike } from '../../src/kv';

const ADDRESS = '0x00000000000000000000000000000000000000aa';
const NAMES = ['xyz', 'flx', 'vntl', 'hyna', 'km', 'abcd', 'cash', 'para', 'mkts', 'io'];
const MAIN_COINS = (mainFixture as HlClearinghouseState).assetPositions.map((p) => p.position.coin);
const XYZ_COINS = (xyzFixture as HlClearinghouseState).assetPositions.map((p) => p.position.coin);

type Body = Record<string, unknown>;
/** One canned answer. A factory, because a Response body can be read only once. */
type Reply = (init: RequestInit) => Response | Promise<Response>;

const reply = (body: unknown, status = 200): Reply => () => new Response(JSON.stringify(body), { status });

function position(coin: string): HlClearinghouseState['assetPositions'][number] {
  return {
    type: 'oneWay',
    position: {
      coin,
      szi: '1',
      entryPx: '10',
      leverage: { type: 'cross', value: 5 },
      liquidationPx: null,
      positionValue: '10',
      unrealizedPnl: '0',
      cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
      marginUsed: '2',
      maxLeverage: 10,
      returnOnEquity: '0',
    },
  };
}

function state(coins: string[] = [], time = 1_790_000_000_000): HlClearinghouseState {
  return {
    assetPositions: coins.map(position),
    marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
    withdrawable: '0.0',
    time,
  };
}

interface World {
  /** The perpDexs answer; the fixture's registry (ten named dexes) by default. */
  registry?: Reply;
  /** The main-dex clearinghouse answer; the Abraxas capture by default. */
  main?: Reply;
  /** Named-dex answers; `xyz` is the Abraxas capture, every other dex an empty state. */
  dex?: Record<string, Reply>;
}

/** Stubs fetch by request body, the way the real endpoint tells requests apart. */
function stubHyperliquid(world: World = {}): Body[] {
  const requests: Body[] = [];
  global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    requests.push(body);
    if (body.type === 'perpDexs') return (world.registry ?? reply(perpDexsFixture))(init);
    if (body.type === 'clearinghouseState') {
      if (body.dex === undefined) return (world.main ?? reply(mainFixture))(init);
      const named = world.dex?.[String(body.dex)];
      if (named) return named(init);
      return body.dex === 'xyz' ? reply(xyzFixture)(init) : reply(state())(init);
    }
    throw new Error(`unexpected request ${String(body.type)}`);
  }) as unknown as typeof fetch;
  return requests;
}

const registryReads = (requests: Body[]): number => requests.filter((r) => r.type === 'perpDexs').length;

describe('readAllDexPositions', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('merges main and named dexes, main first, in registry order', async () => {
    const requests = stubHyperliquid({
      // vntl comes after xyz in the registry; answering xyz later than vntl
      // shows the order is the registry's, not the order answers arrive in.
      dex: {
        xyz: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return new Response(JSON.stringify(xyzFixture));
        },
        vntl: reply(state(['vntl:SPACEX'])),
      },
    });

    const result = await readAllDexPositions(ADDRESS);

    expect(result.positions.map((p) => p.coin)).toEqual([...MAIN_COINS, ...XYZ_COINS, 'vntl:SPACEX']);
    expect(result.mainDexCount).toBe(MAIN_COINS.length);
    expect(result.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.coverage).toBe('complete');
    expect(result.failed).toEqual([]);
    expect(result.mainState.assetPositions).toHaveLength(MAIN_COINS.length);

    // One registry read, one main-dex read without a dex, one read per named dex.
    expect(registryReads(requests)).toBe(1);
    const clearinghouse = requests.filter((r) => r.type === 'clearinghouseState');
    expect(clearinghouse.filter((r) => r.dex === undefined)).toHaveLength(1);
    expect(clearinghouse.map((r) => r.dex).filter((d) => d !== undefined)).toEqual(expect.arrayContaining(NAMES));
    expect(clearinghouse).toHaveLength(11);
    expect(clearinghouse.every((r) => r.user === ADDRESS)).toBe(true);
  });

  it('an address with no positions anywhere is complete with zero positions', async () => {
    stubHyperliquid({ main: reply(state()), dex: { xyz: reply(state()) } });

    const result = await readAllDexPositions(ADDRESS);

    expect(result.positions).toEqual([]);
    expect(result.mainDexCount).toBe(0);
    expect(result.coverage).toBe('complete');
    expect(result.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.failed).toEqual([]);
  });

  it('a named dex that answers 503 makes the reading partial and is named in failed', async () => {
    stubHyperliquid({ dex: { xyz: reply({ error: 'unavailable' }, 503), flx: reply(state(['flx:X'])) } });

    const result = await readAllDexPositions(ADDRESS);

    expect(result.failed).toEqual(['xyz']);
    expect(result.coverage).toBe('partial');
    expect(result.venues).toEqual({ asked: 11, answered: 10, registryRead: true });
    // The dexes that did answer keep their positions.
    expect(result.positions.map((p) => p.coin)).toEqual([...MAIN_COINS, 'flx:X']);
  });

  it('a named dex that answers 200 with junk counts as failed, not as a TypeError', async () => {
    stubHyperliquid({ dex: { xyz: reply({}) } });

    const result = await readAllDexPositions(ADDRESS);

    expect(result.failed).toEqual(['xyz']);
    expect(result.coverage).toBe('partial');
    expect(result.venues).toEqual({ asked: 11, answered: 10, registryRead: true });
    expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
  });

  it('a named dex with one unreadable row counts as failed and contributes none of its rows', async () => {
    const broken = state(['xyz:GOLD', 'xyz:MU']);
    broken.assetPositions[1].position.szi = 'abc';
    stubHyperliquid({ dex: { xyz: reply(broken) } });

    const result = await readAllDexPositions(ADDRESS);

    expect(result.failed).toEqual(['xyz']);
    expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
  });

  describe('a named dex answers for that dex and no other', () => {
    it("a named dex that answers with the main dex's state is failed, not listed a second time", async () => {
      stubHyperliquid({ dex: { xyz: reply(mainFixture) } });

      const result = await readAllDexPositions(ADDRESS);

      expect(result.failed).toEqual(['xyz']);
      expect(result.coverage).toBe('partial');
      expect(result.venues).toEqual({ asked: 11, answered: 10, registryRead: true });
      // The main dex's positions appear once, and the named dex contributes none.
      expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
      expect(result.mainDexCount).toBe(MAIN_COINS.length);
    });

    it('an endpoint that ignores the dex parameter does not list every main position once per dex', async () => {
      global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Body;
        return new Response(JSON.stringify(body.type === 'perpDexs' ? perpDexsFixture : mainFixture));
      }) as unknown as typeof fetch;

      const result = await readAllDexPositions(ADDRESS);

      expect(result.failed).toEqual(NAMES);
      expect(result.coverage).toBe('partial');
      expect(result.venues).toEqual({ asked: 11, answered: 1, registryRead: true });
      expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
    });

    it("a named dex that answers with another dex's coins, or with any coin that is not its own, is failed whole", async () => {
      stubHyperliquid({
        dex: {
          // Every row is another dex's.
          xyz: reply(state(['flx:X'])),
          // One row is its own and one is not: none of the rows is taken.
          flx: reply(state(['flx:OK', 'xyz:GOLD'])),
          // A main-dex row, with no prefix at all.
          vntl: reply(state(['vntl:SPACEX', 'BTC'])),
          // A prefix that only starts like its own name.
          hyna: reply(state(['hynax:Y'])),
          // Its own, answered whole: kept.
          km: reply(state(['km:US500'])),
        },
      });

      const result = await readAllDexPositions(ADDRESS);

      expect(result.failed).toEqual(['xyz', 'flx', 'vntl', 'hyna']);
      expect(result.coverage).toBe('partial');
      expect(result.venues).toEqual({ asked: 11, answered: 7, registryRead: true });
      expect(result.positions.map((p) => p.coin)).toEqual([...MAIN_COINS, 'km:US500']);
    });

    it('a named dex with no positions is a good answer', async () => {
      stubHyperliquid({ dex: { xyz: reply(state()) } });

      const result = await readAllDexPositions(ADDRESS);

      expect(result.failed).toEqual([]);
      expect(result.coverage).toBe('complete');
      expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
    });

    it('a main-dex answer that carries named-dex positions rejects the whole call', async () => {
      // Counted again by the dex that owns them, they would be counted twice.
      const requests = stubHyperliquid({ main: reply(state(['BTC', 'xyz:GOLD'])) });

      await expect(readAllDexPositions(ADDRESS)).rejects.toThrow(/main dex answered with named-dex positions/);
      // Nothing is asked of the named dexes once the main answer is known to be wrong.
      expect(requests.filter((r) => r.type === 'clearinghouseState' && r.dex !== undefined)).toEqual([]);
    });

    it('a main-dex answer that carries named-dex positions rejects also when the dex list could not be read', async () => {
      stubHyperliquid({ main: reply(state(['xyz:GOLD'])), registry: reply({ error: 'unavailable' }, 503) });

      await expect(readAllDexPositions(ADDRESS)).rejects.toThrow(/main dex answered with named-dex positions/);
    });
  });

  it('an unreadable registry gives main dex only, partial, registryRead false', async () => {
    for (const registry of [reply({ error: 'unavailable' }, 503), reply({})]) {
      const requests = stubHyperliquid({ registry });

      const result = await readAllDexPositions(ADDRESS);

      expect(result.coverage).toBe('partial');
      expect(result.venues).toEqual({ asked: 1, answered: 1, registryRead: false });
      expect(result.positions.map((p) => p.coin)).toEqual(MAIN_COINS);
      expect(result.mainDexCount).toBe(MAIN_COINS.length);
      expect(result.failed).toEqual([]);
      // No dex name is known, so none is asked for.
      expect(requests.filter((r) => r.type === 'clearinghouseState' && r.dex !== undefined)).toEqual([]);
    }
  });

  it('a registry that lists no named dex is an unread registry: partial, main dex only', async () => {
    for (const registry of [reply([null]), reply([])]) {
      stubHyperliquid({ registry });
      const result = await readAllDexPositions(ADDRESS);
      expect(result.coverage).toBe('partial');
      expect(result.venues).toEqual({ asked: 1, answered: 1, registryRead: false });
    }
  });

  it('an unreadable main dex rejects', async () => {
    stubHyperliquid({ main: reply({ error: 'unavailable' }, 503) });
    await expect(readAllDexPositions(ADDRESS)).rejects.toThrow();
  });

  it('a main dex that answers 200 with junk rejects', async () => {
    stubHyperliquid({ main: reply({}) });
    await expect(readAllDexPositions(ADDRESS)).rejects.toThrow();
  });

  it('a repeated dex name is read once', async () => {
    const requests = stubHyperliquid({
      registry: reply([null, { name: 'xyz' }, { name: 'flx' }, { name: 'xyz' }]),
    });

    const result = await readAllDexPositions(ADDRESS);

    expect(requests.filter((r) => r.type === 'clearinghouseState' && r.dex === 'xyz')).toHaveLength(1);
    expect(result.venues).toEqual({ asked: 3, answered: 3, registryRead: true });
    // Read twice, the dex's positions would be counted twice.
    expect(result.positions.map((p) => p.coin)).toEqual([...MAIN_COINS, ...XYZ_COINS]);
  });

  describe('measuredAt', () => {
    it('is the oldest time among the answers', async () => {
      stubHyperliquid({
        main: reply(state([], 3000)),
        dex: { xyz: reply(state([], 1000)), vntl: reply(state([], 2000)), flx: reply(state([], 5000)) },
      });
      // Every other dex answers the default empty state, stamped far later.
      expect((await readAllDexPositions(ADDRESS)).measuredAt).toBe(1000);

      stubHyperliquid({ main: reply(state([], 500)), dex: { xyz: reply(state([], 1000)) } });
      expect((await readAllDexPositions(ADDRESS)).measuredAt).toBe(500);
    });

    it('ignores a dex that did not answer, and answers that carry no usable time', async () => {
      // The failed dex would have been the oldest; it is not an answer.
      stubHyperliquid({
        main: reply(state([], 4000)),
        dex: { xyz: reply({ error: 'unavailable' }, 503), flx: reply(state([], 0)), vntl: reply({ ...state(), time: 'soon' }) },
      });
      expect((await readAllDexPositions(ADDRESS)).measuredAt).toBe(4000);
    });

    it('is null when no answer carries a time', async () => {
      const noTime = { ...state(), time: 0 };
      stubHyperliquid({ registry: reply([null, { name: 'xyz' }]), main: reply(noTime), dex: { xyz: reply(noTime) } });
      const result = await readAllDexPositions(ADDRESS);
      expect(result.measuredAt).toBeNull();
      expect(result.venues).toEqual({ asked: 2, answered: 2, registryRead: true });
    });
  });

  it('an abort signal that fires mid-read rejects instead of returning a partial claim of complete', async () => {
    const controller = new AbortController();
    stubHyperliquid({
      // xyz never answers; the check's deadline fires while it is in flight.
      dex: {
        xyz: (init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
            setTimeout(() => controller.abort(new Error('check deadline')), 10);
          }),
      },
    });

    await expect(readAllDexPositions(ADDRESS, { signal: controller.signal })).rejects.toThrow();
  });

  it('passes the caller signal on to every request', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const controller = new AbortController();
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.signal);
      const body = JSON.parse(String(init.body)) as Body;
      return new Response(JSON.stringify(body.type === 'perpDexs' ? perpDexsFixture : state()));
    }) as unknown as typeof fetch;

    await readAllDexPositions(ADDRESS, { signal: controller.signal });

    expect(seen).toHaveLength(12);
    // A request-level signal derived from the caller's: aborting the caller aborts it.
    controller.abort();
    expect(seen.every((s) => s?.aborted === true)).toBe(true);
  });

  describe('dex name cache', () => {
    const KEY = 'perp-dex-registry:v1';

    it('caches the dex names in KV for an hour and reuses them', async () => {
      let at = 1_000_000;
      const kv = new FakeKV();
      kv.now = () => at;
      const requests = stubHyperliquid();

      const first = await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(1);
      expect(kv.ttlOf(KEY)).toBe(3600);
      expect(JSON.parse((await kv.get(KEY)) as string)).toEqual(perpDexsFixture);

      at += 30 * 60 * 1000;
      const second = await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(1);
      expect(second.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
      expect(second.positions).toEqual(first.positions);

      // Past the hour the entry is gone and the registry is asked again.
      at += 31 * 60 * 1000;
      await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(2);
    });

    it('ignores a malformed cached value and refetches', async () => {
      for (const bad of ['not json', '{"not":"a list"}', '"xyz"', '[1,2]', '[{"name":"has space"}]', '[{"name":7}]', '']) {
        const kv = new FakeKV();
        await kv.put(KEY, bad);
        const requests = stubHyperliquid();

        const result = await readAllDexPositions(ADDRESS, { kv });

        expect(registryReads(requests), bad).toBe(1);
        expect(result.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
        // The refetched, valid names replace the bad value.
        expect(JSON.parse((await kv.get(KEY)) as string)).toEqual(perpDexsFixture);
      }
    });

    it('does not cache a failed registry read', async () => {
      const kv = new FakeKV();
      stubHyperliquid({ registry: reply({ error: 'unavailable' }, 503) });
      const failed = await readAllDexPositions(ADDRESS, { kv });
      expect(failed.venues.registryRead).toBe(false);
      expect(kv.size()).toBe(0);

      stubHyperliquid({ registry: reply({}) });
      await readAllDexPositions(ADDRESS, { kv });
      expect(kv.size()).toBe(0);

      // The next reading asks again, and a good answer is cached.
      const requests = stubHyperliquid();
      const ok = await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(1);
      expect(ok.venues.registryRead).toBe(true);
      expect(kv.size()).toBe(1);
    });

    it('does not cache a registry with no named dex, and ignores a cached one', async () => {
      const kv = new FakeKV();
      stubHyperliquid({ registry: reply([null]) });
      await readAllDexPositions(ADDRESS, { kv });
      expect(kv.size()).toBe(0);

      await kv.put(KEY, JSON.stringify([null]));
      const requests = stubHyperliquid();
      const result = await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(1);
      expect(result.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
    });

    it('reads a cached list of dex names without asking the registry, duplicates included once', async () => {
      const kv = new FakeKV();
      await kv.put(KEY, JSON.stringify([null, { name: 'xyz' }, { name: 'flx' }, { name: 'xyz' }]));
      const requests = stubHyperliquid();

      const result = await readAllDexPositions(ADDRESS, { kv });

      expect(registryReads(requests)).toBe(0);
      expect(requests.filter((r) => r.type === 'clearinghouseState' && r.dex === 'xyz')).toHaveLength(1);
      expect(result.venues).toEqual({ asked: 3, answered: 3, registryRead: true });
    });

    it('returns the registry the names were taken from, fresh or cached', async () => {
      const fresh = await (async () => {
        stubHyperliquid();
        return readAllDexPositions(ADDRESS);
      })();
      expect(fresh.registry).toEqual(perpDexsFixture);

      const kv = new FakeKV();
      const cachedRegistry = [null, { name: 'xyz' }];
      await kv.put(KEY, JSON.stringify(cachedRegistry));
      const requests = stubHyperliquid();
      const cached = await readAllDexPositions(ADDRESS, { kv });
      expect(registryReads(requests)).toBe(0);
      expect(cached.registry).toEqual(cachedRegistry);
    });

    it('has no registry when it could not be read', async () => {
      stubHyperliquid({ registry: reply({ error: 'unavailable' }, 503) });
      expect((await readAllDexPositions(ADDRESS)).registry).toBeNull();
    });

    it('works when KV throws', async () => {
      const broken: KVLike = {
        get: async () => {
          throw new Error('kv down');
        },
        put: async () => {
          throw new Error('kv down');
        },
      };
      stubHyperliquid();

      const result = await readAllDexPositions(ADDRESS, { kv: broken });

      expect(result.coverage).toBe('complete');
      expect(result.venues).toEqual({ asked: 11, answered: 11, registryRead: true });
    });
  });
});

describe('reusePositions', () => {
  const KEY = 'source-positions:v2:' + ADDRESS;

  function reading(overrides: Partial<AllDexPositions> = {}): AllDexPositions {
    return {
      positions: [],
      coverage: 'complete',
      measuredAt: 999,
      venues: { asked: 11, answered: 11, registryRead: true },
      failed: [],
      mainDexCount: 0,
      mainState: state(),
      registry: null,
      ...overrides,
    };
  }

  it('reuses a complete read for 60 seconds and re-reads after', async () => {
    let at = 1000;
    const kv = new FakeKV();
    kv.now = () => at;
    const data = reading();
    const read = vi.fn<PositionsReader>(async () => data);
    const cached = reusePositions(read, kv, () => at);

    expect(await cached(ADDRESS)).toEqual(data);
    // Written under the v2 key, for the same minute the old wrapper used.
    expect(kv.ttlOf(KEY)).toBe(60);

    at += 20_000;
    // The provider's own timestamp comes back untouched.
    expect(await cached(ADDRESS)).toEqual(data);
    expect(read).toHaveBeenCalledTimes(1);

    at += 61_000;
    await cached(ADDRESS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps one entry per address', async () => {
    const kv = new FakeKV();
    const read = vi.fn<PositionsReader>(async () => reading());
    const cached = reusePositions(read, kv);

    await cached(ADDRESS);
    await cached('0x00000000000000000000000000000000000000bb');

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never caches a partial read', async () => {
    const kv = new FakeKV();
    const read = vi.fn<PositionsReader>(async () => reading({ coverage: 'partial', failed: ['xyz'] }));
    const cached = reusePositions(read, kv);

    await cached(ADDRESS);
    await cached(ADDRESS);

    expect(read).toHaveBeenCalledTimes(2);
    expect(kv.size()).toBe(0);
  });

  it('passes the signal on and lets a rejected read reject without caching it', async () => {
    const kv = new FakeKV();
    const controller = new AbortController();
    const read = vi.fn<PositionsReader>(async () => {
      throw new Error('main dex down');
    });
    const cached = reusePositions(read, kv);

    await expect(cached(ADDRESS, controller.signal)).rejects.toThrow('main dex down');

    expect(read).toHaveBeenCalledWith(ADDRESS, controller.signal);
    expect(kv.size()).toBe(0);
  });

  it('ignores a cached entry that is not an AllDexPositions', async () => {
    const bad: unknown[] = [
      { at: 1000, data: {} },
      { at: 1000, data: null },
      { at: 1000, data: 'complete' },
      { at: 1000, data: { positions: {}, coverage: 'complete' } },
      { at: 1000, data: { positions: [] } },
      { at: 1000, data: { positions: [], coverage: 1 } },
      // The old wrapper's shape under the new key.
      { at: 1000, data: { asset_positions: [], timestamp: 999 } },
      // Stamped in the future: the clock went backwards, so the entry is not trusted.
      { at: 5000, data: reading() },
      null,
    ];
    for (const entry of bad) {
      const kv = new FakeKV();
      kv.now = () => 1000;
      await kv.put(KEY, JSON.stringify(entry), { expirationTtl: 60 });
      const fresh = reading({ measuredAt: 1 });
      const read = vi.fn<PositionsReader>(async () => fresh);

      expect(await reusePositions(read, kv, () => 1000)(ADDRESS), JSON.stringify(entry)).toEqual(fresh);
      expect(read, JSON.stringify(entry)).toHaveBeenCalledTimes(1);
    }

    // Text that is not JSON at all.
    const kv = new FakeKV();
    await kv.put(KEY, 'not json');
    const read = vi.fn<PositionsReader>(async () => reading());
    await reusePositions(read, kv)(ADDRESS);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('ignores a cached entry whose coverage is not complete, and reads again', async () => {
    // Only a complete reading is ever written; one that says otherwise was
    // not written by this wrapper, and handing it out would keep a gap open.
    for (const coverage of ['partial', 'unavailable', 'Complete', '']) {
      const kv = new FakeKV();
      kv.now = () => 1000;
      await kv.put(KEY, JSON.stringify({ at: 1000, data: reading({ coverage: coverage as AllDexPositions['coverage'], failed: ['xyz'] }) }), { expirationTtl: 60 });
      const fresh = reading({ measuredAt: 1 });
      const read = vi.fn<PositionsReader>(async () => fresh);

      expect(await reusePositions(read, kv, () => 1000)(ADDRESS), coverage).toEqual(fresh);
      expect(read, coverage).toHaveBeenCalledTimes(1);
    }
  });

  it('hands out an entry cached before the registry was part of it, as registry: null', async () => {
    const kv = new FakeKV();
    kv.now = () => 1000;
    const { registry: _registry, ...old } = reading();
    await kv.put(KEY, JSON.stringify({ at: 1000, data: old }), { expirationTtl: 60 });
    const read = vi.fn<PositionsReader>(async () => reading({ measuredAt: 1 }));

    const got = await reusePositions(read, kv, () => 1000)(ADDRESS);

    expect(read).not.toHaveBeenCalled();
    expect(got.registry ?? null).toBeNull();
  });

  it('hands out an entry whose registry is an array, and refuses one whose registry is not', async () => {
    const withRegistry = async (registry: unknown) => {
      const kv = new FakeKV();
      kv.now = () => 1000;
      await kv.put(KEY, JSON.stringify({ at: 1000, data: { ...reading(), registry } }), { expirationTtl: 60 });
      const read = vi.fn<PositionsReader>(async () => reading({ measuredAt: 1 }));
      await reusePositions(read, kv, () => 1000)(ADDRESS);
      return read.mock.calls.length;
    };
    expect(await withRegistry([null, { name: 'xyz' }])).toBe(0);
    expect(await withRegistry(null)).toBe(0);
    expect(await withRegistry({ not: 'a list' })).toBe(1);
  });

  it('a KV failure does not block a live read', async () => {
    const broken: KVLike = {
      get: async () => {
        throw new Error('kv down');
      },
      put: async () => {
        throw new Error('kv down');
      },
    };
    const data = reading();
    const read = vi.fn<PositionsReader>(async () => data);

    expect(await reusePositions(read, broken)(ADDRESS)).toEqual(data);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
