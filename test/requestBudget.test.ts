import { describe, expect, it } from 'vitest';
import {
  CHECK_REQUEST_LIMIT,
  REQUEST_LIMIT_REASON,
  RequestBudgetExceeded,
  attachRequestBudget,
  chargeRequest,
  createRequestBudget,
  isRequestBudgetExceeded,
  requestBudgetOf,
} from '../src/requestBudget';

describe('request budget', () => {
  it('counts takes and refuses the one past the limit', () => {
    const budget = createRequestBudget(5);
    for (let i = 0; i < 3; i++) budget.take('hyperliquid');
    expect(budget.used()).toBe(3);
    expect(budget.remaining()).toBe(2);
    budget.take('hyperliquid');
    budget.take('hyperliquid');
    let caught: unknown;
    try {
      budget.take('explorer');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RequestBudgetExceeded);
    expect(isRequestBudgetExceeded(caught)).toBe(true);
    const exceeded = caught as RequestBudgetExceeded;
    expect(exceeded.source).toBe('explorer');
    expect(exceeded.limit).toBe(5);
    expect(exceeded.message).toBe('request limit reached: explorer not sent (5 per check)');
    expect(budget.used()).toBe(5);
  });

  it('affords n requests while keeping some in reserve, without spending any', () => {
    const three = createRequestBudget(5);
    three.take('x');
    three.take('x');
    expect(three.remaining()).toBe(3);
    expect(three.affords(2, 1)).toBe(true);
    const two = createRequestBudget(5);
    for (let i = 0; i < 3; i++) two.take('x');
    expect(two.remaining()).toBe(2);
    expect(two.affords(2, 1)).toBe(false);
    expect(two.affords(2)).toBe(true);
    expect(two.used()).toBe(3);
  });

  it('defaults to the check limit and builds the reason from it', () => {
    expect(createRequestBudget().limit).toBe(CHECK_REQUEST_LIMIT);
    expect(CHECK_REQUEST_LIMIT).toBe(45);
    expect(REQUEST_LIMIT_REASON).toBe(`this check reached its limit of ${CHECK_REQUEST_LIMIT} outbound requests`);
  });

  it('charges nothing when no budget is attached', () => {
    expect(() => chargeRequest(undefined, 'x')).not.toThrow();
    const bare = new AbortController().signal;
    expect(() => chargeRequest(bare, 'x')).not.toThrow();
    expect(requestBudgetOf(bare)).toBeNull();
    expect(requestBudgetOf(undefined)).toBeNull();
  });

  it('charges the budget attached to that signal only', () => {
    const a = new AbortController().signal;
    const b = new AbortController().signal;
    const budgetA = createRequestBudget(10);
    const budgetB = createRequestBudget(10);
    attachRequestBudget(a, budgetA);
    attachRequestBudget(b, budgetB);
    chargeRequest(a, 'x');
    chargeRequest(a, 'x');
    chargeRequest(b, 'x');
    expect(requestBudgetOf(a)).toBe(budgetA);
    expect(budgetA.used()).toBe(2);
    expect(budgetB.used()).toBe(1);
  });
});
