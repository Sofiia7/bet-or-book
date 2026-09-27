**Bet or Book: audit of the product, logic, security and readiness for Nansen Meridian. September 21, 2026.**

Local version checked: `c3265b1`. The product sources were not changed. Only this report, a separate offline reproduction and its JSON result were added. Deployment, infrastructure changes, submitting the entry and paid Nansen checks were not part of this audit.

**Verdict: a promising narrow research product, but so far there are not enough grounds to call it a strong favorite.** It has an understandable problem, a working site, a substantive Nansen integration, real data and a good code foundation. The main weaknesses are interpretations of incomplete observations that are too strong, stale aggregates in the gallery, an almost non-existent reason to come back and a text-heavy demo that requires too much explanation. Adding new APIs by itself will not solve these problems.

**What was actually checked.** The Worker routes, data collection, normalization, all engine modules, the budget, the rate limiter, the cache, snapshots, the ledger, the collection/recalculation scripts, the interface, the tests and the project documents were read. 197 tests from 17 files and the TypeScript check were run: everything passed. `npm audit` after a successful request to the official registry: 0 known vulnerabilities. The public page and the cards were opened in a browser; a card was additionally inspected at a width of 390 px. In the saved gallery the statistics and the completeness of fields were checked. The current key from `.dev.vars` was not found in tracked files or the accessible Git history; the key's value was never printed anywhere. There are no non-empty `address_label`, `entity_label`, `wallet_label` fields in the JSON files checked.

The system `npm` launcher in this environment initially failed because of the path to npm-cli. The tests and tsc were run successfully directly through the installed Node; the dependency audit through the existing npm-cli. This is a problem of the local environment, not a defect of the application.

The review is not a production load test or proof of the absence of all vulnerabilities. Cloudflare account settings, secrets on the server, the full set of current contest entries and the Nansen account-side call counter were not checked. API failures were reproduced offline, without spending credits. The performance of a paid check, real latencies and the behavior of Durable Objects during failures need to be measured separately in staging.

Reproduction: [2026-09-21-reproduce.ts](C:/Server/bet_or_book/docs/audits/2026-09-21-reproduce.ts). Result: [2026-09-21-evidence.json](C:/Server/bet_or_book/docs/audits/2026-09-21-evidence.json). Command: `node --import tsx docs/audits/2026-09-21-reproduce.ts`. The script checks 16 observations, intercepting all HTTP requests with local responses. Its assertions capture the current defects; after the fixes they need to be replaced with checks of the desired behavior in the main test suite.

**What is already done well and should be kept.**

- The Nansen secret stays on the server. The user does not connect a wallet and does not grant permissions to dispose of funds.
- A user-supplied URL is not fetched: the address is extracted and passed to fixed upstreams. There is no obvious SSRF through the address field here.
- The main UI uses `textContent` and DOM elements; social meta is escaped; the explorer URL is built from a validated address. No direct XSS path was found in the code checked.
- There is a CSP, framing is prohibited, no-sniff, a limited input size and recognition of a transaction hash instead of an address.
- The engine is separated from HTTP and rendering. Detailed fixtures allow behavior to be checked without paid calls.
- Financial control has already been moved from eventually-consistent KV to a Durable Object; this is the right direction. A single coordinator specifically for the shared budget is justified.
- The first free stage, the cache, coalescing of identical requests within an isolate, reservation of spend and stopping after a Nansen refusal reduce losses.
- Funder assets are no longer passed off as the property of the account being checked. This is an important fix from the previous audit; it must not be rolled back for the sake of a more impressive demo.
- There are explanations based on numbers, data provenance, a rules version and saved readings. For a research tool this is stronger than an opaque "AI score".

**The main reliability problems - fix before expanding the product.**

