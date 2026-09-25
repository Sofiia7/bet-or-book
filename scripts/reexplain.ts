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
// A changed verdict used to overwrite the entry under its existing id, so a
// link to it opened whatever this script last decided rather than what its
// first reader saw - the 23.09 audit found the same id reading "Unknown"
// one day and "Looks like a bet" the next. Now a verdict change mints a new
// id for the new interpretation and keeps the old entry, frozen exactly as
// it was, addressable at its own old id - the same supersedes/supersededBy
// pairing a live re-check already uses (src/index.ts), so the two produce
// one consistent history rather than two different ones. A wording-only
// change (the sentence changed, the verdict word did not) still updates the
// entry in place: forking a new id for every phrasing fix would be its own
// kind of churn, and the promise this exists to keep is about the verdict,
// not the prose.
//
// No network: `checkedAt` and `observedAt` are left alone, because the
// observations are still the ones made at that time.
// Do not run while scripts/prescan.ts is writing the same file.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { computeVerdict, CLASSIFIER_VERSION } from '../src/engine/verdict';
import {
  missingForCurrentRules,
  legacySourceCoverage,
  historicalReason,
  verdictInputOf,
  ASSET_REGISTRY_VERSION,
} from '../src/engine/observation';
import { words } from '../src/engine/interpret';
import { shareCard } from '../src/engine/share';
import { knownServiceName } from '../src/sources/normalize';
import { snapshotId } from '../src/snapshot';
import type { Gallery } from '../src/gallery';
import type { LinkedHedgeFeatures, HedgeCoverage } from '../src/engine/features';

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

/** Entries scanned before linkedHedgeCoverage existed (A06, 25.09 audit) have
 * no record of whether a funder's balance fetch failed outright - the code
 * that ran them had no way to tell that case apart from "read, found
 * nothing" in the first place, which is the very bug A06 fixed. So the only
 * honest reading of an old entry's silence is the one the code before the
 * fix always assumed: a non-null linkedHedge means the search was carried
 * out in full. Defaulting an old entry to 'missing' or 'partial' instead
 * would invent a doubt about the read that nothing on the entry supports -
 * the opposite mistake from A06 itself. */
function legacyLinkedHedgeCoverage(e: Gallery['entries'][number]): HedgeCoverage {
  if (e.linkedHedgeCoverage) return e.linkedHedgeCoverage;
  return e.linkedHedge ? 'complete' : 'not-applicable';
}

export interface ReexplainStats {
  alreadySuperseded: number;
  historical: number;
  reverdicted: number;
  forked: number;
  reexplained: number;
  serviceFunders: number;
}

/** Old entries never recomputed `dataQuality` at all - not even a safe
 * default, since the field simply did not exist yet when they were written.
 * `exposureBreakdown()` must not be run on them (a stale `hedgeCoverage` or
 * missing `unverifiedUsd` would produce a confidently wrong answer, not a
 * cautious one) - so this just stamps the one honest value that makes no
 * claim either way. */
function withUnknownDataQuality(e: Gallery['entries'][number]): Gallery['entries'][number] {
  if (!e.breakdown?.applies || e.breakdown.dataQuality !== undefined) return e;
  return { ...e, breakdown: { ...e.breakdown, dataQuality: 'unknown' } };
}

/**
 * The pure transform: one gallery in, the re-judged gallery and a count of
 * what moved out. No file I/O, so a test can run it twice on the same
 * in-memory object and check the second pass leaves everything alone - which
 * is exactly the property a real bug broke (see the guard below) before this
 * was ever run for real on 2026-09-23.
 */
