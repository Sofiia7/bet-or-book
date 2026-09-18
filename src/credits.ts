import type { KVLike } from './kv';
import type { NansenCallMeta } from './sources/nansen';

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

/** One read-modify-write per request, not per call: the free KV tier allows
 * 1 000 writes a day. Approximate under concurrency, like the rate limiter.
 * A call without a cost header counts as one credit - the conservative
 * direction for a spend cap. */
export async function recordCalls(kv: KVLike, day: string, calls: NansenCallMeta[]): Promise<void> {
  if (calls.length === 0) return;
  const stats = await readDay(kv, day);
  stats.calls += calls.length;
  stats.credits += calls.reduce((s, c) => s + (c.creditsCost ?? 1), 0);
  const last = [...calls].reverse().find((c) => c.creditsRemaining !== null);
  if (last) stats.lastRemaining = last.creditsRemaining;
  // What Nansen answers when credits run out is not documented; a refusal of
  // any kind stops Nansen reads until tomorrow's day key, which is also when
  // the free plan's daily top-up lands.
  if (calls.some((c) => c.status === 401 || c.status === 402 || c.status === 403)) stats.lastRemaining = 0;
  await kv.put(dayKey(day), JSON.stringify(stats), { expirationTtl: 60 * 60 * 24 * 40 });
}

/** False once today's spend reaches the cap, or once the account's last
 * reported balance is at or below the floor - past that point checks run
 * Hyperliquid-only and say so. */
export async function nansenAllowed(kv: KVLike, day: string, dailyCap: number, floor: number): Promise<boolean> {
  const stats = await readDay(kv, day);
  if (stats.credits >= dailyCap) return false;
  if (stats.lastRemaining !== null && stats.lastRemaining <= floor) return false;
  return true;
}
