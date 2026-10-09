// The Worker exactly as deployed, run inside real workerd by
// test/runtime/workerd.test.ts, with one seam: the KV namespace can be told
// to fail outright, to refuse writes (the free plan's daily write quota), or
// to lag behind like a region that has not seen a write yet. KV's eventual
// consistency is the one thing a local runtime does not reproduce by itself.
import worker, { NansenBudget, RequestGate, PilotWatch as ProductionPilotWatch } from '../../src/index';

export { NansenBudget, RequestGate };
// Clock seam only in the test bundle. Production always uses Date.now().
export class PilotWatch extends ProductionPilotWatch {
  protected now(): number { return Number((this.env as { TEST_NOW?: string }).TEST_NOW) || Date.now(); }
}

interface KVish {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
}

/** When each key was last written through the lagging seam. Module state on
 * purpose: workerd reuses this isolate across the test's requests, the same
 * way the deployed Worker reuses one across a region's. */
const writtenAt = new Map<string, number>();

function seamed(kv: KVish, mode: string | undefined, lagMs: number): KVish {
  if (mode === 'down') {
    return {
      get: async () => {
        throw new Error('KV unavailable');
      },
      put: async () => {
        throw new Error('KV unavailable');
      },
    };
  }
  if (mode === 'read-only') {
    return {
      get: (key) => kv.get(key),
      put: async () => {
        throw new Error('KV put() limit exceeded for the day');
      },
    };
  }
  if (mode === 'lagging') {
    return {
      async get(key) {
        const at = writtenAt.get(key);
        return at !== undefined && Date.now() - at < lagMs ? null : kv.get(key);
      },
      async put(key, value, options) {
        await kv.put(key, value, options);
        writtenAt.set(key, Date.now());
      },
    };
  }
  return kv;
}

export default {
  async fetch(request: Request, env: Parameters<typeof worker.fetch>[1] & { TEST_NOW?: string; KV_MODE?: string; KV_LAG_MS?: number }): Promise<Response> {
    if (env.TEST_NOW && new URL(request.url).pathname === '/__test/scheduled') {
      await worker.scheduled({ scheduledTime: Number(env.TEST_NOW), cron: '0 * * * *', noRetry() {} }, env);
      return Response.json({ ok: true });
    }
    const kv = seamed(env.KV as KVish, env.KV_MODE as string | undefined, Number(env.KV_LAG_MS ?? 0));
    return worker.fetch(request, { ...env, KV: kv } as Parameters<typeof worker.fetch>[1]);
  },
};
