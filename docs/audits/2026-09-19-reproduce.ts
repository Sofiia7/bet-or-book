// SUPERSEDED, 21 September 2026. Kept as the audit's evidence; do not run it.
//
// These probes asserted the behaviour of the code as it stood on 19.09, which
// means they assert the defects the audit found. Those defects are fixed, so
// this file no longer even imports: KVRateLimiter and nansenAllowed are gone,
// replaced by the Durable Objects in src/coordinator.ts. Failing to import is
// the correct outcome, not a problem to repair.
//
// Where each finding is now asserted the right way round:
//   A01, A02, A03  test/engine/verdict.test.ts, test/engine/evidence.test.ts
//   A04, A09, A10  test/api/check.test.ts
//   A05, A06       test/budget.test.ts, test/coordinator.test.ts
//   A07, A16, A17  test/engine/features.test.ts, test/sources/normalize.test.ts
//   A11            test/sources/nansen.test.ts
//   A12, A13       test/cache.test.ts, test/snapshot.test.ts
//   the 277 cards  test/gallery.test.ts
//
// Original header follows.
//
// Offline audit probes. They document current behavior, not desired regression tests.
// Run from the repository root: node --import tsx docs/audits/2026-09-19-reproduce.ts
// No real API requests and no credentials are used.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { computePositionFeatures, computeHedgeFeatures, computeOrderFeatures } from '../../src/engine/features';
import { computeVerdict } from '../../src/engine/verdict';
import { normalizeNansenBalances, buildSpotPriceIndex } from '../../src/sources/normalize';
import { createNansenClient } from '../../src/sources/nansen';
import { checkAddress } from '../../src/api/check';
import { nansenAllowed, recordCalls, readDay } from '../../src/credits';
import { KVRateLimiter, extractAddress } from '../../src/guard';
import { withCache } from '../../src/cache';
import type { Position } from '../../src/types';
import type { NansenClient, NansenCallMeta } from '../../src/sources/nansen';
import type { KVLike } from '../../src/kv';

const observations: Record<string, unknown> = {};
class MemoryKV implements KVLike {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
}
const day = '2026-09-19';
const meta: NansenCallMeta = { path: 'synthetic', status: 200, creditsCost: 1, creditsRemaining: null };
const pos = (coin: string, side: 'long' | 'short', sizeUsd: number): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 5, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
});
const noOrders = computeOrderFeatures([]);
const noHedge = { hedgeUsd: 0, hedgeRatio: 0 };

// P1: permission checking and accounting are separate, non-atomic operations.
const creditKV = new MemoryKV();
await creditKV.put(`nansen:day:${day}`, JSON.stringify({ calls: 299, credits: 299, lastRemaining: null }));
let actualNewCalls = 0;
const allowed = await Promise.all(Array.from({ length: 20 }, async () => {
  if (!await nansenAllowed(creditKV, day, 300, 5)) return false;
  actualNewCalls += 7;
  await recordCalls(creditKV, day, Array.from({ length: 7 }, () => meta));
  return true;
}));
const stored = await readDay(creditKV, day);
assert.equal(actualNewCalls, 140);
assert.equal(stored.credits, 306);
observations.creditRace = { admitted: allowed.filter(Boolean).length, cap: 300, actualTotal: 299 + actualNewCalls, recorded: stored };

const rateKV = new MemoryKV();
const limiter = new KVRateLimiter(rateKV, 20, 60);
const permits = await Promise.all(Array.from({ length: 30 }, () => limiter.allow('audit-ip')));
assert.equal(permits.filter(Boolean).length, 30);
observations.rateRace = { limit: 20, admitted: permits.filter(Boolean).length, recorded: [...rateKV.values.values()] };

let produced = 0;
const cacheKV = new MemoryKV();
await Promise.all(Array.from({ length: 10 }, () => withCache(cacheKV, 'same-address', 600, async () => ++produced)));
assert.equal(produced, 10);
observations.cacheStampede = { simultaneousIdenticalRequests: 10, producerCalls: produced };

// Balanced notional is not proof of a hedge between unrelated assets.
const unrelated = computeVerdict({ positions: computePositionFeatures([pos('BTC', 'long', 1e6), pos('TRUMP', 'short', 1e6)]), orders: noOrders, hedge: noHedge });
assert.equal(unrelated.verdict, 'hedged');
observations.unrelatedAssets = unrelated;

