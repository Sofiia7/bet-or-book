// U05, audit of 23.09: a handful of fresh, dated readings for a visitor with
// no address of their own, one of each kind of answer, shown before the
// older scan - and held to the rules, the data and the page they appear on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import featuredData from '../data/featured.json';
import galleryData from '../data/gallery.json';
import { computeVerdict, CLASSIFIER_VERSION } from '../src/engine/verdict';
import { snapshotId } from '../src/snapshot';
import { BUILDATHON_WINDOW } from '../src/ledger';
import type { Gallery } from '../src/gallery';

const featured = featuredData as unknown as Gallery;
const gallery = galleryData as unknown as Gallery;
const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

/** What the page's own chip says a position is, the way web/app.js formats it. */
function positionText(e: Gallery['entries'][number]): string {
  const usd = e.positions.headlineNotionalUsd;
  const money = usd >= 999500 ? `$${(usd / 1e6).toFixed(1)}M` : `$${Math.round(usd / 1e3)}K`;
  return `${money} ${e.positions.headlineCoin} ${e.positions.headlineSide}`;
}

describe('the demonstration readings', () => {
  it('are few, fresh, and read by the rules in force', () => {
    expect(featured.entries.length).toBeGreaterThanOrEqual(3);
    expect(featured.entries.length).toBeLessThanOrEqual(4);
    for (const e of featured.entries) {
      expect(e.classifierVersion).toBe(CLASSIFIER_VERSION);
      expect(e.historical).toBeUndefined();
      const day = e.checkedAt.slice(0, 10);
      expect(day >= BUILDATHON_WINDOW.from && day <= BUILDATHON_WINDOW.to).toBe(true);
    }
  });

  it('show one of each kind of answer rather than four of the same', () => {
    const kinds = new Set(featured.entries.map((e) => e.verdict.verdict));
    expect(kinds.size).toBe(featured.entries.length);
  });

  it('carry what the older scan could not: the position\'s own numbers', () => {
    for (const e of featured.entries) expect(e.vitals.length, e.address).toBeGreaterThan(0);
  });

  it('reproduce exactly under the current rules', () => {
    for (const e of featured.entries) {
      const again = computeVerdict({
        positions: e.positions,
        orders: e.orders,
        hedge: e.hedge,
        trades: { tradesPerDay: e.trades.tradesPerDay, crossedShare: e.trades.crossedShare, buyShare: e.trades.buyShare },
        linkedHedge: e.linkedHedge ? { linkedHedgeRatio: e.linkedHedge.linkedHedgeRatio } : undefined,
        hedgeCoverage: e.hedgeCoverage,
        ordersCoverage: e.ordersCoverage,
        positionsCoverage: e.positionsCoverage,
      });
      expect(again, e.address).toEqual(e.verdict);
    }
  });

  it('each have their own id, made the way a live check makes one', () => {
    for (const e of featured.entries) {
      expect(e.snapshotId).toBe(snapshotId(e.address, e.checkedAt, e.classifierVersion, e.focus));
    }
  });

  it('each follow the same address\'s reading in the scan, so the card can say what changed', () => {
    const scanIds = new Set(gallery.entries.map((e) => e.snapshotId));
    for (const e of featured.entries) {
      expect(e.supersedes, e.address).toBeDefined();
      expect(scanIds.has(e.supersedes!)).toBe(true);
      expect(gallery.entries.find((g) => g.snapshotId === e.supersedes)!.address).toBe(e.address);
    }
  });
});

describe('the chips at the top of the page', () => {
  const chips = [...page.matchAll(/<button class="chip" data-example="([^"]+)">([^<]+)<\/button>/g)].map((m) => ({
    id: m[1],
    text: m[2].replace(/&middot;/g, '·'),
  }));

  it('open exactly the demonstration readings, in order', () => {
    expect(chips.map((c) => c.id)).toEqual(featured.entries.map((e) => e.snapshotId));
  });

  it('name the position each one is actually about', () => {
    for (const [i, e] of featured.entries.entries()) {
      expect(chips[i].text.startsWith(positionText(e)), chips[i].text).toBe(true);
    }
  });

  it('say the day they were read, which is the day in the data', () => {
    const days = new Set(
      featured.entries.map((e) =>
        new Date(e.checkedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }),
      ),
    );
    expect(days.size).toBe(1);
    expect(page).toContain(`readings from ${[...days][0]}`);
  });
});

