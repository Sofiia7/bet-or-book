# Nansen removal, stage 1: positions from every Hyperliquid dex

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A check reads the account's positions from Hyperliquid itself, dex by dex (main dex plus every named HIP-3 dex), instead of from Nansen's `perp-positions`. Everything else Nansen supplies (PnL, balances on other chains, funding links) is untouched and is removed in later stages.

**Architecture:** A new `src/sources/positions.ts` lists the dexes (`perpDexs`, cached in KV for an hour), asks `clearinghouseState` once per dex in parallel, and returns the merged positions with an honest coverage: `complete` only when every dex answered. `observe()` receives this through an injectable `readPositions` option (default: the direct reader), the Worker passes a 60-second KV-cached reader. Nansen keeps only PnL, other-chain balances and funding links. New readings carry `positionsVenues`; readings stored before this change do not, and keep their old wording.

**Tech Stack:** TypeScript, Cloudflare Workers + KV, vitest. Hyperliquid public info API (`https://api.hyperliquid.xyz/info`), no key.

**Spec:** `docs/superpowers/specs/2026-10-20-redesign-and-nansen-removal-design.md`. Full migration plan (local only, git-excluded): `docs/internal/NANSEN_REMOVAL_PLAN_2026-10-14.md`. Later stages (holdings, funding links, PnL, budget, presentation, tests, examples) get their own plans after this one lands.

## Global Constraints

- No production deploy until the Colosseum results unless the owner says otherwise. Work in branch `remove-nansen` (create it from `main` at the start; tag `nansen-last` on the current `main` first).
- Verdict logic (`computeVerdict`, 22 reason codes) is unchanged. Only inputs and wording change.
- Saved readings, `data/featured.json` and the 307 gallery entries are never rewritten. A stored reading without `positionsVenues` must explain exactly as before.
- Honest limits stay: a rule that claims absence needs a complete read of the source it speaks about; `positionsCoverage` is `complete` only if every dex answered.
- Hyperliquid info limit is 1200 weight per minute per IP (`clearinghouseState` weighs 2, `perpDexs` 20): cache the dex list, honour `retry-after`, one retry.
- Tests never touch the network and never spend Nansen credits. Dev checks use `fetch` stubs.
- Repo docs and code comments are English. Plain hyphens only, never the long dash, in code, comments, docs and commit messages.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises (each has its test in the task named). The line about stored readings is numbered last.

1. One named dex answers 503, times out or answers 200 with junk: the reading is `partial`, positions from the other dexes still show, the note names the dex, the verdict falls to Unknown through `positions_not_complete` (Tasks 2, 5).
2. `perpDexs` is unreadable or malformed: main dex only, coverage `partial`, a note says positions on named dexes are not included (Task 2).
3. The main dex is unreadable: the check rejects like a failed orders read, it does not answer with an empty account (Tasks 2, 5).
4. An address with no positions on any dex: `complete`, zero positions, "No open positions were found in this reading", never `partial` (Task 2).
5. A check on the Workers Free plan may make at most 50 outbound requests: with 11 dexes the worst case must stay under it (Task 5).
6. A reading stored before this change (`source: 'nansen'`, no `positionsVenues`) still gets its old evidence labels and its old "What Nansen added" text (Tasks 4, 6).

## File Structure

- Create `src/sources/positions.ts`: `AllDexPositions`, `PositionsReader`, `readAllDexPositions`, `reusePositions` (replaces `src/sources/reusePositions.ts`, deleted in Task 5).
- Modify `src/sources/hyperliquid.ts`: `dex` on `clearinghouseState`, `getPerpDexNames`, one retry in `postInfo`.
- Modify `src/engine/observation.ts`, `src/engine/interpret.ts`, `src/engine/evidence.ts` (Task 4), then `src/api/observe.ts`, `src/sources/nansen.ts`, `src/sources/stagedNansen.ts`, `src/index.ts` (Task 5): the switch.
- Modify `src/engine/nansenContribution.ts`: new-style wording for readings that carry `positionsVenues`.
- Modify `web/app.js` (+ regenerated `web/app.min.js`), `README.md`, `docs/architecture.md`.
- Create `test/support/positions.ts`: `allDexFrom(...)` helper that turns the existing Nansen-shaped synthetic positions into an `AllDexPositions`, so the ~70 check-level tests keep their data.

