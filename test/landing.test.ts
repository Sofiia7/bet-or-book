// The landing page's example tiles are rendered twice: once by the Worker
// into the initial HTML (src/landing.ts), and again by web/app.js once the
// gallery has loaded. The two used to word the badge differently - the
// server added the qualifier to every verdict and dropped the strength, the
// page did the opposite - so three of the four tiles rewrote themselves in
// front of the reader a moment after the page showed (27.09).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import featuredData from './fixtures/featured-september.json';
import { galleryIndex, type Gallery } from '../src/gallery';
import { landingExamples } from '../src/landing';
import { VERDICT_STYLES } from '../src/engine/presentation';
import { formatUsd } from '../src/engine/evidence';
import { snapshotId } from '../src/snapshot';
import worker from '../src/index';
import { request, testEnv } from './support/worker';

const featured = featuredData as unknown as Gallery;
const rows = galleryIndex(featured, (e) => e.snapshotId ?? snapshotId(e.address, e.checkedAt)).entries;
const html = landingExamples(rows);
const badges = [...html.matchAll(/class="cp-verdict badge [a-z]+">([^<]+)</g)].map((m) => m[1]);
/** Each example card, whole: the link and everything in it. */
const cards = html.match(/<a class="card-position queue-row" href="[^"]*">[\s\S]*?<\/a>/g) ?? [];

/** What web/app.js's badgeText() says for the same row: the strength on
 * any verdict, the qualifier only on an Unknown. Pinned here as a copy of
 * that function's rule rather than imported, since app.js is a browser
 * script; test/web-app-verdict-sync.test.ts guards the page's constants the
 * same way. */
const LABELS: Record<string, string> = { book: 'Book', hedged: 'Spot-covered short', looks_like_a_bet: 'Looks like a bet', unknown: 'Unknown' };
function pageBadgeText(row: (typeof rows)[number]): string {
  const base = LABELS[row.verdict.verdict] + (row.verdict.strength ? ` (${row.verdict.strength})` : '');
  return row.verdict.verdict === 'unknown' && row.badgeQualifier ? `${base} · ${row.badgeQualifier}` : base;
}

// The page names its data sources twice: under the check box and in the
// footer. A new check reads positions, orders, fills and PnL from Hyperliquid,
// balances from public nodes and funding links from Blockscout, and calls no
// Nansen API, so neither line credits Nansen as a source or links to it. The
// site still shows readings saved before, which used Nansen data, so the
// footer keeps a plain-text credit for those and no referral link.
describe('the data sources the page names', () => {
  const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const sourcesLine = page.match(/<p class="data-sources">[\s\S]*?<\/p>/)?.[0] ?? '';
  const footer = page.match(/<p class="footer-sources">[\s\S]*?<\/p>/)?.[0] ?? '';
  const HYPERLIQUID_LINK = '<a class="partner" href="https://app.hyperliquid.xyz" rel="noopener noreferrer">Hyperliquid API</a>';

  it('the footer names the source of each part of a check, and Nansen only as the source of older saved readings', () => {
    expect(footer, 'the footer paragraph must exist').not.toBe('');
    expect(textOf(footer)).toBe(
      'Positions, resting orders, fills and PnL: Hyperliquid API. ' +
        'Balances on Ethereum, Arbitrum and HyperEVM: public nodes. ' +
        'Funding links: Blockscout. ' +
        'Older saved readings also used Nansen data: Powered by Nansen API.',
    );
    // The Hyperliquid link keeps its address and attributes.
    expect(footer).toContain(HYPERLIQUID_LINK);
    // The Nansen credit is plain text: no link, no referral link, no emphasis.
    expect(footer).not.toMatch(/nansen\.ai/i);
    expect(footer).not.toContain('<strong>');
    const [checkClause, olderClause] = textOf(footer).split('Older saved readings');
    expect(checkClause).not.toMatch(/nansen/i);
    expect(olderClause).toBe(' also used Nansen data: Powered by Nansen API.');
  });

  it('the line under the check box names Hyperliquid, the public nodes and Blockscout, and not Nansen', () => {
    expect(sourcesLine, 'the data-sources line must exist').not.toBe('');
    expect(textOf(sourcesLine)).toBe('Positions, orders, fills and PnL from Hyperliquid' + 'Balances from public nodes' + 'Funding links from Blockscout');
    expect(sourcesLine).toContain(
      '<span>Positions, orders, fills and PnL from <a class="partner" href="https://app.hyperliquid.xyz" rel="noopener noreferrer">Hyperliquid</a></span>',
    );
    expect(sourcesLine).toContain('<span>Balances from public nodes</span>');
    expect(sourcesLine).toContain('<span>Funding links from Blockscout</span>');
    expect(sourcesLine).not.toMatch(/nansen/i);
  });

  it('carries no Nansen referral link anywhere on the page', () => {
    expect(page).not.toContain('app.nansen.ai');
  });

  it('has no style rule for emphasis in the footer sentence, which carries none', () => {
    expect(page).toContain('.footer-sources {');
    expect(page).not.toContain('.footer-sources strong');
  });
});

