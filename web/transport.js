/** Every browser request has a deadline; callers choose longer live checks. */
export async function timedFetch(url, options = {}, timeout = 15000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}