---

### Task 1: Hyperliquid client - `dex` parameter, dex names, one retry

**Files:**
- Modify: `src/sources/hyperliquid.ts` (`getClearinghouseState`, `postInfo`, new `getPerpDexNames`)
- Create: `test/fixtures/hyperliquid/perp-dexs.json`, `test/fixtures/hyperliquid/abraxas/clearinghouse-xyz.json`
- Test: `test/sources/hyperliquid.test.ts`

**Interfaces:**
- Produces: `getClearinghouseState(user: string, signal?: AbortSignal, dex?: string): Promise<HlClearinghouseState>` (the `dex` argument is appended so existing callers keep working; an empty or absent `dex` omits the field from the request body); `getPerpDexNames(signal?: AbortSignal): Promise<string[]>` returning the named dexes in registry order (the main dex `null` entry is skipped).

- [ ] **Step 1: Branch and tag.** `git tag nansen-last main` then `git switch -c remove-nansen`.
- [ ] **Step 2: Capture real fixtures** (public, read-only, no key). `perp-dexs.json`: POST `{"type":"perpDexs"}`. `abraxas/clearinghouse-xyz.json`: POST `{"type":"clearinghouseState","user":"0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36","dex":"xyz"}`. Pretty-print with 2 spaces. Verified on 2026-10-20: 11 entries (first is `null`, then `xyz flx vntl hyna km abcd cash para mkts io`), and the `xyz` answer carries coins prefixed `xyz:` (`xyz:GOLD`, `xyz:MU`, `xyz:STRC`).
- [ ] **Step 3: Write failing tests** in `test/sources/hyperliquid.test.ts`:
  - `sends dex only when one is named`: `getClearinghouseState('0xt')` body equals `{type:'clearinghouseState',user:'0xt'}`; with `(…, undefined, 'xyz')` body equals `{type:'clearinghouseState',user:'0xt',dex:'xyz'}`.
  - `parses a named-dex clearinghouse answer from a real capture`: mock the xyz fixture; `normalizePositions(state)` (from `src/sources/normalize`) yields coins that all start with `xyz:`.
  - `getPerpDexNames skips the main dex and keeps registry order`: mock `perp-dexs.json`; expect `['xyz','flx','vntl','hyna','km','abcd','cash','para','mkts','io']`.
  - `getPerpDexNames rejects a malformed registry` (mock `{}`, and an array holding one entry without a valid `name`): rejects.
  - `getPerpDexNames ignores fields other than the name` (a venue with a missing `deployer`): still returns its name.
  - `retries once on 429 using retry-after`: first answer 429 with `retry-after: 0`, second 200; the call resolves and `fetch` was called twice.
  - `does not retry twice`: 429 twice rejects, `fetch` called twice.
  - `does not retry when the signal is already aborted`.
- [ ] **Step 4: Run** `npx vitest run test/sources/hyperliquid.test.ts` - expect the new tests FAIL.
- [ ] **Step 5: Implement.** `getClearinghouseState` adds `dex` to the body when non-empty. `getPerpDexNames` calls the existing `getPerpDexRegistry` and reads only the names: the answer must be an array, `null` entries (the main dex) are skipped, every other entry must be an object whose `name` matches `/^[a-z0-9_-]{1,32}$/i`, and any entry that is not throws (an unreadable list is `partial` coverage, never a silently shorter list). It deliberately does not use `parsePerpVenues`: that parser also validates `deployer` and `oracleUpdater`, which names do not need, and one odd field on one venue would otherwise make every reading partial. In `postInfo`, after a non-ok answer with status 429, 502, 503 or 504 and an unaborted signal, wait `retry-after` seconds (default 0.25 s, skip the retry if the wait exceeds 2 s) and send the request once more; the second failure throws the existing `hyperliquid <type> failed: <status>` error.
- [ ] **Step 6: Run** the same file - expect PASS. Then `npm run typecheck`.
- [ ] **Step 7: Commit** `feat: read clearinghouseState per dex, list dex names, retry once on 429`.

