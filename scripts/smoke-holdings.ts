// Live check of the stage 2 reads. Read-only: Hyperliquid's public info
// endpoint and the three public JSON-RPC nodes. No key and no Worker. Note
// that the whole check in (b) also reads the funding links from the keyless
// Ethereum explorer (one request; Arbitrum is not read without a key, and this
// smoke deliberately runs without one).
//
//   node --import tsx scripts/smoke-holdings.ts
import { checkAddress } from '../src/api/check';
import { CHECK_REQUEST_LIMIT, attachRequestBudget, createRequestBudget } from '../src/requestBudget';
import { getPerpMetaAndAssetCtxs } from '../src/sources/hyperliquid';
import { HOLDINGS_CHAINS, readOnchainHoldings, underlyingPricesFrom } from '../src/sources/onchain';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const WALLETS: Record<string, string> = {
  abraxas: ABRAXAS,
  'funder-arb': '0xb38e8c17e38363af6ebdcb3dae12e0243582891d',
  'funder-eth': '0xed0c6079229e2d407672a117c22b62064f4a4312',
};

// Count every outbound request per host.
const perHost = new Map<string, number>();
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).host;
  perHost.set(host, (perHost.get(host) ?? 0) + 1);
  return realFetch(input, init);
}) as typeof fetch;

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const countsNow = () => Object.fromEntries(perHost);

// (a) Holdings of the three wallets, marks from a live metaAndAssetCtxs.
const [meta, ctxs] = await getPerpMetaAndAssetCtxs();
const marks = new Map<string, number>();
meta.universe.forEach((asset, i) => marks.set(asset.name, Number(ctxs[i]?.markPx)));
const prices = underlyingPricesFrom(marks);
console.log('marks', JSON.stringify(prices));

for (const [label, wallet] of Object.entries(WALLETS)) {
  const r = await readOnchainHoldings(wallet, prices);
  const byUnderlying = new Map<string, number>();
  for (const h of r.holdings) {
    const key = /BTC/.test(h.coin) ? 'BTC' : /HYPE/.test(h.coin) ? 'HYPE' : 'ETH';
    byUnderlying.set(key, (byUnderlying.get(key) ?? 0) + h.valueUsd);
  }
  console.log(`\n${label}: read ${r.read.join(', ')} (of ${HOLDINGS_CHAINS.length}); failed ${JSON.stringify(r.failed)}; unreadTokens ${r.unreadTokens}`);
  for (const h of r.holdings) console.log(`  ${h.chain} ${h.coin} amount ${h.amount} value ${usd(h.valueUsd)} priced ${h.priced}`);
  for (const [u, v] of byUnderlying) console.log(`  total ${u}: ${usd(v)}`);
}
console.log('\nrequests so far (part a):', JSON.stringify(countsNow()));

// (b) The whole check, no explorer key, with a request budget attached.
perHost.clear();
const signal = AbortSignal.timeout(25_000);
const budget = createRequestBudget();
attachRequestBudget(signal, budget);
const result = await checkAddress(ABRAXAS, { signal, deadline: Date.now() + 25_000 });
console.log('\ncheck: verdict', result.verdict.verdict, 'strength', result.verdict.strength, 'reasons', JSON.stringify(result.verdict.reasons));
console.log('hedgeScope', result.hedgeScope, '| hedgeCoverage', result.hedgeCoverage, '| linkedHedgeCoverage', result.linkedHedgeCoverage);
for (const n of result.coverageNotes) console.log(`  note${n.failure ? ' (failure)' : ''}: ${n.text}`);
const total = [...perHost.values()].reduce((a, b) => a + b, 0);
console.log('requests per host:', JSON.stringify(countsNow()));
console.log(`total requests: ${total} (budget used ${budget.used()} of ${CHECK_REQUEST_LIMIT})`);
console.log('positions:', result.positions.nPositions, 'headline', result.positions.headlineCoin, result.positions.headlineSide, '| dexes asked/answered', JSON.stringify(result.positionsVenues));
