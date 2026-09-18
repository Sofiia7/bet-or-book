// Sums data/nansen-calls.jsonl into data/ledger.json, which the Worker
// bundles and serves at /api/ledger next to its own live KV day counters.
// Run it after any script that spends credits, before a deploy.
import { readFileSync, writeFileSync } from 'node:fs';
import { summarizeLedger, type LedgerLine } from '../src/ledger';

const lines = readFileSync('data/nansen-calls.jsonl', 'utf-8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l) as LedgerLine);
const summary = { generatedAt: new Date().toISOString(), ...summarizeLedger(lines) };
writeFileSync('data/ledger.json', JSON.stringify(summary, null, 2) + '\n');
console.log(`${summary.calls} calls (${summary.okCalls} answered 2xx), ${summary.credits} credits`);
console.log('by source:', summary.bySource);
console.log('by endpoint:', summary.byEndpoint);
