# Second 25 September Audit: Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three misleading-data bugs (A01-A03), the two visual-mismatch bugs (A04, A05) and the broken boards grid (A13) that `docs/audits/2026-09-25-full-audit-ru.md` found on the site that shipped this morning (commit `4b0b00d`), fix the diagram's dark-mode contrast (A08), bring the downloaded/shared pictures into line with the fixed diagram, shorten the first screen the audit measured as too long, drop the README's overclaiming tagline, and correct two stale numbers in the submission docs.

**Architecture:** No new files. Every fix lands inside the existing Observe -> Interpret -> Present pipeline: `src/engine/breakdown.ts` gets a new field the diagram can trust on its own; `src/gallery.ts` forwards a field the API already has; `src/index.ts` gets one extra guard in the focus-position lookup; `web/app.js` and `web/index.html` get the visual/text fixes; `scripts/reexplain.ts` re-derives the two bundled JSON files so the fix actually reaches the live site, not just the code.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, plain DOM/Canvas/SVG (no framework), satori + resvg for the server-rendered share picture.

---

## Scope: what this plan fixes and what it deliberately leaves out

The user approved fixing the audit "по порядку" (in order), which was my own five-step priority list at the end of the pasted summary. That list's steps 1-3 are code; steps 4-5 are a five-person comprehension test and recording/posting/submitting the form, which only the user can do. This plan covers everything code can do from steps 1-3, plus the two doc corrections the audit called out by name, plus a crash bug I found while implementing A03 (see Task 7).

**Deliberately not in this plan**, matching the audit's own "if time remains" / "after the hackathon" lists, so nothing here is a silent drop:

- A06 (a failed funder read can claim "holds no ETH") and A07 (the Unknown qualifier is lost in boards/recent) - the audit itself lists these under "если останется время", not the mandatory pre-submission set.
- A09 (a long's diagram shows a generic empty pan instead of concentration) - no exact design was specified for a concentration/quoting view, and inventing one two days before the deadline is a real design task, not a bug fix. Flagged at the end of this doc as a follow-up.
- A10 (board rows don't show their own date) and A11 (four featured readings lack `mainDexPositionCount`) - A11 specifically needs a fresh, paid Nansen read of four accounts before final recording, which is a credit-spending decision for the user to make, not something to do silently inside a fix branch.
- The full "PresentationModel" architecture (`Код, архитектура` section) - explicitly framed as the next technical project, not a pre-submission fix.
- The audit's aspirational seven-block card redesign (hero stat tiles, etc.) - Task 8 below does the safer, explicitly-mandatory version (reorder + collapse + two short copy edits), not a new visual hierarchy.

## Task order and why

Tasks 1-3 are independent backend fixes. Task 4 is independent CSS. Task 5 depends on Task 3 (same function, `drawScale`). Task 6 is independent but sits next to Task 5's code. Task 7 depends on Task 3 (`dataQuality` must exist first). Task 8 depends on nothing structurally but comes after the diagram work so it doesn't reorder around a moving target. Task 9 is independent. Task 10 must run after Tasks 1 and 3 (it re-derives the bundled JSON those tasks' backend changes affect). Task 11 is independent. Task 12 is last.

---

## Task 1: A01 - hedgeCoverage reaches the Least-covered-shorts ranking [DONE - commit 50553b1, spec+quality reviewed]

**Files:**
- Modify: `src/gallery.ts:23-44` (interface), `:79-107` (`galleryIndex`)
- Modify: `web/app.js:1067-1073` (the `Least covered shorts` board definition)
- Test: `test/gallery-index.test.ts`

**Context:** `GalleryRow` does not carry `hedgeCoverage`, so the "Least covered shorts" board on the live page ranks by `hedgeRatio` alone. Today four of its five real rows have `hedgeCoverage: 'partial'` (the read never finished) and show as `0% covered`, when the honest state is "not established". `CheckResponse.hedgeCoverage` (from `src/engine/observation.ts:57`, `hedgeCoverage: HedgeCoverage;`, always present, never optional) already has the right value on every stored entry - confirmed by reading `data/gallery.json` and `data/featured.json` directly: all 307 + 5 entries already have it set. So this is a pure plumbing fix: no re-scan, no `reexplain.ts` needed for this specific field (Task 10 reruns `reexplain.ts` anyway, for Task 3's field).

- [ ] **Step 1: Write the failing test**

Add to `test/gallery-index.test.ts`, inside the existing `describe('the gallery list is rows, not cards', ...)` block (after the `'carries the numbers a ratings board ranks by...'` test, i.e. after line 109):

```ts
  it('carries hedgeCoverage, so a board can tell a real 0% from a read that never finished (25.09 audit, A01)', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<{ hedgeCoverage: string }>;
    };
    const row = list.entries[0];
    expect(['complete', 'partial', 'missing', 'not-applicable']).toContain(row.hedgeCoverage);
  });
```

Run: `npm test -- gallery-index`
Expected: FAIL with `expect(received).toContain(expected)` - `row.hedgeCoverage` is `undefined`.

- [ ] **Step 2: Add `hedgeCoverage` to `GalleryRow` and forward it**

In `src/gallery.ts`, add the import and the field. The top of the file currently reads:

```ts
import type { CheckResponse } from './api/check';
```

Change to:

```ts
import type { CheckResponse } from './api/check';
import type { HedgeCoverage } from './engine/features';
```

In the `GalleryRow` interface (currently lines 23-44), add the new field right after `hedgeRatio` (after line 34's closing `hedgeRatio: number;`):

```ts
  /** How completely the hedge search behind `hedgeRatio` actually finished.
   * A ratio measured under `partial`/`missing` is a floor, not a finding -
   * without this a ranking cannot tell a real 0% from a read that gave up
   * before it started (25.09 audit, A01). */
  hedgeCoverage: HedgeCoverage;
```

In `galleryIndex()` (currently lines 74-108), add the field to the per-entry map, right after the existing `hedgeRatio: e.hedge.hedgeRatio,` line (currently line 93):

```ts
        hedgeRatio: e.hedge.hedgeRatio,
        hedgeCoverage: e.hedgeCoverage,
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- gallery-index`
Expected: PASS

- [ ] **Step 4: Make the board only rank a coverage read that actually finished**

In `web/app.js`, the `BOARDS` array (around line 1045) has this entry (currently lines 1067-1073):

```js
  {
    title: 'Least covered shorts',
    note: 'Under 10% covered by this address - the rest is still open.',
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeRatio < 0.1,
    sort: (a, b) => a.hedgeRatio - b.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
```

Change the `filter` line to also require a finished read:

```js
  {
    title: 'Least covered shorts',
    note: 'Under 10% covered by this address, on a hedge search that ran to completion - the rest is still open.',
    // A ratio measured under a partial or missing read is a floor, not a
    // finding: it belongs nowhere near "least covered", which claims the
    // number is the whole story (25.09 audit, A01).
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeCoverage === 'complete' && e.hedgeRatio < 0.1,
    sort: (a, b) => a.hedgeRatio - b.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
```

This is expected to shrink the board from 5 rows to 4 (verified directly against today's data: 9 of the 13 current short-under-10% rows are `partial`; 4 are genuinely `complete`, including the flagship $209M ETH short). `renderBoards` already skips a board with zero matches (`if (matches.length === 0) continue;`), so an empty board is handled if it ever happens; it does not happen with today's data.

- [ ] **Step 5: Commit**

```bash
git add src/gallery.ts test/gallery-index.test.ts web/app.js
git commit -m "fix: the Least-covered-shorts board only ranks a hedge read that finished"
```

---

## Task 2: A02 - a sixth open position gets checked instead of declared absent [DONE - commit b9923b8, spec+quality reviewed]

**Files:**
- Modify: `src/index.ts:449-470`
- Test: `test/routes.test.ts`

**Context:** `computePositionFeatures` (`src/engine/features.ts:44`, `MAX_CANDIDATES = 5`) only lists the five largest positions in `candidates`. The shortcut this bug lives in - `src/index.ts:449-470` - is inside the Worker's own route handler, reading its own KV cache; `checkAddress` (tested in `test/api/focus.test.ts`) has no such branch at all, so this needs a route-level test. `test/routes.test.ts` already has a `describe('asking about a particular position', ...)` block doing exactly this kind of test (lines 256-279), and its `routeUpstreams()` helper's default Hyperliquid fixture (`HL.clearinghouseState = { assetPositions: [], time: Date.now() }`) has zero positions - not useful here. `test/fixtures/hyperliquid/clearinghouse-many-positions.json` (already used by `test/sources/hyperliquid.test.ts` and `test/sources/normalize.test.ts`) is real, already-verified fixture data with 37 real positions; checked directly, its 6th-largest by `positionValue` is a WLD short ($145,879.62) - a real position that falls outside `MAX_CANDIDATES = 5`.

- [ ] **Step 1: Write the failing test**

In `test/routes.test.ts`, add the import at the top of the file, alongside the existing imports (currently lines 1-7):

```ts
import clearinghouseFixture from './fixtures/hyperliquid/clearinghouse-many-positions.json';
```

Add the test inside the existing `describe('asking about a particular position', ...)` block (currently lines 256-279), after its last test:

```ts
  it('checks a real sixth position instead of declaring it absent from a cached top-5 (25.09 audit, A02)', async () => {
    // routeUpstreams()'s own HL fixture (top of this file) has no positions
    // at all; this test needs a real account with more than five, so it
    // builds its own fetch mock around the shared many-positions fixture
    // instead (37 positions; WLD, 6th largest by value, is a real open
    // short that MAX_CANDIDATES = 5 leaves out of `candidates`).
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.nansen.ai')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const byType: Record<string, unknown> = { ...HL, clearinghouseState: clearinghouseFixture };
      return new Response(JSON.stringify(byType[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const env = testEnv();

    const first = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const firstBody = (await first.json()) as { positions: { candidates: Array<{ coin: string }> } };
    expect(firstBody.positions.candidates.map((c) => c.coin)).not.toContain('WLD');

    // Asking about WLD specifically must not answer "not open" purely
    // because it fell outside the cached top-5 - it must actually check.
    const second = await worker.fetch(
      request(`/api/check?address=${ADDRESS}&coin=WLD&side=short`, { method: 'POST' }),
      env,
    );
    const secondBody = (await second.json()) as { positions: { headlineCoin: string }; coverage: string[] };
    expect(secondBody.positions.headlineCoin).toBe('WLD');
    expect(secondBody.coverage.join(' ')).not.toContain('No WLD short is open');
  });
```

Run: `npm test -- routes`
Expected: FAIL - `secondBody.positions.headlineCoin` is `'HYPE'` (the largest position, not WLD), and `coverage` contains "No WLD short is open at this address".

- [ ] **Step 2: Fix the shortcut in `src/index.ts`**

The relevant block (currently lines 449-470):

```ts
      if (focus) {
        const largestCached = await kv.get(`check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}`);
        if (largestCached !== null) {
          const parsed = JSON.parse(largestCached) as CheckResponse;
          const known = parsed.positions.candidates.some(
            (c) => c.coin.toUpperCase() === focus.coin.toUpperCase() && c.side === focus.side,
          );
          if (!known) {
            const note = `No ${focus.coin} ${focus.side} is open at this address; this answer is about the largest position instead`;
            counted('not_open', readingFields(parsed));
            return Response.json({
              ...explained(parsed),
              coverage: parsed.coverage.includes(note) ? parsed.coverage : [note, ...parsed.coverage],
              // Shown next to the answer, not among the notes: the question
              // asked is not the one this answers (see src/api/check.ts).
              coverageNotes: parsed.coverageNotes?.some((n) => n.text === note)
                ? parsed.coverageNotes
                : [{ text: note, failure: true }, ...(parsed.coverageNotes ?? [])],
            });
          }
        }
      }
```

Change to:

```ts
      if (focus) {
        const largestCached = await kv.get(`check:${CLASSIFIER_VERSION}:${ASSET_REGISTRY_VERSION}:${address}`);
        if (largestCached !== null) {
          const parsed = JSON.parse(largestCached) as CheckResponse;
          const known = parsed.positions.candidates.some(
            (c) => c.coin.toUpperCase() === focus.coin.toUpperCase() && c.side === focus.side,
          );
          // `candidates` is the five largest positions, not necessarily all
          // of them (src/engine/features.ts, MAX_CANDIDATES = 5). Absence
          // from a truncated list proves nothing - only when nPositions is
          // itself five or fewer is `candidates` the complete roster, and
          // only then can "not in it" become "not open" without a fresh
          // check (25.09 audit, A02).
          const candidatesAreComplete = parsed.positions.nPositions <= parsed.positions.candidates.length;
          if (!known && candidatesAreComplete) {
            const note = `No ${focus.coin} ${focus.side} is open at this address; this answer is about the largest position instead`;
            counted('not_open', readingFields(parsed));
            return Response.json({
              ...explained(parsed),
              coverage: parsed.coverage.includes(note) ? parsed.coverage : [note, ...parsed.coverage],
              // Shown next to the answer, not among the notes: the question
              // asked is not the one this answers (see src/api/check.ts).
              coverageNotes: parsed.coverageNotes?.some((n) => n.text === note)
                ? parsed.coverageNotes
                : [{ text: note, failure: true }, ...(parsed.coverageNotes ?? [])],
            });
          }
        }
      }
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- routes`
Expected: PASS. Also confirm the pre-existing tests in `test/api/focus.test.ts` and the rest of `test/routes.test.ts` still pass (the existing focus tests all use accounts with at most a few positions, so `nPositions <= candidates.length` stays true there and the shortcut still fires exactly as before).

- [ ] **Step 4: Run the whole suite once before moving on**

Run: `npm test`
Expected: all green - this touches a shared route handler, so check nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/routes.test.ts
git commit -m "fix: a real sixth position is checked, not declared absent from a cached top-5"
```

---

## Task 3: A03 - the scale trusts a data-quality flag, not a leftover dollar amount [DONE - commit da8474c, spec+quality reviewed, one fix loop for a priority-order test]

**Files:**
- Modify: `src/engine/breakdown.ts`
- Modify: `web/app.js:320-353` (`drawScale`)
- Test: `test/engine/breakdown.test.ts`

**Context:** Two reproduced scenarios. (1) A short fully covered by dollar amount, but the read that found it never finished (`hedgeCoverage: 'partial'`): `residual = headlineUsd - covered - unverified` comes out to `0`, so `push('not-checked', 0)` is a no-op (the `push` helper skips zero amounts) - the incompleteness has nowhere to live. (2) A matching asset with no price (`unpricedMatches: 1`): its dollars are in neither `covered` nor `unverified` (a different `AssetMatch` state entirely, per `src/engine/features.ts`'s `classifyHolding`), so they silently become `residual`, and the diagram draws "found nothing" for a case where something real was found and just couldn't be priced. Both are diagram-only bugs - `computeVerdict` already handles both correctly (`hedge_not_checked`, `unrecognised_assets`), so the badge and summary sentence are already right.

- [ ] **Step 1: Write the failing tests**

Add to `test/engine/breakdown.test.ts`, as a new `describe` block after the existing `'a position spot cannot offset...'` block (after line 103):

```ts
describe('a data-quality flag the diagram can trust on its own (25.09 audit, A03)', () => {
  it('is measured once the read is complete and nothing is left unpriced', () => {
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 60e6, hedgeRatio: 0.6 }), null, 'complete');
    expect(b.dataQuality).toBe('measured');
  });

  it('is partial when the read did not finish, even though what was found already covers the position', () => {
    // Full dollar coverage and an unfinished read at once: residual is
    // exactly zero, so a renderer reading only the segments sees nothing
    // wrong. The flag has to say so on its own.
    const b = exposureBreakdown(positions(), hedge({ hedgeUsd: 100e6, hedgeRatio: 1 }), null, 'partial');
    expect(b.segments).toEqual([{ kind: 'covered', usd: 1e8, share: 1 }]);
    expect(b.dataQuality).toBe('partial');
  });

  it('is unpriced when a matching holding has no price, even though nothing sits in the unverified segment', () => {
    // unpricedMatches is a count with no dollar value of its own - it is not
    // part of unverifiedUsd, and covered only sums holdings that did price -
    // so today's segments alone say "100% residual, nothing found" for a
    // case where a match was in fact found.
    const b = exposureBreakdown(positions(), hedge({ unpricedMatches: 1 }), null, 'complete');
    expect(b.segments).toEqual([{ kind: 'residual', usd: 1e8, share: 1 }]);
    expect(b.dataQuality).toBe('unpriced');
  });

  it('is measured for a long, which has nothing left to measure', () => {
    const b = exposureBreakdown(positions({ headlineSide: 'long' }), hedge(), null, 'partial');
    expect(b.dataQuality).toBe('measured');
  });
});
```

Run: `npm test -- breakdown`
Expected: FAIL - `b.dataQuality` is `undefined` on every assertion (`ExposureBreakdown` does not have the field yet, so this is also a TypeScript error until Step 2 lands).

- [ ] **Step 2: Add `dataQuality` to `ExposureBreakdown` and compute it**

In `src/engine/breakdown.ts`, add the field to the `ExposureBreakdown` interface (currently lines 40-55), after `elsewhere`:

```ts
export interface ExposureBreakdown {
  applies: boolean;
  coin: string | null;
  side: 'long' | 'short' | null;
  headlineUsd: number;
  segments: Segment[];
  excessUsd: number;
  elsewhere: { usd: number; wallets: number; ownership: 'unverified' } | null;
  /** Whether the segments above are a finished picture. 'measured' once the
   * hedge search ran to completion and every matching holding had a price to
   * weigh. 'partial' when the holdings read itself did not finish - true
   * even when what was found already covers the position, since the next
   * page could still hold more of the same asset and a zero residual then
   * says nothing about the part never read. 'unpriced' when a holding
   * matched the position's asset but had no price, so its dollars sit in
   * neither `covered` nor `unverified` - a renderer that only sums the
   * segments never learns this happened. A renderer must read this field
   * directly, never infer it from whether some segment happens to be
   * nonzero (25.09 audit, A03). */
  dataQuality: 'measured' | 'partial' | 'unpriced';
}
```

Change `exposureBreakdown` (currently lines 61-109) to compute and carry it. The function currently opens:

```ts
export function exposureBreakdown(
  positions: PositionFeatures,
  hedge: HedgeFeatures,
  linked: LinkedHedgeFeatures | null,
  hedgeCoverage: HedgeCoverage = 'complete',
): ExposureBreakdown {
  const headlineUsd = positions.headlineNotionalUsd;
  const applies = positions.nPositions > 0 && positions.headlineSide === 'short' && headlineUsd > 0;
  const empty: ExposureBreakdown = {
    applies,
    coin: positions.headlineCoin,
    side: positions.headlineSide,
    headlineUsd,
    segments: [],
    excessUsd: 0,
    elsewhere: null,
  };
  if (!applies) return empty;
```

Change to:

```ts
export function exposureBreakdown(
  positions: PositionFeatures,
  hedge: HedgeFeatures,
  linked: LinkedHedgeFeatures | null,
  hedgeCoverage: HedgeCoverage = 'complete',
): ExposureBreakdown {
  const headlineUsd = positions.headlineNotionalUsd;
  const applies = positions.nPositions > 0 && positions.headlineSide === 'short' && headlineUsd > 0;
  // A long has nothing to measure, so it is trivially 'measured'. Otherwise
  // an unfinished holdings read outranks a merely-unpriced match: neither
  // can be inferred from the segments below, which is the whole point of
  // this field (25.09 audit, A03).
  const dataQuality: ExposureBreakdown['dataQuality'] = !applies
    ? 'measured'
    : hedgeCoverage === 'missing' || hedgeCoverage === 'partial'
      ? 'partial'
      : (hedge.unpricedMatches ?? 0) > 0
        ? 'unpriced'
        : 'measured';
  const empty: ExposureBreakdown = {
    applies,
    coin: positions.headlineCoin,
    side: positions.headlineSide,
    headlineUsd,
    segments: [],
    excessUsd: 0,
    elsewhere: null,
    dataQuality,
  };
  if (!applies) return empty;
```

The final `return { ...empty, segments, excessUsd, elsewhere: ... }` (currently lines 103-108) needs no change - it spreads `empty`, which now already carries `dataQuality`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm test -- breakdown`
Expected: PASS, including every pre-existing test in this file (none of them assert the full object with `toEqual`, only `.segments`/`.excessUsd`/`.elsewhere`/`.applies`, so the new field does not break them).

- [ ] **Step 4: Make `drawScale` trust the flag**

In `web/app.js`, `drawScale` currently opens (lines 320-326):

```js
function drawScale(svg, b, accent, W) {
  const g = scaleGeometry(W);
  const covered = b.segments.find((s) => s.kind === 'covered')?.usd ?? 0;
  const notChecked = b.segments.find((s) => s.kind === 'not-checked')?.usd ?? 0;
  const unverified = b.segments.find((s) => s.kind === 'unverified')?.usd ?? 0;
  const materialGap = unverified >= MATERIAL_GAP_SHARE * b.headlineUsd;
  const suspended = notChecked > 0 || (unverified > 0 && materialGap);
```

Change the `suspended` line. A stored reading from before this field existed has `b.dataQuality === undefined`, so the check has to stay additive - an old reading falls back to exactly its old behavior, a new one gets the extra protection:

```js
function drawScale(svg, b, accent, W) {
  const g = scaleGeometry(W);
  const covered = b.segments.find((s) => s.kind === 'covered')?.usd ?? 0;
  const notChecked = b.segments.find((s) => s.kind === 'not-checked')?.usd ?? 0;
  const unverified = b.segments.find((s) => s.kind === 'unverified')?.usd ?? 0;
  const materialGap = unverified >= MATERIAL_GAP_SHARE * b.headlineUsd;
  // dataQuality is the authority when it is there (25.09 audit, A03): a read
  // that never finished, or a matching holding with no price, can leave the
  // segments themselves looking complete - a zero residual and an unpriced
  // match are both invisible to the segment-only check below them. A
  // reading saved before this field existed has no opinion here (undefined
  // is neither 'measured' nor anything else), so it falls back to exactly
  // what this line already checked.
  const suspended =
    (b.dataQuality && b.dataQuality !== 'measured') || notChecked > 0 || (unverified > 0 && materialGap);
```

- [ ] **Step 5: Run the whole suite, then check in a browser**

Run: `npm test`
Expected: all green.

This is a diagram-only fix with no unit test for the SVG itself (the project has none - `web/app.js` is verified in the browser, matching how `web/index.html`'s CSS is verified). Defer the actual browser check to Task 12's verification pass, once Task 5 and Task 10 have also landed, so one preview session covers all the diagram changes together.

- [ ] **Step 6: Commit**

```bash
git add src/engine/breakdown.ts test/engine/breakdown.test.ts web/app.js
git commit -m "fix: the scale trusts a data-quality flag instead of a leftover dollar amount"
```

---

## Task 4: A13 - the boards get their own grid [DONE - commit 5e8a69e, spec+quality reviewed]

**Files:**
- Modify: `web/index.html:164`

**Context:** `.list button` is a shared rule (`grid-template-columns: 34px 1fr auto`) built for the old flat gallery list, which puts a rank number in a 34px first column (`galleryRow`'s `.rank` span). `boardRow` (`web/app.js:1084-1100`) never adds a rank number - its `positionText` goes straight into that same 34px column, squeezing a real position name (e.g. "$30.8M HYPE short") into 34px so it wraps three or four lines, while the badge takes the `auto` column and stretches wide. Confirmed at 954px viewport width, not just mobile.

- [ ] **Step 1: Add a dedicated grid rule for boards**

In `web/index.html`, the existing rule (line 164):

```css
  .list button { width: 100%; display: grid; grid-template-columns: 34px 1fr auto; gap: 4px 12px; align-items: center; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 10px 4px; }
```

stays exactly as-is (the flat gallery/archive lists still use `.rank` and still need it). Add a new rule right after it, scoped to `.board .list` only:

```css
  .list button { width: 100%; display: grid; grid-template-columns: 34px 1fr auto; gap: 4px 12px; align-items: center; text-align: left; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 10px 4px; }
  /* boardRow (web/app.js) never draws a rank number - it has none to draw,
     since a board is already ranked by its own stat, not by position in a
     flat list. Reusing the 34px rank column above squeezed a real position
     name ("$30.8M HYPE short") into 34px, wrapping three or four lines while
     the badge took the stretchy auto column (25.09 audit, A13). Two columns:
     the position name gets the room, the badge and the stat/address line
     wrap under it on a narrow screen instead of overflowing. */
  .board .list button { grid-template-columns: minmax(0, 1fr) auto; }
  .board .list .row-meta { grid-column: 1 / -1; }
  @media (max-width: 420px) {
    .board .list button { grid-template-columns: 1fr; }
    .board .list .badge { justify-self: start; }
  }
```

`.row-meta` already exists as a class (`web/index.html:167`, currently `grid-column: 2 / 4;` under the old three-column rule) - the override above makes it span both columns of the new two-column grid instead. Verify `boardRow`'s three children (`pos`, `badge`, `row-meta`) land as: row 1 = position name (column 1) + badge (column 2), row 2 = the stat/address line spanning both - exactly the shape `galleryRow` gets today minus the rank number.

- [ ] **Step 2: Check in the browser**

Defer to Task 12's verification pass (same reasoning as Task 3 Step 5 - one preview session, once the boards are also re-ranked by Task 1 and collapsed by Task 8). When you get there: open the page, expand the boards, resize to 954px and to 390px, and confirm a long position name (e.g. any `xyz:SP500` or `xyz:XYZ100` row, which the audit specifically measured) reads on one line at 954px and wraps sanely at 390px, with the badge never stretching the full row width.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "fix: the boards get their own grid instead of a flat list's rank column"
```

---

## Task 5: A04 + A05 - the scale's caption agrees with the hedge band, the Book bar's fill matches its own caption, and both pans are labeled [DONE - commit acb3873, spec+quality reviewed, one fix loop for a drift-guard test]

**Files:**
- Modify: `web/app.js:320-369` (`drawScale`), `web/app.js:389-410` (`drawBookQuoting`)

**Context (A04):** `src/engine/verdict.ts`'s `DEFAULT_THRESHOLDS.hedged` band is `[0.85, 1.15]` (`minHedgeRatio`/`maxHedgeRatio`). `drawScale`'s caption switches to "leans long, not neutral" at `ratio >= 1.05` - a different number for the same boundary, so a coverage of 110% (inside the real band, badge says Hedged) gets a caption that contradicts the badge. **Context (A05):** `drawBookQuoting`'s bar fill width uses `matched / max(matched, headlineQuoteNotionalUsd)` (share of everything quoted in that market), while its own caption text states `matched / headlineNotionalUsd` (share of the position) - two different denominators drawn as one number. The audit's own example: $42.9M matched, $46.9M position, should read and draw as 91%.

- [ ] **Step 1: Fix the caption/threshold mismatch in `drawScale`**

The non-suspended branch currently reads (lines 339-353):

```js
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
```

Change to (note the two new named constants above the function, and that the middle branch now mentions the residual explicitly when there is one, per the audit's own suggested wording):

```js
  } else {
    const excess = b.excessUsd ?? 0;
    const ratio = b.headlineUsd > 0 ? (covered + excess) / b.headlineUsd : 0;
    const tiltDeg = Math.max(-1, Math.min(1, ratio - 1)) * MAX_TILT_DEG;
    pans = drawBeamAndPivot(svg, g, tiltDeg, accent);
    drawPan(svg, pans.leftX, pans.leftY, g, false, accent, 1);
    drawPan(svg, pans.rightX, pans.rightY, g, false, accent, 1);
    if (ratio > HEDGE_BAND_MAX) {
      caption = `${fmtPct(ratio)} covered, ${fmtUsd(excess)} more than the position: on ${b.coin} itself, this leans long, not neutral.`;
    } else if (ratio >= HEDGE_BAND_MIN) {
      caption = excess > 0
        ? `${fmtPct(ratio)} covered by ${b.coin} this address holds - ${fmtUsd(excess)} more than the position, within the hedge band.`
        : `${fmtPct(ratio)} covered by ${b.coin} this address holds - within the hedge band.`;
    } else {
      caption = `Only ${fmtPct(ratio)} covered by ${b.coin} this address holds; the rest is still open.`;
    }
  }
```

Add the two named constants right above `drawScale` (before line 320, next to the existing `MAX_TILT_DEG`/`MATERIAL_GAP_SHARE` constants at lines 271-274):

```js
// Must equal DEFAULT_THRESHOLDS.hedged.minHedgeRatio/maxHedgeRatio in
// src/engine/verdict.ts - the two files are not sharing one source of truth
// yet, which is a known gap (25.09 audit, "Код, архитектура"), but at least
// both now name the same two numbers instead of three different ones across
// two files (25.09 audit, A04).
const HEDGE_BAND_MIN = 0.85;
const HEDGE_BAND_MAX = 1.15;
```

- [ ] **Step 2: Label both pans**

Still in `drawScale`, right after the `if (suspended) {...} else {...}` block and before the existing `const capY = pans.leftY + g.panH + 26;` line, add pan labels and push the caption down to make room for them:

```js
  // Which pan is which, right on the diagram - the audit found the two
  // rectangles identical and unlabeled, leaning on the paragraph below to
  // say which side is the position and which is this address's own holdings
  // (25.09 audit, "Подписать обе чаши весов").
  svg.append(svgEl('text', { x: pans.leftX, y: pans.leftY + g.panH + 13, class: 'seg-label', 'text-anchor': 'middle' }, 'the position'));
  svg.append(svgEl('text', { x: pans.rightX, y: pans.rightY + g.panH + 13, class: 'seg-label', 'text-anchor': 'middle' }, suspended ? 'unread' : 'this address'));

  const capY = pans.leftY + g.panH + 40;
```

(The existing line was `const capY = pans.leftY + g.panH + 26;` - only the `26` changes, to `40`, to leave room for the new label line above it.)

- [ ] **Step 3: Fix the Book bar's denominator**

`drawBookQuoting` currently reads (lines 389-410):

```js
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
  const finalY = wrapSvgText(
    svg,
    `${fmtUsd(matched)} matched both sides in ${p.headlineCoin} itself - ${fmtPct(share)} of the ${fmtUsd(p.headlineNotionalUsd)} ${p.headlineSide}`,
    0, capY, W, 12, 17, 'seg-label',
  );
  svg.setAttribute('viewBox', `0 0 ${W} ${finalY + 12}`);
}
```

Change to (the fill width now uses the same `share` the caption already computes and states, capped at 100% since matched liquidity in a deep market can exceed the headline position's own size):

```js
function drawBookQuoting(svg, d, W) {
  const o = d.orders;
  const p = d.positions;
  const matched = o.headlineTwoSidedNotionalUsd || 0;
  const headlineUsd = p.headlineNotionalUsd || 0;
  const barY = 26;
  const barH = 30;
  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `Quoting in ${p.headlineCoin} itself`));
  // The fill is the same fraction the caption states below it - matched
  // against the position, not against everything quoted in that market,
  // which used to let a small position draw as a sliver next to a deep
  // two-sided book: two different numbers about the same shape (25.09
  // audit, A05). Capped at 100% width since matched liquidity can honestly
  // exceed the position's own size; the caption still states the real,
  // uncapped percentage.
  const share = headlineUsd > 0 ? matched / headlineUsd : 0;
  const matchedW = Math.max(2, Math.min(1, share) * W);
  svg.append(svgEl('rect', { x: 0, y: barY, width: W, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 0.25, stroke: 'var(--line)', 'stroke-width': 1 }));
  if (matchedW > 0) {
    svg.append(svgEl('rect', { x: 0, y: barY, width: matchedW, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 1, stroke: 'var(--line)', 'stroke-width': 1 }));
  }
  const capY = barY + barH + 22;
  const finalY = wrapSvgText(
    svg,
    `${fmtUsd(matched)} matched both sides in ${p.headlineCoin} itself - ${fmtPct(share)} of the ${fmtUsd(headlineUsd)} ${p.headlineSide}`,
    0, capY, W, 12, 17, 'seg-label',
  );
  svg.setAttribute('viewBox', `0 0 ${W} ${finalY + 12}`);
}
```

Verify `o.headlineQuoteNotionalUsd` is not referenced anywhere else in `web/app.js` before leaving it unused here (`grep -n headlineQuoteNotionalUsd web/app.js`) - it is a real field on `OrderFeatures` used elsewhere in principle, just no longer needed inside this one function.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all green (this task touches no backend code, so nothing here should move any test, but confirm nothing else in the repo snapshotted these exact caption strings).

Check in the browser as part of Task 12: the $46.9M ETH short / market-maker featured chip should read "$42.9M matched both sides in ETH itself - 91% of the $46.9M ETH short" with the bar filled to (approximately) 91% width, not further; the $41.8M HYPE / 97%-covered chip should read "97% covered by HYPE this address holds - within the hedge band."; and both pans on any scale should show small "the position" / "this address" (or "unread") labels.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "fix: the scale's caption agrees with the hedge band, the Book bar's fill matches its caption, both pans are labeled"
```

---

## Task 6: A08 - the diagram keeps its color in dark mode [DONE - commit 8c12ea2, spec+quality reviewed]

**Files:**
- Modify: `web/app.js:6-11` (`VERDICTS`), `web/app.js:412-454` (`renderBreakdown`)

**Context:** `VERDICTS[verdict].accent` is a fixed hex (`#0c447c`, `#27500a`, `#633806`, `#444441` - the *light-mode* `--xxx-fg` values from `web/index.html`). `renderBreakdown` sets it as a literal on `--accent` via `box.style.setProperty`, and `drawScale`/`drawBeamAndPivot`/`drawPan` receive it as a plain JS string used directly as SVG fill/stroke - none of that reacts to `prefers-color-scheme`. Measured in a dark-mode browser: the beam and pans render at roughly 1.89:1 contrast against the page background. **`VERDICTS[...].accent` must not change** - it is also read directly by the canvas share card (`drawCard`, `web/app.js:1418,1421`) and must stay a concrete color there, since that picture always renders on a fixed white background regardless of the viewer's theme (same as the server-rendered OG picture in `src/engine/ogCard.ts`, which is correctly untouched by this task). Only the on-page SVG - which sits on the page's own dark/light background - needs a theme-reactive color, and `web/index.html` already defines one, theme-aware, per verdict: `--book-fg`, `--hedged-fg`, `--bet-fg`, `--unknown-fg` (used today for the badge text, already correctly bright-on-dark / dark-on-light in the `@media (prefers-color-scheme: dark)` block).

- [ ] **Step 1: Add a theme-aware accent lookup, separate from `VERDICTS`**

Right after the `VERDICTS` constant (`web/app.js:6-11`), add:

```js
// The on-page SVG diagram sits on the page's own background and must follow
// dark mode; the canvas share card and the server OG picture both render on
// a fixed white background and must not - so they keep VERDICTS[...].accent
// (a concrete color) untouched, and only this map, reused from the badge's
// own already-theme-aware tokens, feeds the live diagram (25.09 audit, A08).
const SVG_ACCENT_VAR = {
  book: '--book-fg', hedged: '--hedged-fg', looks_like_a_bet: '--bet-fg', unknown: '--unknown-fg',
};
function svgAccentOf(d) {
  return 'var(' + (SVG_ACCENT_VAR[d.verdict.verdict] || SVG_ACCENT_VAR.unknown) + ')';
}
```

- [ ] **Step 2: Use it in `renderBreakdown`**

In `renderBreakdown` (currently lines 412-454), two lines read `verdictOf(d).accent`:

Line 422: `box.style.setProperty('--accent', verdictOf(d).accent);`
Line 445: `drawScale(svg, b, verdictOf(d).accent, W);`

Change both to use the new function:

```js
  box.style.setProperty('--accent', svgAccentOf(d));
```

```js
    drawScale(svg, b, svgAccentOf(d), W);
```

Leave every other line in `renderBreakdown` (including the `drawBookQuoting(svg, d, W)` call, which reads `--accent` off the box itself via CSS and needs no direct change) and every use of `verdictOf(d).accent` inside `drawCard`/canvas code completely untouched.

- [ ] **Step 3: Verify no other SVG code path still receives the old literal, and the canvas path is untouched**

Run: `grep -n "verdictOf(d).accent" web/app.js`
Expected: zero matches - both call sites inside `renderBreakdown` used that exact literal and both were just changed to `svgAccentOf(d)`.

Run: `grep -n "v.accent" web/app.js`
Expected: at least the two matches already inside `drawCard` (`ctx.fillStyle = v.accent;` for the left stripe and the badge text, roughly lines 1418 and 1421), both unchanged by this task - `drawCard` still computes `const v = verdictOf(d);` itself and reads `v.accent` directly, which is correct: that picture renders on a fixed white background and must keep the concrete color.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all green (no backend code touched).

Check in the browser as part of Task 12: switch the OS/browser to dark mode (or use `resize_window`'s `colorScheme: 'dark'`), open the flagship reading, and confirm the scale's beam and pans are clearly visible against the dark background - not the same faint brownish-gray the audit measured at ~1.89:1.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "fix: the on-page diagram follows dark mode instead of a fixed light color"
```

---

## Task 7: share/OG parity - the downloaded image no longer crashes on a not-checked segment, and both pictures mark an unsettled read [DONE - commit 28a7f7c, spec+quality reviewed. Note for Task 10: dataQuality is inert against the currently-bundled data/gallery.json+featured.json (predates Task 3's commit) - Task 10 must actually regenerate them AND spot-check real rendered output (dashed border), not just confirm the JSON field exists]

**Files:**
- Modify: `web/app.js:1302-1357` (canvas `drawBreakdown`)
- Modify: `src/engine/ogCard.ts`
- Modify: `src/engine/ogRender.ts`
- Test: `test/engine/ogCard.test.ts`, `test/engine/ogRender.test.ts`

**Context:** While implementing Task 3, a real, previously-unflagged crash bug turned up in the canvas share/download path: `drawBreakdown`'s `fills`/`labels` lookup objects (`web/app.js:1314-1323`) only have keys for `covered`/`unverified`/`residual` - not `not-checked`, even though `SegmentKind` includes it and it is real, reachable data (every one of the four `hedgeCoverage: 'partial'` gallery rows Task 1 found produces a `not-checked` segment today). Clicking "Copy image" or "Download image" on any of those cards throws `TypeError: Cannot read properties of undefined (reading 'fill')` today, in production, before this fix. `src/engine/ogCard.ts`'s `segmentColor` already handles `not-checked` correctly (line 87) - only the canvas path is broken. Separately, per the audit's own "Готово, когда" for A03 ("text, badge, SVG, downloaded PNG and OG all convey the uncertainty the same way on both scenarios"), this task also gives both pictures a visual cue for `dataQuality !== 'measured'` - a case the segments alone cannot show (see Task 3's scenario 1: full dollar coverage, unfinished read, zero residual, so there is no `not-checked` segment to color at all).

- [ ] **Step 1: Write the failing test for the crash bug**

There is no existing unit test importing `web/app.js`'s drawing functions (confirmed: `grep -rl "web/app\|drawBreakdown\|drawScale" test/` matches nothing in the drawing-function sense). This bug is verified in the browser in Step 3 below, not by a new unit test - writing one would mean either adding the project's first headless-canvas test harness (a new dependency, out of scope for a two-day-to-deadline fix) or duplicating the fix's own logic into an assertion that cannot actually catch a `TypeError` thrown mid-draw. Proceed straight to the fix and verify it by reproducing the crash in the browser before and after.

- [ ] **Step 2: Fix the crash and add the dashed-when-uncertain treatment on canvas**

In `web/app.js`, `drawBreakdown` (canvas version) currently has (lines 1314-1323):

```js
  const fills = {
    covered: { fill: v.accent, alpha: 1 },
    unverified: { fill: v.accent, alpha: 0.35 },
    residual: { fill: '#e6e6e2', alpha: 1 },
  };
  const labels = {
    covered: 'covered by this address',
    unverified: 'could not identify',
    residual: 'nothing found against it',
  };
```

Change to:

```js
  const fills = {
    covered: { fill: v.accent, alpha: 1 },
    unverified: { fill: v.accent, alpha: 0.35 },
    residual: { fill: '#e6e6e2', alpha: 1 },
    // Missing until 25.09: SegmentKind has carried 'not-checked' since the
    // 23.09 audit (L12), and it is real, reachable data - every currently
    // live "Least covered shorts" row Task 1 found produces one. Downloading
    // or copying the image for any of those cards threw here (25.09 audit,
    // found while fixing A03).
    'not-checked': { fill: '#e6e6e2', alpha: 0.5 },
  };
  const labels = {
    covered: 'covered by this address',
    unverified: 'could not identify',
    residual: 'nothing found against it',
    'not-checked': 'not read in full',
  };
```

Further down in the same function, the excess-coverage block currently reads (lines 1349-1357):

```js
  if (b.excessUsd > 0) {
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 18);
    ctx.fillText(
      'and ' + fmtUsd(b.excessUsd) + ' more held beyond the position: net long, not neutral',
      left,
      barY + barH + 26 + b.segments.length * 24,
    );
  }
```

Change to (a running `legendY` so a data-quality caveat can stack after the excess line instead of overlapping it, plus a dashed outline over the whole bar when the read is not fully measured):

```js
  let legendY = barY + barH + 26 + b.segments.length * 24;
  if (b.excessUsd > 0) {
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 18);
    ctx.fillText('and ' + fmtUsd(b.excessUsd) + ' more held beyond the position: net long, not neutral', left, legendY);
    legendY += 24;
  }
  if (b.dataQuality && b.dataQuality !== 'measured') {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#8f8f8f';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 1, barY + 1, barW - 2, barH - 2);
    ctx.restore();
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 18);
    ctx.fillText(
      b.dataQuality === 'unpriced'
        ? 'A matching holding has no price available, so it is not counted above.'
        : "This address's holdings were not read in full - the true cover could be higher.",
      left,
      legendY,
    );
  }
