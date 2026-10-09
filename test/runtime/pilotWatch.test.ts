import { afterAll, expect, it } from 'vitest';
import { buildWorker, removeBuild, startWorker, tempDir } from './harness';
import featured from '../../data/featured.json';
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

it('runs a due selected-position check through the public budget and deduplicates repeated cron delivery', async () => {
  const disk = tempDir(); const at = Date.now(); let mf: Miniflare | undefined; let paid = 0;
  const upstream = async (request: Request) => {
    const body = JSON.parse(await request.text()); const url = new URL(request.url);
    if (url.hostname === 'api.nansen.ai') {
      paid++;
      const position = { token_symbol: 'HYPE', size: '100', position_value_usd: '1000000', entry_price_usd: '10', leverage_value: 2, leverage_type: 'cross', liquidation_price_usd: null, margin_used_usd: '1000', unrealized_pnl_usd: '0', cumulative_funding_since_open_usd: '0', return_on_equity: '0' };
      return new Response(JSON.stringify({ data: { asset_positions: [{ position, position_type: 'oneWay' }], timestamp: at, margin_summary_account_value_usd: '1000000', withdrawable_usd: '1000' } }), { headers: { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '500' } }) as unknown as globalThis.Response;
    }
    const free: Record<string, unknown> = { clearinghouseState: { assetPositions: [], time: at }, frontendOpenOrders: [], userFillsByTime: [], spotClearinghouseState: { balances: [] }, spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []], metaAndAssetCtxs: [{ universe: [] }, []] };
    return new Response(JSON.stringify(free[body.type] ?? [])) as unknown as globalThis.Response;
  };
  const start = (now: number) => startWorker({ persist: disk.path, vars: { TEST_NOW: String(now), NANSEN_API_KEY: 'test-key', NANSEN_DAILY_CREDIT_CAP: '20', NANSEN_DEMO_RESERVE: '18' }, upstream });
  try {
    mf = await start(at - 4 * 3600000); let call = await callFor(mf);
    const subscribed = await call({ action: 'subscribe', baseline });
    await mf.dispose(); mf = await start(at); call = await callFor(mf);
    const run = () => mf!.dispatchFetch('http://localhost/__test/scheduled', { method: 'POST' });
    expect((await run()).status).toBe(200);
    const status = (await call({ action: 'status', token: subscribed.body.token })).body;
    expect(status.status).toContain('meaningful change found'); expect(status.events).toHaveLength(1);
    expect(paid).toBe(1);
    await run(); expect(paid).toBe(1);
    // Only two public credits exist; the 18-credit demo reserve is untouched.
    const ns = await mf.getDurableObjectNamespace('NANSEN_BUDGET');
    const budget = ns.get(ns.idFromName('nansen-budget'));
    const probe = await budget.fetch('https://budget.internal/', { method: 'POST', body: JSON.stringify({ action: 'reserve', day: new Date().toISOString().slice(0,10), worstCase: 2, limits: { cap: 2, floor: 0 } }) });
    expect((await probe.json() as { ok: boolean }).ok).toBe(false);
  } finally { await mf?.dispose(); disk.remove(); }
}, 120000);
