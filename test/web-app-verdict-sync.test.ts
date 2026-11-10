import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/engine/verdict';
import { madeWithExplorer } from '../src/engine/evidence';
import { extractPageFunction } from './support/pageScript';

describe("the live board filter uses the classifier coverage boundary", () => {
  it('MATERIAL_GAP_SHARE in web/app.js matches DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare', () => {
    const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
    const materialGap = source.match(/const MATERIAL_GAP_SHARE = ([\d.]+);/);
    expect(materialGap).not.toBeNull();
    const explore = readFileSync(new URL('../web/explore.js', import.meta.url), 'utf8');
    expect(explore).toContain("e.hedgeRatio < MATERIAL_GAP_SHARE");
    expect(Number(materialGap![1])).toBe(DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare);
  });
});

// web/app.js is a browser module (it imports from ./constellation.js and the
// like), so it cannot be loaded here. The two pieces of source wording that
// say where a reading's positions came from are plain functions of the
// reading; they are cut out of the file as written and run, rather than
// matched as text, so these tests hold the sentences a reader sees.
const appSource = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
function pageFunction<T>(name: string): T {
  const found = appSource.match(new RegExp(String.raw`function ${name}\([^)]*\) \{[\s\S]*?\r?\n\}\r?\n`));
  expect(found, `${name} must be a top-level function in web/app.js`).not.toBeNull();
  return new Function(`${found![0]}\nreturn ${name};`)() as T;
}
type Reading = Record<string, unknown>;
const sourceWarning = (d: Reading) => pageFunction<(d: Reading) => { text: string; unavailable: boolean }>('sourceWarning')(d);
const positionsSource = (d: Reading) => pageFunction<(d: Reading) => string>('positionsSource')(d);

