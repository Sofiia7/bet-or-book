# Deferred Audit Items and Technical Debt: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the items the first audit-fix cycle (`docs/superpowers/plans/2026-09-25-second-audit-fixes.md`, merged to `main` at `3df951f`) deliberately deferred, plus the two technical-debt follow-ups that cycle's own reviews surfaced, all now explicitly authorized by the user: A06 (funder-read-failure text), A07 (Unknown qualifier reaching boards/recent), A09 (a real diagram for a long instead of an empty pan), A10 (a date on every board row), the first-screen card redesign (hero numbers, reordered blocks, a "Check another" action), a refreshed set of featured readings (A11 - the one step that spends real Nansen credits), and the two documented technical debts (historical/superseded entries never getting `dataQuality`; `MATERIAL_GAP_SHARE` duplicated a third time with no drift guard).

**Architecture:** Same pipeline as before - Observe -> Interpret -> Present. Two new fields travel through the same `Observation`/`GalleryRow` plumbing pattern Task 1 and Task 3 of the prior cycle already established (`linkedHedgeCoverage`, mirroring `hedgeCoverage`; a `qualifier` string, computed fresh in `galleryIndex()` from fields already on every stored entry - unlike `hedgeCoverage`, which is itself a stored field `GalleryRow` only forwards). The card redesign reuses existing data and existing CSS classes wherever possible rather than inventing new computations, to keep the risk contained to markup/JS, not new backend logic.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, plain DOM/Canvas/SVG, `scripts/prescan.ts` for the one credit-spending step.

---

## Scope and sequencing

