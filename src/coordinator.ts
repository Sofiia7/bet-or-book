/**
 * The two things Workers KV cannot be trusted with, moved to Durable
 * Objects: money and a request counter.
 *
 * KV is eventually consistent, and read-modify-write through it is not a
 * transaction, so both the spend cap and the rate limit could be walked past
 * by requests that overlapped. KV also accepts at most one write per second
 * per key, and the free plan allows a thousand writes a day, which made an
 * abuse guard that writes on every request a way to take the page down.
 *
 * A Durable Object handles one request at a time, so read-modify-write
 * inside one is atomic. KV keeps what it is good at: cached results, and the
 * per-day call counts that /api/ledger reports.
 */
import { BudgetLedger, type BudgetLimits, type BudgetState, type Reservation } from './budget';
import { InMemoryRateLimiter } from './guard';

const STATE_KEY = 'budget';

/** What the Worker asks the budget for. Implemented over a Durable Object in
 * production and in memory in tests. */
export interface SpendGuard {
  reserve(day: string, worstCase: number): Promise<Reservation>;
  settle(
    id: string,
    actualCost: number,
    creditsRemaining: number | null,
    refused: boolean,
    measuredAt?: number,
  ): Promise<void>;
}

/** Holds the spend cap for the whole Worker. One instance, addressed by a
 * fixed name, so every check queues behind the same counter. */
export class NansenBudget implements DurableObject {
  private ledger: BudgetLedger | null = null;

  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      action: 'reserve' | 'settle' | 'sync';
      day?: string;
      worstCase?: number;
      limits?: BudgetLimits;
      id?: string;
      actualCost?: number;
      creditsRemaining?: number | null;
      refused?: boolean;
      measuredAt?: number;
      creditsRemainingAt?: number;
    };
    const ledger = await this.load();

    if (body.action === 'reserve') {
      const result = ledger.reserve(body.day!, body.worstCase!, body.limits!, Date.now());
      // Only a reservation that was granted changes anything worth storing;
      // a refusal leaves the state as it was.
      if (result.ok) await this.save();
      return Response.json(result);
    }

    if (body.action === 'sync') {
      // An operator or a scheduled poll reporting the account balance
      // directly. Without it the only way to learn that credits arrived is
      // to spend one asking.
      ledger.syncBalance(body.creditsRemaining!, body.creditsRemainingAt ?? Date.now());
      await this.save();
      return Response.json({ ok: true });
    }

    ledger.settle(
      body.id!,
      body.actualCost!,
      body.creditsRemaining ?? null,
      Date.now(),
      body.refused ?? false,
      body.measuredAt,
    );
    await this.save();
    return Response.json({ ok: true });
  }

  private async load(): Promise<BudgetLedger> {
    if (this.ledger === null) {
      const saved = await this.ctx.storage.get<BudgetState>(STATE_KEY);
      this.ledger = new BudgetLedger(saved);
    }
    return this.ledger;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, this.ledger!.snapshot());
  }
}

/**
 * One instance per client address, counting requests in memory only. The
 * window is an abuse guard, not an audit trail: if the object is evicted
 * between requests the count starts again, which costs nothing and writes
 * nothing. That is the whole reason this is not in KV.
 */
export class RequestGate implements DurableObject {
  private limiter: InMemoryRateLimiter | null = null;

  async fetch(request: Request): Promise<Response> {
    const { maxHits, windowSeconds } = (await request.json()) as { maxHits: number; windowSeconds: number };
    this.limiter ??= new InMemoryRateLimiter(maxHits, windowSeconds * 1000);
    return Response.json({ allowed: await this.limiter.allow('self') });
  }
}

const call = async (stub: DurableObjectStub, body: unknown): Promise<Response> =>
  stub.fetch('https://budget.internal/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

export function spendGuard(ns: DurableObjectNamespace, limits: BudgetLimits): SpendGuard {
  const stub = () => ns.get(ns.idFromName('nansen-budget'));
  return {
    async reserve(day, worstCase) {
      const res = await call(stub(), { action: 'reserve', day, worstCase, limits });
      return (await res.json()) as Reservation;
    },
    async settle(id, actualCost, creditsRemaining, refused, measuredAt) {
      await call(stub(), { action: 'settle', id, actualCost, creditsRemaining, refused, measuredAt });
    },
  };
}

export function requestGate(ns: DurableObjectNamespace, maxHits: number, windowSeconds: number) {
  return {
    async allow(key: string): Promise<boolean> {
      const res = await call(ns.get(ns.idFromName(`gate:${key}`)), { maxHits, windowSeconds });
      return ((await res.json()) as { allowed: boolean }).allowed;
    },
  };
}
