/**
 * The Nansen spend cap, counted so that concurrent checks cannot walk past
 * it together and so that neither a crash nor a calendar day can hand back
 * money that was already spent.
 *
 * The first counter read the day's total, ran the check, then wrote the
 * total back. Two checks overlapping read the same number, so both were
 * allowed and the second write erased the first: an offline replay of twenty
 * overlapping checks against a cap of 300 spent 439 credits and recorded
 * 306. Reading a total that is already stale is not a budget.
 *
 * So credits are held before they are spent. A check reserves the most it
 * could cost, does its work, and settles the reservation with what it
 * actually cost; whatever it did not use goes back.
 *
 * The 21.09 audit found the two ways that was still leaky.
 *
 * A reservation nobody settles - a request that died after Nansen had
 * already served it - used to expire and give the whole amount back. The
 * outcome of a paid call that never reported is not known to be zero, so an
 * expired hold is now charged at its worst case and marked uncertain. A
 * settle that turns up later corrects the charge to what it really was,
 * exactly once, however many times it is redelivered.
 *
 * And the day rolling over used to reset the whole object, including the
 * account balance Nansen last reported and every reservation still running.
 * Midnight resets the daily cap and nothing else: the balance is the
 * account's, not the day's, a hold belongs to the day it was taken on, and
 * a check that started before midnight settles against that day. Money
 * arriving on the account is a separate event with its own path.
 *
 * This class holds no I/O. It is driven by the Durable Object in
 * src/coordinator.ts, whose single-threaded execution is what makes
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

/** How long a settled or orphaned reservation is remembered, so a redelivery
 * can be recognised as one. Long enough to outlive any retry, short enough
 * that the object does not grow without bound. */
const RECEIPT_TTL_MS = 24 * 60 * 60_000;

/** How long the breaker holds before letting one check through to find out
 * whether the account still has nothing. Without this the only way out of a
 * refusal would be an operator, and the day rolling over used to be that
 * escape by accident - which is also how it reset the balance it should have
 * kept. One call an hour is a cheap way to notice a top-up. */
const REFUSAL_PROBE_MS = 60 * 60_000;

/** A day of Nansen traffic, counted where it cannot be lost. */
export interface DayCalls {
  /** Requests sent, whatever came back - including the ones that never
   * answered, which may still have been served and charged. */
  attempted: number;
  /** Requests that answered 2xx. */
  successful: number;
  /** Credits the API itself put a number on, in its cost header. */
  creditsQuoted: number;
  /** Credits charged to a call the API did not price, at one apiece. An
   * assumption in the conservative direction, kept apart from the quoted
   * figure so a submission does not present the two as one number. */
  creditsAssumed: number;
  byEndpoint: Record<string, number>;
}

const emptyDay = (): DayCalls => ({
  attempted: 0,
  successful: 0,
  creditsQuoted: 0,
  creditsAssumed: 0,
  byEndpoint: {},
});

/** What a recorded call has to say about itself. Mirrors NansenCallMeta
 * without importing it, so the arithmetic here stays free of the client. */
export interface RecordedCall {
  path: string;
  status: number;
  creditsCost: number | null;
}

export interface BudgetLimits {
  /** Credits this Worker may spend in a day, whatever the account holds. */
  cap: number;
  /** Credits to leave untouched on the account, so a demo can still run. */
  floor: number;
}

interface Hold {
  amount: number;
  at: number;
  /** The day this reservation was taken on, which is the day it is charged
   * to even if it settles after midnight. */
  day: string;
}

export interface BudgetState {
  /** The most recent day seen. Kept for reporting; the cap is counted from
   * `spentByDay`, so this is not what decides anything. */
  day: string;
  /** Credits confirmed spent today. Mirrors `spentByDay[day]`. */
  spent: number;
  spentByDay: Record<string, number>;
  /** Of what is charged, how much is an expired hold charged at its worst
   * case because the outcome of its calls was never reported. */
  uncertainSpent: number;
  /** Credits held by checks that are still running. */
  reserved: number;
  /** The balance Nansen last reported, or null if it never has. */
  remaining: number | null;
  /** When that balance was measured, so a slow answer carrying an older
   * number cannot overwrite a newer one. */
  remainingAt: number;
  /** True once Nansen refused for lack of credits. Cleared by a balance that
   * says otherwise, never by the clock alone. */
  refused: boolean;
  /** When the breaker last tripped or last let a probe through, so exactly
   * one check an hour is allowed to test whether credits came back. */
  refusedAt: number;
  /** Live reservations, by id. */
  holds: Record<string, Hold>;
  /** Reservations that expired unsettled, charged at their worst case and
   * kept so a late settle can correct that charge once. */
  orphaned: Record<string, Hold>;
  /** Settled reservations, by id, with what they cost and when, so a
   * redelivered settle is recognised rather than charged again. */
  receipts: Record<string, { cost: number; at: number }>;
  /** Calls per day. Here rather than in KV because a read-modify-write on
   * one shared key loses counts whenever two checks finish together, and
   * this is the number the buildathon submission rests on (audit C01). */
  callsByDay: Record<string, DayCalls>;
}

