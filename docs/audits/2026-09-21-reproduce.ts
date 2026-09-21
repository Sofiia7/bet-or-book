// Offline audit only. No real fetch, credentials, paid requests or source edits.
// Run: node --import tsx docs/audits/2026-09-21-reproduce.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkAddress } from '../../src/api/check';
import { computeVerdict } from '../../src/engine/verdict';
import { computePositionFeatures, computeOrderFeatures, computeHedgeFeatures } from '../../src/engine/features';
import { normalizeSpotHoldings, normalizeNansenBalances, normalizeNansenPnl, buildSpotPriceIndex } from '../../src/sources/normalize';
import { BudgetLedger } from '../../src/budget';
import { snapshotId } from '../../src/snapshot';
import type { Position, RestingOrder } from '../../src/types';
import type { NansenClient, NansenBalance, NansenPerpPositions } from '../../src/sources/nansen';

const address = '0x1111111111111111111111111111111111111111';
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const findings: Array<{ id: string; observed: unknown }> = [];
const record = (id: string, observed: unknown) => findings.push({ id, observed });
const pos = (coin = 'ETH', side: 'long' | 'short' = 'short', sizeUsd = 1_000_000): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 5, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
});
const emptyOrders = computeOrderFeatures([]);
const noHedge = { hedgeUsd: 0, hedgeRatio: 0, unverifiedUsd: 0, lendingUsd: 0 };
const p = computePositionFeatures([pos()]);

const partial = computeVerdict({ positions: p, orders: emptyOrders, hedge: { ...noHedge, hedgeRatio: 1, hedgeUsd: 1_000_000 }, hedgeCoverage: 'partial' });
assert.equal(partial.verdict, 'hedged');
record('partial_page_still_hedged', partial);

const nativeEth = { coin: 'ETH', valueUsd: 1_000_000, chain: 'ethereum', tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' };
const unknownHedge = computeHedgeFeatures('ETH', 'short', 1_000_000, [nativeEth]);
const unknownVerdict = computeVerdict({ positions: p, orders: emptyOrders, hedge: unknownHedge, hedgeCoverage: 'complete' });
assert.equal(unknownHedge.unverifiedUsd, 1_000_000);
assert.equal(unknownVerdict.verdict, 'looks_like_a_bet');
record('ethereum_native_not_registered', { hedge: unknownHedge, verdict: unknownVerdict });

const microOrders: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({ coin: `OTHER${Math.floor(i / 10)}`, side: i % 2 === 0 ? 'bid' : 'ask', sizeUsd: 1 }));
const microBook = computeVerdict({ positions: p, orders: computeOrderFeatures(microOrders), hedge: noHedge, hedgeCoverage: 'complete' });
assert.equal(microBook.verdict, 'book');
record('fifty_dollars_unrelated_orders_classify_million_position', microBook);

const mixed = computeVerdict({ positions: computePositionFeatures(Array.from({ length: 20 }, (_, i) => pos(`ASSET${i}`, i % 2 ? 'long' : 'short'))), orders: emptyOrders, hedge: noHedge });
assert.equal(mixed.verdict, 'book');
record('balanced_twenty_asset_portfolio_is_book_without_quotes', mixed);

const missingPrice = normalizeSpotHoldings([{ coin: 'UETH', token: 1, total: '100', hold: '0', entryNtl: '0' }], new Map());
assert.equal(missingPrice.length, 0);
record('spot_balance_without_price_silently_dropped', missingPrice);

const duplicateNames = buildSpotPriceIndex({ tokens: [{ name: 'USDC', index: 0 }, { name: 'HYPE', index: 1 }, { name: 'HYPE', index: 2 }], universe: [{ name: '@1', tokens: [1, 0] }, { name: '@2', tokens: [2, 0] }] }, [{ coin: '@1', markPx: '100' }, { coin: '@2', markPx: '1' }] as never);
const duplicateBalance = normalizeSpotHoldings([{ coin: 'HYPE', token: 2, total: '10000', hold: '0', entryNtl: '0' }], duplicateNames);
assert.equal(duplicateBalance[0].valueUsd, 1_000_000);
record('duplicate_spot_symbol_uses_other_tokens_price', { observed: duplicateBalance, valueUsingToken2Pair: 10_000, hedge: computeHedgeFeatures('HYPE', 'short', 1_000_000, duplicateBalance) });

const missingContract = normalizeNansenBalances([{ chain: 'ethereum', token_symbol: 'WETH', value_usd: 1_000_000 } as NansenBalance]);
const trustedWithoutContract = computeHedgeFeatures('ETH', 'short', 1_000_000, missingContract);
assert.equal(trustedWithoutContract.hedgeRatio, 1);
record('malformed_onchain_row_bypasses_contract_validation', trustedWithoutContract);
record('empty_pnl_body_not_rejected', normalizeNansenPnl({} as never, 30));

const day = '2026-09-21', t0 = Date.parse(`${day}T12:00:00Z`);
const expired = new BudgetLedger();
assert.equal(expired.reserve(day, 7, { cap: 7, floor: 0 }, t0).ok, true);
// Assume the upstream served the 7 credits but the Worker died before settling.
const again = expired.reserve(day, 7, { cap: 7, floor: 0 }, t0 + 300_001);
assert.equal(again.ok, true);
record('orphan_hold_reopens_spent_budget', { nextAllowed: again.ok, state: expired.snapshot(), possibleActualSpend: 14, cap: 7 });

