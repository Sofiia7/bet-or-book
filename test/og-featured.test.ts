import { expect, it, vi } from 'vitest';
import worker from '../src/index';
import featured from '../data/featured.json';
import { testEnv, request } from './support/worker';
it('serves every primary demo preview without KV reads or writes when KV is unavailable', async () => {
  const env = testEnv();
  const get = vi.spyOn(env.KV, 'get').mockRejectedValue(new Error('KV unavailable'));
  const put = vi.spyOn(env.KV, 'put').mockRejectedValue(new Error('daily write quota'));
  for (const reading of featured.entries.filter(e => !e.superseded)) {
    const res = await worker.fetch(request('/api/og?id=' + reading.snapshotId), env);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()).slice(0,8))).toEqual([137,80,78,71,13,10,26,10]);
    expect((await worker.fetch(request('/api/og?id=' + reading.snapshotId, { method: 'POST' }), env)).status).toBe(204);
  }
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
