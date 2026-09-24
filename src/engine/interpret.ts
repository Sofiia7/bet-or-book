/**
 * The rules, and the words and picture made from them, applied to an
 * observation. No I/O anywhere in this file.
 *
 * src/api/check.ts used to read the sources, decide the verdict and write
 * the card in one function, and scripts/reexplain.ts decided the verdict and
 * wrote the card a second time for the gallery: the same rules and the same
 * sentences, in two places free to drift apart (23.09 audit, "code and
 * architecture"). Both now come through here. `interpret` is the rules;
 * `present` is everything a reader sees made from what the rules decided.
 */
import type { CheckResult } from '../api/check';
import { computeVerdict, CLASSIFIER_VERSION } from './verdict';
import { verdictInputOf, type Observation } from './observation';
import { explain, type EvidenceInput } from './evidence';
import { exposureBreakdown } from './breakdown';
import { shareCard, type ShareCardOptions } from './share';

/** An observation with the current rules' verdict on it. */
export type Interpreted = Observation & Pick<CheckResult, 'verdict' | 'classifierVersion' | 'interpretedAt'>;

export function interpret(o: Observation, interpretedAt: string): Interpreted {
  return { ...o, verdict: computeVerdict(verdictInputOf(o)), classifierVersion: CLASSIFIER_VERSION, interpretedAt };
}

/** The sentence, the evidence rows and the diagram for one reading - the
 * part of a card the gallery re-explain rebuilds as well. */
export function words(r: EvidenceInput) {
  const { summary, evidence } = explain(r);
  return { summary, evidence, breakdown: exposureBreakdown(r.positions, r.hedge, r.linkedHedge, r.hedgeCoverage) };
}

/**
 * A reading as the page, the API and the picture receive it. Fields are
 * laid out in the order the single function before this one wrote them, so
 * a stored reading reads the same whichever version of the code made it.
 */
export function present(r: Interpreted, share: ShareCardOptions = { kind: 'live' }): CheckResult {
  const judged = {
    verdict: r.verdict,
    positions: r.positions,
    orders: r.orders,
    hedge: r.hedge,
    hedgeScope: r.hedgeScope,
    hedgeCoverage: r.hedgeCoverage,
    ordersCoverage: r.ordersCoverage,
    positionsCoverage: r.positionsCoverage,
    linkedHedge: r.linkedHedge,
    trades: r.trades,
    pnl: r.pnl,
    sizeVsOi: r.sizeVsOi,
    source: r.source,
    focus: r.focus,
    positionsAsOf: r.positionsAsOf,
    classifierVersion: r.classifierVersion,
    observationSchemaVersion: r.observationSchemaVersion,
    assetRegistryVersion: r.assetRegistryVersion,
    observedAt: r.observedAt,
    interpretedAt: r.interpretedAt,
    degraded: r.degraded,
  };
  const { summary, evidence, breakdown } = words(judged);
  const result = {
    address: r.address,
    ...judged,
    summary,
    evidence,
    breakdown,
    vitals: r.vitals,
    coverage: r.coverage,
    coverageNotes: r.coverageNotes,
    checkedAt: r.checkedAt,
  };
  return { ...result, share: shareCard(result, share) };
}