const short = computePositionFeatures([pos('ETH', 'short', 1e6)]);
observations.partialHedge = computeVerdict({ positions: short, orders: noOrders, hedge: computeHedgeFeatures('ETH', 'short', 1e6, [{ coin: 'WETH', valueUsd: 500_000 }]) });
const unrelatedMaker = computeVerdict({positions:short,orders:noOrders,hedge:noHedge,trades:{tradesPerDay:300,crossedShare:0,buyShare:0.5}});
assert.equal(unrelatedMaker.verdict, 'book');
observations.unrelatedMakerActivity = { ...unrelatedMaker, note:'The trade signal carries no market identity or notional, so unrelated tiny fills can dominate a large headline position.' };

const fakeWeth = normalizeNansenBalances([{ chain:'ethereum',address:'0x'+'1'.repeat(40),token_address:'0x'+'f'.repeat(40),token_symbol:'WETH',token_name:'Unverified ticker collision',token_amount:1000,price_usd:1000,value_usd:1e6 }]);
assert.equal(computeHedgeFeatures('ETH','short',1e6,fakeWeth).hedgeRatio,1);
observations.tokenIdentity = { foreignContractAcceptedAsWeth: true };

const fixture = (path: string) => JSON.parse(readFileSync(`test/fixtures/${path}`, 'utf8'));
const rawNansen = fixture('nansen/perp-positions-abraxas.json').data;
const singleShort = structuredClone(rawNansen);
singleShort.asset_positions = [singleShort.asset_positions.find((p: any) => p.position.token_symbol === 'ETH')];
const routes: Record<string, unknown> = {
  frontendOpenOrders: [], spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: fixture('hyperliquid/spot-meta.json'),
  metaAndAssetCtxs: fixture('hyperliquid/meta-and-asset-ctxs.json'),
  userFillsByTime: [], clearinghouseState: fixture('hyperliquid/abraxas/clearinghouse.json'),
};
const address = '0x'+'1'.repeat(40);
const originalFetch = globalThis.fetch;
const fakeClient: NansenClient = {
  perpPositions: async () => singleShort,
  perpPnlSummary: async () => fixture('nansen/perp-pnl-summary-abraxas.json').data,
  currentBalance: async () => { throw new Error('synthetic missing balances'); },
  relatedWallets: async () => { throw new Error('synthetic missing links'); },
};
try {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const type = JSON.parse(String(init?.body)).type;
    if (!(type in routes)) throw new Error('unrouted offline request');
    return Response.json(routes[type]);
  }) as typeof fetch;
  const missing = await checkAddress(address, { nansen: fakeClient });
  assert.equal(missing.verdict.verdict, 'looks_like_a_bet');
  observations.missingCoverage = { verdict: missing.verdict, summary: missing.summary, coverage: missing.coverage };

  const incomplete = await checkAddress(address, { nansen: { ...fakeClient, currentBalance: async () => ({ rows:[],complete:false }), relatedWallets:async()=>[] } });
  assert.equal(incomplete.verdict.verdict, 'looks_like_a_bet');
  observations.incompleteCoverage = { verdict:incomplete.verdict,hedgeScope:incomplete.hedgeScope,summary:incomplete.summary,coverage:incomplete.coverage };

  const stale = await checkAddress(address, { nansen:{...fakeClient,perpPositions:async()=>({...singleShort,timestamp:1}),currentBalance:async()=>({rows:[],complete:true}),relatedWallets:async()=>[]} });
  observations.staleTimestamp = {upstreamTimestamp:1,checkedAt:stale.checkedAt,coverage:stale.coverage,verdict:stale.verdict};

  let malformedMessage = '';
  try { await checkAddress(address, { nansen: { ...fakeClient, perpPositions: async()=>({} as any) } }); }
  catch(error) { malformedMessage = String(error); }
  assert.ok(malformedMessage.includes('map'));
  observations.malformedSuccess = {fallsBack:false,error:malformedMessage};

  const callsAfterRefusal: string[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('api.nansen.ai')) { callsAfterRefusal.push(String(url).split('/api/v1/')[1]); return Response.json({}, {status:402}); }
    const type = JSON.parse(String(init?.body)).type;
    return Response.json(routes[type]);
  }) as typeof fetch;
  await checkAddress(address, { nansen: createNansenClient('offline-not-a-key') });
  assert.equal(callsAfterRefusal.length,5);
  observations.refusalDoesNotStopCurrentCheck = callsAfterRefusal;

  const timeoutCalls: NansenCallMeta[] = [];
  globalThis.fetch = (async () => { throw new DOMException('synthetic timeout','TimeoutError'); }) as typeof fetch;
  await createNansenClient('offline-not-a-key',m=>{timeoutCalls.push(m);}).perpPositions(address).catch(()=>{});
  assert.equal(timeoutCalls.length,0);
  observations.unrecordedTimeout = {attempts:1,recorded:timeoutCalls.length};
} finally { globalThis.fetch = originalFetch; }

