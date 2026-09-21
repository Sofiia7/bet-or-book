import { describe, expect, it } from 'vitest';
import { NansenBudget, RequestGate } from '../src/coordinator';
import type { BudgetState } from '../src/budget';

/** The slice of DurableObjectState the budget object uses: one key, read on
 * first touch and written after every change. */
function fakeCtx() {
  const store = new Map<string, unknown>();
  return {
    store,
    ctx: {
      storage: {
        async get<T>(key: string): Promise<T | undefined> {
          return store.get(key) as T | undefined;
        },
        async put(key: string, value: unknown): Promise<void> {
          // Durable Object storage serialises, so a later mutation of the
          // live object must not reach back into what was stored.
          store.set(key, JSON.parse(JSON.stringify(value)));
        },
      },
    } as unknown as DurableObjectState,
  };
}

const post = (object: { fetch(r: Request): Promise<Response> }, body: unknown) =>
  object.fetch(new Request('https://budget.internal/', { method: 'POST', body: JSON.stringify(body) }));

const limits = { cap: 10, floor: 0 };

describe('NansenBudget', () => {
  it('holds credits for a running check and gives back what it did not spend', async () => {
    const { ctx, store } = fakeCtx();
    const object = new NansenBudget(ctx);

    const first = (await (await post(object, { action: 'reserve', day: 'd', worstCase: 7, limits })).json()) as {
      ok: boolean;
      id: string;
    };
    expect(first.ok).toBe(true);

    // Second check, while the first is still running: 7 + 7 is past the cap.
    const second = (await (await post(object, { action: 'reserve', day: 'd', worstCase: 7, limits })).json()) as {
      ok: boolean;
      reason: string;
    };
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("today's Nansen credits are used up");

    await post(object, { action: 'settle', id: first.id, actualCost: 2, creditsRemaining: 900 });
    const third = (await (await post(object, { action: 'reserve', day: 'd', worstCase: 7, limits })).json()) as {
      ok: boolean;
    };
    expect(third.ok).toBe(true);
    expect((store.get('budget') as BudgetState).spent).toBe(2);
  });

  it('keeps the count across an eviction', async () => {
    const { ctx, store } = fakeCtx();
    const first = (await (await post(new NansenBudget(ctx), { action: 'reserve', day: 'd', worstCase: 7, limits })).json()) as {
      id: string;
    };
    await post(new NansenBudget(ctx), { action: 'settle', id: first.id, actualCost: 9, creditsRemaining: 100 });

    // A fresh instance, as if the object had been evicted and woken again.
    const revived = new NansenBudget(ctx);
    const after = (await (await post(revived, { action: 'reserve', day: 'd', worstCase: 7, limits })).json()) as {
      ok: boolean;
    };
    expect(after.ok).toBe(false);
    expect((store.get('budget') as BudgetState).spent).toBe(9);
  });

  it('stores nothing for a reservation it refused', async () => {
    const { ctx, store } = fakeCtx();
    const object = new NansenBudget(ctx);
    const refused = (await (
      await post(object, { action: 'reserve', day: 'd', worstCase: 99, limits })
    ).json()) as { ok: boolean };
    expect(refused.ok).toBe(false);
    expect(store.has('budget')).toBe(false);
  });

  it('stops spending for the day once Nansen refuses a call', async () => {
    const { ctx } = fakeCtx();
    const object = new NansenBudget(ctx);
    const held = (await (await post(object, { action: 'reserve', day: 'd', worstCase: 2, limits })).json()) as {
      id: string;
    };
    await post(object, { action: 'settle', id: held.id, actualCost: 1, creditsRemaining: null, refused: true });
    const next = (await (
      await post(object, { action: 'reserve', day: 'd', worstCase: 1, limits: { cap: 10, floor: 5 } })
    ).json()) as { ok: boolean; reason: string };
    expect(next.ok).toBe(false);
    expect(next.reason).toBe('the Nansen account is nearly out of credits');
  });
});

describe('RequestGate', () => {
  it('counts requests to one instance and refuses past the limit', async () => {
    const gate = new RequestGate();
    const ask = async () =>
      ((await (
        await gate.fetch(
          new Request('https://gate.internal/', { method: 'POST', body: JSON.stringify({ maxHits: 3, windowSeconds: 60 }) }),
        )
      ).json()) as { allowed: boolean }).allowed;
    expect([await ask(), await ask(), await ask(), await ask()]).toEqual([true, true, true, false]);
  });

  it('gives each instance its own window, because each is one client', async () => {
    const body = JSON.stringify({ maxHits: 1, windowSeconds: 60 });
    const ask = (gate: RequestGate) =>
      gate
        .fetch(new Request('https://gate.internal/', { method: 'POST', body }))
        .then((r) => r.json() as Promise<{ allowed: boolean }>)
        .then((j) => j.allowed);
    const a = new RequestGate();
    const b = new RequestGate();
    expect(await ask(a)).toBe(true);
    expect(await ask(b)).toBe(true);
    expect(await ask(a)).toBe(false);
  });
});
