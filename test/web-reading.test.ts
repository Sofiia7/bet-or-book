import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import featuredData from '../data/featured.json';
import type { Gallery } from '../src/gallery';
import { openQuestion } from '../src/engine/openQuestion';
import { whatWouldChange } from '../src/engine/presentation';
import { extractPageFunction } from './support/pageScript';

/**
 * The Reading screen of the owner's handoff ("Screens > 2. Reading"): a
 * header row (eyebrow, title, meta, Save / Share / Check live), six numbered
 * sections, and the "What next?" panel. The markup is read from
 * web/index.html; the rules that decide which sections have anything to show
 * are pure helpers cut out of web/app.js and run on stored readings.
 */

const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const CSS = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((m) => m[1])
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const featured = featuredData as unknown as Gallery;
const fn = (name: string) => extractPageFunction(APP, name);

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
const openingTag = (html: string, id: string) => new RegExp(`<\\w+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const idsIn = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const CARD = elementById(PAGE, 'card');

const SECTIONS = [
  ['section-verdict', 'Verdict'],
  ['section-evidence', 'Evidence'],
  ['section-changed', 'Since last read'],
  ['section-blind-spots', 'Blind spots'],
  ['section-coverage', 'Spot coverage'],
  ['section-analysis', 'Full analysis'],
] as const;

describe('the reading skeleton in web/index.html', () => {
  it('holds the six numbered sections inside #card, in the handoff order', () => {
    expect(CARD).not.toBe('');
    const found = [...CARD.matchAll(/<section\b([^>]*)>/g)]
      .map((m) => m[1])
      .filter((attrs) => /\bclass="[^"]*\breading-section\b/.test(attrs))
      .map((attrs) => attrs.match(/\bid="([^"]+)"/)?.[1]);
    expect(found).toEqual(SECTIONS.map(([id]) => id));
  });

  it('names each section by its title, which carries no number of its own', () => {
    for (const [id, title] of SECTIONS) {
      const section = elementById(CARD, id);
      const labelledBy = openingTag(CARD, id).match(/\baria-labelledby="([^"]+)"/)?.[1];
      expect(labelledBy, id).toBeDefined();
      expect(textOf(elementById(section, labelledBy!)), id).toBe(title);
    }
    // The visible number is CSS generated content, so a hidden section
    // leaves no gap and the title alone is the accessible name.
    expect(CARD).not.toMatch(/>\s*0[1-6]\s*</);
  });

  it('numbers the sections with a CSS counter that a hidden section does not advance', () => {
    expect(CSS).toMatch(/#card\s*\{[^}]*counter-reset:\s*reading-section/);
    expect(CSS).toMatch(/\.reading-section\s*\{[^}]*counter-increment:\s*reading-section/);
    expect(CSS).toMatch(/content:\s*counter\(reading-section,\s*decimal-leading-zero\)/);
    // display: none, which takes an element out of counting.
    expect(CSS).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  });

  it('puts each part of the reading in its section', () => {
    const parts: Record<string, string[]> = {
      'section-verdict': ['badge', 'source-warning', 'headline', 'takeaway', 'summary'],
      'section-evidence': ['decisive', 'nansen-preview'],
      'section-changed': ['changed', 'changed-title', 'changed-list', 'changed-previous'],
      'section-blind-spots': ['open-question', 'what-changes', 'standing-limit', 'risk-preview', 'coverage', 'coverage-list'],
      'section-coverage': ['breakdown', 'breakdown-caption', 'breakdown-svg', 'diagram-legend', 'breakdown-quality'],
      'section-analysis': ['full-analysis', 'meta', 'market-diagnostics', 'load-context', 'decided', 'stats', 'vitals', 'funders', 'notes', 'nansen', 'analysis-limit', 'claim-checker', 'claim-choice'],
    };
    for (const [section, ids] of Object.entries(parts)) {
      const inside = idsIn(elementById(CARD, section));
      for (const id of ids) expect(inside, `${id} in ${section}`).toContain(id);
    }
  });

  it('makes each section title an H2 under the reading\'s H1, and the verdict sentence an H3 in Verdict', () => {
    // Headings, so a screen reader's heading list walks the six sections.
    for (const [id] of SECTIONS) {
      const labelledBy = openingTag(CARD, id).match(/\baria-labelledby="([^"]+)"/)![1];
      expect(openingTag(CARD, labelledBy), id).toMatch(/^<h2\b[^>]*class="[^"]*\bsection-title\b/);
    }
    expect(openingTag(CARD, 'headline')).toMatch(/^<h3\b[^>]*class="headline"/);
    expect(openingTag(CARD, 'reading-title')).toMatch(/^<h1\b[^>]*tabindex="-1"/);
    expect([...CARD.matchAll(/<h1\b/g)]).toHaveLength(1);
  });

  it('draws them as before: the 17 px section label, the 40 px verdict sentence', () => {
    const rule = (selector: string) => [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].trim() === selector).map((m) => m[2]).join(';');
    // The class, not the tag, sets the look; the H2's own size, tracking and
    // color are undone.
    expect(rule('.section-title')).toMatch(/font-size:\s*17px/);
    expect(rule('.section-title')).toMatch(/font-weight:\s*600/);
    expect(rule('.section-title')).toMatch(/letter-spacing:\s*normal/);
    expect(rule('.section-title')).toMatch(/color:\s*inherit/);
    expect(rule('.headline')).toMatch(/font-size:\s*clamp\(30px,\s*5vw,\s*40px\)/);
    expect(rule('.headline')).toMatch(/font-weight:\s*700/);
    expect(rule('.headline')).toMatch(/letter-spacing:\s*-0\.035em/);
    expect(rule('.headline')).toMatch(/line-height:\s*1\.1\b/);
  });

  it('starts with the header: the eyebrow, the title and meta, then Save, Share and Check live', () => {
    const firstSection = CARD.indexOf('id="section-verdict"');
    const at = (id: string) => CARD.indexOf(`id="${id}"`);
    expect(openingTag(CARD, 'snapshot-text')).toMatch(/\bclass="eyebrow"/);
    const order = ['snapshot-text', 'reading-title', 'reading-meta', 'watch-address', 'share', 'check-live', 'subject', 'picker'];
    for (const id of order) expect(at(id), id).toBeGreaterThan(-1);
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
    expect(at('picker')).toBeLessThan(firstSection);
    expect(openingTag(CARD, 'watch-address')).toMatch(/^<button\b[^>]*class="btn-secondary"/);
    expect(openingTag(CARD, 'check-live')).toMatch(/^<button\b[^>]*class="btn"/);
    // The old box that held the date and Check live is gone.
    expect(PAGE).not.toContain('id="snapshot"');
  });

  it('turns the five share buttons into one Share menu', () => {
    const share = elementById(CARD, 'share');
    expect(share).toMatch(/^<details\b[^>]*class="share"/);
    expect(textOf(elementById(share, 'share-toggle'))).toBe('Share');
    expect(openingTag(share, 'share-toggle')).toMatch(/^<summary\b/);
    const menu = elementById(share, 'share-menu');
    const buttons = [...menu.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(['copy-link', 'copy-reading', 'copy-embed', 'share-x', 'download-image']);
    // Nowhere else on the page.
    for (const id of buttons) expect(PAGE.split(`id="${id}"`)).toHaveLength(2);
  });

  it('styles the menu as the handoff draws it', () => {
    const rule = (selector: RegExp) => [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => selector.test(m[1])).map((m) => m[2]).join(';');
    const menu = rule(/^\s*\.share-menu\s*$/);
    expect(menu).toMatch(/width:\s*240px/);
    expect(menu).toMatch(/background:\s*var\(--menu-bg\)/);
    expect(menu).toMatch(/border:\s*1px solid var\(--menu-border\)/);
    expect(menu).toMatch(/border-radius:\s*12px/);
    expect(menu).toMatch(/box-shadow:\s*0 20px 40px rgba\(0,\s*0,\s*0,\s*0?\.5\)/);
    expect(rule(/\.share-menu button\s*$/)).toMatch(/min-height:\s*40px/);
    expect(rule(/\.share-menu button:hover/)).toMatch(/background:\s*var\(--menu-hover\)/);
  });

  it('makes Full analysis a collapsible row that also holds the claim checker', () => {
    const analysis = elementById(CARD, 'full-analysis');
    expect(analysis).toMatch(/^<details\b/);
    const summary = analysis.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
    expect(textOf(summary)).toBe('Full analysis Metrics, rules, sources and alert assertions');
    expect(elementById(analysis, 'claim-checker')).toMatch(/^<details\b/);
  });

  it('ends with the "What next?" panel: back to where the reading came from, and Check a wallet', () => {
    const panel = elementById(CARD, 'reading-next');
    expect(openingTag(CARD, 'reading-next')).toMatch(/\bclass="cta-panel"/);
    expect(textOf(panel)).toContain('What next?');
    expect(openingTag(panel, 'reading-back')).toMatch(/^<button\b[^>]*class="btn-secondary"/);
    expect(openingTag(panel, 'check-another')).toMatch(/^<button\b[^>]*class="btn"/);
    expect(textOf(elementById(panel, 'check-another'))).toBe('Check a wallet');
    expect(PAGE.split('id="check-another"')).toHaveLength(2);
    expect(CARD.indexOf('id="reading-next"')).toBeGreaterThan(CARD.indexOf('id="section-analysis"'));
    // Its own markup now, not an inline style that imitated a link.
    expect(openingTag(PAGE, 'check-another')).not.toContain('style=');
  });
});

type Reading = Record<string, unknown> & { snapshotId: string };
type Sections = { verdict: boolean; evidence: boolean; changed: boolean; blindSpots: boolean; coverage: boolean; analysis: boolean };
type Parts = { openQuestion: boolean; whatChanges: boolean; standingLimit: boolean; risks: boolean; notRead: boolean };
type ShareTarget = { closest?: (selector: string) => unknown };
type Helpers = {
  readingSections: (d: unknown, savedPreviousId?: string | null) => Sections;
  blindSpotParts: (d: unknown) => Parts;
  breakdownKind: (d: unknown) => 'book' | 'long' | 'cover' | null;
  heroTilesFor: (d: unknown) => Array<{ label: string; value: string }>;
  previousReadingId: (d: unknown, savedPreviousId?: string | null) => string | null;
  statColumns: (n: number, maxColumns: number) => number;
  backLabel: (from: unknown) => string;
  screenState: (screen: string, from?: unknown, title?: string) => { breadcrumb: { originLabel: string } | null };
  shareMenuAction: (key: string, isOpen: boolean) => 'close' | 'none';
  setUpShareMenu: (share: unknown, toggle: unknown, menu: unknown, doc: unknown) => void;
};
const NAMES = [
  'fmtUsd', 'plural', 'madeWithExplorer', 'elsewhereSource', 'heroTilesFor', 'breakdownKind', 'previousReadingId', 'riskItems', 'coverageLists',
  'repeatsStandingLimit', 'blindSpotParts', 'readingSections', 'statColumns', 'screenState', 'backLabel', 'shareMenuAction', 'setUpShareMenu',
];
// Loaded on first use, so a missing helper fails the tests that need it and
// not the whole file.
let loaded: Helpers | undefined;
const helpers = () => (loaded ??= new Function(NAMES.map(fn).join('\n') + `\nreturn { ${NAMES.join(', ')} };`)() as Helpers);

/** A stored reading as the Worker serves it: the page reads openQuestion and
 * whatChanges, which src/index.ts adds to every reading it hands out. */
function served(id: string): Reading {
  const entry = featured.entries.find((e) => e.snapshotId === id);
  if (!entry) throw new Error(`no featured reading ${id}`);
  const copy = structuredClone(entry) as unknown as Reading;
  return { ...copy, openQuestion: openQuestion(entry), whatChanges: whatWouldChange(entry) };
}
const ALL = () => featured.entries.map((e) => served(e.snapshotId!));
const BET = () => served('0aio3f82kqsu9');
const HEDGED = () => served('3aus98sj8cz7u');
const FUNDERS = () => served('12pk1a43rv3a1');
const BOOK = () => served('1a896dimxf5ba');

describe('readingSections: which numbered sections have something to show', () => {
  it('every stored featured reading has a verdict, evidence, a previous reading, blind spots and a full analysis', () => {
    for (const d of ALL()) {
      const s = helpers().readingSections(d);
      expect(s, d.snapshotId).toMatchObject({ verdict: true, evidence: true, changed: true, blindSpots: true, analysis: true });
    }
  });

  it('every stored featured reading has a coverage illustration: a long, a covered short or a book', () => {
    for (const d of ALL()) expect(helpers().readingSections(d).coverage, d.snapshotId).toBe(true);
    expect(helpers().breakdownKind(BET())).toBe('long');
    expect(helpers().breakdownKind(HEDGED())).toBe('cover');
    expect(helpers().breakdownKind(FUNDERS())).toBe('cover');
    expect(helpers().breakdownKind(BOOK())).toBe('book');
  });

  it('no breakdown on a short means no Spot coverage section', () => {
    const d = { ...HEDGED(), breakdown: undefined };
    expect(helpers().readingSections(d).coverage).toBe(false);
    expect(helpers().readingSections({ ...HEDGED(), breakdown: { ...(HEDGED().breakdown as object), applies: false } }).coverage).toBe(false);
    expect(helpers().readingSections({ ...HEDGED(), breakdown: { ...(HEDGED().breakdown as object), segments: [] } }).coverage).toBe(false);
  });

  it('a long keeps its illustration without a breakdown; a book needs its matched quotes', () => {
    expect(helpers().readingSections({ ...BET(), breakdown: undefined }).coverage).toBe(true);
    const noPositions = { ...BET(), breakdown: undefined, positions: { ...(BET().positions as object), nPositions: 0 } };
    expect(helpers().readingSections(noPositions).coverage).toBe(false);
    const book = BOOK();
    expect(helpers().readingSections({ ...book, orders: { ...(book.orders as object), headlineTwoSidedNotionalUsd: undefined } }).coverage).toBe(false);
  });

  it('nothing to compare with means no Since last read section', () => {
    const d = { ...BET(), supersedes: undefined };
    expect(helpers().readingSections(d).changed).toBe(false);
    // A saved position's own earlier reading counts, as #changed already uses it.
    expect(helpers().readingSections(d, '17n56vckzhwtr').changed).toBe(true);
    expect(helpers().previousReadingId(d, '17n56vckzhwtr')).toBe('17n56vckzhwtr');
    expect(helpers().previousReadingId(BET())).toBe('17n56vckzhwtr');
    // Not saved, not openable, or compared with itself.
    expect(helpers().readingSections({ ...BET(), snapshotSaved: false }).changed).toBe(false);
    expect(helpers().readingSections({ ...BET(), snapshotId: undefined }).changed).toBe(false);
    expect(helpers().readingSections({ ...BET(), supersedes: '0aio3f82kqsu9' }).changed).toBe(false);
  });

  it('no open question, no what-changes, no risk figures and no failed sources means no Blind spots section', () => {
    const bare = { ...BET(), openQuestion: null, whatChanges: null, vitals: [], coverage: [], coverageNotes: [] };
    expect(helpers().readingSections(bare).blindSpots).toBe(false);
    // A note that only describes what was found is not a blind spot; it stays in Full analysis.
    const remarksOnly = { ...bare, coverageNotes: [{ text: 'No two-sided quoting found', failure: false }], coverage: ['No two-sided quoting found'] };
    expect(helpers().readingSections(remarksOnly).blindSpots).toBe(false);
    // Any one of them is enough.
    expect(helpers().readingSections({ ...bare, openQuestion: 'who controls the funding wallets.' }).blindSpots).toBe(true);
    expect(helpers().readingSections({ ...bare, whatChanges: 'a fresh, complete reading.' }).blindSpots).toBe(true);
    expect(helpers().readingSections({ ...bare, vitals: [{ label: 'Leverage', value: '5x cross', source: 'Hyperliquid' }] }).blindSpots).toBe(true);
    expect(helpers().readingSections({ ...bare, coverage: ['Nansen did not answer'] }).blindSpots).toBe(true);
  });

  it('shows the standing limit beside the reading\'s own blind spots, once, and never alone', () => {
    // The bet's open question already names exchanges, OTC and unlinked wallets.
    expect(helpers().blindSpotParts(BET())).toEqual({ openQuestion: true, whatChanges: true, standingLimit: false, risks: true, notRead: false });
    expect(helpers().blindSpotParts(HEDGED())).toEqual({ openQuestion: true, whatChanges: true, standingLimit: true, risks: true, notRead: false });
    // With nothing of its own the section is hidden, and Full analysis carries the limit.
    const bare = { ...HEDGED(), openQuestion: null, whatChanges: null, vitals: [], coverage: [], coverageNotes: [] };
    expect(helpers().blindSpotParts(bare).standingLimit).toBe(false);
    expect(helpers().blindSpotParts({ ...bare, coverage: ['Nansen did not answer'] })).toMatchObject({ standingLimit: true, notRead: true });
  });

  it('no evidence tile to lead with means no Evidence section', () => {
    expect(helpers().readingSections({ ...BET(), evidence: [] }).evidence).toBe(false);
    // Only the rows the lead tiles skip, none of them decisive.
    const skipped = [
      { label: 'Largest position', value: '$122.1M HYPE long', source: 'Nansen' },
      { label: 'Share of exposure', value: '100%', source: 'Nansen' },
    ];
    expect(helpers().readingSections({ ...BET(), evidence: skipped }).evidence).toBe(false);
    // Funders' holdings lead even without an evidence row of their own.
    const elsewhere = { ...FUNDERS(), evidence: [], verdict: { verdict: 'unknown', strength: null, reasons: [] } };
    expect(helpers().heroTilesFor(elsewhere).map((t) => t.label)).toEqual(['Held elsewhere']);
    // ... and the tile names where the funders came from: Nansen for a reading made with it, the
    // explorer and the nodes for one made since.
    expect(helpers().heroTilesFor(elsewhere)[0]).toMatchObject({ source: 'Nansen · ownership unverified' });
    expect(helpers().heroTilesFor({ ...elsewhere, source: 'hyperliquid', hedgeScope: 'known-tokens', positionsVenues: { asked: 11, answered: 11, registryRead: true } })[0]).toMatchObject({ source: 'Explorer + On-chain · ownership unverified' });
    // An older reading whose source says hyperliquid but whose funders came from Nansen keeps the Nansen credit.
    expect(helpers().heroTilesFor({ ...elsewhere, source: 'hyperliquid' })[0]).toMatchObject({ source: 'Nansen · ownership unverified' });
    expect(helpers().readingSections(elsewhere).evidence).toBe(true);
  });

  it('leads with the decisive row, then one more, as the page always has', () => {
    expect(helpers().heroTilesFor(BET()).map((t) => t.label)).toEqual(['Largest position', 'Net / gross exposure']);
    expect(helpers().heroTilesFor(HEDGED()).map((t) => t.label)).toEqual(['Hedge found', 'Net / gross exposure']);
    expect(helpers().heroTilesFor(FUNDERS()).map((t) => t.label)).toEqual(['Linked wallets', 'Hedge found']);
  });
});

describe('statColumns: the evidence panel never ends in a lone cell', () => {
  it('uses the most columns that fill every row', () => {
    const table: Array<[number, number, number]> = [
      [1, 4, 1], [2, 4, 2], [2, 1, 1], [3, 4, 3], [3, 2, 1], [4, 4, 4], [4, 3, 2], [4, 2, 2], [4, 1, 1],
      [5, 4, 1], [5, 5, 5], [6, 4, 3], [6, 2, 2], [6, 6, 6],
    ];
    for (const [n, max, columns] of table) expect(helpers().statColumns(n, max), `${n} cells, ${max} columns at most`).toBe(columns);
  });

  it('never leaves a short last row, for any count and width', () => {
    for (let n = 1; n <= 12; n++) {
      for (let max = 1; max <= 6; max++) {
        const c = helpers().statColumns(n, max);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(Math.max(1, max));
        expect(n % c, `${n} cells in ${c} columns`).toBe(0);
      }
    }
  });

  it('is one column for nothing or nonsense', () => {
    expect(helpers().statColumns(0, 4)).toBe(1);
    expect(helpers().statColumns(3, 0)).toBe(1);
    expect(helpers().statColumns(Number.NaN, 4)).toBe(1);
  });
});

describe('backLabel: the way back in the "What next?" panel', () => {
  it('names the screen the reading was opened from', () => {
    expect(helpers().backLabel('explore')).toBe('Back to Explore');
    expect(helpers().backLabel('saved')).toBe('Back to Saved');
    expect(helpers().backLabel('check')).toBe('Back to Check a wallet');
  });

  it('counts anything else as Check, as the breadcrumb does', () => {
    for (const from of [undefined, null, 'reading', 'constructor', '']) expect(helpers().backLabel(from)).toBe('Back to Check a wallet');
  });

  it('takes its words from the breadcrumb\'s own labels, so the two cannot drift apart', () => {
    for (const from of ['check', 'explore', 'saved', undefined, 'constructor']) {
      expect(helpers().backLabel(from)).toBe('Back to ' + helpers().screenState('reading', from, '').breadcrumb!.originLabel);
    }
    expect(fn('backLabel')).toContain("screenState('reading', from");
  });
});

describe('subjectVisible: the "The position asked about ..." line under the header', () => {
  const subjectVisible = (d: unknown, pickerShown: boolean) =>
    (new Function(`${fn('subjectVisible')}\nreturn subjectVisible;`)() as (d: unknown, p: boolean) => boolean)(d, pickerShown);
  const focused = () => ({ ...BET(), focus: { coin: 'HYPE', side: 'long' } });

  it('shows only when it adds a fact the title does not: the position was asked about', () => {
    expect(subjectVisible(focused(), false)).toBe(true);
  });

  it('stays hidden when it would repeat the title and the address', () => {
    expect(subjectVisible(BET(), false)).toBe(false);
    expect(subjectVisible({ ...BET(), focus: null }, false)).toBe(false);
    const empty = { ...BET(), focus: null, positions: { nPositions: 0, headlineNotionalUsd: 0, headlineCoin: null, headlineSide: null } };
    expect(subjectVisible(empty, false)).toBe(false);
  });

  it('gives way to the position picker, which says it already', () => {
    expect(subjectVisible(focused(), true)).toBe(false);
    expect(subjectVisible(BET(), true)).toBe(false);
  });

  it('is what renderResult uses', () => {
    expect(fn('renderResult')).toContain("$('subject').hidden = !subjectVisible(d, !$('picker').hidden);");
  });
});

describe('checkAnother: "Check a wallet" in the "What next?" panel', () => {
  /** checkAnother and the real goCheck, run against stand-ins for the page. */
  function run(screen: string, url: string): string[] {
    const calls: string[] = [];
    const at = new URL(url, 'https://example.test');
    const window = {
      location: { pathname: at.pathname, search: at.search, hash: at.hash },
      history: {
        pushState: (_state: unknown, _title: string, to: string) => calls.push(`push ${to}`),
        replaceState: (_state: unknown, _title: string, to: string) => calls.push(`replace ${to}`),
      },
    };
    const document = { body: { dataset: { screen } } };
    const elements: Record<string, { value: string; hidden: boolean; focus: () => void; scrollIntoView: () => void }> = {};
    const $ = (id: string) => (elements[id] ??= {
      value: 'typed', hidden: false,
      focus: () => calls.push(`focus ${id}`),
      scrollIntoView: () => calls.push(`scroll to ${id}`),
    });
    const checkAnother = new Function('document', 'window', '$', 'setScreen', 'showExamples', `${fn('scrollMotion')}\n${fn('goCheck')}\n${fn('checkAnother')}\nreturn checkAnother;`)(
      document,
      window,
      $,
      (s: string) => calls.push(`setScreen ${s}`),
      () => calls.push('showExamples'),
    ) as (event: { preventDefault: () => void }) => void;
    checkAnother({ preventDefault: () => calls.push('preventDefault') });
    calls.push(`address "${$('address').value}"`, `choices ${$('address-choices').hidden ? 'hidden' : 'shown'}`);
    return calls;
  }

  it('goes to Check the way the Check tab does: a new history entry, so Back returns to the reading', () => {
    expect(run('reading', '/?s=0aio3f82kqsu9')).toEqual([
      'preventDefault', 'push /', 'showExamples', 'focus address', 'scroll to address', 'address ""', 'choices hidden',
    ]);
    expect(run('reading', '/?s=0aio3f82kqsu9&claim=ownership')).not.toContain('replace /');
  });

  it('is the button\'s handler', () => {
    expect(APP).toContain("$('check-another').addEventListener('click', checkAnother);");
  });
});

describe('the Share menu', () => {
  it('closes on Escape only while open', () => {
    expect(helpers().shareMenuAction('Escape', true)).toBe('close');
    expect(helpers().shareMenuAction('Esc', true)).toBe('close');
    expect(helpers().shareMenuAction('Escape', false)).toBe('none');
    expect(helpers().shareMenuAction('Enter', true)).toBe('none');
    expect(helpers().shareMenuAction(' ', true)).toBe('none');
  });

  /** setUpShareMenu run against stand-ins: the details, its summary, the menu and the document. */
  function menu() {
    const log: string[] = [];
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    const on = (target: string) => (type: string, handler: (event: unknown) => void) => {
      listeners.set(`${target} ${type}`, [...(listeners.get(`${target} ${type}`) ?? []), handler]);
    };
    const item: ShareTarget = { closest: (s) => (s === 'button' ? item : null) };
    const note: ShareTarget = { closest: () => null };
    const toggle = { focus: () => log.push('focus toggle') };
    const outside: ShareTarget = { closest: () => null };
    const inside = new Set<unknown>([item, note, toggle]);
    const share = { open: false, contains: (n: unknown) => n === share || inside.has(n), addEventListener: on('share') };
    helpers().setUpShareMenu(share, toggle, { addEventListener: on('menu') }, { addEventListener: on('document') });
    const fire = (target: string, type: string, event: unknown) => (listeners.get(`${target} ${type}`) ?? []).forEach((h) => h(event));
    /** A click bubbles from the menu to the document. */
    const click = (target: ShareTarget) => {
      if (inside.has(target)) fire('menu', 'click', { target });
      fire('document', 'click', { target });
    };
    return { share, log, item, note, outside, toggle, fire, click };
  }

  it('closes when an item is chosen and gives focus back to Share', () => {
    const m = menu();
    m.share.open = true;
    m.click(m.item);
    expect(m.share.open).toBe(false);
    expect(m.log).toEqual(['focus toggle']);
  });

  it('stays open on a click inside it that is not an item', () => {
    const m = menu();
    m.share.open = true;
    m.click(m.note);
    expect(m.share.open).toBe(true);
    expect(m.log).toEqual([]);
  });

  it('closes on a click outside it, leaving focus where the click put it', () => {
    const m = menu();
    m.share.open = true;
    m.click(m.outside);
    expect(m.share.open).toBe(false);
    expect(m.log).toEqual([]);
  });

  it('closes on Escape and returns focus to Share; Escape with the menu closed does nothing', () => {
    const m = menu();
    m.fire('document', 'keydown', { key: 'Escape' });
    expect(m.log).toEqual([]);
    m.share.open = true;
    m.fire('document', 'keydown', { key: 'Escape' });
    expect(m.share.open).toBe(false);
    expect(m.log).toEqual(['focus toggle']);
  });

  it('closes when focus leaves it for another control, not while it moves between its items', () => {
    const m = menu();
    m.share.open = true;
    m.fire('share', 'focusout', { relatedTarget: m.item });
    expect(m.share.open).toBe(true);
    m.fire('share', 'focusout', { relatedTarget: null });
    expect(m.share.open).toBe(true);
    m.fire('share', 'focusout', { relatedTarget: m.outside });
    expect(m.share.open).toBe(false);
    expect(m.log).toEqual([]);
  });

  it('starts closed on every reading', () => {
    expect(fn('renderResult')).toContain("$('share').open = false;");
    expect(fn('renderResult')).not.toContain("$('share').open = true;");
  });
});

describe('renderResult fills the reading screen', () => {
  const render = () => fn('renderResult');

  it('writes the title from readingTitleParts and the meta from the address and the age', () => {
    expect(render()).toMatch(/readingTitleParts\(d\)/);
    expect(render()).toContain("$('reading-title')");
    expect(render()).toContain("$('reading-meta')");
  });

  it('shows or hides every section from readingSections, before the illustration measures its box', () => {
    const r = render();
    for (const [id, key] of [
      ['section-verdict', 'verdict'], ['section-evidence', 'evidence'], ['section-changed', 'changed'],
      ['section-blind-spots', 'blindSpots'], ['section-coverage', 'coverage'], ['section-analysis', 'analysis'],
    ]) {
      expect(r, id).toContain(`$('${id}').hidden = !sections.${key};`);
    }
    expect(r.indexOf("$('section-coverage').hidden")).toBeLessThan(r.indexOf('renderBreakdown(d)'));
    expect(r.indexOf("$('card').hidden = false;")).toBeLessThan(r.indexOf("$('section-coverage').hidden"));
  });

  it('labels the way back with backLabel and lays the evidence out with statColumns', () => {
    expect(render()).toMatch(/\$\('reading-back'\)\.textContent = backLabel\(openedFrom\);/);
    expect(render()).toMatch(/statColumns\(/);
  });

  it('opens Full analysis when a link asks about an assertion, after the reading closes it', () => {
    const r = render();
    expect(r.indexOf("$('full-analysis').open = false;")).toBeLessThan(r.indexOf('renderClaim(d)'));
    expect(fn('renderClaim')).toContain("$('full-analysis').open = true;");
  });

  it('decides each section with the same rule that fills it', () => {
    expect(fn('renderBreakdown')).toContain('breakdownKind(d)');
    expect(fn('renderChanged')).toContain('previousReadingId(d,');
  });

  it('no longer moves parts of the reading around after the page loads', () => {
    expect(APP).not.toMatch(/insertAdjacentElement\('afterend', (?:\$\('(?:snapshot|takeaway|reading-actions|risk-preview|changed|open-question|claim-checker|summary)'\)|document\.querySelector)/);
  });

  it('sends the back button through the same handlers as the breadcrumb', () => {
    expect(APP).toMatch(/\$\('reading-back'\)\.addEventListener\('click', \(event\) => goToScreen\(readingFrom, event\)\);/);
  });

  it('focuses the reading\'s H1 when the screen changes to it', () => {
    expect(fn('setScreen')).toContain("screen === 'reading' ? $('reading-title')");
  });
});

/**
 * Two lines of renderResult that the later rebase of the branch
 * remove-nansen collides with (the merge notes at the end of
 * docs/superpowers/plans/2026-10-22-site-redesign.md): taking that branch's
 * side of the conflict would bring back "Save this position" and a
 * what-changes line of plain text, and nothing else would fail. Both lines
 * are cut out of renderResult and run.
 */
describe('renderResult keeps the redesign\'s Save label and "What would change this:" lead-in', () => {
  const line = (pattern: RegExp) => {
    const m = pattern.exec(fn('renderResult'));
    expect(m, String(pattern)).not.toBeNull();
    return m![0];
  };
  const d = featured.entries[0];

  it('labels #watch-address "Save", or "Saved" when this very position is saved in this browser', () => {
    expect(PAGE).toContain('<button class="btn-secondary" id="watch-address">Save</button>');
    const code = line(/^\s*\$\('watch-address'\)\.textContent = .*$/m);
    const label = (rows: unknown[]) => {
      const button = { textContent: '' };
      new Function('$', 'watched', 'd', code)(() => button, () => rows, d);
      return button.textContent;
    };
    expect(label([])).toBe('Save');
    expect(label([{ address: d.address, coin: d.positions.headlineCoin, side: d.positions.headlineSide }])).toBe('Saved');
    expect(label([{ address: d.address, coin: 'NOT-' + d.positions.headlineCoin, side: d.positions.headlineSide }])).toBe('Save');
    expect(APP).not.toContain('Save this position');
  });

  it('leads #what-changes with "What would change this:" in a <strong>, and leaves it empty without one', () => {
    const code = line(/^\s*if \(d\.whatChanges\) \$\('what-changes'\).*\r?\n\s*else \$\('what-changes'\).*$/m);
    const fill = (whatChanges: string | undefined) => {
      const box = { children: [] as unknown[], replaceChildren: (...children: unknown[]) => { box.children = children; } };
      new Function('$', 'el', 'd', code)(() => box, (tag: string, className: string | null, text: string) => ({ tag, className, text }), { whatChanges });
      return box.children;
    };
    expect(fill('A matching spot balance at this address.')).toEqual([
      { tag: 'strong', className: null, text: 'What would change this: ' },
      'A matching spot balance at this address.',
    ]);
    expect(fill(undefined)).toEqual([]);
    expect(fn('renderResult')).not.toMatch(/\$\('what-changes'\)\.textContent/);
  });
});
