// S05, audit of 23.09: the scenarios the in-process fakes cannot model, run
// against the real Worker inside real workerd (see ./harness.ts).
//
// The other tests drive src/index.ts through fake KV and fake Durable
// Objects in Node. Those prove the routing and the arithmetic; they do not
// model input and output gates, real Durable Object bindings, KV failing,
// or KV answering "not found" for something another region has just
// written. (The tests of the Nansen credit meter across a restart and an
// abandoned request went with the meter, stage 3.) Each test
// here is one of those, and each asserts the property that has to hold
// rather than the path taken to it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Response } from 'miniflare';
import type { Miniflare } from 'miniflare';
import { buildWorker, removeBuild, retiredMeterStatus, startWorker, type Upstream } from './harness';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';

const OPERATOR = 'operator-key-for-tests';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
};

/** One dex's clearinghouseState, holding `positions`. */
const dexState = (positions: unknown[]) => ({
  assetPositions: positions,
  marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
  withdrawable: '0.0',
  time: Date.now(),
});

/** A $1M ETH short on the main dex: a position whose cover is worth looking
 * for, so a check reaches every read a short can - the funding links on the
 * block explorer among them. None of them is Nansen's any more. */
const ETH_SHORT = {
  type: 'oneWay',
  position: {
    coin: 'ETH', szi: '-400', entryPx: '2500', leverage: { type: 'cross', value: 5 }, liquidationPx: null,
    positionValue: '1000000', unrealizedPnl: '0', cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
    marginUsed: '200000', maxLeverage: 25, returnOnEquity: '0',
  },
};

/** Hyperliquid's answer to one request: the registry capture (ten named
 * dexes), the short on the main dex, nothing on any named dex. */
