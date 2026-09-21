const BARE_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * A 20-byte address, and not the first 20 bytes of something longer. The
 * trailing guard is the whole point: a 32-byte transaction hash pasted from
 * a post matched its first 42 characters, which is a real and entirely
 * unrelated address, and the reader was shown that account's positions with
 * nothing on the page saying whose they were.
 *
 * No leading guard is needed: `x` is not a hex digit, so `0x` cannot occur
 * inside a run of hex.
 */
const EMBEDDED_ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/** Longer than any address, link or sentence anyone pastes on purpose. */
const MAX_INPUT_LENGTH = 2048;

/** Every address in the input, in the order they appear, so a caller can
 * tell the reader which one it used and that there were others. */
export function extractAddresses(input: string): string[] {
  if (input.length > MAX_INPUT_LENGTH) return [];
  return [...input.trim().matchAll(EMBEDDED_ADDRESS_RE)].map((m) => m[0].toLowerCase());
}

/** The first address in arbitrary input (a bare address or a URL containing
 * one). Never used to fetch the input string itself - only the extracted
 * address is ever sent to an upstream API. */
export function extractAddress(input: string): string | null {
  return extractAddresses(input)[0] ?? null;
}

export function isValidAddress(input: string): boolean {
  return BARE_ADDRESS_RE.test(input.trim());
}

export interface RateLimiter {
  allow(key: string): Promise<boolean>;
}

/** A sliding window over recent hits. On its own it counts only within one
 * isolate, which is why the deployed Worker runs one of these inside a
 * per-address Durable Object (src/coordinator.ts): there, one instance sees
 * every request from that address, and counting in memory costs no KV
 * writes at all. */
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

/** On deployed Cloudflare (not checked live in this session, since that
 * needs a deploy - this is Cloudflare's documented behavior), the edge
 * sets this header on every request and overwrites any client-supplied
 * value, so it cannot be spoofed the way a plain X-Forwarded-For could.
 * Checked live under `wrangler dev` instead: local dev does NOT strip a
 * client-supplied value - sending `cf-connecting-ip: 1.2.3.4` created its
 * own separate rate-limit bucket - so the header is spoofable in local
 * dev only. The `?? 'local-dev'` fallback is nearly unreachable there in
 * practice, since wrangler dev's own simulation sets a real loopback
 * value (127.0.0.1) when the client sends nothing. */
export function extractIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local-dev';
}
