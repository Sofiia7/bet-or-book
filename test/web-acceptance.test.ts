import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPageFunction } from './support/pageScript';

/**
 * The acceptance pass over the redesigned page (the plan's Task 7): the rules
 * from the owner's handoff and from the accessibility checklist that can be
 * read off the source, so a later edit cannot quietly break them. What only a
 * browser can show (no sideways scroll at 360 px, the Share menu on screen,
 * Back returning to the screen a reading came from) was checked by hand and
 * is recorded in the plan's execution record.
 */

const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const EXPLORE = readFileSync(new URL('../web/explore.js', import.meta.url), 'utf8');
const STYLE = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');
const fn = (name: string) => extractPageFunction(APP, name);

// ---- reading the stylesheet ----

type Rule = { selectors: string[]; body: string; at: string[] };
/** Every style rule, with the at-rules (@media, @container) it sits in. */
function rulesOf(css: string, at: string[] = []): Rule[] {
  const rules: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; close < css.length && depth > 0; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}') depth--;
    }
    const head = css.slice(i, open).trim();
    const inner = css.slice(open + 1, close - 1);
    if (/^@(media|container|supports)\b/.test(head)) rules.push(...rulesOf(inner, [...at, head]));
    else if (!head.startsWith('@')) rules.push({ selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: inner.replace(/\s+/g, ' ').trim(), at });
    i = close;
  }
  return rules;
}
const RULES = rulesOf(CSS);
/** The declarations of the rules (outside any at-rule) whose selector list includes `selector`. */
const declarationsFor = (selector: string) =>
  RULES.filter((r) => r.at.length === 0 && r.selectors.includes(selector)).map((r) => r.body).join('; ');