function hyperliquidAnswer(body: { type: string; dex?: string }): unknown {
  if (body.type === 'perpDexs') return perpDexs;
  if (body.type === 'clearinghouseState') return dexState(body.dex === undefined ? [ETH_SHORT] : []);
  return HL[body.type] ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const address = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

/**
 * Hyperliquid and the block explorer, as the Worker sees them. A check is not
 * expected to reach Nansen at all; a request to it is counted and refused.
 * The explorer (keyless, so Ethereum only) answers that nothing funded the
 * account.
 */
function upstreams() {
  const seen = { nansen: 0, explorer: 0, hyperliquid: 0 };
  const handler: Upstream = async (request) => {
    const url = new URL(request.url);
    if (url.hostname.includes('nansen')) {
      seen.nansen++;
      return new Response('{}', { status: 500 }) as unknown as globalThis.Response;
    }
    if (url.hostname.endsWith('blockscout.com')) {
      seen.explorer++;
      return new Response(JSON.stringify({ items: [], next_page_params: null }), {
        headers: { 'content-type': 'application/json' },
      }) as unknown as globalThis.Response;
    }
    if (url.hostname === 'api.hyperliquid.xyz') {
      seen.hyperliquid++;
      const body = JSON.parse(await request.text()) as { type: string; dex?: string };
      return new Response(JSON.stringify(hyperliquidAnswer(body)), {
        headers: { 'content-type': 'application/json' },
      }) as unknown as globalThis.Response;
    }
    return new Response('no such upstream in this test', { status: 599 }) as unknown as globalThis.Response;
  };
  return { handler, seen };
}

interface Reading {
  address?: string;
  source?: string;
  nansenCalls?: number;
  coverage?: string[];
  snapshotId?: string;
  snapshotSaved?: boolean;
  share?: unknown;
}

async function check(mf: Miniflare, addr: string, headers: Record<string, string> = {}) {
  const res = await mf.dispatchFetch(`http://localhost/api/check?address=${addr}`, { method: 'POST', headers });
  return { status: res.status, body: (await res.json()) as Reading };
}

let running: Miniflare[] = [];
/** What each running Worker wrote to its console, kept out of the test
 * output and available to the tests that look at it. */
const logsOf = new Map<Miniflare, string[]>();

async function start(opts: Parameters<typeof startWorker>[0]): Promise<Miniflare> {
  const lines: string[] = [];
  const mf = await startWorker({ ...opts, onLog: (line) => lines.push(line) });
  logsOf.set(mf, lines);
  running.push(mf);
  return mf;
}

/** The structured events a Worker wrote (src/telemetry.ts), parsed. */
function eventsOf(mf: Miniflare): Array<Record<string, unknown>> {
  return (logsOf.get(mf) ?? [])
    .filter((line) => line.startsWith('{"event"'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeAll(() => {
  buildWorker();
}, 180_000);

afterAll(() => removeBuild());

afterEach(async () => {
  await Promise.all(running.map((m) => m.dispose()));
  running = [];
});

describe('no Nansen, in the real runtime', () => {
  it('overlapping checks make no Nansen call, and the retired meter still answers', async () => {
    // A check no longer reads from Nansen (stage 3): the funding links are the
    // block explorer's. Twelve checks arriving together, past both rate
    // limits with the operator key, reach Nansen not once.
    const up = upstreams();
    const mf = await start({ vars: { DEMO_KEY: OPERATOR }, upstream: up.handler });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => check(mf, address(i), { 'x-demo-key': OPERATOR })),
    );

    expect(results.every((r) => r.status === 200 && r.body.address)).toBe(true);
    expect(results.every((r) => r.body.nansenCalls === 0 && r.body.source === 'hyperliquid')).toBe(true);
    expect(results.some((r) => (r.body.coverage ?? []).join(' ').includes('Nansen'))).toBe(false);
    expect(up.seen.nansen).toBe(0);
    // Each short's funding links were asked of the explorer (keyless: Ethereum only).
    expect(up.seen.explorer).toBe(12);
    // The NansenBudget class is still exported and bound (deleting it takes a
    // migration); it does nothing but say so.
    expect(await retiredMeterStatus(mf)).toBe(410);
  }, 60_000); // Includes cold workerd startup.
});

describe('the rate limits, in real Durable Objects', () => {
  it('lets exactly the global burst allowance through when checks arrive together', async () => {
    const up = upstreams();
    const mf = await start({ upstream: up.handler });
    const statuses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        mf
          .dispatchFetch(`http://localhost/api/check?address=${address(i)}`, {
            method: 'POST',
            headers: { 'cf-connecting-ip': `203.0.113.${i + 1}` },
          })
          .then((r) => r.status),
      ),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  }, 60_000);
});

describe('when KV fails', () => {
  it('still answers a check and says it could not keep it', async () => {
    const up = upstreams();
    const mf = await start({ vars: { KV_MODE: 'down' }, upstream: up.handler });
    const { status, body } = await check(mf, address(0));
    expect(status).toBe(200);
    expect(body.snapshotSaved).toBe(false);
    // No id, and a share card with no link on it: a link to a reading that
    // was never kept would open nothing.
    expect(body.snapshotId).toBeUndefined();
    expect((body.share as { link: string | null }).link).toBeNull();
    expect(up.seen.nansen).toBe(0);
    // And the one line that lets anyone notice this happening on the live
    // site, written by the real runtime (23.09 audit, S06).
    const event = eventsOf(mf).find((e) => e.event === 'check');
    expect(event).toMatchObject({ outcome: 'fresh', kvDegraded: true, saved: false });
    // A check makes no Nansen call, so the line carries no Nansen cost.
    expect(event).not.toHaveProperty('nansenCalls');
    expect(event).not.toHaveProperty('credits');
  }, 60_000);

  it('still opens a gallery card, and gives a crawler the stand-in picture rather than an error', async () => {
    const up = upstreams();
    const mf = await start({ vars: { KV_MODE: 'down' }, upstream: up.handler });
    const gallery = (await (await mf.dispatchFetch('http://localhost/api/gallery')).json()) as {
      entries: Array<{ snapshotId: string }>;
    };
    const id = gallery.entries[0].snapshotId;
    expect((await mf.dispatchFetch(`http://localhost/api/snapshot?id=${id}`)).status).toBe(200);
    const og = await mf.dispatchFetch(`http://localhost/api/og?id=${id}`);
    expect(og.status).toBe(200);
    expect(og.headers.get('content-type')).toBe('image/png');
    expect(og.headers.get('cache-control')).not.toContain('immutable');
  }, 60_000);

  it('runs a repeat for real once the day\'s KV writes are gone', async () => {
    const up = upstreams();
    const mf = await start({ vars: { KV_MODE: 'read-only' }, upstream: up.handler });
    const first = await check(mf, address(0));
    const readsAfterFirst = up.seen.explorer;
    const second = await check(mf, address(0));
    expect(first.body.snapshotSaved).toBe(false);
    expect(second.body.snapshotSaved).toBe(false);
    // Nothing could be cached, so the repeat was a second whole check: it
    // asked the explorer again, and Nansen not at all.
    expect(readsAfterFirst).toBeGreaterThan(0);
    expect(up.seen.explorer).toBe(readsAfterFirst * 2);
    expect(up.seen.nansen).toBe(0);
  }, 60_000);
});

describe('a reading this region has not seen yet', () => {
  it('does not let "not found yet" be cached, or read as "never existed", and opens once KV catches up', async () => {
    const up = upstreams();
    const LAG_MS = 1500;
    const mf = await start({ vars: { KV_MODE: 'lagging', KV_LAG_MS: String(LAG_MS) }, upstream: up.handler });
    const { body } = await check(mf, address(0));
    expect(body.snapshotSaved).toBe(true);
    const id = body.snapshotId!;

    const early = await mf.dispatchFetch(`http://localhost/api/snapshot?id=${id}`);
    expect(early.status).toBe(404);
    expect(early.headers.get('cache-control')).toBe('no-store');
    const { error } = (await early.json()) as { error: string };
    expect(error).not.toMatch(/never existed/);
    expect(error).toMatch(/may still be saving/);
    expect(error).toMatch(/Try again shortly/);

    const picture = await mf.dispatchFetch(`http://localhost/api/og?id=${id}`);
    expect(picture.headers.get('cache-control')).toBe('public, max-age=60');

    await sleep(LAG_MS + 200);
    const later = await mf.dispatchFetch(`http://localhost/api/snapshot?id=${id}`);
    expect(later.status).toBe(200);
    expect(((await later.json()) as Reading).snapshotId).toBe(id);
  }, 60_000);
});