**A01 · P1. Asset identity is not verified along the whole path.** In [assets.ts](C:/Server/bet_or_book/src/engine/assets.ts:41) the native ETH placeholder `0xeeee…` is entered for Arbitrum but missing for Ethereum. This is not an invented format: Ethereum ETH with this address is present in the local real funder fixture. Reproduction: a $1M ETH short, $1M of native ETH on the same Ethereum address → `hedgeUsd=0`, `unverifiedUsd=1M`, verdict `looks_like_a_bet`. An additional note does not correct the opposite main conclusion.

The registry contains only Ethereum and Arbitrum, despite `chain: all`. For many assets/networks the lack of support is treated as the absence of a hedge. Adding one address will fix the example but not the completeness model. The states "recognized", "not supported", "could not be valued" are needed, along with a prohibition on asserting the absence of an offset when there is a material unknown asset.

Hyperliquid has another part of the same problem: [normalize.ts](C:/Server/bet_or_book/src/sources/normalize.ts:102) builds prices by name, while the balance contains a `token` that is then lost. Two spot tokens with the same name receive one price; in the reproduction a token priced at $1 is valued at $100, and a $10K balance turns into $1M of coverage. The official SDK explicitly warns that spot names may be non-unique: [Hyperliquid example](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/examples/basic_spot_order.py). So the comment about a safe namespace in `assets.ts` is not a sufficient guarantee. Use the token index/token ID for the price and a verified mapping to the underlying; keep the name for display only.

Finally, a malformed Nansen row without `token_address` falls into the "this is Hyperliquid spot" branch and is accepted by the name WETH. Confirmed offline. The source should be an explicit discriminator, for example `source: hyperliquid_spot | onchain`, and required fields should be validated before the calculation.

**A02 · P1. Incomplete data can still yield a confident "Hedged".** In [verdict.ts](C:/Server/bet_or_book/src/engine/verdict.ts:211) the 85-115% range check is performed before `hedgeCoverage`. So 100% on the first page with `complete:false` → `hedged`.

The $1M found confirms the presence of $1M of offsetting assets. It does not prove that the total exposure is close to neutral: the next page may contain another $2M of the same asset. After the move from "at least 50%" to a bounded range, the earlier idea that "a large lower bound is safe" stopped working. With incomplete coverage, show "at least X of coverage found; the resulting exposure is not established". Check completeness before concluding that the value falls within the range, rather than discarding the useful amount found.

**A03 · P1. The Book rule still conflates the nature of the account and of the selected position.** [bookSignals](C:/Server/bet_or_book/src/engine/verdict.ts:119) takes into account the number of orders, the share of bids and the number of markets, but not their volume, distance from the market, lifetime or relation to the headline. Reproduction: a $1M ETH short and 50 orders of $1 each on five other markets → `Book (likely)`; the search for the account's own hedge is skipped after that. This is a reproduction of a mathematical threshold, not a claim that the exchange will accept orders of any such size. Larger orders that are still negligible relative to the position give the same result.

The second path: 20 positions in different assets with equal long/short dollars, without a single order → `Book`. 8 of the 12 Book cards in the gallery have `positions` among their grounds; for 7 it is the only ground. This does not prove that all eight are wrong, but it shows the scale of the dependence on a weak heuristic.

I propose computing "signs of market-maker activity on the account" and "the observed structure of the selected position" separately. The former requires sustained two-sided quoting, material quote notional, closeness of quotes to mark, turnover relative to inventory and a time history. Leave the simple number of positions as a descriptive attribute. An account can simultaneously market-make and hold a directional bet; the classes do not have to be mutually exclusive.

**A04 · P1. Source errors do not always constrain the conclusion itself.** In [check.ts](C:/Server/bet_or_book/src/api/check.ts:226) a failure to read HIP-3 orders sets `degraded=true`, but `computeVerdict` does not receive the completeness of orders. Reproduction: a single HIP-3 long, the orders of that dex return 503 → `looks_like_a_bet`, although the condition "no two-sided quotes" was not verified.

