/**
 * What Workers KV cannot be trusted with, moved to Durable Objects: a request
 * counter.
 *
 * KV is eventually consistent, and read-modify-write through it is not a
 * transaction, so a rate limit kept there could be walked past by requests
 * that overlapped. KV also accepts at most one write per second per key, and
 * the free plan allows a thousand writes a day, which made an abuse guard
 * that writes on every request a way to take the page down. KV keeps what it
 * is good at: cached results.
 *
 * The Nansen spend cap and its call counts lived here too, in NansenBudget.
 * A check makes no Nansen call any more (stage 3), so nothing reserves,
 * settles or records through it, and /api/ledger serves the two September
 * archives alone. The class stays under its name, because deleting a Durable
 * Object class takes a migration.
 */
import { InMemoryRateLimiter } from './guard';

/**
 * Retired: the Nansen credit meter. It answers every request with 410 and
 * reads and writes nothing, so the state it stored (the September and
 * October call counts) stays in its storage exactly as it was left.
 *
 * The body is the refusal the old protocol spoke: `ok: false` with a reason.
 * During a deploy an isolate that still runs the previous build keeps asking
 * this object to reserve credit; that build ignores the status and reads
 * `ok` from the body, so a body without it would read as `undefined` and
 * let the old isolate call Nansen with no cap at all.
 */
export class NansenBudget implements DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return Response.json({ ok: false, reason: 'the Nansen credit meter is retired' }, { status: 410 });
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
  stub.fetch('https://gate.internal/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

export function requestGate(ns: DurableObjectNamespace, maxHits: number, windowSeconds: number) {
  return {
    async allow(key: string): Promise<boolean> {
      const res = await call(ns.get(ns.idFromName(`gate:${key}`)), { maxHits, windowSeconds });
      return ((await res.json()) as { allowed: boolean }).allowed;
    },
  };
}
