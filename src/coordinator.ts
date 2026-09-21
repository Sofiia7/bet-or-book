/**
 * The three things Workers KV cannot be trusted with, moved to Durable
 * Objects: money, a request counter, and the record of what was called.
 *
 * KV is eventually consistent, and read-modify-write through it is not a
 * transaction, so the spend cap, the rate limit and the call counts could
 * all be walked past by requests that overlapped. KV also accepts at most
 * one write per second per key, and the free plan allows a thousand writes a
 * day, which made an abuse guard that writes on every request a way to take
 * the page down. KV keeps what it is good at: cached results.
 *
 * "A Durable Object handles one request at a time" is how this used to be
 * justified, and it is too strong a statement to build on. One object runs
 * one JavaScript thread, but that thread yields at every await, and two
 * requests can interleave around I/O; what makes storage safe is the
 * runtime's input and output gates, not the absence of concurrency. The
 * lazy load below is written for the weaker guarantee: concurrent callers
 * wait on one load rather than each starting their own and the last one
 * winning. An offline test of two overlapping `record` calls loses three of
 * five counts without it (test/call-ledger.test.ts).
 */
import {
  BudgetLedger,
  type BudgetLimits,
  type BudgetState,
  type Reservation,
  type RecordedCall,
  type DayCalls,
} from './budget';
import { InMemoryRateLimiter } from './guard';

const STATE_KEY = 'budget';

/** What the Worker asks the budget for. Implemented over a Durable Object in
 * production and in memory in tests. */
export interface CallReport {
  calls: DayCalls;
  byDay: Record<string, number>;
}

export interface SpendGuard {
  reserve(day: string, worstCase: number): Promise<Reservation>;
  /** What a check actually did, counted where concurrent checks cannot
   * overwrite each other. */
  record(day: string, calls: RecordedCall[]): Promise<void>;
  report(from: string, to: string): Promise<CallReport>;
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
  private loading: Promise<BudgetLedger> | null = null;

  constructor(private readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      action: 'reserve' | 'settle' | 'sync' | 'record' | 'report';
      day?: string;
      worstCase?: number;
      limits?: BudgetLimits;
      id?: string;
      actualCost?: number;
      creditsRemaining?: number | null;
      refused?: boolean;
      measuredAt?: number;
      creditsRemainingAt?: number;
      calls?: RecordedCall[];
      from?: string;
      to?: string;
    };
    const ledger = await this.load();

    if (body.action === 'reserve') {
      const result = ledger.reserve(body.day!, body.worstCase!, body.limits!, Date.now());
      // Only a reservation that was granted changes anything worth storing;
      // a refusal leaves the state as it was.
      if (result.ok) await this.save();
      return Response.json(result);
    }

    if (body.action === 'record') {
      ledger.recordCalls(body.day!, body.calls ?? []);
      await this.save();
      return Response.json({ ok: true });
    }

    if (body.action === 'report') {
      const from = body.from ?? body.day!;
      const to = body.to ?? body.day!;
      return Response.json(ledger.callReport(from, to));
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
    if (this.ledger !== null) return this.ledger;
    // The promise is memoized, not just its result: two requests arriving
    // together both see `ledger === null`, and without this they each build
    // one from storage and the second discards the first one's writes.
    this.loading ??= this.ctx.storage.get<BudgetState>(STATE_KEY).then((saved) => {
      this.ledger = new BudgetLedger(saved);
      this.loading = null;
      return this.ledger;
    });
    return this.loading;
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
    async record(day, calls) {
      if (calls.length === 0) return;
      await call(stub(), { action: 'record', day, calls });
    },
    async report(from, to) {
      const res = await call(stub(), { action: 'report', from, to });
      return (await res.json()) as CallReport;
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