const midnight = new BudgetLedger();
const held = midnight.reserve(day, 1, { cap: 300, floor: 5 }, t0);
midnight.settle(held.id!, 1, 5, t0);
const nextDay = midnight.reserve('2026-09-22', 7, { cap: 300, floor: 5 }, t0 + 86_400_000);
assert.equal(nextDay.ok, true);
record('midnight_discards_known_remaining_balance', { nextAllowed: nextDay.ok, remaining: midnight.snapshot().remaining });

const idA = snapshotId('0x12345678' + '1'.repeat(32), '2026-09-21T12:00:00.000Z');
const idB = snapshotId('0x12345678' + '2'.repeat(32), '2026-09-21T12:00:00.000Z');
assert.equal(idA, idB);
record('snapshot_id_ignores_most_of_address', { idA, idB });

// Integration probes route every external request to an in-memory answer.
const originalFetch = globalThis.fetch;
let failHip3 = false;
const requested: unknown[] = [];
globalThis.fetch = (async (_url, init) => {
  const b = JSON.parse(String(init?.body));
  requested.push(b);
  if (b.type === 'frontendOpenOrders' && b.dex && failHip3) return new Response('{}', { status: 503 });
  const routes: Record<string, unknown> = {
    frontendOpenOrders: [], spotClearinghouseState: { balances: [] },
    spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []], userFillsByTime: [],
    metaAndAssetCtxs: [{ universe: [] }, []],
    clearinghouseState: { assetPositions: [{ position: { coin: 'ETH', szi: '1', positionValue: '1000000', entryPx: '100', leverage: { value: 5 }, liquidationPx: null, unrealizedPnl: '0', cumFunding: { sinceOpen: '0' } } }], time: Date.now() },
  };
  if (!(b.type in routes)) throw new Error(`Unexpected offline route: ${b.type}`);
  return Response.json(routes[b.type]);
}) as typeof fetch;
function client(coin: string, side: 'long' | 'short', opts: { old?: boolean; malformedFunder?: boolean; truncatedFunder?: boolean } = {}): NansenClient {
  return {
    async perpPositions() {
      return { asset_positions: [{ position: { token_symbol: coin, size: side === 'long' ? '1' : '-1', position_value_usd: '1000000', entry_price_usd: '100', liquidation_price_usd: null, leverage_value: 5, unrealized_pnl_usd: '0', cumulative_funding_since_open_usd: '0' } }], timestamp: Date.now() - (opts.old ? 3_600_000 : 0) } as NansenPerpPositions;
    },
    async perpPnlSummary() { return { realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 } as never; },
    async currentBalance(a) {
      if (a === address) return { rows: [], complete: true };
      if (opts.malformedFunder) return { rows: null as never, complete: true };
      return { rows: [{ chain: 'ethereum', token_address: weth, token_symbol: 'WETH', value_usd: 1_000_000 } as NansenBalance], complete: !opts.truncatedFunder };
    },
    async relatedWallets(_a, chain) { return { rows: opts.malformedFunder || opts.truncatedFunder ? [{ address: '0x2222222222222222222222222222222222222222', relation: 'First Funder', chain, address_label: null } as never] : [], complete: true }; },
  };
}
try {
  failHip3 = true;
  const hip3 = await checkAddress(address, { nansen: client('xyz:ETH', 'long') });
  assert.equal(hip3.verdict.verdict, 'looks_like_a_bet');
  assert.equal(hip3.degraded, true);
  record('missing_hip3_orders_still_directional_verdict', { verdict: hip3.verdict, coverage: hip3.coverage, degraded: hip3.degraded });
  failHip3 = false;
  const stale = await checkAddress(address, { nansen: client('ETH', 'long', { old: true }) });
  assert.equal(stale.degraded, false);
  record('stale_positions_not_degraded', { verdict: stale.verdict, degraded: stale.degraded, coverage: stale.coverage });
  const fallback = await checkAddress(address, { nansen: null, nansenOffReason: 'budget exhausted' });
  assert.equal(fallback.degraded, false);
  record('no_nansen_fallback_not_degraded', { verdict: fallback.verdict, degraded: fallback.degraded, coverage: fallback.coverage });
  let error = '';
  try { await checkAddress(address, { nansen: client('ETH', 'short', { malformedFunder: true }) }); }
  catch (e) { error = String(e); }
  assert.match(error, /unexpected shape/);
  record('malformed_optional_funder_fails_whole_check', error);
  const truncated = await checkAddress(address, { nansen: client('ETH', 'short', { truncatedFunder: true }) });
  assert.equal(truncated.degraded, false);
  record('truncated_funder_not_reported', { degraded: truncated.degraded, coverage: truncated.coverage });
} finally { globalThis.fetch = originalFetch; }

const gallery = JSON.parse(readFileSync('data/gallery.json', 'utf8'));
const entries = gallery.entries.filter((e: any) => e.positions.nPositions > 0);
const counts: Record<string, number> = {};
const reasons: Record<string, number> = {};
for (const e of entries) {
  counts[e.verdict.verdict] = (counts[e.verdict.verdict] || 0) + 1;
  for (const reason of e.verdict.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
}
const stats = {
  active: entries.length, counts, reasons,
  withoutPositionTimestamp: entries.filter((e: any) => !e.positionsAsOf).length,
  withoutAssetRegistryEvidence: entries.filter((e: any) => typeof e.hedge.unverifiedUsd !== 'number').length,
  hedgedWithoutAssetRegistryEvidence: entries.filter((e: any) => e.verdict.verdict === 'hedged' && typeof e.hedge.unverifiedUsd !== 'number').map((e: any) => e.address),
  versions: [...new Set(entries.map((e: any) => e.classifierVersion))],
};
const report = { generatedAt: new Date().toISOString(), networkCalls: 0, observations: findings, gallery: stats };
writeFileSync('docs/audits/2026-09-21-evidence.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
