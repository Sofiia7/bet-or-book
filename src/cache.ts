import type { KVLike } from './kv';

/**
 * Checks in flight in this isolate, by key. Ten visitors pasting the same
 * whale address at once used to be ten cache misses, ten checks and ten
 * times the Nansen credits; now the first one does the work and the rest
 * wait for its answer.
 *
 * This is a per-isolate map, not a distributed lock: two isolates can still
 * start the same check. That is fine, because the spend cap that has to hold
 * absolutely lives in a Durable Object (src/coordinator.ts) and this only
 * has to stop the obvious waste.
 *
 * Every entry is removed in a `finally`, so a producer that throws leaves
 * nothing behind for the next caller to wait on.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** Reads `key` from `kv`; on a miss, calls `produce()`, stores the JSON
 * result with the given TTL, and returns it. `T` must be JSON-serializable. */
export async function withCache<T>(
  kv: KVLike,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const cached = await kv.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  const running = inFlight.get(key);
  if (running !== undefined) {
    return (await running) as T;
  }

  const work = (async () => {
    const value = await produce();
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    return value;
  })();
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}
