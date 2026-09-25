# Audit fixes and three new mechanics - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the correctness/UI findings from `docs/audits/2026-09-24-full-audit-ru.md` and ship the three mechanics the user approved on 24.09 (guess-the-verdict, a ratings board, and a balance-scale diagram replacing the coverage bar), without changing the verdict rules (`CLASSIFIER_VERSION` stays `v5`) or `OBSERVATION_SCHEMA_VERSION`.

**Architecture:** Every task is additive or purely presentational. No task touches `src/engine/verdict.ts`'s rule logic. The scale diagram in this round is the page's own SVG only (`web/app.js`); the canvas share-card and the satori OG picture keep drawing the existing bar against the same, unchanged `breakdown`/`orders` data, so nothing breaks - the visual parity between all three is a documented follow-up, not part of this plan. The ratings board and the guess mechanic reuse data already computed server-side; the board needs three new numbers added to the existing gallery row payload, nothing else server-side.

**Tech Stack:** TypeScript (Cloudflare Workers), Vitest, vanilla JS + hand-written SVG (`web/app.js`), no new dependencies.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/index.ts` | Routes. Task 1 adds one filter (drop gallery rows a featured reading has superseded) and widens the check-cache key. |
| `src/gallery.ts` | `GalleryRow`/`galleryIndex`. Task 3 adds three numeric fields sourced from data already on each entry. |
| `src/engine/evidence.ts` | Task 1 removes the "Size vs open interest" tile that duplicates the one `vitals.ts` already shows. |
| `src/engine/reasons.ts` | Task 6 adds `badgeQualifier()`, a short phrase per reason code, next to the existing `ruleExplanation()`. |
| `src/api/check.ts` | Task 6 exposes `badgeQualifier` on `CheckResponse` via `explained()`. |
| `src/api/observe.ts` | Task 7 adds one more free, tolerant Hyperliquid read (main-dex position count) alongside the existing free reads, used only for a comparison line. |
| `src/engine/observation.ts` | Task 7 adds `mainDexPositionCount: number \| null` to `Observation` (presentation-only field, not read by `computeVerdict`, so no schema-version bump). |
| `src/engine/interpret.ts` | Task 7 threads the new field through `present()`. |
| `src/engine/nansenContribution.ts` | Task 7 uses the new field for one comparison sentence. |
| `wrangler.toml` | Task 1 raises `NANSEN_DAILY_CREDIT_CAP` for the judging window. |
| `web/app.js` | Task 1 (recent-checks guard, auto-open), Task 2 (guess mechanic), Task 4 (board rendering), Task 5 (scale SVG), Task 6 (badge qualifier display). |
| `web/index.html` | Task 1 (heading casing), Task 2/4/5 (new markup + CSS). |
| `README.md` | Task 8 refreshes stale counts. |
| `docs/internal/` | Task 8 destination for the four internal strategy documents. |

Each task below is self-contained: its own files, its own tests, its own commit(s).

---

### Task 1: Quick correctness and consistency fixes

**Files:**
- Modify: `src/index.ts:69-73` (dedupe), `src/index.ts:366` (cache key), `src/engine/evidence.ts` (drop sizeVsOi tile), `web/app.js:611-619` (recent-checks guard), `web/app.js` end of file (auto-open), `web/index.html:213` (heading casing), `wrangler.toml` (`NANSEN_DAILY_CREDIT_CAP`)
- Test: `test/gallery-index.test.ts`, `test/engine/evidence.test.ts`, `test/api/check-golden.test.ts` (+ its `.snap`)

This task bundles seven small, independent fixes. Do them **in this order**, one commit each - later ones read more cleanly once earlier ones are in, and the auto-open fix (step 4) depends on the recent-checks guard (step 3) already being in place.

- [x] **Step 1: Л03 - stop showing a gallery row for an account a featured reading already supersedes**

Read `src/index.ts` around line 60-73 first (`const gallery = ...`, `const featured = ...`, `const listedGallery = ...`). The featured demonstration readings (`data/featured.json`) are fresher re-reads of specific accounts that also appear as older rows in `data/gallery.json`'s scan. Three of the four currently show up twice on the page with different numbers (verified live on 24.09: `0xb83de012...` reads $209.1M on the chip and $216.7M on gallery row #2; `0x082e843a...` reads $130.0M vs $125.9M; `0xf02d16a2...` reads $41.8M vs $42.7M). Historical gallery rows (kept in the archive, not the main list) are not part of this complaint and must stay untouched.

Change:

```typescript
const scriptedLedger = ledgerData as unknown as LedgerSummary;
```

to (insert directly above the `listedGallery` declaration, which currently reads `const listedGallery: GalleryIndex & { featured: GalleryIndex['entries'] } = { ...galleryIndex(gallery, galleryIdOf), featured: galleryIndex(featured, galleryIdOf).entries };`):

```typescript
// A featured reading is a fresher re-read of one of these accounts. Once it
// exists, the gallery's own (older) current row for the same address is a
// second, staler answer about the same account shown next to the fresh one -
// the older rules' rows in the archive are a different, intentional case and
// are left alone (24.09 audit, L03).
const featuredAddresses = new Set(featured.entries.filter((e) => !e.superseded).map((e) => e.address.toLowerCase()));
const gallerySansFeatured: Gallery = {
  ...gallery,
  entries: gallery.entries.filter((e) => e.historical || !featuredAddresses.has(e.address.toLowerCase())),
};
const listedGallery: GalleryIndex & { featured: GalleryIndex['entries'] } = {
  ...galleryIndex(gallerySansFeatured, galleryIdOf),
  featured: galleryIndex(featured, galleryIdOf).entries,
};
```

Remove the old `const listedGallery = ...` line you just replaced.

- [x] **Step 2: test it**

Add to `test/gallery-index.test.ts`, inside the existing `describe('the gallery list is rows, not cards', ...)` block:

```typescript
  it('drops a current row whose address a featured reading already supersedes (24.09 audit, L03)', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<{ address: string; historical?: unknown }>;
      featured: Array<{ address: string }>;
    };
    const featuredAddresses = new Set(list.featured.map((f) => f.address.toLowerCase()));
    const staleDuplicate = list.entries.find(
      (e) => !e.historical && featuredAddresses.has(e.address.toLowerCase()),
    );
    expect(staleDuplicate).toBeUndefined();
  });
```

Run: `npx vitest run test/gallery-index.test.ts`
Expected: this new test FAILS first (red), then PASSES once Step 1's code change is in place. If you're implementing both steps together, just run it after Step 1 and confirm PASS; also re-run the whole file to confirm nothing else broke.

- [x] **Step 3: commit**

```bash
git add src/index.ts test/gallery-index.test.ts
git commit -m "fix: a featured re-read's account does not also stand as an older gallery row"
```

- [x] **Step 4: Л08 - version the check cache key by the same things the observation is versioned by**

In `src/index.ts`, find:

```typescript
      const asked = focus ? `:${focus.coin}:${focus.side}` : '';
      const cacheKey = `check:${CLASSIFIER_VERSION}:${address}${asked}`;
```

Change to:

```typescript
      const asked = focus ? `:${focus.coin}:${focus.side}` : '';
      // The rules are one axis a cached answer can go stale on; the asset
      // registry (which contracts count as a hedge) is another. Without this,
      // a deploy that adds a token to the registry could still answer a
      // recognised holding as unrecognised for up to ten minutes (24.09
      // audit, L08).
      const cacheKey = `check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}${asked}`;
