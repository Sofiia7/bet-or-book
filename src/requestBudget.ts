// A per-check cap on outbound requests. The Workers Free plan allows 50
// subrequests per invocation; every transport charges this budget before each
// send, so a check stops itself below that wall instead of hitting it.
export const CHECK_REQUEST_LIMIT = 45;
export const REQUEST_LIMIT_REASON = `this check reached its limit of ${CHECK_REQUEST_LIMIT} outbound requests`;

export class RequestBudgetExceeded extends Error {
  readonly source: string;
  readonly limit: number;
  constructor(source: string, limit: number) {
    super(`request limit reached: ${source} not sent (${limit} per check)`);
    this.name = 'RequestBudgetExceeded';
    this.source = source;
    this.limit = limit;
  }
}

export interface RequestBudget {
  readonly limit: number;
  used(): number;
  remaining(): number;
  /** Counts one send, or throws RequestBudgetExceeded without counting it. */
  take(source: string): void;
  /** Whether `n` more sends fit while `keep` stay in reserve. Spends nothing. */
  affords(n: number, keep?: number): boolean;
}

export function createRequestBudget(limit: number = CHECK_REQUEST_LIMIT): RequestBudget {
  let used = 0;
  return {
    limit,
    used: () => used,
    remaining: () => limit - used,
    take(source) {
      if (used >= limit) throw new RequestBudgetExceeded(source, limit);
      used++;
    },
    affords: (n, keep = 0) => limit - used - n >= keep,
  };
}

const budgets = new WeakMap<AbortSignal, RequestBudget>();

/** The budget travels with the check's signal, so every transport reaches it
 * without a new parameter. */
export function attachRequestBudget(signal: AbortSignal, budget: RequestBudget): void {
  budgets.set(signal, budget);
}

export function requestBudgetOf(signal: AbortSignal | undefined): RequestBudget | null {
  return signal === undefined ? null : (budgets.get(signal) ?? null);
}

/** Charges one send against the check's budget; does nothing when none is attached. */
export function chargeRequest(signal: AbortSignal | undefined, source: string): void {
  requestBudgetOf(signal)?.take(source);
}

export function isRequestBudgetExceeded(err: unknown): err is RequestBudgetExceeded {
  return err instanceof RequestBudgetExceeded;
}
