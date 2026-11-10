# Nansen removal, stage 2: request budget and on-chain holdings - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A check never sends more outbound requests than the Workers Free plan allows, and reads the account's own and its funders' balances on Ethereum, Arbitrum and HyperEVM from public JSON-RPC nodes instead of Nansen.

**Architecture:** A per-check request budget is attached to the check's abort signal (`WeakMap<AbortSignal, RequestBudget>`), and every transport (Hyperliquid `postInfo`, the Nansen client, the new EVM `ethCall`) charges it before each send, retries included. Two structural cuts lower the worst case: market data is read only for the headline position's dex, and the dex registry read for positions is reused for market provenance. Holdings come from one Multicall3 `aggregate3` call per chain per wallet over the tokens of the asset registry (balances, decimals fixed in the registry, liquid-staking rates read in the same Ethereum call), priced with Hyperliquid's own mark prices; a new hedge scope `known-tokens` makes the card say exactly that.

**Tech Stack:** TypeScript, Cloudflare Workers (Free plan), Vitest, hand-written ABI encoding (no new runtime dependency).

**Spec:** `docs/superpowers/specs/2026-10-20-redesign-and-nansen-removal-design.md`, with the local migration plan `docs/internal/NANSEN_REMOVAL_PLAN_2026-10-14.md` (git-excluded, sections 2, 3.1 and 3.5) and the stage 1 Execution record in `docs/superpowers/plans/2026-10-20-nansen-removal-stage-1-all-dex-positions.md` (section (d) lists what this stage picks up).

## Global Constraints