```

Add the import (find the existing `import { CLASSIFIER_VERSION } from './engine/verdict';` line and add a line near it):

```typescript
import { ASSET_REGISTRY_VERSION } from './engine/observation';
```

Search `src/index.ts` for every other occurrence of `` `check:${CLASSIFIER_VERSION}:${address}` `` (there is at least one more, inside the `focus` branch that reads the largest-position cache entry to check whether an asked-for coin/side is open) and update it the same way, to `` `check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}` ``.

- [x] **Step 5: run the full suite and commit**

Run: `npm test`
Expected: all passing (this key format is internal; no test pins the literal string).

```bash
git add src/index.ts
git commit -m "fix: a cached answer cannot outlive the asset registry that read it"
```

- [x] **Step 6: Л04 - only checks the reader actually ran go into \"Your recent checks\"**

Read `web/app.js` around line 441-460 (`function renderResult(d, opts) {`) and around line 610-619 (the `saveRecent`/`renderRecent` call at the end of `renderResult`). Currently:

```javascript
  $('card-canvas').hidden = true;
  $('copy-card').textContent = 'Copy image';
  if (d.snapshotId && d.positions.nPositions > 0) {
    saveRecent({
      id: d.snapshotId,
      address: d.address,
      headline: positionText(d),
      verdict: d.verdict.verdict,
      checkedAt: d.checkedAt,
    });
    renderRecent();
  }
}
```

This runs for `opts.kind` of `'live'`, `'saved'`, and `'gallery'` alike, so opening any of the four top chips or any gallery row - never a check - fills "Your recent checks, saved in this browser only" (verified live on 24.09: three chip opens produced three "recent checks" with no proof ever run). Change the guard:

```javascript
  $('card-canvas').hidden = true;
  $('copy-card').textContent = 'Copy image';
  if (kind === 'live' && d.snapshotId && d.positions.nPositions > 0) {
    saveRecent({
      id: d.snapshotId,
      address: d.address,
      headline: positionText(d),
      verdict: d.verdict.verdict,
      checkedAt: d.checkedAt,
    });
    renderRecent();
  }
}
```

(`kind` is already computed a few lines above this block via `const kind = kindOf(opts);` - reuse it rather than adding a second call.)

- [x] **Step 7: commit**

```bash
git add web/app.js
git commit -m "fix: only a check the reader ran becomes a recent check"
```

- [x] **Step 8: U01 - open the flagship reading for a visitor with no address and no link**

At the very bottom of `web/app.js`, find:

```javascript
loadGallery().finally(loadLedger);
if (window.location.hash === '#operator') setUpOperator();
const params = new URLSearchParams(window.location.search);
const saved = params.get('s');
const preset = params.get('address');
if (saved) {
  // A saved reading opens as itself. No check runs, so nothing is spent and
  // nothing can have changed between the link being written and read.
  openSnapshot(saved);
} else if (preset) {
  $('address').value = preset;
  setStatus('Address filled in from the link. Press Check to run it.');
  $('check').focus();
}
renderRecent();
```

Change the `if (saved) { ... } else if (preset) { ... }` to add a third branch, and add the flagship id as a named constant near the top of the file (next to `const PAGE_SIZE = 25;`):

```javascript
const PAGE_SIZE = 25;
// The reading a visitor with nothing pasted yet sees first: the funded-short
// demonstration reading, because its picture is the one that needs no
// explanation (a big bar, an empty solid segment, and $443.7M held in a
// dashed box beside it that "does not count"). Free to open - it is one of
// the four bundled chips, opened the same way a shared link would (24.09
// audit, U01).
const FLAGSHIP_ID = '075ocy85yngsu';
```

```javascript
if (saved) {
  // A saved reading opens as itself. No check runs, so nothing is spent and
  // nothing can have changed between the link being written and read.
  openSnapshot(saved);
} else if (preset) {
  // Filling the field is not running the check: a `?address=` link used to
  // spend a check the moment it opened in a browser, no click involved, so
  // a same-origin POST was one crafted link away regardless of who opened it
  // (23.09 audit, S01). The address is still ready for the reader's own
  // press of Check or Enter.
  $('address').value = preset;
  setStatus('Address filled in from the link. Press Check to run it.');
  $('check').focus();
} else {
  // Nothing pasted and nothing linked: the first thing on screen used to be
  // a blank form, and the strongest picture on the whole page was one click
  // away behind a chip nobody was told to press (24.09 audit, U01). This
  // costs nothing - the reading is bundled with the Worker - and it renders
  // the same way a shared link to it would, after `saveRecent`'s guard
  // (above) so it never pollutes "recent checks".
  openSnapshot(FLAGSHIP_ID);
}
renderRecent();
```

- [x] **Step 9: verify in the browser**

Open the deployed site (or `npm run dev` if you prefer, but see the memory note: a live local check spends real Nansen credits - do not press Check, only load the page) at its bare URL with no query string. Confirm the funded-short card ("The matching assets sit in a wallet that funded this account...") renders immediately, the address bar becomes `/?s=075ocy85yngsu`, and "Your recent checks" does **not** appear (nothing was saved).

- [x] **Step 10: commit**

```bash
git add web/app.js
git commit -m "feat: a visitor with nothing pasted sees the strongest reading first"
```

- [x] **Step 11: U04 - match the page heading to the product's own name**

In `web/index.html`, find `<h1>Bet or book</h1>` and change to `<h1>Bet or Book</h1>` (the title tag, the OG tags, and the README already write it this way; only the on-page heading does not).

- [x] **Step 12: commit**

```bash
git add web/index.html
git commit -m "docs: the heading on the page matches the product's own name"
```

- [x] **Step 13: Л06 - stop showing \"Size vs open interest\" twice on one card**

Read `src/engine/vitals.ts`'s `computeVitals` (it already pushes a `'Size vs open interest'` item whenever `input.sizeVsOi !== null`, sourced identically) and `src/engine/evidence.ts`'s `explain()` final return block. In `explain()`, find:

```typescript
  return {
    summary,
    evidence: present([
      { label: input.focus ? 'Selected position' : 'Largest position', value: headlineText(p), source: posSource },
      { label: 'Share of exposure', value: formatPct(p.headlineShare), source: posSource },
      { label: 'Net / gross exposure', value: formatPct(p.netToGross), source: posSource },
      hedgeItem(input),
      linkedItem(input),
      pnlItem(input.pnl),
      input.sizeVsOi === null
        ? null
        : { label: 'Size vs open interest', value: formatPct(input.sizeVsOi), source: 'Hyperliquid' },
    ]),
  };
```

Remove the trailing `input.sizeVsOi === null ? null : {...}` entry entirely (`sizeVsOi` stays a parameter of `EvidenceInput` - other functions in the file may still reference it; do not remove the field from the interface):

```typescript
  return {
    summary,
    evidence: present([
      { label: input.focus ? 'Selected position' : 'Largest position', value: headlineText(p), source: posSource },
      { label: 'Share of exposure', value: formatPct(p.headlineShare), source: posSource },
      { label: 'Net / gross exposure', value: formatPct(p.netToGross), source: posSource },
      hedgeItem(input),
      linkedItem(input),
      pnlItem(input.pnl),
    ]),
  };
```

- [x] **Step 14: regenerate the pinned golden snapshot deliberately**

This is a **pinned recorded-response snapshot** (`test/api/check-golden.test.ts`, backed by `test/api/__snapshots__/check-golden.test.ts.snap`, 2845 lines) - its own file header says "a change here is a change in what a reader sees, and has to be one somebody meant." Do not blindly accept the diff.

Run: `npx vitest run test/api/check-golden.test.ts -u`
Then: `git diff test/api/__snapshots__/check-golden.test.ts.snap`

Read the whole diff. Confirm:
1. Every removed line is `"label": "Size vs open interest",` (plus its sibling `"value"`/`"source"` lines) and every one of those removals sits inside an `"evidence": [...]` array, never inside a `"vitals": [...]` array (grep the diff's surrounding context, or open the file at each `-` line's location, to check).
2. No other line in the snapshot changed.

If anything else changed, stop and re-read your `evidence.ts` edit - you removed something extra.

Also run: `npx vitest run test/engine/evidence.test.ts`
Expected: PASS (no existing test asserts `'Size vs open interest'` is present in `evidence`; the field stays in `vitals`, which is a separate array this file does not touch).

- [x] **Step 15: commit**

```bash
git add src/engine/evidence.ts test/api/__snapshots__/check-golden.test.ts.snap
git commit -m "fix: size versus open interest sits once on a card, in vitals, not twice"
```

- [x] **Step 16: S01 - raise the daily credit cap for the judging window**

In `wrangler.toml`, find:

```toml
[vars]
NANSEN_DAILY_CREDIT_CAP = "300"
NANSEN_CREDIT_FLOOR = "5"
```

Change to:

```toml
[vars]
# Raised from 300 for 25-27 September (judging week): the public share (cap
# minus NANSEN_DEMO_RESERVE) was exhausted by roughly 35-40 checks a day at
# up to 7 credits each, which a single afternoon of visitors clears easily.
# The account balance (~916 credits as of 24.09) and NANSEN_CREDIT_FLOOR
# still bound total spend regardless of this number. Revert to 300 (or lower)
# after the buildathon window closes (2026-09-27 23:59 UTC).
NANSEN_DAILY_CREDIT_CAP = "600"
NANSEN_CREDIT_FLOOR = "5"
```

- [x] **Step 17: commit (config only - do not deploy)**

```bash
git add wrangler.toml
git commit -m "chore: raise the daily credit cap for the judging window"
```

Note in your final report to the controller that this change needs `npx wrangler deploy` to take effect on the live site, and that deploy is intentionally not run as part of this task.

- [x] **Step 18: run the whole suite once more before finishing this task**

Run: `npm test && npm run typecheck`
Expected: all green. Report DONE with a one-line summary of the seven commits made.

---

### Task 2: Guess the verdict while a live check is running

**Files:**
- Modify: `web/app.js` (the `load()` function and `runCheck()`/`checkPosition()`), `web/index.html` (new markup + CSS)
- No backend changes, no new tests file (this is a pure client-side, unvalidated-by-design feature - verify by hand in the browser per the steps below, the same way the codebase already treats `localStorage`-backed conveniences like "recent checks").

**Design.** Only during a **live** check (`method === 'POST'`), and only if the answer has not arrived within 700ms (a cached or in-flight-shared answer must never show this - it would imply a guess about something already known). Four optional chips: Bet / Hedge / Book / Can't tell. Once the card renders, one line compares the guess to the actual verdict and a running match count (stored in `localStorage`, the same trust level as "recent checks") is shown. The word "correct" is never used - the product's own voice never claims more certainty than "looks like."

- [x] **Step 1: add the markup**

In `web/index.html`, find:

```html
<p class="status" id="status" role="status"></p>
```

Add directly after it:

```html
<div class="guess" id="guess" hidden>
  <span class="guess-label">Guess before it loads:</span>
  <span class="guess-chips" id="guess-chips">
    <button class="chip" data-guess="looks_like_a_bet">Bet</button>
    <button class="chip" data-guess="hedged">Hedge</button>
    <button class="chip" data-guess="book">Book</button>
    <button class="chip" data-guess="cant_tell">Can't tell</button>
  </span>
