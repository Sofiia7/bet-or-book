// Stage 3 guard: a new check sends nothing to Nansen, whatever the Worker's
// environment holds, and what Nansen made before stays readable as it was.
// Nansen is read-only history here: the September ledger is a static
// archive, and a saved reading made by Nansen keeps its source and its
// "Data from Nansen" section.
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { testEnv, request, positionsAnswer } from './support/worker';
import { hlPosition } from './support/upstream';
import { onchainAnswers } from './support/onchain';
import { explorerAnswers } from './support/explorer';
import portfolioFixture from './fixtures/hyperliquid/portfolio-abraxas.json';
import featuredData from '../data/featured.json';
import ledgerData from '../data/ledger.json';
import workerLedgerData from '../data/ledger-worker.json';
import { nansenContribution } from '../src/engine/nansenContribution';
import type { CheckResponse } from '../src/api/check';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  portfolio: portfolioFixture.portfolio,
};

/** A lone $1M ETH short: its funders are looked up on two chains. */
const SHORT = { assetPositions: [hlPosition('ETH', -400, 1_000_000)], time: Date.now() };
/** A small long: its funding history is read from the explorer. */
const SMALL_LONG = { assetPositions: [hlPosition('BTC', 500, 50_000_000)], time: Date.now() };

/** Every upstream answered, every URL kept. A request to Nansen is answered
 * with an error, so even a reading that tolerated it would show the call. */
function instrument(main: unknown): string[] {
  const urls: string[] = [];
  const nodes = onchainAnswers({});
  const explorer = explorerAnswers();
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = url instanceof Request ? url.url : String(url);
    urls.push(u);
    if (u.toLowerCase().includes('nansen')) return new Response('{}', { status: 500 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const node = nodes(u, body);
    if (node) return node;
    const funding = explorer(u);
    if (funding) return funding;
    return new Response(JSON.stringify(positionsAnswer(body, main) ?? HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  return urls;
}

afterEach(() => vi.restoreAllMocks());

describe('a new check sends nothing to Nansen', () => {
  const envs = {
    'without an explorer key': {},
    'with an explorer key': { BLOCKSCOUT_API_KEY: 'explorer-key' },
    // A key left behind in an old deployment's secrets must not wake anything.
    'with a stray NANSEN_API_KEY': { NANSEN_API_KEY: 'stray-key', BLOCKSCOUT_API_KEY: 'explorer-key' },
  } as Record<string, Record<string, string>>;
  for (const [what, extra] of Object.entries(envs)) {
    for (const [kind, main] of [['a short', SHORT], ['a small long', SMALL_LONG]] as const) {
      it(`${kind}, ${what}`, async () => {
        const urls = instrument(main);
        const env = { ...testEnv(), ...extra } as unknown as ReturnType<typeof testEnv>;
        const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
        expect(res.status).toBe(200);
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.filter((u) => u.toLowerCase().includes('nansen'))).toEqual([]);
        const body = (await res.json()) as { source: string; nansenCalls: number; nansen: unknown };
        expect(body.source).toBe('hyperliquid');
        expect(body.nansenCalls).toBe(0);
        expect(body.nansen).toBeNull();
      });
    }
  }
});

describe('/api/ledger', () => {
  it('serves the two September archives and counts nothing live', async () => {
    const urls = instrument(SHORT);
    const res = await worker.fetch(request('/api/ledger'), testEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { live: unknown; scripted: unknown; totalCalls: number };
    expect(body.live).toEqual(workerLedgerData);
    expect(body.scripted).toEqual(ledgerData);
    expect(body.totalCalls).toBe((ledgerData as { calls: number }).calls + (workerLedgerData as { calls: number }).calls);
    expect(urls).toEqual([]);
  });
});

describe('a saved reading made by Nansen', () => {
  it('serves the featured entry 0aio3f82kqsu9 with its source and its Nansen section unchanged', async () => {
    instrument(SHORT);
    const card = (featuredData as unknown as { entries: CheckResponse[] }).entries.find((e) => e.snapshotId === '0aio3f82kqsu9')!;
    expect(card.source).toBe('nansen');
    const res = await worker.fetch(request('/api/snapshot?id=0aio3f82kqsu9'), testEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; nansen: { lead: string; items: string[]; calls: number } | null };
    expect(body.source).toBe('nansen');
    expect(body.nansen).toEqual(nansenContribution(card));
    expect(body.nansen).toMatchInlineSnapshot(`
      {
        "calls": 4,
        "items": [
          "Positions on every Hyperliquid dex, HIP-3 included: 1 open position. Hyperliquid's own free endpoint reads the main dex only. The bet rule needs every position read, so it could only be applied with these.",
          "Earliest funding found: 365 days ago on arbitrum, by another wallet. Context; no verdict turns on it.",
          "Realized PnL, 30d: no closed trades. Context; no verdict turns on it.",
        ],
        "lead": "every dex read, 1 position in all, which the bet rule needs",
      }
    `);
  });
});
