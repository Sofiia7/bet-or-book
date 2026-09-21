// Re-reads the gallery with the current rules - but only where the stored
// observation carries what those rules read.
//
// Re-running the classifier over an aggregate costs nothing and is the right
// thing to do when a rule changes. It is not a re-check of the account, and
// the 21.09 audit found the two presented as one: entries recording neither
// order notional nor what the hedge sum left out were stamped with the
// current classifier version anyway. So each entry is now sorted into one of
// two piles. Where the observation is readable, it gets a new interpretation
// with a link back to the one it replaced. Where it is not, it keeps the
// verdict and the rules version it was given and is marked historical; only
// checking the account again can move it.
//
// No network: `checkedAt` and `observedAt` are left alone, because the
// observations are still the ones made at that time.
// Do not run while scripts/prescan.ts is writing the same file.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { computeVerdict, CLASSIFIER_VERSION } from '../src/engine/verdict';
import { explain } from '../src/engine/evidence';
import {
  missingForCurrentRules,
  legacySourceCoverage,
  historicalReason,
  OBSERVATION_SCHEMA_VERSION,
  ASSET_REGISTRY_VERSION,
} from '../src/engine/observation';
import { shareCard } from '../src/engine/share';
import { knownServiceName } from '../src/sources/normalize';
import { snapshotId } from '../src/snapshot';
import type { Gallery } from '../src/gallery';
import type { LinkedHedgeFeatures, HedgeCoverage } from '../src/engine/features';

const path = process.argv[2] ?? 'data/gallery.json';
const gallery = JSON.parse(readFileSync(path, 'utf-8')) as Gallery;
const now = new Date().toISOString();

/** Drops funders since confirmed to be exchange or bridge addresses. Their
 * balances are that service's, not the checked account's, and the scan that
 * wrote this file had no way to tell. */
function withoutServices(
  linked: LinkedHedgeFeatures | null,
  headlineNotionalUsd: number,
): { linked: LinkedHedgeFeatures | null; dropped: string[] } {
  if (!linked) return { linked, dropped: [] };
  const dropped = linked.funders.filter((f) => knownServiceName(f.address) !== null);
  if (dropped.length === 0) return { linked, dropped: [] };
  const funders = linked.funders.filter((f) => knownServiceName(f.address) === null);
  const linkedHedgeUsd = funders.reduce((s, f) => s + f.matchingUsd, 0);
  return {
    linked: {
      linkedHedgeUsd,
      linkedHedgeRatio: headlineNotionalUsd > 0 ? linkedHedgeUsd / headlineNotionalUsd : 0,
      funders,
    },
    dropped: dropped.map((f) => `${knownServiceName(f.address)}`),
  };
}

/** Entries scanned before hedgeCoverage existed still recorded what happened,
 * in hedgeScope and in the coverage notes. Read it back rather than assume
 * the reading was complete. */
function legacyHedgeCoverage(e: Gallery['entries'][number]): HedgeCoverage {
  if (e.hedgeCoverage) return e.hedgeCoverage;
  if (e.hedgeScope === 'none') return 'not-applicable';
  if (e.coverage.some((c) => c.includes('Holdings on other chains unavailable'))) return 'missing';
  if (e.coverage.some((c) => c.includes('first 100 tokens only'))) return 'partial';
  return e.hedgeScope === 'all-chains' ? 'complete' : 'partial';
}

let reverdicted = 0;
let reexplained = 0;
let serviceFunders = 0;
let historical = 0;
gallery.entries = gallery.entries.map((e) => {
  const missing = missingForCurrentRules(e);
  if (missing.length > 0) {
    // Kept exactly as it was read, under the rules that read it. Anything
    // else would be this file asserting an answer it cannot reproduce. The
    // share card is rebuilt, because that is presentation rather than
    // judgement and a picture of a historical card has to say so.
    historical++;
    const kept = { ...e, historical: { reason: historicalReason(missing), missing } };
    return { ...kept, share: shareCard(kept, { kind: 'gallery', snapshotId: kept.snapshotId }) };
  }

  const { linked, dropped } = withoutServices(e.linkedHedge, e.positions.headlineNotionalUsd);
  const coverage = [...e.coverage];
  for (const name of dropped) {
    const note = `A wallet that funded this account is ${name}, an exchange address: its balances are not counted here`;
    if (!coverage.includes(note)) coverage.push(note);
  }
  if (dropped.length > 0) serviceFunders += dropped.length;

  const hedgeCoverage = legacyHedgeCoverage(e);
  const sources = legacySourceCoverage(e);
  // The scan did not record when its sources measured what they returned, so
  // these cards can only say that they do not know.
  const positionsAsOf = e.positionsAsOf ?? null;
  const degraded =
    e.degraded ??
    (hedgeCoverage === 'missing' ||
      hedgeCoverage === 'partial' ||
      sources.orders !== 'complete' ||
      sources.positions !== 'complete');
  const verdict = computeVerdict({
    positions: e.positions,
    orders: e.orders,
    hedge: e.hedge,
    trades: { tradesPerDay: e.trades.tradesPerDay, crossedShare: e.trades.crossedShare, buyShare: e.trades.buyShare },
    linkedHedge: linked ? { linkedHedgeRatio: linked.linkedHedgeRatio } : undefined,
    hedgeCoverage,
    ordersCoverage: sources.orders,
    positionsCoverage: sources.positions,
  });
  const next = {
    ...e,
    verdict,
    linkedHedge: linked,
    coverage,
    hedgeCoverage,
    ordersCoverage: sources.orders,
    positionsCoverage: sources.positions,
    positionsAsOf,
    degraded,
    classifierVersion: CLASSIFIER_VERSION,
    observationSchemaVersion: e.observationSchemaVersion ?? OBSERVATION_SCHEMA_VERSION,
    assetRegistryVersion: ASSET_REGISTRY_VERSION,
    observedAt: e.observedAt ?? positionsAsOf ?? e.checkedAt,
    interpretedAt: now,
    previousInterpretation: {
      verdict: e.verdict.verdict,
      classifierVersion: e.classifierVersion,
      interpretedAt: e.interpretedAt ?? e.checkedAt,
    },
    snapshotId: e.snapshotId ?? snapshotId(e.address, e.checkedAt),
  };
  const { summary, evidence } = explain(next);
  const judged = { ...next, summary, evidence };

  if (JSON.stringify(verdict) !== JSON.stringify(e.verdict)) reverdicted++;
  if (summary !== e.summary || JSON.stringify(evidence) !== JSON.stringify(e.evidence)) reexplained++;
  return { ...judged, share: shareCard(judged, { kind: 'gallery', snapshotId: judged.snapshotId }) };
});

writeFileSync(`${path}.tmp`, JSON.stringify(gallery, null, 1) + '\n');
renameSync(`${path}.tmp`, path);
console.log(
  `${gallery.entries.length} entries: ${historical} kept as history (observation predates the rules), ` +
    `${reverdicted} re-judged, ${reexplained} re-explained, ${serviceFunders} exchange funder(s) dropped`,
);
