// Rebuilds the summary sentence and evidence of every gallery entry from the
// numbers already stored in it, with the current src/engine/evidence.ts. No
// network: a wording fix never needs the credits spent on the scan again.
// Do not run while scripts/prescan.ts is writing the same file.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { explain } from '../src/engine/evidence';
import type { Gallery } from '../src/gallery';

const path = process.argv[2] ?? 'data/gallery.json';
const gallery = JSON.parse(readFileSync(path, 'utf-8')) as Gallery;
let changed = 0;
gallery.entries = gallery.entries.map((e) => {
  const { summary, evidence } = explain(e);
  if (summary !== e.summary || JSON.stringify(evidence) !== JSON.stringify(e.evidence)) changed++;
  return { ...e, summary, evidence };
});
writeFileSync(`${path}.tmp`, JSON.stringify(gallery, null, 1) + '\n');
renameSync(`${path}.tmp`, path);
console.log(`${gallery.entries.length} entries, ${changed} re-explained`);