---

### Task 2: `positions.ts` - read every dex

**Files:**
- Create: `src/sources/positions.ts`
- Test: `test/sources/positions.test.ts`

**Interfaces:**
- Consumes: Task 1's `getClearinghouseState(user, signal, dex)` and `getPerpDexNames(signal)`; `normalizePositions` from `src/sources/normalize`; `KVLike` from `src/kv`; `SourceCoverage` from `src/engine/verdict`; `Position` from `src/types`.
- Produces:

```ts
export interface AllDexPositions {
  positions: Position[];          // main dex first, then named dexes in registry order
  coverage: SourceCoverage;       // 'complete' only when every asked dex answered and the registry was read
  measuredAt: number | null;      // the OLDEST `time` among the answers, ms; null when none carried one
  venues: { asked: number; answered: number; registryRead: boolean }; // main dex counts as one
  failed: string[];               // named dexes that did not answer or answered with a wrong shape
  mainDexCount: number;           // positions on the main dex alone
  mainState: HlClearinghouseState; // raw main-dex answer, for the account vitals
}
export type PositionsReader = (address: string, signal?: AbortSignal) => Promise<AllDexPositions>;
export function readAllDexPositions(address: string, opts?: { signal?: AbortSignal; kv?: KVLike }): Promise<AllDexPositions>;
```

