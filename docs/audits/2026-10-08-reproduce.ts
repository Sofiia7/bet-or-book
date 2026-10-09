// Offline audit probes. Demonstrate current behavior; do not change product data.
// Run: node --import tsx docs/audits/2026-10-08-reproduce.ts
import { readFileSync } from 'node:fs';
import { computeVerdict } from '../../src/engine/verdict';
import { verdictInputOf } from '../../src/engine/observation';
import { compareReadings } from '../../src/engine/compare';
import { readingHeadline } from '../../src/engine/presentation';
import type { CheckResponse } from '../../src/api/check';
import { checkNansenBalances } from '../../src/sources/validate';
import { normalizeNansenBalances } from '../../src/sources/normalize';
import { computeHedgeFeatures } from '../../src/engine/features';
import { galleryIndex } from '../../src/gallery';
import { BudgetLedger, WORST_CASE_CALLS } from '../../src/budget';

const featured = JSON.parse(readFileSync(new URL('../../data/featured.json', import.meta.url), 'utf8'));
const active: CheckResponse[] = featured.entries.filter((r: CheckResponse) => !r.superseded);
const hedge = active.find(r => r.verdict.verdict === 'hedged')!;
const funder = active.find(r => r.verdict.reasons.includes('linked_exposure_unverified'))!;
function decide(r: CheckResponse): CheckResponse {
  r.verdict = computeVerdict(verdictInputOf(r));
  return r;
}
function later(r: CheckResponse): CheckResponse {
  const copy = structuredClone(r);
  copy.observedAt = copy.checkedAt = new Date(Date.parse(r.observedAt ?? r.checkedAt) + 60_000).toISOString();
  return copy;
}

const partialPositions = decide({ ...structuredClone(hedge), positionsCoverage: 'partial' });
const unknownBefore = decide({ ...structuredClone(funder), hedgeCoverage: 'missing' });
const unknownAfter = decide({ ...later(funder), hedgeCoverage: 'complete' });

const linkBefore = structuredClone(hedge);
linkBefore.hedge.hedgeRatio = 0;
linkBefore.hedge.hedgeUsd = 0;
linkBefore.linkedHedge = null;
linkBefore.linkedHedgeCoverage = 'missing';
decide(linkBefore);
const linkAfter = decide({ ...later(linkBefore), linkedHedgeCoverage: 'complete' });

const emptyPartial = structuredClone(hedge);
emptyPartial.positions.nPositions = 0;
emptyPartial.positionsCoverage = 'partial';
decide(emptyPartial);

const balance = { chain: 'ethereum', address: hedge.address, token_address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', token_symbol: 'WETH', token_name: 'Wrapped Ether', token_amount: '100', value_usd: '300000', price_usd: 3000 };
const validated = checkNansenBalances([balance]);
const normalized = normalizeNansenBalances(validated.rows);
const numericValidated = checkNansenBalances([{ ...balance, token_amount: 100, value_usd: 300000 }]);
const gallery = JSON.parse(readFileSync(new URL('../../data/gallery.json', import.meta.url), 'utf8'));
const historicalBooks = galleryIndex(gallery, r => r.snapshotId ?? 'legacy').entries.filter(r => r.historical && r.verdict.verdict === 'book');
const publicBudgetSimulation = [3, 4, 7].map(cost => {
  const ledger = new BudgetLedger();
  let checks = 0;
  for (let i = 0; i < 30; i++) {
    const hold = ledger.reserve('2026-10-08', WORST_CASE_CALLS, { cap: 40, floor: 0 }, i * 1000);
    if (!hold.ok) break;
    ledger.settle(hold.id!, cost, null, i * 1000 + 100);
    checks++;
  }
  return { costPerFreshCheck: cost, successfulSequentialChecks: checks, spent: cost * checks, publicCap: 40, reservation: WORST_CASE_CALLS };
});

console.log(JSON.stringify({
  audit: '2026-10-08',
  partialPositionsStillHedged: { coverage: partialPositions.positionsCoverage, verdict: partialPositions.verdict },
  unknownReasonChange: {
    before: unknownBefore.verdict, after: unknownAfter.verdict,
    comparison: compareReadings(unknownBefore, unknownAfter),
  },
  linkedCoverageAttribution: {
    before: linkBefore.verdict, after: linkAfter.verdict,
    comparison: compareReadings(linkBefore, linkAfter),
  },
  emptyPartialClaimsNothingOpen: { coverage: emptyPartial.positionsCoverage, headline: readingHeadline(emptyPartial) },
  acceptedNumericStringsSilentlyLost: {
    malformed: validated.malformed, accepted: validated.rows.length, normalized: normalized.length,
    stringCoverage: computeHedgeFeatures('ETH', 'short', 300000, normalized).hedgeRatio,
    numberCoverage: computeHedgeFeatures('ETH', 'short', 300000, normalizeNansenBalances(numericValidated.rows)).hedgeRatio,
    caveat: 'Synthetic upstream-shape probe; no evidence that current live Nansen responses use numeric strings.',
  },
  historicalBooksMappedToZero: historicalBooks.map(r => ({id:r.snapshotId, rules:r.classifierVersion, matched:r.headlineTwoSidedNotionalUsd})),
  publicBudgetSimulation,
  activeFeatured: active.map(r => ({ id: r.snapshotId, verdict: r.verdict, checkedAt: r.checkedAt, calls: r.nansenCalls, size: r.positions.headlineNotionalUsd })),
}, null, 2));
