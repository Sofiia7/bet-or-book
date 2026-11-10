import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import type { GalleryRow } from '../src/gallery';
import { VERDICT_STYLES } from '../src/engine/presentation';
import { extractPageFunction } from './support/pageScript';

/**
 * The Explore and Saved screens of the owner's handoff ("Screens > 3.
 * Explore" and "4. Saved"): the markup is read from web/index.html, the
 * helpers that decide what a saved card and the Saved screen's closing panel
 * say are cut out of web/app.js and run on their own, and the code that draws
 * the cards (web/explore.js, renderWatched in web/app.js, the Monitor switch
 * in web/monitor.js) runs against stand-ins for the DOM. Nothing here reaches
 * the network: the Monitor switch is handed a fetch stand-in.
 */

const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const EXPLORE = readFileSync(new URL('../web/explore.js', import.meta.url), 'utf8');
const MONITOR = readFileSync(new URL('../web/monitor.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const CSS = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((m) => m[1])
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const fn = (name: string) => extractPageFunction(APP, name);
const fnExplore = (name: string) => extractPageFunction(EXPLORE, name);

/** The element with this id, from its opening tag to the closing tag that matches it (same-name nesting counted). */
function elementById(html: string, id: string): string {
  const open = new RegExp(`<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  if (!open) return '';
  const tag = open[1];
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  tags.lastIndex = open.index;
  let depth = 0;
  for (let m = tags.exec(html); m; m = tags.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }
  return '';
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** The declarations of the one rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const blocks = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === selector);
  expect(blocks, `exactly one rule for ${selector}`).toHaveLength(1);
  return blocks[0][2].replace(/\s+/g, ' ').trim();
}
/** A screen ends with this element: nothing but white space between it and the screen's own closing tag. */
function endsWith(screen: string, inner: string): boolean {
  return inner !== '' && screen.replace(/\s*<\/section>$/, '').endsWith(inner);
}

const GALLERY = elementById(PAGE, 'gallery');
const SAVED = elementById(PAGE, 'saved-view');

// ---- a stand-in for the few DOM calls the page scripts make ----

type Listener = (event?: unknown) => unknown;
class FakeElement {
  className = '';
  children: Array<FakeElement | string> = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  hidden = false;
  disabled = false;
  type = '';
  maxLength = -1;
  value = '';
  placeholder = '';
  constructor(readonly tag: string) {}
  get textContent(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(text: string) {
    this.children = [String(text)];
  }
  append(...children: Array<FakeElement | string>) { this.children.push(...children); }
  replaceChildren(...children: Array<FakeElement | string>) { this.children = children; }
  setAttribute(name: string, value: unknown) { this.attrs[name] = String(value); }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  addEventListener(type: string, listener: Listener) { (this.listeners[type] ??= []).push(listener); }
  /** Every element focused, in order; a test empties it before it looks. */
  static focused: FakeElement[] = [];
  focus() { FakeElement.focused.push(this); }
  fire(type: string) { return Promise.all((this.listeners[type] ?? []).map((listener) => listener({ preventDefault() {} }))); }
  get elements(): FakeElement[] { return this.children.filter((c): c is FakeElement => typeof c !== 'string'); }
  /** Every element under this one, depth first. */
  descendants(): FakeElement[] { return this.elements.flatMap((c) => [c, ...c.descendants()]); }
}
function el(tag: string, cls?: string | null, text?: unknown): FakeElement {
  const e = new FakeElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = String(text);
  return e;
}
const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const serialize = (n: FakeElement | string): string =>
  typeof n === 'string' ? escapeText(n) : `<${n.tag}${n.className ? ` class="${n.className}"` : ''}>${n.children.map(serialize).join('')}</${n.tag}>`;
/** A page's elements by id, made on first use. */
function elementsById() {
  const elements = new Map<string, FakeElement>();
  return (id: string) => {
    if (!elements.has(id)) elements.set(id, el('div'));
    return elements.get(id)!;
  };
}

// ---- Explore ----

describe('the Explore screen in web/index.html', () => {
  it('opens with the eyebrow, the title and the lead', () => {
    expect(GALLERY).not.toBe('');
    expect(GALLERY).toMatch(
      /<p class="eyebrow">Saved readings<\/p>\s*<h1 id="explore-title" tabindex="-1">Explore<\/h1>\s*<p class="sub">Learn what large positions do and do not reveal\. Every case has a date and evidence; these are saved readings, not a live market overview\.<\/p>/,
    );
  });

  it('switches its four views with a segmented tab pill, the first pressed', () => {
    const group = /<div\b([^>]*\baria-label="Explore view"[^>]*)>([\s\S]*?)<\/div>/.exec(GALLERY);
    expect(group).not.toBeNull();
    if (!group) return;
    expect(group[1]).toMatch(/\bclass="pill-nav explore-tabs"/);
    expect(group[1]).toMatch(/\brole="group"/);
    const tabs = [...group[2].matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({
      id: m[1].match(/\bid="([^"]+)"/)?.[1],
      cls: m[1].match(/\bclass="([^"]+)"/)?.[1],
      pressed: m[1].match(/\baria-pressed="([^"]+)"/)?.[1],
      controls: m[1].match(/\baria-controls="([^"]+)"/)?.[1],
      label: m[2],
    }));
    expect(tabs).toEqual([
      { id: 'explore-cases', cls: 'pill-tab', pressed: 'true', controls: 'case-studies', label: 'Case studies' },
      { id: 'explore-ranked', cls: 'pill-tab', pressed: 'false', controls: 'boards-fold', label: 'Compare' },
      { id: 'explore-all', cls: 'pill-tab', pressed: 'false', controls: 'all-readings', label: 'All readings' },
      { id: 'explore-archive', cls: 'pill-tab', pressed: 'false', controls: 'archive', label: 'Archive' },
    ]);
  });

  it('keeps the loading line, the views and the archive', () => {
    expect(GALLERY).toContain('<p id="explore-status" class="status" role="status">Loading saved readings...</p>');
    for (const id of ['case-study-list', 'boards', 'chips', 'gallery-list', 'more', 'archive', 'archive-list', 'archive-more', 'explore-return']) {
      expect(GALLERY, id).toContain(`id="${id}"`);
    }
  });

  it('ends with the "Seen a whale alert?" panel and its primary "Check a wallet" button', () => {
    const cta = elementById(GALLERY, 'explore-next');
    expect(cta).toMatch(/^<section class="cta-panel" id="explore-next" aria-labelledby="explore-next-title">/);
    expect(endsWith(GALLERY, cta)).toBe(true);
    expect(cta).toMatch(/<h2 class="cta-title" id="explore-next-title">Seen a whale alert\?<\/h2>/);
    expect(textOf(cta)).toContain('Paste the wallet and get a reading in seconds.');
    expect(cta).toMatch(/<button class="btn" id="explore-check">Check a wallet<\/button>/);
  });
});

describe('the Explore case studies', () => {
  /** web/explore.js renderCaseStudies() run for real on `rows`, with exampleCard from the same file. */
  function drawCaseStudies(rows: GalleryRow[]) {
    const calls: string[] = [];
    const list = el('div');
    const $ = (id: string) => {
      if (id !== 'case-study-list') throw new Error(`renderCaseStudies reached for #${id}`);
      return list;
    };
    const body = [
      ...['verdictOf', 'badgeText', 'fmtUsd', 'readingTitleParts', 'shortAddr', 'fmtDay'].map(fn),
      ...['exampleCard', 'renderCaseStudies'].map(fnExplore),
      'renderCaseStudies();',
      'return exampleCard;',
    ].join('\n');
    const exampleCard = new Function('VERDICTS', 'el', '$', 'gallery', 'recordUsage', 'openSnapshot', body)(
      VERDICT_STYLES,
      el,
      $,
      { featured: rows },
      (action: string) => calls.push(`recordUsage ${action}`),
      (id: string, navigation?: string) => calls.push(`openSnapshot ${id} ${navigation}`),
    ) as (row: GalleryRow) => FakeElement;
    return { list, calls, exampleCard };
  }
  const featuredRows = async () =>
    ((await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as { featured: GalleryRow[] }).featured;

  it('are the Check screen\'s position cards, drawn by the same exampleCard, not a card of their own', async () => {
    const rows = await featuredRows();
    expect(rows.length).toBeGreaterThan(0);
    const { list, exampleCard } = drawCaseStudies(rows);
    expect(list.children).toHaveLength(rows.length);
    list.elements.forEach((card, i) => {
      expect(card.tag).toBe('button');
      expect(card.className).toBe('card-position queue-row');
      expect(serialize(card)).toBe(serialize(exampleCard(rows[i])));
    });
    expect(fnExplore('renderCaseStudies')).not.toMatch(/el\(\s*'(?:div|article)'/);
    expect(fnExplore('loadGallery')).toContain('renderCaseStudies();');
  });

  it('show eight at most', async () => {
    const rows = await featuredRows();
    const many = Array.from({ length: 11 }, (_, i) => ({ ...rows[i % rows.length], snapshotId: `case-${i}` }));
    expect(drawCaseStudies(many).list.children).toHaveLength(8);
  });

  it('open their reading free, as a history entry of its own, and count as an example opened', async () => {
    const rows = await featuredRows();
    const { list, calls } = drawCaseStudies(rows);
    await list.elements[0].fire('click');
    expect(calls).toEqual(['recordUsage example_open', `openSnapshot ${rows[0].snapshotId} push`]);
  });
});

// ---- Saved ----

/** A saved position the way watched() in web/app.js hands it to renderWatched(). */
type SavedRow = {
  address: string;
  coin: string | null;
  side: 'long' | 'short' | null;
  snapshotId: string | null;
  previousSnapshotId: string | null;
  monitorToken: string | null;
  monitorStatus: string;
  monitorExpires: string | null;
  monitorEvents: Array<{ snapshotId: string; at: string; changes: string[] }>;
  checkedAt: string | null;
  label: string;
  // The row's copy of its saved reading (withReadingSummary); absent on rows saved before it existed.
  verdict?: string | null;
  notionalUsd?: number | null;
  summary?: string | null;
};
const TOKEN = 'a'.repeat(36) + 'b'.repeat(36);
const savedRow = (over: Partial<SavedRow> = {}): SavedRow => ({
  address: '0x082e843a431aef031264dc232693dd710aedca88',
  coin: 'HYPE',
  side: 'long',
  snapshotId: '0aio3f82kqsu9',
  previousSnapshotId: null,
  monitorToken: null,
  monitorStatus: '',
  monitorExpires: null,
  monitorEvents: [],
  checkedAt: '2026-10-07T15:56:28.231Z',
  label: '',
  ...over,
});
const LONG_NAME = 'The ETH whale from the alert my friend forwarded on Tuesday, the one with the funders';

/** A saved row of the new shape: the reading's verdict, amount and headline kept on it. */
const savedRowWithReading = (over: Partial<SavedRow> = {}): SavedRow =>
  savedRow({ verdict: 'looks_like_a_bet', notionalUsd: 122144815.75, summary: 'This looks like a real bet.', ...over });
/** What a card without a stored reading copy says beyond today's three fields. */
const NO_COPY = { asset: '', name: '', summary: '', verdictClass: '' };

type SavedCardModel = {
  title: string;
  asset: string;
  name: string;
  summary: string;
  meta: string;
  verdictLabel: string;
  verdictClass: string;
  actions: Array<'monitor' | 'refresh' | 'remove'>;
  monitorOn: boolean;
};
type Reading = {
  snapshotId?: string;
  snapshotSaved?: boolean;
  headline?: string;
  verdict: { verdict: string; reasons?: string[] };
  positions: { nPositions: number; headlineNotionalUsd: number };
};
type SavedHelpers = {
  savedCardModel: (row: SavedRow, options: { monitoring: boolean }) => SavedCardModel;
  savedEmptyState: (n: number) => { empty: boolean; ctaTitle: string; ctaText: string };
  savedOpenLabel: (row: SavedRow, model: SavedCardModel) => string;
  withReadingSummary: (row: SavedRow, d: Reading) => SavedRow;
  cutAtWord: (text: string, max: number) => string;
};
const SAVED_HELPERS = ['shortAddr', 'fmtTime', 'fmtUsd', 'verdictOf', 'headlineFor', 'savedCardModel', 'savedEmptyState', 'savedRowName', 'savedOpenLabel', 'cutAtWord', 'withReadingSummary'];
let loaded: SavedHelpers | undefined;
const helpers = () =>
  (loaded ??= new Function(
    'VERDICTS',
    [...SAVED_HELPERS.map(fn), 'return { savedCardModel, savedEmptyState, savedOpenLabel, withReadingSummary, cutAtWord };'].join('\n'),
  )(VERDICT_STYLES) as SavedHelpers);
const savedCardModel: SavedHelpers['savedCardModel'] = (row, options) => helpers().savedCardModel(row, options);
const savedEmptyState: SavedHelpers['savedEmptyState'] = (n) => helpers().savedEmptyState(n);
const savedOpenLabel: SavedHelpers['savedOpenLabel'] = (row, model) => helpers().savedOpenLabel(row, model);
const withReadingSummary: SavedHelpers['withReadingSummary'] = (row, d) => helpers().withReadingSummary(row, d);
const cutAtWord: SavedHelpers['cutAtWord'] = (text, max) => helpers().cutAtWord(text, max);
/** web/app.js watched() run on what the storage key holds. */
function watchedFrom(stored: unknown): SavedRow[] {
  const localStorage = { getItem: (key: string) => (key === 'betOrBook:watch' ? JSON.stringify(stored) : null) };
  return new Function('localStorage', 'WATCH_KEY', 'ADDRESS_RE', 'VERDICTS', `${fn('watched')}\nreturn watched();`)(
    localStorage,
    'betOrBook:watch',
    /^0x[0-9a-f]{40}$/,
    VERDICT_STYLES,
  ) as SavedRow[];
}

describe('the Saved screen in web/index.html', () => {
  it('opens with the eyebrow, the title and the lead', () => {
    expect(SAVED).not.toBe('');
    expect(SAVED).toMatch(
      /<p class="eyebrow">Stored in this browser only<\/p>\s*<h1 id="saved-title" tabindex="-1">Saved<\/h1>\s*<p class="sub">Opening a reading is free\. Refresh runs a new check\.<\/p>/,
    );
  });

  it('has the cards\' container, then the pilot note under it', () => {
    expect(SAVED).toMatch(/<div id="watched" role="region" aria-label="Your saved positions"><\/div>/);
    const note = elementById(SAVED, 'saved-pilot');
    expect(note).toMatch(/^<p class="saved-pilot" id="saved-pilot">/);
    expect(textOf(note)).toContain('Monitor (pilot): checks every ~4 h for 72 h, 4 slots. The public wallet and question are stored on our server.');
    expect(SAVED.indexOf('id="saved-pilot"')).toBeGreaterThan(SAVED.indexOf('id="watched"'));
    // Said once, here: no longer drawn by renderWatched() above the cards.
    expect(APP).not.toContain('Optional monitoring: 4 pilot slots');
  });

  it('has a status line of its own, since the Check screen\'s line is hidden on Saved', () => {
    expect(SAVED).toContain('<p class="status" id="saved-status" role="status" hidden></p>');
    expect(fn('setStatus')).toContain("$('saved-status')");
  });

  it('ends with the "Track another position" panel and its primary "Check a wallet" button', () => {
    const cta = elementById(SAVED, 'saved-next');
    expect(cta).toMatch(/^<section class="cta-panel" id="saved-next" aria-labelledby="saved-next-title">/);
    expect(endsWith(SAVED, cta)).toBe(true);
    expect(cta).toMatch(/<h2 class="cta-title" id="saved-next-title">Track another position<\/h2>/);
    expect(cta).toMatch(/<p class="cta-text" id="saved-next-text">Check a wallet, then press Save on the reading\.<\/p>/);
    expect(cta).toMatch(/<button class="btn" id="saved-check">Check a wallet<\/button>/);
    expect(SAVED.indexOf('id="saved-next"')).toBeGreaterThan(SAVED.indexOf('id="saved-pilot"'));
  });

  it('keeps "Back to your reading" and the old Check a wallet button for their handlers', () => {
    expect(SAVED).toContain('id="saved-return"');
    expect(SAVED).toContain('id="saved-home"');
  });
});

describe('"Check a wallet" on Explore and Saved', () => {
  it('goes to Check the way the reading\'s "What next?" panel does', () => {
    expect(APP).toContain("$('explore-check').addEventListener('click', checkAnother);");
    expect(APP).toContain("$('saved-check').addEventListener('click', checkAnother);");
    expect(fn('checkAnother')).toContain('goCheck(event);');
  });
});

describe('savedCardModel: what a saved position\'s card says', () => {
  it('names the position, the address and the time of the saved reading', () => {
    expect(savedCardModel(savedRow(), { monitoring: false })).toEqual({
      ...NO_COPY,
      title: 'HYPE long',
      meta: '0x082e...ca88 · 07 Oct, 15:56 UTC',
      verdictLabel: 'Saved reading',
      actions: ['monitor', 'refresh', 'remove'],
      monitorOn: false,
    });
  });

  it('puts a name the reader gave it in the title, and the position in the meta', () => {
    expect(savedCardModel(savedRow({ label: 'ETH whale from my alert', coin: 'ETH', side: 'short' }), { monitoring: false })).toMatchObject({
      title: 'ETH whale from my alert',
      meta: 'ETH short · 0x082e...ca88 · 07 Oct, 15:56 UTC',
    });
    // Whole, however long: the card wraps it.
    expect(savedCardModel(savedRow({ label: LONG_NAME }), { monitoring: false }).title).toBe(LONG_NAME);
  });

  it('turns the Monitor switch on while the position is monitored', () => {
    const model = savedCardModel(savedRow({ monitorToken: TOKEN, monitorStatus: 'Scheduled' }), { monitoring: true });
    expect(model.monitorOn).toBe(true);
    expect(model.actions).toEqual(['monitor', 'refresh', 'remove']);
  });

  it('offers no Monitor switch for a position with no saved reading, which monitoring cannot start from', () => {
    expect(savedCardModel(savedRow({ snapshotId: null, checkedAt: null }), { monitoring: false })).toEqual({
      ...NO_COPY,
      title: 'HYPE long',
      meta: '0x082e...ca88',
      verdictLabel: 'No saved reading',
      actions: ['refresh', 'remove'],
      monitorOn: false,
    });
    // One already running can still be stopped.
    expect(savedCardModel(savedRow({ snapshotId: null, monitorToken: TOKEN }), { monitoring: true }).actions).toEqual(['monitor', 'refresh', 'remove']);
  });

  it('names a wallet saved without a position', () => {
    expect(savedCardModel(savedRow({ coin: null, side: null }), { monitoring: false })).toMatchObject({
      title: 'Saved wallet',
      meta: '0x082e...ca88 · 07 Oct, 15:56 UTC',
    });
    expect(savedCardModel(savedRow({ coin: null, side: null, label: 'Cold wallet' }), { monitoring: false })).toMatchObject({
      title: 'Cold wallet',
      meta: '0x082e...ca88 · 07 Oct, 15:56 UTC',
    });
  });

  it('claims no verdict for a row that keeps no copy of its reading (saved before the copy existed)', () => {
    for (const row of [savedRow(), savedRow({ snapshotId: null })]) {
      const model = savedCardModel(row, { monitoring: false });
      expect(Object.values(VERDICT_STYLES).map((v) => v.label)).not.toContain(model.verdictLabel);
      expect(model.verdictClass).toBe('');
    }
  });
});

describe('savedCardModel with the saved reading kept on the row', () => {
  it('shows the verdict with its color class, the amount with the position, and the headline', () => {
    expect(savedCardModel(savedRowWithReading(), { monitoring: false })).toEqual({
      title: '$122.1M',
      asset: 'HYPE long',
      name: '',
      summary: 'This looks like a real bet.',
      meta: '0x082e...ca88 · 07 Oct, 15:56 UTC',
      verdictLabel: 'Looks like a bet',
      verdictClass: 'bet',
      actions: ['monitor', 'refresh', 'remove'],
      monitorOn: false,
    });
  });

  it('puts the reader\'s name under the amount, which keeps its place', () => {
    expect(savedCardModel(savedRowWithReading({ label: 'Friend\'s HYPE', verdict: 'hedged', notionalUsd: 57.3e6, side: 'short' }), { monitoring: false })).toMatchObject({
      title: '$57.3M',
      asset: 'HYPE short',
      name: 'Friend\'s HYPE',
      meta: '0x082e...ca88 · 07 Oct, 15:56 UTC',
      verdictLabel: 'Spot-covered short',
      verdictClass: 'hedged',
    });
  });

  it('falls back to today\'s card for any part it does not have', () => {
    // A verdict but no amount: the verdict, and the title as before.
    expect(savedCardModel(savedRowWithReading({ notionalUsd: null }), { monitoring: false })).toMatchObject({ title: 'HYPE long', asset: '', verdictClass: 'bet' });
    // No position to name the amount by.
    expect(savedCardModel(savedRowWithReading({ coin: null, side: null }), { monitoring: false })).toMatchObject({ title: 'Saved wallet', asset: '' });
    // A verdict the page does not know, or one on a row with no saved reading, is no verdict.
    for (const row of [savedRowWithReading({ verdict: 'constructor' }), savedRowWithReading({ verdict: 'nonsense' }), savedRowWithReading({ snapshotId: null })]) {
      expect(savedCardModel(row, { monitoring: false })).toMatchObject({ verdictClass: '', summary: '' });
    }
  });
});

describe('savedOpenLabel: the accessible name of a saved card\'s open area', () => {
  const label = (row: SavedRow) => savedOpenLabel(row, savedCardModel(row, { monitoring: false }));

  it('says what the card shows, the reading\'s time included, and what opening does', () => {
    expect(label(savedRow())).toBe('HYPE long · 0x082e...ca88 · read 07 Oct, 15:56 UTC · Open saved reading');
    expect(label(savedRow({ label: 'My HYPE long' }))).toBe('My HYPE long · HYPE long · 0x082e...ca88 · read 07 Oct, 15:56 UTC · Open saved reading');
    expect(label(savedRowWithReading())).toBe('HYPE long · 0x082e...ca88 · $122.1M · Looks like a bet · This looks like a real bet. · read 07 Oct, 15:56 UTC · Open saved reading');
    expect(label(savedRow({ snapshotId: null, checkedAt: null }))).toBe('HYPE long · 0x082e...ca88 · No saved reading · Check address');
  });

  it('says the summary sentence the card shows, which the label stands in for', () => {
    const row = savedRowWithReading({ summary: 'Matching assets sit with funding wallets.' });
    expect(savedCardModel(row, { monitoring: false }).summary).toBe('Matching assets sit with funding wallets.');
    expect(label(row)).toContain(' · Matching assets sit with funding wallets. · ');
    // No summary on the card, none in the label.
    expect(label(savedRow())).not.toContain('This looks like a real bet.');
  });

  it('still matches what the browser scripts look for', () => {
    expect(label(savedRow())).toMatch(/HYPE long.*0x082e.*Open saved/);
    expect(label(savedRowWithReading())).toMatch(/HYPE long.*0x082e.*Open saved/);
    expect(label(savedRow({ label: 'Audit Save Share', coin: 'ETH', side: 'short' }))).toMatch(/Audit Save Share.*Open saved/);
    expect(label(savedRowWithReading({ label: 'Audit Save Share', coin: 'ETH', side: 'short' }))).toMatch(/Audit Save Share.*Open saved/);
  });
});

describe('withReadingSummary: the copy of its reading a saved row keeps', () => {
  const reading = (over: Partial<Reading> = {}): Reading => ({
    snapshotId: '0aio3f82kqsu9',
    headline: 'This looks like a real bet.',
    verdict: { verdict: 'looks_like_a_bet', reasons: [] },
    positions: { nPositions: 1, headlineNotionalUsd: 122144815.75 },
    ...over,
  });

  it('copies the verdict, the amount and the headline when the row is saved at that very reading', () => {
    expect(withReadingSummary(savedRow(), reading())).toEqual({
      ...savedRow(),
      verdict: 'looks_like_a_bet',
      notionalUsd: 122144815.75,
      summary: 'This looks like a real bet.',
    });
  });

  it('uses the headline the reading screen shows, cut to 160 characters at a word boundary, with an ellipsis only when cut', () => {
    expect(withReadingSummary(savedRow(), reading({ headline: undefined, verdict: { verdict: 'hedged', reasons: [] } })).summary).toBe(VERDICT_STYLES.hedged.headline);
    const long = 'The matching assets sit in a wallet that funded this account, not in this account, and the funding wallet holds more than the short is worth at today’s mark price.';
    expect(long.length).toBeGreaterThan(160);
    const summary = withReadingSummary(savedRow(), reading({ headline: long })).summary!;
    expect(summary).toBe('The matching assets sit in a wallet that funded this account, not in this account, and the funding wallet holds more than the short is worth at today’s mark…');
    // Still within what watched() keeps.
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(watchedFrom([{ ...savedRowWithReading(), summary }])[0].summary).toBe(summary);
    // One word with no space to cut at: cut inside it, and still said to be cut.
    expect(withReadingSummary(savedRow(), reading({ headline: 'x'.repeat(200) })).summary).toBe('x'.repeat(159) + '…');
  });

  it('cutAtWord: whole when it fits, otherwise whole words and an ellipsis within the limit', () => {
    expect(cutAtWord('x'.repeat(160), 160)).toBe('x'.repeat(160));
    expect(cutAtWord('A short headline.', 160)).toBe('A short headline.');
    expect(cutAtWord('one two three four', 12)).toBe('one two…');
    // A space right where the cut falls: the last word is whole already.
    expect(cutAtWord('one two three four', 14)).toBe('one two three…');
    expect(cutAtWord('one two  three', 10)).toBe('one two…');
    for (const max of [5, 12, 14, 17]) expect(cutAtWord('one two three four', max).length).toBeLessThanOrEqual(max);
  });

  it('leaves the row as it is for any other reading, or a reading that was not saved', () => {
    const row = savedRow({ snapshotId: 'an-older-reading' });
    expect(withReadingSummary(row, reading())).toEqual(row);
    expect(withReadingSummary(savedRow({ snapshotId: null }), reading())).toEqual(savedRow({ snapshotId: null }));
    expect(withReadingSummary(savedRow(), reading({ snapshotSaved: false }))).toEqual(savedRow());
  });

  it('is written by Save and by a live check of a saved position, and filled in when a saved reading is opened', () => {
    expect(fn('updateSavedPosition')).toContain('withReadingSummary(advanceSavedReading(row, d), d)');
    expect(APP).toMatch(/const row = withReadingSummary\(advanceSavedReading\(existing \|\| \{[^\n]*\}, current\), current\);/);
    expect(fn('renderResult')).toContain('backfillSavedRow(d);');
  });
});

describe('backfillSavedRow: a row saved before the copy existed gets it when its reading is opened', () => {
  function backfill(rows: SavedRow[], d: Reading & { address: string }) {
    const calls: string[] = [];
    const stored: string[] = [];
    const body = [...['verdictOf', 'headlineFor', 'cutAtWord', 'withReadingSummary', 'backfillSavedRow'].map(fn), 'return backfillSavedRow;'].join('\n');
    const run = new Function('VERDICTS', 'watched', 'localStorage', 'WATCH_KEY', 'renderWatched', body)(
      VERDICT_STYLES,
      () => rows.map((r) => ({ ...r })),
      { setItem: (_key: string, value: string) => { stored.push(value); } },
      'betOrBook:watch',
      () => calls.push('renderWatched'),
    ) as (d: unknown) => void;
    run(d);
    return { calls, stored: stored.map((s) => JSON.parse(s) as SavedRow[]) };
  }
  const opened = { address: '0x082E843A431AEF031264DC232693DD710AEDCA88', snapshotId: '0aio3f82kqsu9', headline: 'This looks like a real bet.', verdict: { verdict: 'looks_like_a_bet', reasons: [] }, positions: { nPositions: 1, headlineNotionalUsd: 122144815.75 } };

  it('fills the copy in on the row saved at that reading, and redraws the cards', () => {
    const { calls, stored } = backfill([savedRow({ coin: 'ETH', snapshotId: 'another-reading' }), savedRow()], opened);
    expect(stored).toHaveLength(1);
    expect(stored[0][0]).toEqual(savedRow({ coin: 'ETH', snapshotId: 'another-reading' }));
    expect(stored[0][1]).toMatchObject({ verdict: 'looks_like_a_bet', notionalUsd: 122144815.75, summary: 'This looks like a real bet.' });
    expect(calls).toEqual(['renderWatched']);
  });

  it('writes nothing when the row has its copy already, or no row is saved at that reading', () => {
    expect(backfill([savedRowWithReading()], opened).stored).toEqual([]);
    expect(backfill([savedRow({ snapshotId: 'another' })], opened).stored).toEqual([]);
    expect(backfill([], opened).calls).toEqual([]);
  });
});

describe('watched(): what is read back from the storage key', () => {
  it('keeps a valid copy of the reading', () => {
    expect(watchedFrom([savedRowWithReading()])[0]).toMatchObject({ verdict: 'looks_like_a_bet', notionalUsd: 122144815.75, summary: 'This looks like a real bet.' });
  });

  it('drops an unknown verdict, an amount that is not a finite number and a summary over 160 characters', () => {
    const rows = watchedFrom([
      savedRowWithReading({ verdict: 'constructor' }),
      savedRowWithReading({ verdict: 'moon' }),
      { ...savedRowWithReading(), notionalUsd: 'NaN' },
      { ...savedRowWithReading(), notionalUsd: null },
      { ...savedRowWithReading(), summary: 'x'.repeat(161) },
      { ...savedRowWithReading(), summary: 42 },
    ]);
    expect(rows.map((r) => r.verdict)).toEqual([null, null, 'looks_like_a_bet', 'looks_like_a_bet', 'looks_like_a_bet', 'looks_like_a_bet']);
    expect(rows.map((r) => r.notionalUsd)).toEqual([122144815.75, 122144815.75, null, null, 122144815.75, 122144815.75]);
    expect(rows.map((r) => r.summary)).toEqual(['This looks like a real bet.', 'This looks like a real bet.', 'This looks like a real bet.', 'This looks like a real bet.', null, null]);
  });

  it('reads a row saved before the copy existed with the copy empty', () => {
    expect(watchedFrom([savedRow()])[0]).toMatchObject({ ...savedRow(), verdict: null, notionalUsd: null, summary: null });
  });

  it('still reads every row in a browser without Object.hasOwn (Safari before 15.4)', () => {
    // There a throw would make watched() return [], and the next Save would
    // write that empty list over every saved row.
    const OldObject = { prototype: Object.prototype };
    const old = (stored: unknown) =>
      new Function('localStorage', 'WATCH_KEY', 'ADDRESS_RE', 'VERDICTS', 'Object', `${fn('watched')}\nreturn watched();`)(
        { getItem: (key: string) => (key === 'betOrBook:watch' ? JSON.stringify(stored) : null) },
        'betOrBook:watch',
        /^0x[0-9a-f]{40}$/,
        VERDICT_STYLES,
        OldObject,
      ) as SavedRow[];
    const rows = old([savedRowWithReading(), savedRowWithReading({ verdict: 'constructor', coin: 'BTC' })]);
    expect(rows.map((r) => r.verdict)).toEqual(['looks_like_a_bet', null]);
    const model = new Function('VERDICTS', 'Object', [...SAVED_HELPERS.map(fn), 'return savedCardModel;'].join('\n'))(VERDICT_STYLES, OldObject)(
      savedRowWithReading(),
      { monitoring: false },
    ) as SavedCardModel;
    expect(model).toMatchObject({ verdictLabel: 'Looks like a bet', verdictClass: 'bet' });
  });
});

describe('savedEmptyState: the Saved screen\'s closing panel', () => {
  it('with nothing saved, is the whole screen and says how to save', () => {
    expect(savedEmptyState(0)).toEqual({ empty: true, ctaTitle: 'Nothing saved yet', ctaText: 'Check a wallet, then press Save on the reading.' });
  });

  it('with anything saved, invites one more', () => {
    for (const n of [1, 3, 12]) {
      expect(savedEmptyState(n)).toEqual({ empty: false, ctaTitle: 'Track another position', ctaText: 'Check a wallet, then press Save on the reading.' });
    }
  });
});

describe('renderWatched: the saved position cards', () => {
  /** web/app.js renderWatched() run for real on `rows`, with stand-ins for what it calls. */
  function drawSaved(rows: SavedRow[]) {
    const calls: string[] = [];
    const $ = elementsById();
    const stored: string[] = [];
    const localStorage = { setItem: (_key: string, value: string) => { stored.push(value); } };
    // What the page reads back: the last write, or the rows it started with.
    const watched = () => (stored.length ? (JSON.parse(stored[stored.length - 1]) as SavedRow[]) : rows).map((r) => ({ ...r }));
    const monitoring = {
      button: (row: SavedRow, name: string) => {
        const b = el('button', 'btn-secondary monitor-toggle', 'Monitor');
        b.setAttribute('role', 'switch');
        b.setAttribute('aria-checked', String(!!row.monitorToken));
        b.setAttribute('aria-label', `Monitor ${name} (pilot)`);
        return b;
      },
      notices: () => el('div', 'monitor-notices'),
    };
    const body = [
      ...[...SAVED_HELPERS, 'fillSavedOpen', 'renderWatched'].map(fn),
      'return renderWatched;',
    ].join('\n');
    const renderWatched = new Function(
      'VERDICTS', '$', 'el', 'watched', 'renderSavedCount', 'monitoring', 'openSnapshot', 'showExamples', 'setStatus',
      'checkPosition', 'runCheck', 'busy', 'localStorage', 'WATCH_KEY', 'watchIdentity', body,
    )(
      VERDICT_STYLES, $, el, watched, () => calls.push('renderSavedCount'), monitoring,
      (id: string, navigation?: string) => calls.push(`openSnapshot ${id} ${navigation}`),
      () => calls.push('showExamples'),
      (text: string, isError?: boolean) => calls.push(`setStatus ${text}${isError ? ' (error)' : ''}`),
      (address: string) => calls.push(`checkPosition ${address}`),
      () => calls.push('runCheck'),
      false, localStorage, 'betOrBook:watch',
      (row: SavedRow) => row.address + ':' + (row.coin || '') + ':' + (row.side || ''),
    ) as (focus?: unknown) => void;
    FakeElement.focused.length = 0;
    renderWatched();
    return { $, calls, stored, cards: $('watched').elements, current: () => $('watched').elements, renderWatched };
  }
  const isButton = (e: FakeElement) => e.tag === 'button';

  it('draws one card per saved position: an open area and, beside it, the controls', () => {
    const rows = [savedRow(), savedRow({ coin: 'ETH', side: 'short', label: LONG_NAME, monitorToken: TOKEN }), savedRow({ address: '0x' + '1'.repeat(40), snapshotId: null, checkedAt: null })];
    const { $, cards } = drawSaved(rows);
    expect($('watched').hidden).toBe(false);
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.tag).toBe('div');
      expect(card.className).toBe('card-position saved-card');
      const [open, actions] = card.elements;
      expect(open.tag).toBe('button');
      expect(open.className).toBe('saved-open');
      expect(actions.className).toBe('cp-actions');
      // No control inside another: the open area holds text only.
      expect(open.descendants().filter(isButton)).toEqual([]);
      for (const control of actions.descendants()) expect(control.descendants().filter(isButton)).toEqual([]);
    }
  });

  it('shows the card pattern in the open area: the label, the title, the meta and "Open"', () => {
    const { cards } = drawSaved([savedRow({ label: 'My HYPE long' })]);
    const open = cards[0].elements[0];
    expect(serialize(open)).toBe(
      '<button class="saved-open"><span class="mono-label">Saved reading</span><span class="cp-amount">My HYPE long</span>' +
        '<span class="cp-footer"><span class="cp-meta">HYPE long · 0x082e...ca88 · 07 Oct, 15:56 UTC</span><span class="cp-open">Open →</span></span></button>',
    );
    expect(open.attrs['aria-label']).toBe('My HYPE long · HYPE long · 0x082e...ca88 · read 07 Oct, 15:56 UTC · Open saved reading');
  });

  it('with the reading kept on the row, shows its verdict with the dot, the amount, the reader\'s name and the headline', () => {
    const { cards } = drawSaved([savedRowWithReading({ label: 'My HYPE long' })]);
    const open = cards[0].elements[0];
    expect(serialize(open)).toBe(
      '<button class="saved-open"><span class="cp-verdict badge bet">Looks like a bet</span>' +
        '<span class="cp-amount">$122.1M <span class="cp-asset">HYPE long</span></span>' +
        '<span class="saved-name">My HYPE long</span><span class="cp-summary">This looks like a real bet.</span>' +
        '<span class="cp-footer"><span class="cp-meta">0x082e...ca88 · 07 Oct, 15:56 UTC</span><span class="cp-open">Open →</span></span></button>',
    );
    expect(open.attrs['aria-label']).toBe('My HYPE long · HYPE long · 0x082e...ca88 · $122.1M · Looks like a bet · This looks like a real bet. · read 07 Oct, 15:56 UTC · Open saved reading');
  });

  it('draws a row saved before the copy existed beside one that has it', () => {
    const { cards } = drawSaved([savedRow(), savedRowWithReading({ coin: 'ETH', side: 'short', verdict: 'unknown', notionalUsd: 212.1e6, summary: 'The matching assets sit in a wallet that funded this account, not in this account.' })]);
    expect(cards.map((c) => c.elements[0].elements.map((e) => e.className))).toEqual([
      ['mono-label', 'cp-amount', 'cp-footer'],
      ['cp-verdict badge unknown', 'cp-amount', 'cp-summary', 'cp-footer'],
    ]);
    expect(cards[1].elements[0].elements[1].textContent).toBe('$212.1M ETH short');
  });

  it('puts the name field, then Monitor, Refresh and Remove, in the controls', () => {
    const { cards } = drawSaved([savedRow(), savedRow({ coin: 'ETH', snapshotId: null, checkedAt: null })]);
    const controls = (card: FakeElement) => card.elements[1].elements.map((c) => `${c.tag}.${c.className}:${c.textContent}`);
    expect(controls(cards[0])).toEqual([
      'input.watch-label:',
      'button.btn-secondary monitor-toggle:Monitor',
      'button.btn-secondary:Refresh',
      'button.btn-ghost danger:Remove',
    ]);
    // No saved reading to monitor from: no switch.
    expect(controls(cards[1])).toEqual(['input.watch-label:', 'button.btn-secondary:Refresh', 'button.btn-ghost danger:Remove']);
    const [name, monitor, refresh, remove] = cards[0].elements[1].elements;
    expect(name.attrs['aria-label']).toBe('Name saved position HYPE long · 0x082e...ca88');
    // The switch gets the same unique name as Refresh and Remove.
    expect(monitor.attrs['aria-label']).toBe('Monitor HYPE long · 0x082e...ca88 (pilot)');
    expect(name.placeholder).toBe('Name this position');
    expect(name.maxLength).toBe(80);
    expect(refresh.attrs['aria-label']).toBe('Refresh HYPE long · 0x082e...ca88 with a new check');
    expect(remove.attrs['aria-label']).toBe('Remove HYPE long · 0x082e...ca88');
  });

  it('shows the monitoring notices under a monitored card only', () => {
    const { cards } = drawSaved([savedRow(), savedRow({ coin: 'ETH', monitorToken: TOKEN })]);
    expect(cards[0].elements.map((e) => e.className)).toEqual(['saved-open', 'cp-actions']);
    expect(cards[1].elements.map((e) => e.className)).toEqual(['saved-open', 'cp-actions', 'monitor-notices']);
  });

  it('opens the saved reading, or fills the address in when there is none', async () => {
    const { cards, calls } = drawSaved([savedRow(), savedRow({ coin: 'ETH', snapshotId: null, checkedAt: null })]);
    calls.length = 0;
    await cards[0].elements[0].fire('click');
    expect(calls).toEqual(['openSnapshot 0aio3f82kqsu9 push']);
    calls.length = 0;
    await cards[1].elements[0].fire('click');
    expect(calls).toEqual(['showExamples', 'setStatus Address filled in. Press Check to run a reading.']);
    expect(cards[1].elements[0].textContent).toContain('Check address →');
  });

  it('refuses to remove a monitored position, and removes any other', async () => {
    const rows = [savedRow({ monitorToken: TOKEN }), savedRow({ coin: 'ETH', side: 'short' })];
    const { cards, calls, stored } = drawSaved(rows);
    calls.length = 0;
    const remove = (card: FakeElement) => card.elements[1].elements.find((c) => c.textContent === 'Remove')!;
    await remove(cards[0]).fire('click');
    // The control is the Monitor switch: the sentence names it.
    expect(calls).toEqual(['setStatus Turn Monitor off before removing this saved position. (error)']);
    expect(stored).toEqual([]);
    await remove(cards[1]).fire('click');
    expect(stored).toHaveLength(1);
    expect((JSON.parse(stored[0]) as SavedRow[]).map((r) => r.coin)).toEqual(['HYPE']);
  });

  it('refreshes a position with a new check', async () => {
    const { cards, calls } = drawSaved([savedRow()]);
    calls.length = 0;
    await cards[0].elements[1].elements.find((c) => c.textContent === 'Refresh')!.fire('click');
    expect(calls).toEqual(['checkPosition 0x082e843a431aef031264dc232693dd710aedca88']);
  });

  it('renames a position in place, without drawing the list again', async () => {
    const { cards, stored, calls } = drawSaved([savedRow()]);
    calls.length = 0;
    const [open, actions] = cards[0].elements;
    const name = actions.elements[0];
    name.value = '  Friend\'s HYPE long  ';
    await name.fire('input');
    expect((JSON.parse(stored[0]) as SavedRow[])[0].label).toBe('Friend\'s HYPE long');
    expect(open.elements[1].textContent).toBe('Friend\'s HYPE long');
    expect(open.elements[2].elements[0].textContent).toBe('HYPE long · 0x082e...ca88 · 07 Oct, 15:56 UTC');
    expect(open.attrs['aria-label']).toBe('Friend\'s HYPE long · HYPE long · 0x082e...ca88 · read 07 Oct, 15:56 UTC · Open saved reading');
    expect(calls).toEqual([]);
  });

  it('renames a card that shows its reading by the name line under the amount', async () => {
    const { cards } = drawSaved([savedRowWithReading()]);
    const [open, actions] = cards[0].elements;
    actions.elements[0].value = 'Friend\'s HYPE long';
    await actions.elements[0].fire('input');
    expect(open.elements.map((e) => e.className)).toEqual(['cp-verdict badge bet', 'cp-amount', 'saved-name', 'cp-summary', 'cp-footer']);
    expect(open.elements[2].textContent).toBe('Friend\'s HYPE long');
  });

  it('keeps the reading copy through a rename: it is written back with the row', async () => {
    const { cards, stored } = drawSaved([savedRowWithReading()]);
    const name = cards[0].elements[1].elements[0];
    name.value = 'x';
    await name.fire('input');
    expect((JSON.parse(stored[0]) as SavedRow[])[0]).toMatchObject({ label: 'x', verdict: 'looks_like_a_bet', notionalUsd: 122144815.75 });
  });

  it('after Remove, moves focus to the card that took its place, or to the Saved heading', async () => {
    const { $, current } = drawSaved([savedRow(), savedRow({ coin: 'ETH' }), savedRow({ coin: 'BTC' })]);
    const remove = (card: FakeElement) => card.elements[1].elements.find((c) => c.textContent === 'Remove')!;
    FakeElement.focused.length = 0;
    await remove(current()[0]).fire('click');
    expect(current()).toHaveLength(2);
    expect(FakeElement.focused).toEqual([current()[0].elements[0]]);
    expect(current()[0].elements[0].attrs['aria-label']).toMatch(/^ETH long/);
    // The last card: nothing after it, so the heading.
    FakeElement.focused.length = 0;
    await remove(current()[1]).fire('click');
    expect(FakeElement.focused).toEqual([$('saved-title')]);
  });

  it('after a Monitor toggle, puts focus back on the redrawn switch of the same card', () => {
    const { current, renderWatched } = drawSaved([savedRow(), savedRow({ coin: 'ETH' })]);
    FakeElement.focused.length = 0;
    renderWatched({ identity: '0x082e843a431aef031264dc232693dd710aedca88:ETH:long', control: 'monitor' });
    expect(FakeElement.focused).toEqual([current()[1].elements[1].elements[1]]);
    expect(FakeElement.focused[0].className).toBe('btn-secondary monitor-toggle');
  });

  it('moves no focus on an ordinary redraw', () => {
    const { renderWatched } = drawSaved([savedRow()]);
    FakeElement.focused.length = 0;
    renderWatched();
    expect(FakeElement.focused).toEqual([]);
  });

  it('with nothing saved, hides the cards and the pilot note and says so in the closing panel', () => {
    const { $, cards } = drawSaved([]);
    expect(cards).toEqual([]);
    expect($('watched').hidden).toBe(true);
    expect($('saved-pilot').hidden).toBe(true);
    expect($('saved-next-title').textContent).toBe('Nothing saved yet');
    expect($('saved-next-text').textContent).toBe('Check a wallet, then press Save on the reading.');
  });

  it('with anything saved, shows the pilot note and invites one more', () => {
    const { $ } = drawSaved([savedRow()]);
    expect($('saved-pilot').hidden).toBe(false);
    expect($('saved-next-title').textContent).toBe('Track another position');
  });

  it('keeps the Saved count in step', () => {
    expect(drawSaved([savedRow()]).calls[0]).toBe('renderSavedCount');
  });
});