describe('the landing page examples', () => {
  it('render one badge per featured row, worded exactly as the page will reword it', () => {
    expect(badges).toHaveLength(rows.length);
    expect(badges).toEqual(rows.map(pageBadgeText));
  });

  it('keep the strength on a Book and the qualifier on an Unknown, and nothing else', () => {
    expect(badges).toContain('Book (strong)');
    expect(badges).toContain('Unknown · assets sit with funders');
    for (const badge of badges) {
      if (!badge.startsWith('Unknown')) expect(badge).not.toContain('·');
    }
  });

  it('use the same rule the page script does', () => {
    const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    expect(app).toContain("return d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base;");
  });

  it('keep every verdict label word for word, on the server and in the page script', () => {
    const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    const pageLabels = Object.fromEntries([...app.matchAll(/^\s*(\w+): \{ label: '([^']+)'/gm)].map((m) => [m[1], m[2]]));
    expect(Object.fromEntries(Object.entries(VERDICT_STYLES).map(([k, v]) => [k, v.label]))).toEqual(LABELS);
    expect(pageLabels).toEqual(LABELS);
  });
});

// As the handoff writes them ("07 Oct", "26 Sept") and en-GB has them now.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
/** "07 Oct" from "2026-10-07T15:56:28Z": the day of a reading in UTC. */
const dayOf = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const short = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

// The handoff's one card pattern (bet_or_book_redesign_handoff/README.md,
// "Position card"): verdict label, amount and asset, summary, then a footer
// with the address and date on the left and "Open" on the right. The whole
// card is the link.
describe('the landing page examples as position cards', () => {
  it('are one whole-card link per row, to that row\'s saved reading, with no other control inside', () => {
    expect(cards).toHaveLength(rows.length);
    cards.forEach((card, i) => {
      expect(card.startsWith(`<a class="card-position queue-row" href="/?s=${encodeURIComponent(rows[i].snapshotId)}">`)).toBe(true);
      expect(card.match(/<(a|button)\b/g)).toEqual(['<a']);
    });
  });

  it('hold a verdict label, the amount and asset, a summary and a footer, in that order', () => {
    expect(cards).toHaveLength(rows.length);
    cards.forEach((card, i) => {
      const row = rows[i];
      const classes = [...card.matchAll(/class="([^"]+)"/g)].map((m) => m[1]);
      expect(classes).toEqual([
        'card-position queue-row',
        `cp-verdict badge ${VERDICT_STYLES[row.verdict.verdict].cls}`,
        'cp-amount',
        'cp-asset',
        ...(row.question ? ['example-question'] : []),
        'cp-summary',
        'cp-footer',
        'cp-meta',
        'cp-open',
      ]);
      const p = row.positions;
      expect(card).toContain(`<span class="cp-amount">${formatUsd(p.headlineNotionalUsd)} <span class="cp-asset">${p.headlineCoin} ${p.headlineSide}</span></span>`);
      expect(card).toContain(`<span class="cp-summary">${row.description}</span>`);
    });
  });

  it('say whose reading it is and when in the footer: the short address and the day', () => {
    expect(cards).toHaveLength(rows.length);
    cards.forEach((card, i) => {
      const meta = card.match(/<span class="cp-footer"><span class="cp-meta">([^<]+)<\/span><span class="cp-open">Open →<\/span><\/span><\/a>$/);
      expect(meta, card).not.toBeNull();
      expect(meta![1]).toMatch(/^0x[0-9a-f]{4}\.\.\.[0-9a-f]{4} · \d{2} [A-Z][a-z]{2,3}$/);
      expect(meta![1]).toBe(`${short(rows[i].address)} · ${dayOf(rows[i].checkedAt)}`);
    });
  });

  it('keep the question a reading answers, when the row has one, as a line of its own', () => {
    const asked = landingExamples([{ ...rows[0], question: 'Is <this> a bet?' }]);
    expect(asked).toContain('<span class="example-question">Is &lt;this&gt; a bet?</span>');
    expect(asked.indexOf('class="cp-amount"')).toBeLessThan(asked.indexOf('class="example-question"'));
    expect(asked.indexOf('class="example-question"')).toBeLessThan(asked.indexOf('class="cp-summary"'));
  });

  it('show the first three in a row and fold the rest under "More evidence cases"', () => {
    const many = landingExamples([...rows, ...rows].slice(0, 5));
    const [open, folded] = many.split('<details class="fold deeper-example"><summary>More evidence cases</summary>');
    expect(open.match(/class="card-position/g)).toHaveLength(3);
    expect(folded.match(/class="card-position/g)).toHaveLength(2);
    expect(folded.endsWith('</a></details>')).toBe(true);
    expect(landingExamples(rows.slice(0, 3))).not.toContain('<details');
  });
});

// The 22.10 redesign: one set of design tokens from the owner's handoff
// (bet_or_book_redesign_handoff/README.md) and the Geist pair, served by the
// Worker itself. The page's CSP allows fonts from 'self' only, so a font
// from Google Fonts would be blocked outright, not just slower.
const PAGE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const STYLE = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
/** The style block without its comments, so a value quoted in a comment cannot pass for a declaration. */
const CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

const GEIST_FONTS = [
  { family: 'Geist', path: '/fonts/geist-sans.woff2', file: '../assets/geist-sans.woff2' },
  { family: 'Geist Mono', path: '/fonts/geist-mono.woff2', file: '../assets/geist-mono.woff2' },
] as const;

/** Every token the handoff names, at its value there - except the two grays
 * for meta text and placeholders, lightened from #6B707D and #5E6370 so they
 * reach 4.5:1 (the test below holds them to that). */
const TOKENS: Record<string, string> = {
  '--bg': '#0B0C10',
  '--surface': '#12141A',
  '--surface-inset': '#0F1116',
  '--border': '#1F222B',
  '--border-strong': '#262A35',
  '--border-hover': '#353A48',
  '--rule': '#1C1F27',
  '--text': '#ECEDF2',
  '--text-2': '#C4C8D2',
  '--text-muted': '#A3A8B5',
  '--text-faint': '#808593',
  '--placeholder': '#7C8190',
  '--accent': '#8F9BFF',
  '--accent-hover': '#A7B1FF',
  '--on-accent': '#0B0C10',
  '--verdict-bet': 'oklch(0.82 0.14 75)',
  '--verdict-hedged': 'oklch(0.8 0.14 155)',
  '--verdict-unknown': '#8A8F9C',
  '--verdict-book': 'oklch(0.78 0.12 270)',
  '--danger': 'oklch(0.75 0.15 25)',
};

/** The value a custom property is given in the :root rule. */
function rootToken(name: string): string | undefined {
  const root = /:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  const escaped = name.replace(/[-]/g, '\\-');
  return new RegExp(`(?<![\\w-])${escaped}\\s*:\\s*([^;]+);`).exec(root)?.[1].trim();
}

/** WCAG 2 contrast ratio of two #RRGGBB colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the page stylesheet', () => {
  it('declares Geist and Geist Mono as self-hosted woff2, swapped in once loaded', () => {
    const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const { family, path } of GEIST_FONTS) {
      const face = faces.find((f) => new RegExp(`font-family\\s*:\\s*(["']?)${family}\\1\\s*;`).test(f));
      expect(face, `no @font-face for ${family}`).toBeDefined();
      expect(face).toMatch(new RegExp(`url\\((["']?)${path.replace(/[./]/g, '\\$&')}\\1\\)\\s*format\\((["'])woff2\\2\\)`));
      expect(face).toMatch(/font-display\s*:\s*swap\s*;/);
    }
  });

  it('asks no other origin for anything', () => {
    expect(PAGE).not.toContain('fonts.googleapis.com');
    expect(PAGE).not.toContain('fonts.gstatic.com');
    expect(STYLE).not.toMatch(/https?:/i);
  });

  it('sets the text in Geist and the mono text in Geist Mono', () => {
    expect(rootToken('--font-sans')).toMatch(/^"Geist",/);
    expect(rootToken('--font-mono')).toMatch(/^"Geist Mono",/);
    expect(CSS).toMatch(/\bbody\s*\{[^}]*font-family\s*:\s*var\(--font-sans\)/);
  });

  it('defines every design token at the handoff value', () => {
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(rootToken(name)?.toLowerCase(), name).toBe(value.toLowerCase());
    }
  });

  it('keeps meta text and placeholders at 4.5:1 or better on the backgrounds they sit on', () => {
    const backgrounds = ['--bg', '--surface', '--surface-inset'].map((name) => TOKENS[name]);
    for (const fg of ['--text-faint', '--placeholder']) {
      for (const bg of backgrounds) {
        expect(contrast(TOKENS[fg], bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Meta text also sits on a hovered row; inputs never take that color.
    expect(contrast(TOKENS['--text-faint'], '#1A1D25')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the fonts the page loads', () => {
  for (const { path, file } of GEIST_FONTS) {
    it(`answers ${path} with the woff2 file itself`, async () => {
      const res = await worker.fetch(request(path), testEnv());
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('font/woff2');
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.equals(readFileSync(new URL(file, import.meta.url)))).toBe(true);
      expect(body.subarray(0, 4).toString('latin1')).toBe('wOF2');
    });
  }

  it('still serves the Inter fonts the picture renderer draws with', async () => {
    const res = await worker.fetch(request('/fonts/inter-regular.woff'), testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff');
  });

  it('are bundled by Wrangler as raw bytes', () => {
    // Wrangler applies only the first rule of each type unless that rule says
    // `fallthrough = true`; a second Data rule just for .woff2 was ignored and
    // the build failed on the import. Only `test:runtime` builds with Wrangler,
    // so this holds the rule here as well.
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const rules = [...toml.matchAll(/\{\s*type\s*=\s*"(\w+)"\s*,\s*globs\s*=\s*\[([^\]]*)\]\s*,\s*fallthrough\s*=\s*(true|false)\s*\}/g)]
      .map((m) => ({ type: m[1], globs: [...m[2].matchAll(/"([^"]+)"/g)].map((g) => g[1]), fallthrough: m[3] === 'true' }));
    const effective: string[] = [];
    for (const rule of rules.filter((r) => r.type === 'Data')) {
      effective.push(...rule.globs);
      if (!rule.fallthrough) break;
    }
    expect(effective).toContain('**/*.woff2');
  });

  it('answers any other font path with a 404', async () => {
    const res = await worker.fetch(request('/fonts/geist-sans-latin.woff2'), testEnv());
    expect(res.status).toBe(404);
  });
});

// The Check screen of the handoff ("Screens > 1. Check (home)"): the hero
// with the address field, the examples, then how it works. Everything the
// screen did before that has no place in the handoff is still on it.
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
/** The opening tag of the element with this id. */
const tagOf = (id: string) => PAGE.match(new RegExp(`<\\w+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
/** An element's markup from its opening tag to the first closing tag of its kind. */
function elementOf(id: string): string {
  const open = tagOf(id);
  const tag = open.match(/^<(\w+)/)?.[1];
  const start = PAGE.indexOf(open);
  return tag && start !== -1 ? PAGE.slice(start, PAGE.indexOf(`</${tag}>`, start) + tag.length + 3) : '';
}
/** The Check screen's own markup: from the hero to the examples, where the
 * reading's skeleton (#reading-nav, #card) begins, plus the how-it-works
 * section after it. The reading's own heading and buttons are not part of it. */
const CHECK = PAGE.slice(PAGE.indexOf('<div id="entry-controls">'), PAGE.indexOf(tagOf('reading-nav'))) + elementOf('how-it-works');

describe('the Check screen', () => {
  it('is measured on its own markup, not the reading drawn in the same workspace', () => {
    expect(CHECK).toContain('id="hero-title"');
    expect(CHECK).toContain('id="player-queue"');
    expect(CHECK).toContain('id="how-it-works"');
    for (const id of ['reading-nav', 'card', 'headline']) expect(CHECK, id).not.toContain(`id="${id}"`);
  });

  it('has one h1, the hero headline in the owner\'s casing, with "Copytrading." in the accent color', () => {
    expect(CHECK.match(/<h1\b/g)).toHaveLength(1);
    expect(elementOf('hero-title')).toBe('<h1 id="hero-title" tabindex="-1">Don\'t Get Rekt <span>Copytrading.</span></h1>');
    expect(CSS).toMatch(/\.hero h1 span\s*\{[^}]*color:\s*var\(--accent\)/);
  });

  it('opens with the eyebrow and keeps the lead sentence', () => {
    const hero = CHECK.slice(0, CHECK.indexOf('</section>'));
    expect(hero).toContain('<p class="eyebrow">Look beyond the whale alert</p>');
    expect(textOf(hero)).toContain("Saw a whale's $200M short? Check before you follow. Find out what the data shows: a directional bet, a hedge, or a market maker's inventory.");
  });

  it('asks for the address in the handoff\'s words, with a label for screen readers', () => {
    const input = tagOf('address');
    expect(input).toMatch(/^<input\b/);
    expect(input).toContain('placeholder="Paste a Hyperliquid wallet address or link"');
    expect(input).toContain('aria-describedby="address-help"');
    expect(PAGE).toMatch(/<label class="visually-hidden" for="address">Check a Hyperliquid wallet<\/label>/);
    expect(CSS).toMatch(/\.visually-hidden\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    expect(textOf(elementOf('check'))).toBe('Check position');
    expect(textOf(elementOf('address-help'))).toBe('Address, Hypurrscan or Hyperliquid link · No wallet connection');
  });

  it('keeps what the screen did before: the alert help, the address choice, progress, the guess, recent checks, the sources', () => {
    for (const id of ['address-choices', 'address-choice-buttons', 'status', 'check-progress', 'slow-check', 'waiting-example', 'guess', 'guess-chips', 'recent', 'recent-chips', 'use-example']) {
      expect(CHECK, id).toContain(`id="${id}"`);
    }
    expect(CHECK).toContain('<summary>Checking a whale alert?</summary>');
    expect(CHECK).toMatch(/<p class="data-sources">[\s\S]*Hyperliquid[\s\S]*public nodes[\s\S]*Blockscout[\s\S]*?<\/p>/);
  });

  it('heads the examples with the handoff copy and one secondary button to all of them', () => {
    const examples = elementOf('examples');
    expect(textOf(elementOf('examples-title'))).toBe('Big positions. Different stories.');
    expect(textOf(elementOf('examples-status'))).toBe('Saved readings - opening one is free.');
    expect(examples).toMatch(/<a class="btn-secondary" href="#explore" id="search-explore">All examples →<\/a>/);
    expect(examples).toContain('<div id="player-queue"><!--FEATURED_EXAMPLES--></div>');
    // One primary action on the screen: the check itself.
    const primaries = [...CHECK.matchAll(/\bclass="([^"]*)"/g)].filter((m) => m[1].split(/\s+/).includes('btn'));
    expect(primaries).toEqual([]);
  });

  it('lays the cards out in a wrapping row, 260 px each at the least, 16 px apart', () => {
    expect(CSS).toMatch(/#player-queue\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*16px/);
    expect(CSS).toMatch(/#player-queue > \.card-position\s*\{[^}]*flex:\s*1 1 260px/);
  });

  it('ends with how it works: three numbered steps under "From a headline to the evidence"', () => {
    const steps = elementOf('how-it-works');
    expect(textOf(steps).startsWith('From a headline to the evidence')).toBe(true);
    expect([...steps.matchAll(/<span class="step-number">(\d+)<\/span>/g)].map((m) => m[1])).toEqual(['01', '02', '03']);
    expect(PAGE.indexOf('id="how-it-works"')).toBeGreaterThan(PAGE.indexOf('id="examples"'));
  });

  it('keeps the way into Explore at the bottom, as a quiet line rather than a second panel', () => {
    expect(PAGE).toMatch(/<div class="explore-entry" id="explore-entry">/);
    expect(tagOf('explore-link')).toMatch(/^<a\b[^>]*href="#explore"/);
    expect(CSS).not.toMatch(/\.explore-entry[^{]*\{[^}]*background/);
  });

  it('hides the whole Check block while a reading shows, rather than shrinking the hero', () => {
    expect(CSS).not.toMatch(/body\.has-reading \.hero/);
    for (const id of ['entry-controls', 'examples', 'how-it-works', 'recent']) {
      expect(CSS, id).toMatch(new RegExp(`body\\.has-reading #${id}\\b[^{]*\\{[^}]*display:\\s*none`));
    }
  });
});
