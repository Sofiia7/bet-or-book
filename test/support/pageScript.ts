/**
 * Cuts one top-level `function name(...) { ... }` out of a page script's
 * source text (web/app.js), so a test can run a pure helper with
 * `new Function(...)` without a DOM and without the module's imports.
 *
 * Only a declaration that starts at the beginning of a line counts as top
 * level; a nested function is indented and is not matched. The body is found
 * by counting braces, skipping strings, template literals, comments and
 * regular expression literals, so a brace inside any of those does not end it
 * early. Throws when the name is missing or declared twice, so a renamed
 * helper fails the test that uses it instead of silently running nothing.
 */
export function extractPageFunction(source: string, name: string): string {
  const escaped = name.replace(/[$]/g, '\\$');
  const declarations = [...source.matchAll(new RegExp(`^(?:async[ \\t]+)?function[ \\t]*\\*?[ \\t]*${escaped}[ \\t]*\\(`, 'gm'))];
  if (declarations.length === 0) throw new Error(`no top-level function ${name} in the page script`);
  if (declarations.length > 1) throw new Error(`function ${name} is declared ${declarations.length} times in the page script`);
  const start = declarations[0].index;
  const openParen = start + declarations[0][0].length - 1;
  const closeParen = matchingClose(source, openParen, '(', ')');
  const openBrace = source.indexOf('{', closeParen);
  if (openBrace === -1) throw new Error(`function ${name} has no body`);
  const closeBrace = matchingClose(source, openBrace, '{', '}');
  return source.slice(start, closeBrace + 1);
}

/** Characters after which a `/` starts a regular expression rather than a division. */
const BEFORE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/** Index of the bracket that closes the one at `open`. */
function matchingClose(source: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  let previous = '';
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      i = endOf(source, '\n', i + 2) - 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i = endOf(source, '*/', i + 2) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = endOfQuoted(source, i, c);
      previous = c;
      continue;
    }
    if (c === '/' && (BEFORE_REGEX.has(previous) || /(?:^|[^\w$])(?:return|typeof|case|in|of)\s*$/.test(source.slice(Math.max(0, i - 12), i)))) {
      i = endOfRegex(source, i);
      previous = '/';
      continue;
    }
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return i;
    }
    if (!/\s/.test(c)) previous = c;
  }
  throw new Error(`unbalanced ${opener}${closer} from index ${open}`);
}

function endOf(source: string, token: string, from: number): number {
  const at = source.indexOf(token, from);
  return at === -1 ? source.length : at;
}

/** Index of the closing quote of the string or template literal opened at `open`. */
function endOfQuoted(source: string, open: number, quote: string): number {
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (c === quote) return i;
    // A placeholder in a template literal is code and can hold its own braces
    // and strings; walk it as code until its closing brace.
    if (quote === '`' && c === '$' && source[i + 1] === '{') i = matchingClose(source, i + 1, '{', '}');
  }
  throw new Error(`unterminated ${quote} literal from index ${open}`);
}

/** Index of the closing slash of the regular expression literal opened at `open`. */
function endOfRegex(source: string, open: number): number {
  let inClass = false;
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') { i++; continue; }
    if (c === '\n') break;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i;
  }
  throw new Error(`unterminated regular expression literal from index ${open}`);
}