- No production deploy and no merge to `main` before the Colosseum results; work on branch `remove-nansen` (it now contains the redesign, merged 2026-11-09).
- No Worker is deployed for testing. Verification is local tests plus read-only calls to public APIs. No Nansen credit is spent (no `.dev.vars` key is used; local runs pass `nansen: null`).
- Public repository: English only; plain hyphen `-`, never the long dash, in code, comments, docs and commit messages.
- Verdict rules (`computeVerdict`, 22 reason codes) do not change. Only inputs and wording change. Every golden snapshot difference is read field by field and explained by the change of source in the Execution record.
- Workers Free plan: 50 subrequests per invocation. Per the Cloudflare limits page read 2026-11-09: "A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1", with a separate row "Subrequests to internal services | 1,000", and "Each subrequest in a redirect chain counts against this limit". The check's own budget is therefore `CHECK_REQUEST_LIMIT = 45` external requests, leaving 5 for redirects and the Worker's own calls.
- Hyperliquid info: one retry on 429/502/503/504, honouring `retry-after` up to 2 s (as `postInfo` does today).
- Balance sources, decided by the owner on 2026-11-09: public nodes, no keys. Ethereum `https://ethereum-rpc.publicnode.com`, Arbitrum One `https://arbitrum-one-rpc.publicnode.com`, HyperEVM `https://rpc.hyperliquid.xyz/evm`. PublicNode terms (https://www.publicnode.com/terms): "You may access the Endpoints by automated means ... for development and production purposes" and "Blockchain data returned by the Endpoints is not Service Content. You may use it in your own applications and services, including displaying it to your users". Hyperliquid's EVM RPC: "Maximum of 100 EVM JSON-RPC requests per minute". Rejected: Alchemy (Terms of Service: "solely for your internal business purposes"), Zerion (API License Agreement: "Customer shall not archive or resell the Zerion Data"; readings are archived).
- Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` (3,808 bytes of code on all three chains, checked live 2026-11-09). Selectors: `aggregate3` `0x82ad56cb`, `getEthBalance(address)` `0x4d2301cc`, `balanceOf(address)` `0x70a08231`, `decimals()` `0x313ce567`, wstETH `stEthPerToken()` `0x035faf82`, rETH `getExchangeRate()` `0xe6aa216c`, cbETH `exchangeRate()` `0x3ba0b9a9`, weETH `getRate()` `0x679aefce`.
- Token decimals checked live 2026-11-09: WBTC (Ethereum and Arbitrum) and cbBTC 8; every other registry token 18. Rates that day: wstETH 1.2488, rETH 1.1754, cbETH 1.1437, weETH 1.1078 (18-decimal fixed point).
- One-call alternatives checked live 2026-11-09 and not usable: `webData2` returns main-dex positions only (30 for the Abraxas wallet, none from `xyz`); `allPerpMetas` returns one meta per dex but no asset contexts (no mark prices, no open interest); `clearinghouseState` and `metaAndAssetCtxs` answer HTTP 500 to `dex: "ALL_DEXS"`.
- Undocumented Hyperliquid behaviour is not relied on: `frontendOpenOrders` with `dex: "ALL_DEXS"` returned every dex's orders in a live test, but no Hyperliquid page documents it, so per-dex order reads stay.
- Saved readings, the 9 featured entries and the 307 archive entries are not rewritten; existing links keep working.

## Review Focus

- A node answering HTTP 200 with a JSON-RPC `error` object (rate limit, -32005) or with `result: "0x"` must count as that chain not read, never as "holds nothing". Test in Task 4.
- One token's sub-call failing inside `aggregate3` (`success: false`, or return data that is not 32 bytes) leaves that token unread: the chain's coverage is partial and the card says the cover is a floor. Test in Task 5.
- Raw balances far beyond 2^53 (HyperEVM native balances of 3.1e24 wei were seen live) must convert to amounts without throwing or rounding to zero. Test in Task 5.
- The request limit reached in the middle of the per-dex order reads: the dexes refused are named with the limit as the reason, orders coverage is partial, and "quotes nothing" is never said. Test in Task 3.
- Hyperliquid's main-dex market data missing (no mark price for ETH, BTC or HYPE): on-chain holdings come back unpriced with their amounts, never as zero, so the existing unpriced path withholds the verdict. Test in Task 5 and Task 7.

---

### Task 1: The request budget and charging in every transport

**Files:**
- Create: `src/requestBudget.ts`
- Create: `src/sources/retry.ts` (moved out of `src/sources/hyperliquid.ts`: `RETRY_STATUSES`, `RETRY_DEFAULT_WAIT_MS`, `RETRY_MAX_WAIT_MS`, `retryWaitMs`, `pause`, exported unchanged)
- Modify: `src/sources/hyperliquid.ts` (`postInfo`), `src/sources/nansen.ts` (`createNansenClient` inner `post`)
- Test: `test/requestBudget.test.ts`, `test/sources/hyperliquid-budget.test.ts`, add cases to `test/sources/nansen.test.ts`

**Interfaces:**
- Produces:
  - `export const CHECK_REQUEST_LIMIT = 45;`
  - `export const REQUEST_LIMIT_REASON = 'this check reached its limit of 45 outbound requests';` (built from the constant)
  - `export class RequestBudgetExceeded extends Error { readonly source: string; readonly limit: number }` with `message` = `` `request limit reached: ${source} not sent (${limit} per check)` ``
  - `export interface RequestBudget { readonly limit: number; used(): number; remaining(): number; take(source: string): void; affords(n: number, keep?: number): boolean }`
  - `export function createRequestBudget(limit?: number): RequestBudget`
  - `export function attachRequestBudget(signal: AbortSignal, budget: RequestBudget): void`
  - `export function requestBudgetOf(signal: AbortSignal | undefined): RequestBudget | null`
  - `export function chargeRequest(signal: AbortSignal | undefined, source: string): void` (no budget attached: does nothing)
  - `export function isRequestBudgetExceeded(err: unknown): err is RequestBudgetExceeded`

- [ ] **Step 1: Write the failing tests** in `test/requestBudget.test.ts`:
  - `take` counts: after 3 takes on a limit of 5, `used()` is 3 and `remaining()` 2; the 6th take throws `RequestBudgetExceeded` with `source` and `limit` set, and `used()` stays 5.
  - `affords(2, 1)` is true with 3 remaining and false with 2 remaining; `affords` never changes `used()`.
  - `chargeRequest(undefined, 'x')` and `chargeRequest(signalWithoutBudget, 'x')` do nothing; with a budget attached it takes from that budget only (two signals, two budgets, independent counts).
- [ ] **Step 2: Write the failing transport tests.** `test/sources/hyperliquid-budget.test.ts` (stub `global.fetch`):
  - a budget of 2 on the signal: `getSpotBalances` then `getOpenOrders` send 2 requests; a third read rejects with `RequestBudgetExceeded` and `fetch` was called exactly 2 times.
  - a 429 then a 200 with a budget of 2: one read succeeds and `used()` is 2 (the retry is charged).
  - a 429 with a budget of 1: the retry is not sent (`fetch` called once) and the read rejects with the ordinary `hyperliquid <type> failed: 429` error.
  - In `test/sources/nansen.test.ts`: a client created with a signal whose budget is exhausted rejects with `RequestBudgetExceeded`, `fetch` is never called, and the recorder receives no `NO_ANSWER` entry (a refused send must not be charged a credit; stage 1 record, section (d)).
- [ ] **Step 3: Run them to see them fail.** `npx vitest run test/requestBudget.test.ts test/sources/hyperliquid-budget.test.ts test/sources/nansen.test.ts` - FAIL (module not found / assertions).
- [ ] **Step 4: Implement** `src/requestBudget.ts` (a `WeakMap<AbortSignal, RequestBudget>`); move the retry helpers to `src/sources/retry.ts`; in `postInfo` call `chargeRequest(signal, 'hyperliquid')` before the first send, and send the retry only when `requestBudgetOf(signal)?.affords(1) ?? true`, charging it too; in the Nansen client call `chargeRequest(checkSignal, 'nansen')` before each `fetch` attempt, outside the `try` that records `NO_ANSWER`.
- [ ] **Step 5: Run** `npx vitest run test/requestBudget.test.ts test/sources` then `npm test` - all pass (no budget is attached anywhere yet, so nothing else changes).
- [ ] **Step 6: Commit** `git commit -m "feat: a per-check request budget that every Hyperliquid and Nansen send charges"`

### Task 2: Fewer requests - market data for the headline's dex only, one registry read

**Files:**
- Modify: `src/sources/hyperliquid.ts` (`getPerpDexNames` becomes a pure `dexNamesOf(raw: unknown): string[]` with the same lenient rules and throws; `getPerpDexRegistry` stays)
- Modify: `src/sources/positions.ts` (cache the raw registry instead of names; new `AllDexPositions.registry`)
- Modify: `src/api/observe.ts` (headline-dex metadata; provenance from `positionsRead.registry`)
- Test: `test/sources/positions.test.ts`, `test/api/positions-coverage.test.ts`, any test that asserts `hl:metaAndAssetCtxs:<dex>` for a non-headline dex

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export function dexNamesOf(raw: unknown): string[]` in `src/sources/hyperliquid.ts`
  - `AllDexPositions.registry: unknown[] | null` - the `perpDexs` answer the dex names were taken from this time (fresh or cached); null when it was not read
  - KV key `perp-dex-registry:v1` (TTL 3600 s) replaces `perp-dex-names:v1`; a cached value that is not an array, or from which `dexNamesOf` throws, is ignored and read fresh
  - `reusePositions`'s validator accepts an entry with `registry` absent, null or an array (an entry cached before this change reads as `registry: null`)

- [ ] **Step 1: Write the failing tests.**
  - `positions.test.ts`: `readAllDexPositions` returns `registry` equal to the stub's `perpDexs` answer; with a fake KV holding `perp-dex-registry:v1` it sends no `perpDexs` request and returns the cached array; a cached `{"not":"a list"}` is ignored and read fresh.
  - `positions-coverage.test.ts`, "a worst-case check stays under 50": replace the per-dex `hl:metaAndAssetCtxs:${dex}` expectations with: exactly one `metaAndAssetCtxs` with a `dex` field, for the headline's dex when it is a named dex, none when the headline is on the main dex; `hl:perpDexs` sent once.
  - The ceiling test ("the heaviest check today"): `expect(sent.all.filter((r) => r === 'hl:perpDexs')).toHaveLength(1)`, `metaAndAssetCtxs:xyz` present, no `metaAndAssetCtxs:<other named dex>`, and `expect(sent.all.length).toBe(37)` (29 Hyperliquid: five first-wave reads, the dex list, eleven position reads, the xyz market data, ten per-dex order reads, one book; plus 8 Nansen). If the measured number differs, find the read that accounts for it before changing the number.
  - `observe` with a stub registry: `marketProvenance` for an `xyz:` headline is built from `positionsRead.registry` (no second `perpDexs`); when the reader returns `registry: null` it falls back to `getPerpDexRegistry` (one request) as before.
- [ ] **Step 2: Run to see them fail.** `npx vitest run test/sources/positions.test.ts test/api/positions-coverage.test.ts`
- [ ] **Step 3: Implement.** In `observe`, pick the headline first with `computePositionFeatures(positions, mainMarks, opts.focus)` (main-dex marks from the first-wave `perpMeta`), then read `getPerpMetaAndAssetCtxs(signal, dex)` only for `dexOf(headlineCoin)` when it is not null, then compute `positionFeatures` with the merged marks as today. Only the headline uses a named dex's marks (`computePositionFeatures` reads `markPxByCoin` for the headline's liquidation distance, and keeps only main-dex keys for canonical names) and `contextByCoin` (headline vitals), so no other figure changes. Provenance uses `parsePerpVenues(positionsRead.registry ?? await getPerpDexRegistry(signal))`.
- [ ] **Step 4: Run** `npm test` - all pass; the golden snapshot is unchanged (`git diff --stat test/api/__snapshots__` empty apart from line endings).
- [ ] **Step 5: Commit** `git commit -m "perf: read market data for the headline's dex only and reuse the dex registry for provenance"`

### Task 3: The Worker attaches the budget; the check keeps its allowance for the reads that decide the verdict

**Files:**
- Modify: `src/index.ts` (the `/api/check` handler, next to `const timeout = AbortSignal.timeout(CHECK_DEADLINE_MS)`), `src/api/observe.ts`
- Test: `test/api/request-budget.test.ts` (new), `test/routes.test.ts`