</div>
```

Add CSS near the existing `.examples` rules (same file, `<style>` block):

```css
.guess { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 0; font-size: 13px; }
.guess-label { color: var(--muted); }
.guess-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.guess-chips .chip { padding: 4px 10px; font-size: 12px; }
.guess-result { font-size: 13px; color: var(--muted); margin: 8px 0 0; }
```

- [x] **Step 2: track the pending guess and reveal the chips after a delay**

In `web/app.js`, add near the top-level state (next to `let current = null;`):

```javascript
let pendingGuess = null;
let guessRevealTimer = null;
```

Find `function load(url, onData, failureText, method, notice, retryDelays) {` and, right after `const seq = ++requestSeq;` and `setBusy(true);`, add the reveal-timer logic. The guess should only ever appear for a live check (`method === 'POST'` and the URL is `/api/check`), never for a GET (opening a saved reading) - reuse the same `url.indexOf('/api/check') === 0` test the operator-key code above it already uses:

```javascript
async function load(url, onData, failureText, method, notice, retryDelays) {
  const seq = ++requestSeq;
  setBusy(true);
  // A guessing prompt only belongs to a live check that is actually taking
  // a moment - a cached or already-in-flight answer must not imply there was
  // anything to guess. Revealed only if nothing has come back within 700ms,
  // and hidden again the instant an answer (of any kind) does (24.09 audit,
  // user-approved mechanic: "guess the verdict").
  pendingGuess = null;
  $('guess').hidden = true;
  clearTimeout(guessRevealTimer);
  const isLiveCheck = method === 'POST' && url.indexOf('/api/check') === 0;
  if (isLiveCheck) {
    guessRevealTimer = setTimeout(() => {
      if (seq === requestSeq) $('guess').hidden = false;
    }, 700);
  }
  const doing = method === 'POST' ? 'Reading positions from Nansen and orders from Hyperliquid...' : 'Opening the saved reading...';
  setStatus((notice ? notice + ' ' : '') + doing, false);
  try {
    let res;
    let data;
    const key = method === 'POST' && url.indexOf('/api/check') === 0 ? operatorKey() : '';
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, key ? { method, headers: { 'x-demo-key': key } } : { method: method || 'GET' });
      data = await res.json().catch(() => ({}));
      if (seq !== requestSeq) return;
      const wait = res.status === 404 && retryDelays ? retryDelays[attempt] : undefined;
      if (wait === undefined) break;
      setStatus(
        'Not found here yet. A reading saved in the last minute can take that long to reach every region - trying again...',
        false,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (seq !== requestSeq) return;
    }
    clearTimeout(guessRevealTimer);
    $('guess').hidden = true;
    if (!res.ok) {
      setStatus((data.error || failureText) + (current ? ' The card below is the previous reading.' : ''), true);
      return;
    }
    setStatus(notice || '', false);
    onData(data);
  } catch (e) {
    clearTimeout(guessRevealTimer);
    $('guess').hidden = true;
    if (seq === requestSeq) {
      setStatus(
        'Could not reach the server. Try again shortly.' + (current ? ' The card below is the previous reading.' : ''),
        true,
      );
    }
  } finally {
    if (seq === requestSeq) setBusy(false);
  }
}
```

(Only the marked lines are new; the body of the `try` block is otherwise identical to the current file - keep every other line exactly as it is today.)

- [x] **Step 3: wire up the chip clicks**

Add near the other top-level event listeners (after the `$('check-live').addEventListener(...)` block):

```javascript
$('guess-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  pendingGuess = btn.dataset.guess;
  for (const b of $('guess-chips').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
});
```

- [x] **Step 4: show the comparison once the card renders, and keep a running count**

Add near the other `localStorage`-backed helpers (next to `RECENT_KEY`/`MAX_RECENT`):

```javascript
// A viewer's own browser only, exactly like "recent checks" - never sent
// anywhere, never read by the server, wrapped in try/catch for a private
// window or blocked storage.
const GUESS_STATS_KEY = 'betOrBook:guessStats';
const GUESS_LABEL = { looks_like_a_bet: 'Bet', hedged: 'Hedge', book: 'Book', cant_tell: "couldn't tell" };

function loadGuessStats() {
  try {
    const raw = window.localStorage.getItem(GUESS_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : { matches: 0, total: 0 };
    return typeof parsed.matches === 'number' && typeof parsed.total === 'number' ? parsed : { matches: 0, total: 0 };
  } catch (e) {
    return { matches: 0, total: 0 };
  }
}

function recordGuess(matched) {
  try {
    const stats = loadGuessStats();
    stats.total += 1;
    if (matched) stats.matches += 1;
    window.localStorage.setItem(GUESS_STATS_KEY, JSON.stringify(stats));
    return stats;
  } catch (e) {
    return null;
  }
}
```

In `renderResult(d, opts)`, find the line `$('badge').textContent = badgeText(d);` and, just before it, add:

```javascript
  $('guess').hidden = true;
  clearTimeout(guessRevealTimer);
  const guessBox = $('guess-result');
  if (guessBox) guessBox.remove();
  if (kindOf(opts) === 'live' && pendingGuess !== null) {
    const guessed = pendingGuess;
    pendingGuess = null;
    const p = el('p', 'guess-result');
    if (guessed === 'cant_tell') {
      p.textContent = "You said you couldn't tell. The reading found: " + badgeText(d) + '.';
    } else {
      const matched = guessed === d.verdict.verdict;
      const stats = recordGuess(matched);
      p.textContent =
        'You guessed ' + GUESS_LABEL[guessed] + '. The reading says ' + badgeText(d) + '.' +
        (stats ? ' Matched ' + stats.matches + ' of ' + stats.total + ' so far.' : '');
    }
    $('status').insertAdjacentElement('afterend', p);
  }
```

- [x] **Step 5: verify in the browser**

Open the deployed site. Paste any address that is not already cached (or wait past its 10-minute cache window), click a guess chip, press Check. Confirm: the guess chips appear only after roughly 700ms, disappear the instant the card renders, and one sentence above the badge reports the guess against the real answer with a running count. Reload the page, guess again, confirm the count persists across the reload (same browser). Open one of the four top chips (a saved reading, not a live check) and confirm no guess UI ever appears for it.

- [x] **Step 6: commit**

```bash
git add web/app.js web/index.html
git commit -m "feat: guess the verdict while a live check is still running"
```

---

### Task 3: Ratings board - the three numbers the board needs, on every gallery row

**Files:**
- Modify: `src/gallery.ts`
- Test: `test/gallery-index.test.ts`, `test/gallery.test.ts`

**Files:**
- Modify: `src/gallery.ts:GalleryRow` and `galleryIndex()`
- Test: `test/gallery-index.test.ts`

Read `src/gallery.ts` in full first. The `GalleryRow` interface currently carries `verdict` and a `positions` slice, but not `hedge.hedgeRatio`, `sizeVsOi`, or `orders.headlineTwoSidedNotionalUsd` - all three already exist on every full `CheckResponse` entry in `gallery.entries`/`featured.entries`, computed at check time, at zero extra Nansen cost. The board (Task 4) ranks by these.

- [x] **Step 1: write the failing test**

Add to `test/gallery-index.test.ts`:

```typescript
  it('carries the numbers a ratings board ranks by, on every row (24.09 mechanic: ratings board)', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<{
        hedgeRatio: number;
        sizeVsOi: number | null;
        headlineTwoSidedNotionalUsd: number;
      }>;
    };
    const row = list.entries[0];
    expect(typeof row.hedgeRatio).toBe('number');
    expect(row.sizeVsOi === null || typeof row.sizeVsOi === 'number').toBe(true);
    expect(typeof row.headlineTwoSidedNotionalUsd).toBe('number');
  });
```

- [x] **Step 2: run it, confirm it fails**

Run: `npx vitest run test/gallery-index.test.ts -t "ratings board"`
Expected: FAIL - `row.hedgeRatio` is `undefined`.

- [x] **Step 3: extend `GalleryRow` and the mapping**

In `src/gallery.ts`, find:

```typescript
export interface GalleryRow {
  snapshotId: string;
  address: string;
  checkedAt: string;
  classifierVersion: string;
  verdict: Pick<CheckResponse['verdict'], 'verdict' | 'strength'>;
  positions: Pick<CheckResponse['positions'], 'headlineCoin' | 'headlineSide' | 'headlineNotionalUsd' | 'nPositions'>;
  historical?: { reason: string };
  supersedes?: string;
}
```

Change to:

```typescript
export interface GalleryRow {
  snapshotId: string;
  address: string;
  checkedAt: string;
  classifierVersion: string;
  verdict: Pick<CheckResponse['verdict'], 'verdict' | 'strength'>;
  positions: Pick<CheckResponse['positions'], 'headlineCoin' | 'headlineSide' | 'headlineNotionalUsd' | 'nPositions'>;
  /** How much of the headline position this address's own holdings cover.
   * Zero for a long (spot cannot offset one) and for anything the hedge
   * search never ran on. Lets a ratings board rank covered/uncovered shorts
   * without opening every card (24.09 mechanic: ratings board). */
  hedgeRatio: number;
  /** Headline notional divided by the market's open interest, or null when
   * open interest could not be read for that reading. */
  sizeVsOi: number | null;
  /** Dollars of genuinely two-sided quoting in the headline market itself -
   * the number the Book rule actually turns on (v5). Zero for every verdict
   * but Book, since that is the only path `computeVerdict` reaches it from. */
  headlineTwoSidedNotionalUsd: number;
  historical?: { reason: string };
  supersedes?: string;
}
```

In the same file, find the `.map((e) => ({ ... }))` inside `galleryIndex()`:

```typescript
      .map((e) => ({
        snapshotId: idOf(e),
        address: e.address,
        checkedAt: e.checkedAt,
        classifierVersion: e.classifierVersion,
        verdict: { verdict: e.verdict.verdict, strength: e.verdict.strength },
        positions: {
          headlineCoin: e.positions.headlineCoin,
          headlineSide: e.positions.headlineSide,
          headlineNotionalUsd: e.positions.headlineNotionalUsd,
          nPositions: e.positions.nPositions,
        },
        ...(e.historical ? { historical: { reason: e.historical.reason } } : {}),
        ...(e.supersedes ? { supersedes: e.supersedes } : {}),
      })),
```

Change to:

```typescript
      .map((e) => ({
        snapshotId: idOf(e),
        address: e.address,
        checkedAt: e.checkedAt,
        classifierVersion: e.classifierVersion,
        verdict: { verdict: e.verdict.verdict, strength: e.verdict.strength },
        positions: {
          headlineCoin: e.positions.headlineCoin,
          headlineSide: e.positions.headlineSide,
          headlineNotionalUsd: e.positions.headlineNotionalUsd,
          nPositions: e.positions.nPositions,
        },
        hedgeRatio: e.hedge.hedgeRatio,
        sizeVsOi: e.sizeVsOi,
        headlineTwoSidedNotionalUsd: e.orders.headlineTwoSidedNotionalUsd,
        ...(e.historical ? { historical: { reason: e.historical.reason } } : {}),
        ...(e.supersedes ? { supersedes: e.supersedes } : {}),
      })),
