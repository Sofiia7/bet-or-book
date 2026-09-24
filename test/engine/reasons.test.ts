// U06, audit of 23.09: "How this was decided" says the rule in words, and
// keeps the reason code for the technical details underneath.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ruleExplanation, badgeQualifier } from '../../src/engine/reasons';
import { DEFAULT_THRESHOLDS, type VerdictResult } from '../../src/engine/verdict';

const verdictSource = readFileSync(new URL('../../src/engine/verdict.ts', import.meta.url), 'utf8');

/** Every reason the current rules actually return, read from the calls in
 * the rules themselves rather than from the type that is meant to list them,
 * so the two are checked against each other. */
function reasonsTheRulesReturn(): string[] {
  const codes = new Set<string>();
  for (const [, list] of verdictSource.matchAll(/decided\([^;]*?(\[[^\]]*\])\)/g)) {
    for (const [, code] of list.matchAll(/'([^']+)'/g)) codes.add(code);
  }
  return [...codes];
}

/** The rules' own list of the reasons they can give: the ReasonCode type,
 * with the signs of a book it takes from BookSignal. */
function reasonsTheTypeLists(): string[] {
  const literals = (name: string) =>
    [...new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(verdictSource)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return [...literals('ReasonCode'), ...literals('BookSignal')];
}

const v = (verdict: VerdictResult['verdict'], reasons: string[], strength: VerdictResult['strength'] = null) => ({
  verdict,
  strength,
  reasons,
});

describe('ruleExplanation', () => {
  it('has words for every reason the current rules can give', () => {
    const codes = reasonsTheRulesReturn();
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) {
      expect(ruleExplanation(v('unknown', [code])), code).toEqual(expect.any(String));
    }
  });

  it('lists in its type exactly the reasons the rules return', () => {
    const listed = new Set(reasonsTheTypeLists());
    for (const code of reasonsTheRulesReturn()) expect(listed.has(code), code).toBe(true);
    // The book signals are returned as a list built at run time, not as
    // literals, so they are checked by name.
    for (const signal of ['positions', 'orders', 'trades']) expect(listed.has(signal), signal).toBe(true);
  });

  it('has words for every sign of a book, whichever the rules found first', () => {
    const signals = [...verdictSource.matchAll(/signals\.push\('([^']+)'\)/g)].map((m) => m[1]);
    expect(signals).toEqual(expect.arrayContaining(['positions', 'orders', 'trades']));
    const text = ruleExplanation(v('book', ['positions', 'orders', 'trades'], 'strong'))!;
    expect(text).toMatch(/^Called a book because this account quotes/);
    expect(text).toContain('a spread of positions typical of a book');
    expect(text).toContain('busy two-sided trading');
  });

  it('takes its numbers from the thresholds the rules use, not from a copy', () => {
    const h = DEFAULT_THRESHOLDS.hedged;
    const hedge = ruleExplanation(v('hedged', ['hedge_leg']))!;
    expect(hedge).toContain(`${Math.round(h.minHedgeRatio * 100)}%`);
    expect(hedge).toContain(`${Math.round(h.maxHedgeRatio * 100)}%`);
    const bet = ruleExplanation(v('looks_like_a_bet', ['directional_concentration']))!;
    expect(bet).toContain(`at most ${DEFAULT_THRESHOLDS.bet.maxPositions} positions`);
  });

  it('says a hedge covers visible balances, not the account\'s whole risk (L12)', () => {
    expect(ruleExplanation(v('hedged', ['hedge_leg']))).toMatch(/nothing about debt, margin/);
  });

  it('does not read an earlier reading by the current rules', () => {
    expect(ruleExplanation(v('book', ['orders'], 'strong'), true)).toMatch(/^Read by an earlier version of the rules/);
  });

  it('says nothing rather than guess at a code it has no words for', () => {
    expect(ruleExplanation(v('unknown', ['a_code_from_rules_long_gone']))).toBeNull();
    expect(ruleExplanation(v('unknown', []))).toBeNull();
  });
});

describe('badgeQualifier', () => {
  it('gives a short phrase for a funding-link Unknown', () => {
    expect(badgeQualifier(v('unknown', ['linked_exposure_unverified']))).toBe('assets sit with funders');
  });

  it('gives a short phrase for a hedge that was never checked', () => {
    expect(badgeQualifier(v('unknown', ['hedge_not_checked']))).toBe('hedge not checked');
  });

  it('gives no qualifier when there is nothing open', () => {
    expect(badgeQualifier(v('unknown', ['no open positions found']))).toBeNull();
  });

  it('gives no qualifier for a historical reading', () => {
    expect(badgeQualifier(v('unknown', ['linked_exposure_unverified']), true)).toBeNull();
  });

  it('has a phrase for every reason ruleExplanation knows about', () => {
    const reasons = [
      'orders', 'balanced_book', 'hedge_leg', 'over_covered', 'hedge_not_checked', 'unrecognised_assets',
      'maker_flow_only', 'partial_offset', 'quotes_not_checked', 'positions_not_complete',
      'directional_concentration', 'directional_portfolio', 'offset_not_measured', 'mixed_long_short_book',
      'diversified_book_no_quotes', 'linked_exposure_unverified',
      'signals disagree: not enough evidence for book, hedge, or bet',
    ];
    for (const r of reasons) {
      expect(badgeQualifier(v('unknown', [r])), r).toEqual(expect.any(String));
      expect(ruleExplanation(v('unknown', [r])), r).toEqual(expect.any(String));
    }
  });
});
