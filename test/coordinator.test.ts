import { describe, expect, it } from 'vitest';
import { NansenBudget, RequestGate } from '../src/coordinator';

describe('NansenBudget, retired', () => {
  // A check makes no Nansen call any more (stage 3). The class keeps its
  // name, because deleting a Durable Object class takes a migration; it does
  // nothing, and leaves whatever it stored where it was.
  it('answers every action it used to take with 410', async () => {
    const object = new NansenBudget();
    for (const action of ['reserve', 'settle', 'record', 'report', 'sync']) {
      const res = await object.fetch(new Request('https://budget.internal/', { method: 'POST', body: JSON.stringify({ action }) }));
      expect(res.status).toBe(410);
    }
  });

  // Rollout seam (final review of stage 3, I4): an isolate still running the
  // previous build ignores the status and reads `ok` from the body. The body
  // has to be the old protocol's refusal, or that isolate reads `undefined`
  // and runs Nansen with no cap while the new build is being deployed.
  it('answers in the body with the refusal the previous build reads, not only with the status', async () => {
    const object = new NansenBudget();
    const res = await object.fetch(new Request('https://budget.internal/', { method: 'POST', body: JSON.stringify({ action: 'reserve', credits: 1 }) }));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { ok?: unknown; reason?: unknown };
    expect(body.ok).toBe(false);
    expect(body).toEqual({ ok: false, reason: 'the Nansen credit meter is retired' });
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
