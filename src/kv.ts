// The narrow slice of Cloudflare's KVNamespace this project actually uses.
// A real KVNamespace (from @cloudflare/workers-types) satisfies this
// structurally, so it can be passed anywhere a KVLike is expected with no
// adapter; tests pass a FakeKV (test/support/fakeKv.ts) instead.
export interface KVLike {
  get(key: string): Promise<string | null>;
  /** Most callers ignore the result; `safeKv` narrows it to whether the
   * write went through, which the check route needs before it offers a
   * link to a saved reading. */
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}