export function reexplainGallery(gallery: Gallery, now: string): { gallery: Gallery; stats: ReexplainStats } {
  const stats: ReexplainStats = {
    alreadySuperseded: 0,
    historical: 0,
    reverdicted: 0,
    forked: 0,
    reexplained: 0,
    serviceFunders: 0,
  };

  const entries = gallery.entries.flatMap((e): Gallery['entries'] => {
    // A superseded entry is a permanent record of what an earlier
    // interpretation said, kept only so its old id keeps resolving - never a
    // fresh observation to re-judge. Without this guard, a second run of
    // this script judged it against the current rules like any other entry,
    // found its frozen verdict "changed", and minted a new id that collided
    // with the one already handed to the reading that had in fact replaced
    // it - the same id claimed twice in one file. Caught on a dry run of
    // this very fix, before it ever shipped (23.09 audit, L03).
    if (e.superseded) {
      stats.alreadySuperseded++;
      return [withUnknownDataQuality(e)];
    }
    const missing = missingForCurrentRules(e);
    if (missing.length > 0) {
      // Kept exactly as it was read, under the rules that read it. Anything
      // else would be this file asserting an answer it cannot reproduce. The
      // share card is rebuilt, because that is presentation rather than
      // judgement and a picture of a historical card has to say so.
      stats.historical++;
      // Older scans never stored the raw per-position leverage, liquidation
      // price or PnL that vitals need - only the aggregate PositionFeatures
      // survives in this file - so there is nothing to recompute here.
      // hedgeCoverage genuinely is a verdict input elsewhere in this
      // codebase (verdict.ts reads it to decide whether a hedge was even
      // checked) - the reason backfilling it here is still safe is
      // narrower: this branch never calls verdictInputOf/computeVerdict at
      // all, so nothing on this path reads hedgeCoverage or
      // linkedHedgeCoverage as a verdict input. Backfilling both only fills
      // in the coverage state a historical entry would otherwise carry as
      // undefined when it predates the field, and leaves the frozen verdict
      // this branch exists to protect untouched (A06, 25.09 audit spec
      // review).
      const kept = withUnknownDataQuality({
        ...e,
        vitals: e.vitals ?? [],
        hedgeCoverage: legacyHedgeCoverage(e),
        linkedHedgeCoverage: legacyLinkedHedgeCoverage(e),
        historical: { reason: historicalReason(missing), missing },
      });
      return [{ ...kept, share: shareCard(kept, { kind: 'gallery', snapshotId: kept.snapshotId }) }];
    }

    const { linked, dropped } = withoutServices(e.linkedHedge, e.positions.headlineNotionalUsd);
    const coverage = [...e.coverage];
    for (const name of dropped) {
      const note = `A wallet that funded this account is ${name}, an exchange address: its balances are not counted here`;
      if (!coverage.includes(note)) coverage.push(note);
    }
    if (dropped.length > 0) stats.serviceFunders += dropped.length;

    const hedgeCoverage = legacyHedgeCoverage(e);
    const linkedHedgeCoverage = legacyLinkedHedgeCoverage(e);
    const sources = legacySourceCoverage(e);
    // The scan did not record when its sources measured what they returned,
    // so these cards can only say that they do not know.
    const positionsAsOf = e.positionsAsOf ?? null;
    const degraded =
      e.degraded ??
      (hedgeCoverage === 'missing' ||
        hedgeCoverage === 'partial' ||
        sources.orders !== 'complete' ||
        sources.positions !== 'complete');
    // The same rules input a live check builds (src/engine/observation.ts),
    // over what this entry recorded, read back where older scans did not
    // record it directly.
    const verdict = computeVerdict(
      verdictInputOf({
        ...e,
        linkedHedge: linked,
        hedgeCoverage,
        ordersCoverage: sources.orders,
        positionsCoverage: sources.positions,
      }),
    );
    const verdictChanged = JSON.stringify(verdict) !== JSON.stringify(e.verdict);
    const oldId = e.snapshotId ?? snapshotId(e.address, e.checkedAt);
    // A changed verdict is a new interpretation and gets a new id; a changed
    // rules version is baked into that id already (src/snapshot.ts), so the
    // two can never collide by construction as long as CLASSIFIER_VERSION was
    // actually bumped for the rule change that produced this verdict - the
    // same discipline the cache key and the gallery test already rely on.
    const newId = verdictChanged ? snapshotId(e.address, e.checkedAt, CLASSIFIER_VERSION) : oldId;
    const fork = verdictChanged && newId !== oldId;
    const next = {
      ...e,
      verdict,
      linkedHedge: linked,
      linkedHedgeCoverage,
      // Same limit as the historical branch: the raw position record vitals
      // need was never stored for this scan, live or re-judged.
      vitals: e.vitals ?? [],
      coverage,
      hedgeCoverage,
      ordersCoverage: sources.orders,
      positionsCoverage: sources.positions,
      positionsAsOf,
      degraded,
      classifierVersion: CLASSIFIER_VERSION,
      // An entry that recorded no version is from the first scan, before the
      // field existed. Stamping it with today's would claim it looked for
      // what later versions look for - loans, since version 5.
      observationSchemaVersion: e.observationSchemaVersion ?? 1,
      assetRegistryVersion: ASSET_REGISTRY_VERSION,
      observedAt: e.observedAt ?? positionsAsOf ?? e.checkedAt,
      interpretedAt: now,
      // Only a real change is worth recording, and the record must survive
      // this script being run twice: overwriting it on a second, identical
      // pass replaced the v2 verdict with the v3 one and lost exactly the
      // history the field exists to keep. Kept as a quick breadcrumb even now
      // that a verdict change also forks a full frozen entry below - this is
      // the one-line version, `supersedes` is the whole reading.
      previousInterpretation: verdictChanged
        ? { verdict: e.verdict.verdict, classifierVersion: e.classifierVersion, interpretedAt: e.interpretedAt ?? e.checkedAt }
        : e.previousInterpretation,
      snapshotId: newId,
      ...(fork ? { supersedes: oldId } : {}),
    };
    // The same sentence, rows and diagram a live check writes
    // (src/engine/interpret.ts), not a second copy of how to write them.
    const judged = { ...next, ...words(next) };
    const { summary, evidence } = judged;

    if (verdictChanged) stats.reverdicted++;
    if (summary !== e.summary || JSON.stringify(evidence) !== JSON.stringify(e.evidence)) stats.reexplained++;
    const judgedWithShare = { ...judged, share: shareCard(judged, { kind: 'gallery', snapshotId: judged.snapshotId }) };
    if (!fork) return [judgedWithShare];

    stats.forked++;
    // The old interpretation, kept exactly as it read, addressable at the id
    // that was already handed out for it. `withoutServices` and the coverage
    // note it adds are presentation of a fact discovered since (that a funder
    // is an exchange), not part of what the old rules decided, so this stays
    // as close to the original entry as `superseded`/`supersededBy` allow
    // rather than reusing `next`.
    const frozen = { ...e, snapshotId: oldId, superseded: true as const, supersededBy: newId };
    return [{ ...frozen, share: shareCard(frozen, { kind: 'gallery', snapshotId: oldId }) }, judgedWithShare];
  });

  return { gallery: { ...gallery, entries }, stats };
}

function main() {
  const path = process.argv[2] ?? 'data/gallery.json';
  const gallery = JSON.parse(readFileSync(path, 'utf-8')) as Gallery;
  const { gallery: next, stats } = reexplainGallery(gallery, new Date().toISOString());

  writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 1) + '\n');
  renameSync(`${path}.tmp`, path);
  console.log(
    `${next.entries.length} entries: ${stats.alreadySuperseded} already-superseded readings left untouched, ` +
      `${stats.historical} kept as history (observation predates the rules), ` +
      `${stats.reverdicted} re-judged (${stats.forked} forked into a new id, old reading kept), ` +
      `${stats.reexplained} re-explained, ${stats.serviceFunders} exchange funder(s) dropped`,
  );
}

// Comparing argv[1] keeps `main()` from running - and touching
// data/gallery.json - when this module is imported for its exports (a test)
// rather than executed directly as a script.
if (process.argv[1] && process.argv[1].endsWith('reexplain.ts')) {
  main();
}
