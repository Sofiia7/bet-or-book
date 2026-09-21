// S01 and S02, audit of 21.09: a cap that can be walked past by a request
// that died, or reset by a calendar day turning over, is not a cap.
import { describe, expect, it } from 'vitest';
import { BudgetLedger } from '../src/budget';

const DAY = '2026-09-21';
const NEXT = '2026-09-22';
const T0 = Date.parse(`${DAY}T12:00:00Z`);
const limits = { cap: 7, floor: 0 };

describe('S01: a reservation nobody settled is money that may have been spent', () => {
  it('does not hand an expired hold back as if the calls were never made', () => {
    const ledger = new BudgetLedger();
    const first = ledger.reserve(DAY, 7, limits, T0);
    expect(first.ok).toBe(true);
    // The Worker died after Nansen served the calls, so nothing settled.
    const after = ledger.reserve(DAY, 7, limits, T0 + 300_001);
    expect(after.ok).toBe(false);
    const state = ledger.snapshot();
    expect(state.spent).toBe(7);
    expect(state.uncertainSpent).toBe(7);
  });

  it('corrects the charge once when the settle finally arrives', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 7, limits, T0);
    ledger.reserve(DAY, 7, limits, T0 + 300_001); // expires the hold
    expect(ledger.snapshot().spent).toBe(7);

    ledger.settle(hold.id!, 2, null, T0 + 400_000);
    expect(ledger.snapshot().spent).toBe(2);
    expect(ledger.snapshot().uncertainSpent).toBe(0);
  });

  it('charges a redelivered settle exactly once', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 7, { cap: 300, floor: 0 }, T0);
    ledger.settle(hold.id!, 3, null, T0 + 1000);
    ledger.settle(hold.id!, 3, null, T0 + 2000);
    ledger.settle(hold.id!, 3, null, T0 + 3000);
    expect(ledger.snapshot().spent).toBe(3);
  });
});

describe('S02: midnight is not a top-up', () => {
  it('keeps the account balance the API last reported across the day boundary', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 1, { cap: 300, floor: 5 }, T0);
    ledger.settle(hold.id!, 1, 5, T0 + 1000);
    // 5 credits left and a floor of 5: nothing more may be spent today, and
    // nothing about tomorrow makes those credits reappear.
    const tomorrow = ledger.reserve(NEXT, 7, { cap: 300, floor: 5 }, T0 + 86_400_000);
    expect(tomorrow.ok).toBe(false);
    expect(ledger.snapshot().remaining).toBe(5);
  });

  it('starts the daily cap again while the balance stays where it was', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 7, { cap: 7, floor: 0 }, T0);
    ledger.settle(hold.id!, 7, 1_000, T0 + 1000);
    expect(ledger.reserve(DAY, 7, { cap: 7, floor: 0 }, T0 + 2000).ok).toBe(false);
    expect(ledger.reserve(NEXT, 7, { cap: 7, floor: 0 }, T0 + 86_400_000).ok).toBe(true);
    expect(ledger.snapshot().remaining).toBe(1_000);
  });

  it('does not throw away a reservation that is still running at midnight', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 7, { cap: 300, floor: 0 }, T0);
    // A check that started at 23:59:58 settles two seconds into the new day.
    ledger.reserve(NEXT, 1, { cap: 300, floor: 0 }, T0 + 1000);
    ledger.settle(hold.id!, 4, null, T0 + 2000);
    expect(ledger.snapshot().spentByDay[DAY]).toBe(4);
    expect(ledger.snapshot().uncertainSpent).toBe(0);
  });

  it('ignores a stale balance report arriving after a fresher one', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0);
    const b = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 100);
    ledger.settle(b.id!, 1, 900, T0 + 5_000);
    ledger.settle(a.id!, 1, 950, T0 + 1_000); // measured earlier, delivered later
    expect(ledger.snapshot().remaining).toBe(900);
  });

  it('takes a top-up through its own path rather than waiting for a call', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 1, { cap: 300, floor: 5 }, T0);
    ledger.settle(hold.id!, 1, 5, T0 + 1000);
    expect(ledger.reserve(DAY, 7, { cap: 300, floor: 5 }, T0 + 2000).ok).toBe(false);
    ledger.syncBalance(1_000, T0 + 3000);
    expect(ledger.reserve(DAY, 7, { cap: 300, floor: 5 }, T0 + 4000).ok).toBe(true);
  });
});

describe('what a refusal means for tomorrow', () => {
  it('keeps the breaker shut over midnight instead of letting the day reset it', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0);
    ledger.settle(hold.id!, 1, 0, T0 + 1000, true);
    expect(ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 2000).ok).toBe(false);
    // Tomorrow one probe is let through, as it is every hour - and the
    // checks behind it are still refused, which is what the old code lost
    // when midnight reset the balance along with the day.
    const probe = ledger.reserve(NEXT, 1, { cap: 300, floor: 0 }, T0 + 86_400_000);
    expect(probe.ok).toBe(true);
    expect(ledger.reserve(NEXT, 1, { cap: 300, floor: 0 }, T0 + 86_401_000).ok).toBe(false);
  });
});

describe('the breaker has to be able to let go', () => {
  it('tries one call again after an hour rather than waiting for a calendar day', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0);
    ledger.settle(hold.id!, 1, 0, T0 + 1000, true);
    expect(ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 60_000).ok).toBe(false);

    // An hour later the account may have been topped up, and the only way
    // to find out is to ask. One check is let through to do it.
    const probe = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 3_700_000);
    expect(probe.ok).toBe(true);
    expect(ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 3_700_001).ok).toBe(false);
  });

  it('opens up once a probe finds credits again', () => {
    const ledger = new BudgetLedger();
    const hold = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0);
    ledger.settle(hold.id!, 1, 0, T0 + 1000, true);
    const probe = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 3_700_000);
    ledger.settle(probe.id!, 1, 900, T0 + 3_700_001);
    expect(ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 3_700_002).ok).toBe(true);
  });
});

describe('a balance is dated when it was read, not when it arrived', () => {
  it('keeps the newer reading when an older one is delivered after it', () => {
    const ledger = new BudgetLedger();
    const a = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0);
    const b = ledger.reserve(DAY, 1, { cap: 300, floor: 0 }, T0 + 100);
    // b's call answered at T0+9s and is settled first; a's answered at
    // T0+2s and only reaches the ledger afterwards.
    ledger.settle(b.id!, 1, 900, T0 + 10_000, false, T0 + 9_000);
    ledger.settle(a.id!, 1, 950, T0 + 11_000, false, T0 + 2_000);
    expect(ledger.snapshot().remaining).toBe(900);
  });
});