Tasks 1-2 are trivial and independent - do them first. Tasks 3-4 add a new field through the same plumbing pattern as the prior cycle (independent of each other, but both should land before Task 8's redesign touches the same rendering functions). Task 5 (tech debt: historical/superseded `dataQuality`) touches `scripts/reexplain.ts`, a sensitive script - independent of the others structurally, but do it after Task 3/4 so any new fields it needs to preserve already exist. Task 6 (A09, the long diagram) and Task 7 (board dates) are independent, self-contained frontend changes. **Task 8 (the card redesign) depends on Tasks 3, 4 and 6 already being in place**, since it repositions elements those tasks touch and reuses the decisive-evidence tile those tasks' data feeds. Task 9 (A11, refresh featured) must come after Task 8, since the audit's own guidance is to refresh right before final recording, once the card's presentation is settled - and it is the only task that spends real Nansen credits, so it gets its own explicit confirmation step even though the user has already authorized it in principle. Task 10 is final verification and re-deploy.

**Not in this plan, still deliberately out of scope:** the full "PresentationModel" architecture; independent-sample calibration of the classifier; v6 items (material quoting, watchlist, lazy PnL). None of these were in the user's "делай" list.

---

## Task 1: `MATERIAL_GAP_SHARE` gets the same drift guard `HEDGE_BAND_MIN`/`MAX` already has [DONE - commit 1713984, spec+quality reviewed. Two non-blocking polish notes for later: describe-block title now undersells scope, and the bidirectional pointer comments HEDGE_BAND_MIN/MAX got were not extended to this third constant.]

**Files:**
- Modify: `test/web-app-verdict-sync.test.ts`

**Context:** `web/app.js` hand-duplicates `DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare` a third time as `MATERIAL_GAP_SHARE = 0.1` (predates this whole session, commit `6f1c7e9`). The prior cycle's Task 5 already pinned two other duplicated constants (`HEDGE_BAND_MIN`/`HEDGE_BAND_MAX`) to their `verdict.ts` source with a regex-based text-read test in this exact file. This task adds the same guard for the third constant, closing a gap a later review explicitly flagged as cheap and worth doing.

- [ ] **Step 1: Read the current test file to match its established pattern exactly**

Read `test/web-app-verdict-sync.test.ts` in full first - it already has one `describe`/`it` reading `web/app.js` as raw text via `readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')` and regex-extracting `HEDGE_BAND_MIN`/`HEDGE_BAND_MAX`, comparing them to `DEFAULT_THRESHOLDS.hedged.minHedgeRatio`/`maxHedgeRatio`. Match this file's exact style (imports, helper structure) for the new test below - do not introduce a second, differently-styled way of doing the same kind of check in the same file.

- [ ] **Step 2: Write the test**

Add a new `it` (or a new `describe` block, matching whichever the file's existing structure suggests fits better) asserting that `web/app.js`'s `MATERIAL_GAP_SHARE` constant equals `DEFAULT_THRESHOLDS.hedged.maxUnverifiedShare`, using the exact same raw-text-read-and-regex approach as the existing test(s) in this file. The constant currently appears in `web/app.js` as:

```js
const MATERIAL_GAP_SHARE = 0.1;
```

Confirm this exact declaration text (with `grep -n "const MATERIAL_GAP_SHARE" web/app.js`) before writing the regex, since it must match character-for-character or the test will falsely report drift.

Run: `npm test -- web-app-verdict-sync`
Expected: PASS immediately (both values are `0.1` today; this test's job is to catch future drift, not to fail now - there's nothing to fix in the source, only a test to add).

- [ ] **Step 3: Verify the test is a real guard, not just a passing assertion**

Temporarily change `MATERIAL_GAP_SHARE`'s value in `web/app.js` to something else (e.g. `0.15`), run the test file alone, confirm it fails, then revert with `git checkout -- web/app.js` and confirm `git diff` shows no leftover change before moving on.

- [ ] **Step 4: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add test/web-app-verdict-sync.test.ts
git commit -m "test: MATERIAL_GAP_SHARE is pinned to the same source as the other two duplicated thresholds"
```

---

## Task 2: A06 - a failed funder read no longer claims the funders hold nothing [DONE - commit cf95689, spec+quality reviewed across 4 rounds (each round's adversarial testing found one more code path reproducing the same false-claim bug class: rejected balance read -> catch-all else in nansenContribution.ts -> relatedWallets enumeration failures -> malformed-body catch blocks; round 4's systematic audit of all 9 note() call sites in readLinkedHedge confirmed exactly these were the only gaps). FOLLOW-UP FOUND (not fixed, not blocking, explicitly out of this task's scope): src/engine/breakdown.ts's exposureBreakdown() only reads the account's own hedgeCoverage, never linkedHedgeCoverage - so dataQuality/elsewhere can still render falsely confident (solid scale, no "held elsewhere") when the funder search fails even though the account's OWN balance read succeeded. Real, reachable, zero test coverage, affects the live page diagram + OG card + canvas download. Worth its own follow-up task.]

**Files:**
- Modify: `src/engine/features.ts` (`LinkedHedgeFeatures` - add nothing here; coverage travels alongside it, not inside it, matching how `hedgeCoverage` sits beside `hedge: HedgeFeatures` rather than inside it)
- Modify: `src/api/observe.ts` (`readLinkedHedge`, and its one call site)
- Modify: `src/engine/observation.ts` (the `Observation` interface, wherever `linkedHedge` is declared)
- Modify: `src/engine/interpret.ts` (thread the new field through to `CheckResult`, matching how `hedgeCoverage` already is)
- Modify: `src/api/check.ts` (add the field to `CheckResponse`/`CheckResult` if `interpret.ts`'s `judged` object doesn't already make it flow through automatically - check this before assuming a change is needed here)
- Modify: `src/engine/nansenContribution.ts`
- Modify: `scripts/reexplain.ts` (a legacy-inference helper, matching the existing `legacyHedgeCoverage` pattern)
- Test: `test/sources/observe.test.ts` or wherever `readLinkedHedge`/funder-read tests currently live - find the right file by searching for existing tests of this function before adding a new one
- Test: `test/engine/nansenContribution.test.ts`

**Context:** `readLinkedHedge` (`src/api/observe.ts`, currently around line 529-611) fetches balances for each funder candidate via `Promise.allSettled`. When a candidate's balance fetch REJECTS, the code already calls `note('One linked wallet could not be read', true)` (a real, separate failure note - already correct) and skips that wallet (`return []`), but the `LinkedHedgeFeatures` object `computeLinkedHedge` produces from the remaining (possibly empty) `linked` array looks IDENTICAL to "every funder was read and genuinely holds nothing": `{linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: []}`. `src/engine/nansenContribution.ts`'s current line (find it with `grep -n "hold no" src/engine/nansenContribution.ts` - it was line 142 when last read, may have shifted):

```ts
    } else {
      items.push(`Funding links: read; the wallets that funded this account hold no ${coin}.`);
    }
```

asserts "read" (implying success) whenever `funders.length === 0`, whether that's because the read genuinely succeeded and found nothing, or because it failed outright. Fix: track read completeness for the funder search the same way `hedgeCoverage` already tracks it for the main holdings search, and have `nansenContribution.ts` say the honest thing in each case.

- [ ] **Step 1: Read the current code to confirm exact line numbers and confirm the plan against reality**

Read `src/api/observe.ts`'s `readLinkedHedge` function and its one call site (search for `readLinkedHedge(` - there should be exactly one call, inside the same file, in the function that also computes `hedgeCoverage` a few dozen lines above). Read `src/engine/observation.ts`'s `Observation` interface to find where `linkedHedge` and `hedgeCoverage` are declared, so the new field sits next to them in the same style. Read `src/engine/interpret.ts`'s `judged`/`present` object construction to see exactly how `hedgeCoverage` flows from `Observation` into `CheckResult` - the new field should flow the same way. Read `src/api/check.ts`'s `CheckResponse`/`CheckResult` type to see whether it already includes every `Observation` field generically (in which case no direct edit is needed there) or lists fields explicitly (in which case add the new one).

If anything about the actual current code meaningfully differs from what this task assumes, note the difference and adapt the following steps to match reality rather than the assumption - the exact shape matters here (a wrong assumption about how `hedgeCoverage` flows would produce a field that silently never reaches the page).

- [ ] **Step 2: Write the failing tests**

Find or create the right test file for `readLinkedHedge` (search `test/` for existing tests importing from `src/api/observe.ts` or exercising funder/linked-hedge behavior - `test/api/focus.test.ts` and files under `test/sources/` are candidates; if none directly test `readLinkedHedge`, add a new describe block to whichever file already mocks Nansen's `relatedWallets`/`currentBalance` for this kind of scenario, matching its existing fixture style). Add a test proving: when a funder candidate exists but its balance fetch fails (mock `currentBalance` to reject or return a rejected promise for one candidate), the resulting coverage indicator reads something other than "complete" (name the exact new value once Step 3 below settles its type - likely reusing `HedgeCoverage`'s `'missing'`/`'partial'` values, matching the existing pattern exactly rather than inventing a new type).

Add to `test/engine/nansenContribution.test.ts` (read this file first for its existing test/fixture style - it builds `CheckResponse`-shaped inputs by hand): a test where `linkedHedge` is a zero/empty `LinkedHedgeFeatures` (`{linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: []}`) AND the new coverage field indicates the read did not complete - assert the resulting `items` array does NOT contain the phrase "Funding links: read; the wallets that funded this account hold no" and instead contains an honest phrase saying the read failed (e.g. "Funding links: could not be read" or similar - write the exact sentence in Step 4 below, then make this test assert that exact sentence). Also add a companion test where the SAME zero/empty `LinkedHedgeFeatures` has coverage indicating the read genuinely completed - assert the EXISTING "hold no {coin}" sentence still appears in that case (this is the regression guard: the fix must not remove the correct sentence for the case where it's actually true).

Run both new/updated test files.
Expected: FAIL - the current code has no way to represent read failure here.

- [ ] **Step 3: Thread a coverage indicator alongside `linkedHedge`**

In `src/api/observe.ts`, inside `readLinkedHedge`, track whether any candidate's balance fetch failed outright, using the exact same pattern already used for `truncatedFunder` a few lines below (find the `flatMap` over `candidates` that builds `linked`):

```ts
  let truncatedFunder = false;
  let failedFunder = false;
  const linked = candidates.flatMap((wallet, i) => {
    const b = balances[i];
    if (b.status !== 'fulfilled') {
      note('One linked wallet could not be read', true);
      failedFunder = true;
      return [];
    }
```

(Keep everything else inside this `flatMap` unchanged - only add the `failedFunder = true` line inside the existing `if (b.status !== 'fulfilled')` branch, and declare `failedFunder` alongside the existing `truncatedFunder` declaration.)

Change `readLinkedHedge`'s return type and its final return statement. It currently ends with:

```ts
  if (truncatedFunder) {
    note('A funding wallet was not read in full - its first 100 tokens only, or rows that came back malformed - so its holdings may be understated', true);
  }
  return computeLinkedHedge(
    positionFeatures.headlineCoin,
    positionFeatures.headlineSide,
    positionFeatures.headlineNotionalUsd,
    linked,
  );
}
```

Change the function's return type from `Promise<LinkedHedgeFeatures | null>` to `Promise<{ features: LinkedHedgeFeatures; coverage: HedgeCoverage } | null>` (import `HedgeCoverage` from `./features` or wherever it's already imported from in this file - check the top of `observe.ts`, it should already be imported since `hedgeCoverage` uses it). Change the ending to:

```ts
  if (truncatedFunder) {
    note('A funding wallet was not read in full - its first 100 tokens only, or rows that came back malformed - so its holdings may be understated', true);
  }
  // A candidate whose balance could not be read at all can only have hidden
  // a funder's holding, never invented one - so this coverage state follows
  // the exact same logic hedgeCoverage already uses for the account's own
  // holdings, just for the funder search instead (25.09 audit, A06).
  const coverage: HedgeCoverage = failedFunder && linked.length === 0 ? 'missing' : failedFunder || truncatedFunder ? 'partial' : 'complete';
  return {
    features: computeLinkedHedge(
      positionFeatures.headlineCoin,
      positionFeatures.headlineSide,
      positionFeatures.headlineNotionalUsd,
      linked,
    ),
    coverage,
  };
}
```

Also handle the function's early return for no candidates (`if (candidates.length === 0) return null;`) - leave this as `null` (unchanged): no candidates worth following is a genuinely different, already-correctly-handled state (the caller's `if (r.linkedHedge)` check already treats `null` as "nothing to say here" and skips the whole section), not a coverage question.

Find `readLinkedHedge`'s one call site (in the same file, a few dozen lines above `readLinkedHedge`'s own definition, inside the function that also sets `hedgeCoverage`). It currently reads approximately:

```ts
  let linkedHedge: LinkedHedgeFeatures | null = null;
  if (funderLookupWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at the wallets that funded the account', true);
  } else if (funderLookupWorthIt) {
    linkedHedge = await readLinkedHedge(nansen!, address, positionFeatures, note);
  }
```

Change to:

```ts
  let linkedHedge: LinkedHedgeFeatures | null = null;
  let linkedHedgeCoverage: HedgeCoverage = 'not-applicable';
  if (funderLookupWorthIt && outOfTime()) {
    note('This check ran out of time before it could look at the wallets that funded the account', true);
    linkedHedgeCoverage = 'missing';
  } else if (funderLookupWorthIt) {
    const result = await readLinkedHedge(nansen!, address, positionFeatures, note);
    if (result) {
      linkedHedge = result.features;
      linkedHedgeCoverage = result.coverage;
    }
  }
```

Read the rest of this function (the object it eventually returns or assigns into, likely an `Observation`-shaped object) to find where `linkedHedge` itself gets included, and add `linkedHedgeCoverage` right next to it.

- [ ] **Step 4: Thread the field through `Observation` and `CheckResult`**

In `src/engine/observation.ts`, add `linkedHedgeCoverage: HedgeCoverage;` to the `Observation` interface, right next to the existing `linkedHedge` field, with a doc comment explaining why (mirroring `hedgeCoverage`'s own doc comment style: "how completely was this searched" not "what did it find").

In `src/engine/interpret.ts`, find the `judged` object construction inside `present()` (or wherever `hedgeCoverage: r.hedgeCoverage` currently appears) and add `linkedHedgeCoverage: r.linkedHedgeCoverage,` right next to it.

If `src/api/check.ts`'s `CheckResult`/`CheckResponse` type does not already pick up every field generically from what `present()` returns (check this - it may already be a broad enough type that nothing needs to change here), add `linkedHedgeCoverage: HedgeCoverage;` there too, matching wherever `hedgeCoverage` is declared.

- [ ] **Step 5: Fix `nansenContribution.ts`'s claim**

Find the exact current block (search `grep -n "hold no" src/engine/nansenContribution.ts`):

```ts
    } else {
      items.push(`Funding links: read; the wallets that funded this account hold no ${coin}.`);
    }
```

Change to distinguish the two cases:

```ts
    } else if (r.linkedHedgeCoverage === 'missing' || r.linkedHedgeCoverage === 'partial') {
      items.push(`Funding links: could not be read in full, so whether the funding wallets hold ${coin} is not known.`);
    } else {
      items.push(`Funding links: read; the wallets that funded this account hold no ${coin}.`);
    }