/** The design tokens on :root, by name without the leading dashes. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...(RULES.find((r) => r.selectors.includes(':root') && r.at.length === 0)?.body ?? '').matchAll(/--([\w-]+):\s*([^;]+)/g)].map((m) => [m[1], m[2].trim()]),
);

// ---- WCAG 2 contrast ----

/** A token value (#RRGGBB or oklch(L C H)) as sRGB channels from 0 to 1. */
function srgb(value: string): number[] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
  const lch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!lch) throw new Error(`cannot read the color ${value}`);
  // OKLCH to OKLab to linear sRGB (Ottosson's matrices), clipped to the gamut.
  const [L, C, H] = lch.slice(1).map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return linear.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  });
}
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(fg: string, bg: string): number {
  const [a, b] = [fg, bg].map((name) => {
    expect(TOKENS[name], `--${name} on :root`).toBeDefined();
    return luminance(srgb(TOKENS[name]));
  });
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('text contrast (WCAG 2, at least 4.5:1 for text under 24 px)', () => {
  it('reads the formula right: white on black is 21, the handoff\'s own faint gray was 3.95', () => {
    expect((1 + 0.05) / (luminance(srgb('#000000')) + 0.05)).toBeCloseTo(21, 5);
    expect((luminance(srgb('#6B707D')) + 0.05) / (luminance(srgb('#0B0C10')) + 0.05)).toBeCloseTo(3.95, 2);
  });

  // The colors small text is set in, on the three backgrounds text sits on:
  // the page, a card or panel, and a cell inside a panel.
  const SMALL_TEXT = ['text-muted', 'text-faint', 'placeholder', 'verdict-bet', 'verdict-hedged', 'verdict-unknown', 'verdict-book'];
  const BACKGROUNDS = ['bg', 'surface', 'surface-inset'];
  for (const fg of SMALL_TEXT) {
    for (const bg of BACKGROUNDS) {
      it(`--${fg} on --${bg}`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
    }
  }

  // The other pairs the stylesheet sets text in.
  const PAIRS: Array<[string, string, string]> = [
    ['text-faint', 'menu-bg', 'the note at the foot of the Share menu'],
    ['text-faint', 'hover-bg-strong', 'a list row\'s meta line while the row is hovered'],
    ['text', 'menu-bg', 'the Share menu items'],
    ['text-2', 'surface', 'the source banner (#source-warning, a .box) and card summaries'],
    ['text', 'surface', 'the source banner\'s lead-in'],
    ['danger', 'bg', 'an error on the status line'],
    ['danger', 'surface', 'Remove, hovered, on a saved card'],
    ['accent', 'bg', 'links, eyebrows and section numbers'],
    ['accent', 'surface', '"Open" on a card'],
    ['on-accent', 'accent', 'the primary button'],
    ['on-accent', 'active-tab-bg', 'the lit tab'],
  ];
  for (const [fg, bg, where] of PAIRS) {
    it(`--${fg} on --${bg}: ${where}`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
  }
});

// ---- type sizes ----

/**
 * The only text set under 14 px. The handoff: "Minimum readable text is
 * 14px; nothing is smaller except 12px mono labels", and its own type table
 * sets three more mono roles at 13 px (eyebrow, card meta, section number).
 * Each entry is mono; the reason says which role it is.
 */
const SMALL_TYPE: Record<string, string> = {
  '.mono-label': 'mono label, 12 px (handoff "Mono label")',
  '.stat-label': 'a stat cell\'s mono label, 12 px',
  '.pill-count': 'the Saved count badge, mono 12 px (handoff "Header")',
  '.cp-verdict': 'a card\'s verdict label, mono 12 px (handoff "Position card")',
  '.badge': 'the verdict label on a reading and a list row, mono 12 px',
  '.open-question > strong': 'a Blind spots cell\'s mono label, 12 px',
  '.not-read strong': 'a Blind spots cell\'s mono label, 12 px',
  '.constellation-stat-label': 'the coverage illustration\'s mono label, 12 px',
  '.constellation-stat .quality-flag': 'the coverage illustration\'s data-quality flag, mono 12 px',
  '.eyebrow': 'eyebrow, Geist Mono 13 px (handoff "Eyebrow")',
  '.cp-meta': 'a card\'s address and date, mono 13 px (handoff "Position card" footer)',
  '.row-meta': 'a list row\'s address and date, the card meta role, mono 13 px',
  '.section-head::before': 'a reading section\'s number, Geist Mono 13 px (handoff "Section number")',
  '.step-number': 'a How it works step number, the section number role, mono 13 px',
  '.rank': 'a list row\'s rank, the section number role, mono 13 px',
  code: 'a reason code in the technical line, mono 13 px',
  '.mono': 'an address inside a line of text, 0.94em of a 15-17 px line (14.1 px at the least)',
};

/** The font sizes a rule sets: px numbers (a clamp() gives its floor) and em/rem/% values. */
function fontSizesOf(body: string): Array<{ px?: number; relative?: string }> {
  const sizes: Array<{ px?: number; relative?: string }> = [];
  for (const m of body.matchAll(/(?:^|;)\s*font-size:\s*([^;]+)/g)) {
    const px = [...m[1].matchAll(/([\d.]+)px/g)].map((n) => Number(n[1]));
    if (px.length) sizes.push({ px: Math.min(...px) });
    else if (/[\d.]+(?:em|rem|%)/.test(m[1])) sizes.push({ relative: m[1].trim() });
  }
  // The shorthand: "500 12px/1.4 var(--font-mono)" - the first length is the size.
  for (const m of body.matchAll(/(?:^|;)\s*font:\s*([^;]+)/g)) {
    const size = /([\d.]+)(px|em|rem|%)(?:\s*\/|\s)/.exec(m[1]);
    if (size) sizes.push(size[2] === 'px' ? { px: Number(size[1]) } : { relative: size[0].trim() });
  }
  return sizes;
}

describe('type sizes', () => {
  const small = RULES.filter((r) => fontSizesOf(r.body).some((s) => s.relative !== undefined || (s.px ?? 99) < 14));

  it('finds the rules at all (the reading of the stylesheet has not gone blind)', () => {
    expect(RULES.length).toBeGreaterThan(300);
    expect(small.length).toBeGreaterThan(5);
  });

  it('sets no text under 14 px except the mono label classes on the list above', () => {
    const outside = small.flatMap((r) => r.selectors.filter((s) => !(s in SMALL_TYPE)).map((s) => `${s} { ${r.body} }`));
    expect(outside).toEqual([]);
  });

  it('sets every one of them in Geist Mono, and none under 12 px', () => {
    for (const r of small) {
      expect(r.body, r.selectors.join(', ')).toMatch(/var\(--font-mono\)/);
      for (const s of fontSizesOf(r.body)) if (s.px !== undefined) expect(s.px, r.selectors.join(', ')).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the list to classes that still need it', () => {
    const used = new Set(small.flatMap((r) => r.selectors));
    expect(Object.keys(SMALL_TYPE).filter((s) => !used.has(s))).toEqual([]);
  });
});

// ---- motion ----

describe('reduced motion', () => {
  const reduce = RULES.filter((r) => r.at.some((a) => /prefers-reduced-motion:\s*reduce/.test(a)));

  it('turns off every transition and animation, and smooth scrolling, for a reader who asked for less motion', () => {
    const all = reduce.find((r) => r.selectors.includes('*'));
    expect(all, 'a @media (prefers-reduced-motion: reduce) rule for *').toBeDefined();
    expect(all!.selectors).toEqual(expect.arrayContaining(['*', '*::before', '*::after']));
    expect(all!.body).toMatch(/transition:\s*none\s*!important/);
    expect(all!.body).toMatch(/animation:\s*none\s*!important/);
    expect(all!.body).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it('asks the browser for a smooth scroll only when the reader has not asked for less motion', () => {
    expect(APP).not.toMatch(/behavior:\s*'smooth'/);
    // A call that names no behavior jumps at once already.
    const calls = [...APP.matchAll(/scrollIntoView\(\{([^}]*)\}\)/g)].map((m) => m[1]).filter((call) => /behavior/.test(call));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toContain('behavior: scrollMotion()');
    const scrollMotion = (reduced: boolean | undefined) =>
      new Function('window', `${fn('scrollMotion')}\nreturn scrollMotion();`)(
        reduced === undefined ? {} : { matchMedia: (query: string) => ({ matches: reduced && query === '(prefers-reduced-motion: reduce)' }) },
      );
    expect(scrollMotion(false)).toBe('smooth');
    expect(scrollMotion(true)).toBe('auto');
    // A browser without matchMedia keeps the smooth scroll it had.
    expect(scrollMotion(undefined)).toBe('smooth');
  });
});

// ---- focus and the sticky header ----

/** A length the stylesheet gives in px, with var(--token) and calc(a + b - c) worked out. */
function lengthPx(value: string): number {
  const expr = value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => TOKENS[name] ?? 'NaN').replace(/^calc\((.*)\)$/, '$1').trim();
  if (!/^\d+(?:\.\d+)?px(?:\s*[+-]\s*\d+(?:\.\d+)?px)*$/.test(expr)) return NaN;
  return [...expr.matchAll(/([+-])?\s*(\d+(?:\.\d+)?)px/g)].reduce((sum, m) => sum + (m[1] === '-' ? -1 : 1) * Number(m[2]), 0);
}
/** The scroll-padding-top of each html rule, by the at-rules it sits in. */
const scrollPadding = RULES.filter((r) => r.selectors.includes('html'))
  .map((r) => ({ at: r.at.join(' '), value: /(?:^|;)\s*scroll-padding-top:\s*([^;]+)/.exec(r.body)?.[1].trim() }))
  .filter((r): r is { at: string; value: string } => !!r.value);

describe('keyboard focus is never hidden under the sticky header (WCAG 2.2 SC 2.4.11)', () => {
  it('reads the stylesheet right: the header is sticky and as tall as --header-h', () => {
    expect(declarationsFor('.site-header')).toMatch(/position:\s*sticky/);
    expect(declarationsFor('.site-header')).toMatch(/min-height:\s*var\(--header-h\)/);
    expect(lengthPx('var(--header-h)')).toBe(72);
    expect(lengthPx('calc(var(--header-h) + 16px)')).toBe(88);
  });

  it('keeps whatever the browser scrolls to (a focused control, a scrolled-to section) clear of the header', () => {
    const base = scrollPadding.filter((r) => r.at === '');
    expect(base).toHaveLength(1);
    expect(lengthPx(base[0].value)).toBeGreaterThanOrEqual(lengthPx('var(--header-h)') + 8);
  });

  it('keeps clear of the header where it can wrap to two rows: under 360 px (102.5 px measured at 320 and 330 px with a two-digit Saved count)', () => {
    const maxWidth = (at: string) => Number(/max-width:\s*(\d+)px/.exec(at)?.[1] ?? NaN);
    const narrow = scrollPadding.filter((r) => maxWidth(r.at) >= 359 && maxWidth(r.at) < 400);
    expect(narrow).toHaveLength(1);
    expect(lengthPx(narrow[0].value)).toBeGreaterThanOrEqual(102.5 + 8);
  });

  it('adds no scroll-margin-top on top of it', () => {
    expect(CSS).not.toMatch(/scroll-margin-top/);
  });
});

// ---- fonts ----

describe('fonts', () => {
  const HEAD = PAGE.slice(0, PAGE.indexOf('</head>'));

  it('preloads the main sans font, and only it, from the page\'s own origin (the CSP allows fonts from \'self\' only)', () => {
    const preloads = [...HEAD.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((m) => m[0]);
    expect(preloads).toEqual(['<link rel="preload" as="font" type="font/woff2" href="/fonts/geist-sans.woff2" crossorigin>']);
    // Before the stylesheet that uses it, and the very file its @font-face names.
    expect(HEAD.indexOf(preloads[0])).toBeLessThan(HEAD.indexOf('<style'));
    expect(STYLE).toContain('@font-face { font-family: "Geist"; src: url("/fonts/geist-sans.woff2") format("woff2");');
  });
});

// ---- one closing call to action per screen ----

describe('the Reading screen ends with "What next?" only', () => {
  it('hides the Check screen\'s "Want to compare more wallets?" line while a reading shows, and keeps the element', () => {
    expect(PAGE).toMatch(/<div class="explore-entry" id="explore-entry">/);
    // It sits outside #workspace, so hiding the Check screen does not hide it.
    expect(elementById(PAGE, 'workspace')).not.toContain('id="explore-entry"');
    const hidden = RULES.filter((r) => r.at.length === 0 && r.selectors.includes('body.has-reading #explore-entry'));
    expect(hidden.map((r) => r.body).join('; ')).toMatch(/display:\s*none/);
  });
});

// ---- sideways scroll and long text ----

describe('long text wraps instead of widening the page', () => {
  it('never lets the page scroll sideways on purpose', () => {
    for (const r of RULES.filter((x) => x.selectors.some((s) => s === 'html' || s === 'body'))) {
      expect(r.body).not.toMatch(/overflow(?:-x)?:\s*(?:scroll|auto)/);
    }
  });

  // Each holds text that can run long with no place to break: a full 42
  // character address, a name the reader typed, a long amount.
  const WRAPS: Record<string, string> = {
    '.status': '"Checking wallet 0x...": the full address, 360 px wide at 15 px',
    '.cp-summary': 'a saved card\'s summary, kept in the browser and so not to be trusted to have spaces',
    '.cp-amount': 'a card\'s title, which on Saved can be the reader\'s 80-character name',
    '.saved-name': 'the reader\'s name for a saved position',
    '.reading-meta': 'the address and age under a reading\'s title',
    '.reading-title': 'the reading\'s title',
    '.subject': 'the position asked about, with its address',
    '#address-choices': 'the full addresses to choose from',
    '.monitor-notices': 'what monitoring found',
    '.stat-value': 'an evidence value such as "$395.8M ETH in 2 wallets, owner unconfirmed"',
  };
  for (const [selector, why] of Object.entries(WRAPS)) {
    it(`${selector} breaks anywhere: ${why}`, () => expect(declarationsFor(selector)).toMatch(/overflow-wrap:\s*anywhere/));
  }

  // Flex and grid children that hold such text may shrink below it.
  for (const selector of ['.section-body', '.reading-head-text', '.card-position', '.stat-grid > *', '.stat-pair > *', '.board']) {
    it(`${selector} can shrink (min-width: 0)`, () => expect(declarationsFor(selector)).toMatch(/min-width:\s*0/));
  }
});

// ---- buttons ----

describe('the README\'s three button types', () => {
  const paddingX = (selector: string) => {
    const padding = [...declarationsFor(selector).matchAll(/(?:^|;)\s*padding:\s*([^;]+)/g)].map((m) => m[1].trim()).pop() ?? '';
    const parts = padding.split(/\s+/);
    return parts.length >= 2 ? parts[1] : parts[0];
  };

  it('pads each 16-18 px across: primary 18, secondary 16, ghost 16, the Monitor switch 16', () => {
    expect(paddingX('.btn')).toBe('18px');
    expect(paddingX('.btn-secondary')).toBe('16px');
    expect(paddingX('.btn-ghost')).toBe('16px');
    expect(paddingX('.monitor-toggle')).toBe('16px');
  });

  it('keeps the 36 px chip to choosing among options; a lone action is a button', () => {
    expect(STYLE).toMatch(/\/\*[^*]*\bchip\b[^*]*\*\/\s*\.chips\s*\{/);
    // In the markup, chips appear only in the guess group; the scripts add
    // the others to their own choice groups (address, position, recent
    // checks, the list filters).
    const chips = [...PAGE.matchAll(/<button\b[^>]*class="chip"[^>]*>/g)];
    const guess = PAGE.slice(PAGE.indexOf('id="guess-chips"'), PAGE.indexOf('</span>', PAGE.indexOf('id="guess-chips"')));
    expect(chips.length).toBe(4);
    expect([...guess.matchAll(/<button\b[^>]*class="chip"/g)]).toHaveLength(4);
    expect(PAGE).toMatch(/<button class="btn-secondary" id="waiting-example">/);
  });
});

// ---- the markup of the four screens ----

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
const BODY = PAGE.slice(PAGE.indexOf('<body'));
/** Each screen's own block and the id of its H1. */
const SCREENS = {
  check: { block: 'entry-controls', h1: 'hero-title' },
  reading: { block: 'card', h1: 'reading-title' },
  explore: { block: 'gallery', h1: 'explore-title' },
  saved: { block: 'saved-view', h1: 'saved-title' },
} as const;

describe('the four screens in web/index.html', () => {
  it('gives no two elements the same id', () => {
    const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(150);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('has exactly one h1 per screen, four in all', () => {
    expect([...BODY.matchAll(/<h1\b/g)]).toHaveLength(4);
    for (const [screen, { block, h1 }] of Object.entries(SCREENS)) {
      const html = elementById(PAGE, block);
      expect(html, screen).not.toBe('');
      const found = [...html.matchAll(/<h1\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(found, screen).toEqual([h1]);
    }
  });

  it('gives each screen a landmark named by its h1', () => {
    for (const [screen, { block, h1 }] of Object.entries(SCREENS)) {
      // A <section> with an accessible name is a region landmark; an
      // <article> or a <div> is not.
      const landmark = new RegExp(`<section\\b[^>]*\\baria-labelledby="${h1}"`).exec(elementById(PAGE, block));
      expect(landmark, screen).not.toBeNull();
    }
  });

  it('skips no heading level going down a screen', () => {
    const blocks = {
      check: elementById(PAGE, 'entry-controls') + elementById(PAGE, 'examples') + elementById(PAGE, 'how-it-works'),
      reading: elementById(PAGE, 'card'),
      explore: elementById(PAGE, 'gallery'),
      saved: elementById(PAGE, 'saved-view'),
    };
    for (const [screen, html] of Object.entries(blocks)) {
      const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      expect(levels[0], screen).toBe(1);
      for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `${screen}: h${levels[i - 1]} then h${levels[i]}`).toBeLessThanOrEqual(1);
    }
    // Explore's boards are drawn by web/explore.js, under the h1 Explore.
    expect(EXPLORE).toMatch(/el\('h2', null, board\.title\)/);
    expect(EXPLORE).not.toMatch(/el\('h3'/);
  });
});
