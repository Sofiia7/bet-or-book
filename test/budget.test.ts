import { describe, expect, it } from 'vitest';
import { BudgetLedger, WORST_CASE_CALLS } from '../src/budget';

const DAY = '2026-09-21';
const T0 = Date.parse('2026-09-21T10:00:00Z');
const limits = (cap: number, floor = 0) => ({ cap, floor });

describe('BudgetLedger', () => {
  it('refuses a second check when the two together could pass the cap', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 7, limits(10), T0);
    const b = ledger.reserve(DAY, 7, limits(10), T0);
    expect(a.ok).toBe(true);
    // This is the whole point: b is refused while a is still running, before
    // a has spent anything and before any counter has been written back.
    expect(b.ok).toBe(false);
  });

  it('gives back what a check did not spend', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 7, limits(10), T0);
    ledger.settle(a.id!, 2, null, T0);
    expect(ledger.snapshot().spent).toBe(2);
    expect(ledger.snapshot().reserved).toBe(0);
    expect(ledger.reserve(DAY, 7, limits(10), T0).ok).toBe(true);
  });

  it('charges the reservation, not the estimate, when a check spends more than it said', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 2, limits(10), T0);
    ledger.settle(a.id!, 5, null, T0);
    expect(ledger.snapshot().spent).toBe(5);
  });

  it('charges a reservation whose request never came back, rather than freeing it', () => {
    const ledger = new BudgetLedger();
    expect(ledger.reserve(DAY, 7, limits(10), T0).ok).toBe(true);
    expect(ledger.reserve(DAY, 7, limits(10), T0 + 60_000).ok).toBe(false);
    // The worst case is four paid stages of 20 s each plus the free reads,
    // so past that the request is gone - but Nansen may have served and
    // charged every call it covered, and an unknown outcome is not a zero
    // one. The hold stops being reserved and starts being spent.
    expect(ledger.reserve(DAY, 7, limits(10), T0 + 301_000).ok).toBe(false);
    expect(ledger.snapshot().reserved).toBe(0);
    expect(ledger.snapshot().spent).toBe(7);
    expect(ledger.snapshot().uncertainSpent).toBe(7);
  });

  it('starts the count again on a new day', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 7, limits(10), T0);
    ledger.settle(a.id!, 7, null, T0);
    expect(ledger.reserve(DAY, 7, limits(10), T0).ok).toBe(false);
    expect(ledger.reserve('2026-09-22', 7, limits(10), T0 + 86_400_000).ok).toBe(true);
    expect(ledger.snapshot().spent).toBe(0);
  });

  it("stops before the account's own balance runs to the floor", () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 2, limits(1000, 5), T0);
    ledger.settle(a.id!, 2, 8, T0);
    // 8 left, 5 held back, so there is room for 3 and not for 7.
    expect(ledger.reserve(DAY, 7, limits(1000, 5), T0).ok).toBe(false);
    expect(ledger.reserve(DAY, 3, limits(1000, 5), T0).ok).toBe(true);
  });

  it('stops for the rest of the day when Nansen refuses a call', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 2, limits(1000, 5), T0);
    ledger.settle(a.id!, 1, null, T0, true);
    expect(ledger.snapshot().remaining).toBe(0);
    expect(ledger.reserve(DAY, 1, limits(1000, 5), T0).ok).toBe(false);
  });

  it('survives being written out and read back', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 7, limits(10), T0);
    ledger.settle(a.id!, 4, 500, T0);
    const revived = new BudgetLedger(JSON.parse(JSON.stringify(ledger.snapshot())));
    expect(revived.snapshot()).toMatchObject({
      day: DAY,
      spent: 4,
      spentByDay: { [DAY]: 4 },
      reserved: 0,
      remaining: 500,
      uncertainSpent: 0,
      holds: {},
      orphaned: {},
    });
    expect(revived.reserve(DAY, 7, limits(10), T0).ok).toBe(false);
  });

  it('knows what one check can cost at worst', () => {
    // positions, PnL, own balances, two related-wallet chains, two funders.
    expect(WORST_CASE_CALLS).toBe(7);
  });
});
