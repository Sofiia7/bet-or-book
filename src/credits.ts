import type { KVLike } from './kv';
import { meansOutOfCredits, type NansenCallMeta } from './sources/nansen';

export interface DayStats {
  calls: number;
  credits: number;
  lastRemaining: number | null;
}

const dayKey = (day: string) => `nansen:day:${day}`;

export async function readDay(kv: KVLike, day: string): Promise<DayStats> {
  const raw = await kv.get(dayKey(day));
  return raw ? (JSON.parse(raw) as DayStats) : { calls: 0, credits: 0, lastRemaining: null };
}

/** Per-day totals for /api/ledger and the buildathon call count. This is
 * reporting, not control: what a check is allowed to spend is decided by the
 * budget Durable Object in src/coordinator.ts before the check runs, because
 * a KV counter written after the fact cannot hold a line. Approximate under
 * concurrency, which a record of what happened can afford to be. */
export async function recordCalls(kv: KVLike, day: string, calls: NansenCallMeta[]): Promise<void> {
  if (calls.length === 0) return;
  const stats = await readDay(kv, day);
  stats.calls += calls.length;
  stats.credits += calls.reduce((s, c) => s + (c.creditsCost ?? 1), 0);
  const last = [...calls].reverse().find((c) => c.creditsRemaining !== null);
  if (last) stats.lastRemaining = last.creditsRemaining;
  // A refusal that reports credits still on the clock is about one endpoint
  // the key may not read, not about the balance; only an empty balance is
  // worth recording as empty.
  if (calls.some((c) => meansOutOfCredits(c.status, c.creditsRemaining))) stats.lastRemaining = 0;
  await kv.put(dayKey(day), JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 40 });
}