```

Check whether `r` here (the parameter `nansenContribution(r: CheckResponse)`) already has `linkedHedgeCoverage` on its type from Step 4 - it should, since `CheckResponse` is what this function's parameter is typed as.

- [ ] **Step 6: Handle the legacy case in `scripts/reexplain.ts`**

Read `scripts/reexplain.ts`'s existing `legacyHedgeCoverage(e)` function (it infers `hedgeCoverage` for entries stored before that field existed, from other signals already on the entry). Add an analogous `legacyLinkedHedgeCoverage(e)` function following the exact same shape/reasoning style, and use it wherever the entry gets re-judged/re-explained (the same place `legacyHedgeCoverage(e)` is already called), so old stored entries get a sensible value for the new field too rather than `undefined`. Given `linkedHedge` itself is optional/nullable on old entries and there's no direct historical signal for "did the funder read fail," a reasonable, honest default for entries that already have a `linkedHedge` object is `'complete'` (matching how the ORIGINAL code before this fix always effectively assumed success) - do NOT default to `'missing'` or `'partial'` for old entries, since that would be a confidence downgrade with no evidence behind it, the opposite problem from A06 itself. For entries where `linkedHedge` is null/absent, `'not-applicable'` is correct, matching how `hedgeCoverage` itself defaults for a case with nothing to search.

- [ ] **Step 7: Run the tests to verify they pass**

Run the two test files updated in Step 2, then the full suite (`npm test`) and typecheck (`npm run typecheck`).
Expected: all green, including the regression-guard test from Step 2 (the correct "hold no {coin}" sentence must still appear when the read genuinely completed).

- [ ] **Step 8: Regenerate the bundled data**

Run `npm run reexplain` and `npm run reexplain -- data/featured.json`, exactly as the prior cycle's Task 10 did, since this task adds a new field (`linkedHedgeCoverage`) that pre-computed stored entries won't have until they're re-derived. Read the printed re-judged/forked counts from both runs - they should both read 0 (this task does not touch verdict-deciding logic), and if either is nonzero, STOP and report BLOCKED rather than committing, exactly as the established precedent from the prior cycle requires.

Add a targeted spot-check (a small throwaway script, deleted after use, matching the prior cycle's own precedent): pick one real entry from the regenerated `data/gallery.json` that has a non-null `linkedHedge`, confirm its `linkedHedgeCoverage` is present and is `'complete'` (matching Step 6's legacy-inference default), and confirm calling `nansenContribution()` on it does NOT produce the old, potentially-false "hold no X" sentence unless that entry's coverage genuinely is complete.

- [ ] **Step 9: Run the whole suite once more**

Run: `npm test && npm run typecheck && npm run test:runtime`.
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add src/api/observe.ts src/engine/observation.ts src/engine/interpret.ts src/engine/nansenContribution.ts src/api/check.ts scripts/reexplain.ts data/gallery.json data/featured.json test/engine/nansenContribution.test.ts
git commit -m "fix: a failed funder read says so, instead of claiming the funders hold nothing"
```

(Adjust the file list in `git add` to match whichever test file Step 2 actually used for `readLinkedHedge` itself, and whether `src/api/check.ts` needed a change in Step 4.)

---

## Task 3: A07 - the Unknown qualifier reaches boards and recent checks, not just the big card

**Files:**
- Modify: `src/gallery.ts`
- Modify: `web/app.js` (`boardRow`, `renderRecent`, `saveRecent`)
- Test: `test/gallery-index.test.ts`

**Context:** The big card explains an Unknown verdict with a specific qualifier (e.g. "Unknown · assets sit with funders", via `badgeQualifier()` in `src/engine/reasons.ts`, already computed server-side as `CheckResponse.badgeQualifier`). `GalleryRow.verdict` only picks `'verdict' | 'strength'` from the stored verdict - no qualifier - so a board row or a "recent checks" chip for the exact same reading just says the bare word "Unknown", losing the one thing that makes it useful. Fix: forward the already-computed `badgeQualifier` into `GalleryRow`, matching Task 1 of the prior cycle's exact pattern for `hedgeCoverage`, and use it in the two compact renderers.