Separately, positions that are an hour old remain `degraded=false`, and disabling Nansen because of the budget also leaves `degraded=false`. Such responses receive the usual ten-minute TTL. A fallback long can receive a positive directional verdict on the main dex while part of the HIP-3 portfolio is invisible. Missing/freshness should be structured properties of each source, and the classifier should explicitly require the sufficiency of exactly those inputs that a specific rule needs. A textual caveat at the bottom of the card does not replace this dependency.

**A05 · P1 for wording, P2 for extending the model. Balance-sheet coverage is not yet a proven strategy.** In [features.ts](C:/Server/bet_or_book/src/engine/features.ts:143) the spot value is compared with the single largest short position. Loan liabilities, the allocation of collateral between strategies and the net exposure across all instruments on the underlying are not assessed. A lending receipt is accepted as coverage even when the size and currency of the debt are unknown. The README discloses the limitation, but the badge remains `Hedged`.

For the next version it is more correct to promise "visible coverage by this address's assets"; show lending collateral as a separate amount. If the debt has not been read, do not call the result net-neutral. For several perp dexes a verified instrument → underlying model is needed that accounts for index/oracle differences; simply stripping the `xyz:` prefix is not safe either. For longs the current check for the absence of a spot offset is logical, but the phrase `nothing in this account offsets it` is broader than the positions actually checked: debts and other derivatives can also create offsetting exposure.

The numbers 85/115%, 5/20 positions and the other thresholds have not been validated with an independent sample. Do not turn `likely/strong` into confidence percentages. Near the boundaries it is better to show the residual and the stability of the result than to present a jump in category as a new economic state.

**A06 · P1. The gallery under the new rules version is not the same as a re-check of the data.** [reexplain.ts](C:/Server/bet_or_book/scripts/reexplain.ts:68) takes the previous `e.hedge`, recomputes the verdict and stamps the current `classifierVersion`. But an already aggregated hedge cannot be re-checked against the contract allowlist, nor can the lending share be learned, or per-token evidence or orders on individual markets be restored.

Of the 277 cards with positions, 269 lack `positionsAsOf` and the numeric field `hedge.unverifiedUsd`; all 7 `Hedged` belong to these old aggregates. All are marked `v2`. This does not mean "269 wrong answers": it means that the claimed modern verification chain cannot be reproduced for them from the saved data. For the contest demo I would re-read at minimum all 7 Hedged, the 12 Book and the 3-5 main story cards. The rest I would mark as historical with an incomplete set of attributes. If the fixes require a larger number of calls, recalculate the budget in advance; the number of calls is not identical to the future number of credits.

Store the normalized raw observations without the prohibited labels, and separately `observationSchemaVersion`, `assetRegistryVersion`, `classifierVersion`, `observedAt` and `interpretedAt`. A recalculation should create a new interpretation and a reference to the previous one, preserving the old one.

**Security and spend management.**

**S01 · P1. An expired reserve can return already spent money to the available budget.** [expireStaleHolds](C:/Server/bet_or_book/src/budget.ts:112) removes the hold after five minutes and decreases `reserved` without increasing `spent`. If Nansen has already served the requests and the Worker terminated before `finally`, the spend is lost. Offline: cap=7, hold=7, an assumed 7 served calls without settle, hold expiry → another 7 allowed. Possible spend of 14 at a cap of 7. The arithmetic of the failure scenario is confirmed; a production failure or actual overspend were not simulated here.

The unknown outcome of a paid operation cannot be treated as zero spend. Conservatively move an expired hold into `spent/uncertain`, and correct the difference once with a late settle. For a truly strict cap it is better to record attempts inside the durable coordinator before sending and to have idempotent settlement. `waitUntil` is useful for completing the accounting when the client disconnects, but by itself it is not a durable transaction with an external API.

**S02 · P2. The account balance is wrongly tied to the calendar day.** [reserve](C:/Server/bet_or_book/src/budget.ts:73) resets the whole object on a new UTC day, including `remaining` and active holds. Confirmed: a known remaining balance of 5 at floor=5 would forbid a paid check, but after the day rollover a reserve of 7 is allowed because remaining became null. A day rollover does not automatically top up the Nansen account to an unknown amount.

