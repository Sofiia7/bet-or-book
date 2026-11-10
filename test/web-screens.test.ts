import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import featuredData from '../data/featured.json';
import type { Gallery } from '../src/gallery';
import { extractPageFunction } from './support/pageScript';

/**
 * The page's frame: the header tabs, the breadcrumb, the footer, and the one
 * piece of navigation state behind them (which screen is showing and, for a
 * reading, the screen it was opened from). The pure helpers are cut out of
 * web/app.js and run on their own; the markup is read from web/index.html.
 */

const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const EXPLORE = readFileSync(new URL('../web/explore.js', import.meta.url), 'utf8');
const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const featured = featuredData as unknown as Gallery;

type Tab = 'check' | 'explore' | 'saved';
type ScreenState = {
  activeTab: Tab;
  breadcrumb: null | { originLabel: string; originScreen: Tab; current: string };
};
type OriginInput = { showing?: string | null; keptFrom?: string | null; sameReading?: boolean; historyFrom?: string | null };
type Place = { screen: string | undefined; reading: string | null };
type Helpers = {
  screenState: (screen: string, from?: string, readingTitle?: string) => ScreenState;
  savedCountBadge: (n: number) => string | null;
  readingTitleParts: (d: unknown) => { amount: string; assetSide: string };
  readingTitle: (d: unknown) => string;
  readingOrigin: (input: OriginInput) => Tab;
  movesToTop: (prev: Place, next: Place) => boolean;
};

/** Runs the named top-level functions of web/app.js together, with no DOM. */
function pageHelpers(names: string[]): Helpers {
  const body = names.map((name) => extractPageFunction(APP, name)).join('\n') + `\nreturn { ${names.join(', ')} };`;
  return new Function(body)() as Helpers;
}

// Loaded on first use, so a missing helper fails the tests that need it and
// not the whole file.
let loaded: Helpers | undefined;
const helpers = () =>
  (loaded ??= pageHelpers(['screenState', 'savedCountBadge', 'fmtUsd', 'readingTitleParts', 'readingTitle', 'readingOrigin', 'movesToTop']));
const screenState: Helpers['screenState'] = (...args) => helpers().screenState(...args);
const savedCountBadge: Helpers['savedCountBadge'] = (n) => helpers().savedCountBadge(n);
const readingTitleParts: Helpers['readingTitleParts'] = (d) => helpers().readingTitleParts(d);
const readingTitle: Helpers['readingTitle'] = (d) => helpers().readingTitle(d);
const readingOrigin: Helpers['readingOrigin'] = (input) => helpers().readingOrigin(input);
const movesToTop: Helpers['movesToTop'] = (prev, next) => helpers().movesToTop(prev, next);
const fn = (name: string) => extractPageFunction(APP, name);

const reading = (id: string) => {
  const entry = featured.entries.find((e) => e.snapshotId === id);
  if (!entry) throw new Error(`no featured reading ${id}`);
  return entry;
};
/** Two stored readings of two different accounts. */
const HYPE_LONG = () => reading('0aio3f82kqsu9');
const HYPE_SHORT = () => reading('3aus98sj8cz7u');

/** One element's markup, from its opening tag to the matching closing tag of the same name (no nesting of that tag inside). */
function block(html: string, open: RegExp, tag: string): string {
  const m = html.match(open);
  if (!m || m.index === undefined) return '';
  const end = html.indexOf(`</${tag}>`, m.index);
  return end === -1 ? '' : html.slice(m.index, end + tag.length + 3);
}
const HEADER = block(PAGE, /<header\b/, 'header');
const FOOTER = block(PAGE, /<footer\b/, 'footer');
const BREADCRUMB = block(PAGE, /<nav\b[^>]*\bid="breadcrumb"/, 'nav');
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe('extractPageFunction', () => {
  const source = [
    "const x = 1;",
    "function plain(a, b = { c: 1 }) {",
    "  const s = '}' + \"{\" + `${a ? '}' : `{`}`;",
    "  // a } in a comment",
    "  /* and { here */",
    "  if (/[}{]/.test(s)) { return b; }",
    "  return a / 2;",
    "}",
    "function nested() {",
    "  function inner() { return 1; }",
    "  return inner();",
    "}",
  ].join('\n');

  it('cuts a whole top-level function, braces in strings, templates, comments and regexes included', () => {
    const cut = extractPageFunction(source, 'plain');
    expect(cut.startsWith('function plain(')).toBe(true);
    expect(cut.endsWith('return a / 2;\n}')).toBe(true);
    const plain = new Function(`${cut}\nreturn plain;`)() as (a: number, b?: unknown) => unknown;
    expect(plain(4, 'b')).toBe('b');
  });

  it('only matches a declaration at the start of a line', () => {
    expect(() => extractPageFunction(source, 'inner')).toThrow(/no top-level function inner/);
    expect(extractPageFunction(source, 'nested')).toContain('return inner();');
  });

  it('throws when the function is missing or declared twice', () => {
    expect(() => extractPageFunction(source, 'missing')).toThrow(/no top-level function missing/);
    expect(() => extractPageFunction(source + '\nfunction plain() {}', 'plain')).toThrow(/declared 2 times/);
  });

  it('works on the real page script, which is checked out with CRLF line endings on Windows', () => {
    expect(extractPageFunction(APP.replace(/\r?\n/g, '\r\n'), 'fmtUsd')).toMatch(/^function fmtUsd\(n\) \{[\s\S]*\}$/);
  });
});

