import { afterAll, expect, it } from 'vitest';
import { buildWorker, removeBuild, startWorker, tempDir } from './harness';
import featured from '../../data/featured.json';
import type { Miniflare } from 'miniflare';

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
