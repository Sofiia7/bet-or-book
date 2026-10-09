import { expect, it, vi } from 'vitest';
import { reusePositions } from '../../src/sources/reusePositions';
import { FakeKV } from '../support/fakeKv';
import type { NansenClient } from '../../src/sources/nansen';
it('reuses source positions across asset choices while preserving source time and expires after one minute', async () => {
  let at = 1000;
  const kv = new FakeKV(); kv.now = () => at;
  const data = { asset_positions: [], timestamp: 999 };
  const client = { perpPositions: vi.fn(async () => data) } as unknown as NansenClient;
  const cached = reusePositions(client, kv, () => at);
  expect(await cached.perpPositions('wallet')).toEqual(data);
  at += 20000; expect(await cached.perpPositions('wallet')).toEqual(data);
  expect(client.perpPositions).toHaveBeenCalledTimes(1);
  at += 61000; await cached.perpPositions('wallet');
  expect(client.perpPositions).toHaveBeenCalledTimes(2);
});