```

- [x] **Step 4: run the test, confirm it passes, then run the whole suite**

Run: `npx vitest run test/gallery-index.test.ts`
Expected: PASS, including the existing `'sends what a row shows, a small fraction of the cards themselves'` test - it only asserts the *heavy* fields (`summary`, `evidence`, `coverage`, `orders`, `hedge`, `trades`, `vitals`) are absent and that the payload stays under a fifth of the full data size; three added numbers do not approach that ratio (verify by re-running that specific test, not just assuming).

Run: `npm test`
Expected: all green. `test/gallery.test.ts` and `test/featured.test.ts` construct `GalleryRow`-shaped objects nowhere directly (they read full `CheckResponse` entries) - if either fails, read the failure and fix the specific assertion; do not change this task's scope to "fix unrelated pre-existing test."

- [x] **Step 5: commit**

```bash
git add src/gallery.ts test/gallery-index.test.ts
git commit -m "feat: every gallery row carries the numbers a ratings board would rank by"
```

---

### Task 4: Ratings board - the UI

**Files:**
- Modify: `web/app.js`, `web/index.html`
- Depends on: Task 3 (the three new `GalleryRow` fields must exist)

**Design.** Five short, named boards computed client-side from `gallery.currentRows` (already loaded for the existing list) plus `gallery.featured`, each capped at 5 rows, each row opening the existing `galleryRow()` button behaviour (free, via `/api/snapshot`). No new network calls, no new server route, no daily re-scan job in this pass (that is a documented follow-up, not required for the board to be real and useful today - it already has 190+ rows to rank). The existing flat, filterable "All N" list moves into a `<details>` element below the boards, closed by default (this also resolves audit item U07, "the first thing shown is a stat-and-filter wall").

Categories (ranked from data that already exists, nothing invented, no adjective like "reckless"):
1. **Biggest bets** - `verdict.verdict === 'looks_like_a_bet'`, sorted by `positions.headlineNotionalUsd` descending.
2. **Biggest slice of a market** - rows with `sizeVsOi !== null`, sorted by `sizeVsOi` descending.
3. **Best covered shorts** - `verdict.verdict === 'hedged'` and `positions.headlineSide === 'short'`, sorted by `hedgeRatio` descending.
4. **Least covered shorts** - `positions.headlineSide === 'short'` and `hedgeRatio < 0.1`, sorted by `hedgeRatio` ascending.
5. **Market makers** - `verdict.verdict === 'book'`, sorted by `headlineTwoSidedNotionalUsd` descending.

A board with zero qualifying rows is skipped entirely (not shown with an empty state) - do not claim there is nothing to see when the honest answer is "the current rules haven't called one of these yet."

- [x] **Step 1: add the markup shell**

In `web/index.html`, find:

```html
<section id="gallery" hidden>
  <h2 id="gallery-title">More readings of big Hyperliquid positions</h2>
  <p class="sub" id="gallery-sub"></p>
  <div class="chips" id="chips"></div>
  <ol class="list" id="gallery-list"></ol>
  <button class="more" id="more" hidden>Show more</button>
  <details class="archive" id="archive">
    <summary id="archive-summary">How these were picked, and the readings made under earlier rules</summary>
    <p class="sub" id="gallery-stats"></p>
    <p class="sub" id="gallery-method"></p>
    <ol class="list" id="archive-list"></ol>
    <button class="more" id="archive-more" hidden>Show more</button>
  </details>
</section>
```

Replace with:

```html
<section id="gallery" hidden>
  <h2>Ranked from the same readings</h2>
  <p class="sub" id="gallery-sub"></p>
  <div id="boards"></div>
  <details id="all-readings">
    <summary id="all-readings-summary">Browse every reading</summary>
    <h3 id="gallery-title">More readings of big Hyperliquid positions</h3>
    <div class="chips" id="chips"></div>
    <ol class="list" id="gallery-list"></ol>
    <button class="more" id="more" hidden>Show more</button>
    <details class="archive" id="archive">
      <summary id="archive-summary">How these were picked, and the readings made under earlier rules</summary>
      <p class="sub" id="gallery-stats"></p>
      <p class="sub" id="gallery-method"></p>
      <ol class="list" id="archive-list"></ol>
      <button class="more" id="archive-more" hidden>Show more</button>
    </details>
  </details>
</section>
```

Add CSS near the existing `.list`/`.row-meta` rules:

```css
.board { margin: 0 0 28px; }
.board h3 { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
.board .board-note { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
#all-readings { margin-top: 8px; font-size: 13px; }
#all-readings > summary { cursor: pointer; color: var(--link); }
```

- [x] **Step 2: write the ranking + rendering functions**

In `web/app.js`, find the section marked `// ---- gallery ----` and, directly above `function renderGallery() {`, add:

```javascript
// ---- ratings board ----
//
// Five short boards, ranked from numbers every reading already carries -
// nothing new is fetched, nothing is invented, and a board with nothing
// that qualifies is left out rather than shown empty (24.09 mechanic:
// ratings board, user-approved; replaces the flat "More readings" list as
// the first thing shown, folding in audit item U07).
const BOARDS = [
  {
    title: 'Biggest bets',
    note: 'Looks like a bet, ranked by size.',
    filter: (e) => e.verdict.verdict === 'looks_like_a_bet',
    sort: (a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd,
    stat: (e) => fmtUsd(e.positions.headlineNotionalUsd),
  },
  {
    title: 'Biggest slice of a market',
    note: "Position size against that market's open interest on Hyperliquid.",
    filter: (e) => e.sizeVsOi !== null && e.sizeVsOi > 0,
    sort: (a, b) => b.sizeVsOi - a.sizeVsOi,
    stat: (e) => fmtPct(e.sizeVsOi) + ' of open interest',
  },
  {
    title: 'Best covered shorts',
    note: 'Hedged: the same account holds the offsetting spot.',
    filter: (e) => e.verdict.verdict === 'hedged' && e.positions.headlineSide === 'short',
    sort: (a, b) => b.hedgeRatio - a.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
  {
    title: 'Least covered shorts',
    note: 'Under 10% covered by this address - the rest is still open.',
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeRatio < 0.1,
    sort: (a, b) => a.hedgeRatio - b.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
  {
    title: 'Market makers',
    note: "Book: the account quotes the position's own market on both sides.",
    filter: (e) => e.verdict.verdict === 'book',
    sort: (a, b) => b.headlineTwoSidedNotionalUsd - a.headlineTwoSidedNotionalUsd,
    stat: (e) => fmtUsd(e.headlineTwoSidedNotionalUsd) + ' matched',
  },
];
const BOARD_SIZE = 5;

function boardRow(e, board) {
  const li = el('li');
  const b = el('button');
  b.append(
    el('span', 'pos', positionText(e)),
    el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address)),
  );
  b.addEventListener('click', async () => {
    await openSnapshot(e.snapshotId);
    if (current && current.snapshotId === e.snapshotId) {
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  li.append(b);
  return li;
}

function renderBoards(rows) {
  const box = $('boards');
  box.replaceChildren();
  for (const board of BOARDS) {
    const matches = rows.filter(board.filter).sort(board.sort).slice(0, BOARD_SIZE);
    if (matches.length === 0) continue;
    const section = el('div', 'board');
    section.append(el('h3', null, board.title), el('p', 'board-note', board.note));
    const list = el('ol', 'list');
    list.append(...matches.map((e) => boardRow(e, board)));
    section.append(list);
    box.append(section);
  }
}
```

- [x] **Step 3: call it from `loadGallery()`**

In `loadGallery()`, find:

```javascript
  gallery.currentRows = open.filter((e) => !e.historical);
  gallery.historicalRows = open.filter((e) => e.historical);
```

Add directly after:

```javascript
  renderBoards(gallery.currentRows);
```

- [x] **Step 4: update the button-label wiring for the renamed elements**

Find `$('archive-summary').textContent = ...` and, near it, add nothing new - `#all-readings-summary`'s text is static in the HTML ("Browse every reading") and does not need to change per state. Leave `renderGallery()`, `renderArchive()`, and the `$('archive')`/`$('more')`/`$('archive-more')` listeners exactly as they are; they still target the same element ids, now nested one level deeper in the DOM, which changes nothing about how `document.getElementById` finds them.

- [x] **Step 5: verify in the browser**

Open the deployed site. Confirm: below the card, a "Ranked from the same readings" heading shows up to five short boards (skip any that legitimately have zero rows - e.g. "Market makers" may show only one or two), each board's rows open a card on click, and a collapsed "Browse every reading" `<details>` contains the previous flat list with its filter chips and archive, unchanged in behaviour.

- [x] **Step 6: commit**

```bash
git add web/app.js web/index.html
git commit -m "feat: five ranked boards from readings already on file, ahead of the flat list"
```

---

### Task 5: The balance-scale diagram (page SVG)

**Files:**
- Modify: `web/app.js` (replace `renderBreakdown`/`drawBreakdownWide`/`drawBreakdownNarrow` with a scale renderer; `drawCard`'s canvas version and `src/engine/ogRender.ts`'s satori version keep drawing the existing bar in this pass - see the note at the end of this task)
- Modify: `web/index.html` (CSS for the new SVG classes)

**Design, and why it is safe.** The data this reads is **unchanged**: `d.breakdown` (`applies`, `coin`, `side`, `headlineUsd`, `segments: [{kind, usd, share}]`, `excessUsd`, `elsewhere`) for a short, `d.orders` (`headlineTwoSidedNotionalUsd`, `headlineQuoteNotionalUsd`) for a book, and `d.positions` for a long. Only the drawing changes. Three states, matched to what the rules can actually tell you:

1. **Resolved tilt** (`breakdown.applies`, and neither an `unverified` nor a `not-checked` segment is present, or only a small one): a beam that tilts by how much of the position is covered. Level = matched (hedged). Tilted hard toward the position = uncovered (bet-shaped short). Tilted the other way = over-covered ("leans long"). The tilt angle is `clamp(((covered + excess) / headlineUsd) - 1, -1, 1) * 12` degrees - continuous, so 52% and 97% covered visibly differ, matching the existing "a hedge is a band, not a floor" principle.
2. **Suspended** (`breakdown.applies`, and a `not-checked` or a material `unverified` segment is present): the right pan is drawn as a dashed outline with a question mark, beam level - **not** tilted, because a partial or failed read must never be drawn as if it proved a ratio. This is the same distinction the current bar already carries via a fainter fill; the scale must carry it too, or it would claim more than the data supports.
3. **Not applicable** (`!breakdown.applies`, `positions.nPositions > 0`, `headlineSide === 'long'`): an empty, solid-outlined right pan (not dashed - this is not "unknown", it is "spot cannot offset a long, full stop") with a caption saying so.

A **book** does not get a scale (coverage is not the question for a book) - it gets a two-segment bar: matched notional (`headlineTwoSidedNotionalUsd`, solid) against the rest of what is quoted in that market (`headlineQuoteNotionalUsd - headlineTwoSidedNotionalUsd`, faint), which is the exact number the v5 Book rule turns on (fixes audit L01 - this number was on no card at all before this task).

Funders (`breakdown.elsewhere`) hang beside the scale on a dashed line exactly as they do today on the bar - not on the beam, not counted.

- [x] **Step 1: replace the drawing constants and helpers**

In `web/app.js`, find the block starting `const SEGMENT_STYLE = {` through the end of `drawBreakdownNarrow` (everything between the `// ---- the evidence diagram ----` comment and `function renderBreakdown(d) {`). Replace that whole block with:

```javascript
// ---- the evidence diagram: a balance scale ----
//
// Left pan is the position; right pan is what was found against it. A level
// beam is a hedge in band; a beam that tilts toward the position is
// uncovered; a beam that tilts the other way is over-covered ("leans
// long") - the same three situations the rules already distinguish
// (hedge_leg / partial_offset / over_covered), now a single continuous
// angle instead of three unrelated sentences (24.09 mechanic: balance
// scale, user-approved; replaces the segmented bar, which the audit's own
// first reader could not parse unprompted).
//
// A read that was partial or failed is drawn as a *suspended* pan - dashed,
// with a question mark, beam level - never as a confident tilt: an unread
// side of a scale has not been weighed, and drawing it as balanced or as
// empty would both claim more than the data supports (mirrors the bar's
// own not-checked/unverified opacity rule, audit L12).
const svgEl = (name, attrs, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

const MAX_TILT_DEG = 12;
/** Below this share of the position, an unread or unidentified segment is
 * dust and the scale still gives a resolved tilt rather than suspending. */
const MATERIAL_GAP_SHARE = 0.1;

function scaleGeometry(W) {
  const beamY = 46;
  const beamHalf = Math.min(150, W * 0.32);
  const pivotX = W / 2;
  const panDrop = 54;
  const panW = 30;
  const panH = 22;
  return { beamY, beamHalf, pivotX, panDrop, panW, panH };
}

/** One pan (a small rectangle) hanging from one end of the beam, at the
 * given vertical drop and horizontal offset the current tilt puts it at. */
function drawPan(svg, cx, cy, g, dashed, fillColor, fillOpacity) {
  const { panW, panH } = g;
  svg.append(
    svgEl('rect', {
      x: cx - panW / 2, y: cy, width: panW, height: panH, rx: 3,
      fill: dashed ? 'none' : fillColor, 'fill-opacity': dashed ? 1 : fillOpacity,
      stroke: dashed ? 'var(--faint)' : 'var(--line)',
      'stroke-width': dashed ? 1.5 : 1,
      'stroke-dasharray': dashed ? '4 4' : 'none',
    }),
  );
}

function drawBeamAndPivot(svg, g, tiltDeg, accent) {
  const { beamY, beamHalf, pivotX, panDrop } = g;
  const rad = (tiltDeg * Math.PI) / 180;
  const leftX = pivotX - beamHalf * Math.cos(rad);
  const leftY = beamY - beamHalf * Math.sin(rad);
  const rightX = pivotX + beamHalf * Math.cos(rad);
  const rightY = beamY + beamHalf * Math.sin(rad);
  // The post the beam pivots on.
  svg.append(svgEl('line', { x1: pivotX, y1: beamY, x2: pivotX, y2: beamY + 8, stroke: 'var(--faint)', 'stroke-width': 2 }));
  svg.append(svgEl('circle', { cx: pivotX, cy: beamY, r: 3, fill: accent }));
  svg.append(svgEl('line', { x1: leftX, y1: leftY, x2: rightX, y2: rightY, stroke: accent, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  svg.append(svgEl('line', { x1: leftX, y1: leftY, x2: leftX, y2: leftY + panDrop, stroke: 'var(--faint)', 'stroke-width': 1.5 }));
  svg.append(svgEl('line', { x1: rightX, y1: rightY, x2: rightX, y2: rightY + panDrop, stroke: 'var(--faint)', 'stroke-width': 1.5 }));
  return { leftX, leftY: leftY + panDrop, rightX, rightY: rightY + panDrop };
}

/** The short/hedge case: a scale, tilted by how much was found against the
 * position, or suspended (dashed, level, a question mark) when the read was
 * partial or left something material unidentified. */
function drawScale(svg, b, accent, W) {
  const g = scaleGeometry(W);
  const covered = b.segments.find((s) => s.kind === 'covered')?.usd ?? 0;
  const notChecked = b.segments.find((s) => s.kind === 'not-checked')?.usd ?? 0;
  const unverified = b.segments.find((s) => s.kind === 'unverified')?.usd ?? 0;
  const materialGap = Math.max(notChecked, notChecked > 0 ? 0 : unverified) >= MATERIAL_GAP_SHARE * b.headlineUsd;
  const suspended = notChecked > 0 || (unverified > 0 && materialGap);

  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `${fmtUsd(b.headlineUsd)} ${b.coin} ${b.side}`));

  let caption;
  let pans;
  if (suspended) {
    pans = drawBeamAndPivot(svg, g, 0, 'var(--faint)');
    drawPan(svg, pans.leftX, pans.leftY, g, false, accent, 1);
    drawPan(svg, pans.rightX, pans.rightY, g, true, accent, 1);
    svg.append(svgEl('text', { x: pans.rightX, y: pans.rightY + 15, class: 'seg-value', 'text-anchor': 'middle' }, '?'));
    const floor = covered > 0 ? `${fmtUsd(covered)} found so far (a floor). ` : '';
    caption = `${floor}${notChecked > 0 ? "Part of this address's holdings" : 'Some matching holdings'} could not be read in full - the scale could still tip either way.`;
  } else {
    const excess = b.excessUsd ?? 0;
    const ratio = b.headlineUsd > 0 ? (covered + excess) / b.headlineUsd : 0;
    const tiltDeg = Math.max(-1, Math.min(1, ratio - 1)) * MAX_TILT_DEG;
    pans = drawBeamAndPivot(svg, g, tiltDeg, accent);
    drawPan(svg, pans.leftX, pans.leftY, g, false, accent, 1);
    drawPan(svg, pans.rightX, pans.rightY, g, false, accent, 1);
    if (ratio >= 1.05) {
      caption = `Covered, and ${fmtUsd(excess)} more besides: on ${b.coin} itself, this leans long, not neutral.`;
    } else if (ratio >= 0.85) {
      caption = `${fmtPct(ratio)} covered by ${b.coin} this address holds - level, in band.`;
    } else {
      caption = `Only ${fmtPct(ratio)} covered by ${b.coin} this address holds; the rest is still open.`;
    }
  }

  const capY = pans.leftY + g.panH + 26;
  const capEl = svgEl('text', { x: 0, y: capY, class: 'seg-label' }, caption);
  svg.append(capEl);
  let y = capY;

  if (b.elsewhere) {
    y += 26;
    const midX = W / 2;
    svg.append(svgEl('path', { d: `M ${midX} ${y - 12} L ${midX} ${y + 6}`, stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4', fill: 'none' }));
    y += 22;
    svg.append(svgEl('text', { x: 0, y, class: 'seg-value' }, `${fmtUsd(b.elsewhere.usd)} held elsewhere`));
    y += 18;
    svg.append(svgEl('text', { x: 0, y, class: 'seg-label' }, `in ${plural(b.elsewhere.wallets, 'wallet')} that funded this account - not on the scale, since funding is not ownership`));
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${y + 12}`);
}

