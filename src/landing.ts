import type { GalleryRow } from './gallery';
import { formatUsd } from './engine/evidence';
import { VERDICT_STYLES } from './engine/presentation';

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Both as web/app.js has them: shortAddr() and fmtDay() ("07 Oct", UTC,
 * from a fixed table so the server and the browser cannot spell a month
 * differently). */
const shortAddr = (address: string) => address.slice(0, 6) + '...' + address.slice(-4);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()];
};

/**
 * One example as a position card, the handoff's one card pattern: the
 * verdict label, the amount and asset, the question the reading answers,
 * its summary, and a footer with the address and the day. The whole card is
 * the link to the saved reading.
 *
 * web/explore.js exampleCard() draws the same card as a button once the
 * gallery loads, and that one replaces this one in front of the reader. The
 * two match element for element and text for text, or the cards change
 * under the reader's eyes (27.09): test/featured.test.ts runs both on the
 * same rows and compares them.
 */
function exampleCard(row: GalleryRow): string {
  const { cls, label, description } = VERDICT_STYLES[row.verdict.verdict];
  // The same text web/app.js's badgeText() draws: the strength on any
  // verdict, the qualifier only on an Unknown.
  const badge = label + (row.verdict.strength ? ' (' + row.verdict.strength + ')' : '') +
    (row.verdict.verdict === 'unknown' && row.badgeQualifier ? ' · ' + row.badgeQualifier : '');
  // web/app.js readingTitleParts(): "$122.1M" and "HYPE long".
  const p = row.positions;
  const amount = p.nPositions ? formatUsd(p.headlineNotionalUsd) : 'No open positions';
  const asset = p.nPositions ? `${p.headlineCoin} ${p.headlineSide}` : '';
  return `<a class="card-position queue-row" href="/?s=${encodeURIComponent(row.snapshotId)}">` +
    `<span class="cp-verdict badge ${cls}">${escapeHtml(badge)}</span>` +
    `<span class="cp-amount">${escapeHtml(amount)}${asset ? ` <span class="cp-asset">${escapeHtml(asset)}</span>` : ''}</span>` +
    (row.question ? `<span class="example-question">${escapeHtml(row.question)}</span>` : '') +
    `<span class="cp-summary">${escapeHtml(row.description || description)}</span>` +
    `<span class="cp-footer"><span class="cp-meta">${escapeHtml(shortAddr(row.address) + ' · ' + fmtDay(row.checkedAt))}</span><span class="cp-open">Open →</span></span>` +
    '</a>';
}

/** Bundled examples are usable before JavaScript or the gallery request:
 * three in a row, any others folded under them. web/explore.js
 * renderPlayer() lays out its own cards the same way. */
export function landingExamples(rows: GalleryRow[]): string {
  const cards = rows.map(exampleCard);
  return cards.slice(0, 3).join('') + (cards.length > 3 ? `<details class="fold deeper-example"><summary>More evidence cases</summary>${cards.slice(3).join('')}</details>` : '');
}