- [ ] **Step 1: Read the current code**

Read `src/engine/reasons.ts`'s `badgeQualifier` function and confirm `CheckResponse`/`CheckResult` (in `src/api/check.ts`) actually has a `badgeQualifier` field populated for every entry (check `src/index.ts` around where `badgeQualifier(r.verdict, ...)` is called, and confirm this value ends up stored on the entries written to `data/gallery.json`/`data/featured.json`, not just computed fresh per live request - `scripts/prescan.ts` calls `checkAddress` directly, and `checkAddress`/`present()` may or may not include `badgeQualifier` in what gets returned and stored; if it does NOT currently reach stored entries, note this and adjust - you may need to also add it to `interpret.ts`'s `present()` output, matching how other fields reach `CheckResult`, before `GalleryRow` can forward it). Read `web/app.js`'s current `boardRow`, `renderRecent`, `saveRecent`, and `badgeText` functions (search for `function badgeText`, `function boardRow`, `function renderRecent`, `function saveRecent`).

- [ ] **Step 2: Write the failing test**

Add to `test/gallery-index.test.ts`, following the exact pattern the prior cycle's `hedgeCoverage` test used in this same file (`'carries hedgeCoverage, so a board can tell a real 0% from a read that never finished...'`):

```ts
  it('carries the badge qualifier, so a board or a recent-checks chip can say which Unknown this is (25.09 audit, A07)', async () => {
    const list = (await (await worker.fetch(request('/api/gallery'), testEnv())).json()) as {
      entries: Array<{ verdict: { verdict: string }; badgeQualifier?: string | null }>;
    };
    const unknownRow = list.entries.find((e) => e.verdict.verdict === 'unknown');
    expect(unknownRow).toBeDefined();
    // Not every Unknown has a qualifier (badgeQualifier can be null), but the
    // field itself must exist on the row - `undefined` and `null` are
    // different claims here, and a board must be able to tell them apart.
    expect(unknownRow).toHaveProperty('badgeQualifier');
  });
```

Run: `npm test -- gallery-index`
Expected: FAIL.

- [ ] **Step 3: Add `badgeQualifier` to `GalleryRow` and forward it**

In `src/gallery.ts`, add to the `GalleryRow` interface, following the exact style of the `hedgeCoverage` field already there (doc comment, placement):

```ts
  /** The same short reason the big card's badge carries next to "Unknown"
   * (src/engine/reasons.ts, badgeQualifier) - null when there is none to
   * give. Without this a board or a recent-checks chip can only ever say
   * the bare word "Unknown", which the big card for the same reading never
   * does (25.09 audit, A07). */
  badgeQualifier: string | null;
```

In `galleryIndex()`'s per-entry map, add (matching where `hedgeCoverage: e.hedgeCoverage,` sits):

```ts
        badgeQualifier: e.badgeQualifier ?? null,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- gallery-index`
Expected: PASS.

- [ ] **Step 5: Use it in `boardRow`**

In `web/app.js`, find `badgeText(d)` (it already builds the qualifier suffix for the big card: `d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base`). `boardRow` already calls `badgeText(e)` to build its badge span - confirm this already picks up `e.badgeQualifier` automatically now that `GalleryRow` carries it (it should, since `badgeText` just reads `d.badgeQualifier` off whatever object it's given, and `boardRow`'s `e` is now a `GalleryRow` with that field). If `badgeText` already works unmodified, no code change is needed here beyond Step 3 - verify this by reading `badgeText`'s exact current code rather than assuming.

- [ ] **Step 6: Use it in `recent`**

`saveRecent` (in `web/app.js`) currently saves `{id, address, headline, verdict, checkedAt}` for each recent check - no qualifier. Find its call site inside `renderResult` (search `saveRecent({`) and add the qualifier:

```js
    saveRecent({
      id: d.snapshotId,
      address: d.address,
      headline: positionText(d),
      verdict: d.verdict.verdict,
      badgeQualifier: d.badgeQualifier ?? null,
      checkedAt: d.checkedAt,
    });
```

Find `renderRecent` (currently around line 1661-1673):

```js
function renderRecent() {
  const list = loadRecent();
  const box = $('recent');
  box.hidden = list.length === 0;
  if (list.length === 0) return;
  $('recent-chips').replaceChildren(...list.map((r) => {
    const v = VERDICTS[r.verdict] || VERDICTS.unknown;
    const b = el('button', 'chip', r.headline + ' · ' + v.label);
    b.title = 'Checked ' + fmtTime(r.checkedAt);
    b.addEventListener('click', () => openSnapshot(r.id));
    return b;
  }));
}
```

Change the chip label to include the qualifier when present, matching `badgeText`'s own formatting:

```js
function renderRecent() {
  const list = loadRecent();
  const box = $('recent');
  box.hidden = list.length === 0;
  if (list.length === 0) return;
  $('recent-chips').replaceChildren(...list.map((r) => {
    const v = VERDICTS[r.verdict] || VERDICTS.unknown;
    const label = r.verdict === 'unknown' && r.badgeQualifier ? v.label + ' · ' + r.badgeQualifier : v.label;
    const b = el('button', 'chip', r.headline + ' · ' + label);
    b.title = 'Checked ' + fmtTime(r.checkedAt);
    b.addEventListener('click', () => openSnapshot(r.id));
    return b;
  }));
}
```

An entry already saved in a browser's `localStorage` from before this change simply has `badgeQualifier: undefined`, which the `r.verdict === 'unknown' && r.badgeQualifier` check already handles safely (falsy, falls back to the plain label) - no migration needed for existing saved data.

- [ ] **Step 7: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/gallery.ts web/app.js test/gallery-index.test.ts
git commit -m "fix: a board row and a recent-checks chip say which Unknown, the same as the big card does"
```

---

## Task 4: Tech debt - historical and superseded entries get a real `dataQuality` instead of none at all

**Files:**
- Modify: `src/engine/breakdown.ts`
- Modify: `scripts/reexplain.ts`
- Test: `test/engine/breakdown.test.ts`
- Test: `test/reexplain.test.ts`

**Context:** A prior review found that `scripts/reexplain.ts` deliberately never recomputes `breakdown` for entries it marks `historical` or leaves `superseded` (by design, for verdict-safety - recomputing a historical entry's breakdown from today's rules could read like reinterpreting a frozen record). Side effect: entries with real `breakdown.applies: true` data but no `dataQuality` field stay that way forever, and the page's fallback (`?? 'measured'` in `ogCard.ts`, `b.dataQuality &&` guards elsewhere) silently reads them as fully confident. The prior review's own recommendation, confirmed safe: **do not** call `exposureBreakdown()`'s arithmetic on these frozen entries (verified: 86% of one file's historical entries are historical specifically because a field `exposureBreakdown()` would need is itself missing, and a naive recompute would produce a confidently wrong `'measured'`). Instead, stamp a distinct, structural `'unknown'` value that means exactly "this old entry predates the field, no claim is made either way."

- [ ] **Step 1: Write the failing tests**

In `test/engine/breakdown.test.ts`, inside the existing `describe('a data-quality flag the diagram can trust on its own (25.09 audit, A03)', ...)` block, this task does NOT add a new case to `exposureBreakdown()` itself (that function is not what stamps `'unknown'` - only `reexplain.ts` does, for frozen entries it does not run `exposureBreakdown` over at all). Instead, widen the type test coverage: add one assertion confirming the type itself now accepts `'unknown'` as a valid `dataQuality` value (a compile-time check more than a runtime one - write it as a real test that constructs an `ExposureBreakdown` object literal with `dataQuality: 'unknown'` and asserts it round-trips, so a future accidental narrowing of the type would fail typecheck, not silently compile):

```ts
  it('accepts unknown as a valid dataQuality value, for entries scripts/reexplain.ts stamps without recomputing (technical debt from the 25.09 audit follow-up)', () => {
    const stamped: ExposureBreakdown = {
      applies: true, coin: 'ETH', side: 'short', headlineUsd: 100,
      segments: [{ kind: 'residual', usd: 100, share: 1 }],
      excessUsd: 0, elsewhere: null, dataQuality: 'unknown',
    };
    expect(stamped.dataQuality).toBe('unknown');
  });
