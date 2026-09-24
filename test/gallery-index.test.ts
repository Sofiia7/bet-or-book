// U06, audit of 23.09, and its note on the gallery payload: the list is sent
// as rows, a card is opened on click, and every card that leaves the Worker
// says the rule behind its verdict in words.
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import galleryData from '../data/gallery.json';

const ADDRESS = '0x1111111111111111111111111111111111111111';

function hyperliquidOnly() {
  const HL: Record<string, unknown> = {
    frontendOpenOrders: [],
    spotClearinghouseState: { balances: [] },
    spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
    userFillsByTime: [],
    metaAndAssetCtxs: [{ universe: [] }, []],
    clearinghouseState: { assetPositions: [], time: Date.now() },
  };
  global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('the gallery list is rows, not cards', () => {
  it('sends what a row shows, a small fraction of the cards themselves', async () => {
    const res = await worker.fetch(request('/api/gallery'), testEnv());
    const text = await res.text();
    const full = JSON.stringify(galleryData);
    expect(text.length).toBeLessThan(full.length / 5);

    const list = JSON.parse(text) as { entries: Array<Record<string, unknown>> };
    const row = list.entries[0];
    expect(Object.keys(row)).toEqual(
      expect.arrayContaining(['snapshotId', 'address', 'checkedAt', 'classifierVersion', 'verdict', 'positions']),
    );
    for (const heavy of ['summary', 'evidence', 'coverage', 'orders', 'hedge', 'trades', 'vitals']) {
      expect(row).not.toHaveProperty(heavy);
    }
  });

  it('leaves the account\'s 30-day PnL out of the list (U06)', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(list.entries.some((e) => 'pnl' in e)).toBe(false);
  });

  it('marks a row read by earlier rules, so the page can keep it in the archive', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<{ historical?: { reason: string } }>;
    };
    const historical = list.entries.filter((e) => e.historical);
    expect(historical.length).toBeGreaterThan(0);
    expect(historical[0].historical!.reason).toEqual(expect.any(String));
  });

  it('opens every row as a whole card, for free, from the bundle', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string; verdict: { verdict: string } }>;
    };
    const row = list.entries[0];
    const res = await worker.fetch(request(`/api/snapshot?id=${row.snapshotId}`), env);
    expect(res.status).toBe(200);
    const card = (await res.json()) as { verdict: { verdict: string }; summary: string; kind: string };
    expect(card.verdict.verdict).toBe(row.verdict.verdict);
    expect(card.summary).toEqual(expect.any(String));
    expect(card.kind).toBe('gallery');
  });
});

describe('every card says its rule in words', () => {
  it('on a gallery card', async () => {
    const env = testEnv();
    const list = (await (await worker.fetch(request('/api/gallery'), env)).json()) as {
      entries: Array<{ snapshotId: string; historical?: unknown }>;
    };
    const current = list.entries.find((e) => !e.historical)!;
    const card = (await (await worker.fetch(request(`/api/snapshot?id=${current.snapshotId}`), env)).json()) as {
      rule: string | null;
    };
    expect(card.rule).toEqual(expect.any(String));

    const earlier = list.entries.find((e) => e.historical)!;
    const old = (await (await worker.fetch(request(`/api/snapshot?id=${earlier.snapshotId}`), env)).json()) as {
      rule: string | null;
    };
    expect(old.rule).toMatch(/^Read by an earlier version of the rules/);
  });

  it('on a live check, and on the saved reading it leaves behind', async () => {
    hyperliquidOnly();
    const env = testEnv();
    const live = (await (
      await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env)
    ).json()) as { rule: string | null; snapshotId: string };
    expect(live.rule).toEqual(expect.any(String));
    const saved = (await (await worker.fetch(request(`/api/snapshot?id=${live.snapshotId}`), env)).json()) as {
      rule: string | null;
      kind: string;
    };
    expect(saved.rule).toBe(live.rule);
    expect(saved.kind).toBe('saved');
  });
});