const syntheticMeta = {tokens:[{name:'UETH',index:1},{name:'USDC',index:0},{name:'UBTC',index:2}],universe:[{name:'UETH/USDC',tokens:[1,0] as [number,number]},{name:'UETH/UBTC',tokens:[1,2] as [number,number]}]};
const px = buildSpotPriceIndex(syntheticMeta,[{coin:'UETH/USDC',markPx:'3000',dayNtlVlm:'0',midPx:null,prevDayPx:'3000'},{coin:'UETH/UBTC',markPx:'0.03',dayNtlVlm:'0',midPx:null,prevDayPx:'0.03'}]);
assert.equal(px.get('UETH'),0.03);
observations.quoteCurrencyIgnored = {expectedUsd:3000,computedUsd:px.get('UETH')};
const [realMeta] = fixture('hyperliquid/spot-meta.json');
const tokens = new Map(realMeta.tokens.map((t:any)=>[t.index,t.name]));
observations.realFixtureQuoteTokens = [...new Set(realMeta.universe.map((p:any)=>tokens.get(p.tokens[1])))];

observations.transactionHashTruncatedToAddress = {inputLength:66,result:extractAddress('0x'+'a'.repeat(64))};
assert.equal(String(observations.transactionHashTruncatedToAddress && extractAddress('0x'+'a'.repeat(64))).length,42);

const gallery = JSON.parse(readFileSync('data/gallery.json','utf8'));
const entries = gallery.entries.filter((e:any)=>e.positions.nPositions>0);
const count = (pred:(e:any)=>boolean) => entries.filter(pred).length;
// Public explorer labels verified separately; not Nansen labels.
const knownServices: Record<string,string> = {
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549':'Binance 15 (public explorer label)',
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe':'Gate Deposit (public explorer label)',
};
observations.sharedServiceContamination = entries.filter((e:any)=>e.linkedHedge?.funders.some((f:any)=>knownServices[f.address])).map((e:any)=>{
  const contaminated = e.linkedHedge.funders.filter((f:any)=>knownServices[f.address]);
  const remainingUsd = e.linkedHedge.funders.filter((f:any)=>!knownServices[f.address]).reduce((sum:number,f:any)=>sum+f.matchingUsd,0);
  const corrected = computeVerdict({...e,linkedHedge:{linkedHedgeRatio:remainingUsd/e.positions.headlineNotionalUsd}});
  return {address:e.address,originalVerdict:e.verdict,originalCoverageRatio:e.hedge.hedgeRatio+e.linkedHedge.linkedHedgeRatio,contaminated,afterRemovingOnlyTheseServices:corrected};
});
observations.gallery = {
  scannedAt:gallery.scannedAt,finishedAt:gallery.finishedAt,total:gallery.entries.length,open:entries.length,
  verdicts: Object.fromEntries(['book','hedged','looks_like_a_bet','unknown'].map(v=>[v,count((e:any)=>e.verdict.verdict===v)])),
  balancedNotionalOnly:count((e:any)=>e.verdict.reasons.includes('balanced_book')),
  bookFromTradesOnly:count((e:any)=>e.verdict.verdict==='book'&&e.verdict.reasons.length===1&&e.verdict.reasons[0]==='trades'),
  probableHedge:count((e:any)=>e.verdict.strength==='probable'),
  hedgeBelow80pct:count((e:any)=>e.verdict.verdict==='hedged'&&e.verdict.reasons[0]!=='balanced_book'&&e.hedge.hedgeRatio+(e.linkedHedge?.linkedHedgeRatio??0)<0.8),
  anyCoverageWarning:count((e:any)=>e.coverage.length>0),
  betCoverageWarning:count((e:any)=>e.verdict.verdict==='looks_like_a_bet'&&e.coverage.length>0),
  entriesWithMissingPnl:count((e:any)=>e.pnl===null),
};
const output = {auditedCommit:'5187ca6',generatedAt:new Date().toISOString(),network:'fully mocked',observations};
writeFileSync('docs/audits/2026-09-19-evidence.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