describe('the page says where a reading\'s positions came from', () => {
  it('the degraded-source warning no longer claims the main dex only', () => {
    const readings: Reading[] = [
      { source: 'hyperliquid', coverage: [] },
      { source: 'nansen', coverage: [] },
      { source: 'hyperliquid', coverage: ['Nansen not used (no API key configured): no balances on other chains, no linked wallets'] },
      { source: 'hyperliquid', coverage: ['Nansen did not answer this time. This reading is Hyperliquid-only. Try again in a minute.'] },
    ];
    for (const d of readings) {
      expect(sourceWarning(d).text).not.toMatch(/main dex|main venue|other venues/);
    }
    // A reading stored before positionsVenues existed: 'hyperliquid' then meant
    // Nansen was asked and did not supply the positions, so it keeps the sentence.
    expect(sourceWarning({ source: 'hyperliquid', coverage: [] })).toEqual({
      text: 'Hyperliquid positions only · balances on other chains and linked wallets could not be read.',
      unavailable: false,
    });
    expect(sourceWarning({ source: 'nansen' }).text).toBe('Incomplete reading · some sources could not be read.');
    // The one place the page still says "main dex" is the meta line, for a
    // reading stored before positions came from every dex (true of it) and
    // for one whose list of dexes could not be read (only the main dex was).
    expect(appSource).not.toMatch(/main venue/);
    const withoutMetaLine = appSource.replace(/function positionsSource\([^)]*\) \{[\s\S]*?\r?\n\}\r?\n/, '');
    expect(withoutMetaLine).not.toContain('main dex');
  });

  it('does not say Nansen data could not be read for a reading that never asked Nansen', () => {
    // Every check the site starts asks with context=0, so a long (or a short
    // with book signals) never calls Nansen and is stored with source
    // 'hyperliquid'. When such a reading is degraded for another reason, the
    // reason is the note about that, not a claim about a read that never ran.
    const venues = { asked: 11, answered: 10, registryRead: true };
    const dexNote = 'Positions on the flx dex could not be read; positions held there are not in this reading.';
    expect(
      sourceWarning({
        source: 'hyperliquid',
        positionsVenues: venues,
        coverage: [dexNote],
        coverageNotes: [{ text: dexNote, failure: true }],
      }),
    ).toEqual({ text: dexNote, unavailable: false });
    // The first note that says something failed, not a remark that came before it.
    expect(
      sourceWarning({
        source: 'hyperliquid',
        positionsVenues: venues,
        coverage: ['Funding history unavailable', dexNote, 'Another note'],
        coverageNotes: [
          { text: 'Funding history unavailable', failure: false },
          { text: dexNote, failure: true },
          { text: 'Another note', failure: true },
        ],
      }).text,
    ).toBe(dexNote);
    // Nothing in the notes says what failed: the generic line, not a guess.
    expect(
      sourceWarning({
        source: 'hyperliquid',
        positionsVenues: venues,
        coverage: ['Funding history unavailable'],
        coverageNotes: [{ text: 'Funding history unavailable', failure: false }],
      }),
    ).toEqual({ text: 'Incomplete reading · some sources could not be read.', unavailable: false });
    expect(sourceWarning({ source: 'hyperliquid', positionsVenues: venues, coverage: [] }).text).toBe(
      'Incomplete reading · some sources could not be read.',
    );
    // The same holds when Nansen did supply something and the reading is degraded for another reason.
    expect(
      sourceWarning({
        source: 'nansen',
        positionsVenues: venues,
        coverage: [dexNote],
        coverageNotes: [{ text: dexNote, failure: true }],
      }).text,
    ).toBe(dexNote);
  });

  it('still shows the Nansen note for a reading that has positionsVenues', () => {
    const venues = { asked: 11, answered: 11, registryRead: true };
    const dexNote = 'Positions on the flx dex could not be read; positions held there are not in this reading.';
    const partway = 'Nansen stopped partway (a read failed): some balances on other chains or links between wallets were not read';
    expect(
      sourceWarning({
        source: 'nansen',
        positionsVenues: venues,
        coverage: [dexNote, partway],
        coverageNotes: [
          { text: dexNote, failure: true },
          { text: partway, failure: true },
        ],
      }),
    ).toEqual({ text: partway, unavailable: false });
    // The unavailable override keeps working where the Nansen note matches.
    const result = sourceWarning({
      source: 'hyperliquid',
      positionsVenues: venues,
      coverage: ['Nansen not used (no API key configured): no balances on other chains, no linked wallets'],
      coverageNotes: [{ text: 'Nansen not used (no API key configured): no balances on other chains, no linked wallets', failure: true }],
    });
    expect(result.unavailable).toBe(true);
    expect(result.text).toMatch(/^Full live coverage is temporarily unavailable\./);
    // A failure note that merely mentions credits is not the Nansen note: no override.
    expect(
      sourceWarning({
        source: 'hyperliquid',
        positionsVenues: venues,
        coverage: ['Credits for the day were used by another read'],
        coverageNotes: [{ text: 'Credits for the day were used by another read', failure: true }],
      }),
    ).toEqual({ text: 'Credits for the day were used by another read', unavailable: false });
  });

  it('says in the unavailable case that it covers Hyperliquid positions only, and what was not read', () => {
    for (const reason of ['no API key configured', "today's Nansen credits are used up", 'credit budget exhausted']) {
      const result = sourceWarning({
        source: 'hyperliquid',
        coverage: [`Nansen not used (${reason}): no balances on other chains, no linked wallets`],
      });
      expect(result.unavailable).toBe(true);
      expect(result.text).toBe(
        'Full live coverage is temporarily unavailable. This reading covers Hyperliquid positions only; ' +
          'balances on other chains and linked wallets were not read, so it does not settle the wallet’s exposure.',
      );
    }
  });

  it('does not say balances on other chains were not read when public nodes read them (known-tokens)', () => {
    for (const reason of ['no API key configured', "today's Nansen credits are used up", 'credit budget exhausted']) {
      const result = sourceWarning({
        source: 'hyperliquid',
        hedgeScope: 'known-tokens',
        coverage: [`Nansen not used (${reason}): no linked wallets`],
      });
      expect(result.unavailable).toBe(true);
      expect(result.text).toBe(
        'Full live coverage is temporarily unavailable. Linked wallets were not read, so this reading does not settle ' +
          'the wallet’s exposure.',
      );
    }
    // Any other scope keeps the sentence it was saved with.
    for (const hedgeScope of ['hyperliquid', 'all-chains', 'none', undefined]) {
      expect(
        sourceWarning({ source: 'hyperliquid', hedgeScope, coverage: ['Nansen not used (no API key configured): no linked wallets'] }).text,
      ).toMatch(/^Full live coverage is temporarily unavailable\. This reading covers Hyperliquid positions only; /);
    }
  });

  it('shows the source note itself for a Nansen read that did not answer, did not finish or stopped partway', () => {
    const notes = [
      'Nansen did not answer this time. This reading is Hyperliquid-only: balances on other chains, PnL and funding links may be missing. Try again in a minute.',
      'Nansen could not complete every read this time. Some PnL, holdings or funding links may be missing. Try again in a minute.',
      'Nansen stopped partway (a read failed): some balances on other chains or links between wallets were not read',
    ];
    for (const note of notes) {
      const result = sourceWarning({ source: 'nansen', coverage: ['Funding history unavailable', note] });
      expect(result).toEqual({ text: note, unavailable: false });
    }
  });

  it('keeps the stopped-partway sentence when the meter is the reason, rather than saying nothing was read', () => {
    const note = "Nansen stopped partway (today's Nansen credits are used up): some balances on other chains or links between wallets were not read";
    const result = sourceWarning({ source: 'nansen', coverage: [note] });
    expect(result.text).toBe(note);
    // The reader is still told the free examples are the way to a full reading.
    expect(result.unavailable).toBe(true);
  });

  it('reading meta names Hyperliquid as the source of positions for a reading with positionsVenues', () => {
    const venues = { asked: 6, answered: 5, registryRead: true };
    expect(positionsSource({ source: 'nansen', positionsVenues: venues })).toBe('positions from Hyperliquid, 5 of 6 dexes');
    expect(positionsSource({ source: 'hyperliquid', positionsVenues: venues })).toBe('positions from Hyperliquid, 5 of 6 dexes');
    // Only the main dex exists on the list that was read: complete, in the singular.
    expect(positionsSource({ source: 'hyperliquid', positionsVenues: { asked: 1, answered: 1, registryRead: true } })).toBe(
      'positions from Hyperliquid, 1 of 1 dex',
    );
  });

  it('does not let a reading whose list of dexes failed to load read as complete', () => {
    // asked is 1 there because nothing else was known to ask, not because there is nothing else.
    const unread = { asked: 1, answered: 1, registryRead: false };
    expect(positionsSource({ source: 'hyperliquid', positionsVenues: unread })).toBe(
      'positions from Hyperliquid, main dex only (dex list not read)',
    );
    expect(positionsSource({ source: 'nansen', positionsVenues: unread })).toBe(
      'positions from Hyperliquid, main dex only (dex list not read)',
    );
  });

  it('keeps the old wording for a reading stored before positionsVenues', () => {
    expect(positionsSource({ source: 'nansen' })).toBe('positions from Nansen');
    expect(positionsSource({ source: 'hyperliquid' })).toBe('positions from Hyperliquid main dex');
  });

  it('does not tell a reader who starts a check that the positions or the balances are read from Nansen', () => {
    expect(appSource).not.toContain('Reading positions from Nansen');
    expect(appSource).not.toContain('other chains from Nansen');
    // A check made now asks Blockscout for the wallet links, not Nansen.
    expect(appSource).toContain(
      "const doing = method === 'POST' ? 'Reading positions and orders from Hyperliquid, balances from public nodes, wallet links from Blockscout...'",
    );
    expect(appSource).not.toContain('wallet links from Nansen');
  });

  it('shows a Nansen note about what it supplied in the banner, not only the generic line', () => {
    expect(appSource).toMatch(/Nansen not used\|Nansen stopped partway\|Nansen did not answer\|Nansen could not complete/);
  });
});

