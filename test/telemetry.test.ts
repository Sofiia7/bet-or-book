// S06, audit of 23.09: something to count. Every route that decides what a
// reader gets now leaves one JSON line saying what happened, how long it
// took - and none of them names the wallet, the client or a key.
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import { FakeKV } from './support/fakeKv';
import { hlPosition } from './support/upstream';
import portfolioFixture from './fixtures/hyperliquid/portfolio-abraxas.json';
import { emit, readingFields } from '../src/telemetry';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const API_KEY = 'explorer-key-that-must-never-be-logged';
const CLIENT_IP = '198.51.100.23';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
  portfolio: portfolioFixture.portfolio,
};

function upstreams(over: Record<string, unknown> = {}) {
  const answers = { ...HL, ...over };
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    // A check asks Nansen nothing; a request to it would fail here.
    if (String(url).includes('nansen')) return new Response('{}', { status: 500 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(answers[body.type] ?? []), { status: 200 });
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

describe('a check leaves one line saying what it was', () => {
  it('counts a fresh check: its verdict, the reason that decided it, and whether it was kept', async () => {
    // A small long, whose funding history used to be two Nansen reads and is
    // the block explorer's now. A check makes no Nansen call, so the line
    // carries none of the Nansen cost fields older lines have.
    upstreams({ clearinghouseState: { assetPositions: [hlPosition('BTC', 500, 50_000_000)], time: Date.now() } });
    const env = testEnv({ BLOCKSCOUT_API_KEY: API_KEY });
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const checks = events.filter((e) => e.event === 'check');
    expect(checks).toHaveLength(1);
    const e = checks[0];
    expect(e.outcome).toBe('fresh');
    expect(typeof e.ms).toBe('number');
    expect(e.verdict).toEqual(expect.any(String));
    expect(e.rules).toEqual(expect.any(String));
    for (const field of ['nansenCalls', 'credits', 'creditsRemaining', 'creditsMeasuredAt', 'nansenOff']) {
      expect(e).not.toHaveProperty(field);
    }
    expect(e.saved).toBe(true);
    expect(e.kvDegraded).toBe(false);
    expect(e.focus).toBe(false);
    expect(e.demo).toBe(false);
  });

  it('says how completely the positions were read, so an unread dex can be counted', async () => {
    // A list of dexes with one named dex in it, and both answered: complete.
    upstreams({ perpDexs: [null, { name: 'xyz' }] });
    const env = testEnv({ BLOCKSCOUT_API_KEY: API_KEY });
    const complete = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    expect(complete.find((x) => x.event === 'check')!.positionsCoverage).toBe('complete');

    // The list of dexes could not be read: the main dex alone, and the line says so.
    upstreams({ perpDexs: { error: 'unavailable' } });
    const other = '0x2222222222222222222222222222222222222222';
    // A fresh environment: the list of dexes is kept in KV for an hour.
    const partial = await eventsOf(() => worker.fetch(post(`/api/check?address=${other}`), testEnv({ BLOCKSCOUT_API_KEY: API_KEY })));
    const e = partial.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('fresh');
    expect(e.positionsCoverage).toBe('partial');
    // `source` no longer says how much of the book was seen; this is the field that does.
    expect(e.source).toBe('hyperliquid');
  });

  // The credit meter that bounded spend is gone and the explorer's free key allows about 5,000 calls
  // a day, so the one place a spent or refused explorer shows is the reading's own coverage notes.
  // The line carries their text (chain names and reasons, nothing else) so it can be counted.
  it('lists the funding chains that were not read, so a spent explorer quota can be seen', async () => {
    // A small long: its funding history is read from the explorer as context. No key is
    // configured, so the Arbitrum read is refused and the reading says so in a coverage note.
    upstreams({ clearinghouseState: { assetPositions: [hlPosition('BTC', 500, 50_000_000)], time: Date.now() } });
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), testEnv()));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('fresh');
    expect(e.fundingLinksNotes).toEqual(expect.arrayContaining(['Funding links on Arbitrum were not read: no explorer key is configured']));
    for (const note of e.fundingLinksNotes as string[]) expect(note.startsWith('Funding links on ')).toBe(true);
    // Counting needs a field that says what was lost, not a cost: none is added.
    for (const field of ['nansenCalls', 'credits', 'creditsRemaining', 'creditsMeasuredAt', 'nansenOff', 'cost']) {
      expect(e).not.toHaveProperty(field);
    }
  });

  it('leaves the field out of a line whose reading searched no funding links', async () => {
    upstreams();
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), testEnv()));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('fresh');
    expect(e).not.toHaveProperty('fundingLinksNotes');
  });

  it('carries it on a repeat served from what is on record, too', async () => {
    upstreams({ perpDexs: [null, { name: 'xyz' }] });
    const env = testEnv();
    await worker.fetch(post(`/api/check?address=${ADDRESS}`), env);
    const events = await eventsOf(() => worker.fetch(post(`/api/check?address=${ADDRESS}`), env));
    const e = events.find((x) => x.event === 'check')!;
    expect(e.outcome).toBe('cached');
    expect(e.positionsCoverage).toBe('complete');
  });

  it('never writes the wallet, the client address or a key into any line', async () => {
    upstreams();
    const env = testEnv({ BLOCKSCOUT_API_KEY: API_KEY, DEMO_KEY: 'demo-secret' });
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

  it('adds how completely the positions were read when the reading says, and nothing when it does not', () => {
    const base = {
      verdict: { verdict: 'unknown' as const, strength: null, reasons: [] },
      classifierVersion: 'v5',
      degraded: true,
      source: 'hyperliquid' as const,
    };
    expect(readingFields({ ...base, positionsCoverage: 'partial' })).toMatchObject({ source: 'hyperliquid', positionsCoverage: 'partial' });
    expect(readingFields({ ...base, positionsCoverage: 'complete' })).toHaveProperty('positionsCoverage', 'complete');
    // A reading stored before the field existed adds no key rather than a null one.
    expect(readingFields(base as Parameters<typeof readingFields>[0])).not.toHaveProperty('positionsCoverage');
  });

  describe('fundingLinksNotes', () => {
    const base = {
      verdict: { verdict: 'unknown' as const, strength: null, reasons: [] },
      classifierVersion: 'v5',
      degraded: true,
      source: 'hyperliquid' as const,
    };
    const note = (text: string, failure = true) => ({ text, failure });

    it('carries the texts of the funding-link notes, and only those', () => {
      const fields = readingFields({
        ...base,
        coverageNotes: [
          note('Funding links on Arbitrum were not read: no explorer key is configured'),
          note('Orders were not read'),
          note('Funding links on Ethereum: the first page held no incoming transaction with a value, so the earliest funder may be missing', false),
          note('2 funding link(s) lead to an exchange or bridge and were not followed'),
        ],
      });
      expect(fields.fundingLinksNotes).toEqual([
        'Funding links on Arbitrum were not read: no explorer key is configured',
        'Funding links on Ethereum: the first page held no incoming transaction with a value, so the earliest funder may be missing',
      ]);
    });

    it('keeps at most four, each cut to 200 characters', () => {
      const long = 'Funding links on Arbitrum were not read: ' + 'x'.repeat(400);
      const fields = readingFields({
        ...base,
        coverageNotes: [1, 2, 3, 4, 5, 6].map((n) => note(`Funding links on chain ${n} could not be read`)).concat([note(long)]),
      });
      expect(fields.fundingLinksNotes).toHaveLength(4);
      expect(fields.fundingLinksNotes![3]).toBe('Funding links on chain 4 could not be read');
      expect(readingFields({ ...base, coverageNotes: [note(long)] }).fundingLinksNotes![0]).toHaveLength(200);
    });

    it('is absent when there is no such note, and for a reading stored without notes', () => {
      expect(readingFields({ ...base, coverageNotes: [] })).not.toHaveProperty('fundingLinksNotes');
      expect(readingFields({ ...base, coverageNotes: [note('PnL was not read')] })).not.toHaveProperty('fundingLinksNotes');
      expect(readingFields(base)).not.toHaveProperty('fundingLinksNotes');
      expect(readingFields({ ...base, coverageNotes: undefined })).not.toHaveProperty('fundingLinksNotes');
    });
  });
});
