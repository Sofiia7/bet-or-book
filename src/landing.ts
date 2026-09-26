import type { GalleryRow } from './gallery';
import { formatUsd } from './engine/evidence';

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const verdicts = {
  looks_like_a_bet: ['bet', 'Looks like a bet', 'A concentrated directional position, with no visible offset found.'],
  hedged: ['hedged', 'Hedged', 'Matching holdings at this address cover the short.'],
  unknown: ['unknown', 'Unknown', 'The available evidence leaves an open question.'],
  book: ['book', 'Book', 'Orders on both sides of the market point to trading inventory.'],
};

/** Bundled examples are usable before JavaScript or the gallery request. */
export function landingExamples(rows: GalleryRow[]): string {
  return rows.map((row) => {
    const [cls, label, description] = verdicts[row.verdict.verdict];
    const badge = label + (row.badgeQualifier ? ' · ' + row.badgeQualifier : row.verdict.strength ? ' (' + row.verdict.strength + ')' : '');
    const p = row.positions;
    const title = `${formatUsd(p.headlineNotionalUsd)} ${p.headlineCoin} ${p.headlineSide}`;
    const date = new Date(row.checkedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
    const note = row.badgeQualifier === 'assets sit with funders'
      ? 'Matching assets sit with funding wallets. A transfer does not prove ownership.' : description;
    return `<a class="queue-row" href="/?s=${encodeURIComponent(row.snapshotId)}"><span class="badge ${cls}">${escapeHtml(badge)}</span><span class="queue-pos">${escapeHtml(title)}</span><span class="example-note">${escapeHtml(note)}</span><span class="example-date">Read ${escapeHtml(date)}</span><span class="example-open">Open the reading →</span></a>`;
  }).join('');
}