The account balance needs to be stored separately from the daily limits, a hold attributed to its own day, completions across midnight handled and unfinished operations not zeroed out. `settle` is currently not idempotent: redelivery adds the cost again; an old remaining that arrives later can replace a fresher one. Before adding retries, these cases must be covered by tests. A top-up of funds needs a separate synchronization path, otherwise the local breaker may hold until tomorrow.

**S03 · P2. Public checks allow the budget of honest users to be drained.** The limit of 20/min/IP and the overall cap of 300 limit the damage but do not distribute access. A single client with different addresses can, over a series of permitted requests, deprive everyone else of a full Nansen analysis. A formal estimate at 7 credits/check is about 42 full checks before the next reserve is refused; at two-credit checks about 147, taking reserve=7 into account. This is a model of the limit, not an attack that was carried out.

Add a short global burst/concurrency limit, a per-session quota, deduplication of checks of the same address across isolates and a separate closed reserve for the demonstration. Use Turnstile on an explicit cache miss/suspicious flow, not before every free card. Protection of the free upstream after the paid limit is exhausted is also needed. The absence of CORS does not block the request itself from outside, nor the consumption of resources.

[index.ts](C:/Server/bet_or_book/src/index.ts:121) allows HEAD and routes it through the same paid branch as GET. The comment "writes nothing" is wrong: the request creates a snapshot, cache entries and budget operations. For HEAD, do not start paid work; make the start of a new check an explicit POST with request-origin restrictions. This reduces accidental triggering by scanners/prefetch and cross-site abuse, but does not replace anti-bot measures and quotas.

**S04 · P3. The remaining hardening measures.** Remove `'unsafe-inline'` for JS via a separate file or a CSP hash; this is additional protection, there is no confirmed XSS at present. Do not show internal upstream messages to the user. Store external addresses only after schema validation. A snapshot ID must not be considered a secret or an access right: wallets are public, but the fact of a user's interest in an address may be sensitive; this should be taken into account in future private watchlists.

**Reliability and interface errors.**

**R01 · P2. Runtime validation is applied unevenly.** `finite()` for positions is useful, but [normalizeNansenPnl](C:/Server/bet_or_book/src/sources/normalize.ts:220) accepts `{}` without an error. `$NaN` can end up on the card. Balances with a missing valuation disappear; [normalizeSpotHoldings](C:/Server/bet_or_book/src/sources/normalize.ts:130) turns a missing price into a zero value and then removes the row. This is reproduced offline. A zero balance, a missing price and an invalid response should have different states.

In [readLinkedHedge](C:/Server/bet_or_book/src/api/check.ts:394) the normalization of a fulfilled funder balance sits outside the protection against shape errors: a malformed supplementary source brings down the whole check even though the main data has already been received. The `complete` of funder balances is ignored: truncated data does not receive the corresponding marker. Header numbers also need to be checked for finite/non-negative before being entered into the budget. A small consistent schema is needed for all external responses; adding a large library is not necessary.

**R02 · P2. The link can promise a save that did not happen.** `safeKv.put()` swallows the error, and [index.ts](C:/Server/bet_or_book/src/index.ts:188) still returns a snapshotId. The user gets a working card with a non-working share link. Return `snapshotSaved` and do not offer a "saved reading" without a successful write. KV eventual consistency also requires careful handling of brief unavailability right after a write, rather than an immediate "never existed" message.

The identifier in [snapshot.ts](C:/Server/bet_or_book/src/snapshot.ts:24) consists of the first eight hex characters of the address and milliseconds. Two different addresses with the same prefix and time create the same ID - confirmed. The low probability of an accidental collision does not make this a good model of immutable evidence. Use a UUID or a hash of the full address, time and version/content. Do not reuse an ID after re-explain. `/api/snapshot` selects the bundled gallery first, so overwriting the gallery data changes the response for an old ID.