describe('the Monitor switch (web/monitor.js)', () => {
  type FetchResult = { ok: boolean; json: () => Promise<unknown> };
  function monitorWith(fetchJson: (url: string, init: { body: string }) => Promise<FetchResult>, rows: SavedRow[]) {
    const calls: string[] = [];
    const document = { createElement: (tag: string) => el(tag), hidden: false, activeElement: null, addEventListener: () => {} };
    const createMonitoring = new Function('document', 'setInterval', `${MONITOR.replace(/^export function/m, 'function')}\nreturn createMonitoring;`)(
      document,
      () => 0,
    ) as (options: object) => { button: (row: SavedRow, name?: string) => FakeElement };
    let saved = rows.map((r) => ({ ...r }));
    const monitoring = createMonitoring({
      read: () => saved.map((r) => ({ ...r })),
      write: (next: SavedRow[]) => { saved = next; calls.push('write'); },
      render: (focus?: unknown) => calls.push(focus ? `render ${JSON.stringify(focus)}` : 'render'),
      status: (text: string, isError?: boolean) => calls.push(`status ${text}${isError ? ' (error)' : ''}`),
      fetchJson: (url: string, init: { body: string }) => { calls.push(`fetch ${url} ${JSON.parse(init.body).action}`); return fetchJson(url, init); },
    });
    return { monitoring, calls, saved: () => saved };
  }
  const answer = (ok: boolean, body: unknown) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

  it('is a secondary button holding a switch and the word Monitor, off or on with the monitor token', () => {
    const { monitoring } = monitorWith(() => answer(true, {}), []);
    const off = monitoring.button(savedRow());
    expect(off.tag).toBe('button');
    expect(off.className).toBe('btn-secondary monitor-toggle');
    expect(off.attrs.role).toBe('switch');
    expect(off.attrs['aria-checked']).toBe('false');
    expect(off.disabled).toBe(false);
    expect(serialize(off)).toBe('<button class="btn-secondary monitor-toggle"><span class="switch"><span class="switch-knob"></span></span>Monitor</button>');
    expect(off.elements[0].attrs['aria-hidden']).toBe('true');
    // Named by the card's unique name (savedRowName), as Refresh and Remove are.
    expect(monitoring.button(savedRow(), 'HYPE long · 0x082e...ca88').attrs['aria-label']).toBe('Monitor HYPE long · 0x082e...ca88 (pilot)');
    expect(off.attrs['aria-label']).toBe('Monitor HYPE (pilot)');
    expect(monitoring.button(savedRow({ label: 'My long', monitorToken: TOKEN }), 'My long · HYPE long · 0x082e...ca88').attrs).toMatchObject({ 'aria-checked': 'true', 'aria-label': 'Monitor My long · HYPE long · 0x082e...ca88 (pilot)' });
    expect(monitoring.button(savedRow({ snapshotId: null })).disabled).toBe(true);
  });

  it('turns on at once and stays on once the server has subscribed the saved reading', async () => {
    const { monitoring, calls, saved } = monitorWith(() => answer(true, { token: TOKEN, expiresAt: '2026-10-25T00:00:00Z' }), [savedRow()]);
    const b = monitoring.button(savedRow());
    const done = b.fire('click');
    expect(b.attrs['aria-checked']).toBe('true');
    expect(b.disabled).toBe(true);
    await done;
    // The list is drawn again with focus back on this card's switch.
    expect(calls).toEqual(['fetch /api/watch subscribe', 'write', 'render {"identity":"0x082e843a431aef031264dc232693dd710aedca88:HYPE:long","control":"monitor"}']);
    expect(saved()[0]).toMatchObject({ monitorToken: TOKEN, monitorExpires: '2026-10-25T00:00:00Z' });
  });

  it('turns back off, and says why, when the server refuses, keeping focus on the switch', async () => {
    const { monitoring, calls, saved } = monitorWith(() => answer(false, { error: 'All 4 pilot slots are in use' }), [savedRow()]);
    const b = monitoring.button(savedRow());
    FakeElement.focused.length = 0;
    await b.fire('click');
    expect(b.attrs['aria-checked']).toBe('false');
    expect(b.disabled).toBe(false);
    expect(FakeElement.focused).toEqual([b]);
    expect(calls).toEqual(['fetch /api/watch subscribe', 'status All 4 pilot slots are in use (error)']);
    expect(saved()[0].monitorToken).toBeNull();
  });

  it('turns off by unsubscribing the monitor token', async () => {
    const row = savedRow({ monitorToken: TOKEN, monitorStatus: 'Scheduled' });
    const { monitoring, calls, saved } = monitorWith(() => answer(true, {}), [row]);
    const b = monitoring.button(row);
    const done = b.fire('click');
    expect(b.attrs['aria-checked']).toBe('false');
    await done;
    expect(calls).toEqual(['fetch /api/watch unsubscribe', 'write', 'render {"identity":"0x082e843a431aef031264dc232693dd710aedca88:HYPE:long","control":"monitor"}']);
    expect(saved()[0]).toMatchObject({ monitorToken: null, monitorStatus: '', monitorEvents: [], monitorExpires: null });
  });
});