**Interfaces:**
- Consumes: Task 1 (`createRequestBudget`, `attachRequestBudget`, `requestBudgetOf`, `isRequestBudgetExceeded`, `REQUEST_LIMIT_REASON`, `CHECK_REQUEST_LIMIT`); Task 2's headline-dex read.
- Produces: in `observe.ts`, `function ruleReserve(pendingOrderDexes: number, side: 'long' | 'short' | null, linksPossible: boolean): number` = `pendingOrderDexes + (side === 'short' ? HOLDINGS_RESERVE + (linksPossible ? LINKS_RESERVE : 0) : 0)`, with `const HOLDINGS_RESERVE = 3` (one request per chain for the account) and `const LINKS_RESERVE = 8` (2 funding-link chains + 2 funders x 3 chains); `linksPossible` is `opts.nansen !== null`. Copy fixed here:
  - descriptive skip (not a failure): `Market data for the ${dex} dex was not read: the check kept its remaining requests for the reads that decide the verdict` and `The order book mid was not read: the check kept its remaining requests for the reads that decide the verdict`
  - a rule read refused (failure): the read's existing failure note with the reason in place of "could not be read", for example `Resting orders on the ${dex} dex were not read: ${REQUEST_LIMIT_REASON}`
  - `budgetBlockReason(err)` returns `the check reached its request limit` for `RequestBudgetExceeded`, so a refused Nansen stage reads "Nansen not used (the check reached its request limit)" through the existing wording.

