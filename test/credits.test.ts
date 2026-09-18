import { describe, expect, it } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { recordCalls, nansenAllowed } from '../src/credits';

describe('credits', () => {
  it('accumulates one day of calls in a single KV entry', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-18', [
      { path: 'a', status: 200, creditsCost: 1, creditsRemaining: 990 },
      { path: 'b', status: 200, creditsCost: 1, creditsRemaining: 989 },
    ]);
    await recordCalls(kv, '2026-09-18', [{ path: 'c', status: 200, creditsCost: 1, creditsRemaining: 988 }]);
    const day = JSON.parse((await kv.get('nansen:day:2026-09-18'))!);
    expect(day).toEqual({ calls: 3, credits: 3, lastRemaining: 988 });
  });

  it('counts a call with no cost header as one credit', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-18', [{ path: 'a', status: 500, creditsCost: null, creditsRemaining: null }]);
    const day = JSON.parse((await kv.get('nansen:day:2026-09-18'))!);
    expect(day).toEqual({ calls: 1, credits: 1, lastRemaining: null });
  });

  it('refuses Nansen once the daily cap or the remaining-credit floor is reached', async () => {
    const kv = new FakeKV();
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(true);
    await kv.put('nansen:day:2026-09-18', JSON.stringify({ calls: 300, credits: 300, lastRemaining: 600 }));
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(false);
    await kv.put('nansen:day:2026-09-18', JSON.stringify({ calls: 10, credits: 10, lastRemaining: 5 }));
    expect(await nansenAllowed(kv, '2026-09-18', 300, 5)).toBe(false);
  });
});
