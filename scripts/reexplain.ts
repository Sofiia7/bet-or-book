// Rebuilds the verdict, summary and evidence of every gallery entry from the
// numbers already stored in it, with the current engine. No network: a rules
// fix never needs the credits spent on the scan again. `checkedAt` is left
// alone - the observations are still the ones made at that time, only their
// reading has changed.
// Do not run while scripts/prescan.ts is writing the same file.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { computeVerdict } from '../src/engine/verdict';
import { explain } from '../src/engine/evidence';
import { knownServiceName } from '../src/sources/normalize';
import type { Gallery } from '../src/gallery';
import type { LinkedHedgeFeatures, HedgeCoverage } from '../src/engine/features';

const path = process.argv[2] ?? 'data/gallery.json';
const gallery = JSON.parse(readFileSync(path, 'utf-8')) as Gallery;

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
gallery.entries = gallery.entries.map((e) => {
  const { linked, dropped } = withoutServices(e.linkedHedge, e.positions.headlineNotionalUsd);
  const coverage = [...e.coverage];
  for (const name of dropped) {
    const note = `A wallet that funded this account is ${name}, an exchange address: its balances are not counted here`;
    if (!coverage.includes(note)) coverage.push(note);
  }
  if (dropped.length > 0) serviceFunders += dropped.length;

  const hedgeCoverage = legacyHedgeCoverage(e);
  const verdict = computeVerdict({
    positions: e.positions,
    orders: e.orders,
    hedge: e.hedge,
    trades: { tradesPerDay: e.trades.tradesPerDay, crossedShare: e.trades.crossedShare, buyShare: e.trades.buyShare },
    linkedHedge: linked ? { linkedHedgeRatio: linked.linkedHedgeRatio } : undefined,
    hedgeCoverage,
  });
  const next = { ...e, verdict, linkedHedge: linked, coverage, hedgeCoverage };
  const { summary, evidence } = explain(next);

  if (JSON.stringify(verdict) !== JSON.stringify(e.verdict)) reverdicted++;
  if (summary !== e.summary || JSON.stringify(evidence) !== JSON.stringify(e.evidence)) reexplained++;
  return { ...next, summary, evidence };
});

writeFileSync(`${path}.tmp`, JSON.stringify(gallery, null, 1) + '\n');
renameSync(`${path}.tmp`, path);
console.log(
  `${gallery.entries.length} entries, ${reverdicted} re-judged, ${reexplained} re-explained, ` +
    `${serviceFunders} exchange funder(s) dropped`,
);
