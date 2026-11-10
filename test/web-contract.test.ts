import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the page scripts depend on in web/index.html, pinned so a rewrite of
 * the markup or the stylesheet cannot silently lose it.
 *
 * - Every element id a script reads has to exist in the markup, or the
 *   script throws on `null` the moment the page loads or a reading opens.
 * - Every CSS class a script (or the server-side example cards in
 *   src/landing.ts) puts on an element has to have a rule in the <style>
 *   block, or the element quietly renders unstyled.
 *
 * Discovery is done with regular expressions over the source text, so the
 * helpers below know the few shapes the scripts use: `$('id')`,
 * `getElementById('id')`, `querySelector('#id')`, `el(tag, 'a b')`,
 * `className = '...'`, `classList.add/toggle('...')`, `class="..."` in
 * template strings, and the `cls: '...'` verdict tables.
 */

const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const PAGE = text('../web/index.html');
// Every script the page runs, read as source. app.min.js is a build output of
// these files, so it is left out.
const SCRIPTS = readdirSync(new URL('../web/', import.meta.url))
  .filter((file) => file.endsWith('.js') && !file.endsWith('.min.js'))
  .sort()
  .map((file) => ({ file: `web/${file}`, source: text(`../web/${file}`) }));

type Places = Map<string, Set<string>>;
function note(places: Places, name: string, where: string): void {
  const set = places.get(name) ?? new Set<string>();
  set.add(where);
  places.set(name, set);
}
const describeNames = (names: string[], places: Places) =>
  names.map((name) => `${name} (${[...(places.get(name) ?? [])].join(', ')})`).join(', ');

/** Ids that the scripts create themselves, so they are NOT in index.html. */
const SCRIPT_CREATED_IDS: Record<string, string> = {
  // web/app.js renderResult(): the one-line "You guessed ..." answer is built
  // with el('p', 'guess-result'), given this id, and removed on the next card.
  'guess-result': 'created by web/app.js renderResult()',
};

/**
 * Ids that web/app.js builds by string concatenation from a table, so no
 * `$('literal')` shows them to the regular expressions. selectExploreView()
 * runs `$(panel)` and `$('explore-' + key)` over exactly this table.
 */
const EXPLORE_VIEWS = [
  ['cases', 'case-studies'],
  ['ranked', 'boards-fold'],
  ['all', 'all-readings'],
  ['archive', 'archive'],
] as const;
const RUNTIME_BUILT_IDS = EXPLORE_VIEWS.flatMap(([key, panel]) => [`explore-${key}`, panel]);

/** Classes that are emitted but deliberately have no rule of their own. */
const CLASSES_WITHOUT_OWN_RULE: Record<string, string> = {
  // Empty today: every class the scripts and src/landing.ts emit, state-only
  // ones such as `exploring`, `has-reading`, `historical` and `decisive`
  // included, has a rule in the style block. Add a class here, with the
  // reason, only if a redesign drops its rule on purpose.
};

