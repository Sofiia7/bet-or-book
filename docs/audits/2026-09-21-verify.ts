// The sixteen observations of the 21.09 audit, re-run against the fixes.
//
// 2026-09-21-reproduce.ts is kept as the audit's own record: its assertions
// pin the defects as they were, and it no longer passes, which is the point.
// This file asks the same questions of the same code paths and asserts the
// behaviour those defects were replaced with. Every finding also has tests in
// the main suite - that is where a regression is caught - and this exists so
// the audit can be answered observation by observation in one run.
//
// Offline only. No real fetch, no credentials, no paid requests.
// Run: node --import tsx docs/audits/2026-09-21-verify.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkAddress } from '../../src/api/check';
import { computeVerdict } from '../../src/engine/verdict';
import { computePositionFeatures, computeOrderFeatures, computeHedgeFeatures, EMPTY_HEDGE } from '../../src/engine/features';
import { normalizeSpotHoldings, normalizeNansenBalances, normalizeNansenPnl, buildSpotPriceIndex, UpstreamShapeError } from '../../src/sources/normalize';
import { missingForCurrentRules } from '../../src/engine/observation';
import { shareCard, PERMANENT_LIMIT } from '../../src/engine/share';
import { BudgetLedger } from '../../src/budget';
import { snapshotId } from '../../src/snapshot';
import type { Position, RestingOrder, SpotHolding } from '../../src/types';
import type { NansenClient, NansenBalance, NansenPerpPositions } from '../../src/sources/nansen';

const address = '0x1111111111111111111111111111111111111111';
const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const fixed: Array<{ id: string; was: string; now: unknown }> = [];
const record = (id: string, was: string, now: unknown) => fixed.push({ id, was, now });

const pos = (coin = 'ETH', side: 'long' | 'short' = 'short', sizeUsd = 1_000_000): Position => ({
  coin, side, sizeUsd, entryPx: 100, leverage: 5, liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0,
});
const onchain = (o: Partial<SpotHolding> & { coin: string; valueUsd: number }): SpotHolding => ({
  source: 'onchain', chain: 'ethereum', ...o,
});
const p = computePositionFeatures([pos()]);
const emptyOrders = computeOrderFeatures([]);

// A01 - the asset behind a holding, established the same way at every step.
const nativeEth = computeHedgeFeatures('ETH', 'short', 1_000_000, [onchain({ coin: 'ETH', valueUsd: 1_000_000, tokenAddress: native })]);
assert.equal(nativeEth.hedgeUsd, 1_000_000);
record('ethereum_native_not_registered', 'native ETH on Ethereum counted as nothing, verdict looks_like_a_bet', nativeEth);

const dupMeta = { tokens: [{ name: 'USDC', index: 0 }, { name: 'HYPE', index: 1 }, { name: 'HYPE', index: 2 }], universe: [{ name: '@1', tokens: [1, 0] as [number, number] }, { name: '@2', tokens: [2, 0] as [number, number] }] };
const dupPrices = buildSpotPriceIndex(dupMeta, [{ coin: '@1', markPx: '100' }, { coin: '@2', markPx: '1' }] as never);
const dupBalance = normalizeSpotHoldings([{ coin: 'HYPE', token: 2, total: '10000', hold: '0', entryNtl: '0' }], dupPrices);
assert.equal(dupBalance[0].valueUsd, 10_000);
record('duplicate_spot_symbol_uses_other_tokens_price', '$10K of a $1 token valued at $1M off a namesake', dupBalance);

const malformed = normalizeNansenBalances([{ chain: 'ethereum', token_symbol: 'WETH', value_usd: 1_000_000 } as NansenBalance]);
const malformedHedge = computeHedgeFeatures('ETH', 'short', 1_000_000, malformed);
assert.equal(malformedHedge.hedgeRatio, 0);
assert.equal(malformedHedge.unverifiedUsd, 1_000_000);
record('malformed_onchain_row_bypasses_contract_validation', 'a row with no contract accepted by the name WETH', malformedHedge);

