import type { KVLike } from './kv';

export interface SafeKV extends KVLike {
  /** True once any read or write through this wrapper has failed. */
  readonly degraded: boolean;
}

/** Wraps KV so a quota or outage error degrades to "not cached / not
 * limited" instead of failing the request. Workers KV on the free plan
 * allows 1 000 writes a day, and the rate limiter writes on every request:
 * an abuse guard must not become the thing that takes the page down.
 * Errors are logged, not thrown.
 *
 * Failing open is right for the page and wrong for money: with KV down, the
 * rate limit and the daily credit cap both read as "nothing spent yet". So
 * the wrapper remembers any failure in `degraded`, and the caller turns
 * Nansen off for that request - one wrapper per request. */
export function safeKv(kv: KVLike): SafeKV {
  let degraded = false;
  return {
    get degraded() {
      return degraded;
    },
    async get(key) {
      try {
        return await kv.get(key);
      } catch (err) {
        degraded = true;
        console.error('kv get failed', key, err);
        return null;
      }
    },
    async put(key, value, options) {
      try {
        await kv.put(key, value, options);
      } catch (err) {
        degraded = true;
        console.error('kv put failed', key, err);
      }
    },
  };
}