describe('the first live check of an address already on the page', () => {
  const HL: Record<string, unknown> = {
    frontendOpenOrders: [],
    spotClearinghouseState: { balances: [] },
    spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
    userFillsByTime: [],
    metaAndAssetCtxs: [{ universe: [] }, []],
    clearinghouseState: { assetPositions: [], time: Date.now() },
  };
  const hyperliquidOnly = () => {
    global.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
    }) as typeof fetch;
  };

  it('says what changed since the demonstration reading, with no live reading on record yet', async () => {
    hyperliquidOnly();
    const demo = featured.entries[0];
    const res = await worker.fetch(request(`/api/check?address=${demo.address}`, { method: 'POST' }), testEnv());
    expect(((await res.json()) as { supersedes?: string }).supersedes).toBe(demo.snapshotId);
  });

  it('does not set a question about one position against a reading of the largest', async () => {
    const position = (coin: string, szi: string, value: string) => ({
      type: 'oneWay',
      position: {
        coin,
        szi,
        entryPx: '1',
        positionValue: value,
        unrealizedPnl: '0',
        returnOnEquity: '0',
        liquidationPx: null,
        marginUsed: '1',
        maxLeverage: 20,
        leverage: { type: 'cross', value: 5 },
        cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
      },
    });
    const state = {
      ...HL,
      clearinghouseState: {
        assetPositions: [position('ETH', '-1000', '4000000'), position('BTC', '10', '1000000')],
        marginSummary: { accountValue: '9000000', totalNtlPos: '5000000', totalRawUsd: '0', totalMarginUsed: '1' },
        time: Date.now(),
      },
    };
    global.fetch = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify(state[body.type as keyof typeof state] ?? []), { status: 200 });
    }) as typeof fetch;

    const demo = featured.entries[0];
    const res = await worker.fetch(
      request(`/api/check?address=${demo.address}&coin=BTC&side=long`, { method: 'POST' }),
      testEnv(),
    );
    const body = (await res.json()) as { focus: unknown; supersedes?: string };
    expect(body.focus).toEqual({ coin: 'BTC', side: 'long' });
    expect(body.supersedes).toBeUndefined();
  });

  it('does compare an answer that fell back to the largest position with the last reading of the largest', async () => {
    hyperliquidOnly();
    const demo = featured.entries[0];
    const res = await worker.fetch(
      request(`/api/check?address=${demo.address}&coin=DOGE&side=long`, { method: 'POST' }),
      testEnv(),
    );
    const body = (await res.json()) as { focus: unknown; supersedes?: string };
    // DOGE is not open, so the answer is about the largest position after
    // all, and the comparison is between two answers to the same question.
    expect(body.focus).toBeNull();
    expect(body.supersedes).toBe(demo.snapshotId);
  });
});

describe('served like any saved reading, for free', () => {
  it('lists them apart from the scan', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      featured: Array<{ snapshotId: string; checkedAt: string }>;
    };
    expect(list.featured.map((f) => f.snapshotId)).toEqual(featured.entries.map((e) => e.snapshotId));
  });

  it('opens each one as a saved reading, with its rule in words, and compares it with the scan', async () => {
    const env = testEnv();
    for (const e of featured.entries) {
      const res = await worker.fetch(request(`/api/snapshot?id=${e.snapshotId}`), env);
      expect(res.status).toBe(200);
      const card = (await res.json()) as { kind: string; rule: string | null; share: { provenance: string } };
      expect(card.kind).toBe('saved');
      expect(card.rule).toEqual(expect.any(String));
      expect(card.share.provenance).toContain('saved reading');
      const compare = await worker.fetch(request(`/api/compare?a=${e.supersedes}&b=${e.snapshotId}`), env);
      expect(compare.status).toBe(200);
    }
  });
});
