// Offline evaluation against independent labels; bundled examples are not labels.
import { readFileSync } from 'node:fs';
import type { CheckResponse } from '../src/api/check';
const path = process.argv[2];
if (!path) throw new Error('Usage: node --import tsx scripts/calibrate-book.ts <labelled-readings.json>');
const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<{ reading: CheckResponse; label: 'book' | 'not-book' | 'unresolved'; labelledBy: string; basis: string }>;
if (!Array.isArray(rows)) throw new Error('Expected an array of independent labelled observations');
let tp = 0, fp = 0, fn = 0, tn = 0, unresolved = 0;
for (const row of rows) {
  if (!row.labelledBy?.trim() || !row.basis?.trim() || !row.reading?.verdict || !['book', 'not-book', 'unresolved'].includes(row.label)) throw new Error('Each row requires reading, label, labelledBy and independent basis');
  if (row.label === 'unresolved') { unresolved++; continue; }
  const positive = row.reading.verdict.verdict === 'book';
  if (row.label === 'book') positive ? tp++ : fn++; else positive ? fp++ : tn++;
}
console.log(JSON.stringify({ labelled: tp + fp + fn + tn, unresolved, tp, fp, fn, tn,
  precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
  note: 'No probability calibration or general accuracy claim. Labels must be independent of this classifier.' }, null, 2));