```

(This requires importing `ExposureBreakdown` as a type in this test file if not already imported - check the top of the file.)

In `test/reexplain.test.ts`, read the file's existing style first (it uses `baseEntry()` built from a real gallery entry, and calls `reexplainGallery(gallery, now)` directly). Add a test proving a historical entry with real `breakdown.applies: true` but no `dataQuality` gets stamped `'unknown'` after a reexplain pass, and that this does NOT change its verdict, its `classifierVersion`, or mark it as reverdicted/forked (the whole point is this is presentation-only, not a reinterpretation):

```ts
  it('stamps a historical entry\'s breakdown with dataQuality: unknown, without touching its frozen verdict (technical debt from the 25.09 audit follow-up)', () => {
    const historicalWithBreakdown = gallery.entries.find(
      (e) => e.historical && e.breakdown?.applies && e.breakdown.dataQuality === undefined,
    );
    if (!historicalWithBreakdown) {
      // Nothing in the current bundle exercises this path - still worth
      // asserting the pass does not error on a synthetic one.
      const synthetic = {
        ...baseEntry(),
        historical: { reason: 'test fixture', missing: ['orders.headlineTwoSidedNotionalUsd'] },
        breakdown: { applies: true, coin: 'ETH', side: 'short' as const, headlineUsd: 100, segments: [{ kind: 'residual' as const, usd: 100, share: 1 }], excessUsd: 0, elsewhere: null },
      };
      const galleryWithSynthetic = { scannedAt: null, finishedAt: null, universe: 'test', entries: [synthetic] };
      const result = reexplainGallery(galleryWithSynthetic, '2026-09-25T00:00:00.000Z');
      expect(result.gallery.entries[0].breakdown?.dataQuality).toBe('unknown');
      expect(result.gallery.entries[0].verdict).toEqual(synthetic.verdict);
      return;
    }
    const before = JSON.stringify(historicalWithBreakdown.verdict);
    const singleEntryGallery = { scannedAt: null, finishedAt: null, universe: 'test', entries: [historicalWithBreakdown] };
    const result = reexplainGallery(singleEntryGallery, '2026-09-25T00:00:00.000Z');
    expect(result.gallery.entries[0].breakdown?.dataQuality).toBe('unknown');
    expect(JSON.stringify(result.gallery.entries[0].verdict)).toBe(before);
    expect(result.stats.reverdicted).toBe(0);
  });
```

Run both test files.
Expected: FAIL (the type doesn't accept `'unknown'` yet; `reexplainGallery` doesn't stamp anything yet).

- [ ] **Step 2: Widen the `dataQuality` type**

In `src/engine/breakdown.ts`, widen `ExposureBreakdown['dataQuality']` one more time:

```ts
  dataQuality: 'measured' | 'partial' | 'unpriced' | 'unverified' | 'unknown';
```

Add one clause to the doc comment above it explaining `'unknown'`: it is never produced by `exposureBreakdown()` itself (which always resolves to one of the other four) - it exists only as a value `scripts/reexplain.ts` stamps directly onto old, frozen entries whose `breakdown` predates this field, meaning literally "no claim is made either way," not a fifth kind of measured uncertainty.

Run `grep -rn "dataQuality" src/ web/ test/ --include=*.ts --include=*.js` and check every place that reads or type-checks against this union (the same sweep an earlier task's spec reviewer already did once) to confirm nothing does an exhaustive switch that would now be incomplete - everything found in the prior cycle only ever checked `!== 'measured'`, which handles a 5th non-measured value automatically with no code change, but confirm this is still true today rather than assuming.

- [ ] **Step 3: Stamp `'unknown'` in `reexplain.ts`**

Read `scripts/reexplain.ts`'s two places that return an entry without running it through `words()`/`exposureBreakdown()`: the `if (e.superseded) { ...; return [e]; }` early return near the top, and the historical branch (`if (missing.length > 0) { const kept = {...}; return [{...kept, share: ...}]; }`). Add a small helper right above `reexplainGallery`:

```ts
/** Old entries never recomputed `dataQuality` at all - not even the safe
 * default, since the field simply did not exist yet when they were written.
 * `exposureBreakdown()` must not be run on them (a stale `hedgeCoverage` or
 * missing `unverifiedUsd` would produce a confidently wrong answer, not a
 * cautious one - see the 25.09 audit follow-up this fixes) - so this just
 * stamps the one honest value that makes no claim either way. */
function withUnknownDataQuality(e: Gallery['entries'][number]): Gallery['entries'][number] {
  if (!e.breakdown?.applies || e.breakdown.dataQuality !== undefined) return e;
  return { ...e, breakdown: { ...e.breakdown, dataQuality: 'unknown' } };
}
```

Apply it at both return points: change `return [e];` (the superseded branch) to `return [withUnknownDataQuality(e)];`, and change the historical branch's final return (`return [{ ...kept, share: shareCard(kept, { kind: 'gallery', snapshotId: kept.snapshotId }) }];`) to wrap `kept` through the helper before building `share` from it: `const stamped = withUnknownDataQuality(kept); return [{ ...stamped, share: shareCard(stamped, { kind: 'gallery', snapshotId: stamped.snapshotId }) }];` (so the share-card text, if it ever reads `dataQuality`, sees the stamped value too).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- breakdown reexplain`
Expected: PASS.

- [ ] **Step 5: Regenerate the bundled data**

Run `npm run reexplain` and `npm run reexplain -- data/featured.json`. Confirm both report `0` reverdicted/forked (this task changes no verdict logic). Confirm via a quick count (`grep -c '"dataQuality": "unknown"' data/gallery.json`) that some number of entries now carry the stamped value, and cross-check it roughly matches the count a prior review already established (15 entries across both files, split across historical and superseded) - if the count is wildly different, investigate before committing rather than assuming it's fine.

