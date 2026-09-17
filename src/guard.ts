import type { KVLike } from './kv';

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

/**
 * Fixed-window counter backed by Workers KV, for the deployed Worker.
 * Not perfectly atomic under concurrent requests (KV read-then-write is
 * not a transaction) - an abuse guard, not a precise limiter. Risk is
 * bounded by the window size and by the cache in src/cache.ts cutting
 * most repeat traffic before it ever reaches this check.
 */
export class KVRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KVLike,
    private readonly maxHits: number,
    private readonly windowSeconds: number,
  ) {}

  async allow(key: string): Promise<boolean> {
    const windowStart = Math.floor(Date.now() / (this.windowSeconds * 1000));
    const kvKey = `ratelimit:${key}:${windowStart}`;
    const raw = await this.kv.get(kvKey);
    const count = raw ? Number(raw) : 0;
    if (count >= this.maxHits) {
      return false;
    }
    await this.kv.put(kvKey, String(count + 1), { expirationTtl: this.windowSeconds * 2 });
    return true;
  }
}

/** Cloudflare sets this header on every request reaching a Worker; it
 * cannot be spoofed by the client the way a plain X-Forwarded-For could,
 * since Cloudflare's edge overwrites it. Falls back to a constant so a
 * request from `wrangler dev` (which does not set it) still rate-limits
 * as one shared bucket locally rather than throwing. */
export function extractIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local-dev';
}
