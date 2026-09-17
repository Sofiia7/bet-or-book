# Bet or Book - KV Rate Limiting, Cache, and Shareable Card Implementation Plan (Phase 1.6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two items from the pre-launch security checklist that do not depend on the Nansen key - a real rate limiter and cache shared across requests (today's `InMemoryRateLimiter` resets on every Worker isolate restart and is not shared across edge locations) - and add the shareable card from the design (section 8), since a reply-under-a-post product is not finished until there is something to post.

**Architecture:** One new `KVLike` interface (`src/kv.ts`) narrow enough to fake in tests, one `KVRateLimiter` alongside the existing `InMemoryRateLimiter` in `src/guard.ts`, one small `src/cache.ts` wrapping `checkAddress`, both wired into `src/index.ts` behind a `KV` binding declared in `wrangler.toml`. The card is drawn client-side on a `<canvas>` already present on the page - no server change.

**Tech Stack:** Same as before - TypeScript, Vitest, Cloudflare Workers KV (free tier). No new dependency: canvas drawing uses the browser's native Canvas API.

**Why now:** the Nansen key will not exist until tomorrow, so nothing that needs live Nansen data can be verified today. These three items are genuinely independent of it - all traffic and all data in this phase is still Hyperliquid-only - and are explicit rows in the design's section 9 checklist (`docs/specs/2026-09-17-bet-or-book-design.md`) and section 8 (the card), so doing them now shortens tomorrow's Nansen-only session instead of leaving them for it.

---

## Task 1: KVLike interface and a fake for tests

**Files:**
- Create: `src/kv.ts`
- Create: `test/support/fakeKv.ts`

- [ ] **Step 1: Write the interface**

```typescript
// src/kv.ts
// The narrow slice of Cloudflare's KVNamespace this project actually uses.
// A real KVNamespace (from @cloudflare/workers-types) satisfies this
// structurally, so it can be passed anywhere a KVLike is expected with no
// adapter; tests pass a FakeKV (test/support/fakeKv.ts) instead.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
```

- [ ] **Step 2: Write the fake**