describe('screenState: the active tab and the breadcrumb for each screen', () => {
  it('a reading opened from Explore highlights Explore and leads back to it', () => {
    expect(screenState('reading', 'explore', '$122.1M HYPE long')).toEqual({
      activeTab: 'explore',
      breadcrumb: { originLabel: 'Explore', originScreen: 'explore', current: '$122.1M HYPE long' },
    });
  });

  it('a reading opened from Saved highlights Saved and leads back to it', () => {
    expect(screenState('reading', 'saved', '$57.3M HYPE short')).toEqual({
      activeTab: 'saved',
      breadcrumb: { originLabel: 'Saved', originScreen: 'saved', current: '$57.3M HYPE short' },
    });
  });

  it('a reading opened from Check (or cold, on a link) leads back to "Check a wallet"', () => {
    const expected = {
      activeTab: 'check',
      breadcrumb: { originLabel: 'Check a wallet', originScreen: 'check', current: '$212.1M ETH short' },
    };
    expect(screenState('reading', 'check', '$212.1M ETH short')).toEqual(expected);
    expect(screenState('reading', undefined, '$212.1M ETH short')).toEqual(expected);
    // Not a screen at all, including a name every object inherits.
    expect(screenState('reading', 'constructor', '$212.1M ETH short')).toEqual(expected);
  });

  it('Explore and Saved lead back to "Check a wallet" and highlight their own tab', () => {
    expect(screenState('explore')).toEqual({
      activeTab: 'explore',
      breadcrumb: { originLabel: 'Check a wallet', originScreen: 'check', current: 'Explore' },
    });
    expect(screenState('saved')).toEqual({
      activeTab: 'saved',
      breadcrumb: { originLabel: 'Check a wallet', originScreen: 'check', current: 'Saved' },
    });
  });

  it('a reading opened from Explore does not change what Explore and Saved themselves show', () => {
    expect(screenState('explore', 'saved').breadcrumb?.originScreen).toBe('check');
    expect(screenState('saved', 'explore').activeTab).toBe('saved');
  });

  it('Check has no breadcrumb', () => {
    expect(screenState('check')).toEqual({ activeTab: 'check', breadcrumb: null });
    expect(screenState('check', 'explore', 'ignored')).toEqual({ activeTab: 'check', breadcrumb: null });
  });
});

describe('savedCountBadge: the number on the Saved tab', () => {
  it('is hidden at zero and shows the count otherwise', () => {
    expect(savedCountBadge(0)).toBeNull();
    expect(savedCountBadge(1)).toBe('1');
    expect(savedCountBadge(3)).toBe('3');
    expect(savedCountBadge(12)).toBe('12');
  });

  it('is hidden for anything that is not a positive count', () => {
    expect(savedCountBadge(-1)).toBeNull();
    expect(savedCountBadge(Number.NaN)).toBeNull();
  });
});

describe('readingTitle: what the breadcrumb calls a reading', () => {
  it('is the headline position of a stored reading: amount, coin and side', () => {
    const reading = featured.entries.find((e) => e.snapshotId === '0aio3f82kqsu9');
    expect(reading).toBeDefined();
    expect(readingTitleParts(reading)).toEqual({ amount: '$122.1M', assetSide: 'HYPE long' });
    expect(readingTitle(reading)).toBe('$122.1M HYPE long');
  });

  it('names every featured reading by its own position', () => {
    for (const e of featured.entries) {
      const usd = e.positions.headlineNotionalUsd;
      expect(readingTitle(e)).toMatch(new RegExp(`^\\$[\\d.]+[KMB] ${e.positions.headlineCoin} ${e.positions.headlineSide}$`));
      expect(usd).toBeGreaterThan(0);
    }
  });

  it('says so when the reading found no open position', () => {
    const empty = { positions: { nPositions: 0, headlineNotionalUsd: 0, headlineCoin: null, headlineSide: null } };
    expect(readingTitleParts(empty)).toEqual({ amount: 'No open positions', assetSide: '' });
    expect(readingTitle(empty)).toBe('No open positions');
  });
});

