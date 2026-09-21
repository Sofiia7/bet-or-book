import { describe, expect, it } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { recordCalls } from '../src/credits';

describe('credits', () => {
  it('accumulates one day of calls in a single KV entry', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-18', [
      { path: 'a', status: 200, creditsCost: 1, creditsRemaining: 990, at: 0 },
      { path: 'b', status: 200, creditsCost: 1, creditsRemaining: 989, at: 0 },
    ]);
    await recordCalls(kv, '2026-09-18', [{ path: 'c', status: 200, creditsCost: 1, creditsRemaining: 988, at: 0 }]);
    const day = JSON.parse((await kv.get('nansen:day:2026-09-18'))!);
    expect(day).toEqual({ calls: 3, credits: 3, lastRemaining: 988 });
  });

  it('counts a call with no cost header as one credit', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-18', [{ path: 'a', status: 500, creditsCost: null, creditsRemaining: null, at: 0 }]);
    const day = JSON.parse((await kv.get('nansen:day:2026-09-18'))!);
    expect(day).toEqual({ calls: 1, credits: 1, lastRemaining: null });
  });

  it('records a refusal as nothing left on the account', async () => {
    const kv = new FakeKV();
    await recordCalls(kv, '2026-09-20', [
      { path: 'profiler/perp-positions', status: 402, creditsCost: null, creditsRemaining: null, at: 0 },
    ]);
    // Whether a check may run is BudgetLedger's decision, not this file's;
    // what is stored here is the observation it reads from.
    expect(JSON.parse((await kv.get('nansen:day:2026-09-20'))!).lastRemaining).toBe(0);
    expect(await kv.get('nansen:day:2026-09-21')).toBeNull();
  });
});