```typescript
// test/support/fakeKv.ts
import type { KVLike } from '../../src/kv';

interface Entry {
  value: string;
  expiresAt: number | null;
}

/** In-memory KVLike for tests. Honors expirationTtl by hiding (not
 * deleting) expired entries on read, and exposes a raw map for assertions
 * that need to see what a real KV write would have stored. */
export class FakeKV implements KVLike {
  private entries = new Map<string, Entry>();
  now: () => number = () => Date.now();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && this.now() >= entry.expiresAt) {
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? this.now() + options.expirationTtl * 1000 : null;
    this.entries.set(key, { value, expiresAt });
  }

  size(): number {
    return this.entries.size;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 (no test yet - this task has no runtime behavior of its
own to assert beyond what Tasks 2 and 3 exercise through it).

- [ ] **Step 4: Commit**

```bash
git add src/kv.ts test/support/fakeKv.ts
git commit -m "chore: KVLike interface and an in-memory fake for tests"
```

---

## Task 2: KV-backed rate limiter

**Files:**
- Modify: `src/guard.ts`
- Modify: `test/guard.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/guard.test.ts`:

```typescript
import { FakeKV } from './support/fakeKv';
```

```typescript
describe('KVRateLimiter', () => {
  it('allows up to the configured number of hits in the current window', async () => {
    const kv = new FakeKV();
    const limiter = new KVRateLimiter(kv, 3, 60);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
  });

  it('tracks separate keys independently', async () => {
    const kv = new FakeKV();
    const limiter = new KVRateLimiter(kv, 1, 60);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip2')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
  });

  it('resets once the fixed window rolls over', async () => {
    const kv = new FakeKV();
    let now = 0;
    kv.now = () => now;
    const limiter = new KVRateLimiter(kv, 1, 60);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
    now += 61_000;
    expect(await limiter.allow('ip1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/guard.test.ts`
Expected: FAIL - `KVRateLimiter` is not exported yet.

- [ ] **Step 3: Implement**

Add to `src/guard.ts` (new import at the top, new class at the bottom):

```typescript
import type { KVLike } from './kv';
```

```typescript
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
```

`FakeKV.now` is what makes the third test's window rollover deterministic - `KVRateLimiter` itself always reads real time via `Date.now()`, since only the fake needs to be steerable in a test.

Wait - re-read that: the window-rollover test steers `kv.now`, but `KVRateLimiter.allow` computes `windowStart` from `Date.now()`, not from `this.kv`'s clock, so steering `FakeKV.now` alone would not move the limiter's own window. Fix before running: `KVRateLimiter` needs its own injectable clock the same way `FakeKV` does, or the test needs to fake global time instead. Use the second option - it is simpler and does not change `KVRateLimiter`'s constructor signature:

```typescript
  it('resets once the fixed window rolls over', async () => {
    const kv = new FakeKV();
    const limiter = new KVRateLimiter(kv, 1, 60);
    vi.setSystemTime(0);
    expect(await limiter.allow('ip1')).toBe(true);
    expect(await limiter.allow('ip1')).toBe(false);
    vi.setSystemTime(61_000);
    expect(await limiter.allow('ip1')).toBe(true);
    vi.useRealTimers();
  });
```

This needs `vi` imported (already imported in `test/guard.test.ts`? check the top of the file - if not, add `vi` to the existing `import { describe, expect, it } from 'vitest'` line) and `beforeEach(() => vi.useFakeTimers())` is not required since the test sets and clears its own timer state, but to be safe against test-order effects, wrap the body in `try { ... } finally { vi.useRealTimers(); }` is unnecessary here since the test above already calls `vi.useRealTimers()` as its last line - keep it simple and matching the other tests' style, but do add `vi.useRealTimers()` in an `afterEach` at the `describe('KVRateLimiter', ...)` level instead of relying on the last line of one test, so a thrown assertion earlier in the test does not leave fake timers bleeding into later tests:

```typescript
describe('KVRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ... the three its from above, with the third one no longer needing its own vi.useRealTimers() call
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/guard.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/guard.ts test/guard.test.ts
git commit -m "feat: KV-backed rate limiter for the deployed Worker"
```

---

## Task 3: KV-backed cache for /api/check, and wiring both into the Worker

**Files:**
- Create: `src/cache.ts`
- Test: `test/cache.test.ts`
- Modify: `src/index.ts`
- Modify: `wrangler.toml`

- [ ] **Step 1: Write the failing test**

```typescript
// test/cache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { withCache } from '../src/cache';

describe('withCache', () => {
  it('calls the producer and stores the result on a miss', async () => {
    const kv = new FakeKV();
    const producer = vi.fn(async () => ({ value: 42 }));
    const result = await withCache(kv, 'k1', 600, producer);
    expect(result).toEqual({ value: 42 });
    expect(producer).toHaveBeenCalledTimes(1);
    expect(kv.size()).toBe(1);
  });

  it('returns the cached value without calling the producer again on a hit', async () => {
    const kv = new FakeKV();
    const producer = vi.fn(async () => ({ value: 42 }));
    await withCache(kv, 'k1', 600, producer);
    const second = await withCache(kv, 'k1', 600, producer);
    expect(second).toEqual({ value: 42 });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('calls the producer again once the entry expires', async () => {
    const kv = new FakeKV();
    let calls = 0;
    const producer = vi.fn(async () => ({ value: ++calls }));
    await withCache(kv, 'k1', 600, producer);
    kv.now = () => Date.now() + 601_000;
    const second = await withCache(kv, 'k1', 600, producer);
    expect(second).toEqual({ value: 2 });
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/cache.test.ts`
Expected: FAIL - `src/cache.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
// src/cache.ts
import type { KVLike } from './kv';

/** Reads `key` from `kv`; on a miss, calls `produce()`, stores the JSON
 * result with the given TTL, and returns it. `T` must be JSON-serializable. */
export async function withCache<T>(
  kv: KVLike,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const cached = await kv.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }
  const value = await produce();
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire both into the Worker**

Add a KV namespace binding to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "placeholder-local-dev-id"
```

(`wrangler dev` runs Workers KV locally by default and does not validate
`id` against a real Cloudflare namespace unless `--remote` is passed - if
this turns out to be wrong when Step 6 runs `wrangler dev`, replace the
placeholder with a real namespace id from `npx wrangler kv namespace
create BET_OR_BOOK_KV` and note that correction here rather than silently
editing it away.)

Modify `src/index.ts`:

```typescript
import { extractAddress, extractIp, KVRateLimiter } from './guard';
import { checkAddress } from './api/check';
import { withCache } from './cache';
import pageHtml from '../web/index.html';
import type { KVLike } from './kv';

interface Env {
  KV: KVLike;
}

const CHECK_CACHE_TTL_SECONDS = 600;
const RATE_LIMIT_MAX_PER_WINDOW = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/check') {
      const raw = url.searchParams.get('address') ?? '';
      const address = extractAddress(raw);
      if (!address) {
        return Response.json(
          { error: 'no valid Hyperliquid address found in the address parameter' },
          { status: 400 },
        );
      }

      const limiter = new KVRateLimiter(env.KV, RATE_LIMIT_MAX_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
      const ip = extractIp(request);
      if (!(await limiter.allow(ip))) {
        return Response.json({ error: 'too many checks from this address, try again shortly' }, { status: 429 });
      }

      try {
        const result = await withCache(env.KV, `check:${address}`, CHECK_CACHE_TTL_SECONDS, () =>
          checkAddress(address),
        );
        return Response.json(result);
      } catch (err) {
        console.error('check failed', err);
        return Response.json({ error: 'could not read this address right now, try again shortly' }, { status: 502 });
      }
    }

    if (url.pathname === '/') {
      return new Response(pageHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
    }

    return new Response('not found', { status: 404 });
  },
};
```

This calls `extractIp`, which does not exist yet - add it to `src/guard.ts`:

```typescript
/** Cloudflare sets this header on every request reaching a Worker; it
 * cannot be spoofed by the client the way a plain X-Forwarded-For could,
 * since Cloudflare's edge overwrites it. Falls back to a constant so a
 * request from `wrangler dev` (which does not set it) still rate-limits
 * as one shared bucket locally rather than throwing. */
export function extractIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local-dev';
}
```

- [ ] **Step 6: Smoke-test live**

Run: `npm run typecheck`
Expected: exits 0. If it fails on the `Env`/`KVNamespace` type not matching `KVLike`, check whether `@cloudflare/workers-types`' `KVNamespace.get` has a different overload signature than assumed here (it does return `Promise<string | null>` for the no-options-object call, but confirm against the installed package's `.d.ts` before changing `KVLike` to match) - fix `KVLike` to be a true subset of the real type rather than fighting it with a cast.

Run: `npm test`
Expected: all tests (old and new) still pass.

Start `npm run dev` in the background. Run the same address twice:
```bash
curl -s -w "\n%{time_total}s\n" "http://localhost:8787/api/check?address=0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00"
curl -s -w "\n%{time_total}s\n" "http://localhost:8787/api/check?address=0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00"
```
Expected: identical JSON both times, and the second call's `time_total` is
noticeably lower than the first (cache hit skips five live Hyperliquid
calls).

Then hit the rate limit:
```bash
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " "http://localhost:8787/api/check?address=0xbf732ea04197942783e34730ed6e0f6099575d58"; done; echo
```
Expected: the first several return `200`, and after `RATE_LIMIT_MAX_PER_WINDOW`
(20) some return `429`. Note: this address's own cache entry will make most
of these instant cache hits, not fresh Hyperliquid calls - that is fine,
the rate limiter runs before the cache check either way.

Stop the dev server (this project's process tree only, the same way every
earlier smoke test in this project has).

- [ ] **Step 7: Commit**

```bash
git add src/cache.ts test/cache.test.ts src/index.ts src/guard.ts wrangler.toml
git commit -m "feat: KV cache and rate limit in front of /api/check"
```

---

## Task 4: Shareable card

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Add a canvas and a working Copy card button**

The mockup shown during design already had a "Copy card" button; Phase 1.5's
page shipped without it. Add a hidden `<canvas>` and wire the button to draw
onto it and copy the result as a PNG, using only the data already in the
rendered card (no new fetch).

In `web/index.html`, inside `<div class="card" ...>`, after the existing
`<p class="footer" id="footer"></p>` line, add:

```html
  <div style="display:flex; gap:8px; margin-top:12px;">
    <button id="copy-card">Copy card</button>
    <button id="copy-link">Copy link</button>
  </div>
  <canvas id="card-canvas" width="1200" height="675" style="display:none;"></canvas>
```

Before the closing `</script>` tag, add:

```javascript
let lastResult = null;

function drawCard() {
  const canvas = document.getElementById('card-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const data = lastResult;
  const v = VERDICT_COPY[data.verdict.verdict] || VERDICT_COPY.unknown;
  const palette = {
    book: '#0c447c', hedged: '#27500a', looks_like_a_bet: '#633806', unknown: '#444441',
  };
  const accent = palette[data.verdict.verdict] || palette.unknown;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = accent;
  ctx.font = '600 28px -apple-system, system-ui, sans-serif';
  ctx.fillText(v.label.toUpperCase() + (data.verdict.strength ? ' - ' + data.verdict.strength.toUpperCase() : ''), 48, 90);

  ctx.fillStyle = '#111111';
  ctx.font = '600 44px -apple-system, system-ui, sans-serif';
  wrapText(ctx, v.headline, 48, 160, W - 96, 52);

  ctx.fillStyle = '#555555';
  ctx.font = '400 24px -apple-system, system-ui, sans-serif';
  wrapText(ctx, v.explain, 48, 250, W - 96, 32);

  const stats = [
    ['Open positions', String(data.positions.nPositions)],
    ['Net / gross', fmtPct(data.positions.netToGross)],
    ['Resting orders', String(data.orders.restingOrders)],
    ['Hedge ratio', fmtPct(data.hedge.hedgeRatio)],
  ];
  const colW = (W - 96) / 4;
  stats.forEach(([label, value], i) => {
    const x = 48 + i * colW;
    ctx.fillStyle = '#888888';
    ctx.font = '400 18px -apple-system, system-ui, sans-serif';
    ctx.fillText(label, x, 420);
    ctx.fillStyle = '#111111';
    ctx.font = '600 32px -apple-system, system-ui, sans-serif';
    ctx.fillText(value, x, 460);
  });

  ctx.fillStyle = '#999999';
  ctx.font = '400 18px -apple-system, system-ui, sans-serif';
  ctx.fillText('bet-or-book - ' + data.address.slice(0, 10) + '...' + data.address.slice(-6), 48, H - 40);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let curY = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      ctx.fillText(line, x, curY);
      line = word + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

document.getElementById('copy-card').addEventListener('click', async () => {
  if (!lastResult) return;
  drawCard();
  const canvas = document.getElementById('card-canvas');
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const btn = document.getElementById('copy-card');
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (e) {
      errorEl_showCopyFallback(canvas);
    }
  }, 'image/png');
});

function errorEl_showCopyFallback(canvas) {
  const url = canvas.toDataURL('image/png');
  const w = window.open();
  if (w) {
    w.document.write('<img src="' + url + '" alt="card">');
  }
}

document.getElementById('copy-link').addEventListener('click', async () => {
  if (!lastResult) return;
  const link = window.location.origin + '/?address=' + lastResult.address;
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById('copy-link');
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (e) {
    window.prompt('Copy this link:', link);
  }
});
```

And set `lastResult = data;` as the first line inside `runCheck`'s success
path (right after `const data = await res.json();`, before the `if (!res.ok)`
check - store it unconditionally, but only read it from the two button
handlers, which are unreachable while the card is hidden).

Also read `?address=` from the URL on page load and pre-fill + auto-run the
check, so a copied link actually reopens to the same result: at the end of
the script,

```javascript
const preset = new URLSearchParams(window.location.search).get('address');
if (preset) {
  document.getElementById('address').value = preset;
  runCheck();
}
```

- [ ] **Step 2: Smoke-test in the browser**

Start `npm run dev` in the background. Open the Browser pane at
`http://localhost:8787/`, check a known address (e.g. the Wintermute one
used throughout this project), click "Copy card", and confirm the button
label flips to "Copied" with no console error (`read_console_messages`,
`onlyErrors: true`). Then navigate to
`http://localhost:8787/?address=0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00`
directly and confirm the card renders without clicking anything.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat: shareable card image and a link that reopens to the same result"
```

---

## Task 5: Re-run the security checklist

Not a code task - a documentation pass. Open
`docs/specs/2026-09-17-bet-or-book-design.md` section 9 and re-check every
row against the code as it stands after Tasks 1-4 (new KV binding, new rate
limiter, new cache, new client-side clipboard/URL handling). Append a dated
note directly under the existing table (do not edit the original table)
recording anything that changed, in particular:
- Гонки: still approximate (KV read-then-write is not atomic) - state this
  plainly, do not claim it is fixed.
- SSRF и загрузки: the new `?address=` query param on page load goes
  through the same `extractAddress` regex as the form input, not a new
  path - confirm this by reading the code, not by assumption.
- CORS: unchanged, no new origin was introduced.

- [ ] **Step 1: Write the note in `docs/specs/2026-09-17-bet-or-book-design.md`**
- [ ] **Step 2: Commit**

```bash
git add docs/specs/2026-09-17-bet-or-book-design.md
git commit -m "docs: re-check the security checklist after KV, cache, and the card"
```

---

## Self-review notes

- **Spec coverage:** closes design section 9 rows "стоит ли лимит попыток
  входа" (now KV-backed, shared, not per-isolate) and the caching part of
  section 6, and delivers section 8 (the card) for the first time.
- **Placeholder scan:** none - every step has runnable code; the one
  explicit "if this turns out to be wrong, do X instead" (Task 3 Step 5's
  KV namespace id note) names the exact fallback rather than leaving it
  open-ended.
- **Type consistency:** `KVLike` defined once (Task 1) and consumed by
  `KVRateLimiter` (Task 2), `withCache` (Task 3), and `Env` in `index.ts`
  (Task 3) without redefinition.
- **Out of scope, still needs the Nansen key:** everything under "Что
  делает София" in the design doc, plus the gallery/prescan, the credit
  ledger, and `wrangler deploy` itself (a KV namespace existing locally is
  not the same as the Worker being live).
