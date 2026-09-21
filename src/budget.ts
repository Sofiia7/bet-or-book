/**
 * The Nansen spend cap, counted so that concurrent checks cannot walk past
 * it together.
 *
 * The old counter read the day's total, ran the check, then wrote the total
 * back. Two checks overlapping read the same number, so both were allowed
 * and the second write erased the first: an offline replay of twenty
 * overlapping checks against a cap of 300 spent 439 credits and recorded
 * 306. Reading a total that is already stale is not a budget.
 *
 * So credits are held before they are spent. A check reserves the most it
 * could cost, does its work, and settles the reservation with what it
 * actually cost; whatever it did not use goes back. A reservation that is
 * never settled - a request that died mid-flight - expires on its own.
 *
 * This class holds no I/O. It is driven by the Durable Object in
 * src/budgetObject.ts, whose single-threaded execution is what makes
 * reserve-then-settle atomic; keeping the arithmetic here is what makes it
 * testable without one.
 */

/** The most Nansen calls one check can make: positions, PnL, own balances,
 * related wallets on two chains, and two funders' balances. */
export const WORST_CASE_CALLS = 7;

/** How long a reservation can be held by a request that never came back.
 * Four paid stages at the 20 s Nansen timeout, plus the free reads, is the
 * longest a live check can take; past that the request is gone. */
const HOLD_TTL_MS = 300_000;

export interface BudgetLimits {
  /** Credits this Worker may spend in a day, whatever the account holds. */
  cap: number;
  /** Credits to leave untouched on the account, so a demo can still run. */
  floor: number;
}

export interface BudgetState {
  day: string;
  /** Credits confirmed spent today. */
  spent: number;
  /** Credits held by checks that are still running. */
  reserved: number;
  /** The balance Nansen last reported, or null if it never has. */
  remaining: number | null;
  /** Live reservations, by id, as amount and the time they were taken. */
  holds: Record<string, { amount: number; at: number }>;
}

export interface Reservation {
  ok: boolean;
  id: string | null;
  /** Why a refused reservation was refused, in words for the card. */
  reason?: string;
}

const emptyState = (day: string): BudgetState => ({ day, spent: 0, reserved: 0, remaining: null, holds: {} });

export class BudgetLedger {
  private state: BudgetState;

  constructor(state?: BudgetState) {
    this.state = state ?? emptyState('');
  }

  snapshot(): BudgetState {
    return this.state;
  }

  /** Holds `worstCase` credits if the day's budget and the account's own
   * balance can both stand it. The caller must settle whatever it gets. */
  reserve(day: string, worstCase: number, limits: BudgetLimits, now: number): Reservation {
    if (this.state.day !== day) this.state = emptyState(day);
    this.expireStaleHolds(now);

    const committed = this.state.spent + this.state.reserved;
    if (committed + worstCase > limits.cap) {
      return { ok: false, id: null, reason: "today's Nansen credits are used up" };
    }
    // `remaining` is the balance as of the last answered call, so credits
    // held since then have to come off it too.
    if (this.state.remaining !== null && this.state.remaining - this.state.reserved - worstCase < limits.floor) {
      return { ok: false, id: null, reason: 'the Nansen account is nearly out of credits' };
    }

    const id = crypto.randomUUID();
    this.state.holds[id] = { amount: worstCase, at: now };
    this.state.reserved += worstCase;
    return { ok: true, id };
  }

  /**
   * Closes a reservation with what the check really spent. `actualCost` is
   * charged even when it is larger than the hold: a call that was made has
   * to be paid for, whatever was reserved for it.
   *
   * `refused` marks a 401/402/403 from Nansen. What it answers when credits
   * run out is not documented, so any refusal stops spending until tomorrow.
   */
  settle(id: string, actualCost: number, creditsRemaining: number | null, now: number, refused = false): void {
    const hold = this.state.holds[id];
    if (hold) {
      this.state.reserved = Math.max(0, this.state.reserved - hold.amount);
      delete this.state.holds[id];
    }
    this.state.spent += actualCost;
    if (creditsRemaining !== null) this.state.remaining = creditsRemaining;
    if (refused) this.state.remaining = 0;
    this.expireStaleHolds(now);
  }

  private expireStaleHolds(now: number): void {
    for (const [id, hold] of Object.entries(this.state.holds)) {
      if (now - hold.at >= HOLD_TTL_MS) {
        this.state.reserved = Math.max(0, this.state.reserved - hold.amount);
        delete this.state.holds[id];
      }
    }
  }
}