**R03 · P2. The protection against a stale response does not cover gallery clicks.** In [web/index.html](C:/Server/bet_or_book/web/index.html:455) opening a gallery card does not increment `requestSeq`. If a live check is still running, the user can select another card, after which the old response will replace it. The click also does not change the URL: after opening a saved/live reading the address bar may point to card A while B is already on screen. On any transition to another reading, invalidate the previous UI operation and synchronize the URL; a UI cancellation must not lose the server-side spend accounting.

The notice about several addresses found is immediately overwritten by the `load()` status, so the current implementation hardly gives a chance to read it. Show the addresses found and let the user choose, or persistently label the address in use. The `Check live` button hits the same cache: for up to 10 minutes it can return the previous response. Show the age, `cacheHit`, the time of the next refresh; allow a forced refresh with a separate quota, not through an arbitrary cache-busting URL.

**R04 · P2. 45 seconds is not an overall deadline.** In [check.ts](C:/Server/bet_or_book/src/api/check.ts:119) the time is checked only before some stages. An already started related-wallets/funder balances pair can keep working for roughly two more upstream timeouts; the first paid positions/PnL do not check the deadline. A shared AbortSignal with the remaining time is needed, a check before every paid stage and a partial response when the time runs out. A reproducible UX test should check both the text and the real maximum wait. `opts.now` is currently mixed with direct `Date.now`, which complicates such tests.

**U01 · P1 for trust in the shared artifact. The PNG loses the permanent limitations.** On the page the `What we cannot see` block always warns about CEX/OTC/unlinked wallets. [cardLimits](C:/Server/bet_or_book/web/index.html:547) carries over only `coverage`. If the array is empty, the PNG says `Everything this tool reads was read in full` but does not carry over the permanent blind spot. Separately, the first two coverage items can crowd out an important limitation, and a reference to "more on the page" does not help if the page address is not printed on the image.

Add a fixed short caveat to every PNG, an explicit observation time, `saved/live` provenance and a short URL/QR to the immutable snapshot. Choose the priority of a limitation by its influence on the conclusion. For Abraxas the most important line about funders is fifth in the evidence, while [drawCard](C:/Server/bet_or_book/web/index.html:579) takes the first four. The card must include the decisive evidence, not mechanically the first columns.

**U02 · P2. The provenance of evidence is in places simplified to the point of a false impression.** [hedgeItem](C:/Server/bet_or_book/src/engine/evidence.ts:245) labels the whole hedge `Nansen` if `chain: all` was read, although the sum may include Hyperliquid spot. In all seven Hedged cards the underlying is HYPE; from the aggregates it is impossible to establish what share came from which source. Show the contribution of each source or an honest `Nansen + Hyperliquid` label, and replace `all chains` with "Nansen-supported chains; completeness ...". The mere fact that a request was made does not mean that Nansen changed the answer.

**U03 · P2. The screen lacks hierarchy, although technically it works.** At the checked width of 390 px the card is readable, with no obviously broken layout visible in it. But five identical tiles, long repetitions about funders and several caveat blocks take up several screens. On desktop the fifth tile remains a narrow tall column. The most important thing - own coverage and the unproven ownership of $405M - visually competes with the secondary Net/Gross.

Make the first line a result in human language, then a large diagram of short ↔ own spot and separately a dotted link to the funder. Reveal sources and limitations in a single understandable block. Keep the gallery sampling method accessible via `How selected`; do not put long text before the first example. A visible focus, restoration of focus after the chips are redrawn and a keyboard check are needed; aria attributes alone are not enough to claim full accessibility.

**Code, operations and documentation.**

