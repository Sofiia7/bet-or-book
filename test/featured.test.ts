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
import type { Gallery, GalleryRow } from '../src/gallery';
import { landingExamples } from '../src/landing';
import { VERDICT_STYLES } from '../src/engine/presentation';
import { extractPageFunction } from './support/pageScript';

const featured = featuredData as unknown as Gallery;
const gallery = galleryData as unknown as Gallery;
// A demonstration reading that was read again is kept at its own id, so a
// link to it still opens it - but it is not one of the readings the page
// shows, the same rule the gallery follows.
const shown = featured.entries.filter((e) => !e.superseded);
const replaced = featured.entries.filter((e) => e.superseded);
const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const EXPLORE = readFileSync(new URL('../web/explore.js', import.meta.url), 'utf8');

/** What the page's own chip says a position is, the way web/app.js formats it. */
function positionText(e: Gallery['entries'][number]): string {
  const usd = e.positions.headlineNotionalUsd;
  const money = usd >= 999500 ? `$${(usd / 1e6).toFixed(1)}M` : `$${Math.round(usd / 1e3)}K`;
  return `${money} ${e.positions.headlineCoin} ${e.positions.headlineSide}`;
}

/** The example cards the Worker puts into the page, from the page it serves. */
async function servedQueue(): Promise<string> {
  const html = await (await worker.fetch(request('/'), testEnv())).text();
  return html.split('id="player-queue">')[1]?.split('</div>')[0] ?? '';
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('the demonstration readings', () => {
  it('serves every featured tile and its saved-reading link in the initial HTML', async () => {
    const response = await worker.fetch(request('/'), testEnv());
    const html = await response.text();
    const examples = html.split('id="player-queue">')[1]?.split('</div>')[0] ?? '';
    expect(examples.match(/<a class="card-position queue-row" href="/g)).toHaveLength(shown.length);
    for (const entry of shown) {
      expect(examples).toContain(`href="/?s=${entry.snapshotId}"`);
      expect(textOf(examples)).toContain(positionText(entry));
    }
    expect(html).not.toContain('<!--FEATURED_EXAMPLES-->');
  });

  it('are few, fresh, and read by the rules in force', () => {
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(shown.length).toBeLessThanOrEqual(4);
    for (const e of shown) {
      expect(e.classifierVersion).toBe(CLASSIFIER_VERSION);
      expect(e.historical).toBeUndefined();
      const day = e.checkedAt.slice(0, 10);
      expect(day >= '2026-09-17' && day <= new Date().toISOString().slice(0, 10)).toBe(true);
    }
  });

  it('show one of each kind of answer rather than four of the same', () => {
    const kinds = new Set(shown.map((e) => e.verdict.verdict));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
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
      expect(e.snapshotId).toBe(snapshotId(e.address, e.checkedAt, e.snapshotClassifierVersion ?? e.classifierVersion, e.focus));
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
    expect(replaced.length).toBeGreaterThanOrEqual(1);
    for (const old of replaced) {
      const now = featured.entries.find((e) => e.supersedes === old.snapshotId)!;
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

  it('has the examples container and navigation into and out of a reading', () => {
    for (const id of [
      'examples',
      'back-examples',
      'reading-nav',
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

/**
 * The example cards have two producers: the Worker draws them into the page
 * as links (src/landing.ts), and web/explore.js redraws them as buttons the
 * moment the gallery loads. Any difference between the two shows as the
 * cards changing in front of the reader. Here the browser's own code
 * (renderPlayer and exampleCard, cut out of web/explore.js, with the helpers
 * they are handed from web/app.js) runs against a stand-in for the DOM, and
 * what it builds is compared with what the Worker served, element for
 * element and text for text.
 */
type FakeNode = {
  tag: string;
  className: string | null;
  children: Array<FakeNode | string>;
  listeners: string[];
  append: (...children: Array<FakeNode | string>) => void;
  replaceChildren: (...children: Array<FakeNode | string>) => void;
  addEventListener: (type: string) => void;
};
function fakeEl(tag: string, cls?: string | null, text?: unknown): FakeNode {
  const node: FakeNode = {
    tag,
    className: cls || null,
    children: text === undefined ? [] : [String(text)],
    listeners: [],
    append: (...children) => { node.children.push(...children); },
    replaceChildren: (...children) => { node.children = children; },
    addEventListener: (type) => { node.listeners.push(type); },
  };
  return node;
}
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const serialize = (n: FakeNode | string): string =>
  typeof n === 'string' ? escapeText(n) : `<${n.tag}${n.className ? ` class="${n.className}"` : ''}>${n.children.map(serialize).join('')}</${n.tag}>`;

/** web/explore.js renderPlayer() run for real on `rows`: the queue it builds. */
function clientQueue(rows: GalleryRow[]): FakeNode {
  const cut = (source: string, names: string[]) => names.map((name) => extractPageFunction(source, name)).join('\n');
  const body = [
    cut(APP, ['verdictOf', 'badgeText', 'fmtUsd', 'readingTitleParts', 'shortAddr', 'fmtDay']),
    cut(EXPLORE, ['playerList', 'exampleCard', 'renderPlayer']),
    'renderPlayer();',
  ].join('\n');
  const queue = fakeEl('div');
  const $ = (id: string) => {
    if (id !== 'player-queue') throw new Error(`renderPlayer reached for #${id}`);
    return queue;
  };
  // VERDICTS is what scripts/build-web.ts puts in the shipped script.
  new Function('VERDICTS', 'el', '$', 'gallery', 'recordUsage', 'openSnapshot', body)(VERDICT_STYLES, fakeEl, $, { featured: rows }, () => {}, () => {});
  return queue;
}
/** The server's cards with the client's root element: a link becomes the button that replaces it. */
const asButtons = (html: string) =>
  html.replace(/<a class="card-position queue-row" href="\/\?s=[^"]+">/g, '<button class="card-position queue-row">').replace(/<\/a>/g, '</button>');

describe('the example cards before and after the gallery loads', () => {
  it('are the same cards, element for element, whichever side drew them', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const served = await servedQueue();
    const drawn = clientQueue(list.featured).children.map(serialize).join('');
    expect(drawn).toBe(asButtons(served));
    // The first three in the row, any others in the fold under them.
    expect(served.match(/<a class="card-position queue-row"/g)).toHaveLength(list.featured.length);
    if (list.featured.length > 3) expect(served.split('<details class="fold deeper-example">')[0].match(/<a class="card-position/g)).toHaveLength(3);
  });

  it('open the reading they name: the link on the server card, a click handler on the browser card', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const served = await servedQueue();
    expect([...served.matchAll(/href="\/\?s=([^"]+)"/g)].map((m) => m[1])).toEqual(list.featured.map((r) => r.snapshotId));
    const cards: FakeNode[] = [];
    const walk = (n: FakeNode | string) => {
      if (typeof n === 'string') return;
      if (n.tag === 'button') cards.push(n);
      n.children.forEach(walk);
    };
    clientQueue(list.featured).children.forEach(walk);
    expect(cards).toHaveLength(list.featured.length);
    for (const card of cards) expect(card.listeners).toEqual(['click']);
    // A history entry of its own, so Back returns to Check (test/web-screens.test.ts).
    expect(EXPLORE).toMatch(/recordUsage\('example_open'\);\s*openSnapshot\(e\.snapshotId, 'push'\);/);
  });

  it('agree on a row the featured set does not have today: no question, no description, no open position', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const [first, second, third, fourth] = [0, 1, 2, 3].map((i) => list.featured[i % list.featured.length]);
    const variants: GalleryRow[] = [
      { ...first, question: undefined },
      { ...second, description: undefined },
      { ...third, positions: { ...third.positions, nPositions: 0, headlineNotionalUsd: 0, headlineCoin: null, headlineSide: null } },
      { ...fourth, verdict: { verdict: 'unknown', strength: null }, badgeQualifier: 'assets sit with funders' },
    ];
    // Each verdict's own summary when a row has none, and a reading from
    // every month of the year: both sides keep a table of their own.
    for (const verdict of Object.keys(VERDICT_STYLES) as Array<keyof typeof VERDICT_STYLES>) {
      variants.push({ ...first, description: undefined, verdict: { verdict, strength: null } });
    }
    for (let month = 0; month < 12; month++) {
      variants.push({ ...first, checkedAt: new Date(Date.UTC(2026, month, month + 1, 23, 59)).toISOString() });
    }
    for (const v of variants) {
      expect(clientQueue([v]).children.map(serialize).join(''), v.snapshotId).toBe(asButtons(landingExamples([v])));
    }
    expect(textOf(landingExamples([variants[2]]))).toContain('No open positions');
    expect(landingExamples([variants[2]])).not.toContain('null');
  });

  it('agree on the verdict label with a strength, on every verdict, and with a qualifier on an Unknown', async () => {
    // Every featured row today has no strength, so without these the two
    // sides could word "(strong)" differently, or one of them drop it, and
    // nothing would notice: the 27.09 flash. 'likely' and 'strong' are the
    // two strengths the classifier gives (VerdictStrength).
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const base = list.featured[0];
    const variants: GalleryRow[] = [];
    for (const verdict of Object.keys(VERDICT_STYLES) as Array<keyof typeof VERDICT_STYLES>) {
      for (const strength of ['likely', 'strong'] as const) variants.push({ ...base, verdict: { verdict, strength }, badgeQualifier: null });
    }
    variants.push({ ...base, verdict: { verdict: 'unknown', strength: 'likely' }, badgeQualifier: 'assets sit with funders' });
    for (const v of variants) {
      const served = landingExamples([v]);
      const label = served.match(/<span class="cp-verdict badge [a-z]+">([^<]+)<\/span>/)?.[1];
      expect(label, `${v.verdict.verdict} ${v.verdict.strength}`).toBe(
        `${VERDICT_STYLES[v.verdict.verdict].label} (${v.verdict.strength})` + (v.badgeQualifier ? ` · ${v.badgeQualifier}` : ''),
      );
      expect(clientQueue([v]).children.map(serialize).join(''), `${v.verdict.verdict} ${v.verdict.strength}`).toBe(asButtons(served));
    }
  });

  it('agree on the amount at the edges of each unit: dollars, thousands, millions, billions', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const base = list.featured[0];
    const amounts: Array<[number, string]> = [[830, '$830'], [950000, '$950K'], [999600, '$1.0M'], [1.2e9, '$1.2B']];
    for (const [usd, text] of amounts) {
      const v: GalleryRow = { ...base, positions: { ...base.positions, headlineNotionalUsd: usd } };
      const served = landingExamples([v]);
      expect(served).toContain(`<span class="cp-amount">${text} <span class="cp-asset">`);
      expect(clientQueue([v]).children.map(serialize).join(''), String(usd)).toBe(asButtons(served));
    }
  });

  it('agree on the "More evidence cases" fold, whatever the number of featured readings', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] };
    const five = [0, 1, 2, 3, 4].map((i) => ({ ...list.featured[i % list.featured.length], snapshotId: `case${i}` }));
    const served = landingExamples(five);
    const [row, fold] = served.split('<details class="fold deeper-example"><summary>More evidence cases</summary>');
    expect(row.match(/<a class="card-position/g)).toHaveLength(3);
    expect(fold.match(/<a class="card-position/g)).toHaveLength(2);
    expect(clientQueue(five).children.map(serialize).join('')).toBe(asButtons(served));
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
