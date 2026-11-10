// Manual/weekly refresh of the existing featured addresses. No new scan.
// Keeps prior IDs and replaces examples only when the new reading is complete.
// A check reads only free public sources; the optional explorer key
// BLOCKSCOUT_API_KEY comes from the environment or .dev.vars and is never
// printed. Without it Arbitrum funding links are not read and every refresh
// would be a thinner reading, so the script stops before any request.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { checkAddress } from '../src/api/check';
import { snapshotId } from '../src/snapshot';
import type { Gallery } from '../src/gallery';
import { featuredQuestion, usableFeaturedRefresh } from './featured-refresh-policy';
import { localVar } from './local-vars';

const path = 'data/featured.json';
const gallery = JSON.parse(readFileSync(path, 'utf8')) as Gallery;
const explorer = { apiKey: localVar('BLOCKSCOUT_API_KEY') };
if (!explorer.apiKey) throw new Error('No Blockscout key configured; no refresh performed');
let refreshed = 0;
for (const previous of [...gallery.entries.filter(e => !e.superseded)]) {
  const focus = featuredQuestion(previous);
  if (!focus) { console.log('Kept example: no selected open position to refresh'); continue; }
  const timeout = AbortSignal.timeout(45_000);
  const result = await checkAddress(previous.address, { explorer, signal: timeout, focus });
  if (!usableFeaturedRefresh(previous, { ...result, nansenCalls: 0 })) {
    console.log('Kept the previous dated example: no newer complete reading of the same position'); continue;
  }
  const id = snapshotId(result.address, result.checkedAt, result.classifierVersion, result.focus);
  previous.superseded = true; previous.supersededBy = id;
  gallery.entries.push({ ...result, nansenCalls: 0, snapshotId: id, snapshotClassifierVersion: result.classifierVersion, supersedes: previous.snapshotId });
  gallery.finishedAt = result.checkedAt;
  const temp = path + '.tmp'; writeFileSync(temp, JSON.stringify(gallery, null, 2) + '\n'); renameSync(temp, path);
  refreshed++;
  console.log(`Refreshed ${result.positions.headlineCoin} ${result.positions.headlineSide}: ${result.verdict.verdict}`);
}
console.log(`${refreshed} examples refreshed`);