const unpriced = normalizeSpotHoldings([{ coin: 'UETH', token: 1, total: '100', hold: '0', entryNtl: '0' }], new Map());
assert.equal(unpriced.length, 1);
assert.equal(unpriced[0].priced, false);
record('spot_balance_without_price_silently_dropped', 'an unpriced balance multiplied by zero and dropped as dust', unpriced);

const unknownAsset = computeVerdict({ positions: p, orders: emptyOrders, hedge: { ...EMPTY_HEDGE, unverifiedUsd: 1_000_000 }, hedgeCoverage: 'complete' });
assert.equal(unknownAsset.verdict, 'unknown');
assert.ok(unknownAsset.reasons.includes('unrecognised_assets'));
record('material_unidentified_holdings_withhold_the_answer', 'unidentified dollars counted as an absence', unknownAsset);

// A02 - completeness is checked before the band, not only after it.
const partial = computeVerdict({ positions: p, orders: emptyOrders, hedge: { ...EMPTY_HEDGE, hedgeRatio: 1, hedgeUsd: 1_000_000 }, hedgeCoverage: 'partial' });
assert.equal(partial.verdict, 'unknown');
assert.ok(partial.reasons.includes('hedge_not_checked'));
record('partial_page_still_hedged', '100% on the first page of holdings called hedged', partial);

// A03 - a book is a claim about quoting.
const microOrders: RestingOrder[] = Array.from({ length: 50 }, (_, i) => ({ coin: `OTHER${Math.floor(i / 10)}`, side: i % 2 === 0 ? 'bid' : 'ask', sizeUsd: 1 }));
const micro = computeVerdict({ positions: p, orders: computeOrderFeatures(microOrders, 'ETH'), hedge: EMPTY_HEDGE, hedgeCoverage: 'complete' });
assert.notEqual(micro.verdict, 'book');
record('fifty_dollars_unrelated_orders_classify_million_position', '$50 of quotes elsewhere classified a $1M position as inventory', micro);

const mixed = computeVerdict({ positions: computePositionFeatures(Array.from({ length: 20 }, (_, i) => pos(`ASSET${i}`, i % 2 ? 'long' : 'short'))), orders: emptyOrders, hedge: EMPTY_HEDGE, hedgeCoverage: 'complete' });
assert.notEqual(mixed.verdict, 'book');
record('balanced_twenty_asset_portfolio_is_book_without_quotes', 'twenty unrelated positions and no quotes called a book', mixed);

// R01 - a body of the wrong shape is rejected where it arrives.
assert.throws(() => normalizeNansenPnl({} as never, 30), UpstreamShapeError);
record('empty_pnl_body_not_rejected', 'an empty PnL body rendered as $NaN', 'UpstreamShapeError');

// S01/S02 - a crash and a calendar day are not refunds.
const day = '2026-09-21';
const t0 = Date.parse(`${day}T12:00:00Z`);
const orphan = new BudgetLedger();
assert.equal(orphan.reserve(day, 7, { cap: 7, floor: 0 }, t0).ok, true);
const after = orphan.reserve(day, 7, { cap: 7, floor: 0 }, t0 + 300_001);
assert.equal(after.ok, false);
assert.equal(orphan.snapshot().spent, 7);
record('orphan_hold_reopens_spent_budget', 'an unsettled hold refunded, allowing 14 credits against a cap of 7', orphan.snapshot());

const midnight = new BudgetLedger();
const held = midnight.reserve(day, 1, { cap: 300, floor: 5 }, t0);
midnight.settle(held.id!, 1, 5, t0);
assert.equal(midnight.reserve('2026-09-22', 7, { cap: 300, floor: 5 }, t0 + 86_400_000).ok, false);
assert.equal(midnight.snapshot().remaining, 5);
record('midnight_discards_known_remaining_balance', 'the day rolling over forgot the account balance', midnight.snapshot().remaining);

