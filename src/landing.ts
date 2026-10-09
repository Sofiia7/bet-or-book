import type { GalleryRow } from './gallery';
import { formatUsd } from './engine/evidence';
import { VERDICT_STYLES } from './engine/presentation';

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Bundled examples are usable before JavaScript or the gallery request. */
export function landingExamples(rows: GalleryRow[]): string {
  const tiles = rows.map((row) => {
    const { cls, label, description } = VERDICT_STYLES[row.verdict.verdict];
    // The same text web/app.js's badgeText() draws once the gallery loads:
    // the strength on any verdict, the qualifier only on an Unknown. Anything
    // else here is rewritten in front of the reader a moment after the page
    // shows (27.09).
    const badge = label + (row.verdict.strength ? ' (' + row.verdict.strength + ')' : '') +
      (row.verdict.verdict === 'unknown' && row.badgeQualifier ? ' · ' + row.badgeQualifier : '');
    const p = row.positions;
    const title = `${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} ${p.headlineSide}`;
    const date = new Date(row.checkedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    const note = row.badgeQualifier === 'assets sit with funders'
      ? 'Matching assets sit with funding wallets. A transfer does not prove ownership.' : row.description ?? description;
    return `<a class="queue-row" href="/?s=${encodeURIComponent(row.snapshotId)}">${row.question ? `<strong class="example-question">${escapeHtml(row.question)}</strong>` : ''}<span class="badge ${cls}">${escapeHtml(badge)}</span><span class="queue-pos">${escapeHtml(title)}</span><span class="example-note">${escapeHtml(note)}</span><span class="example-date">Read ${escapeHtml(date)}</span><span class="example-open">Open the reading →</span></a>`;
  });
  return tiles.slice(0, 3).join('') + (tiles.length > 3 ? `<details class="fold deeper-example"><summary>More evidence cases</summary>${tiles.slice(3).join('')}</details>` : '');
}