```

- [ ] **Step 3: Reproduce the crash, then confirm the fix, in the browser**

Before applying Step 2 (or on a throwaway stash), open the live preview, use the gallery/boards to open one of the four `hedgeCoverage: 'partial'` "Least covered shorts" rows (Task 1's own investigation found these addresses in `data/gallery.json`: `0x7fdafde5cfb5465924316eced2d3715494c517d1`, `0xdd53c5297309130ab5fe5623dc905752e3342b13`, `0x519c721de735f7c9e6146d167852e60d60496a47`, `0x418aa6bf98a2b2bc93779f810330d88cde488888` - open any one via `/api/snapshot` or search the archive), click "Copy image" or "Download image", and check the browser console for the `TypeError`. After Step 2, repeat and confirm no error and a visible dashed border with the caveat line.

- [ ] **Step 4: Write the failing test for `dataQuality` reaching the OG card**

Add to `test/engine/ogCard.test.ts`, inside the `describe('ogCardData', ...)` block, after the `'turns each segment into a share and a colour...'` test:

```ts
  it('carries dataQuality through, so a renderer can mark an unfinished read even when the segments alone cannot (25.09 audit, A03/A05 follow-up)', () => {
    const breakdown: ExposureBreakdown = {
      applies: true, coin: 'ETH', side: 'short', headlineUsd: 100,
      segments: [{ kind: 'covered', usd: 100, share: 1 }],
      excessUsd: 0, elsewhere: null, dataQuality: 'partial',
    };
    const d = ogCardData(input({ breakdown }));
    expect(d.dataQuality).toBe('partial');
  });

  it('reports measured when the breakdown does not apply, same as a plain missing breakdown', () => {
    expect(ogCardData(input({ breakdown: undefined })).dataQuality).toBe('measured');
  });