// R02 - an id identifies one reading.
const idA = snapshotId('0x12345678' + '1'.repeat(32), '2026-09-21T12:00:00.000Z');
const idB = snapshotId('0x12345678' + '2'.repeat(32), '2026-09-21T12:00:00.000Z');
assert.notEqual(idA, idB);
record('snapshot_id_ignores_most_of_address', 'two addresses sharing eight characters shared one id', { idA, idB });

// U01 - the standing limit is on every card.
const card = shareCard(
  { evidence: [], coverage: [], coverageNotes: [], checkedAt: '2026-09-21T12:00:00.000Z' } as never,
  { kind: 'live' },
);
assert.equal(card.limits[0], PERMANENT_LIMIT);
record('png_loses_permanent_limits', 'a picture with no coverage notes claimed everything was read in full', card.limits[0]);

// A04 - a rule may not rely on a source that was never read.
const originalFetch = globalThis.fetch;
let failHip3 = false;
globalThis.fetch = (async (_url, init) => {
  const b = JSON.parse(String(init?.body));
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
  assert.equal(hip3.verdict.verdict, 'unknown');
  assert.ok(hip3.verdict.reasons.includes('quotes_not_checked'));
  record('missing_hip3_orders_still_directional_verdict', 'a dex answering 503 still supported "it quotes nothing"', hip3.verdict);

  failHip3 = false;
  const stale = await checkAddress(address, { nansen: client('ETH', 'long', { old: true }) });
  assert.equal(stale.degraded, true);
  record('stale_positions_not_degraded', 'an hour-old reading cached for the full ten minutes as if current', { degraded: stale.degraded });

  const fallback = await checkAddress(address, { nansen: null, nansenOffReason: 'budget exhausted' });
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.positionsCoverage, 'partial');
  record('no_nansen_fallback_not_degraded', 'a check with Nansen switched off reported itself complete', { degraded: fallback.degraded, positionsCoverage: fallback.positionsCoverage });

  const malformedFunder = await checkAddress(address, { nansen: client('ETH', 'short', { malformedFunder: true }) });
  assert.ok(malformedFunder.verdict);
  assert.ok(malformedFunder.coverage.join(' ').includes('unexpected shape'));
  record('malformed_optional_funder_fails_whole_check', 'one bad funder row threw away a check whose main data was in hand', malformedFunder.verdict);

  const truncated = await checkAddress(address, { nansen: client('ETH', 'short', { truncatedFunder: true }) });
  assert.equal(truncated.degraded, true);
  record('truncated_funder_not_reported', 'a funder read cut off at its first page passed for everything it holds', { degraded: truncated.degraded });
} finally {
  globalThis.fetch = originalFetch;
}

// A06 - a stored reading is re-judged only where the rules can read it.
const gallery = JSON.parse(readFileSync('data/gallery.json', 'utf8'));
const entries = gallery.entries.filter((e: { positions: { nPositions: number } }) => e.positions.nPositions > 0);
const history = entries.filter((e: { historical?: unknown }) => e.historical);
const judged = entries.filter((e: { historical?: unknown }) => !e.historical);
assert.ok(history.length > 0);
assert.ok(history.every((e: { classifierVersion: string }) => e.classifierVersion !== 'v3'));
assert.ok(judged.every((e: Parameters<typeof missingForCurrentRules>[0]) => missingForCurrentRules(e).length === 0));
record('gallery_reinterpretation_presented_as_recheck', '269 of 277 cards stamped with rules their observations could not support', {
  judged: judged.length,
  history: history.length,
  hedgedUnderCurrentRules: judged.filter((e: { verdict: { verdict: string } }) => e.verdict.verdict === 'hedged').length,
  bookUnderCurrentRules: judged.filter((e: { verdict: { verdict: string } }) => e.verdict.verdict === 'book').length,
});

const report = { generatedAt: new Date().toISOString(), networkCalls: 0, observations: fixed };
writeFileSync('docs/audits/2026-09-21-verified.json', JSON.stringify(report, null, 2) + '\n');
console.log(`${fixed.length} audit observations re-run against the fixes; all assertions hold.`);