/** A long: spot cannot offset it, so the right pan is empty by definition -
 * not "unknown" (dashed/suspended), a plain fact (solid outline, nothing in
 * it). Fixes audit L02: a long used to have no diagram at all. */
function drawEmptyPan(svg, coin, side, headlineUsd, W) {
  const g = scaleGeometry(W);
  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `${fmtUsd(headlineUsd)} ${coin} ${side}`));
  const pans = drawBeamAndPivot(svg, g, -MAX_TILT_DEG * 0.6, 'var(--line)');
  drawPan(svg, pans.leftX, pans.leftY, g, false, 'var(--line)', 1);
  svg.append(svgEl('rect', { x: pans.rightX - g.panW / 2, y: pans.rightY, width: g.panW, height: g.panH, rx: 3, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.5 }));
  const capY = pans.leftY + g.panH + 26;
  svg.append(svgEl('text', { x: 0, y: capY, class: 'seg-label' }, 'Spot cannot offset a long. Debts and other derivatives are not read here.'));
  svg.setAttribute('viewBox', `0 0 ${W} ${capY + 12}`);
}

/** Book: not a coverage question, so no scale - a bar showing the one
 * number the v5 rule actually turns on: how much of the quoting in this
 * market alone is genuinely matched (fixes audit L01: this number was
 * previously shown on no card at all). */
