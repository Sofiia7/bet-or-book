import { describe, expect, it } from 'vitest';
import galleryData from '../data/gallery.json';
import { computeVerdict, CLASSIFIER_VERSION } from '../src/engine/verdict';
import { explain } from '../src/engine/evidence';
import { missingForCurrentRules, verdictInputOf } from '../src/engine/observation';
import type { Gallery } from '../src/gallery';

/**
 * The 18 September scan, 277 accounts with something open, read against the
 * rules as they stand.
 *
 * This is not a measurement of how often the verdicts are right: nobody has
 * independently established what these accounts were actually doing, and the
 * audit is explicit that the three calibration addresses are smoke tests
 * rather than a precision estimate. What it does is hold the rules to the
 * whole sample instead of to a handful of hand-built inputs, so a change to
 * a threshold cannot quietly move a hundred cards and a change to the
 * wording cannot quietly contradict what is on the page.
 *
 * Since the 21.09 audit the sample is in two parts. Entries whose stored
 * observation carries what the current rules read are re-judged by them and
 * have to reproduce exactly. Entries from an older schema keep the verdict
 * the older rules gave them and are marked historical: re-running v3 over an
 * aggregate that never recorded order notional or what the hedge sum left
 * out would be an assertion, not a check. Only a fresh read of the account
 * can move one of those, which costs credits and is a decision, not a
 * script.
 *
 * When a rule changes on purpose, run `scripts/reexplain.ts` and the numbers
 * below move with it. That is the point: the blast radius is visible in the
 * diff rather than discovered on the deployed page.
 */
const gallery = galleryData as unknown as Gallery;
// A reading that has been read again is kept so the two can be compared,
// and is addressable by its own id - but it is not part of the set the
// page lists, and counting it would count that account twice.
const live = gallery.entries.filter((e) => !e.superseded);
const open = live.filter((e) => e.positions.nPositions > 0);
const current = live.filter((e) => !e.historical);
const historical = live.filter((e) => e.historical);

const rejudge = (e: Gallery['entries'][number]) => computeVerdict(verdictInputOf(e));

describe('the saved gallery against the current rules', () => {
  it('has something to judge', () => {
    expect(open.length).toBe(277);
    expect(live.length).toBe(278);
    // 22 from live re-reads, plus 7 the 23.09 rule changes (L01, L07) gave a
    // new interpretation and a new id, keeping the old one intact at its own.
    expect(gallery.entries.filter((e) => e.superseded).length).toBe(29);
  });

  it('reproduces every stored verdict it claims to have judged', () => {
    const drifted = current
      .map((e) => ({ address: e.address, stored: e.verdict, fresh: rejudge(e) }))
      .filter((r) => JSON.stringify(r.stored) !== JSON.stringify(r.fresh));
    expect(drifted).toEqual([]);
  });

  it('reproduces every stored sentence, so the page cannot contradict the rules', () => {
    const drifted = current.filter((e) => explain(e).summary !== e.summary).map((e) => e.address);
    expect(drifted).toEqual([]);
  });

  it('stamps every judged card with the rules that read it', () => {
    expect(new Set(current.map((e) => e.classifierVersion))).toEqual(new Set([CLASSIFIER_VERSION]));
  });

  it('never stamps a historical card with rules that never read it', () => {
    // This is the whole of finding A06: the old file said v2 on 269 cards
    // whose observations v2 could not have been run over.
    for (const e of historical) {
      expect(e.classifierVersion).not.toBe(CLASSIFIER_VERSION);
      expect(e.historical!.missing.length).toBeGreaterThan(0);
    }
  });

  it('marks as historical exactly those entries the rules cannot read', () => {
    const wrong = live.filter((e) => (missingForCurrentRules(e).length > 0) !== Boolean(e.historical));
    expect(wrong.map((e) => e.address)).toEqual([]);
  });

  it('holds the split the README quotes', () => {
    const count = (list: typeof open, verdict: string) =>
      list.filter((e) => e.verdict.verdict === verdict).length;
    const openCurrent = open.filter((e) => !e.historical);
    expect({
      judged: openCurrent.length,
      looks_like_a_bet: count(openCurrent, 'looks_like_a_bet'),
      unknown: count(openCurrent, 'unknown'),
      book: count(openCurrent, 'book'),
      hedged: count(openCurrent, 'hedged'),
      history: open.length - openCurrent.length,
      // The 23.09 rules (L01) require the headline market itself quoted on
      // both sides, not just enough two-sided activity somewhere in the
      // account - and no stored scan ever recorded that for one market
      // alone. The three cards that used to read "book" here are not
      // reclassified on a guess; they are the difference in `history`,
      // waiting on a fresh check the way any account is once a rule needs a
      // number scanned before that rule existed did not capture.
    }).toEqual({ judged: 177, looks_like_a_bet: 132, unknown: 38, book: 0, hedged: 7, history: 100 });
  });

  it('gives every card its own share id', () => {
    const ids = gallery.entries.map((e) => e.snapshotId);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(gallery.entries.length);
  });

  it('pairs every re-read with the reading it replaced', () => {
    const replaced = gallery.entries.filter((e) => e.superseded);
    for (const old of replaced) {
      const current = live.find((e) => e.address === old.address);
      expect(current?.supersedes).toBe(old.snapshotId);
      expect(old.supersededBy).toBe(current?.snapshotId);
      // The point of keeping it is that the two are of different moments -
      // a later observation (a live re-check) or, since the 23.09 audit's
      // L03 fix, the same observation given a later interpretation (a rule
      // change re-judging it via scripts/reexplain.ts). Either is real; the
      // two must not be equal in both.
      const laterObservation = old.checkedAt < (current?.checkedAt ?? '');
      const laterInterpretation = (old.interpretedAt ?? '') < (current?.interpretedAt ?? '');
      expect(laterObservation || laterInterpretation).toBe(true);
    }
  });

  it('never calls a funding wallet a hedge, however much it holds', () => {
    const wrong = open.filter(
      (e) => e.verdict.verdict === 'hedged' && (e.linkedHedge?.linkedHedgeRatio ?? 0) > 0 && e.hedge.hedgeRatio === 0,
    );
    expect(wrong).toEqual([]);
  });

  it('never calls a short hedged on coverage outside the band', () => {
    const wrong = open
      .filter((e) => e.verdict.reasons.includes('hedge_leg'))
      .filter((e) => e.hedge.hedgeRatio < 0.85 || e.hedge.hedgeRatio > 1.15)
      .map((e) => [e.address, e.hedge.hedgeRatio]);
    expect(wrong).toEqual([]);
  });

  it('never calls a position a book without two-sided quoting behind it', () => {
    const wrong = current
      .filter((e) => e.verdict.verdict === 'book')
      .filter((e) => !e.verdict.reasons.includes('orders'))
      .map((e) => e.address);
    expect(wrong).toEqual([]);
  });

  it('gives every withheld verdict a reason a reader can act on', () => {
    const named = new Set([
      'linked_exposure_unverified',
      'mixed_long_short_book',
      'offset_not_measured',
      'hedge_not_checked',
      'unrecognised_assets',
      'diversified_book_no_quotes',
      'quotes_not_checked',
      'positions_not_complete',
      'partial_offset',
      'over_covered',
      'maker_flow_only',
      'signals disagree: not enough evidence for book, hedge, or bet',
      'no open positions found',
    ]);
    const unnamed = current
      .filter((e) => e.verdict.verdict === 'unknown')
      .filter((e) => !e.verdict.reasons.every((r) => named.has(r)))
      .map((e) => e.verdict.reasons);
    expect(unnamed).toEqual([]);
  });
});
