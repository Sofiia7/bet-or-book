// The narrow slice of Cloudflare's KVNamespace this project actually uses.
// A real KVNamespace (from @cloudflare/workers-types) satisfies this
// structurally, so it can be passed anywhere a KVLike is expected with no
// adapter; tests pass a FakeKV (test/support/fakeKv.ts) instead.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
