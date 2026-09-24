// S05, audit of 23.09: the scenarios the in-process fakes cannot model, run
// against the real Worker inside real workerd (see ./harness.ts).
//
// The other tests drive src/index.ts through fake KV and fake Durable
// Objects in Node. Those prove the routing and the arithmetic; they do not
// model input and output gates, a Durable Object restarting with only its
// storage, a client going away mid-request, KV failing, or KV answering
// "not found" for something another region has just written. Each test
// here is one of those, and each asserts the property that has to hold
// rather than the path taken to it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Response } from 'miniflare';
import type { Miniflare } from 'miniflare';
import { buildWorker, budgetStub, removeBuild, startWorker, tempDir, type Upstream } from './harness';

/** Four worst-case checks' worth: WORST_CASE_CALLS is 7. */
const CAP = 28;
const WORST_CASE = 7;
const OPERATOR = 'operator-key-for-tests';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const address = (i: number) => `0x${(i + 1).toString(16).padStart(40, '0')}`;

/**
 * Hyperliquid and Nansen, as the Worker sees them. Nansen answers after
 * `nansenDelayMs`, or never; every call is counted, because a call that
 * reached Nansen may have been charged whether or not anyone heard back.
 */
function upstreams(opts: { nansenDelayMs?: number; nansenNeverAnswers?: boolean } = {}) {
  const seen = { nansen: 0 };
  let firstNansen: () => void = () => {};
  const nansenReached = new Promise<void>((resolve) => {
    firstNansen = resolve;
  });
  const handler: Upstream = async (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'api.nansen.ai') {
      seen.nansen++;
      firstNansen();
      if (opts.nansenNeverAnswers) return new Promise<never>(() => {});
      if (opts.nansenDelayMs) await sleep(opts.nansenDelayMs);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-nansen-credits-cost': '1',
          'x-nansen-credits-remaining': '900',
        },
      }) as unknown as globalThis.Response;
    }
    if (url.hostname === 'api.hyperliquid.xyz') {
      const body = JSON.parse(await request.text()) as { type: string };
      return new Response(JSON.stringify(HL[body.type] ?? []), {
        headers: { 'content-type': 'application/json' },
      }) as unknown as globalThis.Response;
    }
    return new Response('no such upstream in this test', { status: 599 }) as unknown as globalThis.Response;
  };
  return { handler, seen, nansenReached };
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
const cleanups: Array<() => void> = [];
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

async function stop(mf: Miniflare): Promise<void> {
  running = running.filter((m) => m !== mf);
  await mf.dispose();
}

beforeAll(() => {
  buildWorker();
}, 180_000);

afterAll(() => removeBuild());

afterEach(async () => {
  await Promise.all(running.map((m) => m.dispose()));
  running = [];
  while (cleanups.length) cleanups.pop()!();
});

describe('the spend cap, in a real Durable Object', () => {
  it('never lets overlapping checks hold or spend more than the cap, and charges exactly what was called', async () => {
    const up = upstreams({ nansenDelayMs: 400 });
    const mf = await start({
      vars: { NANSEN_API_KEY: 'test-key', NANSEN_DAILY_CREDIT_CAP: String(CAP), DEMO_KEY: OPERATOR },
      upstream: up.handler,
    });
    // The operator key skips both rate limits, so twelve checks from one
    // client really do arrive together and only the budget stands between
    // them and Nansen.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => check(mf, address(i), { 'x-demo-key': OPERATOR })),
    );

    expect(results.every((r) => r.status === 200 && r.body.address)).toBe(true);
    // How many got Nansen depends on how the twelve interleave, which is
    // the runtime's business; that the rest were told so, and that the
    // total stayed under the cap, is not.
    const paid = results.filter((r) => (r.body.nansenCalls ?? 0) > 0);
    const refused = results.filter((r) => (r.body.coverage ?? []).join(' ').includes('Nansen not used'));
    expect(paid.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    expect(paid.length + refused.length).toBe(results.length);
    expect(up.seen.nansen).toBeLessThanOrEqual(CAP);

    // Every hold has been settled to exactly what was called, with nothing
    // lost between reservations and settlements that interleaved: whatever
    // is left for a new check is the cap minus those calls, to the credit.
    const budget = await budgetStub(mf);
    expect(await budget.available(CAP)).toBe(CAP - up.seen.nansen);
  }, 60_000);

  it('charges a settle delivered twice once, including when the second comes after the object restarted', async () => {
    const state = tempDir();
    cleanups.push(state.remove);
    const up = upstreams();
    let mf = await start({ upstream: up.handler, persist: state.path });
    let budget = await budgetStub(mf);

    const first = await budget.reserve(WORST_CASE, CAP);
    expect(first.ok).toBe(true);
    await budget.settle(first.id!, 3);
    await budget.settle(first.id!, 3);
    expect(await budget.available(CAP)).toBe(CAP - 3);

    const second = await budget.reserve(WORST_CASE, CAP);
    expect(second.ok).toBe(true);

    // The process goes away. Memory is gone; SQLite storage is what is left.
    await stop(mf);
    mf = await start({ upstream: up.handler, persist: state.path });
    budget = await budgetStub(mf);

    // The hold taken before the restart still stands against the cap...
    expect(await budget.available(CAP)).toBe(CAP - 3 - WORST_CASE);
    // ...and settles to what it cost, once, however often it is delivered.
    await budget.settle(second.id!, 2);
    await budget.settle(second.id!, 2);
    expect(await budget.available(CAP)).toBe(CAP - 5);
  }, 90_000);

  it('keeps an aborted check\'s worst case held, since Nansen may already have served it', async () => {
    const up = upstreams({ nansenNeverAnswers: true });
    const mf = await start({
      vars: { NANSEN_API_KEY: 'test-key', NANSEN_DAILY_CREDIT_CAP: String(CAP), DEMO_KEY: OPERATOR },
      upstream: up.handler,
    });
    const reader = new AbortController();
    const pending = mf
      .dispatchFetch(`http://localhost/api/check?address=${address(0)}`, {
        method: 'POST',
        headers: { 'x-demo-key': OPERATOR },
        signal: reader.signal,
      })
      .catch((err: unknown) => err);

    await up.nansenReached;
    reader.abort();
    await pending;

    // The reader is gone and nothing has answered. Handing the credits back
    // now would treat "unknown" as "free"; they stay held until the check
    // either settles or expires and is charged at its worst case.
    const budget = await budgetStub(mf);
    expect(up.seen.nansen).toBeGreaterThan(0);
    expect(await budget.available(CAP)).toBe(CAP - WORST_CASE);
  }, 60_000);
});