- [ ] **Step 6: Run the whole suite once more**

Run: `npm test && npm run typecheck && npm run test:runtime`.
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/engine/breakdown.ts scripts/reexplain.ts data/gallery.json data/featured.json test/engine/breakdown.test.ts test/reexplain.test.ts
git commit -m "fix: a frozen historical or superseded reading says its dataQuality is unknown, not measured"
```

---

## Task 5: A09 - a long's diagram shows its concentration instead of an empty pan

**Files:**
- Modify: `web/app.js` (`drawEmptyPan` - repurpose into a new function; `renderBreakdown`'s call site and caption)

**Context:** For a long position (spot cannot offset one, so the coverage scale never applies), the diagram currently draws a generic, address-independent empty pan with the caption "Spot cannot offset a long." That fact is true of every long and says nothing about this specific address. `positions.headlineShare` (share of the account's gross exposure the headline position represents) and `orders.coinsBothSides` (already the exact number the Bet rule's "no material two-sided quotes" check turns on) are both already computed and already on every reading - no new backend work needed.

- [ ] **Step 1: Read the current code**

Read `web/app.js`'s current `drawEmptyPan` function and `renderBreakdown`'s `isLong` branch (both read in full during this plan's own research; re-read them now to confirm exact current line numbers before editing, since two tasks earlier in this same plan may have shifted them slightly if they land first). Confirm `PositionFeatures.headlineShare` and `OrderFeatures.coinsBothSides` are the field names actually used elsewhere in this file (`grep -n "headlineShare\|coinsBothSides" web/app.js src/engine/features.ts`).

- [ ] **Step 2: Replace `drawEmptyPan` with a concentration bar**

The current function:

```js
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
  const finalY = wrapSvgText(svg, 'Spot cannot offset a long. Debts and other derivatives are not read here.', 0, capY, W, 12, 17, 'seg-label');
  svg.setAttribute('viewBox', `0 0 ${W} ${finalY + 12}`);
}
```

Replace with (reusing the same bar visual language `drawBookQuoting` already established, for consistency between the two non-scale diagram types):

```js
/** A long: spot cannot offset it, so the scale never applies - but "spot
 * cannot offset a long" is true of every long and says nothing about this
 * one. What is specific to this address: how much of its own gross exposure
 * this one position is, and whether anything two-sided was found anywhere
 * in the account. Both numbers already exist on every reading; nothing new
 * is computed here (25.09 audit, A09). */
function drawConcentration(svg, d, W) {
  const p = d.positions;
  const o = d.orders;
  const headlineUsd = p.headlineNotionalUsd || 0;
  const share = p.headlineShare || 0;
  const barY = 26;
  const barH = 30;
  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `${fmtUsd(headlineUsd)} ${p.headlineCoin} ${p.headlineSide}`));
  const filledW = Math.max(2, Math.min(1, share) * W);
  svg.append(svgEl('rect', { x: 0, y: barY, width: W, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 0.25, stroke: 'var(--line)', 'stroke-width': 1 }));
  if (filledW > 0) {
    svg.append(svgEl('rect', { x: 0, y: barY, width: filledW, height: barH, rx: 3, fill: 'var(--accent)', 'fill-opacity': 1, stroke: 'var(--line)', 'stroke-width': 1 }));
  }
  const capY = barY + barH + 22;
  const quoting = (o && o.coinsBothSides) || 0;
  const quotingText = quoting === 0
    ? 'No material two-sided quotes found anywhere in the account.'
    : `Two-sided quotes exist in ${plural(quoting, 'other market')}, not material against this position.`;
  const y1 = wrapSvgText(
    svg,
    `${fmtPct(share)} of the ${fmtUsd(p.grossUsd || 0)} gross exposure is this one position.`,
    0, capY, W, 12, 17, 'seg-label',
  );
  const finalY = wrapSvgText(svg, quotingText, 0, y1 + 20, W, 12, 17, 'seg-label');
  svg.setAttribute('viewBox', `0 0 ${W} ${finalY + 12}`);
}
```

- [ ] **Step 3: Update `renderBreakdown`'s call site and caption**

Find (in `renderBreakdown`):

```js
  } else if (isLong) {
    drawEmptyPan(svg, coin, side, headlineUsd, W);
  } else {
```

Change to:

```js
  } else if (isLong) {
    drawConcentration(svg, d, W);
  } else {
```

Find the caption logic right below (`$('breakdown-caption').textContent = isBook ? ... : b && b.elsewhere ? ... : ...`). Add an `isLong`-specific caption before the generic fallback:

```js
  $('breakdown-caption').textContent = isBook
    ? `What stands behind the ${coin} ${side}`
    : isLong
      ? `How concentrated the ${coin} ${side} is`
      : b && b.elsewhere
        ? `What stands against the ${coin} ${side} - and what only looks like it does`
        : `What stands against the ${coin} ${side}`;
```

- [ ] **Step 4: Confirm no other reference to `drawEmptyPan` remains**

Run `grep -n "drawEmptyPan" web/app.js` - expect zero matches after the rename. If `MAX_TILT_DEG`, `drawBeamAndPivot`, or `drawPan` are no longer used anywhere else in the file after this change, leave them in place regardless (they are still used by `drawScale` for the short/hedge case - confirm this by checking their other call sites, do not remove them).

- [ ] **Step 5: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green (no backend code touched, no test files touched - a pure frontend rendering change with zero unit test coverage in this project, same as every other diagram-drawing change in the prior cycle). A browser check happens in this plan's final verification task, not here.

- [ ] **Step 6: Commit**

```bash
git add web/app.js
git commit -m "feat: a long's diagram shows its concentration and quoting, not a generic empty pan"
```

---

## Task 6: A10 - every board row shows its own date

**Files:**
- Modify: `web/app.js` (`boardRow`)

**Context:** `loadGallery`'s "read between X and Y" summary line only covers the plain gallery scan's dates, not the featured readings mixed into the boards - so the text can say readings end on one date while a board actually contains a later one, and no individual board row shows when it was read at all. Fix: put the date on every row, matching the `checkedAt` field `GalleryRow` already carries.

- [ ] **Step 1: Read the current code**

Read `web/app.js`'s current `boardRow` function.

- [ ] **Step 2: Add the date to each row's meta line**

Current:

```js
function boardRow(e, board) {
  const li = el('li');
  const b = el('button');
  b.append(
    el('span', 'pos', positionText(e)),
    el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address)),
  );
```

Change the `row-meta` line to append the date:

```js
function boardRow(e, board) {
  const li = el('li');
  const b = el('button');
  b.append(
    el('span', 'pos', positionText(e)),
    el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address) + ' · ' + fmtTime(e.checkedAt)),
  );
```

- [ ] **Step 3: Update the boards section's own description**

Find where the boards section's general description is set (search for where `#boards-fold`'s content area or a caption near it is written - if there is no existing general-description text for the boards specifically, distinct from `#gallery-sub`'s scan-wide text, skip this step; if `#gallery-sub`'s text is shared between the flat list and the boards, read the prior cycle's Task 8 change to confirm whether the boards fold has its own description slot). If there is a natural place for it, add a short note that these are readings sampled at different times, matching the audit's own suggested framing ("Saved cases, sampled at different times") - keep this to one short sentence, do not restructure the section.