export interface Reservation {
  ok: boolean;
  id: string | null;
  /** Why a refused reservation was refused, in words for the card. */
  reason?: string;
}

const emptyState = (day: string): BudgetState => ({
  day,
  spent: 0,
  spentByDay: {},
  uncertainSpent: 0,
  reserved: 0,
  remaining: null,
  remainingAt: 0,
  refused: false,
  refusedAt: 0,
  holds: {},
  orphaned: {},
  receipts: {},
  callsByDay: {},
});

/** Reads a state written by an older version of this file, where the daily
 * totals were the only totals and there was nothing to say about holds that
 * never came back. */
function migrate(state: BudgetState): BudgetState {
  const next = { ...emptyState(state.day), ...state };
  next.spentByDay = state.spentByDay ?? (state.day ? { [state.day]: state.spent ?? 0 } : {});
  next.holds = Object.fromEntries(
    Object.entries(state.holds ?? {}).map(([id, h]) => [id, { ...h, day: h.day ?? state.day }]),
  );
  next.orphaned = state.orphaned ?? {};
  next.receipts = state.receipts ?? {};
  next.uncertainSpent = state.uncertainSpent ?? 0;
  next.remainingAt = state.remainingAt ?? 0;
  next.refused = state.refused ?? false;
  next.refusedAt = state.refusedAt ?? 0;
  next.callsByDay = state.callsByDay ?? {};
  return next;
}

export class BudgetLedger {
  private state: BudgetState;

  constructor(state?: BudgetState) {
    this.state = state ? migrate(state) : emptyState('');
  }

  snapshot(): BudgetState {
    return this.state;
  }

  /** Holds `worstCase` credits if the day's budget and the account's own
   * balance can both stand it. The caller must settle whatever it gets. */
  reserve(day: string, worstCase: number, limits: BudgetLimits, now: number): Reservation {
    this.state.day = day;
    this.expireStaleHolds(now);
    this.forgetOldReceipts(now);

    const s = this.state;
    const spentToday = s.spentByDay[day] ?? 0;
    const reservedToday = Object.values(s.holds).reduce((sum, h) => sum + (h.day === day ? h.amount : 0), 0);
    s.spent = spentToday;
    if (spentToday + reservedToday + worstCase > limits.cap) {
      return { ok: false, id: null, reason: "today's Nansen credits are used up" };
    }
    // A probe is the one check an hour that is allowed past an empty
    // balance, because asking is the only way to learn it is no longer
    // empty. It skips the balance gate for exactly that reason.
    const probing = s.refused && now - s.refusedAt >= REFUSAL_PROBE_MS;
    if (s.refused && !probing) {
      return { ok: false, id: null, reason: 'the Nansen account is nearly out of credits' };
    }
    // `remaining` is the balance as of the last answered call, so credits
    // held since then have to come off it too - including holds taken on an
    // earlier day, which spent the account's credits just the same.
    if (!probing && s.remaining !== null && s.remaining - s.reserved - worstCase < limits.floor) {
      return { ok: false, id: null, reason: 'the Nansen account is nearly out of credits' };
    }
    // Start the hour again here, so the next check does not follow this one
    // into the same refusal.
    if (probing) s.refusedAt = now;

    const id = crypto.randomUUID();
    s.holds[id] = { amount: worstCase, at: now, day };
    s.reserved += worstCase;
    return { ok: true, id };
  }

  /**
   * Closes a reservation with what the check really spent. `actualCost` is
   * charged even when it is larger than the hold: a call that was made has
   * to be paid for, whatever was reserved for it.
   *
   * Safe to deliver more than once. The first delivery decides the charge;
   * the rest only ever update the reported balance.
   *
   * `refused` marks a 401/402/403 from Nansen that came with no credits left
   * on the clock. What it answers when credits run out is not documented, so
   * that stops spending until a balance says otherwise.
   */
  settle(
    id: string,
    actualCost: number,
    creditsRemaining: number | null,
    now: number,
    refused = false,
    /** When the balance was read, which is not when this settle arrived: a
     * slow answer can carry an older number than one already recorded, and
     * delivery order is not measurement order. */
    measuredAt: number = now,
  ): void {
    const s = this.state;
    const receipt = s.receipts[id];
    if (receipt === undefined) {
      const hold = s.holds[id];
      const orphan = s.orphaned[id];
      if (hold) {
        s.reserved = Math.max(0, s.reserved - hold.amount);
        delete s.holds[id];
        this.charge(hold.day, actualCost);
      } else if (orphan) {
        // Already charged at its worst case when it expired. Correct that to
        // what the calls really cost, and take the uncertainty back off.
        this.charge(orphan.day, actualCost - orphan.amount);
        s.uncertainSpent = Math.max(0, s.uncertainSpent - orphan.amount);
        delete s.orphaned[id];
      } else {
        // An id from a state this object no longer holds. Charging it to
        // today is the conservative direction.
        this.charge(s.day, actualCost);
      }
      s.receipts[id] = { cost: actualCost, at: now };
    }

    this.reportBalance(creditsRemaining, measuredAt, refused);
    this.expireStaleHolds(now);
    this.forgetOldReceipts(now);
  }

