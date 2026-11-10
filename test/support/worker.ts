// Runs the real src/index.ts against in-process fakes of the bindings it
// declares, so a route can be tested end to end without a deploy.
//
// The 21.09 audit noted that nothing exercised the Worker's own routing:
// every test reached past it into checkAddress or the engine. That is where
// HEAD starting a check, a snapshot id promised after a failed write and a
// missing origin check all live, so that is where they have to be tested.
//
// This is not the Cloudflare runtime. Storage gates, eviction and request
// cancellation behave differently there, and those need a real integration
// run; what this harness proves is the routing and the wiring.
import { NansenBudget, RequestGate } from '../../src/coordinator';
import { FakeKV } from './fakeKv';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';

/** What a named (HIP-3) dex answers for an account with nothing on it. */
export function emptyDexState(time = Date.now()) {
  return {
    assetPositions: [],
    marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
    withdrawable: '0.0',
    time,
  };
}

/**
 * Hyperliquid's answer to a request of the position read
 * (src/sources/positions.ts): the registry capture for `perpDexs` (ten named
 * dexes), `main` for the main dex, an empty state for every named dex.
 * Undefined for any other request, which the caller answers itself.
 */
export function positionsAnswer(body: { type?: unknown; dex?: unknown }, main: unknown): unknown {
  if (body.type === 'perpDexs') return perpDexs;
  if (body.type === 'clearinghouseState') return body.dex === undefined ? main : emptyDexState();
  return undefined;
}

class FakeStorage {
  private store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }
}

/** One live object per name, the way a namespace addresses them. */
class FakeNamespace {
  private objects = new Map<string, { fetch(r: Request): Promise<Response> }>();
  constructor(private readonly make: (ctx: DurableObjectState) => { fetch(r: Request): Promise<Response> }) {}
  idFromName(name: string) {
    return name as unknown as DurableObjectId;
  }
  get(id: DurableObjectId) {
    const name = String(id);
    let object = this.objects.get(name);
    if (!object) {
      object = this.make({ storage: new FakeStorage() } as unknown as DurableObjectState);
      this.objects.set(name, object);
    }
    const live = object;
    // A real stub takes (url, init) the way fetch does and hands the object
    // a Request; the object itself only ever sees the Request.
    return {
      fetch: (input: RequestInfo, init?: RequestInit) => live.fetch(new Request(input as string, init)),
    } as unknown as DurableObjectStub;
  }
}

export interface TestEnv {
  KV: FakeKV;
  BLOCKSCOUT_API_KEY?: string;
  DEMO_KEY?: string;
  NANSEN_BUDGET: DurableObjectNamespace;
  REQUEST_GATE: DurableObjectNamespace;
}

export function testEnv(over: Partial<TestEnv> = {}): TestEnv {
  return {
    KV: new FakeKV(),
    NANSEN_BUDGET: new FakeNamespace(() => new NansenBudget()) as unknown as DurableObjectNamespace,
    REQUEST_GATE: new FakeNamespace(() => new RequestGate()) as unknown as DurableObjectNamespace,
    ...over,
  };
}

export const ORIGIN = 'https://bet-or-book.test';

export function request(
  path: string,
  init: RequestInit & { origin?: string | null; sameSite?: string } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  if (init.sameSite) headers.set('sec-fetch-site', init.sameSite);
  headers.set('cf-connecting-ip', headers.get('cf-connecting-ip') ?? '203.0.113.7');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}
