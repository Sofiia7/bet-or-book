// C01, audit of 21.09: the per-day call counts were a read-modify-write on
// one shared KV key. That no longer breaks the spend cap, which moved to a
// Durable Object, but it still loses counts when two checks land together -
// and this is the number a buildathon submission is judged on.
import { describe, expect, it } from 'vitest';
import { BudgetLedger } from '../src/budget';
import { NansenBudget } from '../src/coordinator';
import type { NansenCallMeta } from '../src/sources/nansen';

const DAY = '2026-09-21';
const T0 = Date.parse(`${DAY}T12:00:00Z`);

const call = (over: Partial<NansenCallMeta> = {}): NansenCallMeta => ({
  path: 'profiler/perp-positions',
  status: 200,
  creditsCost: 1,
  creditsRemaining: 900,
  at: T0,
  ...over,
});

describe('what a day of calls is counted as', () => {
  it('separates what was attempted from what was answered', () => {
    const ledger = new BudgetLedger();
    ledger.recordCalls(DAY, [call(), call({ status: 500, creditsCost: null }), call({ status: 0, creditsCost: null })]);
    expect(ledger.snapshot().callsByDay[DAY]).toMatchObject({ attempted: 3, successful: 1 });
  });

  it('separates credits the API quoted from credits assumed for a call it did not price', () => {
    const ledger = new BudgetLedger();
    // A call with no cost header is charged one credit, the conservative
    // direction - but that is an assumption, and a submission that quotes a
    // credit total should not mix the two.
    ledger.recordCalls(DAY, [call({ creditsCost: 2 }), call({ creditsCost: null })]);
    const day = ledger.snapshot().callsByDay[DAY];
    expect(day.creditsQuoted).toBe(2);
    expect(day.creditsAssumed).toBe(1);
  });

  it('counts by endpoint, so a submission can say what it used Nansen for', () => {
    const ledger = new BudgetLedger();
    ledger.recordCalls(DAY, [call(), call({ path: 'profiler/address/current-balance' }), call()]);
    expect(ledger.snapshot().callsByDay[DAY].byEndpoint).toEqual({
      'profiler/perp-positions': 2,
      'profiler/address/current-balance': 1,
    });
  });
});

/** The slice of DurableObjectState the budget object uses. */
function fakeCtx() {
  const store = new Map<string, unknown>();
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        store.set(key, JSON.parse(JSON.stringify(value)));
      },
    },
  } as unknown as DurableObjectState;
}

const post = (object: NansenBudget, body: unknown) =>
  object.fetch(new Request('https://budget.internal/', { method: 'POST', body: JSON.stringify(body) }));

describe('two checks finishing together do not lose each other counts', () => {
  it('keeps both, where a read-modify-write kept one', async () => {
    const object = new NansenBudget(fakeCtx());
    await Promise.all([
      post(object, { action: 'record', day: DAY, calls: [call(), call()] }),
      post(object, { action: 'record', day: DAY, calls: [call(), call(), call()] }),
    ]);
    const res = await post(object, { action: 'report', day: DAY });
    const body = (await res.json()) as { calls: { attempted: number } };
    expect(body.calls.attempted).toBe(5);
  });

  it('reports a window rather than one day at a time', async () => {
    const object = new NansenBudget(fakeCtx());
    await post(object, { action: 'record', day: '2026-09-20', calls: [call()] });
    await post(object, { action: 'record', day: '2026-09-21', calls: [call(), call()] });
    const res = await post(object, { action: 'report', from: '2026-09-14', to: '2026-09-27' });
    const body = (await res.json()) as {
      calls: { attempted: number; successful: number };
      byDay: Record<string, number>;
    };
    expect(body.calls.attempted).toBe(3);
    expect(body.byDay).toEqual({ '2026-09-20': 1, '2026-09-21': 2 });
  });
});
