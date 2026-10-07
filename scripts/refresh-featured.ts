// Manual/weekly refresh of the existing featured addresses. No new scan.
// Keeps prior IDs and replaces examples only when the new reading is complete.
import { readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { checkAddress } from '../src/api/check';
import { createNansenClient } from '../src/sources/nansen';
import { WORST_CASE_CALLS } from '../src/budget';
import { snapshotId } from '../src/snapshot';
import type { Gallery } from '../src/gallery';

const path = 'data/featured.json';
const gallery = JSON.parse(readFileSync(path, 'utf8')) as Gallery;
const key = readFileSync('.dev.vars', 'utf8').split(/\r?\n/).find(l => l.startsWith('NANSEN_API_KEY='))?.slice(15).trim().replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('No Nansen key configured; no refresh performed');
let spent = 0;
let remaining: number | null = null;
const maxSpend = 60;
const floor = 100;
let refreshed = 0;
for (const previous of [...gallery.entries.filter(e => !e.superseded)]) {
  if (spent + WORST_CASE_CALLS > maxSpend || (remaining !== null && remaining - WORST_CASE_CALLS < floor)) {
    console.log('Refresh stopped at the spend allowance or account floor'); break;
  }
  let calls = 0;
  const timeout = AbortSignal.timeout(45_000);
  const client = createNansenClient(key, meta => {
    calls++; spent += meta.creditsCost ?? 1;
    if (meta.creditsRemaining !== null) remaining = meta.creditsRemaining;
    const { at, path: endpoint, ...accounting } = meta;
    appendFileSync('data/nansen-calls.jsonl', JSON.stringify({ at: new Date(at).toISOString(), source: 'featured-refresh', endpoint, ...accounting }) + '\n');
  }, timeout);
  const result = await checkAddress(previous.address, { nansen: client, signal: timeout });
  if (result.degraded || result.source !== 'nansen') {
    console.log(`Kept the previous example: incomplete refresh (${calls} calls)`); continue;
  }
  const id = snapshotId(result.address, result.checkedAt, result.classifierVersion, result.focus);
  previous.superseded = true; previous.supersededBy = id;
  gallery.entries.push({ ...result, nansenCalls: calls, snapshotId: id, snapshotClassifierVersion: result.classifierVersion, supersedes: previous.snapshotId });
  gallery.finishedAt = result.checkedAt;
  const temp = path + '.tmp'; writeFileSync(temp, JSON.stringify(gallery, null, 2) + '\n'); renameSync(temp, path);
  refreshed++;
  console.log(`Refreshed ${result.positions.headlineCoin} ${result.positions.headlineSide}: ${result.verdict.verdict} (${calls} calls)`);
}
console.log(`${refreshed} examples refreshed; ${spent} credits recorded`);