describe('the header', () => {
  it('has the logo as a link home with the dot in accent', () => {
    expect(HEADER).toMatch(/<a\b[^>]*class="brand"[^>]*href="\/"[^>]*>Bet or Book<span class="brand-dot">\.<\/span><\/a>/);
  });

  it('holds exactly the three tabs Check, Explore and Saved, on the ids the scripts already use', () => {
    const tabs = [...HEADER.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter((m) => /class="pill-tab"/.test(m[1]))
      .map((m) => ({ id: m[1].match(/\bid="([^"]+)"/)?.[1], label: textOf(m[2]) }));
    expect(tabs).toEqual([
      { id: 'nav-examples', label: 'Check' },
      { id: 'nav-boards', label: 'Explore' },
      { id: 'nav-saved', label: 'Saved' },
    ]);
    expect(HEADER).toMatch(/<nav\b[^>]*class="pill-nav"[^>]*aria-label="Main navigation"/);
  });

  it('starts on Check, with the Saved count badge empty and hidden until there is something saved', () => {
    expect(PAGE).toMatch(/<body\b[^>]*data-screen="check"/);
    expect(HEADER).toMatch(/<a\b[^>]*id="nav-examples"[^>]*aria-current="page"/);
    expect(HEADER).toMatch(/<span class="pill-count" id="saved-count" hidden><\/span>/);
  });

  it('no longer has the old anchor row', () => {
    expect(PAGE).not.toContain('site-nav');
    expect(HEADER).not.toContain('href="#examples"');
  });
});

describe('the breadcrumb', () => {
  it('is a nav labelled Breadcrumb, hidden on the Check screen the page starts on', () => {
    expect(BREADCRUMB).toMatch(/^<nav\b[^>]*\baria-label="Breadcrumb"/);
    expect(BREADCRUMB).toMatch(/^<nav\b[^>]*\bhidden\b/);
  });

  it('has an origin link, a separator hidden from screen readers and the current page', () => {
    expect(BREADCRUMB).toMatch(/<a\b[^>]*id="breadcrumb-origin"/);
    expect(BREADCRUMB).toMatch(/<span class="breadcrumb-sep" aria-hidden="true">\/<\/span>/);
    expect(BREADCRUMB).toMatch(/<span\b[^>]*id="breadcrumb-current"[^>]*aria-current="page"/);
  });

  it('sits between the header and the screens', () => {
    expect(PAGE.indexOf('id="breadcrumb"')).toBeGreaterThan(PAGE.indexOf('</header>'));
    expect(PAGE.indexOf('id="breadcrumb"')).toBeLessThan(PAGE.indexOf('id="workspace"'));
  });
});

describe('the footer', () => {
  it('links to the three screens', () => {
    const links = [...FOOTER.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map((m) => textOf(m[2]));
    expect(links.slice(0, 3)).toEqual(['Check', 'Explore', 'Saved']);
  });

  it('keeps the data sources sentence: each source for what it supplies, Nansen only for older saved readings, as plain text', () => {
    expect(FOOTER).toContain(
      'Positions, resting orders, fills and PnL: <a class="partner" href="https://app.hyperliquid.xyz" rel="noopener noreferrer">Hyperliquid API</a>. Balances on Ethereum, Arbitrum and HyperEVM: public nodes. Funding links: Blockscout. Older saved readings also used Nansen data: Powered by Nansen API.',
    );
    expect(FOOTER).not.toContain('app.nansen.ai');
  });

  it('says it is inspection only and not financial advice, and links the source code', () => {
    expect(textOf(FOOTER)).toContain('Inspection only - not financial advice');
    expect(FOOTER).toMatch(/<a\b[^>]*href="https:\/\/github\.com\/Sofiia7\/bet-or-book"[^>]*>Source code<\/a>/);
  });
});

describe('the page text', () => {
  it('uses plain hyphens, never a long dash or an en dash', () => {
    expect(PAGE).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('every screen change goes through setScreen', () => {
  it('Check, Explore and Saved set their own screen', () => {
    expect(fn('showExamples')).toContain("setScreen('check')");
    expect(fn('openBoards')).toContain("setScreen('explore')");
    expect(fn('openSaved')).toContain("setScreen('saved')");
  });

  it('a reading gets its origin from readingOrigin, with what the page knows at that moment', () => {
    const render = fn('renderResult');
    expect(render).toMatch(/const openedFrom = readingOrigin\(\{\s*showing: document\.body\.dataset\.screen,\s*keptFrom: readingFrom,\s*sameReading: !!current && d === current,\s*historyFrom: opts && opts\.from,\s*\}\);/);
    // Worked out before `current` changes, used once the reading is drawn.
    expect(render.indexOf('readingOrigin(')).toBeLessThan(render.indexOf('current = d;'));
    expect(render.trimEnd()).toMatch(/setScreen\('reading', openedFrom\);\s*\}$/);
    // A move through history hands its origin to the reading it opens.
    expect(fn('openSnapshot')).toContain('from: historyFrom });');
  });

  it('the Saved count is redrawn whenever the saved list is', () => {
    expect(fn('renderWatched')).toContain('renderSavedCount()');
    expect(fn('renderSavedCount')).toContain('savedCountBadge(');
  });

  it('opening a reading leaves the scroll to setScreen, so the breadcrumb above it stays in view', () => {
    expect(fn('openSnapshot')).not.toContain('scrollIntoView');
    expect(EXPLORE).not.toMatch(/\$\('card'\)\.scrollIntoView/);
  });

  it('the breadcrumb returns to the screen a reading came from through that screen\'s own handler', () => {
    const calls: string[] = [];
    const goToScreen = new Function('openBoards', 'openSaved', 'goCheck', `${fn('goToScreen')}\nreturn goToScreen;`)(
      () => calls.push('openBoards'),
      () => calls.push('openSaved'),
      () => calls.push('goCheck'),
    ) as (screen: string | undefined, event?: unknown) => void;
    for (const screen of ['explore', 'saved', 'check', undefined]) goToScreen(screen);
    expect(calls).toEqual(['openBoards', 'openSaved', 'goCheck', 'goCheck']);
  });

  describe('goCheck: the Check tab, the logo and the footer link', () => {
    function run(screen: string, url: string): string[] {
      const calls: string[] = [];
      const at = new URL(url, 'https://example.test');
      const window = {
        location: { pathname: at.pathname, search: at.search, hash: at.hash },
        history: { pushState: (_state: unknown, _title: string, to: string) => calls.push(`push ${to}`) },
      };
      const document = { body: { dataset: { screen } } };
      const goCheck = new Function('document', 'window', 'setScreen', 'showExamples', `${fn('goCheck')}\nreturn goCheck;`)(
        document,
        window,
        (s: string) => calls.push(`setScreen ${s}`),
        () => calls.push('showExamples'),
      ) as (event: { preventDefault: () => void }) => void;
      goCheck({ preventDefault: () => calls.push('preventDefault') });
      return calls;
    }

    it('from another screen, adds a history entry for / and resets Check', () => {
      expect(run('reading', '/?s=0aio3f82kqsu9')).toEqual(['preventDefault', 'push /', 'showExamples']);
      expect(run('explore', '/#explore')).toEqual(['preventDefault', 'push /', 'showExamples']);
      expect(run('saved', '/?s=0aio3f82kqsu9#saved')).toEqual(['preventDefault', 'push /', 'showExamples']);
    });

    it('on Check itself, only goes back to the top, so a live check still running keeps its answer', () => {
      expect(run('check', '/')).toEqual(['preventDefault', 'setScreen check']);
      expect(run('check', '/?address=0x082e843a431aef031264dc232693dd710aedca88')).toEqual(['preventDefault', 'setScreen check']);
    });

    it('while a linked reading is still opening on Check, leaves it for the Check screen', () => {
      expect(run('check', '/?s=0aio3f82kqsu9')).toEqual(['preventDefault', 'push /', 'showExamples']);
    });
  });

  it('the headings a screen change focuses can take focus', () => {
    for (const id of ['hero-title', 'explore-title', 'saved-title', 'reading-title']) {
      expect(PAGE, id).toMatch(new RegExp(`id="${id}"[^>]*tabindex="-1"`));
    }
  });

  it('a gallery that fails to load moves focus only while Explore itself is showing, not on Saved', () => {
    expect(EXPLORE).toContain("if (!$('gallery').hidden) (getCurrent() ? $('explore-return') : $('breadcrumb-origin')).focus();");
    expect(EXPLORE).not.toMatch(/classList\.contains\('exploring'\)\)[^\n]*\.focus\(\)/);
  });
});

/**
 * readingOrigin decides which screen a reading counts as opened from. The
 * page calls it twice on a move through history (routeHistory works out the
 * entry's origin, renderResult then draws with it) and once otherwise; the
 * sequences below are those calls, in the order the page makes them.
 */
describe('readingOrigin: where a reading counts as opened from', () => {
  it('a reading opened by a click counts as opened on the screen showing', () => {
    expect(readingOrigin({ showing: 'check', keptFrom: 'saved', sameReading: false })).toBe('check');
    expect(readingOrigin({ showing: 'explore', keptFrom: 'check', sameReading: false })).toBe('explore');
    expect(readingOrigin({ showing: 'saved', keptFrom: 'check', sameReading: false })).toBe('saved');
    expect(readingOrigin({ showing: undefined, keptFrom: 'saved', sameReading: false })).toBe('check');
  });

  it('only a real screen counts, whatever is passed in', () => {
    expect(readingOrigin({ showing: 'constructor', keptFrom: 'explore', sameReading: false, historyFrom: 'toString' })).toBe('check');
    expect(readingOrigin({ showing: 'reading', keptFrom: 'reading', sameReading: true, historyFrom: null })).toBe('check');
  });

  it('(a) a reading opened cold from a shared link counts as Check, and keeps it through a detour and Back', () => {
    // Cold /?s=<id>: no history state, the page starts on Check.
    let from = readingOrigin({ showing: 'check', keptFrom: 'check', sameReading: false, historyFrom: null });
    expect(from).toBe('check');
    // Example A: the Saved tab, then Back. The entry stored { from: 'check' }.
    let entry = readingOrigin({ showing: null, keptFrom: from, sameReading: true, historyFrom: 'check' });
    from = readingOrigin({ showing: 'saved', keptFrom: from, sameReading: false, historyFrom: entry });
    expect(from).toBe('check');
    // The same move with nothing stored: the reading still in memory keeps its origin.
    entry = readingOrigin({ showing: null, keptFrom: from, sameReading: true, historyFrom: null });
    from = readingOrigin({ showing: 'saved', keptFrom: from, sameReading: false, historyFrom: entry });
    expect(from).toBe('check');
    // The Explore tab, then "Back to your reading".
    expect(readingOrigin({ showing: 'explore', keptFrom: from, sameReading: true })).toBe('check');
  });

  it('(b) a reading opened from Explore or Saved keeps that origin through a detour and Back', () => {
    for (const origin of ['explore', 'saved']) {
      let from = readingOrigin({ showing: origin, keptFrom: 'check', sameReading: false });
      expect(from).toBe(origin);
      expect(screenState('reading', from, 'x').breadcrumb?.originScreen).toBe(origin);
      // The other tab, then "Back to your reading".
      from = readingOrigin({ showing: origin === 'explore' ? 'saved' : 'explore', keptFrom: from, sameReading: true });
      expect(from).toBe(origin);
      // Example B: the Check tab (which forgets the reading in memory), then
      // Back to the reading's entry, which stored { from: origin }.
      const entry = readingOrigin({ showing: null, keptFrom: from, sameReading: false, historyFrom: origin });
      expect(readingOrigin({ showing: 'check', keptFrom: from, sameReading: false, historyFrom: entry })).toBe(origin);
    }
  });

  it('(b) without the stored origin, a forgotten reading coming back by Back would count as Check', () => {
    // Why showLink keeps { from } in the entry: this is Example B with nothing stored.
    const entry = readingOrigin({ showing: null, keptFrom: 'explore', sameReading: false, historyFrom: null });
    expect(readingOrigin({ showing: 'check', keptFrom: 'explore', sameReading: false, historyFrom: entry })).toBe('check');
  });

  it('(c) a reading redrawn in place never changes its origin', () => {
    // Check live, Try again, Load context, another position: the reading screen is showing.
    for (const kept of ['check', 'explore', 'saved']) {
      expect(readingOrigin({ showing: 'reading', keptFrom: kept, sameReading: false })).toBe(kept);
      expect(readingOrigin({ showing: 'reading', keptFrom: kept, sameReading: true })).toBe(kept);
    }
  });
});

describe('movesToTop: which screen changes go to the top', () => {
  const at = (screen: string | undefined, reading: string | null = null): Place => ({ screen, reading });

  it('a new screen, or the same tab clicked again, goes to the top', () => {
    expect(movesToTop(at('check'), at('explore'))).toBe(true);
    expect(movesToTop(at('explore'), at('reading', '0xa'))).toBe(true);
    expect(movesToTop(at('reading', '0xa'), at('saved'))).toBe(true);
    expect(movesToTop(at('check'), at('check'))).toBe(true);
    expect(movesToTop(at(undefined), at('reading', '0xa'))).toBe(true);
  });

  it('another account\'s reading goes to the top; the same account\'s reading redrawn in place does not', () => {
    expect(movesToTop(at('reading', '0xa'), at('reading', '0xb'))).toBe(true);
    expect(movesToTop(at('reading', '0xa'), at('reading', '0xa'))).toBe(false);
    expect(movesToTop(at('reading', null), at('reading', null))).toBe(true);
  });
});

/** setScreen run for real against stand-ins for the elements it touches. */
function frame() {
  const log: string[] = [];
  type FakeElement = {
    id: string;
    hidden: boolean;
    textContent: string;
    dataset: Record<string, string>;
    attrs: Record<string, string>;
    setAttribute: (name: string, value: string) => void;
    removeAttribute: (name: string) => void;
    focus: () => void;
  };
  const elements = new Map<string, FakeElement>();
  const $ = (id: string): FakeElement => {
    let e = elements.get(id);
    if (!e) {
      const attrs: Record<string, string> = {};
      e = {
        id, hidden: false, textContent: '', dataset: {}, attrs,
        setAttribute: (name, value) => { attrs[name] = value; },
        removeAttribute: (name) => { delete attrs[name]; },
        focus: () => log.push(`focus ${id}`),
      };
      elements.set(id, e);
    }
    return e;
  };
  const body = { dataset: { screen: 'check' } as Record<string, string> };
  const window = { scrollTo: () => log.push('scrollTo') };
  const page = new Function('$', 'document', 'window', [
    'let current = null; let readingFrom = "check"; let readingOnShow = null;',
    ...['fmtUsd', 'readingTitleParts', 'readingTitle', 'screenState', 'movesToTop', 'setScreen'].map(fn),
    'return { setScreen, show: (d) => { current = d; }, kept: () => readingFrom };',
  ].join('\n'))($, { body }, window) as { setScreen: (screen: string, from?: string) => void; show: (d: unknown) => void; kept: () => string };
  const tabs = () => ({
    check: $('nav-examples').attrs['aria-current'] ?? null,
    explore: $('nav-boards').attrs['aria-current'] ?? null,
    saved: $('nav-saved').attrs['aria-current'] ?? null,
  });
  const crumb = () =>
    $('breadcrumb').hidden ? null : { origin: $('breadcrumb-origin').dataset.screen, href: $('breadcrumb-origin').attrs.href, label: $('breadcrumb-origin-label').textContent, current: $('breadcrumb-current').textContent };
  const take = () => log.splice(0);
  return { ...page, body, tabs, crumb, take };
}

describe('setScreen, run against stand-ins for the page', () => {
  it('lights the tab of the screen showing as the page, and on a reading the origin tab as the current item', () => {
    const f = frame();
    f.setScreen('explore');
    expect(f.tabs()).toEqual({ check: null, explore: 'page', saved: null });
    expect(f.crumb()).toEqual({ origin: 'check', href: '/', label: 'Check a wallet', current: 'Explore' });
    f.show(HYPE_LONG());
    f.setScreen('reading', 'explore');
    expect(f.tabs()).toEqual({ check: null, explore: 'true', saved: null });
    expect(f.crumb()).toEqual({ origin: 'explore', href: '#explore', label: 'Explore', current: '$122.1M HYPE long' });
    expect(f.body.dataset).toEqual({ screen: 'reading', from: 'explore' });
    f.setScreen('check');
    expect(f.tabs()).toEqual({ check: 'page', explore: null, saved: null });
    expect(f.crumb()).toBeNull();
    expect(f.body.dataset).toEqual({ screen: 'check' });
    // The reading's origin is kept while other screens show.
    expect(f.kept()).toBe('explore');
  });

  it('every screen change goes to the top and focuses the new heading', () => {
    const f = frame();
    f.setScreen('explore');
    expect(f.take()).toEqual(['scrollTo', 'focus explore-title']);
    f.setScreen('saved');
    expect(f.take()).toEqual(['scrollTo', 'focus saved-title']);
    f.show(HYPE_LONG());
    f.setScreen('reading', 'saved');
    expect(f.take()).toEqual(['scrollTo', 'focus reading-title']);
    f.setScreen('check');
    expect(f.take()).toEqual(['scrollTo', 'focus hero-title']);
    f.setScreen('check');
    expect(f.take()).toEqual(['scrollTo', 'focus hero-title']);
  });

  it('a reading redrawn in place stays where the reader is; another account\'s reading goes to the top', () => {
    const f = frame();
    f.show(HYPE_LONG());
    f.setScreen('reading', 'check');
    f.take();
    // Check live, Try again, another position: a new reading of the same account.
    f.show({ ...HYPE_LONG(), snapshotId: 'a-newer-reading' });
    f.setScreen('reading', 'check');
    expect(f.take()).toEqual([]);
    f.show(HYPE_SHORT());
    f.setScreen('reading', 'check');
    expect(f.take()).toEqual(['scrollTo', 'focus reading-title']);
    expect(f.crumb()?.current).toBe('$57.3M HYPE short');
  });

  it('coming back to the same reading from another screen goes to the top', () => {
    const f = frame();
    f.show(HYPE_LONG());
    f.setScreen('reading', 'explore');
    f.setScreen('saved');
    f.take();
    f.setScreen('reading', 'explore');
    expect(f.take()).toEqual(['scrollTo', 'focus reading-title']);
  });
});

describe('the browser history keeps a reading\'s origin', () => {
  function route(url: string, state: unknown, current: { snapshotId: string } | null, readingFrom: string) {
    const calls: string[] = [];
    const at = new URL(url, 'https://example.test');
    const window = { location: { pathname: at.pathname, search: at.search, hash: at.hash } };
    const routeHistory = new Function(
      'window', 'openSaved', 'openBoards', 'openSnapshot', 'showExamples', 'current', 'readingFrom',
      `${fn('readingOrigin')}\n${fn('routeHistory')}\nreturn routeHistory;`,
    )(
      window,
      () => calls.push('openSaved'),
      () => calls.push('openBoards'),
      (id: string, navigation: string, from: string) => { calls.push(`openSnapshot ${id} ${navigation} ${from}`); return Promise.resolve(); },
      () => calls.push('showExamples'),
      current,
      readingFrom,
    ) as (state: unknown) => unknown;
    return { calls, done: routeHistory(state) };
  }

  it('Back to a reading opens it with the origin its entry stored', () => {
    expect(route('/?s=0aio3f82kqsu9', { from: 'explore' }, null, 'check').calls).toEqual(['openSnapshot 0aio3f82kqsu9 replace explore']);
    expect(route('/?s=0aio3f82kqsu9', { from: 'saved' }, { snapshotId: 'other' }, 'check').calls).toEqual(['openSnapshot 0aio3f82kqsu9 replace saved']);
  });

  it('with nothing stored, the reading still in memory keeps its origin; any other counts as Check', () => {
    expect(route('/?s=0aio3f82kqsu9', null, { snapshotId: '0aio3f82kqsu9' }, 'saved').calls).toEqual(['openSnapshot 0aio3f82kqsu9 replace saved']);
    expect(route('/?s=0aio3f82kqsu9', null, { snapshotId: 'other' }, 'saved').calls).toEqual(['openSnapshot 0aio3f82kqsu9 replace check']);
    expect(route('/?s=0aio3f82kqsu9', { from: 'nonsense' }, null, 'saved').calls).toEqual(['openSnapshot 0aio3f82kqsu9 replace check']);
  });

  it('Explore, Saved and Check entries open their screens as before', async () => {
    expect(route('/#explore', null, null, 'check').calls).toEqual(['openBoards']);
    expect(route('/?s=0aio3f82kqsu9#saved', null, null, 'check').calls).toEqual(['openSaved']);
    expect(route('/', null, null, 'explore').calls).toEqual(['showExamples']);
    expect(route('/?s=0aio3f82kqsu9#explore', null, { snapshotId: '0aio3f82kqsu9' }, 'saved').calls).toEqual(['openBoards']);
    const behind = route('/?s=0aio3f82kqsu9#explore', null, null, 'saved');
    await behind.done;
    expect(behind.calls).toEqual(['openSnapshot 0aio3f82kqsu9 preserve check', 'openBoards']);
  });

  function link(id: string | null, options: { url: string; state: unknown; screen: string; readingFrom: string }) {
    const calls: Array<[unknown, string]> = [];
    const at = new URL(options.url, 'https://example.test');
    const window = {
      location: { pathname: at.pathname, search: at.search, hash: at.hash },
      history: { state: options.state, replaceState: (state: unknown, _title: string, to: string) => calls.push([state, to]) },
    };
    const showLink = new Function('window', 'document', '$', 'isClaim', 'current', 'readingFrom', `${fn('showLink')}\nreturn showLink;`)(
      window,
      { body: { dataset: { screen: options.screen } } },
      () => ({ value: '' }),
      () => false,
      null,
      options.readingFrom,
    ) as (id: string | null) => void;
    showLink(id);
    return calls;
  }

  it('showLink stores { from } with a reading\'s entry, even when the address is already right', () => {
    expect(link('0aio3f82kqsu9', { url: '/?s=0aio3f82kqsu9', state: null, screen: 'reading', readingFrom: 'check' })).toEqual([[{ from: 'check' }, '/?s=0aio3f82kqsu9']]);
    expect(link('0aio3f82kqsu9', { url: '/#explore', state: null, screen: 'reading', readingFrom: 'explore' })).toEqual([[{ from: 'explore' }, '/?s=0aio3f82kqsu9']]);
    expect(link('0aio3f82kqsu9', { url: '/?s=0aio3f82kqsu9', state: { from: 'saved' }, screen: 'reading', readingFrom: 'saved' })).toEqual([]);
  });

  it('showLink keeps nothing for an entry that is not a reading', () => {
    expect(link(null, { url: '/?s=0aio3f82kqsu9', state: { from: 'explore' }, screen: 'check', readingFrom: 'explore' })).toEqual([[null, '/']]);
    expect(link(null, { url: '/', state: null, screen: 'check', readingFrom: 'explore' })).toEqual([]);
  });

  it('a cold link or a reload opens the reading with the origin its entry stored, if any', () => {
    expect(APP).toContain("openSnapshot(saved, 'replace', window.history.state && window.history.state.from);");
  });
});

/**
 * Every opening the reader makes (an example card, a recent chip, "Try a
 * saved example", a case study or list row, a saved card, a check's answer,
 * a saved position's Refresh) gets a history entry of its own after the
 * screen it was opened from, so Back returns to the screen the breadcrumb
 * and the lit tab name. Only the cold page load and the browser's own moves
 * (popstate) rewrite the entry showing, and a reading redrawn in place
 * rewrites its own. Run for real against a stand-in browser: web/app.js's
 * own navigation over a history that logs each push and replace. Drawing a
 * reading is cut down to the lines that decide its origin, taken from
 * renderResult itself; every request answers at once.
 */
describe('Back returns to the screen a reading was opened from', () => {
  const SITE = 'https://example.test';
  const BET = '0aio3f82kqsu9';
  const COVERED = '3aus98sj8cz7u';
  type Answer = { snapshotSaved?: boolean };
  type Fake = {
    hidden: boolean; value: string; textContent: string; disabled: boolean; title: string;
    dataset: Record<string, string>; attrs: Record<string, string>; children: Fake[]; listeners: Record<string, () => unknown>;
    setAttribute: (name: string, value: string) => void; removeAttribute: (name: string) => void; focus: () => void;
    addEventListener: (type: string, listener: () => unknown) => void; replaceChildren: (...children: Fake[]) => void;
  };
  type Page = {
    openSnapshot: (id: string, navigation?: string, historyFrom?: string | null) => Promise<unknown>;
    runCheck: (address?: string) => unknown;
    checkPosition: (address: string, position: { coin: string; side: string }) => unknown;
    renderRecent: () => void;
    routeHistory: (state: unknown) => unknown;
    goCheck: (event?: unknown) => unknown;
    openBoards: (event?: unknown) => void;
    openSaved: (event?: unknown) => void;
  };

  function browser(start: string, options: { live?: Answer; recent?: unknown[] } = {}) {
    const log: string[] = [];
    const entries: Array<{ url: URL; state: unknown }> = [{ url: new URL(start, SITE), state: null }];
    let index = 0;
    const path = (url: URL) => url.pathname + url.search + url.hash;
    const window = {
      location: {
        origin: SITE,
        get pathname() { return entries[index].url.pathname; },
        get search() { return entries[index].url.search; },
        get hash() { return entries[index].url.hash; },
        get href() { return entries[index].url.href; },
      },
      history: {
        get state() { return entries[index].state; },
        pushState(state: unknown, _title: string, to: string) {
          const url = new URL(to, entries[index].url);
          entries.splice(index + 1, entries.length, { url, state });
          index++;
          log.push(`push ${path(url)}`);
        },
        replaceState(state: unknown, _title: string, to: string) {
          const url = new URL(to, entries[index].url);
          entries[index] = { url, state };
          log.push(`replace ${path(url)}`);
        },
      },
      localStorage: { getItem: (key: string) => (key === 'betOrBook:recent' ? JSON.stringify(options.recent ?? []) : null) },
      scrollTo: () => {},
    };
    const make = (): Fake => {
      const e: Fake = {
        hidden: false, value: '', textContent: '', disabled: false, title: '', dataset: {}, attrs: {}, children: [], listeners: {},
        setAttribute: (name, value) => { e.attrs[name] = value; },
        removeAttribute: (name) => { delete e.attrs[name]; },
        focus: () => {},
        addEventListener: (type, listener) => { e.listeners[type] = listener; },
        replaceChildren: (...children) => { e.children = children; },
      };
      return e;
    };
    const elements = new Map<string, Fake>();
    const $ = (id: string): Fake => {
      if (!elements.has(id)) elements.set(id, make());
      return elements.get(id)!;
    };
    const el = (_tag: string, _className?: string, text?: string) => Object.assign(make(), { textContent: text ?? '' });
    const document = { referrer: '', body: { dataset: { screen: 'check' } as Record<string, string>, classList: { add: () => {}, remove: () => {} } } };
    let checks = 0;
    const load = (url: string, onData: (d: unknown) => void) => {
      if (url.startsWith('/api/snapshot')) onData({ ...reading(new URL(url, SITE).searchParams.get('id')!) });
      else onData({ ...HYPE_LONG(), snapshotId: `live-${++checks}`, snapshotSaved: true, ...options.live });
      return Promise.resolve();
    };
    const constant = (name: string) => APP.match(new RegExp(`^const ${name} = .*$`, 'm'))![0];
    const originLines = fn('renderResult').match(/const openedFrom = readingOrigin\(\{[\s\S]*?\}\);/)![0];
    const page = new Function(
      '$', 'document', 'window', 'el', 'load', 'isClaim', 'setStatus', 'askForPicture', 'renderPlayer', 'renderWatched', 'ensureGallery', 'extractAddress', 'fmtTime', 'VERDICTS',
      [
        'let current = null; let readingFrom = "check"; let readingOnShow = null; let requestSeq = 0; let busy = false; let guessRevealTimer = null;',
        constant('ADDRESS_RE'),
        constant('RECENT_KEY'),
        `function renderResult(d, opts) {\n${originLines}\ncurrent = d;\nsetScreen('reading', openedFrom);\n}`,
        ...['fmtUsd', 'readingTitleParts', 'readingTitle', 'screenState', 'movesToTop', 'readingOrigin', 'setScreen', 'showLink', 'linkReading', 'setBusy', 'takeOver',
          'openSnapshot', 'showLiveReading', 'runCheck', 'checkPosition', 'loadRecent', 'renderRecent', 'routeHistory', 'goCheck', 'showExamples', 'openBoards', 'openSaved'].map(fn),
        'return { openSnapshot, runCheck, checkPosition, renderRecent, routeHistory, goCheck, openBoards, openSaved };',
      ].join('\n'),
    )(
      $, document, window, el, load, () => false, () => {}, () => {}, () => {}, () => {}, () => {}, () => null, (t: string) => t,
      { looks_like_a_bet: { label: 'Looks like a bet' }, unknown: { label: 'Unknown' } },
    ) as Page;
    const back = () => { index--; return page.routeHistory(entries[index].state); };
    const forward = () => { index++; return page.routeHistory(entries[index].state); };
    const tabs = () => ({
      check: $('nav-examples').attrs['aria-current'] ?? null,
      explore: $('nav-boards').attrs['aria-current'] ?? null,
      saved: $('nav-saved').attrs['aria-current'] ?? null,
    });
    const crumb = () => ($('breadcrumb').hidden ? null : { origin: $('breadcrumb-origin').dataset.screen, label: $('breadcrumb-origin-label').textContent });
    return {
      page, $, back, forward, tabs, crumb,
      screen: () => document.body.dataset.screen,
      take: () => log.splice(0),
      paths: () => entries.map((e) => path(e.url)),
    };
  }
  const ADDRESS = HYPE_LONG().address;

  it('Check -> an example card -> Back returns to Check (the card, "Try a saved example" and the queue links call openSnapshot(id, \'push\'))', () => {
    const b = browser('/');
    b.page.openSnapshot(BET, 'push');
    expect(b.take()).toEqual(['push /', `replace /?s=${BET}`]);
    expect(b.paths()).toEqual(['/', `/?s=${BET}`]);
    expect(b.crumb()).toEqual({ origin: 'check', label: 'Check a wallet' });
    b.back();
    expect(b.screen()).toBe('check');
    expect(b.tabs()).toEqual({ check: 'page', explore: null, saved: null });
    expect(b.crumb()).toBeNull();
    expect(b.take()).toEqual([]);
  });

  it('Check -> a recent chip -> Back returns to Check', () => {
    const b = browser('/', { recent: [{ id: BET, address: ADDRESS, headline: 'HYPE long', verdict: 'looks_like_a_bet', checkedAt: '2026-10-07T15:56:00Z' }] });
    b.page.renderRecent();
    const chip = b.$('recent-chips').children[0];
    expect(chip.textContent).toBe('HYPE long · Looks like a bet');
    chip.listeners.click();
    expect(b.take()).toEqual(['push /', `replace /?s=${BET}`]);
    b.back();
    expect(b.screen()).toBe('check');
    expect(b.take()).toEqual([]);
  });

  it('Check -> a live check -> Back returns to Check, whether or not the server saved the reading', () => {
    const saved = browser('/');
    saved.page.runCheck(ADDRESS);
    expect(saved.take()).toEqual(['push /', 'replace /?s=live-1']);
    expect(saved.crumb()).toEqual({ origin: 'check', label: 'Check a wallet' });
    saved.back();
    expect(saved.screen()).toBe('check');
    expect(saved.take()).toEqual([]);
    // Nothing saved, so nothing to link to: the reading's entry stays at /.
    const unsaved = browser('/', { live: { snapshotSaved: false } });
    unsaved.page.runCheck(ADDRESS);
    expect(unsaved.take()).toEqual(['push /']);
    expect(unsaved.screen()).toBe('reading');
    unsaved.back();
    expect(unsaved.screen()).toBe('check');
  });

  it('Saved -> Refresh -> Back returns to Saved, for a row with a chosen position (checkPosition) and one without (runCheck)', () => {
    const b = browser('/');
    b.page.openSaved();
    expect(b.take()).toEqual(['push /#saved']);
    b.page.checkPosition(ADDRESS, { coin: 'HYPE', side: 'long' });
    expect(b.take()).toEqual(['push /#saved', 'replace /?s=live-1']);
    expect(b.crumb()).toEqual({ origin: 'saved', label: 'Saved' });
    expect(b.tabs()).toEqual({ check: null, explore: null, saved: 'true' });
    b.back();
    expect(b.screen()).toBe('saved');
    expect(b.tabs()).toEqual({ check: null, explore: null, saved: 'page' });
    expect(b.take()).toEqual([]);
    b.page.runCheck(ADDRESS);
    expect(b.take()).toEqual(['push /#saved', 'replace /?s=live-2']);
    b.back();
    expect(b.screen()).toBe('saved');
    expect(b.paths()).toEqual(['/', '/#saved', '/?s=live-2']);
  });

  it('Explore -> a case study -> Back returns to Explore, and Forward brings the reading back with Explore as its origin', () => {
    const b = browser('/');
    b.page.openBoards();
    b.take();
    b.page.openSnapshot(COVERED, 'push');
    expect(b.take()).toEqual(['push /#explore', `replace /?s=${COVERED}`]);
    b.back();
    expect(b.screen()).toBe('explore');
    b.forward();
    expect(b.screen()).toBe('reading');
    expect(b.crumb()).toEqual({ origin: 'explore', label: 'Explore' });
    expect(b.take()).toEqual([]);
  });

  it('a reading redrawn in place (Check live, another position) keeps its entry, so Back still returns to its origin', () => {
    for (const origin of ['check', 'explore', 'saved']) {
      const b = browser('/');
      if (origin === 'explore') b.page.openBoards();
      if (origin === 'saved') b.page.openSaved();
      b.page.openSnapshot(BET, 'push');
      b.take();
      b.page.checkPosition(ADDRESS, { coin: 'HYPE', side: 'long' });
      b.page.runCheck(ADDRESS);
      expect(b.take(), origin).toEqual(['replace /?s=live-1', 'replace /?s=live-2']);
      expect(b.crumb()?.origin, origin).toBe(origin);
      b.back();
      expect(b.screen(), origin).toBe(origin);
    }
  });

  it('opening the reading already on show again ("Open a free saved example" on it) adds no second entry', () => {
    const b = browser('/');
    b.page.openSnapshot(BET, 'push');
    b.take();
    b.page.openSnapshot(BET, 'push');
    expect(b.take().filter((line) => line.startsWith('push'))).toEqual([]);
    expect(b.paths()).toEqual(['/', `/?s=${BET}`]);
    b.back();
    expect(b.screen()).toBe('check');
    // The same reading opened from another screen still gets its own entry
    // after that screen, so Back returns there.
    const c = browser('/');
    c.page.openSnapshot(BET, 'push');
    c.page.openBoards();
    c.take();
    c.page.openSnapshot(BET, 'push');
    expect(c.take()).toEqual([`push /?s=${BET}#explore`, `replace /?s=${BET}`]);
    c.back();
    expect(c.screen()).toBe('explore');
  });

  it('a cold link adds no entry, and neither do the browser\'s own moves', () => {
    const b = browser(`/?s=${BET}`);
    // The cold start's call (pinned above): the link's own entry keeps { from: 'check' }.
    b.page.openSnapshot(BET, 'replace', null);
    expect(b.take()).toEqual([`replace /?s=${BET}`]);
    expect(b.paths()).toEqual([`/?s=${BET}`]);
    b.page.goCheck();
    expect(b.take()).toEqual(['push /']);
    b.back();
    expect(b.screen()).toBe('reading');
    expect(b.crumb()).toEqual({ origin: 'check', label: 'Check a wallet' });
    b.forward();
    expect(b.screen()).toBe('check');
    expect(b.take()).toEqual([]);
    expect(b.paths()).toEqual([`/?s=${BET}`, '/']);
  });

  it('every openSnapshot call the reader starts passes push; only the cold start and the history routing replace or preserve', () => {
    const calls = [...`${APP}\n${EXPLORE}`.matchAll(/^.*\bopenSnapshot\(.*$/gm)].map((m) => m[0].trim()).filter((line) => !line.startsWith('function openSnapshot('));
    const mode = (line: string) => /openSnapshot\([^;]*?'(push|replace|preserve)'/.exec(line)?.[1] ?? 'default';
    expect(calls.filter((line) => mode(line) === 'default')).toEqual([]);
    expect(calls.filter((line) => mode(line) !== 'push')).toEqual([
      "if (id && current?.snapshotId !== id) return openSnapshot(id, 'preserve', historyFrom).then(() => openBoards());",
      "if (id) return openSnapshot(id, 'replace', historyFrom);",
      "if (saved) opening = openSnapshot(saved, 'preserve').then(() => openBoards());",
      "opening = openSnapshot(saved, 'replace', window.history.state && window.history.state.from);",
    ]);
    // Example cards, case studies, list and board rows, recent chips, "Try a
    // saved example" (two calls), the queue links and saved cards.
    expect(calls.filter((line) => mode(line) === 'push')).toHaveLength(9);
  });

  it('every live check\'s answer goes through showLiveReading, which pushes from Check or Saved and replaces on a reading', () => {
    expect(APP.match(/renderResult\(data, \{ kind: 'live' \}\)/g)).toHaveLength(1);
    expect(fn('showLiveReading')).toContain("document.body.dataset.screen === 'reading' ? 'replace' : 'push'");
    for (const name of ['runCheck', 'checkPosition']) expect(fn(name), name).toContain('showLiveReading');
    // Try again and Load context, both on the reading screen.
    expect(APP.match(/load\(url, showLiveReading, /g)).toHaveLength(2);
  });
});

describe('the active tab style', () => {
  it('lights a tab whatever its aria-current value ("page" or "true")', () => {
    expect(PAGE).toMatch(/\.pill-tab\[aria-current\],/);
    expect(PAGE).not.toContain('.pill-tab[aria-current="page"]');
  });
});

describe('the header tabs on a cold open', () => {
  it('do not fade from Check to the screen opened: transitions wait for body[data-ready], set once the first screen is', () => {
    expect(PAGE).toMatch(/body:not\(\[data-ready\]\) \.pill-tab \{ transition: none; \}/);
    expect(PAGE).toMatch(/<body data-screen="check">/);
    const from = APP.search(/^if \(window\.location\.hash === '#saved'\) \{\r?\n {2}openSaved\(\);/m);
    expect(from).toBeGreaterThan(0);
    const start = APP.slice(from);
    const ready = start.indexOf("document.body.dataset.ready = '';");
    expect(ready).toBeGreaterThan(0);
    // After the cold start's routing, and waiting for a reading it opens.
    expect(start.slice(0, ready)).toContain('opening = openSnapshot(saved, \'replace\'');
    expect(start.slice(0, ready)).toMatch(/Promise\.resolve\(opening\)[\s\S]*void document\.body\.offsetWidth;/);
  });
});

describe('the status line of a live check', () => {
  it('names the wallet while checking and says "Checked" once the answer is in, not "Checking"', () => {
    const lines: string[] = [];
    let shown: unknown = null;
    const field = { value: '0x082e843a431aef031264dc232693dd710aedca88', setAttribute: () => {}, removeAttribute: () => {} };
    const $ = (id: string) => (id === 'address' ? field : { hidden: true, replaceChildren: () => {}, querySelector: () => ({ focus: () => {} }) });
    const setStatus = (text: string) => { lines.push(text); };
    // A stand-in for load(): the progress line with the notice, then the
    // success line load() itself writes, then the answer.
    const load = (_url: string, onData: (d: unknown) => void, _fail: string, _method: string, notice: string) => {
      setStatus(notice + ' Reading positions...');
      setStatus(notice || '');
      onData({ answer: true });
    };
    const runCheck = new Function(
      '$', 'busy', 'extractAddress', 'setStatus', 'load', 'showLiveReading', 'el',
      `const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;\n${extractPageFunction(APP, 'runCheck')}\nreturn runCheck;`,
    )($, false, (raw: string) => raw.trim(), setStatus, load, (d: unknown) => { shown = d; }, () => ({})) as (a?: string) => void;
    runCheck();
    expect(lines[0]).toBe('Checking wallet 0x082e843a431aef031264dc232693dd710aedca88. Reading positions...');
    expect(lines.at(-1)).toBe('Checked wallet 0x082e843a431aef031264dc232693dd710aedca88.');
    expect(shown).toEqual({ answer: true });
  });
});