// What the page credits as the source of a share, a downloaded card and a
// reading's own meta line. The server works the strings out from the sources
// the reading used (src/engine/attribution.ts) and the page shows them; a
// reading saved before that carries no `attribution`, and the page falls back
// to the rule it always had, which goes by `source`.
const shareCardSource = readFileSync(new URL('../web/share-card.js', import.meta.url), 'utf8');
function run<T>(source: string, names: string[], expression: string): T {
  const body = names.map((n) => extractPageFunction(source, n)).join('\n') + `\nreturn ${expression};`;
  return new Function(body)() as T;
}
const attribution = { publisher: 'Data: Hyperliquid API, public nodes, Blockscout', post: 'Data: Hyperliquid, public nodes, Blockscout', card: 'Data: Hyperliquid API, public nodes, Blockscout' };
const postCredit = (d: Reading) => run<(d: Reading) => string>(appSource, ['postCredit'], 'postCredit')(d);
const cardCredit = (d: Reading) => run<(d: Reading) => string>(shareCardSource, ['cardCredit'], 'cardCredit')(d);

describe('the credit on a share, the post text and the downloaded card', () => {
  it('shows what the server worked out for a reading that carries it', () => {
    expect(postCredit({ source: 'hyperliquid', attribution })).toBe('Data: Hyperliquid, public nodes, Blockscout');
    expect(cardCredit({ source: 'hyperliquid', attribution })).toBe('Data: Hyperliquid API, public nodes, Blockscout');
    // The server's word wins over `source`, whichever it is.
    expect(postCredit({ source: 'nansen', attribution: { ...attribution, post: 'Powered by @nansen_ai' } })).toBe('Powered by @nansen_ai');
  });

  it('falls back to the rule by source for a response without attribution (a reading saved before)', () => {
    expect(postCredit({ source: 'nansen' })).toBe('Powered by @nansen_ai');
    expect(postCredit({ source: 'hyperliquid' })).toBe('Data: Hyperliquid');
    expect(cardCredit({ source: 'nansen' })).toBe('Powered by Nansen API');
    expect(cardCredit({ source: 'hyperliquid' })).toBe('Data: Hyperliquid API');
  });

  it('falls back too when the field is not the shape the page expects', () => {
    for (const bad of [null, 'Powered by Nansen API', {}, { post: 7, card: 7 }, { post: '', card: '' }]) {
      expect(postCredit({ source: 'nansen', attribution: bad })).toBe('Powered by @nansen_ai');
      expect(cardCredit({ source: 'hyperliquid', attribution: bad })).toBe('Data: Hyperliquid API');
    }
  });

  it('hands the share text and the card exactly that credit', () => {
    expect(appSource).toMatch(/attribution: postCredit\(d\),/);
    expect(shareCardSource).toContain('const credit = cardCredit(d);');
    expect(shareCardSource).toMatch(/ctx\.fillText\(credit, W - 56, /);
  });
});

describe('the meta line says how many Nansen calls a reading took only where Nansen could have been asked', () => {
  const callsNote = (d: Reading) => run<(d: Reading) => string>(appSource, ['plural', 'nansenCallsNote'], 'nansenCallsNote')(d);

  it('prints nothing about Nansen for a reading made without it', () => {
    expect(callsNote({ source: 'hyperliquid', nansenCalls: 0 })).toBe('');
    expect(callsNote({ source: 'hyperliquid' })).toBe('');
  });

  it('keeps the line exactly for a reading made with Nansen, including one that records no calls', () => {
    expect(callsNote({ source: 'nansen', nansenCalls: 4 })).toBe(' · 4 Nansen API calls');
    expect(callsNote({ source: 'nansen', nansenCalls: 1 })).toBe(' · 1 Nansen API call');
    expect(callsNote({ source: 'nansen', nansenCalls: 0 })).toBe(' · 0 Nansen API calls');
  });

  it('keeps the line for an older reading that is not credited to Nansen but did make calls', () => {
    expect(callsNote({ source: 'hyperliquid', nansenCalls: 2 })).toBe(' · 2 Nansen API calls');
  });
});

describe('the page credits the source of the linked wallets by what the reading used', () => {
  // The same rule the server uses (src/engine/evidence.ts, madeWithExplorer): a reading made since the
  // links moved to the explorer is one whose scope is known-tokens, or one that carries positionsVenues
  // and a source other than Nansen. Anything else took its links from Nansen, whatever `source` says.
  const fundersCredit = (d: Reading) => run<(d: Reading) => string>(appSource, ['madeWithExplorer', 'fundersCredit'], 'fundersCredit')(d);
  const elsewhereSource = (d: Reading) => run<(d: Reading) => string>(appSource, ['madeWithExplorer', 'elsewhereSource'], 'elsewhereSource')(d);
  const VENUES = { asked: 11, answered: 11, registryRead: true };
  const NANSEN_SENTENCE = 'Linked wallets: Powered by Nansen API. Funding links are observed; common ownership is unverified.';
  const EXPLORER_SENTENCE = 'Linked wallets: Blockscout (funding links) and public nodes (balances). Funding links are observed; common ownership is unverified.';

  it('keeps the Nansen sentence for a reading made with Nansen, exactly', () => {
    expect(fundersCredit({ source: 'nansen' })).toBe('Linked wallets: Powered by Nansen API. Funding links are observed; common ownership is unverified.');
    expect(elsewhereSource({ source: 'nansen' })).toBe('Nansen · ownership unverified');
  });

  it('prints it under the list of funders, in a paragraph the page fills in, not as fixed Nansen text', () => {
    const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(appSource).toContain("$('funders-credit').textContent = fundersCredit(d);");
    expect(html).toMatch(/<p class="attribution" id="funders-credit">[^<]*<\/p>/);
    expect(html.match(/<p class="attribution" id="funders-credit">([^<]*)<\/p>/)![1]).not.toMatch(/nansen/i);
    expect(appSource).toContain('source: elsewhereSource(d),');
    expect(appSource).not.toContain("source: 'Nansen · ownership unverified'");
  });

  it('names the explorer and the public nodes for a reading made without Nansen', () => {
    for (const d of [
      { source: 'hyperliquid', hedgeScope: 'known-tokens' },
      { source: 'hyperliquid', hedgeScope: 'hyperliquid', positionsVenues: VENUES },
      { source: 'hyperliquid', hedgeScope: 'none', positionsVenues: VENUES },
    ]) {
      expect(fundersCredit(d), JSON.stringify(d)).toBe(EXPLORER_SENTENCE);
      expect(elsewhereSource(d), JSON.stringify(d)).toBe('Explorer + On-chain · ownership unverified');
    }
  });

  it('keeps the Nansen credit for an old reading whose source says hyperliquid but whose funders came from Nansen', () => {
    // The old Worker set `source` to nansen only when the Nansen positions call succeeded; the balances
    // and the funder lookup ran on their own. Such a reading has no positionsVenues and no known-tokens scope.
    for (const hedgeScope of ['all-chains', 'hyperliquid']) {
      const d = { source: 'hyperliquid', hedgeScope };
      expect(fundersCredit(d), hedgeScope).toBe(NANSEN_SENTENCE);
      expect(elsewhereSource(d), hedgeScope).toBe('Nansen · ownership unverified');
    }
  });

  it('keeps the Nansen credit for a reading whose source is nansen even when it carries positionsVenues', () => {
    expect(fundersCredit({ source: 'nansen', hedgeScope: 'all-chains', positionsVenues: VENUES })).toBe(NANSEN_SENTENCE);
    expect(elsewhereSource({ source: 'nansen', hedgeScope: 'all-chains', positionsVenues: VENUES })).toBe('Nansen · ownership unverified');
  });
});

// Copy that described the credit meter and the demo reserve, which are gone: a
// check no longer draws on a shared data budget, and the operator key lets
// checks from one browser past the rate limits, which is all it does.
describe('no page copy promises a reserve or a data budget that no longer exists', () => {
  const monitor = readFileSync(new URL('../web/monitor.js', import.meta.url), 'utf8');
  const pilot = readFileSync(new URL('../src/pilotWatch.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  it('says the operator key bypasses the rate limits, and nothing about a demo reserve', () => {
    expect(appSource).not.toMatch(/demo reserve/i);
    expect(appSource).toContain('Operator key accepted: checks from this browser bypass the rate limits.');
    expect(appSource).toContain('Operator key for this browser: it lets its checks bypass the rate limits.');
  });

  it('names the rate limits, not a data budget, as what can pause a monitor or a context check', () => {
    for (const [name, text] of [['index.html', html], ['monitor.js', monitor], ['pilotWatch.ts', pilot]] as const) {
      expect(text, name).not.toMatch(/data budget/i);
    }
    expect(monitor).toContain('Scheduled · about every 4 hours; shared rate limits can pause checks');
    expect(pilot).toContain("status: 'Scheduled; shared rate limits can pause checks'");
    expect(html).toContain('Alerts appear on the card; the shared rate limits can pause checks.');
    expect(html).toContain('Counts as a new check against the rate limits.');
  });

  it('does not tell a crawler that a page load spends a Nansen credit', () => {
    expect(html).not.toMatch(/Nansen credit/i);
  });
});

// madeWithExplorer lives twice: in src/engine/evidence.ts (the Worker's rule for the Linked wallets row and
// for the credit line) and in web/app.js (the page's rule for the funders credit and the Held elsewhere
// tile), because the page script is bundled for the browser without src/. Two copies are tied only by
// being equal, so this evaluates both over one table of inputs and fails on the first difference.
describe('the two copies of madeWithExplorer', () => {
  const pageCopy = run<(d: Reading) => boolean>(appSource, ['madeWithExplorer'], 'madeWithExplorer');
  const VENUES = { asked: 11, answered: 11, registryRead: true };
  const scopes = ['known-tokens', 'all-chains', 'hyperliquid', 'none'] as const;
  const venues = [undefined, VENUES] as const;
  const sources = ['nansen', 'hyperliquid'] as const;
  const table = scopes.flatMap((hedgeScope) =>
    venues.flatMap((positionsVenues) => sources.map((source) => ({ hedgeScope, positionsVenues, source }))),
  );

  it('answers alike on every combination of scope, positionsVenues and source', () => {
    expect(table).toHaveLength(16);
    for (const input of table) {
      expect(pageCopy(input), JSON.stringify(input)).toBe(madeWithExplorer(input));
    }
  });

  it('is not the same constant twice: the table holds both answers, and the rule it pins is the ruled one', () => {
    const answers = table.map((input) => madeWithExplorer(input));
    expect(answers).toContain(true);
    expect(answers).toContain(false);
    // known-tokens, or positionsVenues with a source other than Nansen.
    for (const input of table) {
      const ruled = input.hedgeScope === 'known-tokens' || (input.positionsVenues !== undefined && input.source !== 'nansen');
      expect(pageCopy(input), JSON.stringify(input)).toBe(ruled);
    }
  });

  it('treats a reading stored without the fields the way the server does', () => {
    for (const input of [{}, { source: 'hyperliquid' }, { hedgeScope: 'none' }, { source: 'nansen', positionsVenues: VENUES }]) {
      expect(pageCopy(input), JSON.stringify(input)).toBe(madeWithExplorer(input as unknown as Parameters<typeof madeWithExplorer>[0]));
    }
  });
});