**C01 · P2. The call ledger is approximate.** [recordCalls](C:/Server/bet_or_book/src/credits.ts:22) still does a read-modify-write of a shared KV key. This no longer breaks the spend cap, but it loses part of the statistics on coinciding updates and under KV quotas. Cloudflare describes eventual consistency and write restrictions: [KV model](https://developers.cloudflare.com/kv/concepts/how-kv-works/). For financial and contest accounting a reliable event/counter in the DO is needed, a request ID and separate `attempted`, `successful`, `creditsUsed`, `creditsQuoted`.

In the current Nansen schema reviewed, `X-Nansen-Credits-Cost` and `X-Nansen-Credits-Used` are distinguished, and there are machine-readable error codes and a request ID. The client reads cost and remaining, while the comments say that the refusal on credit exhaustion is undocumented. Move to contract-based handling while keeping a safe fallback for an incomplete response: [Nansen current-balance API](https://docs.nansen.ai/api/profiler/address-current-balances). Do not infer the origin of a specific 403 ("key warm-up", "no access under the plan") merely from the fact that the next attempt succeeded: the README and the comments currently contain different explanations of the same episode.

**C02 · P2. The tests have no full runtime and browser contract.** The current Vitest runs in Node, the DO is checked through a fake context; this is good for arithmetic but does not prove the behavior of Cloudflare storage gates, eviction or request cancellation. There is no route-level check of the real `src/index.ts` and no browser scenario as a whole. For the fixes, add Cloudflare runtime integration tests plus several E2E: cache miss/hit, failure of a single stage, snapshot after a KV failure, GET/HEAD/POST, switching cards during a request and a PNG with caveats.

Describing the DO as "always one request at a time" is too strong: JavaScript can interleave around I/O; storage safety is ensured by the runtime's rules. This is not proof of a new race in the current coordinator - with the current storage operations the runtime provides important guarantees. Clarify the comment and test the real scenarios: [Cloudflare storage/input gates](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/).

**C03 · P3. Maintainability can be improved without a rewrite.** `web/index.html` combines styles, networking, UI state, the gallery and the PNG; the frontend JS and scripts are not in the current `tsconfig.include`. The shared formats for money, addresses and verdicts are duplicated. Extract small `ui`, `share`, `format` modules, add typing at the boundaries and a check with a script-specific tsconfig. Introducing React/Next for the sake of the audit is not required. Runtime deps are almost absent - that is a plus.

Add CI: `npm ci`, typecheck, tests, Worker build, secret scan; pin Node engines and a local runbook. In the README replace `git clone <this repository>` with a working command, add `.dev.vars.example` without a secret and a reproducible demo mode on fixtures. Generate Env types from the bindings. `observability.enabled=true` is useful, but traces are not separately enabled; first implement latency/error/fallback/cache-hit/credits measurements, then tracing if needed. Do not declare observability fully configured on the basis of a single checkbox.

Mark the historical [calibration.md](C:/Server/bet_or_book/docs/wiki/calibration.md) as superseded at the top: it still contains the already rejected interpretation of Abraxas as a delta-neutral carry trade. Keep the actual run of the three examples as history, but it must not be presented as today's calibration. Explicitly separate the old roadmaps and audits by status; the README should lead to a single current specification of behavior.

**How to formulate the product more precisely.**

The current `Should you copy this whale?` promises an assessment of whether copying is reasonable, which does not exist. The classifier does not know the user's risk, the entry price after the news, the market impact, the funding carry, the user's position size or the whale's full strategy. A disclaimer of advice in the footer does not remove the expectation created by the main headline.

I would keep the name Bet or Book and formulate the promise like this: **"Check what really stands behind a whale's loud position - and what has changed since it was published".** A short variant for the English interface: `Before you copy the headline, check the position.` This is specialization in verifiable context, not in forecasting profitability.

The primary audience: a Crypto X/Telegram participant who has seen a specific whale alert; the second is the author of such a post or a researcher who needs a verifiable analysis. Systematic market makers and professional risk desks are not the main market yet: they need liabilities, sub-accounts, full history and a stricter exposure model.

**Mechanics that will give the greatest gain.**

| Mechanic | User value | Minimal version |
|---|---|---|
| Selection of a specific position | The post may talk about BTC while the address's largest position is ETH | After the address, a list of 3-5 positions, choice of market/side; store the selected position in the snapshot |
| Claim verification | The user gets an answer to their own question | Choose "directional short", "fully covered", "MM signs"; result "confirmed by observations / there is a contradiction / insufficient data" |
| Visual breakdown | Within a few seconds it is visible which assets belong to whom | Short, spot of the same address, residual; funders as a separate dotted block with owner unverified |
| Comparison of two observations | There is a reason to come back and a real trigger for an alert | Amount, side, own offset, quote activity; the same model version or an explicit marker of a rules change |
| A small up-to-date selection | No need to know an address in advance | 6-12 verified stories; sort by change and by an explainable mismatch with the headline, not only by size |
| Local watchlist | Coming back without wallet connect and registration | Save the address/position in the browser, show the latest snapshot; background alerts later with explicit opt-in |
| Confirmation card | Sharing brings other users and preserves the context | Immutable URL, time, sources, key caveat, correct OG preview |

There is no need to get all seven done by the deadline. The minimal strong set: the selected position + the evidence diagram + comparison of two observations + a quality share card. The selection can initially be maintained by hand, honestly indicating the update time.

**What to remove, postpone or tone down.** Do not add auto-trading, wallet connection, a social network, a "best whales" leaderboard or a general AI chat until the usefulness of the core check is proven. They create new expectations, costs and a failure surface. An LLM can later explain already computed facts, but must not establish funder ownership or create the verdict.

Remove PnL from the mandatory critical path where it does not affect the conclusion: it is currently always paid for, sometimes does not make it into the first five evidence items and distracts the user towards the whale's "success". Load it as additional context, including the meaning of the window, fees/funding and the limits of comparison. Remove the API-call counter from the main user scenario, keeping it in the methodology/submission. Collapse long technical caveats, but keep material limitations next to the conclusion and in the PNG.

Do not "cure" the 44% Unknown by lowering thresholds. Of the 121 Unknown, 76 share a generic `signals disagree`; this is a poor final screen, but not grounds for inventing confidence. Show the established fact: "long/short portfolio", "48% visible coverage", "material assets not recognized", "HIP-3 orders unavailable", and the next useful step. Unknown should mark the boundary of the conclusion, not the absence of a result.

**The quality check that is still missing.**

Create a separate small set of cases not used for tuning the thresholds. Start with 15-20 manually verified cases before submission; expand to 30-60 afterwards. Do not declare it a measurement of the owner's full strategy: on the available data only the observed structure and the correctness of the wording can be labeled.

Mandatory classes: a standalone long/short, own offset, partial/over offset, loan-backed collateral, different underlyings with zero dollar net, several dexes, unrelated maker orders, shared-service funder, unknown contract, token-name collision, missing price, stale source, pagination and API failure. For each, store the expected facts, the prohibited claims, the sources and the time. Separate false hedge/false book/false directional claims, abstention and the share of data-provenance errors. Count latency and credits per useful check separately. Accuracy without such a definition will be misleading.

Test the product on 5-8 representatives of the audience. Give them the same post and ask them to explain what is established, what is unknown and what changed after viewing. Measure comprehension and time rather than claiming "prevented losses" without a study. This is an inexpensive way to improve the demo more than yet another endpoint would.

**Contest assessment.**

The official Meridian criteria carry equal weight: data integration, originality, functionality and documentation/submission. Meaningful use of Nansen and an understandable working demo are explicitly encouraged; complexity by itself is not an advantage. [Campaign page](https://nansen.ai/campaigns/meridian-buildathon).

| Criterion | My assessment of the current entry | What stands in the way of high scores |
|---|---|---|
| Data Integration | 7/10 | Nansen takes part in the rules and cross-chain evidence, but in places the attribution is broader than the actual contribution; old aggregates do not pass the new check |
| Functionality | 6/10 | The product works and there are tests; conclusions/coverage/budget errors were reproduced and runtime E2E is unverified |
| Creativity & Originality | 6/10 | The narrow question is useful, but the current form is close to yet another wallet dashboard; a selected claim, visual evidence and changes over time are missing |
| Documentation & Submission | 7/10 | The README is detailed and there is a script; historical contradictions, heavy text and the unconfirmed readiness of the final video/submission remain |

The average of 6.5/10 is my subjective assessment of readiness and persuasiveness, not a jury score and not a probability of winning. With the main risks fixed and a strong 45-60 second script, a target of 8/10 looks achievable. Calling the project top-3 or giving a winning percentage without the current field of competitors would be unfounded.

The official catalog of the previous CLI campaign already includes execution agents, analytics terminals, wallet monitoring and relationship graphs. So adding "AI + alerts + dashboard" by itself does not guarantee originality. The catalog is not a list of Meridian winners: [Nansen CLI Builds](https://academy.nansen.ai/en/help/articles/6399546-nansen-cli-builds). A stronger differentiator for Bet or Book is a reproducible check of a specific whale claim with an explanation of why the data changes the initial impression.

According to the FAQ the deadline is September 27, 23:59 UTC, that is September 28, 01:59 Budapest time. Required are 1,000+ calls within the contest window, a public GitHub, an X post with `@nansen_ai` and a link to the repository, a 30-60 second recording and a separate submission form. The recording must show the working product with live Nansen data and be understandable without voice. [Official FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).

The local ledger contains 1,034 attempts and 1,027 successful responses; the open page showed a total of 1,045 with the live counter. By local arithmetic this is sufficient even without errors, but the number should be finally reconciled on the Nansen side, since local statistics are not independent confirmation. The public GitHub is accessible; whether the form was submitted and a final video exists has not been established.

**Proposed demo script.** 0-6 seconds: a specific verifiable claim and the selected position. 6-20: a real live check and the own holdings/funder evidence diagram. 20-35: a short contrasting example where own coverage is actually measured, with the explicit time of the saved observation. 35-48: comparison of two real snapshots and a caption of exactly what changed. 48-60: a saveable card with sources and a limitation. Do not invent a position change for the sake of the story and do not pass off the old gallery as live. Separate the history of data changes from revisions of the classifier.

The current script in [demo-script.md](C:/Server/bet_or_book/docs/demo-script.md) is better than the previous one, but the first Unknown card requires reading long English text. First show "own holdings / funded-by wallet / ownership unverified" on the diagram, then explain the conclusion. One meaningful turn is needed that a judge can grasp without pausing the video.

**Order of work until submission.**

| Priority | Work | Done when |
|---|---|---|
| 1 | Asset identity, coverage gates, limiting Book, careful wording | Boundary cases do not produce claims stronger than the observations; regressions are included in the suite |
| 2 | Budget orphan/day rollover, honest saving of snapshots, PNG caveats | A failure does not release possible spend; a non-existent snapshot is not offered; limitations survive the share |
| 3 | Re-check of the contest examples, immutable versions | Every story is reproducible under the new model; the old reading is available at the previous link |
| 4 | Position selection and the evidence diagram | A new user explains the difference between own and others' assets within 10 seconds |
| 5 | Comparison of two snapshots | It is clear what changed in the data and what changed in the rules |
| 6 | Independent cases, staging E2E, README and video | A verified live path, correct refusals and an understandable recording; the entry complies with the FAQ |

For September 21-22 I would schedule model correctness and the financial limits; for the 23rd, the verified examples and versioning; for the 24th-25th, the selected position, visual evidence and comparison; for the 26th, user testing and the recording. Leave the 27th for a repeated smoke check and the submission, without major changes. If there is less time, cut new mechanics first, not the evidentiary quality.

**My recommendation to the project owner:** continue Bet or Book, narrowing the promise and strengthening the evidence. Its competitive advantage may lie in the user bringing a loud claim and leaving with an understandable, verifiable picture of the position. For that, it matters more to fix the errors of confidence, let the user choose the relevant position and show real changes than to increase the number of badges, integrations or screens.