  /**
   * Adds a check's calls to the day's totals. Separate from `settle`
   * because what was spent and what was done are two questions: the cap
   * needs the first, the submission needs the second, and one of them being
   * approximate used to make both look it.
   */
  recordCalls(day: string, calls: RecordedCall[]): void {
    if (calls.length === 0) return;
    const entry = this.state.callsByDay[day] ?? emptyDay();
    for (const c of calls) {
      entry.attempted++;
      if (c.status >= 200 && c.status < 300) entry.successful++;
      if (c.creditsCost === null) entry.creditsAssumed += 1;
      else entry.creditsQuoted += c.creditsCost;
      entry.byEndpoint[c.path] = (entry.byEndpoint[c.path] ?? 0) + 1;
    }
    this.state.callsByDay[day] = entry;
  }

  /** The totals over a window of days, for /api/ledger. */
  callReport(from: string, to: string): { calls: DayCalls; byDay: Record<string, number> } {
    const calls = emptyDay();
    const byDay: Record<string, number> = {};
    for (const [day, entry] of Object.entries(this.state.callsByDay)) {
      if (day < from || day > to) continue;
      calls.attempted += entry.attempted;
      calls.successful += entry.successful;
      calls.creditsQuoted += entry.creditsQuoted;
      calls.creditsAssumed += entry.creditsAssumed;
      for (const [path, n] of Object.entries(entry.byEndpoint)) {
        calls.byEndpoint[path] = (calls.byEndpoint[path] ?? 0) + n;
      }
      byDay[day] = entry.attempted;
    }
    return { calls, byDay };
  }

  /**
   * Records a balance read outside a check - after a top-up, or from a
   * scheduled poll. Without it a local breaker set by an empty account can
   * hold until the next day whatever the account actually holds.
   */
  syncBalance(creditsRemaining: number, at: number): void {
    this.reportBalance(creditsRemaining, at, false);
  }

  private reportBalance(creditsRemaining: number | null, at: number, refused: boolean): void {
    const s = this.state;
    if (creditsRemaining !== null && at >= s.remainingAt) {
      s.remaining = creditsRemaining;
      s.remainingAt = at;
      if (creditsRemaining > 0) {
        s.refused = false;
        s.refusedAt = 0;
      }
    }
    if (refused) {
      s.refused = true;
      s.refusedAt = at;
      if (at >= s.remainingAt) {
        s.remaining = 0;
        s.remainingAt = at;
      }
    }
  }

  private charge(day: string, credits: number): void {
    const s = this.state;
    const key = day || s.day;
    s.spentByDay[key] = Math.max(0, (s.spentByDay[key] ?? 0) + credits);
    s.spent = s.spentByDay[s.day] ?? 0;
  }

  /**
   * A hold whose request never came back. Nansen may well have served and
   * charged every call it covered, and an unknown outcome is not a zero one,
   * so the worst case is charged and marked as a guess.
   */
  private expireStaleHolds(now: number): void {
    const s = this.state;
    for (const [id, hold] of Object.entries(s.holds)) {
      if (now - hold.at >= HOLD_TTL_MS) {
        s.reserved = Math.max(0, s.reserved - hold.amount);
        delete s.holds[id];
        s.orphaned[id] = hold;
        s.uncertainSpent += hold.amount;
        this.charge(hold.day, hold.amount);
      }
    }
  }

  private forgetOldReceipts(now: number): void {
    const s = this.state;
    for (const [id, r] of Object.entries(s.receipts)) {
      if (now - r.at >= RECEIPT_TTL_MS) delete s.receipts[id];
    }
    for (const [id, h] of Object.entries(s.orphaned)) {
      if (now - h.at >= RECEIPT_TTL_MS) delete s.orphaned[id];
    }
    // The day counters are a rolling record; anything older than the receipt
    // window can no longer be charged to and is not worth carrying.
    const keep = new Date(now - RECEIPT_TTL_MS * 2).toISOString().slice(0, 10);
    for (const day of Object.keys(s.spentByDay)) {
      if (day < keep) delete s.spentByDay[day];
    }
  }
}