```

Run: `npm test -- ogCard`
Expected: FAIL - `d.dataQuality` is `undefined`.

- [ ] **Step 5: Add `dataQuality` to `OgCardData` and populate it**

In `src/engine/ogCard.ts`, add the field to `OgCardData` (currently lines 36-60), after `elsewhere`:

```ts
  /** Whether the segments above are a finished picture - see
   * ExposureBreakdown.dataQuality. 'measured' when there is no breakdown at
   * all, the same as a card with nothing left to show a caveat about. */
  dataQuality: 'measured' | 'partial' | 'unpriced';
```

In `ogCardData` (currently lines 128-151), add the computed field to the returned object, after `segments`:

```ts
    dataQuality: input.breakdown?.dataQuality ?? 'measured',
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- ogCard`
Expected: PASS.

- [ ] **Step 7: Write the failing test for the dashed border in the rendered tree**

Add to `test/engine/ogRender.test.ts`, as a new `describe` block after `'the funder box on the link picture'` (after line 123):

```ts
describe('an unfinished read marks the bar itself, not only the text (25.09 audit, A03/A05 follow-up)', () => {
  it('draws the bar with a dashed border when dataQuality is not measured', () => {
    const tree = JSON.stringify(
      ogTree(data({ segments: [{ share: 1, color: '#e6e6e2', opacity: 1 }], dataQuality: 'partial' })),
    );
    expect(tree).toContain('dashed');
  });

  it('draws the bar with a solid border when the read is measured', () => {
    const tree = JSON.stringify(
      ogTree(data({ segments: [{ share: 1, color: '#e6e6e2', opacity: 1 }], dataQuality: 'measured' })),
    );
    expect(tree).not.toContain('dashed');
  });
});
```

Also add `dataQuality: 'measured',` to the `data()` helper's defaults near the top of the file (currently lines 15-27), next to `elsewhere: null,`, so every other existing test in the file keeps constructing a valid `OgCardData`.

Run: `npm test -- ogRender`
Expected: FAIL on the first new test (the bar's border is unconditionally `1px solid #d9d9d6` today) - and a TypeScript error on `data({ dataQuality: 'partial' })` until the interface has the field (Step 5 already added it, so this should be a plain assertion failure, not a type error, once Step 5 landed first).