/** Splits the arguments of the call whose opening parenthesis is at `open`. */
function callArguments(source: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote = '';
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) { args.push(source.slice(start, i)); return args; }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** The string literals in a JS/TS expression: `'badge ' + c + (h ? ' historical' : '')` gives ['badge ', ' historical']. */
function stringLiterals(expression: string): string[] {
  const out: string[] = [];
  for (const m of expression.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? (m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '));
  }
  return out;
}

/** Class names out of pieces of text such as ['badge ', ' historical']. */
const classTokens = (pieces: string[]) =>
  pieces.join(' ').split(/\s+/).filter((token) => /^-?[A-Za-z_][\w-]*$/.test(token));

/** Selector strings handed to querySelector, querySelectorAll, closest and matches. */
function selectorsIn(source: string): string[] {
  return [...source.matchAll(/(?:querySelector(?:All)?|closest|matches)\(\s*(['"])(.*?)\1/g)].map((m) => m[2]);
}

/** Element ids the page scripts read, with the files that read them. */
function idsUsedByScripts(): Places {
  const used: Places = new Map();
  for (const { file, source } of SCRIPTS) {
    // `$` is the helper from web/app.js (document.getElementById), also passed
    // into explore.js and share-card.js under the same name.
    for (const m of source.matchAll(/(?<![\w$.])\$\(\s*(['"])([\w-]+)\1\s*\)/g)) note(used, m[2], file);
    for (const m of source.matchAll(/getElementById\(\s*(['"])([\w-]+)\1\s*\)/g)) note(used, m[2], file);
    for (const selector of selectorsIn(source)) {
      for (const m of selector.matchAll(/#([\w-]+)/g)) note(used, m[1], file);
    }
  }
  for (const id of RUNTIME_BUILT_IDS) note(used, id, 'web/app.js selectExploreView()');
  return used;
}

/** CSS classes the scripts and the server-side example cards put on elements, with where each comes from. */
function classesEmitted(): Places {
  const emitted: Places = new Map();
  const addAll = (names: string[], where: string) => names.forEach((name) => note(emitted, name, where));
  const fromMarkup = (source: string, where: string) => {
    for (const m of source.matchAll(/\bclass=\\?(["'])([^"'\\]*)\\?\1/g)) {
      // `badge ${cls}` keeps `badge`; the interpolated value is covered by the
      // `cls:` verdict tables below.
      addAll(classTokens([m[2].replace(/\$\{[^}]*\}/g, ' ')]), where);
    }
  };
  const fromVerdictTables = (source: string, where: string) => {
    for (const m of source.matchAll(/\bcls:\s*(['"])([\w-]+)\1/g)) note(emitted, m[2], where);
  };

  for (const { file, source } of SCRIPTS) {
    // el(tag, 'a b', text): the second argument is the class list. It can be an
    // expression such as `'badge ' + verdictOf(e).cls + (h ? ' historical' : '')`.
    for (const m of source.matchAll(/(?<![\w$.])el\(/g)) {
      const args = callArguments(source, m.index + m[0].length - 1);
      if (args[1]) addAll(classTokens(stringLiterals(args[1])), file);
    }
    for (const m of source.matchAll(/\.className\s*=\s*([^;\n]+)/g)) addAll(classTokens(stringLiterals(m[1])), file);
    for (const m of source.matchAll(/classList\.(?:add|toggle)\(([^)]*)\)/g)) addAll(classTokens(stringLiterals(m[1])), file);
    fromMarkup(source, file);
    fromVerdictTables(source, file);
  }
  // Example cards drawn on the server before any script runs, and the verdict
  // table (book, hedged, bet, unknown) their badge class comes from.
  for (const file of ['src/landing.ts', 'src/engine/presentation.ts']) {
    const source = text(`../${file}`);
    fromMarkup(source, file);
    fromVerdictTables(source, file);
  }
  return emitted;
}

/** Classes the scripts look up in the markup (document.querySelector('.evidence-preview')), with the files that do. */
function classesQueriedByScripts(): Places {
  const queried: Places = new Map();
  for (const { file, source } of SCRIPTS) {
    for (const selector of selectorsIn(source)) {
      for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) note(queried, m[1], file);
    }
  }
  return queried;
}

/** Ids written as id="..." in web/index.html. */
const pageIds = () => new Set([...PAGE.matchAll(/\sid=(["'])([^"']+)\1/g)].map((m) => m[2]));

/** Classes written as class="..." in web/index.html. */
const pageClasses = () => new Set(classTokens([...PAGE.matchAll(/\bclass=(["'])([^"']*)\1/g)].map((m) => m[2])));

/** Class names that have a selector in the <style> block (comments and declarations are skipped). */
function classesWithRules(): Set<string> {
  const css = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Everything before a `{` is a selector list or an at-rule header; the
  // declarations (urls, 0.5s, ...) sit before `}` and are not looked at.
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]).join('\n');
  return new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
}

describe('web contract: element ids the scripts read', () => {
  it('finds the ids at all (the discovery has not gone blind)', () => {
    expect(idsUsedByScripts().size).toBeGreaterThan(80);
  });

  it('every id a script reads exists in web/index.html', () => {
    const used = idsUsedByScripts();
    const present = pageIds();
    const missing = [...used.keys()].filter((id) => !present.has(id) && !(id in SCRIPT_CREATED_IDS)).sort();
    expect(
      missing,
      `web/index.html no longer has these ids, which the scripts read: ${describeNames(missing, used)}`,
    ).toEqual([]);
  });

  it('the ids allowed to be missing are still created by a script', () => {
    const stale = Object.keys(SCRIPT_CREATED_IDS).filter(
      (id) => !SCRIPTS.some(({ source }) => new RegExp(`\\.id\\s*=\\s*['"]${id}['"]`).test(source)),
    );
    expect(stale, `no script sets these ids any more, drop them from SCRIPT_CREATED_IDS: ${stale.join(', ')}`).toEqual([]);
  });

  it('web/app.js still builds the explore view ids from the table this test lists', () => {
    const squash = (s: string) => s.replace(/\s+/g, '');
    const app = squash(SCRIPTS.find(({ file }) => file === 'web/app.js')!.source);
    const table = '[' + EXPLORE_VIEWS.map(([key, panel]) => `['${key}','${panel}']`).join(',') + ']';
    expect(app.includes(table), `selectExploreView() in web/app.js no longer uses ${table}; update EXPLORE_VIEWS`).toBe(true);
    expect(app.includes("$('explore-'+key)"), "selectExploreView() no longer reads $('explore-' + key); update RUNTIME_BUILT_IDS").toBe(true);
  });
});

describe('web contract: CSS classes the scripts emit', () => {
  it('finds the classes at all (the discovery has not gone blind)', () => {
    expect(classesEmitted().size).toBeGreaterThan(30);
  });

  it('every class created by web/*.js or src/landing.ts has a rule in the style block of web/index.html', () => {
    const emitted = classesEmitted();
    const ruled = classesWithRules();
    const missing = [...emitted.keys()].filter((name) => !ruled.has(name) && !(name in CLASSES_WITHOUT_OWN_RULE)).sort();
    expect(
      missing,
      `the <style> block of web/index.html has no rule for these classes, which the scripts or src/landing.ts emit: ${describeNames(missing, emitted)}`,
    ).toEqual([]);
  });

  it('every class a script looks up in the markup is still on an element in web/index.html', () => {
    const queried = classesQueriedByScripts();
    const present = pageClasses();
    const missing = [...queried.keys()].filter((name) => !present.has(name)).sort();
    expect(
      missing,
      `web/index.html has no element with these classes, which the scripts query for: ${describeNames(missing, queried)}`,
    ).toEqual([]);
  });
});
