const BARE_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EMBEDDED_ADDRESS_RE = /0x[0-9a-fA-F]{40}/;

/** Pulls a 20-byte hex address out of arbitrary input (a bare address or a
 * URL containing one). Never used to fetch the input string itself - only
 * the extracted address is ever sent to an upstream API. */
export function extractAddress(input: string): string | null {
  const match = input.trim().match(EMBEDDED_ADDRESS_RE);
  return match ? match[0].toLowerCase() : null;
}

export function isValidAddress(input: string): boolean {
  return BARE_ADDRESS_RE.test(input.trim());
}

export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

/** In-memory limiter for tests and local dev. Not shared across Worker
 * isolates - Phase 2 swaps this for a Workers KV-backed implementation
 * behind the same interface before deployment. */
export class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number,
  ) {}

  async allow(key: string): Promise<boolean> {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.maxHits) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