- [ ] **Step 8: Draw the dashed border in `ogTree`**

In `src/engine/ogRender.ts`, `ogTree` currently opens (lines 33-58):

```ts
export function ogTree(d: OgCardData): object {
  const bar = d.segments && {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: d.elsewhere ? '58%' : '100%',
        height: 28,
        borderRadius: 4,
        overflow: 'hidden',
        border: `1px solid #d9d9d6`,
      },
      children: d.segments.map((seg) => ({
```

Change to:

```ts
export function ogTree(d: OgCardData): object {
  // A read that never finished, or a matching holding with no price, can
  // leave every segment looking complete - Task 3's own reproduction has a
  // zero residual under a partial read. The border is the one cue this
  // picture can give that the text elsewhere on it does not already carry
  // (25.09 audit, A03 "Готово, когда").
  const uncertain = d.dataQuality !== 'measured';
  const bar = d.segments && {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: d.elsewhere ? '58%' : '100%',
        height: 28,
        borderRadius: 4,
        overflow: 'hidden',
        border: uncertain ? `2px dashed ${FAINT}` : '1px solid #d9d9d6',
      },
      children: d.segments.map((seg) => ({
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- ogRender ogCard`
Expected: PASS.

- [ ] **Step 10: Run the whole suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add web/app.js src/engine/ogCard.ts src/engine/ogRender.ts test/engine/ogCard.test.ts test/engine/ogRender.test.ts
git commit -m "fix: the downloaded image no longer crashes on a not-checked segment; both pictures mark an unfinished read"
```

---

## Task 8: first screen - what's open and what Nansen added move up, the boards fold, "book" gets a one-line gloss [DONE - commit b3e4ee2, spec+quality reviewed]

**Files:**
- Modify: `web/index.html`

**Context:** The audit measured (390x844 viewport, existing "recent" block present): card start ~488px, diagram ~934px, the Nansen explanation ~1243px, Share ~1451px. The mandatory ask is narrower than the audit's full aspirational redesign: shorten, raise the two named elements (the Nansen line, Share), label the diagram (done in Task 5), and collapse the extra boards. This task is a DOM reorder inside the already-hidden-by-default `#card` (safe: `renderResult()` in `web/app.js` populates every element by `id`, never by position, confirmed by reading the whole function) plus two short copy additions. It does **not** attempt the audit's separate, larger seven-block hero-card redesign (two giant pulled-out stat tiles, etc.) - see this plan's Scope section.

- [ ] **Step 1: Move "what's still open" and "what Nansen added" up, right after the diagram**

In `web/index.html`, the `#card` div currently orders its children (lines 218-287) as: `snapshot`, `subject`, `picker`, `badge`, `headline`, `summary`, `breakdown` (the diagram), `decisive`, `coverage`, `limit`, `open-question`, `nansen`, `changed`, `share`, `card-canvas`, `meta`, `decided`, `details`.

Cut the `open-question` paragraph and the `nansen` `<details>` block (currently lines 244-249):

```html
  <p class="open-question" id="open-question" hidden></p>
  <details class="fold nansen" id="nansen" hidden>
    <summary><strong>From Nansen:</strong> <span id="nansen-lead"></span></summary>
    <ul id="nansen-list"></ul>
    <p class="tech" id="nansen-calls"></p>
  </details>
```

and the `share` `<details>` block (currently lines 254-262):

```html
  <details class="share" id="share">
    <summary>Share this reading</summary>
    <div class="actions">
      <button id="copy-link">Copy link</button>
      <button id="copy-post">Copy post text</button>
      <button id="copy-card">Copy image</button>
      <button id="download-card">Download image</button>
    </div>
  </details>
```

Paste all three, in that same relative order, immediately after the `breakdown` `<figure>` closes (right after line 234's `</figure>`) and before `decisive` (line 235's `<div class="stats" id="decisive" hidden></div>`). The card's child order becomes: `snapshot`, `subject`, `picker`, `badge`, `headline`, `summary`, `breakdown`, `open-question`, `nansen`, `share`, `decisive`, `coverage`, `limit`, `changed`, `card-canvas`, `meta`, `decided`, `details`. `changed` (the "what changed" box) stays where it was relative to what is now around it - it just ends up later in absolute terms, which the mandatory ask does not name as something to raise.

- [ ] **Step 2: Fold the boards behind a summary, keep the section heading visible**

The `#gallery` section currently reads (lines 289-310):

```html
<section id="gallery" hidden>
  <h2>Ranked from the same readings</h2>
  <p class="sub" id="gallery-sub"></p>
  <div id="boards"></div>
  <details id="all-readings">
```

Change to:

```html
<section id="gallery" hidden>
  <h2>Ranked from the same readings</h2>
  <details class="fold" id="boards-fold">
    <summary>Show the ranked boards</summary>
    <p class="sub" id="gallery-sub"></p>
    <div id="boards"></div>
  </details>
  <details id="all-readings">
```

`class="fold"` reuses the existing rule (`web/index.html`, `.fold { margin: 10px 0 0; font-size: 13px; } .fold > summary { cursor: pointer; color: var(--link); }`) - no new CSS needed. `loadGallery`/`renderBoards` in `web/app.js` write into `#gallery-sub` and `#boards` exactly as before; neither reads or depends on whether their parent `<details>` is open, so no JS change is needed here.

- [ ] **Step 3: Give "book" a one-line gloss**

The subtitle currently reads (line 180):

```html
<p class="sub">Before you copy the headline, check the position. Is it a bet, a hedge, or a market maker's book - read from Nansen and Hyperliquid data, one address at a time.</p>
```

Change to:

```html
<p class="sub">Before you copy the headline, check the position. Is it a bet, a hedge, or a market maker's book (its trading inventory) - read from Nansen and Hyperliquid data, one address at a time.</p>
```

- [ ] **Step 4: Check in the browser**

Defer to Task 12: open the flagship reading at a 390px-wide viewport, and re-measure (via `read_page` or a screenshot) roughly where the diagram, the Nansen line and Share now sit, confirming they come noticeably earlier than the audit's 934px/1243px/1451px baseline. Confirm the boards section shows its heading and a closed "Show the ranked boards" toggle by default, and that opening it still renders real rows.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat: what's open and what Nansen added move up the card, the boards fold, book gets a one-line gloss"
```

---

## Task 9: README + meta description stop promising a bet worth following [DONE - commit faa1cb2, spec+quality reviewed]

**Files:**
- Modify: `README.md:3`
- Modify: `web/index.html:7,15`

**Context:** The classifier establishes visible exposure structure, not entry quality, trader skill or position age - a clean directional position could already be a bad trade. "a bet you could follow" claims more than the product checks.

- [ ] **Step 1: Edit README.md**

Line 3 currently reads:

```markdown
**Paste a Hyperliquid address. Find out whether that whale position is a bet you could follow, a hedge, or a market maker's book.**
```

Change to:

```markdown
**Paste a Hyperliquid address. See what actually stands behind that whale position - a bet, a hedge, or a market maker's book.**
```

- [ ] **Step 2: Edit the meta description and og:description in web/index.html**

Line 7 currently reads:

```html
<meta name="description" content="Paste a Hyperliquid address: is that whale position a bet you could follow, a hedge, or a market maker's book?">
```

Change to:

```html
<meta name="description" content="Paste a Hyperliquid address: see what actually stands behind that whale position - a bet, a hedge, or a market maker's book.">
```

Line 15 currently reads:

```html
<meta property="og:description" content="Paste a Hyperliquid address: is that whale position a bet you could follow, a hedge, or a market maker's book?">
```

Change to the same text as the meta description above:

```html
<meta property="og:description" content="Paste a Hyperliquid address: see what actually stands behind that whale position - a bet, a hedge, or a market maker's book.">
```

- [ ] **Step 3: Grep for any other occurrence of the phrase**

Run: `grep -rn "bet you could follow" --include=*.md --include=*.html --include=*.ts --include=*.js --exclude-dir=node_modules --exclude-dir=audits .`
Expected: no matches. `docs/audits/` is excluded on purpose - those files are a dated historical record that should keep quoting what they found, not be edited retroactively.

- [ ] **Step 4: Commit**

```bash
git add README.md web/index.html
git commit -m "docs: the tagline stops promising a bet worth following"
```

---

## Task 10: re-explain the gallery and featured data under the fixed rules; guard against this going stale silently again [DONE - commit 674c918, spec+quality reviewed. FOLLOW-UP FOUND (not fixed, not blocking): 15 frozen (historical/superseded) entries across gallery.json+featured.json have real breakdown data but no dataQuality - real, currently-reachable via old snapshot links and historical gallery rows, on all 3 render surfaces (OG/canvas/on-page SVG), affects a narrow slice not the primary live-check/boards/example-chip paths. Do NOT naively call exposureBreakdown() on reexplain.ts's historical/superseded branches - 86% of gallery.json's 100 historical entries are historical specifically because hedge.unverifiedUsd is unrecorded, and a naive recompute would stamp them "measured" (confidently wrong) rather than leaving the field absent. Reviewer's two safe fix options: (a) a distinct 'unknown' sentinel stamped structurally without running exposureBreakdown()'s arithmetic on stale inputs, or (b) a render-time-only fallback deriving uncertainty from hedgeCoverage (reliably present even on old schema) instead of defaulting missing dataQuality to 'measured'.]

**Files:**
- Modify: `data/gallery.json`, `data/featured.json` (regenerated, not hand-edited)
- Modify: `test/gallery.test.ts`

**Context:** `breakdown` (Task 3's new `dataQuality` field included) is computed once and stored per reading, not recomputed per request - confirmed by reading `src/index.ts:79-85`, which builds `listedGallery` from the imported `data/gallery.json`/`data/featured.json` at module load, and `scripts/reexplain.ts`, which is the only thing that re-derives stored `breakdown`/`evidence`/`verdict` from the current code, at no network cost. Yesterday's session (24-25 September) hit exactly this gap for a different field and lost real time to it - `test/gallery.test.ts` already has a "reproduces every stored evidence row" test guarding evidence, written after that incident, but nothing yet guards `breakdown` the same way. `hedgeCoverage` (Task 1) needs no regeneration - confirmed by reading it directly out of both files: all 307 + 5 entries already carry it, `galleryIndex()` only needed to start forwarding a value that was already there.

- [ ] **Step 1: Add a regression test for stored breakdown going stale, and watch it pass on current (pre-regen) data first**

Add to `test/gallery.test.ts`, inside `describe('the saved gallery against the current rules', ...)`, right after the existing `'reproduces every stored evidence row...'` test (after line 77):

```ts
  it('reproduces every stored breakdown, so a diagram fix always reaches the bundle (25.09 audit follow-up)', () => {
    const drifted = current
      .map((e) => ({ address: e.address, stored: e.breakdown, fresh: words(e).breakdown }))
      .filter((r) => JSON.stringify(r.stored) !== JSON.stringify(r.fresh));
    expect(drifted).toEqual([]);
  });
```

Run: `npm test -- gallery.test.ts`
Expected: FAIL - every current entry's stored `breakdown` is missing `dataQuality` (added in Task 3), while `words(e).breakdown` (built with today's code) has it. This is expected and is the point: it proves the bundle is stale before Step 2 fixes that.

- [ ] **Step 2: Re-run reexplain over both files**

```bash
npm run reexplain
npm run reexplain -- data/featured.json
```

Watch the printed summary line from each run (`scripts/reexplain.ts`'s `main()` logs entry/kept/re-judged/forked/re-explained counts). Given Tasks 1-9 touch no verdict logic, `reverdicted`/`forked` should both read `0` on both runs - a nonzero value there would mean some entry's verdict changed, which would be unexpected and worth stopping to understand before continuing (it would mean this plan's fixes, despite being designed as diagram/ranking-only, moved a real verdict, and `test/gallery.test.ts`'s exact-count test would also fail).

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- gallery.test.ts`
Expected: PASS.

- [ ] **Step 4: Confirm the diff looks right**

```bash
git diff --stat data/gallery.json data/featured.json
git diff data/gallery.json | grep -c '"dataQuality"'
```

Expected: both files changed; every non-historical entry's `breakdown` object gained a `"dataQuality"` key. Spot-check one of the four `hedgeCoverage: 'partial'` addresses from Task 1 (e.g. `0x7fdafde5cfb5465924316eced2d3715494c517d1`) and confirm its `dataQuality` reads `"partial"`, not `"measured"`.

- [ ] **Step 5: Run the whole suite once more**

Run: `npm test && npm run typecheck && npm run test:runtime`
Expected: all green. This is the same combination `docs/submission-checklist.md` asks for before every deploy.

- [ ] **Step 6: Commit**

```bash
git add data/gallery.json data/featured.json test/gallery.test.ts
git commit -m "chore: re-explain the gallery and featured data so the bundle carries dataQuality too"
```

---

## Task 11: the submission checklist and demo script say today's real numbers [DONE - commit 5050f6a (576 tests, cap 600), spec+quality reviewed. NOTE: after this task, all commit SHAs from Task 3 onward were rewritten in place (git filter-branch, local-only branch, not pushed) to fix a Co-Authored-By attribution mismatch - 3 subagent-authored commits self-attributed to the model they ran on (Claude Haiku 4.5) or omitted the line, instead of this session's required "Claude Sonnet 5" trailer. Old SHAs 5e8a69e/acb3873/8c12ea2/28a7f7c/b3e4ee2/faa1cb2/674c918/74d7ebf are now 0640267/2719c2d/b62e846/aa61233/4516aa6/4ee7f31/8bef87c/5050f6a respectively (content unchanged, verified via full re-run: 576/576 tests still pass). Commits b96864d/50553b1/b9923b8/da8474c kept their original SHAs (already-correct attribution, unaffected ancestor chain).]

**Files:**
- Modify: `docs/submission-checklist.md`
- Modify: `docs/demo-script.md`

**Context:** The audit named these two concrete discrepancies explicitly. `README.md` already says the current numbers (562 tests, cap 600) - only these two files lag.

- [ ] **Step 1: Fix the stale test count in submission-checklist.md**

The line currently reads (line 33):

```markdown
- **Functionality.** 548 tests on recorded real responses, including the Worker's own
```

Change `548` to the real, current count. Run `npm test` if you have not already this session and read the summary line it prints (e.g. `Test Files  42 passed (42)` / `Tests  562 passed (562)`) - use the exact number it reports, not a number copied from this plan or from the audit, in case it has moved again since this plan was written:

```markdown
- **Functionality.** <the current npm test count> tests on recorded real responses, including the Worker's own
```

- [ ] **Step 2: Fix the stale credit cap in demo-script.md**

The line currently reads (line 11, inside the blockquote):

```markdown
> **Credits.** The account answered with **916 credits left** on 24 September, after the four demonstration readings and a second read of the Hedged one. This check costs up to 7. The two contrast beats below open saved readings and cost nothing. The daily cap in the Worker is 300, and 40 of it is a reserve the public path cannot reach, which is what keeps a busy afternoon from leaving the demo on Hyperliquid-only data.
```

Change only the cap number (leave "916 credits left" alone - it is dated, point-in-time context the sentence already scopes to "on 24 September", not a claim about today):

```markdown
> **Credits.** The account answered with **916 credits left** on 24 September, after the four demonstration readings and a second read of the Hedged one. This check costs up to 7. The two contrast beats below open saved readings and cost nothing. The daily cap in the Worker is 600 (raised from 300 for judging week - see `wrangler.toml`), and 40 of it is a reserve the public path cannot reach, which is what keeps a busy afternoon from leaving the demo on Hyperliquid-only data.
```

- [ ] **Step 3: Grep for the same two stale numbers anywhere else in docs/**

Run: `grep -rn "548 tests\|cap.*300\|300.*cap" docs/*.md`
Expected: no remaining matches describing the *current* state (a match inside `docs/audits/*.md` is a dated historical record and must not be changed).

- [ ] **Step 4: Commit**

```bash
git add docs/submission-checklist.md docs/demo-script.md
git commit -m "docs: the checklist and demo script say today's test count and credit cap"
```

---

## Task 13 (added after Task 12, from the final whole-branch review): a material unidentified share withholds confidence the same way the classifier does [DONE - commit 8d07949, spec+quality reviewed. The final holistic review below found that `dataQuality` (Task 3) mirrored only half of computeVerdict's own unrecognised_assets check (unpricedMatches, not unverifiedShare) - a real gap affecting FRESH LIVE checks, not just legacy data, unlike Tasks 7/10's follow-ups, so fixed immediately rather than deferred. Added 'unverified' as a 4th dataQuality value, computed via DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare imported directly from verdict.ts (no re-derived duplicate threshold). All 3 render surfaces inherit it: SVG already generically checked dataQuality!=='measured' (zero code change there - and per Task 13's own review, drawScale was never actually at risk anyway, since it already had its own independent unverified>0&&materialGap check on segments; only canvas+OG lacked any such protection), canvas got a new specific caveat sentence, OG needed OgCardData's own separately-declared type widened by one line (necessary, minimal, reviewed). Confirmed no data regen needed this time (scanned all 312 bundled entries: max real unverifiedShare ~1e-8, nowhere near the 10% threshold, and the "reproduces every stored breakdown" test from Task 10 already passes). FOLLOW-UP FOUND (not fixed, not blocking, pre-existing tech debt not introduced by this branch): web/app.js's own MATERIAL_GAP_SHARE=0.1 (predates this whole session, commit 6f1c7e9) is a THIRD hand-duplicated copy of the same 0.1 threshold, unguarded by any test (unlike HEDGE_BAND_MIN/MAX, which Task 5 already pinned via test/web-app-verdict-sync.test.ts). Cheap fix when picked up: add one assertion to that same test file. Currently harmless (both copies agree today; only affects the SVG page for legacy pre-dataQuality readings, which already has independent protection regardless).]

## Task 12: full verification pass [DONE - performed directly, not delegated, since it is controller-level synthesis. npm test 576/576 (43 files), typecheck clean, test:runtime 9/9, npm audit 0 vulnerabilities, 0 em/en dashes across all 18 branch-touched files. Live-browser verification via a local wrangler dev preview (JS-driven, screenshots were unreliable in this session - pane not foregrounded - so verification used read_page/get_page_text/javascript_tool instead, which is more precise for computed values anyway): flagship auto-opens; pan labels "the position"/"this address" render; dark-mode scale contrast measured 12.04:1 (vs audit's 1.89:1); Book bar for the market-maker chip fills to 590.8/646=91.5% matching its "91%" caption exactly; 97%-covered chip caption reads "within the hedge band"; boards render live, "Least covered shorts" shows exactly the 4 predicted hedgeCoverage=complete addresses (down from 5, the 9 partial ones correctly excluded); boards grid at 954px gives the position-name column 546px (was 34px); at 390px it collapses to one column; DOM order in #card confirmed live as breakdown->open-question->nansen->share->decisive->coverage->limit->changed, matching Task 8's intended reorder exactly; downloading the image for 0x7fdafde5... (a real not-checked-segment address) throws no error and paints real pixels, with dataQuality:"partial" confirmed present post-Task-10-regen. No server errors in preview_logs throughout.]

**Files:** none (verification only)

- [ ] **Step 1: Full automated suite**

```bash
npm test
npm run typecheck
npm run test:runtime
npm audit --omit=dev
```

Expected: all green, 0 production vulnerabilities. Compare the printed test count against what Task 11 Step 1 wrote into `docs/submission-checklist.md` - they must match exactly.

- [ ] **Step 2: Grep for the em dash rule**

The user's global instructions forbid the em dash (U+2014) and en-dash-as-a-dash (U+2013) everywhere, including code, comments, docs and commits. Every code block in this plan was written with a plain hyphen; verify nothing slipped through, scoped to exactly the files this plan touched (a blanket scan of all of `docs/` would also flag pre-existing historical audit prose this plan never edits, which is out of scope to retroactively fix here):

```bash
grep -n $'\xe2\x80\x94\|\xe2\x80\x93' \
  src/gallery.ts src/index.ts src/engine/breakdown.ts src/engine/ogCard.ts src/engine/ogRender.ts \
  web/app.js web/index.html README.md \
  docs/submission-checklist.md docs/demo-script.md \
  test/gallery-index.test.ts test/routes.test.ts test/engine/breakdown.test.ts \
  test/engine/ogCard.test.ts test/engine/ogRender.test.ts test/gallery.test.ts
```

Expected: no matches. Fix any that appear before continuing.

- [ ] **Step 3: Start the preview and walk through every visual fix**

Use `preview_start` for the `dev` server (`wrangler dev`), then in the browser:

1. Open with nothing pasted - confirm the flagship funded-short reading still auto-opens.
2. Confirm the scale shows "the position" / "this address" labels on its pans (Task 5), and the caption at ~97% coverage reads "within the hedge band" (Task 5).
3. Open the $46.9M ETH short / market-maker chip; confirm the Book bar reads and fills to ~91%, not further (Task 5).
4. Switch to dark mode (`resize_window` with `colorScheme: 'dark'`, or the OS setting); confirm the scale/pans are clearly visible, not faint (Task 6).
5. Scroll to "Ranked from the same readings"; confirm it is collapsed by default behind "Show the ranked boards" (Task 8), and that opening it shows "Least covered shorts" with 4 rows, none reading a misleadingly-confident 0% for a partial read (Task 1).
6. At a ~954px window width, expand the boards and confirm a long position name (any `xyz:` row, or search for one) reads on one line, not squeezed into a narrow column (Task 4).
7. Open any of the four addresses listed in Task 7 Step 3; click "Download image"; confirm no console error and a dashed border with a caveat line on the picture (Task 7).
8. Confirm the subtitle now reads "...a market maker's book (its trading inventory)..." (Task 8) and the page `<title>`/meta description no longer say "a bet you could follow" (Task 9) - `view-source:` or `read_page` on `<head>`.
9. At a 390px-wide viewport, confirm the diagram, the "From Nansen" line and the Share button all sit noticeably higher on the page than the audit's baseline (934px/1243px/1451px) - approximate is fine, exact pixel parity is not the bar.

- [ ] **Step 4: Report back**

Summarize, per audit item (A01, A02, A03, A04, A05, A08, A13, first screen, README/meta, docs), what shipped and what was deliberately deferred (this plan's Scope section), matching how `[[audit-2026-09-24-evening]]` was written up for the prior cycle. Do not push, deploy, merge, or open a PR without the user asking - the prior cycle's own memory shows that was asked for separately, after the branch was already green.
