**Bet or Book - audit of 23 September 2026**

Version checked: `bb78fed`. Checked: the sources of the main Worker paths, the classifier, normalisation, budget and cache, snapshots and comparisons, the web interface, image generation, the test infrastructure, the gallery, the documentation and the live site. The product sources, the gallery and the deploy settings were not changed during the audit. The existing change to `docs/submission-checklist.md` was left as it was.

**My conclusion:** the project has grown noticeably. There is a clear task, a working product, useful limits on conclusions, evidence-based cards and a good enough engineering foundation. It is a convincing candidate for a prize place. I would not call it a strong favourite right now: there are reproducible errors in the core promise - to explain a specific position and to save verifiable evidence. Fixing these errors, a clear first screen and a strong demonstration of Nansen will give more than yet another mechanic.

The phrase I would build the product around: **"A big short does not yet mean a bearish bet. Check what is visible behind this position."** The user comes to check a conclusion from a post. The position size, the list of wallets and the returns table are auxiliary data for this task.

**What was actually checked.**

- `npm test`: **402/402**, 32 files, passed.
- `npm run typecheck`: both configurations passed.
- `npm audit --json`: **0 known vulnerabilities** in the installed dependency tree.
- `wrangler deploy --dry-run`: passed; 4 649.32 KiB before compression, 1 375.30 KiB gzip. This is a build check without publishing.
- A search for characteristic credential patterns across 139 tracked files: no matches; the real `.env`/`.dev.vars` are not tracked. This is not a full secret scan of the entire Git history.
- Live `/`, `/app.js`, `/api/gallery`, `/api/ledger`: HTTP 200. The live `app.js` matched the local one byte for byte. This does not prove that the entire server build matches.
- Through the interface: the ready HYPE card, its live re-check and re-opening the saved result were checked. Live result: about **$43.3M HYPE short, 97% coverage, 3 Nansen calls**, the vitals block and the comparison are present.
- The PNG preview of this new snapshot was opened: it rendered successfully; the absence of the date and the limitations on it was confirmed visually.
- Offline reproductions were added: the [script](../../docs/audits/2026-09-23-reproduce.ts) and the [JSON results](../../docs/audits/2026-09-23-evidence.json). The script works with stubbed upstream responses and a temporary copy of the gallery, without paid requests and without changing the product.
- The official contest criteria were read in the browser on the [Nansen page](https://nansen.ai/campaigns/meridian-buildathon). The Hyperliquid documentation, the redistribution guidelines and the Cloudflare limits were re-checked.

Not checked: the Cloudflare dashboard, the presence of DEMO_KEY in production, the spend in the Nansen dashboard, real multi-region request contention, eviction/cancellation of Durable Objects, the entire Git history, the actual accuracy of the classifier on independent labelling. The 375 px viewport emulation in the browser tool did not apply: the actual width stayed at 954 px. Therefore no full visual mobile QA is claimed here; the specific first-render error below is confirmed by the code and by DOM measurement.

**What is already good and does not need rewriting again.**

The key is on the server; the external request addresses are fixed; an arbitrary pasted link is not downloaded. The UI outputs data mostly through `textContent`, the CSP forbids inline script and embedding the site. The paid API operation is separated from reading the result. The budget is reserved before the requests, in a Durable Object; a lost reservation does not refund potentially spent money. There are time limits, partial responses, a short TTL for degraded data and explicit rules versions. Ownership via First Funder is no longer declared established. Position selection, vitals, recent readings and the directional portfolio are already implemented. Vanilla JS and a small backend suit the scale of the project; a migration to React/Next is not needed now.

The previous audit correctly found the absence of vitals, `directional_portfolio`, linking of live readings and first-screen examples. These functions now exist. Repeating the old "this is missing" would be wrong. Below are the remaining defects and new edge cases.

**Fixes before submission: trustworthiness of the result.**

**L01 · P1 - Book still transfers the wallet's activity onto an individual position.**

Location: [verdict.ts:176](../../src/engine/verdict.ts#L176), [features.ts:170](../../src/engine/features.ts#L170). `headlineTwoSided` and `headlineQuoteNotionalUsd` are computed, but Book does not require them. Reproduction: ETH short $1M, not a single order in ETH; 50 orders for $150K in five other markets → `Book (likely)`. Second example: $250K of buy orders and only $25 of sell orders, with the same number of orders on both sides, → also Book.

This does not prove that the selected ETH short is inventory. Fix: describe the account's activity and the evidence for the selected market separately; compute the materiality of two-sidedness from both sides, for example via `2 × min(bidUsd, askUsd)`, not from their sum. For conclusions specifically about inventory, orders/flow in the selected market and preferably observation over time are needed. Until such a check, the wording "the account shows signs of market making" is more accurate than "this is inventory". None of these thresholds is a measured probability.

**L02 · P1 - A change of the selected position is passed off as a change in the wallet.**

Location: [index.ts:394](../../src/index.ts#L394), [compare.ts:48](../../src/engine/compare.ts#L48). The `latest:${address}` pointer is shared by all questions about an address. `compareReadings` checks only that the address matches. An unchanged portfolio of ETH short $1M + BTC long $100K: switching ETH → BTC creates "largest position ETH → BTC", a change of side and "position size $1M → $100K". The user learned nothing about changes in the account - they selected a different position.

Fix: the identity of the question is `(address, market/dex, side)`; compare sizes only for the same market. When the question changes, show that separately. For the "largest position" mode a change of leader can be a real event, but it must not be mixed with a manual selection. `latest` in KV also does not guarantee a strict order for checks that finished in parallel; if history becomes a core function, the pointer should be updated with a time check in the coordinator.

**L03 · P1 - The promise of an immutable snapshot is not kept for the gallery.**

Location: [reexplain.ts:75](../../scripts/reexplain.ts#L75), [reexplain.ts:149](../../scripts/reexplain.ts#L149). The script changes the verdict, the text and the rules version in an existing record while keeping the `snapshotId`. Obtained on a temporary copy: one and the same ID is first `Unknown/v3`, after recomputation `Looks like a bet/v4`. The old full interpretation is not in the result; `previousInterpretation` stores only a few fields. For a project that promises a link to what the author saw, this is an important error.

There is also a second collision path: [snapshot.ts:58](../../src/snapshot.ts#L58) takes into account the address, the millisecond and the classifierVersion, but not the focus. Different questions about the same address started in the same millisecond produce the same ID. This is a deterministic collision of the input data, not a break of FNV.

Fix: separate the observation from the interpretation. A new interpretation gets a new ID, the old result stays available, the new record references the previous one. For a live ID use a UUID or the full identifier of the reading, including the question. The OG image key should also reflect the version of the immutable result: right now it is `og:${id}`, and the HTTP cache is marked immutable for a year, so one link can open the new text and the old image.

**L04 · P1 - The new `directional_portfolio` says something factually wrong.**

Location: [evidence.ts:241](../../src/engine/evidence.ts#L241). A net/gross threshold of 80% does not mean "all pointing the same way". A portfolio of ETH short $900K + BTC long $100K has exactly 80%, but the positions point in opposite directions. If BTC is selected, the sentence additionally declares it "the largest", although it is nine times smaller than ETH. In the evidence the selected position is also called `Largest position`.

Fix: "a predominantly directional portfolio", with the signed net and the prevailing side stated separately; `Selected position` under focus. Keep the features of the whole portfolio separate from the features of the selected leg. The position-check mode must not pass off the dominant side of the rest of the portfolio as an explanation of a small opposing leg.

**L05 · P1 - An unpriced Nansen balance turns into an absent balance.**

Location: [normalize.ts:204](../../src/sources/normalize.ts#L204). `normalizeNansenBalances` silently discards everything where `value_usd` is not a positive finite number. Reproduction: a known WETH contract, 1 000 tokens, `value_usd: null` → an empty array → with a complete page, `Looks like a bet`. This is a check of the reaction to an incomplete/unexpected upstream response; the occurrence of such a live response was not established in this session.

Fix: keep a positive amount of an asset with an unknown price as `priced:false`; suspicious fields should lower the completeness of the reading or reject the source. On the Hyperliquid path such a model already exists. Completeness of the page and completeness of the data usable for a conclusion are different things.

**L06 · P1 - `ordersCoverage: complete` means less than it claims.**

Location: [check.ts:329](../../src/api/check.ts#L329). Additional HIP-3 dexes are read only if there is an open position on them. But one can quote with zero inventory too. An account with a main ETH position and orders on another dex gets "a complete read of orders", although the other dex was not requested at all. An offline model with such a dex confirms that only main is requested, and the result is complete/looks_like_a_bet. The [Hyperliquid documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) explicitly specifies `dex` for `frontendOpenOrders`.

Fix: either obtain the full list of relevant venues and read them, or narrow the claim: "no two-sided quotes found on the venues checked". The second option is cheaper and requires honestly redefining the bet rule. A successful response to every request sent does not yet prove the completeness of the chosen set of requests.

**L07 · P2 - A weak maker signal suppresses a proven hedge.**

Location: [verdict.ts:266](../../src/engine/verdict.ts#L266). The `maker_flow_only` condition returns Unknown before the `hedge_leg` check. With 100% own spot coverage, 200 two-sided maker fills and no orders, the result will be Unknown even if the balances were read completely. Trades describe activity, but do not cancel the coverage found. Give proven coverage priority, or show two independent characteristics instead of one mutually exclusive label.

**L08 · P2 - The exact identity of a spot token is used only for the price.**

Location: [normalize.ts:156](../../src/sources/normalize.ts#L156), [assets.ts:149](../../src/engine/assets.ts#L149). `tokenIndex` is stored, but the spot/perp matching again relies on the name. A stubbed token with index 987654 and the name HYPE is counted as HYPE coverage. This is a reproducible gap in the identity check, **not a confirmed exploitation on Hyperliquid**: a fresh `spotMeta` in this session contained 503 tokens with no repeated names.

Fix: trusted `tokenId`s/indexes and a mapping table to the base asset. One cannot simply require `isCanonical:true`: in the live response HYPE, UBTC, UETH and USOL had `isCanonical:false`. Verify the real identifiers. For perps there is a similar boundary: ETH and `xyz:ETH` are currently treated as different assets, sameAssetOffsetShare stays 0. An explicit registry of verified correspondences is needed; simply stripping the dex prefix is dangerous.

**L09 · P2 - "First funded" is not the wallet's age.**

Location: [check.ts:607](../../src/api/check.ts#L607). Two chains are read, `complete` is ignored and the earliest available record is taken. With an Arbitrum failure and an incomplete Ethereum page the card still says "First funded: 1 day ago". This is neither the first activity across all chains nor the creation date of the position/Hyperliquid account. Better: "Earliest funding found: ... on Ethereum/Arbitrum", with the search scope and a mark of incompleteness. If this line does not help the main task, remove it from the main card: it costs two additional calls on a small long.

**L10 · P2 - Position flow can say "no fills" when there were trades.**

Location: [features.ts:369](../../src/engine/features.ts#L369), [vitals.ts:53](../../src/engine/vitals.ts#L53). Only the Open/Close prefixes get into the sums. A `Long > Short` fill for $1M gives `headlineFills=1`, but the UI says "no fills". In addition, the filter by coin does not separate trades in the opposite direction from the current position.

Fix: "no fills" is acceptable only when the number of fills is actually zero. For an unsupported `dir` - "there are trades; the change in exposure is undetermined". Then take into account startPosition, the side and size, including reversals. State the `[from, to]` window, whether the cap was reached and the completeness: the difference between the first and the last fill is not equal to the duration of the full observation. Hyperliquid [limits the response to 2 000 fills](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).

**L11 · P2 - The comparison attributes a cause without sufficient grounds.**

Location: [compare.ts:101](../../src/engine/compare.ts#L101). `readingMoved` equals the presence of noticeable changes in the five displayed fields. Source completeness, the number of positions, bidShare, the number of markets, fills, registryVersion and other rule inputs are not part of it. Reproduction: the rules version and positionsCoverage change, the outcome changes; the tool writes "because the rules changed".

Fix: distinguish "changes in rules/data were recorded" from a proven cause. For causal attribution, run one and the same observation through both rules versions, and compare the inputs before rounding and the display threshold. Until that exists - "The rules version also changed; the cause cannot be separated".

**L12 · P2 - Visible coverage, net exposure and the resulting risk are mixed together.**

A visible spot hedge says nothing about debt, collateral, cross-margin, the possibility of liquidation or the economics of funding. The project partly qualifies this, but the Hedged headline and the green bar are easily read as "safe". For over-covered the phrase "account is net long" is even stronger: it is computed from one selected short leg and the spot found, without all the liabilities. Write "visible spot exceeds this short by $X", not the full net of the whole account.

The [breakdown.ts](../../src/engine/breakdown.ts) diagram does not accept hedgeCoverage at all. With an unavailable source or a deliberately skipped read it cannot draw "not checked". Encode unknown coverage and the absence of a found offset separately. That way the text and the image will not convey different degrees of certainty.

**Interface and distribution of cards.**

**U01 · P1 - The mobile diagram fix does not take effect on the first render.** [app.js:399](../../web/app.js#L399) reads `box.clientWidth || 640` while the parent `#card` is still hidden; it is shown at the end of `renderResult`. Confirmed on the live page after a reload: figureWidth 646, viewBox 640. On a phone the real inner width will be about 301 px, but the first viewBox will stay 640: a 12 px label will visually shrink to about 5.6 px. The next resize/opening of another card may fix the picture, which is why a test after resizing the window misses the bug. Show the container first, then measure, or use a ResizeObserver. The check must start from a fresh page directly at a narrow width.

**U02 · P1 - The OG preview loses the date and the limitations.** [ogCard.ts](../../src/engine/ogCard.ts), [ogRender.ts:94](../../src/engine/ogRender.ts#L94). Download PNG uses shareCard and the limitations; the link image is drawn by a different path, without observedAt, historical and permanent limits. The live OG preview showed simply HEDGED, the amount and rules v4. The text is cut at 210 characters, so an essential caveat at the end may also disappear. A single content model for web/canvas/OG is needed, with the date, the saved-reading status and a short limit of the conclusion mandatory. Different image sizes are acceptable; a different meaning is not.

**U03 · P2 - "Check again" forgets the selected position.** [app.js:685](../../web/app.js#L685) runs `runCheck()` by address only. A saved BTC question can turn into ETH after Check live if ETH is the largest. Use the saved focus, and report a closed position explicitly. The backend has a separate bug: [check.ts:317](../../src/api/check.ts#L317) compares the coin without the side when confirming the focus; a request for ETH long against an ETH short keeps the focus long and issues no warning. Both cases were reproduced/confirmed by the code.

**U04 · P2 - The most visible text about the hedge source explains the finding incorrectly.** All seven current Hedged in the gallery are covered by HYPE from Hyperliquid spot; Nansen's on-chain contribution is zero. The evidence correctly says Hyperliquid, while the summary says "spot ... on Nansen-supported chains". This is also visible on the live HYPE card. Separate them: "$41.9M HYPE found on Hyperliquid; supported on-chain balances also checked". Where the search was done and who found it are two different messages.

**U05 · P2 - The gallery hides the latest improvements.** Of the 277 visible cards: 183 are available to the current rules, 94 are historical; 132 bet, 41 unknown, 3 book, 7 hedged. For **all 277 the vitals are empty**; the historical readings lack a number of modern fields. Position selection on a saved card is hidden by design. So a new visitor mostly sees the old product. Make 3-4 fresh, explicitly dated demonstration readings a separate selection; leave the archive available below. There is no need to re-scan all 277 addresses for this.

**U06 · P2 - The first screen offers too much that is secondary.** The gallery starts with sample statistics, methodological caveats, six filters and ranked rows with PnL. A card can contain five pieces of evidence, another six or seven vitals, history and several limitation blocks. This is useful material, but a person first needs the question, a short conclusion and one decisive piece of evidence. The rest opens on request.

Keep at the top: address → position → conclusion → visual explanation → one main CTA "Share this reading". Collapse Copy card / Download PNG / Copy link / Copy post text into one Share group with a choice of action. "How this was decided" should show an explanation of the rule in plain words; the raw reason code goes in the technical details. Show current examples by default; move `Earlier rules` and the sampling method into an expandable archive. Do not use the account's PnL 30d as the main evidence of the meaning of an individual position.

**Security and operations.**

In the paths checked, no confirmed critical key leak, XSS, SSRF or way to steal user funds was found: the product does not need wallet connection or trading signatures at all. The main practical threats are spending the limit, loss of availability and an untrustworthy explanation. The absence of CVEs does not prove the security of the whole application.

**S01 · P1 - A link can still automatically start a paid check.** [app.js:1246](../../web/app.js#L1246): `/?address=...` calls `runCheck()` on load. The direct API GET is fixed, but simply opening a specially crafted link in the browser makes a same-origin POST without pressing Check. Thus the requirement of an explicit user action is easy to bypass. This does not remove the overall cap and does not mean unlimited spending. Fix: the URL only fills the field; the paid run is a separate action. Saved `?s=` links open for free as they do now.

**S02 · P2 - The rate limit restricts the pace but does not protect the availability of the daily budget.** 260 of 300 credits are publicly available; a check costs roughly 2-7 calls, and a small long now 4. A single source can use up the public quota in a few minutes within 20 checks/min. The global burst of 10/10s does not spread the budget across the day. Random coin/side values create new cache keys even with a fallback to the same largest position. A read-only cache hit currently also passes through the limiter before the cache read.

Before submission: separate free retrieval of a ready reading from the limit on new computations, apply the limits to expensive cache misses, normalise/reject a non-existent focus, and have a pre-verified reserve for the demo. Under public traffic - a progressive Turnstile after a suspicious rate and a spending quota, not a mandatory CAPTCHA for everyone. Logins are not needed for this task.

**S03 · P2 - The demo secret is passed in the query string, but the UI does not use it.** [index.ts:338](../../src/index.ts#L338). A query parameter can end up in history/logs/a screencast. The comparison accepts an empty DEMO_KEY with `?demo=`. At the same time the standard `runCheck`/`checkPosition` do not pass the parameter at all: the presence of a reserve in the config does not mean that a demo recorded through the UI will be able to use it. The presence of the secret in production was not checked. Fix: a non-empty secret in a header, a protected operator way of enabling the mode without the URL, a separate access check before the demo, and no secret in the recording. Access to the reserve must not depend on an already exhausted public burst limit.

**S04 · P2 - The CPU fallback for OG promises too much.** A `try/catch` around satori/resvg does not guarantee that the fallback is served when the isolate is stopped because of CPU. Cloudflare [specifies Error 1102 and termination of execution when the limit is exceeded](https://developers.cloudflare.com/workers/platform/limits/); Free allows 10 ms of CPU. The project has already documented render measurements above this. A fresh OG rendered successfully in this audit, but that is one successful request, not a guarantee on a cold isolate. On Free, serve the static fallback immediately for a cache miss, or move generation to an environment with enough CPU. Do not set a one-year immutable cache for a temporary fallback. Check precisely the cold path and the absence of a cache entry, not only the gallery with pre-loaded images.

**S05 · P2 - Real runtime checks are needed before production.** Vitest runs with `environment: node`; the fake KV/DO are useful but do not model input/output gates, eviction, eventual consistency, request termination and quotas. For the budget, the recommendations of the `durable-objects` skill were also used. I do not demand a migration of all tests: a few integration scenarios on workerd/Miniflare are enough - concurrent reserve/settle, client abort, a repeated settle, an object restart, a KV failure, a stale negative read of a snapshot. One cannot conclude from 402 Node tests that the correctness of all runtime concurrency is proven.

**S06 · P2 - Observability lags behind the complexity of the fallback branches.** Logs are enabled, but there are no stable metrics for latency p50/p95, cache hit, degraded share, reasons for Unknown, spend per full result, budget refusals and save/OG errors. `safeKv.degraded` is practically not used for visibility into the service's operation. Add structured events without keys and without unnecessary personal data; sampled traces are useful once meaningful events exist. There is no need to show these technical indicators to the end reader of a card.

**Code and architecture: what to simplify.**

The pure engine functions and the sources/normalize separation are already good. The main technical debt is not the absence of a framework but the mixing of meanings: account features, features of the selected position, data completeness and the wording of the verdict live in one long flow. `check.ts` is about 643 lines, `index.ts` about 570, `app.js` 1 250. At the next change it is enough to separate collecting the observation, applying the rules and building the presentation model. The same solves the single content for card/PNG/OG.

The contracts needed: `accountFeatures`, `positionFeatures`, `sourceCoverage`, `observationId`, `interpretationId`, `question`. Reason codes are better typed as a union type; names and explanations should be stored centrally. Right now the strings are repeated on the backend and the frontend, and fixing the rules does not necessarily fix the headline. External data needs checks of structure and semantic ranges, especially balances/orders/fills. The hand-written Env could be generated from Wrangler, but that is lower in priority than the correctness of the conclusions.

The comments contain a lot of history from past audits. Keep the useful invariants next to the code, move the long history into an audit/ADR. The documentation has already become a separate body that easily contradicts the implementation: the checklist still speaks of 339 tests, the README of seven failed calls when 1 117−1 109=8, the demo-script describes the previous texts and actions. For submission, one short launch path and one up-to-date script are needed.

The checked `/api/gallery` response is **730 831 bytes of uncompressed JSON**, although only 25 rows are visible at first. Full cards with all the explanations are transferred. Brotli is enabled, so this is not the size of the network traffic; Lighthouse/Core Web Vitals were not measured here. Serve a compact index for the list, and fetch the full card through the existing `/api/snapshot`. Load the ledger below the main scenario. The global spot/perp metadata can be cached briefly, separately from personal readings, explicitly storing the quote time. This is more useful than a heavy UI library.

The budget numbers `WORST_CASE_CALLS=7` and the assumption "one unknown call = one credit" currently agree with the live ledger reviewed. If the endpoints/costs change, it is the upper-bound cost that must be checked, not only the number of calls. This is an operational invariant, not an overspend found in this session.

**Mechanics that suit this particular product.**

| Idea | Benefit | When |
|---|---|---|
| An explicit subject of the check: "this address's ETH short" | Removes the answer about a different position, makes the conclusion verifiable | Before submission |
| Two levels of answer: "what is visible" and "how completely it was checked" | Unknown stops mixing absent data with a substantive result | Before submission, without new endpoints |
| Show Nansen's contribution to the conclusion | The judge understands which data changed the available conclusion | Before submission |
| 3-4 carefully chosen fresh examples | A person without an address understands the value in 20 seconds | Before submission |
| A correct comparison of the same position | A genuine reason to come back after news | After L02/L03 |
| The next verifiable question | For example: "there is spot coverage, but the debt leg is unknown" | First as text on the existing data |
| A watchlist in the browser | Quickly return to 3-5 positions of interest without registration | After submission; recent already provides the basis |
| A history of several observations of orders | Distinguishes sustained market making from a single snapshot | After submission, with a cost model |
| Pasting the text of a post with an address and selecting the market found | Links the real entry point with the right question | After the basic fixes |

"Nansen's contribution" should be shown honestly: separately, which dex positions became visible, which supported balances were checked and which funding links were found. If the with/without Nansen modes are compared, use one fixed observation and explicitly show the unavailability of part of the sources. Blocking bet with Nansen disabled because of `positionsCoverage=partial` does not by itself prove that Nansen discovered an economically different situation.

Unknown does not need to be removed artificially. It should be spelled out: "not enough data", "there is partial coverage", "assets found at a funder, ownership not established", "a mixed portfolio". The internal four verdicts can remain; the user is shown the specific detected state first. For Hedged the visible name "Spot-covered" is better, and for Book "Market-making activity", if the link to the position is not yet established.

Of the new mechanics I would **not add before submission**: trading and wallet connection, auto-copying, an up/down probability, a copy-score 0-100, a general-purpose AI chat, a Telegram bot, automatic scraping of X, a multichain terminal and a new registration system. They do not close the errors found and dilute the main question. Funding age and PnL I would keep as additional information if the user expanded the details. Expanding the Nansen integration should be judged by which user question it solves, not by the number of endpoints.

**How strong a submission this is for Nansen.**

The [contest page](https://nansen.ai/campaigns/meridian-buildathon) has four equally weighted criteria: data integration, originality, workability, documentation and submission. Integration assesses the data's influence on the logic, not the presence of a logo; the demonstration must be understandable and work from start to finish. This is a very suitable set of criteria for Bet or Book.

My subjective assessment of the current readiness, **not a forecast of the judges and not a probability of winning**:

| Criterion | Score | What prevents a higher one |
|---|---|---|
| Nansen integration | 7/10 | Genuinely needed for the full set of positions, balances and funding links, but the contribution is often not visible to the visitor |
| Originality | 8/10 | A narrow, understandable question and an evidence-based diagram; there is no basis to claim that there are no analogues among all the submissions |
| Workability | 6.5/10 | The live path works, the tests are strong; errors of focus, snapshots, claims and the first render remain |
| Documentation and submission | 7/10 | Detailed engineering documentation exists; per the local checklist the video and the submission are not yet completed, the script is outdated |

The main Data Integration risk is visible in the sample itself: **159 of the 183 current cards are longs (87%)**, and all seven Hedged use Hyperliquid spot that was found. This does not make Nansen unnecessary: it provides positions on the dex, the check of on-chain balances and the links that constrain the conclusion. But demonstrating only a HYPE hedge and an ordinary single long means showing the merits of the integration poorly. The two new calls for funding age add context but do not turn it into controlling logic: `computeVerdict` does not read fundingContext.

A strong storyline for the video: one understandable headline → the selected position → what could be established from Nansen + Hyperliquid → why a narrower conclusion follows from this → we save the evidence. Then very briefly show a different type of result. The complex case with a funder is good as proof of depth after the first simple successful example. Do not start with a long Unknown without explaining what exactly was established.

For 50-60 seconds I would allocate the time like this: 0-5 the problem; 5-15 a real live check with the time visible; 15-30 one finding that changes the understanding of the position; 30-42 a contrasting, dated example; 42-52 the exact saved evidence; 52-60 the name, the site address and GitHub. Rehearsing the script beforehand is fine. If the answer is taken from the cache or the archive, that must be visible; a rehearsal should not be forbidden under the pretext of honesty. A recording with a real live load and honest labelling matters more than an unverified take.

The local checklist notes a Nansen email of 23 September about lowering the minimum from 1 000 to 100 calls. The public landing page as read still showed 1 000. I have not seen the email and do not independently confirm its content. There is no practical problem: the public ledger during the audit showed **1 154 calls, 1 146 successful** (1 109 scripted + 37 live), which is above both thresholds. This is the project's own counter; confirmation on Nansen's side remains a separate step. The deadline time of 23:59 UTC from the checklist could not be independently re-checked against the FAQ in this session; the landing page confirms the dates 14-27 September.

A correction to the previous audit on licensing: the [redistribution guidelines](https://docs.nansen.ai/mcp/redistribution-guidelines) distinguish permitted wallet profiler data from restricted/prohibited Smart Money data. **A general prohibition of any table of ordinary wallets with PnL does not follow** from this page. So I do not call the current gallery a violation merely because of how it looks. Removing the ranking and PnL from the first screen is reasonable for product reasons. Do not turn the project into a Smart Money leaderboard without a separate check of the terms of the specific endpoints. Attribution is present in the product.

The weakest point of the scientific part is that there is no independent validation of the rules. 402 tests prove that the programmed rules execute on the scenarios, but do not prove that these rules determine the economic meaning of positions well. The three original accounts used for tuning are a smoke test. Before submission it is more useful to manually work through 12-20 different cases (especially ones that contradict the expected answer) than to add a hundred tests on the same thresholds. Record which conclusions are confirmed by the observed data, where there is only a plausible interpretation and where the tool must abstain. A trader's real intentions often have no accessible ground truth.

**The order of work I would choose.**

1. Fix the subject of the answer and the history: L02-L04, U03. This is a single package: the question, the selected position, snapshot identity, a correct comparison.
2. Fix the boundaries of a confident conclusion: L01, L05, L06, then L07 and the net/coverage wording. Add precisely the counterexamples from this audit as regressions.
3. Close the first render and distribution: U01/U02, the same date/limits of the conclusion on all images; a ban on auto-starting a paid check from the URL.
4. Re-read 3-4 demonstration addresses, keeping the old snapshots. In the first selection show the new vitals and Nansen's contribution, move the archive lower.
5. Shorten the README to an understandable entry point and links to the details; update the demo-script/checklist. Pin down a working way of accessing the reserve and check the cold OG path.
6. Give five people who have not read the README 30 seconds to explain the card in their own words. Ask: "is this a signal to buy/sell?", "where was the coverage found?", "who owns the linked assets?", "what time are the data from?". A wrong answer means a problem of text or hierarchy, not insufficient preparation of the user.
7. Record the video, check the submission and send it before the deadline. Plan the watchlist, the time history of quotes and new sources for after submission.

If time is short, the mandatory minimum is fidelity to the selected position, stability of the saved link, cautious wording for Book, a readable first screen and a strong live example. The project already has enough functionality for a good submission. The next gain in quality will come from the accuracy of what it promises and shows.