- [ ] **Step 4: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/app.js
git commit -m "fix: every board row shows its own date, not just the scan's overall range"
```

---

## Task 7: the first screen's hero numbers move up, share and check-another move together, book gets its numbers up front

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js` (`renderResult`, `renderBreakdown`'s caller context for the `subject` line, `share`/`nansen` reorder has no JS dependency - ids are unchanged)

**Context:** The audit's proposed card structure: position + recency, one-line verdict, two main numbers in separate visual areas, the labeled diagram, one caveat, Share plus a secondary "Check another," then everything else collapsed. This task reuses existing data and existing CSS wherever possible: the "two main numbers" reuse the existing `#decisive` tile styling (already built for exactly this - "the row the verdict turned on leads, rather than sitting fourth in a line of identical tiles") and the existing `elsewhere` funder data, repositioned and no longer suppressed when the diagram also shows; "Check another" is a new, backend-free scroll-and-focus action; the recency addition to the subject line and the share/nansen swap are small, contained edits. **This task depends on Tasks 3, 4 and 5 already being merged on this branch**, since it repositions code those tasks touch.

- [ ] **Step 1: Read the current code**

Read the CURRENT state of `web/index.html`'s `#card` div and `web/app.js`'s `renderResult` function in full before editing (both may have shifted slightly from earlier tasks in this same plan landing first).

- [ ] **Step 2: Add recency to the subject line**

In `web/app.js`, find (inside `renderResult`):

```js
  $('subject').hidden = !$('picker').hidden;
  $('subject').replaceChildren(
    el('span', 'muted', d.focus ? 'The position asked about' : 'The position'),
    ' ',
    el('strong', null, positionText(d)),
  );
```

Change to append the checked time:

```js
  $('subject').hidden = !$('picker').hidden;
  $('subject').replaceChildren(
    el('span', 'muted', d.focus ? 'The position asked about' : 'The position'),
    ' ',
    el('strong', null, positionText(d)),
    ' ',
    el('span', 'muted', '· checked ' + fmtTime(d.checkedAt)),
  );
```

- [ ] **Step 3: Make the decisive tile always show when there is one, not only when the diagram is hidden, and add the elsewhere number beside it**

Find (inside `renderResult`):

```js
  // The one piece of evidence the verdict turned on, when there is no
  // picture of it: the bar above already is that evidence for a short, and
  // repeating it as a number underneath would say it twice.
  const decisive = $('breakdown').hidden ? (d.evidence || []).filter((item) => item.decisive) : [];
  $('decisive').hidden = decisive.length === 0;
  $('decisive').replaceChildren(...decisive.map(tile));
```

Change to (the redesign's own premise is that this repetition is now intentional - the hero number gives the fact instantly, the diagram gives the visual backup right after it, matching the audit's explicit block 3 + block 4 split):

```js
  // The decisive number now leads the card on its own (25.09 audit, the
  // "hero numbers" redesign) - it is no longer suppressed when the diagram
  // also shows the same fact; the diagram is the backup, not the only copy.
  const heroTiles = (d.evidence || []).filter((item) => item.decisive);
  if (d.breakdown && d.breakdown.elsewhere) {
    heroTiles.push({
      label: 'Held elsewhere',
      value: fmtUsd(d.breakdown.elsewhere.usd) + ' in ' + plural(d.breakdown.elsewhere.wallets, 'wallet') + ' that funded this account',
      source: 'Nansen · ownership unverified',
      decisive: true,
    });
  }
  $('decisive').hidden = heroTiles.length === 0;
  $('decisive').replaceChildren(...heroTiles.map(tile));
```

(`tile` is the existing helper function defined a few lines above this block - confirm it is still in scope and unchanged; it already renders `.stat.decisive` styling when `item.decisive` is truthy, which is exactly what both the real decisive evidence items and this new synthetic `elsewhere` entry need.)

- [ ] **Step 4: Reorder the HTML - decisive moves before the diagram, share moves before nansen**

In `web/index.html`, find the `#card` div's current children order (read it fresh - it should currently be: `snapshot, subject, picker, badge, headline, summary, breakdown, open-question, nansen, share, decisive, coverage, limit, changed, card-canvas, meta, decided, details`, per the prior cycle's Task 8).

Cut the `#decisive` line:

```html
  <div class="stats" id="decisive" hidden></div>
```

Paste it immediately after `#summary` closes and before the `#breakdown` figure opens (i.e., right before `<figure class="breakdown" id="breakdown" hidden>`).

Then swap the order of `#nansen` and `#share` (cut the `#share` `<details>` block and paste it immediately before the `#nansen` `<details>` block, so `share` now comes first). After this step, `#card`'s child order should be: `snapshot, subject, picker, badge, headline, summary, decisive, breakdown, open-question, share, nansen, coverage, limit, changed, card-canvas, meta, decided, details`.

Do not change any `id`, class, or inner content of either moved block - pure repositioning, exactly like the prior cycle's Task 8.

- [ ] **Step 5: Add "Check another" beside Share**

