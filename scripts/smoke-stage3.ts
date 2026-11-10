// Live check of the whole new pipeline with Nansen gone. Read-only: Hyperliquid's
// public info endpoint (positions, orders, fills, the 30-day PnL), the three
// public JSON-RPC nodes, and the Blockscout explorer for the funding links:
// keyless eth.blockscout.com, or api.blockscout.com when BLOCKSCOUT_API_KEY is
// in the shell or .dev.vars (read through scripts/local-vars.ts, handed to the
// reader and never printed; only whether one is set is). No Worker, no Nansen.
//
//   node --import tsx scripts/smoke-stage3.ts
//
// What it must show: no request to any host with "nansen" in its name, only
// the hosts below, at most CHECK_REQUEST_LIMIT requests in total.
import { checkAddress, CHECK_DEADLINE_MS } from '../src/api/check';
import { CHECK_REQUEST_LIMIT, attachRequestBudget, createRequestBudget } from '../src/requestBudget';
import { localVar } from './local-vars';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
// The three wallets the fixtures hold. Any other address a reading names is
// printed as "(other)": this output goes into a public plan record.
const FIXTURE_WALLETS = new Set([
  ABRAXAS,
  '0xb38e8c17e38363af6ebdcb3dae12e0243582891d',
  '0xed0c6079229e2d407672a117c22b62064f4a4312',
]);
const EXPECTED_HOSTS = new Set([
  'api.hyperliquid.xyz',
  'ethereum-rpc.publicnode.com',
  'arbitrum-one-rpc.publicnode.com',
  'rpc.hyperliquid.xyz',
  'eth.blockscout.com',
  'api.blockscout.com',
]);

// Count every outbound request per host.
const perHost = new Map<string, number>();
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).host;
  perHost.set(host, (perHost.get(host) ?? 0) + 1);
  return realFetch(input, init);
}) as typeof fetch;

const apiKey = localVar('BLOCKSCOUT_API_KEY');
console.log(`explorer key configured: ${apiKey ? 'yes' : 'no'} (the value is never printed)`);

const signal = AbortSignal.timeout(CHECK_DEADLINE_MS);
const budget = createRequestBudget();
attachRequestBudget(signal, budget);
const result = await checkAddress(ABRAXAS, {
  signal,
  deadline: Date.now() + CHECK_DEADLINE_MS,
  includeContext: true,
  explorer: { apiKey },
});

const shown = (address: string) => (FIXTURE_WALLETS.has(address.toLowerCase()) ? address : '(other)');

console.log('\nverdict', result.verdict.verdict, 'strength', result.verdict.strength, 'reasons', JSON.stringify(result.verdict.reasons));
console.log('source', result.source);
console.log('hedgeScope', result.hedgeScope, '| hedgeCoverage', result.hedgeCoverage, '| linkedHedgeCoverage', result.linkedHedgeCoverage);
for (const n of result.coverageNotes) console.log(`  note${n.failure ? ' (failure)' : ''}: ${n.text}`);

console.log('\npnl', JSON.stringify(result.pnl));
const tile = result.evidence.find((e) => /PnL/.test(e.label));
console.log('PnL tile:', tile ? `${tile.label} | ${tile.value} | ${tile.source}` : '(not among the five evidence rows)');
console.log('evidence rows:', result.evidence.map((e) => `${e.label} [${e.source}]`).join(' ; '));

const funders = result.linkedHedge?.funders ?? [];
console.log(`\nfunders (${funders.length}), coverage ${result.linkedHedgeCoverage}:`);
for (const f of funders) {
  console.log(`  ${shown(f.address)} ${f.chain} ${f.relation} matchingUsd ${Math.round(f.matchingUsd)}`);
}

console.log('\nattribution', JSON.stringify(result.attribution));

const hosts = Object.fromEntries(perHost);
const total = [...perHost.values()].reduce((a, b) => a + b, 0);
const unexpected = [...perHost.keys()].filter((h) => !EXPECTED_HOSTS.has(h));
const nansen = [...perHost.keys()].filter((h) => /nansen/i.test(h));
console.log('\nrequests per host:', JSON.stringify(hosts));
console.log(`total requests: ${total} (budget used ${budget.used()} of ${CHECK_REQUEST_LIMIT})`);
console.log(`requests to a host with "nansen" in its name: ${nansen.reduce((a, h) => a + (perHost.get(h) ?? 0), 0)}`);
console.log(`hosts outside the expected list: ${unexpected.length ? unexpected.join(', ') : 'none'}`);
console.log('positions:', result.positions.nPositions, 'headline', result.positions.headlineCoin, result.positions.headlineSide, '| dexes asked/answered', JSON.stringify(result.positionsVenues));
if (nansen.length || unexpected.length || total > CHECK_REQUEST_LIMIT) {
  console.log('\nSMOKE FAILED: see the counts above');
  process.exitCode = 1;
}
