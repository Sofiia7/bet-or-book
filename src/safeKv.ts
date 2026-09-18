import type { KVLike } from './kv';

/** Wraps KV so a quota or outage error degrades to "not cached / not
 * limited" instead of failing the request. Workers KV on the free plan
 * allows 1 000 writes a day, and the rate limiter writes on every request:
 * an abuse guard must not become the thing that takes the page down.
 * Errors are logged, not thrown. */
export function safeKv(kv: KVLike): KVLike {
  return {
    async get(key) {
      try {
        return await kv.get(key);
      } catch (err) {
        console.error('kv get failed', key, err);
        return null;
      }
    },
    async put(key, value, options) {
      try {
        await kv.put(key, value, options);
      } catch (err) {
        console.error('kv put failed', key, err);
      }
    },
  };
}
