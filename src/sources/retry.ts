/** Answers that mean "try again in a moment" rather than "this request is
 * wrong": rate limited, or the gateway in front of Hyperliquid had a hiccup. */
export const RETRY_STATUSES = new Set([429, 502, 503, 504]);
export const RETRY_DEFAULT_WAIT_MS = 250;
/** A longer wait than this would eat the check's own deadline, so the answer
 * is reported as a failure instead. */
export const RETRY_MAX_WAIT_MS = 2_000;

/** How long the server asked us to wait: `retry-after` is either a number of
 * seconds or an HTTP date. Absent or unreadable means the default. */
export function retryWaitMs(res: Response): number {
  const raw = res.headers.get('retry-after')?.trim();
  if (!raw) return RETRY_DEFAULT_WAIT_MS;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : RETRY_DEFAULT_WAIT_MS;
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
