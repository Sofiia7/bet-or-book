// The landing page's example tiles are rendered twice: once by the Worker
// into the initial HTML (src/landing.ts), and again by web/app.js once the
// gallery has loaded. The two used to word the badge differently - the
// server added the qualifier to every verdict and dropped the strength, the
// page did the opposite - so three of the four tiles rewrote themselves in
// front of the reader a moment after the page showed (27.09).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import featuredData from '../data/featured.json';
import { galleryIndex, type Gallery } from '../src/gallery';
import { landingExamples } from '../src/landing';
import { snapshotId } from '../src/snapshot';

const featured = featuredData as unknown as Gallery;
const rows = galleryIndex(featured, (e) => e.snapshotId ?? snapshotId(e.address, e.checkedAt)).entries;
const html = landingExamples(rows);
const badges = [...html.matchAll(/class="badge [a-z]+">([^<]+)</g)].map((m) => m[1]);

/** What web/app.js's badgeText() says for the same row: the strength on
 * any verdict, the qualifier only on an Unknown. Pinned here as a copy of
 * that function's rule rather than imported, since app.js is a browser
 * script; test/web-app-verdict-sync.test.ts guards the page's constants the
 * same way. */
const LABELS: Record<string, string> = { book: 'Book', hedged: 'Hedged', looks_like_a_bet: 'Looks like a bet', unknown: 'Unknown' };
function pageBadgeText(row: (typeof rows)[number]): string {
  const base = LABELS[row.verdict.verdict] + (row.verdict.strength ? ` (${row.verdict.strength})` : '');
  return row.verdict.verdict === 'unknown' && row.badgeQualifier ? `${base} · ${row.badgeQualifier}` : base;
}

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
});