describe('the call ledger, across a restart', () => {
  it('counts every one of many records that arrive together right after the object restarted', async () => {
    const state = tempDir();
    cleanups.push(state.remove);
    const up = upstreams();
    const call = { path: 'profiler/perp-positions', status: 200, creditsCost: 1 };

    let mf = await start({ upstream: up.handler, persist: state.path });
    await (await budgetStub(mf)).record([call]);
    await stop(mf);

    // The first requests after a restart all find the ledger unloaded. They
    // have to wait on one load, not each build their own and overwrite the
    // others (src/coordinator.ts).
    mf = await start({ upstream: up.handler, persist: state.path });
    const budget = await budgetStub(mf);
    await Promise.all(Array.from({ length: 20 }, () => budget.record([call])));
    expect((await budget.report()).calls.attempted).toBe(21);
  }, 90_000);
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
  it('still answers a check, says it could not keep it, and settles the budget', async () => {
    const up = upstreams();
    const mf = await start({
      vars: { NANSEN_API_KEY: 'test-key', NANSEN_DAILY_CREDIT_CAP: String(CAP), KV_MODE: 'down' },
      upstream: up.handler,
    });
    const { status, body } = await check(mf, address(0));
    expect(status).toBe(200);
    expect(body.snapshotSaved).toBe(false);
    // No id, and a share card with no link on it: a link to a reading that
    // was never kept would open nothing.
    expect(body.snapshotId).toBeUndefined();
    expect((body.share as { link: string | null }).link).toBeNull();
    expect(up.seen.nansen).toBeGreaterThan(0);
    expect(await (await budgetStub(mf)).available(CAP)).toBe(CAP - up.seen.nansen);
    // And the one line that lets anyone notice this happening on the live
    // site, written by the real runtime (23.09 audit, S06).
    expect(eventsOf(mf).find((e) => e.event === 'check')).toMatchObject({
      outcome: 'fresh',
      kvDegraded: true,
      saved: false,
      credits: up.seen.nansen,
    });
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

  it('runs a repeat for real once the day\'s KV writes are gone, and still charges only what was called', async () => {
    const up = upstreams();
    const mf = await start({
      vars: { NANSEN_API_KEY: 'test-key', NANSEN_DAILY_CREDIT_CAP: String(CAP), KV_MODE: 'read-only' },
      upstream: up.handler,
    });
    const first = await check(mf, address(0));
    const callsAfterFirst = up.seen.nansen;
    const second = await check(mf, address(0));
    expect(first.body.snapshotSaved).toBe(false);
    expect(second.body.snapshotSaved).toBe(false);
    // Nothing could be cached, so the repeat was a second paid check. The
    // cap is what bounds that, and it has to have counted both.
    expect(up.seen.nansen).toBe(callsAfterFirst * 2);
    expect(await (await budgetStub(mf)).available(CAP)).toBe(CAP - up.seen.nansen);
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
    expect(error).toMatch(/last minute/);

    const picture = await mf.dispatchFetch(`http://localhost/api/og?id=${id}`);
    expect(picture.headers.get('cache-control')).toBe('public, max-age=60');

    await sleep(LAG_MS + 200);
    const later = await mf.dispatchFetch(`http://localhost/api/snapshot?id=${id}`);
    expect(later.status).toBe(200);
    expect(((await later.json()) as Reading).snapshotId).toBe(id);
  }, 60_000);
});