Find the `#share` `<details>` element (after Step 4's move). Wrap it and a new button in a small flex container:

```html
  <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <details class="share" id="share">
      <summary>Share this reading</summary>
      <div class="actions">
        <button id="copy-link">Copy link</button>
        <button id="copy-post">Copy post text</button>
        <button id="copy-card">Copy image</button>
        <button id="download-card">Download image</button>
      </div>
    </details>
    <button id="check-another" style="border: none; background: none; color: var(--link); cursor: pointer; padding: 10px 4px;">Check another</button>
  </div>
```

(The inline styles here are deliberately minimal and match this file's own occasional use of inline `style` for one-off layout, e.g. the existing `<p style="margin: 10px 0 0;">` around the badge - if this file has a cleaner established convention for a small flex wrapper, use that instead of inventing inline styles; check for one before assuming inline is the right call.)

In `web/app.js`, add an event listener near the other button listeners (search for where `$('check-live')` or `$('copy-link')` listeners are attached, and add this near them):

```js
$('check-another').addEventListener('click', () => {
  $('address').focus();
  $('address').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
```

- [ ] **Step 6: Verify every id still resolves exactly once**

Same discipline the prior cycle's Task 8 used: grep `web/app.js` for every `$('...')` reference and confirm each still resolves to exactly one element in the edited `web/index.html`, with no duplicates and no dropped closing tags. Do this by hand, carefully - this is the highest-structural-risk task in this plan, same as Task 8 was in the prior one.

- [ ] **Step 7: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/app.js
git commit -m "feat: the decisive number and the funders' number lead the card, share and check-another sit together"
```

---

## Task 8: final verification of Tasks 1-7 in a browser, across more than one verdict type

**Files:** none (verification only)

**Context:** Task 7 specifically carries generalization risk the prior cycle's Task 8 did not (this one repositions the SAME hero-number logic across every verdict type, not just the flagship). Check across at least: the flagship funded-short (Unknown), the 97%-covered chip (Hedged), the market-maker chip (Book), and the HYPE-long bet chip (`looks_like_a_bet`, exercises Task 5's new concentration diagram and confirms the hero-numbers block gracefully shows nothing extra when there's no `elsewhere` data).

- [ ] **Step 1: Full automated suite**

```bash
npm test
npm run typecheck
npm run test:runtime
npm audit --omit=dev
```

- [ ] **Step 2: Em dash grep**

Scoped to every file this plan's tasks touched (list them explicitly, matching the prior cycle's Task 12 Step 2 pattern - do not blanket-scan `docs/`).

- [ ] **Step 3: Browser walkthrough**

Start the dev preview. For EACH of the four example chips (HYPE long/bet, HYPE short/97%, ETH short/funded, ETH short/market-maker):
1. Confirm the hero-numbers block (`#decisive`) shows above the diagram, with the right tile(s) - the funded-short case should show BOTH the coverage tile and the new "Held elsewhere" tile; the other three should show only what's genuinely decisive for their verdict (Hedged's coverage number; Book's matched-quoting number if marked decisive; the Bet case may show nothing here if nothing on that reading is marked `decisive`, which is a real, acceptable "no hero number" state, not a bug - confirm this by checking whether that reading's evidence array has anything with `decisive: true` before treating an empty hero block as wrong).
2. For the HYPE long/bet chip specifically: confirm the diagram now shows a concentration bar and quoting text (Task 5), not the old empty pan.
3. Confirm Share and "Check another" sit together, and "Check another" scrolls to and focuses the address field.
4. Confirm a board row (open "Show the ranked boards") shows its own date on at least one row (Task 6).
5. If any Unknown-verdict board row or recent-check chip is visible, confirm it shows a qualifier when the underlying reading has one (Task 3/A07) - cross-check against what the same reading's big card says when opened directly.
6. Confirm the subtitle/subject line under the badge shows "checked <time>" (Task 7 Step 2).

- [ ] **Step 4: Report**

Summarize what shipped, matching how the prior cycle's own final report was structured, and flag anything that looked wrong in the multi-verdict-type walkthrough specifically (this is the one thing a single-scenario check would not have caught).

---

## Task 9: A11 - refresh the four featured readings (spends real Nansen credits)

**Files:**
- Modify: `data/featured.json` (regenerated by `scripts/prescan.ts --refresh`, not hand-edited)
- Modify: `web/index.html` (the four example chip labels, only if a refreshed reading's headline number changed enough to make the existing label stale - compare before editing, do not edit reflexively)
- Modify: `README.md` (the "read on 24 September" / "made fresh on 24 September" references, if the refresh actually changes the effective date - see below)

**Context:** This is the one task in this plan that spends real Nansen API credits - do this LAST, after Tasks 1-8 are merged, so the refreshed readings reflect the final card presentation, matching the audit's own guidance ("перед финальной записью"). **Stop and confirm the exact scope with the user before running the paid step**, even though the broader item was already authorized - the user should see the concrete addresses and an approximate credit cost, not just the general category, before real money moves. This matches this project's own established practice around costly actions.

- [ ] **Step 1: Look up the exact addresses**

Read `data/featured.json`'s four current entries in full and extract their `address` fields (not just their `snapshotId`s) - the chips in `web/index.html` reference `data/featured.json` by `snapshotId`, but `scripts/prescan.ts --addresses=` needs the raw `0x...` addresses.

- [ ] **Step 2: Confirm the scope before spending anything**

State plainly, before running anything: the four addresses about to be re-checked, that each check costs up to 7 Nansen credits (`WORST_CASE_CALLS` in `scripts/prescan.ts`) so the worst case for four is 28, and that `.dev.vars` already has a working `NANSEN_API_KEY` (confirm this file exists and has the key before running - do not ask the user to regenerate one; if it is missing, stop and ask, per this project's own established policy of trying what's already configured before requesting anything new). If anything about this scope needs to change (different addresses, a lower/higher gap-ms), that is a decision for the user, not something to guess.

- [ ] **Step 3: Run the refresh**

```bash
npx tsx scripts/prescan.ts --refresh --addresses=<the four 0x... addresses from Step 1, comma-separated> --out=data/featured.json --source=featured-2026-09-25 --universe="Readings picked to show each kind of answer" --supersede-from=data/gallery.json --gap-ms=3000
```

Watch the printed per-address log lines as they run (verdict, decisive evidence value, calls spent, credits left) - this is a real, live, sequential run, not a batch job to fire and forget.

- [ ] **Step 4: Verify each refreshed reading still illustrates its intended scenario**

For each of the four, confirm the NEW reading's verdict still matches what that chip claims (HYPE long → still `looks_like_a_bet`; HYPE short → still `hedged`; ETH short → still `unknown`/funded; ETH short market-maker → still `book`). If any one of them no longer fits (the account closed the position, the verdict flipped, coverage moved out of a clean illustrative range), **stop and report this rather than silently keeping the stale label or picking a replacement address yourself** - per the audit's own guidance, finding a new illustrative address is a real editorial decision, not something to automate.

- [ ] **Step 5: Update chip labels if the headline numbers changed enough to matter**

Read `web/index.html`'s four `data-example` chip buttons. If a refreshed reading's headline size, coverage percentage, or `snapshotId` changed enough that the existing label text would now be wrong or misleading (e.g. "$41.8M HYPE short · 97% covered" where the real number moved to 85%), update the label text and the `data-example` attribute to the new `snapshotId`. If the numbers are close enough that the existing label still reads true, leave it - do not edit reflexively.

Check `test/featured.test.ts` (referenced in `web/index.html`'s own comment: "test/featured.test.ts holds these chips to that file") - if chip `snapshotId`s changed, this test will need updating too; read it first to see exactly what it asserts.

- [ ] **Step 6: Update any "read on 24 September" references that are now wrong**

Search `README.md` and `web/index.html` for "24 September" (`grep -rn "24 September" README.md web/index.html`). If the refresh changed the effective date these readings represent, update these references to the new date - but only the ones that actually describe the featured readings' own recency, not unrelated historical mentions (e.g. the audit trail in `docs/audits/` must stay untouched, matching this whole plan's established policy on historical records).

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run typecheck && npm run test:runtime`.
Expected: all green - confirm in particular that `test/featured.test.ts` and anything asserting exact counts against `data/featured.json` still pass or were correctly updated in Step 5.

- [ ] **Step 8: Re-render OG pictures**

Since this changes real reading data (and this plan's Task 7 also changed the card layout), run the project's own pre-deploy step: `node --import tsx scripts/prerender-og.ts --upload`, matching `docs/submission-checklist.md`'s own instruction to do this "after every deploy that changes the picture's layout."

- [ ] **Step 9: Commit**

```bash
git add data/featured.json web/index.html README.md test/featured.test.ts
git commit -m "chore: the four featured readings are refreshed, checked against today's presentation"
```

(Adjust the file list to match whichever files Steps 5-6 actually touched.)
