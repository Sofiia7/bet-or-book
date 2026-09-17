import type { KVLike } from '../../src/kv';

interface Entry {
  value: string;
  expiresAt: number | null;
}

/** In-memory KVLike for tests. Honors expirationTtl by hiding (not
 * deleting) expired entries on read, and exposes a raw map for assertions
 * that need to see what a real KV write would have stored. */
export class FakeKV implements KVLike {
  private entries = new Map<string, Entry>();
  now: () => number = () => Date.now();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? this.now() + options.expirationTtl * 1000 : null;
    this.entries.set(key, { value, expiresAt });
  }

  size(): number {
    return this.entries.size;
  }
}
