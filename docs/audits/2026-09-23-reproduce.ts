/** Offline audit probes. No live upstream calls and no product/data edits.
 * Run: node --import tsx docs/audits/2026-09-23-reproduce.ts
 * Assertions document current behavior, not the behavior a fix should preserve.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { computePositionFeatures, computeOrderFeatures, computeHedgeFeatures, computeTradeFeatures, EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import { computeVerdict } from '../../src/engine/verdict';
import { compareReadings } from '../../src/engine/compare';
import { explain } from '../../src/engine/evidence';
import { computeVitals } from '../../src/engine/vitals';
import { ogCardData } from '../../src/engine/ogCard';
import { normalizeSpotHoldings, normalizeNansenBalances } from '../../src/sources/normalize';
import { checkAddress } from '../../src/api/check';
import { snapshotId } from '../../src/snapshot';
import type { Position } from '../../src/types';
import type { CheckResponse } from '../../src/api/check';
import type { NansenClient, NansenPerpPositions, NansenBalance, NansenPnlSummary, NansenRelatedWallet } from '../../src/sources/nansen';

const at = Date.parse('2026-09-23T12:00:00Z');
const address = '0x1111111111111111111111111111111111111111';
const p = (coin: string, side: 'long' | 'short', sizeUsd: number): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 5, leverageType: 'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
});
const basePositions = computePositionFeatures([p('ETH', 'short', 1_000_000)]);
const base = { positions: basePositions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE, hedgeCoverage: 'complete' as const, ordersCoverage: 'complete' as const, positionsCoverage: 'complete' as const };
const evidence: Record<string, unknown> = {};

// L01: activity in unrelated markets decides the selected ETH position.
const unrelated = computeOrderFeatures(Array.from({ length: 50 }, (_, i) => ({ coin: `OTHER${i % 5}`, side: (i < 25 ? 'bid' : 'ask') as 'bid' | 'ask', sizeUsd: 3_000 })), 'ETH');
const unrelatedVerdict = computeVerdict({ ...base, orders: unrelated });
assert.equal(unrelated.headlineTwoSided, false);
assert.equal(unrelatedVerdict.verdict, 'book');
evidence.bookWithoutHeadlineQuotes = { orders: unrelated, verdict: unrelatedVerdict };

// Materiality sums both sides; a tiny opposite side unlocks a large one-sided amount.
const asymmetric = computeOrderFeatures(Array.from({ length: 50 }, (_, i) => ({ coin: `OTHER${i % 5}`, side: (i < 25 ? 'bid' : 'ask') as 'bid' | 'ask', sizeUsd: i < 25 ? 10_000 : 1 })), 'ETH');
assert.equal(computeVerdict({ ...base, orders: asymmetric }).verdict, 'book');
evidence.oneDollarOppositeQuotes = { bidsUsd: 250_000, asksUsd: 25, measuredTwoSidedUsd: asymmetric.twoSidedNotionalUsd, verdict: computeVerdict({ ...base, orders: asymmetric }) };

// L02: the hedge uses the spot ticker, ignoring the token index used to price it.
const spot = normalizeSpotHoldings([{ coin: 'HYPE', token: 987654, total: '1000000', hold: '0', entryNtl: '0' }], new Map([[987654, 1]]));
const spotHedge = computeHedgeFeatures('HYPE', 'short', 1_000_000, spot);
assert.equal(spotHedge.hedgeRatio, 1);
evidence.untrustedSpotIdentity = { spot, hedgeRatio: spotHedge.hedgeRatio };

// Invalid/unpriced Nansen rows disappear despite a complete source page.
const unpriced = normalizeNansenBalances([{ token_symbol: 'WETH', token_address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chain: 'ethereum', token_amount: 1000, value_usd: null } as unknown as NansenBalance]);
assert.equal(unpriced.length, 0);
evidence.unpricedNansenHoldingDropped = { normalizedRows: unpriced, verdict: computeVerdict({ ...base, hedge: computeHedgeFeatures('ETH', 'short', 1_000_000, unpriced) }) };

const hl: Record<string, unknown> = {
  frontendOpenOrders: [], spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []], userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []], clearinghouseState: { assetPositions: [], time: at },
};
const realFetch = globalThis.fetch;
const hlRequests: Array<Record<string, unknown>> = [];
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  hlRequests.push(body);
  // A venue with orders but no open position. The current code never asks it.
  if (body.type === 'frontendOpenOrders' && body.dex === 'xyz') return Response.json([{ coin: 'xyz:ETH', side: 'B', sz: '1', limitPx: '100', isTrigger: false }]);
  return Response.json(hl[body.type] ?? []);
};
let requested: Array<{ address: string; chain: string }> = [];
let rawPositions: Position[] = [p('ETH', 'short', 1_000_000), p('BTC', 'long', 100_000)];
const nansen: NansenClient = {
  perpPositions: async () => ({ asset_positions: rawPositions.map(x => ({ position: {
    token_symbol: x.coin, size: x.side === 'long' ? '1' : '-1', position_value_usd: String(x.sizeUsd), entry_price_usd: '100', liquidation_price_usd: null, leverage_value: 5, leverage_type: 'cross', unrealized_pnl_usd: '0', cumulative_funding_since_open_usd: '0',
  } })), timestamp: at }) as unknown as NansenPerpPositions,
  perpPnlSummary: async () => ({ realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 }) as NansenPnlSummary,
  currentBalance: async () => ({ rows: [], complete: true }),
  relatedWallets: async (addr, chain) => { requested.push({ address: addr, chain }); return { rows: [], complete: true }; },
};
try {
  const a = await checkAddress(address, { nansen, now: () => at });
  evidence.unseenDexMarkedComplete = { ordersCoverage: a.ordersCoverage, queriedDexes: hlRequests.filter(x => x.type === 'frontendOpenOrders').map(x => x.dex ?? 'main'), verdict: a.verdict };
  const b = await checkAddress(address, { nansen, now: () => at + 1, focus: { coin: 'BTC', side: 'long' } });
  const compared = compareReadings({ ...a, nansenCalls: 0 }, { ...b, nansenCalls: 0 });
  assert.ok(compared.changes.some(x => x.field === 'position size'));
  evidence.focusLooksLikeAccountChange = { from: a.positions.headlineCoin, to: b.positions.headlineCoin, comparison: compared, focusedSummary: b.summary, focusedEvidence: b.evidence };
  const wrongSide = await checkAddress(address, { nansen, now: () => at, focus: { coin: 'ETH', side: 'long' } });
  assert.equal(wrongSide.focus?.side, 'long');
  assert.equal(wrongSide.positions.headlineSide, 'short');
  assert.ok(!wrongSide.coverage.some(s => s.includes('No ETH long')));
  evidence.wrongSideFocusAccepted = { focus: wrongSide.focus, actual: wrongSide.positions.headlineSide, coverage: wrongSide.coverage };
  const sameMomentFocus = await checkAddress(address, { nansen, now: () => at, focus: { coin: 'BTC', side: 'long' } });
  const idA = snapshotId(address, a.checkedAt, a.classifierVersion);
  const idB = snapshotId(address, sameMomentFocus.checkedAt, sameMomentFocus.classifierVersion);
  assert.equal(idA, idB);
  evidence.focusSnapshotCollision = { idA, idB, fromCoin: a.positions.headlineCoin, toCoin: sameMomentFocus.positions.headlineCoin };

  // Both changes can matter although compare's five displayed numbers are identical.
  const changedRules = structuredClone(a) as CheckResponse;
  changedRules.classifierVersion = 'v5';
  changedRules.positionsCoverage = 'partial';
  changedRules.verdict = { verdict: 'unknown', strength: null, reasons: ['positions_not_complete'] };
  const causality = compareReadings({ ...a, nansenCalls: 0 }, changedRules);
  assert.equal(causality.verdictChange?.because, 'the rules changed');
  evidence.unsupportedCausalAttribution = causality;

  rawPositions = [p('ETH', 'long', 1_000_000)];
  nansen.relatedWallets = async (_addr, chain) => {
    if (chain === 'arbitrum') throw new Error('offline simulated outage');
    return { complete: false, rows: [{ address: '0x2222222222222222222222222222222222222222', address_label: null, relation: 'First Funder', block_timestamp: new Date(at - 86_400_000).toISOString(), chain: 'ethereum' } as NansenRelatedWallet] };
  };
  const funded = await checkAddress(address, { nansen, now: () => at });
  assert.ok(funded.vitals.some(x => x.label === 'First funded' && x.value.includes('1 day ago')));
  evidence.firstFundingOverstated = { funding: funded.vitals.find(x => x.label === 'First funded'), degraded: funded.degraded, coverage: funded.coverage };
} finally { globalThis.fetch = realFetch; }

// New portfolio wording says all when only net >=80% is required.
const mixed = computePositionFeatures([p('ETH', 'short', 900_000), p('BTC', 'long', 100_000)], undefined, { coin: 'BTC', side: 'long' });
const mixedVerdict = computeVerdict({ ...base, positions: mixed });
const mixedExplanation = explain({ ...base, positions: mixed, verdict: mixedVerdict, hedgeScope: 'none', linkedHedge: null, trades: computeTradeFeatures([], 24), pnl: null, sizeVsOi: null, source: 'nansen' });
assert.ok(mixedExplanation.summary.includes('all pointing the same way'));
assert.ok(mixedExplanation.summary.includes('the largest is $100K BTC long'));
evidence.mixedPortfolioMisworded = { netToGross: mixed.netToGross, verdict: mixedVerdict, summary: mixedExplanation.summary };

const makerBlocksHedge = computeVerdict({ ...base, hedge: { ...EMPTY_HEDGE, hedgeRatio: 1, hedgeUsd: 1_000_000 }, trades: { tradesPerDay: 200, crossedShare: 0.1, buyShare: 0.5 } });
assert.equal(makerBlocksHedge.reasons[0], 'maker_flow_only');
evidence.makerFlowSuppressesHedge = makerBlocksHedge;

const flip = computeTradeFeatures([{ coin: 'ETH', timestamp: at, crossed: true, side: 'sell', closedPnlUsd: 0, sizeUsd: 1_000_000, dir: 'Long > Short' }], 24, 'ETH');
const flipVitals = computeVitals({ headline: p('ETH', 'short', 1_000_000), headlineLiqDistancePct: null, headlineLiqDistanceBasis: null, positionsSource: 'Nansen', sizeVsOi: null, headlineOpenedUsd: flip.headlineOpenedUsd, headlineClosedUsd: flip.headlineClosedUsd, tradesSpanHours: flip.spanHours });
assert.equal(flipVitals.find(x => x.label === 'Position flow')?.value, 'no fills');
evidence.reversalMisreportedAsNoFills = { fills: flip.headlineFills, usd: flip.notionalUsd, vitals: flipVitals.find(x => x.label === 'Position flow') };

const crossDex = computePositionFeatures([p('ETH', 'long', 1_000_000), p('xyz:ETH', 'short', 1_000_000)]);
assert.equal(crossDex.sameAssetOffsetShare, 0);
evidence.crossDexOffsetNotRecognized = { sameAssetOffsetShare: crossDex.sameAssetOffsetShare, verdict: computeVerdict({ ...base, positions: crossDex }) };

const gallery = JSON.parse(readFileSync('data/gallery.json', 'utf8'));
const visible: CheckResponse[] = gallery.entries.filter((e: CheckResponse) => !e.superseded && e.positions.nPositions > 0);
const current = visible.filter(e => !e.historical);
evidence.gallery = {
  visible: visible.length, current: current.length, historical: visible.length - current.length,
  longs: current.filter(e => e.positions.headlineSide === 'long').length,
  vitals: visible.filter(e => e.vitals?.length).length,
  verdicts: Object.fromEntries(['book', 'hedged', 'looks_like_a_bet', 'unknown'].map(v => [v, current.filter(e => e.verdict.verdict === v).length])),
  hedgesAllFromHyperliquid: current.filter(e => e.verdict.verdict === 'hedged').every(e => e.hedge.hedgeUsdBySource.onchain === 0),
};

// Reinterpret a disposable copy only; the existing id survives a different answer.
const before = structuredClone(current.find(e => e.verdict.verdict === 'looks_like_a_bet')!);
before.classifierVersion = 'v3';
before.verdict = { verdict: 'unknown', strength: null, reasons: ['old rules'] };
const dir = mkdtempSync(join(tmpdir(), 'bet-or-book-audit-'));
const path = join(dir, 'gallery.json');
writeFileSync(path, JSON.stringify({ ...gallery, entries: [before] }));
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/reexplain.ts', path], { encoding: 'utf8' });
const after = JSON.parse(readFileSync(path, 'utf8')).entries[0];
assert.equal(after.snapshotId, before.snapshotId);
assert.notEqual(after.verdict.verdict, before.verdict.verdict);
evidence.reinterpretationChangesSameSnapshot = { before: { id: before.snapshotId, verdict: before.verdict, rules: before.classifierVersion }, after: { id: after.snapshotId, verdict: after.verdict, rules: after.classifierVersion }, entriesAfter: 1 };

const og = ogCardData({ address, verdict: mixedVerdict, summary: mixedExplanation.summary, classifierVersion: 'v4' });
evidence.ogHasNoTimeOrLimits = og;

writeFileSync('docs/audits/2026-09-23-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