function drawBookQuoting(svg, d, W) {
  const o = d.orders;
  const p = d.positions;
  const matched = o.headlineTwoSidedNotionalUsd || 0;
  const quoted = Math.max(matched, o.headlineQuoteNotionalUsd || 0);
  const barY = 26;
  const barH = 30;
  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `Quoting in ${p.headlineCoin} itself`));
  const matchedW = quoted > 0 ? Math.max(2, (matched / quoted) * W) : 0;
  svg.append(svgEl('rect', { x: 0, y: barY, width: W, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 0.25, stroke: 'var(--line)', 'stroke-width': 1 }));
  if (matchedW > 0) {
    svg.append(svgEl('rect', { x: 0, y: barY, width: matchedW, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 1, stroke: 'var(--line)', 'stroke-width': 1 }));
  }
  const share = p.headlineNotionalUsd > 0 ? matched / p.headlineNotionalUsd : 0;
  const capY = barY + barH + 22;
  svg.append(
    svgEl('text', { x: 0, y: capY, class: 'seg-label' },
      `${fmtUsd(matched)} matched both sides in ${p.headlineCoin} itself - ${fmtPct(share)} of the ${fmtUsd(p.headlineNotionalUsd)} ${p.headlineSide}`),
  );
  svg.setAttribute('viewBox', `0 0 ${W} ${capY + 12}`);
}
```

- [x] **Step 2: rewrite `renderBreakdown` to pick one of the three drawings**

Find the existing `function renderBreakdown(d) {` and replace its whole body:

```javascript
function renderBreakdown(d) {
  const box = $('breakdown');
  const isBook = d.verdict.verdict === 'book' && d.orders && d.orders.headlineTwoSided;
  const b = d.breakdown;
  const isLong = !isBook && (!b || !b.applies) && d.positions.nPositions > 0 && d.positions.headlineSide === 'long';
  if (!isBook && (!b || !b.applies || !b.segments.length) && !isLong) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.style.setProperty('--accent', verdictOf(d).accent);

  const W = box.clientWidth || 640;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 160`, role: 'img' });
  // Sourced from `d.positions`, never from `b`, even when not isBook: an
  // ancient stored reading from before `breakdown` existed at all can have
  // `b === undefined` while still being a long position worth an empty pan
  // (`isLong` only requires `!b || !b.applies`) - reading `b.coin` there
  // would throw. `positions.headlineCoin/headlineSide/headlineNotionalUsd`
  // are always present, and equal `b.coin/side/headlineUsd` in every case
  // where `b` does exist (breakdown.ts sets them from `positions` even when
  // `applies` is false), so this is never a different value, only a safer
  // path to it.
  const coin = d.positions.headlineCoin;
  const side = d.positions.headlineSide;
  const headlineUsd = d.positions.headlineNotionalUsd;
  svg.append(svgEl('title', {}, `${fmtUsd(headlineUsd)} ${coin} ${side}, and what was found against it`));

  if (isBook) {
    drawBookQuoting(svg, d, W);
  } else if (isLong) {
    drawEmptyPan(svg, d.positions.headlineCoin, d.positions.headlineSide, d.positions.headlineNotionalUsd, W);
  } else {
    drawScale(svg, b, verdictOf(d).accent, W);
  }

  $('breakdown-svg').replaceChildren(svg);
  $('breakdown-caption').textContent = isBook
    ? `What stands behind the ${coin} ${side}`
    : b && b.elsewhere
      ? `What stands against the ${coin} ${side} - and what only looks like it does`
      : `What stands against the ${coin} ${side}`;
}
```

- [x] **Step 3: add the new CSS, remove the ones only the old bar used**

In `web/index.html`, the existing `.breakdown` rule block (`.breakdown { margin: ... } .breakdown figcaption {...} .breakdown svg {...} .breakdown .seg-label {...} .breakdown .seg-value {...} .breakdown .bar-title {...}`) already covers everything the new drawing functions use (`.seg-label`, `.seg-value`, `.bar-title` classes are reused as-is). No CSS removal is required; add nothing new either - the scale draws entirely with inline SVG attributes plus those three existing classes.

- [x] **Step 4: verify in the browser, across all four verdict shapes**

Open each of the four top chips in turn and confirm:
- `$41.8M HYPE short · 97% covered` - a scale, nearly level, caption "97% covered by HYPE this address holds - level, in band."
- `$209.1M ETH short · the ETH sits with its funders` - a scale tilted hard toward the position (ratio near 0), plus the dashed "held elsewhere" block below it, captioned "not on the scale, since funding is not ownership."
- `$130.0M HYPE long · looks like a bet` - the new empty-pan drawing, with the "Spot cannot offset a long" caption (this chip had **no diagram at all** before this task - confirm one now appears).
- `$46.9M ETH short · market maker` - the new quoting bar, showing "$42.9M matched both sides in ETH itself - 91% of the $46.9M short" (this is the exact decisive number from audit L01, previously absent from every render of this card).

Also resize the browser to 375px width and reload each of the four again; confirm the SVG's own `viewBox` still matches its container (the width-aware sizing this file already relies on - `box.clientWidth || 640`, read after `box.hidden = false` - is unchanged by this task).

- [x] **Step 5: commit**

```bash
git add web/app.js web/index.html
git commit -m "feat: a balance scale for coverage, a quoting bar for a book, and a real diagram for a long"
```

**Deferred, not part of this task:** the canvas share-card (`drawCard`/`drawBreakdown` inside the `// ---- share card ----` section of `web/app.js`) and the satori OG picture (`src/engine/ogCard.ts`, `src/engine/ogRender.ts`) still draw the old segmented bar. They read the same, unchanged `breakdown`/`orders` data, so they keep working correctly - a downloaded PNG or a pasted link's preview will look like the old bar until a follow-up task ports this same scale/quoting-bar/empty-pan logic into `drawCard()` (canvas) and `ogTree()` (satori, which needs a matching `OgCardData` shape change and an `OG_LAYOUT_VERSION` bump to 4, plus a local `node --import tsx scripts/prerender-og.ts` re-render - **not** `--upload`, which writes to the live KV namespace and needs a separate, explicit go-ahead). Say this plainly in your final report; do not attempt it inside this task.

---

### Task 6: A short qualifier on the Unknown badge, computed once, server-side

**Files:**
- Modify: `src/engine/reasons.ts`, `src/api/check.ts`, `web/app.js`
- Test: `test/engine/reasons.test.ts` (create if it does not already exist - check first), or add to an existing reasons-adjacent test file if one exists

**Design.** Today, an `Unknown` badge is just the word "Unknown" (plus a strength suffix that never applies to Unknown) - the reader has to open "How this was decided" to learn *why*. This adds one short phrase, computed from the same `reasons[0]` the existing `ruleExplanation()`/`openQuestion()` functions already switch on, so there is exactly one place per reason that owns its wording (the badge qualifier is new; it does not replace `rule` or `openQuestion`, which stay full sentences one click down).

- [x] **Step 1: check for an existing reasons test file**

Run: `ls test/engine/ | grep -i reason`

If `test/engine/reasons.test.ts` exists, read it fully and add to it. If it does not exist, create it fresh with the content in Step 3 below.

- [x] **Step 2: add `badgeQualifier` to `src/engine/reasons.ts`**

Read the file's existing `WHY` map and `ruleExplanation()` function first. Add, directly after the `WHY` constant's closing `};`:

```typescript
/** A short phrase for the Unknown badge itself - "Unknown · assets sit with
 * funders" - so the badge says more than "Unknown" before anything is
 * opened. Only ever shown when `verdict.verdict === 'unknown'`; deliberately
 * silent on 'no open positions found' (nothing to qualify) and on the two
 * reasons that only ever grade a Book. Typed against the same `ReasonCode`
 * union `WHY` already is, so a new reason cannot ship without a phrase here
 * either (24.09 audit U02 + Л10: one dictionary, not one on the server and a
 * second, drifting one on the page). */
const BADGE_QUALIFIER: Record<Exclude<ReasonCode, 'positions' | 'trades' | 'no open positions found'>, string> = {
  orders: 'market-making activity',
  balanced_book: 'offsetting positions',
  hedge_leg: 'hedge found',
  over_covered: 'more than covered',
  hedge_not_checked: 'hedge not checked',
  unrecognised_assets: 'assets unverified',
  maker_flow_only: 'busy, not proven inventory',
  partial_offset: 'partly covered',
  quotes_not_checked: 'orders not fully read',
  positions_not_complete: 'positions not fully read',
  directional_concentration: 'looks directional',
  directional_portfolio: 'looks directional',
  offset_not_measured: 'offset not measured',
  mixed_long_short_book: 'mixed assets',
  diversified_book_no_quotes: 'book-shaped, no quotes',
  linked_exposure_unverified: 'assets sit with funders',
  'signals disagree: not enough evidence for book, hedge, or bet': 'signals disagree',
};

/** The short badge qualifier for one verdict, or null when there is none -
 * no reasons at all, the sole "no open positions" reason, or a historical
 * reading (whose rules may not have a phrase here). */
export function badgeQualifier(verdict: VerdictResult, historical = false): string | null {
  if (historical) return null;
  const first = verdict.reasons?.[0];
  return first !== undefined && first in BADGE_QUALIFIER ? BADGE_QUALIFIER[first as keyof typeof BADGE_QUALIFIER] : null;
}
```

- [x] **Step 3: test it**

If creating `test/engine/reasons.test.ts` fresh, write:

```typescript
import { describe, expect, it } from 'vitest';
import { ruleExplanation, badgeQualifier } from '../../src/engine/reasons';
import type { VerdictResult } from '../../src/engine/verdict';

const v = (reasons: string[]): VerdictResult => ({ verdict: 'unknown', strength: null, reasons });

describe('badgeQualifier', () => {
  it('gives a short phrase for a funding-link Unknown', () => {
    expect(badgeQualifier(v(['linked_exposure_unverified']))).toBe('assets sit with funders');
  });

  it('gives a short phrase for a hedge that was never checked', () => {
    expect(badgeQualifier(v(['hedge_not_checked']))).toBe('hedge not checked');
  });

  it('gives no qualifier when there is nothing open', () => {
    expect(badgeQualifier(v(['no open positions found']))).toBeNull();
  });

  it('gives no qualifier for a historical reading', () => {
    expect(badgeQualifier(v(['linked_exposure_unverified']), true)).toBeNull();
  });

  it('has a phrase for every reason ruleExplanation knows about', () => {
    const reasons = [
      'orders', 'balanced_book', 'hedge_leg', 'over_covered', 'hedge_not_checked', 'unrecognised_assets',
      'maker_flow_only', 'partial_offset', 'quotes_not_checked', 'positions_not_complete',
      'directional_concentration', 'directional_portfolio', 'offset_not_measured', 'mixed_long_short_book',
      'diversified_book_no_quotes', 'linked_exposure_unverified',
      'signals disagree: not enough evidence for book, hedge, or bet',
    ];
    for (const r of reasons) {
      expect(badgeQualifier(v([r])), r).toEqual(expect.any(String));
      expect(ruleExplanation(v([r])), r).toEqual(expect.any(String));
    }
  });
});
```

Run: `npx vitest run test/engine/reasons.test.ts`
Expected: PASS. If the TypeScript compiler complains that `BADGE_QUALIFIER` is missing a key, it means `ReasonCode` (in `src/engine/verdict.ts`) has a code `WHY` and this map do not both cover - add the missing phrase, do not widen the type to make the error go away.

- [x] **Step 4: expose it on `CheckResponse`**

In `src/api/check.ts`, find `nansen?: NansenContribution | null;` inside the `CheckResponse` type and add directly after it:

```typescript
  /** A short phrase for the Unknown badge - "assets sit with funders" - so
   * the badge itself says more than the bare word before anything is
   * opened. Null when the verdict is not Unknown, or there is nothing to
   * qualify. Added wherever a reading is served. */
  badgeQualifier?: string | null;
```

In `src/index.ts`, find the `explained()` function:

```typescript
function explained<T extends CheckResponse>(r: T): T {
  return {
    ...r,
    rule: ruleExplanation(r.verdict, r.historical !== undefined),
    openQuestion: openQuestion(r),
    nansen: nansenContribution(r),
  };
}
```

Change to:

```typescript
function explained<T extends CheckResponse>(r: T): T {
  return {
    ...r,
    rule: ruleExplanation(r.verdict, r.historical !== undefined),
    openQuestion: openQuestion(r),
    nansen: nansenContribution(r),
    badgeQualifier: badgeQualifier(r.verdict, r.historical !== undefined),
  };
}
```

Add `badgeQualifier` to the existing import from `./engine/reasons`:

```typescript
import { ruleExplanation, badgeQualifier } from './engine/reasons';
```

- [x] **Step 5: run the whole suite**

Run: `npm test && npm run typecheck`
Expected: all green.

- [x] **Step 6: commit**

```bash
git add src/engine/reasons.ts src/api/check.ts src/index.ts test/engine/reasons.test.ts
git commit -m "feat: a short reason travels with an Unknown badge, from one dictionary"
```

- [x] **Step 7: show it on the page**

In `web/app.js`, find `function badgeText(d) {`:

```javascript
function badgeText(d) {
  return verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
}
```

Change to:

```javascript
function badgeText(d) {
  const base = verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
  return d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base;
}
```

- [x] **Step 8: verify in the browser**

Open the funded-short chip (`$209.1M ETH short`) and confirm the badge now reads "Unknown · assets sit with funders" rather than a bare "Unknown". Open a gallery row with a different Unknown reason (e.g. one under "hedge not checked" in the archive) and confirm its badge, both on the card and in the gallery-row list (`galleryRow()` reuses `badgeText()`), carries its own qualifier.

- [x] **Step 9: commit**

```bash
git add web/app.js
git commit -m "feat: the Unknown badge says which Unknown, everywhere it appears"
```

---

### Task 7: A free comparison against Hyperliquid's own main-dex position count

**Files:**
- Modify: `src/engine/observation.ts`, `src/api/observe.ts`, `src/engine/interpret.ts`, `src/engine/nansenContribution.ts`
- Test: `test/engine/nansenContribution.test.ts`, `test/api/observation.test.ts` (if it asserts the full `Observation` shape - check first), `test/coordinator.test.ts` is unaffected (do not touch it)

**Design, and why this is low-risk.** `getClearinghouseState` (Hyperliquid's free, keyless main-dex endpoint) is already called today, but **only** as the fallback when Nansen positions fail. This task adds one more call to it, in parallel with the other free reads already fired via `Promise.all` at the top of `observe()`, **tolerant of failure** (exactly like the existing `perpMetaRes` pattern two lines below it) - so it can never fail a check, never costs a Nansen credit, and never touches the existing fallback branch (which keeps its own separate call, untouched, because that one branch's correctness has been hardened across four audits and is not worth the risk of sharing a code path with a "this is merely informational" read). The new field is presentational only - `computeVerdict` never reads it - so `OBSERVATION_SCHEMA_VERSION` does not change, and no stored reading needs re-judging.

- [x] **Step 1: add the field to `Observation`**

In `src/engine/observation.ts`, find `export interface Observation {` and, directly after the `source: 'nansen' | 'hyperliquid';` line, add:

```typescript
  /** How many open positions Hyperliquid's own free main-dex endpoint shows
   * for this account, read only when `source` is `'nansen'` (when it is not,
   * this number would just restate `positions.nPositions`). Null when that
   * source failed or was not asked, or when Nansen itself was the fallback.
   * Presentational only - no rule reads it - so it needs no schema-version
   * bump. Lets the Nansen-contribution line show the exact HIP-3 gap the
   * README already claims ("134 against 86 on Hyperliquid's own main-dex
   * endpoint") on every reading, not only in prose (24.09 audit, L05). */
  mainDexPositionCount: number | null;
```

- [x] **Step 2: populate it in `observe()`**

Read `src/api/observe.ts`'s `observe()` function in full first, in particular the `Promise.all([...])` near the top (five entries: `rawOrders`, `spotBalances`, `spotMetaPair`, `rawFills`, `perpMetaRes`) and the destructuring line right after it.

Find:

```typescript
  const [rawOrders, spotBalances, spotMetaPair, rawFills, perpMetaRes] = await Promise.all([
    getOpenOrders(address, undefined, signal),
    getSpotBalances(address, signal),
    getSpotMeta(signal),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now, signal),
    getPerpMetaAndAssetCtxs(signal).then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
  ]);
```

Change to:

```typescript
  const [rawOrders, spotBalances, spotMetaPair, rawFills, perpMetaRes, mainDexRes] = await Promise.all([
    getOpenOrders(address, undefined, signal),
    getSpotBalances(address, signal),
    getSpotMeta(signal),
    getUserFillsByTime(address, now - TRADES_WINDOW_HOURS * 3_600_000, now, signal),
    getPerpMetaAndAssetCtxs(signal).then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
    // Free, always fired, tolerant of failure - used only for the
    // Nansen-contribution comparison line below, never as a source of
    // positions or a fallback (that branch, further down, keeps its own
    // separate call) (24.09 audit, L05).
    getClearinghouseState(address, signal).then(
      (v) => ({ ok: true as const, v }),
      () => ({ ok: false as const, v: null }),
    ),
  ]);
```

Find the block that sets `source = 'nansen'` on success (inside `if (pos.status === 'fulfilled') { try { positions = normalizeNansenPositions(pos.value); source = 'nansen'; ... } catch ... }`). Directly after that whole `if (nansen && outOfTime()) {...} else if (nansen) { ... } else if (nansen === null) { ... }` block (i.e., right before the comment `// Nansen reports every HIP-3 dex; ...` that precedes the existing fallback `if (positions === null) { ... }`), add:

```typescript
  let mainDexPositionCount: number | null = null;
  if (source === 'nansen' && mainDexRes.ok) {
    try {
      mainDexPositionCount = normalizePositions(mainDexRes.v).length;
    } catch (err) {
      console.error('main-dex comparison', err);
      // Purely informational; a malformed answer here must not affect the
      // check or its verdict in any way.
    }
  }
```

- [x] **Step 3: return it from `observe()`**

Find the `return { address, positions: positionFeatures, ... checkedAt: new Date(now).toISOString(), };` at the end of `observe()`. Add `mainDexPositionCount,` as a new line (any position in the object is fine - the plan places it right after `source,` for readability, matching the interface's field order):

```typescript
  return {
    address,
    positions: positionFeatures,
    orders: orderFeatures,
    hedge: hedgeFeatures,
    hedgeScope,
    hedgeCoverage,
    ordersCoverage,
    positionsCoverage,
    linkedHedge,
    trades: tradeFeatures,
    pnl,
    sizeVsOi,
    source,
    mainDexPositionCount,
    focus,
    positionsAsOf: measuredAt === null ? null : new Date(measuredAt).toISOString(),
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    assetRegistryVersion: ASSET_REGISTRY_VERSION,
    observedAt: measuredAt === null ? new Date(now).toISOString() : new Date(measuredAt).toISOString(),
    degraded,
    vitals,
    coverage,
    coverageNotes,
    checkedAt: new Date(now).toISOString(),
  };
```

- [x] **Step 4: thread it through `present()`**

In `src/engine/interpret.ts`, find the `judged` object inside `present()`:

```typescript
  const judged = {
    verdict: r.verdict,
    positions: r.positions,
    orders: r.orders,
    hedge: r.hedge,
    hedgeScope: r.hedgeScope,
    hedgeCoverage: r.hedgeCoverage,
    ordersCoverage: r.ordersCoverage,
    positionsCoverage: r.positionsCoverage,
    linkedHedge: r.linkedHedge,
    trades: r.trades,
    pnl: r.pnl,
    sizeVsOi: r.sizeVsOi,
    source: r.source,
    focus: r.focus,
    positionsAsOf: r.positionsAsOf,
    classifierVersion: r.classifierVersion,
    observationSchemaVersion: r.observationSchemaVersion,
    assetRegistryVersion: r.assetRegistryVersion,
    observedAt: r.observedAt,
    interpretedAt: r.interpretedAt,
    degraded: r.degraded,
  };
```

Add `mainDexPositionCount: r.mainDexPositionCount,` directly after `source: r.source,`.

- [x] **Step 5: use it in `nansenContribution()`**

In `src/engine/nansenContribution.ts`, find the "Positions" block:

```typescript
  // Positions: the one read every rule depends on.
  const hip3 = (r.positions.candidates ?? []).map((c) => c.coin).filter((c) => c.includes(':'));
  items.push(
    `Positions on every Hyperliquid dex, HIP-3 included: ${plural(n, 'open position')}` +
      (hip3.length ? `, among the largest ${hip3.slice(0, 2).join(' and ')}` : '') +
      ". Hyperliquid's own free endpoint reads the main dex only." +
      (isBet ? ' The bet rule needs every position read, so it could only be applied with these.' : ''),
  );
```

Change the appended sentence to use the real number when it is known, and fall back to the existing generic sentence when it is not (an older stored reading, or one where the free comparison call itself failed):

```typescript
  // Positions: the one read every rule depends on.
  const hip3 = (r.positions.candidates ?? []).map((c) => c.coin).filter((c) => c.includes(':'));
  const mainDex = r.mainDexPositionCount ?? null;
  const dexComparison =
    mainDex !== null && mainDex !== n
      ? `Hyperliquid's own free endpoint shows ${plural(mainDex, 'position')} on the main dex alone.`
      : "Hyperliquid's own free endpoint reads the main dex only.";
  items.push(
    `Positions on every Hyperliquid dex, HIP-3 included: ${plural(n, 'open position')}` +
      (hip3.length ? `, among the largest ${hip3.slice(0, 2).join(' and ')}` : '') +
      `. ${dexComparison}` +
      (isBet ? ' The bet rule needs every position read, so it could only be applied with these.' : ''),
  );
```

- [x] **Step 6: test it**

Add to `test/engine/nansenContribution.test.ts`, inside the existing `describe('what Nansen added to a reading', ...)` block:

```typescript
  it('names the exact position-count gap against Hyperliquid\'s own main dex when it is known', () => {
    const withGap = { ...book, mainDexPositionCount: 86 } as CheckResponse;
    const c = nansenContribution(withGap)!;
    const positionsLine = c.items.find((i) => i.startsWith('Positions on every'))!;
    expect(positionsLine).toContain('86 positions on the main dex alone');
  });

  it('falls back to the general sentence when the comparison was never read', () => {
    const noGap = { ...book, mainDexPositionCount: undefined } as CheckResponse;
    const c = nansenContribution(noGap)!;
    const positionsLine = c.items.find((i) => i.startsWith('Positions on every'))!;
    expect(positionsLine).toContain("Hyperliquid's own free endpoint reads the main dex only.");
  });
```

Run: `npx vitest run test/engine/nansenContribution.test.ts`
Expected: PASS.

- [x] **Step 7: run the full suite, including the runtime tests**

Run: `npm test && npm run typecheck`
Expected: all green. If `test/api/observation.test.ts` or `test/api/check-golden.test.ts` fail because they construct an `Observation`/`CheckResult` object literal missing the new required field, add `mainDexPositionCount: null` to each fixture object the compiler flags - do not make the field optional to avoid this; every real observation must state it, even as `null`.

Run: `npm run test:runtime`
Expected: 9/9 passing - this task adds one more free network call inside `observe()`, so re-confirm the workerd concurrency/restart tests (which drive real checks through the built Worker) still pass with the extra call in flight.

- [x] **Step 8: commit**

```bash
git add src/engine/observation.ts src/api/observe.ts src/engine/interpret.ts src/engine/nansenContribution.ts test/engine/nansenContribution.test.ts
git commit -m "feat: every Nansen-sourced reading names Hyperliquid's own main-dex count beside it"
```

---

### Task 8: Documentation and repository cleanup

**Files:**
- Modify: `README.md`
- Move: `docs/audits/2026-09-19-pivot-ideas-ru.md`, `docs/audits/2026-09-19-useful-ideas-ru.md`, `docs/audits/2026-09-20-competition-decision-ru.md`, `docs/audits/2026-09-20-retail-actions-ru.md` -> `docs/internal/`
- Remove or document: `data/rescan-offset.json`, `data/rescan-offset2.json`, `data/rescan-offset3.json`

Run this task **last**, after Tasks 1-7 have landed, since it refreshes numbers that those tasks change (the gallery row count, most directly, from Task 1's dedupe).

- [x] **Step 1: D02 - move the four internal strategy documents**

These are already confirmed (grep run 25.09) to have no inbound links from `README.md` or any other doc except the audits that flag them as a finding. Also confirmed (22.09 audit) that all four contain the long dash (U+2014) the user's global `CLAUDE.md` forbids everywhere the project writes.

```bash
mkdir -p docs/internal
git mv docs/audits/2026-09-19-pivot-ideas-ru.md docs/internal/
git mv docs/audits/2026-09-19-useful-ideas-ru.md docs/internal/
git mv docs/audits/2026-09-20-competition-decision-ru.md docs/internal/
git mv docs/audits/2026-09-20-retail-actions-ru.md docs/internal/
```

Then replace the long dash in each moved file. Run this once per file (it is idempotent - a file with none is left unchanged):

```bash
node -e "
const fs = require('fs');
for (const f of [
  'docs/internal/2026-09-19-pivot-ideas-ru.md',
  'docs/internal/2026-09-19-useful-ideas-ru.md',
  'docs/internal/2026-09-20-competition-decision-ru.md',
  'docs/internal/2026-09-20-retail-actions-ru.md',
]) {
  const before = fs.readFileSync(f, 'utf8');
  const after = before.replace(/\u2014/g, '-').replace(/ \u2013 /g, ' - ');
  fs.writeFileSync(f, after);
  console.log(f, 'em-dashes left:', (after.match(/\u2014/g) || []).length);
}
"
```

Confirm every file reports `em-dashes left: 0`. Read a paragraph of each changed file afterward to confirm the replacement reads naturally (a dash used mid-sentence should now have a plain hyphen with spaces around it, matching the rest of this project's prose).

- [x] **Step 2: commit**

```bash
git add docs/internal docs/audits
git commit -m "docs: move internal strategy notes out of the public audit trail"
```

- [x] **Step 3: D03 - the rescan-offset files**

Confirmed (grep run 25.09): no script under `scripts/` references `rescan-offset`. Confirm this yourself once more before removing anything:

```bash
grep -rn "rescan-offset" scripts/ src/ README.md docs/ 2>/dev/null
```

If that grep finds nothing (expected), remove the three orphaned files:

```bash
git rm data/rescan-offset.json data/rescan-offset2.json data/rescan-offset3.json
```

If the grep *does* find a reference, stop and instead add one row to the README's Scripts table describing what reads them - do not remove a file something depends on.

- [x] **Step 4: commit**

```bash
git commit -m "chore: remove orphaned rescan-offset files nothing reads"
```

- [x] **Step 5: D01 - refresh the stale counts in README.md**

Run this script to compute the current, real numbers (after Tasks 1-7 have landed, and after Step 3 above has possibly changed `data/`):

```bash
node -e "
const fs = require('fs');
const gallery = JSON.parse(fs.readFileSync('data/gallery.json', 'utf8'));
const featured = JSON.parse(fs.readFileSync('data/featured.json', 'utf8'));
const featuredAddresses = new Set(featured.entries.filter(e => !e.superseded).map(e => e.address.toLowerCase()));
const open = gallery.entries
  .filter(e => e.positions.nPositions > 0)
  .filter(e => e.historical || !featuredAddresses.has(e.address.toLowerCase()));
const current = open.filter(e => !e.historical);
const counts = current.reduce((m, e) => { m[e.verdict.verdict] = (m[e.verdict.verdict] || 0) + 1; return m; }, {});
console.log('current (judged by v5):', current.length, counts);
console.log('historical:', open.length - current.length);
console.log('total open (all scanned, minus closed positions):', open.length);
"
```

Run: `npm test`, note the exact test-file and test count from the summary line (e.g. `Test Files  43 passed (43)` / `Tests  560 passed (560)`).

Read `data/ledger.json`'s `calls` field for the current scripted total, and fetch the live `/api/ledger` endpoint (or read the deployed site's footer) for the running total including the Worker's own calls, if you have network access to it; if not, use `data/ledger.json`'s number alone and say so.

In `README.md`, update:
- The table under "The four readings at the top, and the scan below them" (currently "Of the 177 cards the current rules can read") - use the `current.length` and `counts` values just computed.
- The sentence "the same check ran once over 277 large Hyperliquid positions" - `277` is the historical, fixed size of the original 18 September scan and does **not** change (it is not affected by this task's dedupe, which only hides current-list duplicates of featured accounts, not the scan's total size) - leave this number as-is.
- "**548 tests** on recorded real responses..." under Stack - replace `548` with the real number from your `npm test` run.
- "**1,136 calls between 14 and 27 September, 1,128 answered 2xx**" under Nansen API usage - replace with the current `data/ledger.json` numbers (or the live `/api/ledger` numbers, if you fetched them, matching the phrasing style already there: "X calls, Y answered 2xx").

Do not invent numbers you have not actually computed or read this way.

- [x] **Step 6: commit**

```bash
git add README.md
git commit -m "docs: README's counts match what the repository and the ledger say today"
```

- [x] **Step 7: final check for this task**

Run: `npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir /tmp/worker-build-check`
Expected: all green, dry-run build succeeds (this does **not** deploy anything - `--dry-run` is required).

Search the whole tree once more for the long dash, the same check CI already runs is not this specific check, so do it by hand:

```bash
git grep -n $'\xe2\x80\x94' -- . ':!*.snap' ':!package-lock.json' || echo "clean: no em dash found"
```

Expected: `clean: no em dash found`. If not, every remaining hit is outside this task's four moved files - read each one, decide whether it is this task's job to fix (documentation prose) or out of scope (e.g. inside a test fixture's recorded string, which must not be edited), and note any out-of-scope hits in your final report rather than silently editing recorded test data.

---

## Deferred, out of scope for this plan

State these plainly in the final report; do not start them:

1. **Canvas share-card and OG-picture parity with the Task 5 scale.** Needs `drawCard()` in `web/app.js` and `ogTree()`/`ogCardData()` in `src/engine/ogCard.ts`/`ogRender.ts` to draw the same three states, a new `OG_LAYOUT_VERSION` (4), and a local (never `--upload` without a separate go-ahead) re-render.
2. **A daily scripted re-scan feeding the ratings board.** The board works today from the ~190 readings already on file; a `prescan.ts`-driven daily top-up of the highest-ranking candidates is a real but separate, credit-spending addition.
3. **Rules threshold change for `coinsBothSides` materiality on the bet path (audit Л07).** A `v6` rules change three days before the deadline, needing a full gallery re-judge - explicitly out of scope per the audit's own recommendation.
4. **Dead-code removal (`looksLikeButUnverified`, the budget `sync` action).** Left as judged-intentional, low-priority plumbing; not touched.
5. **Deploying** (`wrangler deploy`) **and uploading OG pictures to the live KV namespace** (`prerender-og.ts --upload`). Both commit-worthy config/code lands in this plan; neither runs the production-affecting command. Say so explicitly when the plan finishes.

## Execution record (25 September)

All eight tasks landed on branch `2026-09-25-audit-fixes`, each by an implementer subagent followed by review. Where the work departed from the steps above, it was because a review or the implementer's own check found the steps wrong:

- **Task 1.** Removing the duplicate tile from `explain()` did not reach the readings the site serves, which are stored in `data/gallery.json` and `data/featured.json`. Both were re-explained with `scripts/reexplain.ts` (no verdict or id changed), and two tests now hold stored evidence to a fresh `explain()`.
- **Task 2.** The guess sentence needed an id, not only a class, for its own removal on the next render.
- **Task 3.** `orders.headlineTwoSidedNotionalUsd` is absent on gallery entries scanned before it existed. It defaults to 0, which no ranking can see, since no current book verdict lacks it.
- **Task 4.** The four featured readings joined the board candidates; the Task 1 dedupe guarantees they never repeat a gallery row.
- **Task 5.** Captions wrap (`wrapSvgText`), since one-line sentences overflowed a phone screen, the failure audit item U01 had fixed once already. `isBook` trusts the verdict, so a historical book on a long draws its quoting bar rather than an empty pan.
- **Task 6.** The existing `test/engine/reasons.test.ts` was extended rather than created.
- **Task 7.** The golden snapshot gained `mainDexPositionCount` in each case: 14 where Nansen supplied positions, null otherwise.
- **Task 8.** The counting script in Step 5 neither drops superseded entries nor separates the scan from the page listing, and its numbers were wrong. The README table keeps the scan's own counts (177 judged: 132, 38, 0, 7; 100 read by earlier rules), and the README says the page lists three fewer.
