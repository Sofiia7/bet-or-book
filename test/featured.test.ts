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
import { words } from '../src/engine/interpret';
import { verdictInputOf } from '../src/engine/observation';
import { snapshotId } from '../src/snapshot';
import { BUILDATHON_WINDOW } from '../src/ledger';
import type { Gallery } from '../src/gallery';

const featured = featuredData as unknown as Gallery;
const gallery = galleryData as unknown as Gallery;
// A demonstration reading that was read again is kept at its own id, so a
// link to it still opens it - but it is not one of the readings the page
// shows, the same rule the gallery follows.
const shown = featured.entries.filter((e) => !e.superseded);
const replaced = featured.entries.filter((e) => e.superseded);
const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

/** What the page's own chip says a position is, the way web/app.js formats it. */
function positionText(e: Gallery['entries'][number]): string {
  const usd = e.positions.headlineNotionalUsd;
  const money = usd >= 999500 ? `$${(usd / 1e6).toFixed(1)}M` : `$${Math.round(usd / 1e3)}K`;
  return `${money} ${e.positions.headlineCoin} ${e.positions.headlineSide}`;
}

describe('the demonstration readings', () => {
  it('are few, fresh, and read by the rules in force', () => {
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(4);
    for (const e of featured.entries) {
      expect(e.classifierVersion).toBe(CLASSIFIER_VERSION);
      expect(e.historical).toBeUndefined();
      const day = e.checkedAt.slice(0, 10);
      expect(day >= BUILDATHON_WINDOW.from && day <= BUILDATHON_WINDOW.to).toBe(true);
    }
  });

  it('show one of each kind of answer rather than four of the same', () => {
    const kinds = new Set(shown.map((e) => e.verdict.verdict));
    expect(kinds.size).toBe(shown.length);
  });

  it('carry what the older scan could not: the position\'s own numbers', () => {
    for (const e of featured.entries) expect(e.vitals.length, e.address).toBeGreaterThan(0);
  });

  it('reproduce exactly under the current rules', () => {
    for (const e of featured.entries) {
      const again = computeVerdict(verdictInputOf(e));
      expect(again, e.address).toEqual(e.verdict);
    }
  });

  it('reproduce their evidence exactly under the current rules, not just their verdict', () => {
    // A verdict match says nothing about the rows drawn beside it: these
    // four chips still carried L06's doubled "Size vs open interest" tile
    // after the rule that draws a card was fixed, because fixing the rule is
    // not the same act as running scripts/reexplain.ts over what is already
    // bundled. `shown` rather than `featured.entries`, because a superseded
    // reading is a frozen record of an earlier interpretation on purpose and
    // is not asked to reproduce today's wording (24.09 audit follow-up, L06).
    for (const e of shown) {
      const fresh = words(e).evidence;
      expect(fresh, e.address).toEqual(e.evidence);
    }
  });

  it('each have their own id, made the way a live check makes one', () => {
    for (const e of featured.entries) {
      expect(e.snapshotId).toBe(snapshotId(e.address, e.checkedAt, e.classifierVersion, e.focus));
    }
  });

  it('each follow the same address\'s reading in the scan, so the card can say what changed', () => {
    // Directly, or through an earlier demonstration reading of the same
    // account that it replaced.
    const scanIds = new Set(gallery.entries.map((e) => e.snapshotId));
    const byId = new Map(featured.entries.map((e) => [e.snapshotId, e]));
    for (const e of shown) {
      let step = e;
      while (step.supersedes && byId.has(step.supersedes)) {
        step = byId.get(step.supersedes)!;
        expect(step.address).toBe(e.address);
      }
      expect(step.supersedes, e.address).toBeDefined();
      expect(scanIds.has(step.supersedes!)).toBe(true);
      expect(gallery.entries.find((g) => g.snapshotId === step.supersedes)!.address).toBe(e.address);
    }
  });

  it('keep one that was read again at its own id, paired both ways with the reading that replaced it', () => {
    // The Hedged account, read again on 24 September once loans on
    // Hyperliquid were listed: it owes USDC there.
    expect(replaced).toHaveLength(1);
    for (const old of replaced) {
      const now = shown.find((e) => e.supersedes === old.snapshotId)!;
      expect(now.address).toBe(old.address);
      expect(old.supersededBy).toBe(now.snapshotId);
      expect(old.checkedAt < now.checkedAt).toBe(true);
    }
  });
});

describe('the player strip at the top of the page', () => {
  // The four example chips this block used to check were hand-typed buttons
  // in web/index.html, so their text could silently drift from the real
  // data (data/featured.json) - the exact risk the two removed assertions
  // below used to guard against by reading that hand-typed text back out.
  // The 26.09 redesign's Player (Task 4) replaced those buttons with an
  // empty shell (id="player"/"player-queue") that web/app.js's renderPlayer
  // fills at runtime from gallery.featured - the same /api/gallery response
  // "served like any saved reading, for free" below already checks for
  // order against `shown`. There is no more per-reading text in this file
  // for a regex to read, so what is left to check here is: the old markup
  // is really gone, the new shell really landed, and the four readings the
  // player will show are still four different positions, not the same one
  // four times (also true by hand-inspection before, now true because
  // positionText is computed, not typed).

  it('no longer renders the four readings as plain chips - the player replaced them', () => {
    expect(page).not.toMatch(/<button class="chip" data-example="/);
  });

  it('has the empty player shell the client fills from gallery.featured', () => {
    for (const id of [
      'player',
      'player-now-reading',
      'player-title',
      'player-addr',
      'player-badge',
      'player-queue',
    ]) {
      expect(page, id).toContain(`id="${id}"`);
    }
  });

  // Removed after the redesign shipped: prev/next and the segment bar
  // duplicated what clicking a queue row already did, in more steps, not
  // fewer. The spotlight is a static header now; every row in the queue is
  // its own, single-click way to open a reading (audit follow-up, 26.09).
  it('does not carry the transport controls the redesign removed', () => {
    for (const id of ['player-prev', 'player-next', 'player-segments', 'player-open']) {
      expect(page, id).not.toContain(`id="${id}"`);
    }
  });

  it('still has one of each kind of answer for the player to show, each a different real position', () => {
    const texts = shown.map(positionText);
    expect(new Set(texts).size).toBe(shown.length);
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
    const demo = shown[0];
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

    const demo = shown[0];
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
    const demo = shown[0];
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
    expect(list.featured.map((f) => f.snapshotId)).toEqual(shown.map((e) => e.snapshotId));
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

  it('still opens one that was read again, and says what replaced it', async () => {
    const env = testEnv();
    for (const old of replaced) {
      const res = await worker.fetch(request(`/api/snapshot?id=${old.snapshotId}`), env);
      expect(res.status).toBe(200);
      const card = (await res.json()) as { kind: string; superseded?: boolean; supersededBy?: string };
      expect(card.kind).toBe('saved');
      expect(card.superseded).toBe(true);
      expect(card.supersededBy).toBe(old.supersededBy);
    }
  });
});