- [ ] **Step 1: Write the failing tests** in `test/api/request-budget.test.ts` (reuse the `stub`/`reply` helpers of `positions-coverage.test.ts` by moving them to `test/support/upstream.ts`):
  - "a registry of 20 named dexes, a position on each, stays within the limit": a synthetic `perpDexs` of 20 named dexes; `checkAddress` with a signal carrying `createRequestBudget()`; `expect(sent.all.length).toBeLessThanOrEqual(CHECK_REQUEST_LIMIT)`; `result.coverage` contains `REQUEST_LIMIT_REASON`; `result.ordersCoverage` is `'partial'`; `result.verdict.verdict` is not `'looks_like_a_bet'`.
  - "every Hyperliquid read answering 429 once stays within the limit": every first `api.hyperliquid.xyz` answer per request body is a 429 with `retry-after: 0`, the second a 200; `sent.all.length <= 45`.
  - "descriptive reads give way first": a short headline on `xyz` quoted on both sides, orders pending on two dexes, and a budget sized (count the stub's requests up to the book read) so that at the book read exactly `ruleReserve(...)` requests remain: the book mid is not read and its note says it was kept for the verdict, while both order reads and the holdings reads are sent.
  - "orders refused by the limit are named": a budget that runs out after the first of three per-dex order reads: the other two dexes are named with `REQUEST_LIMIT_REASON`, `ordersCoverage` is `'partial'`, and no coverage note says "No two-sided quoting found".
  - In `test/routes.test.ts`: a `POST /api/check` through `worker.fetch` with a 20-dex registry stub sends at most 45 upstream requests (count the stubbed `fetch` calls whose URL is not the Worker's own origin).
- [ ] **Step 2: Run to see them fail.** `npx vitest run test/api/request-budget.test.ts test/routes.test.ts`
- [ ] **Step 3: Implement.** `index.ts`: `attachRequestBudget(timeout, createRequestBudget())` right after the signal is made. `observe.ts`: `const budget = requestBudgetOf(opts.signal)`; before the headline-dex metadata read and before `getQuoteMid`, skip with the descriptive note when `budget && !budget.affords(1, ruleReserve(...))`; where an optional or rule read rejects, test `isRequestBudgetExceeded(err)` and write the limit wording instead of "could not be read".
- [ ] **Step 4: Run** `npm test` and `npm run test:runtime` - all pass; golden unchanged.
- [ ] **Step 5: Commit** `git commit -m "feat: a check stays within 45 outbound requests and says which reads the limit stopped"`

### Task 4: EVM calls - Multicall3 encoding and the JSON-RPC transport

**Files:**
- Create: `src/sources/evm.ts`
- Create: `scripts/fetch-onchain-fixtures.ts` (read-only capture; no key)
- Create: `test/fixtures/onchain/` (captured answers), `test/sources/evm.test.ts`

**Interfaces:**
- Consumes: Task 1 (`chargeRequest`, `requestBudgetOf`), `src/sources/retry.ts`.
- Produces:
  - `export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';`
  - `export const SELECTORS` with the eight selectors in Global Constraints, `as const`
  - `export interface Call3 { target: string; callData: string }` (always sent with `allowFailure: true`)
  - `export interface Call3Result { success: boolean; returnData: string }`
  - `export function encodeAggregate3(calls: Call3[]): string`
  - `export function decodeAggregate3(hex: string, expected: number): Call3Result[]` - throws `UpstreamShapeError` when the data is not valid hex, the offsets point outside it, or the count differs from `expected`
  - `export function withAddress(selector: string, address: string): string` (selector + 32-byte left-padded address)
  - `export function uint256Of(returnData: string): bigint | null` - null unless exactly 32 bytes
  - `export async function ethCall(url: string, to: string, data: string, signal?: AbortSignal): Promise<string>` - `eth_call` at `latest`, 10 s timeout combined with `signal`, `chargeRequest(signal, 'evm')` per send, one retry on `RETRY_STATUSES` when affordable; throws on HTTP failure, on a JSON-RPC `error` object, and on a `result` that is not `0x`-prefixed hex longer than `0x`

- [ ] **Step 1: Capture fixtures.** Write `scripts/fetch-onchain-fixtures.ts`: for the Abraxas address and its two funders (the `FUNDER_ARB` and `FUNDER_ETH` constants of `test/api/check.test.ts`) on each chain, build the registry call list (native balance through Multicall3 `getEthBalance`, `balanceOf` per registry token, and on Ethereum the four rate calls), send it with `ethCall`, and write `test/fixtures/onchain/<wallet>-<chain>.json` = `{ chain, url, capturedAt, calls, result }`. Run `node --import tsx scripts/fetch-onchain-fixtures.ts`; expected: 9 files, each `result` decodes to as many entries as `calls`.
- [ ] **Step 2: Write the failing tests** in `test/sources/evm.test.ts`:
  - round trip: `decodeAggregate3(<encoded result of 3 entries>, 3)` gives the three `{success, returnData}`; `encodeAggregate3` of two calls equals the exact hex from the live check script of 2026-11-09 (copy one captured `calls` list and the calldata it produced into the test).
  - every captured fixture decodes to `calls.length` entries, and `uint256Of` of each successful `balanceOf` is a bigint.
  - `decodeAggregate3('0x', 1)`, a truncated result and a count mismatch throw `UpstreamShapeError`.
  - `ethCall` with a stubbed `fetch`: a 200 `{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"rate limited"}}` rejects; a 200 `{"result":"0x"}` rejects; a 503 then a 200 resolves with the second result and charges 2; a budget of 0 rejects with `RequestBudgetExceeded` before any `fetch`.
- [ ] **Step 3: Run to see them fail.** `npx vitest run test/sources/evm.test.ts`
- [ ] **Step 4: Implement** `src/sources/evm.ts`.
- [ ] **Step 5: Run** `npx vitest run test/sources/evm.test.ts` then `npm test` - pass.
- [ ] **Step 6: Commit** `git commit -m "feat: Multicall3 encoding and an eth_call transport for public nodes, with captured answers"`

### Task 5: Holdings from the asset registry, priced with Hyperliquid marks

**Files:**
- Modify: `src/engine/assets.ts` (registry entries gain `symbol` and `decimals`)
- Create: `src/sources/onchain.ts`
- Create: `test/support/onchain.ts` (test-only RPC answering), `test/sources/onchain.test.ts`
- Modify: `test/engine/assets.test.ts` if it pins the registry shape

**Interfaces:**
- Consumes: Task 4 (`MULTICALL3`, `SELECTORS`, `encodeAggregate3`, `decodeAggregate3`, `withAddress`, `uint256Of`, `ethCall`), Task 1 (`isRequestBudgetExceeded`).
- Produces:
  - `assets.ts`: `KnownToken` gains `symbol: string; decimals: number`; `export function registryTokens(chain: string): Array<{ tokenAddress: string; symbol: string; decimals: number; underlying: string; lending: boolean }>` (native placeholder excluded); `export function nativeToken(chain: string): { symbol: string; underlying: string } | null` (`ethereum`, `arbitrum`: ETH; `hyperevm`: HYPE; others null); `export const NATIVE_PLACEHOLDER` (now exported). Symbols: WETH, aEthWETH, weETH, wstETH, stETH, rETH, cbETH, WBTC, cbBTC on Ethereum; WETH, wstETH, WBTC on Arbitrum; WHYPE on HyperEVM.
  - `onchain.ts`:
    - `export type HoldingsChain = 'ethereum' | 'arbitrum' | 'hyperevm';`
    - `export const HOLDINGS_CHAINS: readonly HoldingsChain[] = ['ethereum', 'arbitrum', 'hyperevm'];`
    - `export const RPC_URLS: Record<HoldingsChain, string>` (the three URLs in Global Constraints)
    - `export const CHAIN_NAMES: Record<HoldingsChain, string>` = Ethereum, Arbitrum, HyperEVM
    - `export interface UnderlyingPrices { ETH?: number; BTC?: number; HYPE?: number }`
    - `export function underlyingPricesFrom(markPxByCoin: Map<string, number>): UnderlyingPrices` (main-dex `ETH`, `BTC`, `HYPE` marks; non-finite or non-positive left out)
    - `export interface OnchainHoldings { holdings: SpotHolding[]; read: HoldingsChain[]; failed: Array<{ chain: HoldingsChain; reason: 'limit' | 'error' }>; unreadTokens: number }`
    - `export async function readOnchainHoldings(address: string, prices: UnderlyingPrices, signal?: AbortSignal): Promise<OnchainHoldings>`
  - Pricing: `valueUsd = amount * rate * prices[underlying]`, rate 1 except wstETH (Ethereum `stEthPerToken`, also used for Arbitrum wstETH), rETH, cbETH, weETH (their own rate calls). A holding whose price or rate is missing has `priced: false`, `valueUsd: 0` and keeps `amount`. Holding fields: `coin` = symbol, `source: 'onchain'`, `chain`, `tokenAddress` lowercase (native: `NATIVE_PLACEHOLDER`). Zero balances are left out. Amount conversion must not lose large values: divide the bigint by `10n ** BigInt(decimals - 6)` before `Number`, then by `1e6` (decimals are 8 or 18).
  - `test/support/onchain.ts`: `export function onchainAnswers(wallets: Record<string, Partial<Record<HoldingsChain, Record<string, number>>>>, opts?: { rates?: Partial<Record<'wstETH' | 'rETH' | 'cbETH' | 'weETH', number>>; failChains?: HoldingsChain[]; failTokens?: string[] }): (url: string, body: unknown) => Response | null` - decodes the `aggregate3` calldata it receives (target and selector per call), answers each call from the given whole-unit amounts (key: token address, or `native`), and returns null for a URL that is not one of `RPC_URLS`; `export function holdingsFromNansen(rows: NansenBalance[]): Partial<Record<HoldingsChain, Record<string, number>>>` - keeps only rows on the three chains whose `token_address` is a registry contract or the native placeholder.

- [ ] **Step 1: Write the failing tests** in `test/sources/onchain.test.ts` (route `fetch` through `onchainAnswers`):
  - a wallet with 2 ETH on Arbitrum, 10 wstETH on Ethereum and 1,000 HYPE on HyperEVM, ETH mark 2,500, HYPE mark 40, wstETH rate 1.2488: holdings are `ETH` 5,000 USD (arbitrum), `wstETH` 31,220 USD (ethereum), `HYPE` 40,000 USD (hyperevm), all `priced: true`, `read` is all three chains.
  - Arbitrum wstETH is priced with Ethereum's rate; with Ethereum failing it is `priced: false` with its amount, and `failed` is `[{ chain: 'ethereum', reason: 'error' }]`.
  - no ETH mark: every ETH-family holding is `priced: false` with its amount; nothing is dropped.
  - a token whose sub-call fails (`failTokens`): it is left out and `unreadTokens` is 1; the chain is still in `read`.
  - a native HyperEVM balance of `3102301130109341114501880` wei becomes `3102301.130109...` HYPE (to 6 decimals), not 0 and not an exception.
  - a budget that refuses the third chain: `failed` has `{ chain, reason: 'limit' }`.
  - zero balances produce no holding; exactly 3 `fetch` calls for one wallet.
  - the registry: `registryTokens('ethereum')` lists 9 tokens with WBTC and cbBTC at 8 decimals; `registryTokens('solana')` keeps working for the existing name-match code (its entries need `symbol`/`decimals` only to satisfy the type: SOL 9, wrapped SOL 9).
- [ ] **Step 2: Run to see them fail.** `npx vitest run test/sources/onchain.test.ts test/engine/assets.test.ts`
- [ ] **Step 3: Implement** the registry fields and `src/sources/onchain.ts` (the three chains read with `Promise.allSettled`, rates read inside the Ethereum call).
- [ ] **Step 4: Run** `npm test` - pass (nothing calls `readOnchainHoldings` yet).
- [ ] **Step 5: Commit** `git commit -m "feat: read registry token balances on Ethereum, Arbitrum and HyperEVM from public nodes"`

### Task 6: Wording for the new hedge scope `known-tokens`

**Files:**
- Modify: `src/engine/features.ts` (`HedgeScope`), `src/engine/evidence.ts`, `src/engine/observation.ts`, `src/engine/nansenContribution.ts` (only if a test below shows it must change)
- Test: `test/engine/evidence.test.ts`, `test/engine/observation.test.ts`, `test/engine/nansenContribution.test.ts` (or wherever `suppliedBesidesPositions` is tested)

**Interfaces:**
- Produces:
  - `export type HedgeScope = 'none' | 'hyperliquid' | 'all-chains' | 'known-tokens';` - `all-chains` stays for readings Nansen made; `known-tokens` is "Hyperliquid spot plus the registry tokens on Ethereum, Arbitrum and HyperEVM, read from public nodes".
  - `EvidenceSource` gains `'On-chain' | 'Hyperliquid + On-chain' | 'Nansen + On-chain'`.
  - Copy for `known-tokens`, fixed here:
    - search scope (`holdingsScope`): `among the tokens this tool recognises on Ethereum, Arbitrum and HyperEVM`
    - `where` in the bet and book-less summaries: `at this address on Hyperliquid or among the tokens this tool recognises on Ethereum, Arbitrum and HyperEVM`
    - `foundScope`: on-chain only `on Ethereum, Arbitrum or HyperEVM`; both `on Hyperliquid and on Ethereum, Arbitrum or HyperEVM`; Hyperliquid only `on Hyperliquid - the recognised tokens on Ethereum, Arbitrum and HyperEVM were checked and held none`
    - `hedgeSource`: nothing counted `Hyperliquid + On-chain`; on-chain only `On-chain`; both `Hyperliquid + On-chain`; Hyperliquid only `Hyperliquid`
    - `hedgeItem` parenthetical: `Ethereum, Arbitrum, HyperEVM`, `Hyperliquid + other chains` or `Hyperliquid spot`
    - `hedgeNotCheckedSummary` for a partial `known-tokens` read: `its holdings on some of Ethereum, Arbitrum and HyperEVM could not be read`
    - `linkedItem` source: `Nansen + On-chain` when `hedgeScope === 'known-tokens'` (links from Nansen, balances from nodes), else `Nansen`
  - `observation.ts` `missingForCurrentRules`: `hedge.unverifiedUsd` is required for `known-tokens` as for `all-chains`.

- [ ] **Step 1: Write the failing tests.** In `evidence.test.ts`, one `describe('known-tokens scope')` with a short whose cover is (a) zero, (b) all on-chain, (c) split, (d) all Hyperliquid spot, asserting the exact sentences and sources above; and that no sentence for a `known-tokens` reading contains "Nansen-supported". In `observation.test.ts`: a `known-tokens` short without `hedge.unverifiedUsd` lists it as missing. In the "What Nansen added" tests: a `known-tokens` reading lists nothing about balances on other chains under Nansen.
- [ ] **Step 2: Run to see them fail.** `npx vitest run test/engine`
- [ ] **Step 3: Implement** the type, the copy and the validation. Every existing `all-chains` sentence stays as it is.
- [ ] **Step 4: Run** `npm test` - pass; golden unchanged (no reading produces `known-tokens` yet).
- [ ] **Step 5: Commit** `git commit -m "feat: the card's wording for holdings read from public nodes"`

### Task 7: The check reads holdings from public nodes

**Files:**
- Modify: `src/api/observe.ts` (own holdings, `readLinkedHedge` funder balances, the Nansen-off note, the Nansen failure grouping, `hedgeScope`, the request reserve)
- Modify tests that route Nansen balances: `test/api/check.test.ts`, `test/api/check-coverage.test.ts`, `test/api/check-golden.test.ts` (+ snapshot), `test/api/positions-coverage.test.ts`, `test/api/request-budget.test.ts`, `test/api/focus.test.ts`, `test/api/check-upstream-shape.test.ts`, `test/audit-october.test.ts`, `test/routes.test.ts` where a short reaches the hedge search

**Interfaces:**
- Consumes: Task 5 (`readOnchainHoldings`, `underlyingPricesFrom`, `CHAIN_NAMES`, `HOLDINGS_CHAINS`), Task 6 (`known-tokens`), Task 3 (`ruleReserve`, limit wording), `test/support/onchain.ts`.
- Produces (behaviour and copy):
  - The own-holdings read no longer depends on Nansen: it runs when `hedgeMatters` (a short whose hedge can move the verdict) and time is left, whatever `opts.nansen` is. `hedgeScope` is `known-tokens` when it ran (any chain read), `hyperliquid` when it did not, `none` for anything but a short. `nansen.currentBalance` is no longer called anywhere (the method stays on the client until stage 3 removes the client).
  - `hedgeCoverage`: `complete` when all three chains were read and `unreadTokens === 0`; `missing` when none was read; otherwise `partial`.
  - Notes (exact copy):
    - scope, when the read ran (not a failure): `Balances on other chains: only the tokens this tool recognises (ETH, WETH, stETH, wstETH, rETH, cbETH, weETH, Aave WETH deposits, WBTC, cbBTC, HYPE, WHYPE) on Ethereum, Arbitrum and HyperEVM were read; other tokens and other chains were not`
    - a chain not read (failure): `Holdings on ${CHAIN_NAMES[chain]} could not be read`, or `Holdings on ${CHAIN_NAMES[chain]} were not read: ${REQUEST_LIMIT_REASON}`
    - unread tokens (failure): `${n} token balances on other chains came back unreadable and were left out, so the cover found there is a floor`
    - a holding unpriced for want of a Hyperliquid mark (failure): `Holdings on other chains could not be priced: Hyperliquid's ${coin} price was not read`
    - out of time before the read (failure, unchanged): `This check ran out of time before it could read holdings on other chains`
    - Nansen off: `Nansen not used${why}: no linked wallets` (was "... no balances on other chains, no linked wallets")
  - `readLinkedHedge`: each funder's balances come from `readOnchainHoldings(funder, prices, signal)`; a funder with no chain read counts as `failedFunder`, a funder with some chains or tokens unread as `truncatedFunder` (copy: `A funding wallet's holdings on some chains or tokens could not be read, so its holdings may be understated`, failure); the "first 100 tokens" sentence goes.
  - The Nansen failure grouping (`nansenFailures`) no longer matches holdings notes: holdings are not a Nansen read.
  - `ruleReserve` stays as Task 3 defined it: 3 for a short's own holdings, plus 8 when Nansen can still supply funding links.

- [ ] **Step 1: Migrate the routes first, behaviour still old.** In every test file above, add `onchainAnswers(...)` to the `fetch` stub (built with `holdingsFromNansen` from the same Nansen balance fixtures each route already uses, with the 2026-11-09 rates) so the new reads will have answers; keep the Nansen balance routes for now. Run `npm test` - pass.
- [ ] **Step 2: Write the failing tests** in `test/api/check.test.ts`:
  - "holdings are read from public nodes even when Nansen is off": `checkAddress(ABRAXAS short case, { nansen: null })` sends three RPC requests, `hedgeScope` is `known-tokens`, and the coverage carries the scope note and `Nansen not used ... : no linked wallets`.
  - "a short covered by wstETH on Ethereum reads Hedged": a synthetic short whose on-chain wstETH at the given rate and ETH mark covers it; the verdict reasons equal those the same cover gave through Nansen before (assert the reason code, `hedged`).
  - "one chain down makes the cover partial and says which": Arbitrum fails; `hedgeCoverage` is `partial`, the note names Arbitrum, the verdict is not a Bet.
  - "every chain down is missing": `hedgeCoverage` `missing`, the existing hedge-not-checked summary.
  - "no Nansen balance request is sent": the stub fails the test on any `profiler/address/current-balance` path.
  - "funders' balances come from public nodes": the two funders get 3 RPC requests each; `linkedHedge.funders` matches the funder fixture amounts at registry tokens only.
  - `positions-coverage.test.ts` ceiling: `expect(sent.all.length).toBe(41)` = 29 Hyperliquid + 3 Nansen (PnL and the two funding-link chains) + 9 RPC (3 own + 2 x 3 funders); keep `<= CHECK_REQUEST_LIMIT` as well.
- [ ] **Step 3: Run to see them fail.** `npx vitest run test/api`
- [ ] **Step 4: Implement** in `observe.ts`; then remove the Nansen balance routes the tests no longer need.
- [ ] **Step 5: Regenerate and read the golden.** `npx vitest run test/api/check-golden.test.ts -u`, then compare every case field by field with a script (as stage 1 did, section (b) of its record) and write each accepted difference into this plan's Execution record (b). Expected kinds of difference: `hedgeScope` `all-chains` to `known-tokens`; holdings on chains or contracts outside the registry gone (plasma, BNB, Base, Monad, Avalanche, XAUT, USDC and the like); values from Hyperliquid marks and node rates instead of Nansen prices; sources and sentences per Task 6; the Nansen-off note. Any verdict or reason change must be traced to one of these, or it is a bug.
- [ ] **Step 6: Run** `npm run typecheck`, `npm test`, `npm run test:runtime` - pass.
- [ ] **Step 7: Commit** `git commit -m "feat: holdings on Ethereum, Arbitrum and HyperEVM come from public nodes, not Nansen"`

### Task 8: Live check, records and the spec

**Files:**
- Create: `scripts/smoke-holdings.ts` (read-only; no key; no Worker)
- Modify: this plan (Execution record), `docs/superpowers/specs/2026-10-20-redesign-and-nansen-removal-design.md` (Decisions)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Live smoke.** `scripts/smoke-holdings.ts`: (a) `readOnchainHoldings` for Abraxas and both funders against the real nodes with marks from a live `metaAndAssetCtxs`; print per wallet the chains read, holdings and USD totals; (b) `checkAddress(ABRAXAS, { nansen: null, signal })` with a budget attached, printing verdict, `hedgeScope`, `hedgeCoverage`, coverage notes and the count of requests per host (wrap `fetch` to count). Run `node --import tsx scripts/smoke-holdings.ts`. Expected: no request to `api.nansen.ai`; total requests <= 45; every chain read; the funders' ETH-family totals of the same order as the September Nansen fixtures (they are live now, so not equal).
- [ ] **Step 2: Records.** Fill this plan's Execution record: test counts, the smoke output (no addresses beyond those already in fixtures), the golden explanation, the measured ceiling, and what is left for stage 3. Add to the spec's Decisions: the balance-source decision with the three terms quotes from Global Constraints, the rejected providers with their quotes, and that the `unrecognised_assets` pocket for unknown contracts and other chains is no longer reachable from on-chain reads (the card says which tokens and chains were read).
- [ ] **Step 3: Run** `npm run typecheck`, `npm test`, `npm run test:runtime`, `npx wrangler deploy --dry-run` (bundle size within the Free plan's 3 MiB gzip) - pass.
- [ ] **Step 4: Commit** `git commit -m "docs: stage 2 execution record; balance sources and their terms in the spec"`

## Left for stage 3 (not in this plan)

Funding links from the Hyperliquid ledger and explorers instead of Nansen `related-wallets`; PnL from `portfolio`; removing the Nansen client, `stagedNansen`, the credit budget wiring and `WORST_CASE_CALLS`; the observation schema bump and `source` values; the link-preview footer "Powered by Nansen API" (`src/engine/ogRender.ts`) and share/embed attribution; re-reading the four featured examples; README, SECURITY.md and submission documents.

Also for stage 3, found by the final whole-branch review:

- The share, embed and picture attribution keyed on `source` (`src/publisher.ts:17`, `web/app.js:1608`, `web/share-card.js:192`, `src/engine/ogRender.ts:262`) is wrong both ways for new readings (Nansen is credited with balances that public nodes read, and left out where it supplied the links). It must be fixed before any deploy.
- `README.md:107` ("the card says how much was left out") is no longer true for node-read readings.
- The unpriced-registry wording ("could not be identified", `src/engine/evidence.ts:467-481`, `src/engine/openQuestion.ts:60-62`) now also covers a missing Hyperliquid mark or a failed staking-rate read.

## Execution record

### (a) Results

Commits on `remove-nansen`: 535bb56 (start) to e536cca (Task 7 with its fix round), then this task. Verification at the end of Task 8, on the tree at e536cca plus the smoke script: `npm run typecheck` clean (both tsconfigs); `npm test` 74 files, 1203 tests, all passed; `npm run test:runtime` 2 files, 12 tests, all passed; `npx wrangler deploy --dry-run` built (it exits at "--dry-run: exiting now" and uploads nothing): total upload 5949.04 KiB, gzip 2137.88 KiB, inside the Free plan's 3 MiB gzip.

Live smoke, `node --import tsx scripts/smoke-holdings.ts` on 2026-11-09 (read-only: Hyperliquid's info endpoint and the three public nodes; `nansen: null`; no key read; the wrapped `fetch` counts requests per host). Marks from the live main-dex `metaAndAssetCtxs`: ETH 2124.4, BTC 74644.7, HYPE 74.606.

Part (a), `readOnchainHoldings`, one Multicall3 call per chain per wallet:

| Wallet | Chains read | Failed | Unread tokens | ETH family | BTC family | HYPE |
|---|---|---|---|---|---|---|
| Abraxas | Ethereum, Arbitrum, HyperEVM | none | 0 | $464.28 | none | $74.60 |
| Arbitrum funder | all three | none | 0 | $6,779.94 | $0.15 | none |
| Ethereum funder | all three | none | 0 | $145,568,748.44 (of which weETH $145,559,808.23) | $249.46 | $173.52 |

Every holding came back priced. Part (a) sent 1 Hyperliquid request and 3 requests to each of the three node hosts (10 in all, one call per chain per wallet).

Part (b), `checkAddress(ABRAXAS, { nansen: null, signal })` with a budget attached: verdict `unknown`, reasons `["linked_holdings_not_checked"]`, `hedgeScope` `known-tokens`, `hedgeCoverage` `complete`, `linkedHedgeCoverage` `missing`. Coverage notes: "Nansen not used (smoke script): no linked wallets" (failure); "No two-sided quoting found on the venues checked ..."; the scope note naming Ethereum, Arbitrum and HyperEVM. Requests: api.hyperliquid.xyz 18, ethereum-rpc.publicnode.com 1, arbitrum-one-rpc.publicnode.com 1, rpc.hyperliquid.xyz 1, api.nansen.ai 0; total 21 of the 45 allowed (budget `used()` 21).

What the live run shows: no request reached Nansen, all three chains were read for all three wallets, and the check stayed far under the limit: the smoke prints 34 positions read from 11 of 11 dexes (registry read), headline a BTC short on the main dex, so no named-dex market data was read and its 18 Hyperliquid reads are not the ceiling (the ceiling case, item (c), has the headline on a named dex and orders pending on ten dexes). The Ethereum funder's ETH family is $145.6M now against $367.6M in the September Nansen fixture (the figure in (b) item 2): the same order of magnitude, not equal. What the two readings show: the fixture holds weETH 49,251 (price $2,768.16), aEthWETH 46,999, wstETH 36,483 (price $3,117.04), 3.9991 ETH, and the ETH mark of that capture was about $2,505; today's read finds weETH 61,851, stETH 0, no wstETH and no aEthWETH, and the ETH mark is 2124.4. No cause is claimed beyond that: the holdings differ, and the live read is not a re-pricing of the fixture. With Nansen off, a short that needs a funder search reads Unknown with `linked_holdings_not_checked`, never a Bet (the Task 7 ruling).

### (b) Why the golden snapshots changed

Task 7 regenerated `test/api/__snapshots__/check-golden.test.ts.snap` (7 of 11 cases updated, none added or removed) and compared every leaf of every case with the snapshot at `bec1d64` by a script, not by the line diff. Four cases are unchanged: the HIP-3 long, the lone long, the thirty offsetting positions and the expired deadline (the deadline stops the holdings read before it starts, with the same note as before). In no case did `verdict` (verdict, reasons, strength), `source`, `degraded`, `pnl`, `orders`, `trades`, `positions` or `hedge.unverifiedUsd` change, nor `linkedHedgeCoverage` outside the Nansen-off case (item 8). The routes answer the node reads from the same Nansen balance fixtures they served before (`holdingsFromNansen`: the registry contracts and the native coin on Ethereum, Arbitrum and HyperEVM only), at the node rates of 2026-11-09 (wstETH 1.2488, weETH 1.1078). The accepted differences:

1. `hedgeScope` went from `all-chains` to `known-tokens` in the six cases that read holdings with Nansen on (the four Abraxas paid paths and the two WETH shorts), and from `hyperliquid` to `known-tokens` in "abraxas: Nansen not used, and why", whose holdings are now read without Nansen.
2. Values come from Hyperliquid's marks (ETH 2,468.06 and BTC 76,667 in the perp metadata capture) times the node's liquid-staking rate, instead of Nansen's price per token. Abraxas's own ETH (0.2198 ETH on Arbitrum and Ethereum): $550.55 to $542.54. The funders' ETH: $399.1M to $394.2M (the Ethereum funder $367.6M to $363.1M, its weETH and wstETH now at 1.1078 and 1.2488 times the ETH mark rather than Nansen's $2,768 and $3,117; the Arbitrum funder $31.53M to $31.07M), `linkedHedgeRatio` 2.22 to 2.20. The two WETH shorts hold 38,000 and 24,000 WETH, priced at $2,500 in the case's Nansen row: their cover went from $95.0M to $93.8M (95% to 94%) and from $60.0M to $59.2M (60% to 59%), each still inside the band it was in (Hedged 85-115%, partial offset 10-85%). On the second-largest position, a BTC short, the funders' BTC went from $261.26 to $256.60: the BTC mark, and amounts read to six decimals. `hedgeRatio`, `hedgeUsd`, `hedgeUsdBySource.onchain`, `linkedHedge` amounts, `breakdown` (segments, `elsewhere`) and the dollar figures in the summaries and tiles follow.
3. Holdings outside the registry are no longer read: Abraxas's balances on plasma, BNB, Monad and Avalanche, its USDC on Arbitrum, Ethereum and HyperEVM and its LILLY on HyperEVM, and the funders' tokens on Base, Optimism, Polygon, BNB, Avalanche, Mantle, Monad and plasma and outside the registry on Ethereum and Arbitrum (rsETH, USDC and the like). None of them was counted before (only registry matches count, for the account and for its funders) and `hedge.unverifiedUsd` is 0 in every case before and after, so they leave no other trace.
4. Sources and wording per Task 6: the "Hedge found" tile and its share copy read `On-chain` where cover was found on the nodes and `Hyperliquid + On-chain` where nothing was counted (the BTC short), instead of `Nansen` or `Hyperliquid`, with `(Ethereum, Arbitrum, HyperEVM)` instead of `(Nansen-supported chains)` or `(Hyperliquid spot)`; the "Linked wallets" tile reads `Nansen + On-chain`; the WETH summaries say "held by this address on Ethereum, Arbitrum or HyperEVM" instead of "on Nansen-supported chains". In the Nansen-off case the tile went from `0%` to `0.0%`, because $542.54 of ETH was found where nothing had been read.
5. The scope note "Balances on other chains: only the tokens this tool recognises (ETH, WETH, stETH, wstETH, rETH, cbETH, weETH, Aave WETH deposits, WBTC, cbBTC, HYPE, WHYPE) on Ethereum, Arbitrum and HyperEVM were read; other tokens and other chains were not" (not a failure) is in `coverage` and `coverageNotes` of the seven cases whose holdings were read, where the holdings read happens, so the funder-label note that follows it moves one place down. `share.limits` lists it where there is room (the WETH shorts) and `share.more` counts it where there is not (+1).
6. The Nansen-off note reads "Nansen not used (today's Nansen credits are used up): no linked wallets" (was "... no balances on other chains, no linked wallets"), in `coverage`, `coverageNotes` and `share.limits`.
7. In "abraxas: Nansen not used, and why" `hedgeCoverage` went from `partial` to `complete` (all three chains read, no token unreadable), so `breakdown.segments` went from one `not-checked` segment to `covered` ($542.54) and `residual`. The verdict is `positions_stale` before and after (the capture is two hours older than the clock), which is decided before any hedge rule.
8. In the same case `linkedHedgeCoverage` went from `not-applicable` to `missing` (Task 7 review, Critical 1): with Nansen off, a short whose own cover is below `linkedLookupBelowRatio` would have had its funders looked at, and nothing looked, so the search is missing rather than not needed. No note was added: the Nansen-off note already says "no linked wallets". On a current reading this is what keeps such a short from `looks_like_a_bet` (it reads `linked_holdings_not_checked`); here `positions_stale` decides first.
9. Look-alike staking tokens (follow-up on `remove-nansen`, after d89a9b0). The nodes are also asked, in the same Multicall3 call per chain, for the balance of seven look-alike contracts the registry does not trust: rsETH, ezETH, mETH, ETHx and osETH on Ethereum, rsETH and ezETH on Arbitrum, none on HyperEVM (`WATCHLIST_CONTRACTS` in `src/engine/assets.ts`, kept apart from `KNOWN_CONTRACTS`, which `spotHedgesPerp` and `isLendingReceipt` read). Each is priced one for one with the ETH mark (rate 1: an understatement of the value held, since each protocol rate is at least 1 ETH, which can only make the withhold less likely to trigger, never create cover) and is never cover: `classifyHolding` reads it as `unknown-contract`, so its value feeds `hedge.unverifiedUsd` again and a restaking farm (long rsETH or ezETH, short ETH) reads Unknown through `unrecognised_assets` instead of a Bet. An unpriced one (no ETH mark) is counted in `unpricedMatches`, which withholds the reading the same way; at a funder it is not counted by the unpriced-funder rule, which looks at native and registry holdings only, since it can never be cover. This amends item 3 for the ETH-named tokens only; the request count stays 41. The scope note gained one clause between the recognised-tokens list and "other tokens": "look-alike staking tokens (rsETH, ezETH, mETH, ETHx, osETH) were looked for but are never counted as cover", naming only the watchlist tokens of the chains read and left out when there are none (HyperEVM only). The regenerated golden was compared leaf by leaf with the snapshot at d89a9b0 and as text: 16 leaves in 7 cases differ, all of them that sentence (`coverage` and `coverageNotes` of the seven cases that read holdings, and `share.limits` of the two WETH shorts), and deleting the new clause from the new file gives the old file back exactly. No `verdict`, `reasons`, `strength`, `hedge` figure, `hedgeCoverage`, source or other field changed, and the four cases with no holdings read are unchanged. The routes still feed the nodes only the registry rows of the Nansen fixtures (`holdingsFromNansen`) and `onchainAnswers` answers the watchlist tokens at 0, so no golden case holds one.

No difference was left unexplained, and none was rejected.

### (c) Measured request ceiling

The heaviest check the tests build (an account with positions on every named dex of a registry of eleven, orders pending on ten of them, a short headline whose own cover is low, Nansen on) sends 41 outbound requests, asserted exactly in `test/api/positions-coverage.test.ts` and held to `<= CHECK_REQUEST_LIMIT`: 29 Hyperliquid (five first-wave reads, one `perpDexs`, eleven position reads, the headline dex's market data, ten per-dex order reads, one book) + 3 Nansen (PnL and the two funding-link chains) + 9 node calls (3 chains for the account, 3 for each of two funders). At the end of stage 1 the same case sent 47. Task 2 took it to 37 (market data for the headline's dex only, one `perpDexs` read), with 8 Nansen calls; Task 7 replaced the 5 Nansen balance calls with 9 node calls, giving 41.

Beyond that case the limit is enforced, not just measured: every Hyperliquid, Nansen and node send charges the check's budget of `CHECK_REQUEST_LIMIT = 45` (retries included), descriptive reads give way first (headline-dex market data, the book mid), and the reads that decide the verdict keep a reserve (`ruleReserve`). Tests pin a 20-dex registry, every Hyperliquid read answering 429 once, and a `POST /api/check` through the Worker, all at or under 45. The live run in (a) sent 21.

### (d) Left open

Closed by this stage (the stage 1 record's section (d)): the duplicate `perpDexs` read (one read now serves positions and market provenance); the Nansen credit charged for a send the subrequest limit refused (a refused send throws before the recorder is reached); the `webData2` question (live test 2026-11-09: main-dex positions only, 30 for the Abraxas wallet and none from `xyz`, so per-dex reads stay; `allPerpMetas` has no asset contexts; `clearinghouseState` and `metaAndAssetCtxs` answer HTTP 500 to `dex: "ALL_DEXS"`). `WORST_CASE_CALLS` still over-reserves and goes with stage 3. Also closed, by the final whole-branch review fix: the empty-registry item (`dexNamesOf` accepted `[null]` or `[]` as a complete registry; it now throws, so the positions read is partial with `registryRead: false` and the one-hour cache never stores such an answer).

Stage 1 open items this stage did not close, carried forward:

- The one-hour dex-name cache notices a new dex up to an hour late, and a retired one keeps readings `partial` for that hour.
- The dex-name regex lives in three places.
- `mainState` is typed more precisely than it is validated.
- The pilotWatch test no longer covers a charged job.
- README still gives an old test count.

Stage 3 still owns (the plan's "Left for stage 3"): funding links from the Hyperliquid ledger and explorers instead of Nansen `related-wallets`; PnL from `portfolio`; removing the Nansen client, `stagedNansen`, the credit budget wiring and `WORST_CASE_CALLS`; the observation schema bump and `source` values; the link-preview footer "Powered by Nansen API" (`src/engine/ogRender.ts`) and share/embed attribution; re-reading the four featured examples; README, SECURITY.md and submission documents. Also parked for stage 3: `stagedNansen` reserves Durable Object meter credit before the request limit is checked (one extra reserve and settle per refused Nansen stage, only on checks that hit the limit).

Deferred minor findings from the task reviews, for a later stage to pick up:

- Tests: no test that a budgeted Nansen send is charged, or that its second attempt charges again; the 429 and routes tests prove only the upper bound; the book-mid boundary is pinned on one side; no test for a focus on a non-largest named-dex position, for a failed headline-dex `metaAndAssetCtxs`, for a failing native-balance sub-call, for decoder edge cases (success flag above 1, oversized length, truncation inside an element), or for the fallback lead with only a funding-links item; the rate-call entries of the captured Ethereum fixtures are never asserted; live-check tests without node routing (`featured`, `gallery-index`, `og-route`, `telemetry`, `runtime/workerd`) answer node URLs with non-RPC bodies, so a short there silently takes the chain-failed path; the test helper answers any non-balance selector at a rate target as a rate.
- Positions and registry: a cached registry that `dexNamesOf` accepts but `parsePerpVenues` rejects leaves provenance missing for up to an hour; `AllDexPositions.registry` is typed `unknown[] | null` but a 60 s cache entry from before Task 2 yields `undefined`; the 60 s positions cache entry now carries the full registry JSON.
- Holdings reader: dust under 1e-6 units becomes a priced holding with amount 0 and $0; `wholeUnits` would throw for decimals below 6 (none in the registry); an own liquid-staking rate failure leaves the holding unpriced with no note; the unpriced-funder check relies on `priced === false` being set only for unpriceable holdings; response bodies are not cancelled on a non-retryable failure or a too-long `retry-after` (`evm.ts`, same pattern in `postInfo`).
- Copy: the "Hedge found" tile's parenthetical lists all three chains on a partial read.
- Housekeeping: a duplicate finite-and-positive `markPx` loop in `observe.ts`; `unmarkedUnderlyings` re-derives underlyings the reader knew; `listText` duplicates `nansenContribution.ts`; stale names and comments (`check.test.ts`, `src/index.ts`, `observation.ts`); `KNOWN_TOKENS_SCOPE` declared below its first use and chain-name literals repeated in `evidence.ts`; a nested ternary in `hedgeItem`; `fallbackLead` returns an empty string for items matching none of its three prefixes (unreachable today); two adjacent comment blocks and an unindented loop body in the retry code; an already-aborted signal is charged for its first send.
- Build: `npm test`'s pretest rebuilds `web/app.min.js` and dirties the tree, and the minifier output is not byte-stable (two locals are renamed on a rebuild of an unchanged `app.js`), so earlier "line endings only" restores may have hidden that.
