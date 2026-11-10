import { afterAll, expect, it } from 'vitest';
import { buildWorker, removeBuild, startWorker, tempDir } from './harness';
import featured from '../../data/featured.json';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';
import type { Miniflare } from 'miniflare';
import { Response } from 'miniflare';

afterAll(removeBuild);
const baseline = featured.entries.find(e => e.snapshotId === '0aio3f82kqsu9')!;
const callFor = async (mf: Miniflare) => {
  const ns = await mf.getDurableObjectNamespace('PILOT_WATCH');
  const stub = ns.get(ns.idFromName('pilot'));
  return async (body: unknown) => {
    const res = await stub.fetch('https://watch.internal/', { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
};
it('persists capacity, leases only one job per hour and never advances on an unsaved result', async () => {
  buildWorker();
  const disk = tempDir();
  const at = Date.now(); let mf: Miniflare | undefined;
  const start = (now: number) => startWorker({ persist: disk.path, vars: { TEST_NOW: String(now) }, upstream: () => { throw new Error('Monitoring coordination must not call a provider'); } });
  try {
    mf = await start(at); let call = await callFor(mf);
    const first = await call({ action: 'subscribe', baseline });
    expect(first.status).toBe(200);
    expect((await call({ action: 'subscribe', baseline })).status).toBe(409);
    const others = await Promise.all(Array.from({ length: 5 }, (_, i) => call({ action: 'subscribe', baseline: { ...baseline, address: '0x' + String(i + 1).padStart(40, '0') } })));
    expect(others.filter(r => r.status === 200)).toHaveLength(3);
    // Said on the Saved screen, under the Monitor switch just pressed: it
    // names the control a saved card still has for a new reading.
    expect(others.filter(r => r.status === 409).map(r => r.body.error)).toEqual(Array(2).fill('The four pilot monitoring slots are full. Use Refresh on this saved position for a new reading.'));
    expect((await call({ action: 'claim' })).body).toBeNull();
    await mf.dispose(); mf = await start(at + 4 * 3600000); call = await callFor(mf);
    const claims = await Promise.all(Array.from({ length: 8 }, () => call({ action: 'claim' })));
    const jobs = claims.map(r => r.body).filter(Boolean); expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect((await call({ action: 'complete', id: job.id, lease: job.lease - 1, result: baseline })).body.ok).toBe(false);
    await call({ action: 'complete', id: job.id, lease: job.lease, result: { ...baseline, snapshotSaved: false } });
    const status = await call({ action: 'status', token: first.body.token });
    expect(status.body.status).toContain('Paused'); expect(status.body.events).toEqual([]);
    expect(status.body).not.toHaveProperty('token');
    await mf.dispose(); mf = await start(at + 73 * 3600000); call = await callFor(mf);
    expect((await call({ action: 'status', token: first.body.token })).status).toBe(404);
    expect((await call({ action: 'claim' })).body).toBeNull();
  } finally { await mf?.dispose(); disk.remove(); }
}, 120000);

it('runs a due selected-position check through the public path and deduplicates repeated cron delivery', async () => {
  const disk = tempDir(); const at = Date.now(); let mf: Miniflare | undefined; let paid = 0; let positionReads = 0;
  // The watched position, a HYPE long, is now $1M on the main dex, nothing on
  // the named dexes. Positions come from Hyperliquid, free, and a check asks
  // Nansen nothing: the job runs on the public path, and a request to Nansen
  // would be counted here.
  const hypeLong = { type: 'oneWay', position: { coin: 'HYPE', szi: '100000', entryPx: '10', leverage: { type: 'cross', value: 2 }, liquidationPx: null, positionValue: '1000000', unrealizedPnl: '0', cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' }, marginUsed: '500000', maxLeverage: 10, returnOnEquity: '0' } };
  const dexState = (positions: unknown[]) => ({ assetPositions: positions, marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' }, withdrawable: '0.0', time: at });
  const upstream = async (request: Request) => {
    const body = JSON.parse(await request.text()); const url = new URL(request.url);
    if (url.hostname.includes('nansen')) {
      paid++;
      return new Response('{}', { status: 500 }) as unknown as globalThis.Response;
    }
    if (body.type === 'clearinghouseState' && body.dex === undefined) positionReads++;
    const free: Record<string, unknown> = { perpDexs, clearinghouseState: dexState(body.dex === undefined ? [hypeLong] : []), frontendOpenOrders: [], userFillsByTime: [], spotClearinghouseState: { balances: [] }, spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []], metaAndAssetCtxs: [{ universe: [] }, []] };
    return new Response(JSON.stringify(free[body.type] ?? [])) as unknown as globalThis.Response;
  };
  const start = (now: number) => startWorker({ persist: disk.path, vars: { TEST_NOW: String(now) }, upstream });
  try {
    mf = await start(at - 4 * 3600000); let call = await callFor(mf);
    const subscribed = await call({ action: 'subscribe', baseline });
    await mf.dispose(); mf = await start(at); call = await callFor(mf);
    const run = () => mf!.dispatchFetch('http://localhost/__test/scheduled', { method: 'POST' });
    expect((await run()).status).toBe(200);
    const status = (await call({ action: 'status', token: subscribed.body.token })).body;
    expect(status.status).toContain('meaningful change found'); expect(status.events).toHaveLength(1);
    expect(positionReads).toBe(1);
    expect(paid).toBe(0);
    // The same cron delivered again in the same hour runs no second check.
    await run(); expect(positionReads).toBe(1); expect(paid).toBe(0);
  } finally { await mf?.dispose(); disk.remove(); }
}, 120000);
