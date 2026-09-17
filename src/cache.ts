import type { KVLike } from './kv';

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
  const value = await produce();
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  return value;
}
