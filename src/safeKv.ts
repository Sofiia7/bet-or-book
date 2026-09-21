import type { KVLike } from './kv';

export interface SafeKV extends Omit<KVLike, 'put'> {
  /** True once any read or write through this wrapper has failed. */
  readonly degraded: boolean;
  /** False when the write did not go through. Swallowing the error is right
   * - a lost cache entry is not a lost answer - but the caller still has to
   * know, because it used to promise a share link for a reading that was
   * never stored (audit R02). */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<boolean>;
}

/** Wraps KV so a quota or outage error degrades to "not cached" instead of
 * failing the request. Errors are logged, not thrown.
 *
 * Failing open used to be dangerous here, because the credit cap and the
 * rate limit were KV counters and a dead KV read as "nothing spent yet".
 * Both now live in Durable Objects (src/coordinator.ts), so what is left to
 * lose is caching: with KV down every check runs for real, and the cap is
 * what bounds that. `degraded` still records that it happened. */
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
        return true;
      } catch (err) {
        degraded = true;
        console.error('kv put failed', key, err);
        return false;
      }
    },
  };
}