- [ ] **Step 1: Write failing tests** in `test/sources/positions.test.ts` (stub `global.fetch` by request body: `perpDexs`, and `clearinghouseState` keyed by `dex`; use the Task 1 fixtures plus tiny synthetic states):
  - `merges main and named dexes, main first, in registry order`; `venues` equals `{asked: 11, answered: 11, registryRead: true}`, `coverage` is `'complete'`, `mainDexCount` counts main only.
  - `an address with no positions anywhere is complete with zero positions` (every dex answers `assetPositions: []`).
  - `a named dex that answers 503 makes the reading partial and is named in failed` (`failed` equals `['xyz']`, the other dexes' positions are kept, `venues.answered` is 10).
  - `a named dex that answers 200 with junk counts as failed, not as a TypeError` (body `{}`).
  - `an unreadable registry gives main dex only, partial, registryRead false` (stub `perpDexs` 503; also malformed `{}`); `venues` equals `{asked: 1, answered: 1, registryRead: false}`.
  - `an unreadable main dex rejects` (stub main 503; named dexes fine): `await expect(...).rejects.toThrow()`.
  - `measuredAt is the oldest time among the answers`.
  - `an abort signal that fires mid-read rejects instead of returning a partial claim of complete`.
  - `caches the dex names in KV for an hour and reuses them`: with `FakeKV` (`test/support/fakeKv.ts`), first call does a `perpDexs` request, second does not; a malformed cached value is ignored and refetched; a failed registry read is not cached.
- [ ] **Step 2: Run** `npx vitest run test/sources/positions.test.ts` - expect FAIL (module missing).
- [ ] **Step 3: Implement `readAllDexPositions`.** Fire the main-dex read and the registry read together; then read each named dex with `Promise.allSettled` (all in parallel, each already bounded by the client's own timeout). The main-dex read failing rejects the whole call. A named dex counts as answered only if its `normalizePositions` succeeds. Registry names are cached under KV key `perp-dex-names:v1` with `expirationTtl: 3600`, only after a successful parse; any KV error is ignored. `coverage` is `'complete'` iff `registryRead` and `failed.length === 0`.
- [ ] **Step 4: Run** the file - expect PASS. `npm run typecheck`.
- [ ] **Step 5: Commit** `feat: read positions from every Hyperliquid dex`.

---

### Task 3: `reusePositions` wraps the reader

**Files:**
- Modify: `src/sources/positions.ts` (add `reusePositions`)
- Test: `test/sources/positions.test.ts`

**Interfaces:**
- Consumes: `PositionsReader`, `AllDexPositions` (Task 2).
- Produces: `reusePositions(read: PositionsReader, kv: KVLike, now?: () => number): PositionsReader` - same 60-second window and KV TTL as the old Nansen wrapper, key `source-positions:v2:<address>`. The old `src/sources/reusePositions.ts` stays untouched until Task 5, so the tree compiles after every task.

- [ ] **Step 1: Failing tests** (port the old test and add three): `reuses a complete read for 60 seconds and re-reads after` (with `FakeKV` and an injected clock, as the old test does); `never caches a partial read` (the second call reads again); `ignores a cached entry that is not an AllDexPositions` (e.g. `{at, data: {}}`); `a KV failure does not block a live read`.
- [ ] **Step 2: Run** `npx vitest run test/sources/positions.test.ts` - expect FAIL.
- [ ] **Step 3: Implement**, carrying over the logic of the old file but caching only `coverage === 'complete'`.
- [ ] **Step 4: Run** the file and `npm run typecheck` - expect PASS.
- [ ] **Step 5: Commit** `feat: cache the all-dex position read for a minute`.

---

### Task 4: Observation fields and the evidence label

**Files:**
- Modify: `src/engine/observation.ts`, `src/engine/interpret.ts` (`judged` list in `present`), `src/engine/evidence.ts` (`EvidenceInput`, `posSource`)
- Test: `test/engine/evidence.test.ts`, `test/engine/observation.test.ts`

**Interfaces:**
- Produces: `Observation.positionsVenues?: { asked: number; answered: number; registryRead: boolean }` (absent on readings made before this change); `EvidenceInput.positionsVenues` of the same type. Redefined doc comment on `Observation.source`: for readings that carry `positionsVenues` it is `'nansen'` when Nansen supplied any data to the reading (PnL, other-chain balances, funding links) and `'hyperliquid'` otherwise; for older readings it is where the positions came from, as before. `mainDexPositionCount` stays in the type and is still filled.

- [ ] **Step 1: Failing tests.** `evidence.test.ts`: `labels position tiles Hyperliquid when positionsVenues is present, even if source is nansen` and `still labels them Nansen for a stored reading without positionsVenues and source nansen` (this pins Review Focus 5). `observation.test.ts`: `a stored observation without positionsVenues still reads` (use an existing fixture reading).
- [ ] **Step 2: Run** - expect the first test FAIL.
- [ ] **Step 3: Implement**: add the optional field to `Observation`, copy it in `present()`'s `judged` list, add it to `EvidenceInput`, and set `posSource = input.positionsVenues ? 'Hyperliquid' : input.source === 'nansen' ? 'Nansen' : 'Hyperliquid'`.
- [ ] **Step 4: Run** `npx vitest run test/engine` - expect PASS.
- [ ] **Step 5: Commit** `feat: record which dexes a reading's positions came from`.

---

### Task 5: Switch `observe()` and the Worker to the Hyperliquid read

One atomic change: removing `perpPositions` from the Nansen client, its callers and its tests cannot be green apart from the switch itself. The suite is expected to be red only between Step 2 and Step 4.

**Files:**
- Modify: `src/api/observe.ts`, `src/sources/nansen.ts` (remove `perpPositions` from `NansenClient` and `createNansenClient`; keep the `NansenPerpPositions` type and `normalizeNansenPositions` only while the test helper below needs them), `src/sources/stagedNansen.ts`, `src/index.ts`, `scripts/prescan.ts` and `scripts/refresh-featured.ts` (only if they reference the removed method)
- Delete: `src/sources/reusePositions.ts`, `test/sources/reusePositions.test.ts`
- Create: `test/support/positions.ts`, `test/api/positions-coverage.test.ts`
- Modify tests: `test/api/check.test.ts`, `check-coverage.test.ts`, `check-golden.test.ts` (+ `__snapshots__/check-golden.test.ts.snap`), `check-upstream-shape.test.ts`, `focus.test.ts`, `test/validation.test.ts`, `test/sources/nansen.test.ts`, `test/sources/stagedNansen.test.ts`, `test/audit-october.test.ts`, `test/routes.test.ts`, `test/support/worker.ts`, `test/runtime/*`

**Interfaces:**
- Consumes: `PositionsReader`, `readAllDexPositions`, `reusePositions`, `AllDexPositions` (Tasks 2-3); `Observation.positionsVenues` (Task 4).
- Produces: `ObserveOptions.readPositions?: PositionsReader` (default `(a, s) => readAllDexPositions(a, { signal: s })`, so `scripts/prescan.ts` and `scripts/refresh-featured.ts` keep working unchanged); `allDexFrom(positions: NansenPerpPositions, mainState: HlClearinghouseState, over?: Partial<AllDexPositions>): AllDexPositions` in `test/support/positions.ts` (runs the existing `normalizeNansenPositions`, `coverage: 'complete'`, `measuredAt` from `positions.timestamp`, `venues` `{asked: 1, answered: 1, registryRead: true}`, `failed: []`, `mainDexCount` = rows without a `dex:` prefix). In `src/index.ts`: `const readPositions = reusePositions((a, s) => readAllDexPositions(a, { signal: s, kv }), kv)` passed to `checkAddress`, and the Nansen client is no longer wrapped. `WORST_CASE_CALLS` is deliberately NOT changed (it over-reserves by one stage until the budget stage; settle returns the difference).

Behaviour changes in `observe()`:
- The always-fired free read `getClearinghouseState(address, signal)` is replaced by `readPositions(address, signal)` inside the same `Promise.all`; a rejection fails the check, exactly like `getOpenOrders`.
- `positions`, `positionsCoverage`, `measuredAt` come from it. For each name in `failed` add `note('Positions on the <dex> dex could not be read, so this reading may be missing positions there', true)`. If `!venues.registryRead` add `note('The list of Hyperliquid dexes could not be read: positions on named (HIP-3) dexes are not included', true)`.
- The Nansen block loses the `perpPositions` call and everything that handled its result: the 'Positions read from Hyperliquid alone' note, the 'Nansen positions ...' notes, the main-dex comparison. What remains: `nansen` non-null and in time -> read PnL (unless `includeContext === false`, which keeps its existing note); `nansen` non-null and out of time -> `note('This check ran out of time before it could read from Nansen', true)`; `nansen === null` -> `note('Nansen not used<why>: no balances on other chains, no linked wallets', true)`. `budgetBlocked` is now taken from any rejected Nansen stage (PnL, balances, related wallets), through the existing `budgetBlockReason`.
- Track `let nansenAnswered = false`, set true wherever a Nansen read returns a result that is normalised and used (PnL, balances, related wallets, funding context). The returned `source` is `nansenAnswered ? 'nansen' : 'hyperliquid'`.
- `positionsSource` for vitals is always `'Hyperliquid'`. The account vitals that read `mainDexRes` read `positionsRead.mainState` instead.
- `mainDexPositionCount` is `positionsRead.mainDexCount`. Return `positionsVenues: positionsRead.venues`.
- The end-of-function summary note: drop the `Nansen positions` alternative from the `nansenFailures` pattern, drop the 'Positions read from Hyperliquid alone' removal, and make the three messages: budget-blocked -> `Nansen not used (<reason>): no balances on other chains, no linked wallets`; `!nansenAnswered` -> `Nansen did not answer this time. This reading is Hyperliquid-only: balances on other chains, PnL and funding links are missing. Try again in a minute.`; otherwise the existing "could not complete every read" text.

- [ ] **Step 1: Write the new tests first** in `test/api/positions-coverage.test.ts` (stub `fetch` by request body as in Task 2, other Hyperliquid routes from `test/fixtures/hyperliquid/abraxas/`): `check rejects when the main dex cannot be read`; `a failed dex yields partial coverage, a note naming the dex and positions_not_complete`; `a wrong-shape dex answer is a failed dex`; `an unreadable dex list yields main-dex positions and the HIP-3 note`; `an address with no positions anywhere is complete and says so`; `a reading carries positionsVenues, and source is hyperliquid when Nansen is off and nansen when PnL answered`; `Nansen being off adds no claim about the main dex only`; `a worst-case check stays under 50 outbound requests` (all 11 dexes answering, positions on three HIP-3 dexes, every Nansen stage enabled and answering; count the `fetch` calls and assert fewer than 50 - the Workers Free plan allows 50 subrequests per invocation and production runs on it). Run them: expect FAIL.
- [ ] **Step 2: Create `test/support/positions.ts` and migrate every `perpPositions` call site** in the listed tests: a fake Nansen client loses `perpPositions`, and `checkAddress(address, { nansen, readPositions: async () => allDexFrom(positions, abxClearinghouse), ... })` carries the positions. Where a test goes through `createNansenClient` plus `fetch` routing (`route()` in `check.test.ts`), drop the `profiler/perp-positions` route and add to the Hyperliquid stub `perpDexs` (the Task 1 fixture) and a `clearinghouseState` handler keyed by `body.dex` (main: `abraxas/clearinghouse.json`; `xyz`: Task 1's capture; every other dex: an empty state). Old tests that asserted on Nansen-position failure are superseded by Step 1's tests: delete them rather than bending them. In `nansen.test.ts`, `audit-october.test.ts` and `stagedNansen.test.ts` re-point each `perpPositions` case at `currentBalance` (same `post` path) so retry, timeout, refusal, request-id and credits-header coverage is kept; only the endpoint-specific case (`profiler/perp-positions` URL) is dropped. `test/support/worker.ts` and the runtime harness stubs must answer `perpDexs` and `clearinghouseState` with a `dex` (empty states for named dexes). Add to `routes.test.ts`: `the Worker answers a check with no Nansen positions request`.
- [ ] **Step 3: Implement** the `observe.ts`, `nansen.ts`, `stagedNansen.ts` and `index.ts` changes above; delete the old `reusePositions` module and its test.
- [ ] **Step 4: Run** `npx vitest run test/api test/validation.test.ts test/sources test/routes.test.ts test/audit-october.test.ts`. Golden snapshots will differ: regenerate with `npx vitest run test/api/check-golden.test.ts -u`, then read the whole `git diff` of the `.snap` field by field. Accepted differences are only those explained by this change (`source`, evidence `source` labels, `positionsVenues`, coverage notes, main-dex vitals). Any verdict change must be explained, or the task stops and reports it.
- [ ] **Step 5: Run** the full `npm test`, `npm run test:runtime` (if the Cloudflare test runtime cannot start on this machine, report that instead of skipping silently) and `npm run typecheck`; failures outside the files listed here are reported, not patched around.
- [ ] **Step 6: Commit** `feat: positions come from every Hyperliquid dex; Nansen no longer supplies them`.

---

### Task 6: "What Nansen added" for new readings

**Files:**
- Modify: `src/engine/nansenContribution.ts`
- Test: `test/engine/nansenContribution.test.ts`

**Interfaces:**
- Consumes: `CheckResponse.positionsVenues` (Task 4). `nansenContribution(r)` keeps its signature `(r: CheckResponse) => NansenContribution | null`.

Behaviour: when `r.positionsVenues` is undefined the function is byte-for-byte what it is today (every existing test keeps passing unedited). When it is defined:
- `r.source !== 'nansen'` (Nansen supplied nothing): `lead: 'not used for this reading'`, items: the existing "why" coverage line if any, then `"Positions are read from Hyperliquid dex by dex, which needs no Nansen. Balances on other chains and links between wallets were not read, so a hedge held off Hyperliquid is not visible."`.
- `r.source === 'nansen'`: no positions item and no bet-rule lead; items are only what Nansen supplied (other-chain balances, funding links, funding history, realized PnL, built by the existing code); `lead` is the existing lead from those parts, else `'context from other chains and funding history'`; if there are no items return `null`.

- [ ] **Step 1: Failing tests:** `new reading, Nansen not used: says positions need no Nansen and claims nothing about the main dex`; `new reading with other-chain balances: has no item starting with "Positions on every" and still has the balances item`; `new reading with only PnL: lead is the context fallback`; `new reading with no Nansen items returns null`; `a reading without positionsVenues is unchanged` (reuse an existing fixture).
- [ ] **Step 2: Run** - expect FAIL. **Step 3: Implement.** **Step 4: Run** the file - expect PASS, plus `npx vitest run test/engine`.
- [ ] **Step 5: Commit** `fix: stop crediting Nansen for positions it no longer supplies`.

---

### Task 7: Site wording and docs

**Files:**
- Modify: `web/app.js` (lines near 425-433 and 594; `web/app.min.js` regenerated by `npm run build:web`), `README.md` (line 32 "What Nansen added", the table row for `profiler/perp-positions` near line 87, the "What the Nansen data decides" table if it lists positions), `docs/architecture.md` (the source list, and the note that Hyperliquid reads the main dex only, if present)
- Test: `test/web-app-verdict-sync.test.ts`, `test/landing.test.ts`

- [ ] **Step 1: Failing tests:** extend `web-app-verdict-sync.test.ts` (or the nearest existing test that reads `web/app.js`) with: `the degraded-source warning no longer claims the main dex only` (no `main dex` or `main venue` string in `web/app.js` except the glossary entry in `index.html`), and `reading meta names Hyperliquid as the source of positions for a reading with positionsVenues`.
- [ ] **Step 2: Run** - expect FAIL.
- [ ] **Step 3: Implement.** `source-warning-text` when degraded and `d.source === 'hyperliquid'`: `Hyperliquid positions only · balances on other chains and linked wallets could not be read.` The `unavailable` branch: `Full live coverage is temporarily unavailable. This reading covers Hyperliquid positions only; balances on other chains and linked wallets were not read, so it does not settle the wallet's exposure.` Meta line: when `d.positionsVenues` is present, `positions from Hyperliquid, <answered> of <asked> dexes`; otherwise the existing wording (old readings). Keep the Nansen call count as it is. README and architecture: Nansen no longer supplies positions; positions come from `perpDexs` plus `clearinghouseState` per dex; the limit "does not see HIP-3 dexes" in any older wording is removed; the cross-dex claim (134 against 86) stays as a dated fact about the September reading.
- [ ] **Step 4: Run** `npm run build:web`, then `npm test` - expect PASS; include the regenerated `web/app.min.js` in the commit.
- [ ] **Step 5: Commit** `docs: positions come from Hyperliquid; update site wording`.

---

### Task 8: Verification against the real API

**Files:** none changed unless a defect is found.

- [ ] **Step 1:** `npm run typecheck`, `npm test`, `npm run test:runtime` all green.
- [ ] **Step 2: Live smoke, read-only** (public API): run a one-off script through `node --import tsx` (not committed) that calls `readAllDexPositions('0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36')` and prints `venues`, `coverage`, `failed`, positions per dex and `measuredAt`. Expect `coverage: 'complete'`, `venues.asked` equal to 1 plus the number of named dexes in `perpDexs`, and `xyz:`-prefixed coins among the positions. Time the call: expect well under the 45 s check deadline.
- [ ] **Step 3: Replay.** `.replay/` holds recorded Hyperliquid answers for 8 accounts; with `scripts/browser-replay.ts` (see its header) confirm the main-dex positions of each still match their recorded main-dex answer. If the script cannot run offline, say so and rely on Step 2.
- [ ] **Step 4:** `git diff --stat main...remove-nansen` and report: files changed, golden snapshot differences and why, anything skipped. Do not deploy.

## Execution record

Branch `remove-nansen`, executed 2026-10-20 to 2026-10-21. Tasks 1 to 7 were implemented and reviewed one by one; the verification below is Task 8, and the rest records what a later reader would otherwise have to dig out of the review files.

### (a) Task 8 results

- `npm run typecheck`: clean.
- `npm test`: 64 files, 789 tests passed. `npm run test:runtime`: 12 passed.
- Live read-only smoke on 2026-10-21 of `readAllDexPositions` (public Hyperliquid API, nothing written):
  - the Abraxas wallet `0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36`: coverage `complete`, 11 of 11 dexes answered, 32 positions (29 on the main dex, 3 on `xyz`), 1.7 s;
  - an empty account: `complete`, 0 positions, 0.8 s.
- Step 3 (replay through `.replay/` with `scripts/browser-replay.ts`) was not run. From the script itself: `scripts/browser-replay.ts` is a local UI fixture server that needs Wrangler running on port 8788 and answers checks with canned fixtures; it does not compare positions against recorded Hyperliquid answers, so it is not the tool for what the step asked. `.replay/` (git-ignored) holds a separate scratch harness, `replay-hl.ts`, over recorded answers; it was not used for this record.

### (b) Why the golden snapshots changed (Task 5)

`test/api/__snapshots__/` was regenerated (10 cases updated, 2 removed) and every field of old and new compared with a script rather than by the line diff. In no case did `verdict` (verdict, reasons, strength), `summary`, `source`, `degraded`, `breakdown`, `hedge`, `linkedHedge`, `pnl`, `orders` or `trades` change. The accepted differences:

1. Evidence and share-evidence `source` labels for position-derived items went from `Nansen` to `Hyperliquid` wherever a reading carries `positionsVenues`.
2. Vitals sources (Leverage, Distance to liquidation, Unrealized PnL, Funding since open) went from `Nansen` to `Hyperliquid`, since the positions are always Hyperliquid's.
3. `positionsVenues` was added everywhere: `{11,11,true}` on the paths that read every dex through routed answers, `{1,1,true}` where a case is handed positions through the `allDexFrom` test helper (a helper value, not a finding).
4. `mainDexPositionCount` changed: cases with made-up positions went from 14 (the Abraxas main-dex fixture count) to the number of their own rows without a dex prefix; the Nansen-off and deadline paths went from `null` to 14. Main-dex vitals are unchanged, since the main state is the same Abraxas capture.
5. Coverage notes on the two paths that used to fall back to the main dex: the Nansen-off note now reads `...: no balances on other chains, no linked wallets`, the deadline note reads `...before it could read from Nansen`, and "Positions read from Hyperliquid alone..." is gone; `share.limits` and `share.more` follow.
6. On those same two paths the reading no longer stops at the main dex: it reads all 11 dexes as the live Worker does, so Abraxas gains its three `xyz` positions (`xyz:GOLD` short, `xyz:STRC` long, `xyz:MU` long), `nPositions` goes 14 to 17, `positionsCoverage` `partial` to `complete`, and `grossUsd`, `netUsd`, `netToGross` and `headlineShare` move (share of exposure 43% to 41%). Headline (ETH short) and verdict (`unknown`, `positions_stale`) are unchanged.

One difference was not accepted: the case "a HIP-3 long whose dex will not answer for its orders" had pinned "HIP-3 venue registry unavailable" only because the old route never answered `perpDexs`. It now fails the registry on purpose (`route({ registry: 'fail' })`) so the registry-unavailable branch keeps its one test.

### (c) Measured request ceiling

The heaviest check today (a short headline on a HIP-3 dex, a position on every named dex, every Nansen stage reached) makes 47 outbound requests before retries: 39 Hyperliquid and 8 Nansen, against the Workers Free plan's 50 subrequests. Each additional named dex adds 1 request to every check and 3 to a check that holds a position there; each 429 or 5xx retry adds 1. A larger registry or a retry storm can therefore pass 50. Pinned by the test "the heaviest check today ... stays under 50 outbound requests" in `test/api/positions-coverage.test.ts`; stage 2 starts with a request budget.

### (d) Left open for later stages (deliberately not fixed in stage 1)

- The link-preview picture footer is hardcoded "Powered by Nansen API" (`src/engine/ogRender.ts:262`). Presentation stage; it must be fixed before any early ship of stage 1.
- Attribution of the share text, the downloaded card and the embed credits only Nansen when `source` is `nansen` (`src/publisher.ts:17`, `web/app.js:1206`, `web/share-card.js:192`). Presentation stage.
- `observe.ts:306` asks `perpDexs` a second time, uncached (stage 2 request budget).
- `WORST_CASE_CALLS = 18` over-reserves (budget stage).
- The cache of dex names lives one hour, so a new dex is noticed up to an hour late, and a retired one keeps readings `partial` for that hour.
- `getPerpDexNames` accepts an empty or truncated registry (`[null]`) as complete.
- The Nansen client records each failed attempt as NO_ANSWER, and the Worker charges it a credit even when the request was never sent because of the subrequest limit.
- Not yet tested: whether `webData2` or a similar call returns positions on all dexes in one request.
- The dex-name regex lives in three places.
- `mainState` is typed more precisely than it is validated.
- The pilotWatch test no longer covers a charged job.
- README still says 717 tests.
- SECURITY.md, `docs/submission-materials.md` and `docs/demo-script.md` are rewritten in the final merge.