describe('the styles of the two screens', () => {
  it('lays the case studies out two to a row and the saved cards at up to 520 px', () => {
    expect(rule('#case-study-list > .card-position')).toContain('flex: 1 1 400px;');
    expect(rule('.saved-card')).toContain('flex: 0 1 520px;');
  });

  it('draws the Monitor switch 30 by 18, its knob sliding from 2 px to 14 px and its track turning accent over 150 ms', () => {
    const track = rule('.switch');
    expect(track).toMatch(/width: 30px;.*height: 18px;/);
    expect(track).toContain('background: var(--switch-track);');
    expect(track).toContain('transition: background-color .15s;');
    const knob = rule('.switch-knob');
    expect(knob).toContain('left: 2px;');
    expect(knob).toContain('transition: left .15s;');
    expect(rule('.monitor-toggle[aria-checked="true"] .switch')).toBe('background: var(--accent);');
    expect(rule('.monitor-toggle[aria-checked="true"] .switch-knob')).toBe('left: 14px;');
    expect(PAGE).toMatch(/--switch-track: #2A2E3A;/);
  });

  it('lights a saved card\'s border only while the pointer is on the part that opens it', () => {
    expect(rule('.saved-card:hover')).toBe('border-color: var(--border);');
    expect(rule('.saved-card:has(.saved-open:hover)')).toBe('border-color: var(--border-hover);');
  });

  it('draws the focus ring inside the rows of All readings and the archive, whose panel clips', () => {
    expect(rule('#gallery-list, #archive-list')).toContain('overflow: hidden;');
    expect(rule('#gallery-list > li > button:focus-visible, #archive-list > li > button:focus-visible')).toBe('outline-offset: -2px;');
  });

  it('turns Remove red on hover and sets the pilot note in 15 px faint text', () => {
    expect(rule('.btn-ghost.danger:hover')).toBe('color: var(--danger);');
    const note = rule('.saved-pilot');
    expect(note).toContain('font-size: 15px;');
    expect(note).toContain('color: var(--text-faint);');
  });
});
