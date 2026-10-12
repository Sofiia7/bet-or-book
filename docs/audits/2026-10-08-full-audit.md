# Bet or Book - pre-Colosseum audit, 8 October 2026

**Conclusion:** a strong engineering foundation and a useful narrow question are already in place. The main remaining risks are several errors at data boundaries, stale rankings, a path from shared link to a useful answer that is too long, and the absence of verified demand. Before submission it matters more to finish one scenario - "saw a whale alert → checked the position → understood what the headline does not prove → shared the evidence" - than to add trading or one more analytics dashboard.

This is an audit and a plan, not a release of fixes. The application code and production were not changed. Added: this document, a standalone reproduction script and its JSON result.

## 1. What was checked and what was proven

- Repository at `185d0dc`: README, current submission materials, previous audits; the main observe → interpret → present chains, classifier, normalization/validation, comparison, budget, routes, saving and frontend.
- Production `bet-or-book.trade`: main screen, saved hedge, linked-wallet Unknown, Explore, opening Share and the error on a transaction hash. Viewed on desktop and at 390/320 px viewport.
- `npm run typecheck`: passed.
- `npm test`: **645/645**, 47 files.
- `npm run test:runtime`: **9/9**, real workerd via Miniflare; this run took 189 seconds. The harness performs a Wrangler dry run before the runtime tests.
- `npm audit`: **0 known vulnerabilities** across the whole dependency tree at the time of the check; the production audit is also 0.
- Production HTTP headers: CSP, HSTS, Referrer-Policy, Permissions-Policy, nosniff are present.
- All four featured `/api/snapshot` responses returned 200, `degraded=false`, rules v7; their `/api/og` responses returned 200 with `image/png`. This is an availability check, not a statement about the visual content of all the PNGs.
- Separate offline probes confirmed the defects below. Run: `node --import tsx docs/audits/2026-10-08-reproduce.ts`. Result: `2026-10-08-evidence.json` next to this file.

**Boundaries:** this is an expert product/code/UI audit, not research with real users, not an independent labelling of the true strategies of wallets, not a pentest and not a measurement of field Core Web Vitals. No new paid live checks were run in this audit; the remaining Nansen balance, the current account settings/WAF and the state of the submission in the dashboard were not checked. The UX effects and commercial suggestions below are hypotheses unless explicitly marked as measured or reproduced.

## 2. Deadline and contest requirements

The official rules say: **12 October 2026, 23:59 PT**, which is **13 October, 08:59 Europe/Budapest**. The working internal deadline is **12 October, 18:00 Budapest time**: submit the application and get confirmation, leaving a margin before closing.

Sources: [contest page](https://colosseum.com/worldsfair), [official rules, §5-8](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf), [FAQ and criteria](https://colosseum.com/hackathon).

The contest is open to different blockchain ecosystems. Adding Solana for general eligibility is not required. Specific special tracks should be checked against the submission form; the existence of a suitable Hyperliquid track is not confirmed in this audit.

Colosseum evaluates product, insight, founder/market fit, market, business, communication and traction. Hence the priority: a clear user result + a credible demonstration + real evidence of demand. The number of tests alone does not replace this.

`docs/submission-materials.md`, `docs/demo-script.md` and `docs/submission-checklist.md` are already prepared. The existence of a script does not mean the video is recorded, and the existence of a checklist does not mean the application is submitted. Check registration, the availability of the repo and the two videos, the team composition, the actual place of residence and the sending of the form. The FAQ asks for a 2-3 minute pitch and a separate product demo of up to 3 minutes.

The history of participation in Nansen should be disclosed. At the same time one should not wrongly say that only October changes count at Colosseum: the declared project start of 17 September is after the contest start of 14 September. An exact timeline of development and of previous submissions is needed, not a devaluation of the September work. Dates, the outcome of the earlier contest and statements on behalf of the team are confirmed by the founder.

## 3. Confirmed technical findings

Priorities: P1 - fix before recording the final demo; P2 - a small improvement after P1, or explicitly describe the limitation. There is no claim here that a critical exploit was found.

### A01 · P1 · Hedged is allowed when the perp position list is incomplete

**Where:** `src/engine/verdict.ts:377`; `src/api/observe.ts:236`.

The `positionsCoverage` check is performed for Bet but not before Hedged. Offline probe: the current saved hedge keeps all its data except `positionsCoverage = 'partial'`; the classifier keeps `hedged / hedge_leg`.

A real possible path: the Nansen positions request failed → main-dex fallback → the balances request succeeded. Spot may cover the visible short, but an invisible opposing perp leg changes the total exposure. This contradicts the project's own principle: discovered opposing perps currently block the exposure verdict.

**Fix:** show the observed fact separately - "found X spot against the visible short"; do not give a final exposure verdict when relevant perp legs are unknown. The shortest safe path before the deadline is a coverage gate before Hedged. Later, refine completeness at the level of the selected asset so as not to block the answer because of an irrelevant position.

**Acceptance:** Nansen positions fail + balances success does not yield Hedged; the number for the found spot is preserved; the complete case keeps working.

### A02 · P1 · The validator accepts numeric strings, the normalizer silently loses the balance

**Where:** `src/sources/validate.ts:158`, `src/sources/normalize.ts:240`.

`checkNansenBalances` accepts `token_amount: '100'`, `value_usd: '300000'`: malformed = 0. `normalizeNansenBalances` checks `Number.isFinite` directly on the string and drops the record. In the probe an identical WETH balance gives coverage **100%** with numbers and **0%** with strings.

This is a confirmed inconsistency in how the shape of upstream data is handled. **It is not established that the current Nansen actually sends these fields as strings**; the defect was reproduced synthetically. The danger: the string passed the completeness check but vanished as if it had never existed.

**Fix:** either normalize numbers at the boundary and hand downstream an already-validated type, or reject such strings with incomplete coverage. Invariant: an accepted positive record does not silently disappear.

### A03 · P1 · Market makers shows the absence of a measurement as $0

**Where:** `src/gallery.ts:129`; `web/app.js:1339`, `web/app.js:1483`.

Historical Book v4 readings do not contain `headlineTwoSidedNotionalUsd`; the API replaces the absence with 0. After history was included in the boards, the old assumption "such rows will not reach the ranking" stopped holding. Production shows two `Book (strong)` entries with **$0 matched** under an explanation of two-sided quoting in the selected market specifically.

This is not only a visual contradiction: the user sees a false measurement. Zero volume and unknown volume are different states.

**Fix:** a nullable metric; `Not measured in this reading`. Admit only comparable evidence into the main comparison table. Leave historical Book readings in the archive with a historical explanation. Do not recompute old verdicts from missing data.

**Acceptance:** a value that was not obtained never becomes `$0`; sorting does not compare missing values with measured ones; the board text matches the rules of the included rows.

### A04 · P1 for retention · A change in the Unknown reason is lost

**Where:** `src/engine/compare.ts:170`; output in `web/app.js:475`.

The comparison checks only class and strength. The probe changes `Unknown / hedge_not_checked` to `Unknown / linked_exposure_unverified`: `changes=[]`, `verdictChange=null`. The user gets "the answer did not change" although there is now a specific explanation instead of unavailable data.

**Fix:** compare the semantic state - main reason/qualifier, completeness, the chosen subject of the reading. Output "same class, the basis changed". Do not turn every technical reshuffle of the reasons list into an event.

### A05 · P2 · The comparison attribution does not include linkedHedgeCoverage

**Where:** `src/engine/compare.ts:157`; the shared mapper is `src/engine/observation.ts:125`.

`verdictInputOf` passes the field to the classifier, while the manual copy of fields in compare skips it. Probe: numerically the same data, the funder search finished, Unknown → Bet. The comparison answers `the cause could not be established`. With a simultaneous version change it may wrongly attribute the change to the rules alone.

**Fix:** use a single mapper of classifier inputs and normalize the comparison separately; add the exact explanation "the data search finished". Do not call this a trading action of the wallet owner.

### A06 · P2 · An empty main dex turns into Nothing open right now

**Where:** `src/engine/presentation.ts:29`; `src/engine/verdict.ts:314`.

The headline does not take partial positions into account. On a fallback to the main dex with zero positions it says that nothing is open at all, although HIP-3 was not checked. The class stays Unknown, but the main text is stronger than the evidence.

**Fix:** "No open positions found on the main dex. Other venues could not be checked". For an old snapshot additionally use the time of the reading itself, not right now.

## 4. The inference model: what to change carefully

### Freshness is part of quality, not only a caption

`src/api/observe.ts:248` marks an old timestamp as degraded, but `positionsCoverage` stays complete and freshness itself does not enter the classifier. A conclusion from old positions and new holdings/orders is possible. This is an inference from the code; a case of a false production verdict was not reproduced in this audit.

Before the deadline: an explicit state "data from different moments; conclusion is preliminary" next to the badge and date; define the allowed age/divergence and do not give a confident exposure verdict beyond it. The 15 minute threshold for the warning already exists, but its financial justification was not independently verified. Do not replace the old source timestamp with the time of the new request.

### Book is observable quoting, not knowledge of intent

The current logic is substantially better than the early one: reduce-only orders and triggers are excluded, and substantial two-sided activity in the selected market is required. Keep this.

However, the notional of resting orders does not take into account the distance from the market, the stability of the quotes and the time over which they were observed: `computeOrderFeatures` receives already simplified orders. A single snapshot does not prove that the whole position is inventory. Before the deadline improve the wording: "Market-making evidence / likely inventory", and explain that strong means a coincidence of signals, not a statistical probability. Do not invent a confidence of 92% and do not add an arbitrary spread threshold for the sake of a nice badge.

After the contest: repeated quoting snapshots, distance to mid, independent cases for calibration, and precision/abstention by class.

### Hedged is better disclosed as spot coverage

85-115% is a heuristic band, not a guarantee of neutrality or safety. In the UI it is better to say `Spot-covered short`, with the percentage and the remainder; the API code `hedged` can be temporarily kept. Lending receipts, external debts, collateral and liquidation remain separate questions. A green badge must not mean "can be copied".

### Unknown has several useful outcomes

The project already shows clarifications and specific headlines; there is no need to "add Unknown reasons" again. The next step is to make the found fact the main one:

- "Covered 62%; $X remains unmatched";
- "More spot than short; visible residual is long";
- "Matching assets found at funders; ownership unverified";
- "Data incomplete; retry may resolve it";
- "Mixed exposure; evidence does not settle strategy".

Keep the internal reasons, but separate the user actions: a retry is useful when a source failed, while the question of wallet ownership is usually not solved by repeating the same request. Do not weaken the Bet conditions just to get a smaller share of Unknown.

### Scope of the selected position

Currently any positive `sameAssetOffsetShare` across the account can stop a conclusion about the selected position; this is an intentional conservative guard. The next step in development is to account for the relevant opposing legs for the selected asset. Do not remove the guard without such a calculation.

`MAX_CANDIDATES = 5` limits the UI to the five largest positions. For the scenario "came from a BTC alert, but BTC is sixth", `All positions`/search by asset is needed. The API can already handle coin/side; the selection mechanism can be extended without a new class of analysis. Before the deadline - only if confirmed by a real user case.

HIP-3 verification by whitelist suffix (`AAPL`, `SP500`, etc.) is not a full registry with venue/deployer/oracle. For now formulate the support precisely; postpone the full identity model and multi-asset delta hedges.

## 5. The actual state of the showcase

Production `/api/gallery` during the audit: **278 entries + 4 featured**; of this total **277 are historical**, one is a non-historical entry with no open positions, and four are fresh showcases with open positions. This is not 282 users, not the number of live checks and not a current market overview.

The four active featured readings from 7 October:

| Reading | Result | Paid calls in the record |
|---|---|---:|
| $122.1M HYPE long | Looks like a bet | 4 |
| $57.3M HYPE short | Hedged | 3 |
| $212.1M ETH short | Unknown: assets sit with funders | 7 |
| $66.1M ETH short | Unknown: busy, not proven inventory | 7 |

**There is no fresh Book among the showcase.** This is an honest result, not a reason to change the thresholds. For the demo one can show a dated historical case, explicitly calling it historical, or find a fresh one with sufficient evidence within budget. If there is no such case, build the video around bet, spot cover and funder ambiguity. The current pitch still mentions a separate account with confirmed inventory: check it against the scenes before recording.

Recommendation for Explore: the first tab `Recent case studies`, with 4-8 selected breakdowns that have dates and a short "what this case explains"; a separate tab `Archive`. Keep the ranking inside a comparable set. If a general historical board is kept, name it `Historical examples` and remove the promise of an exact comparative ranking. A mass rescan of hundreds of wallets just to fill the page is not needed.

## 6. Product, audience and positioning

**Primary user for this sprint:** a person who has already seen a specific Hyperliquid whale alert with an address and an asset. Their task is to quickly check the interpretation of the headline. They do not come to "research all wallets" and do not want to first study the classifier taxonomy.

**Second segment / possible buyer:** the author of a whale-alert channel or an analyst who needs to attach verifiable context to a publication. A repeatable workflow here is more convincing than the hypothesis that a mass audience will pay for a rare address check. This is a commercial hypothesis, not established demand.

Hero variant: **“A whale’s short isn’t always a bearish bet.”** Under it: “Check the position, matching spot and market-making activity. See what the evidence supports.” CTA: `Check position`; secondary: `See a real example`.

`Don’t Get Rekt Copytrading` appeals to a crypto-native audience but makes a broad promise of protection from losses. It can be kept as a campaign slogan, while the first product screen is devoted to the specific check. Keep the name Bet or Book, explaining Book as market-making inventory.

Nansen already offers Hyperliquid Profiler, positions, PnL, risk and alerts: [official changelog](https://academy.nansen.ai/en/changelog), [official documentation](https://docs.nansen.ai/api/hyperliquid). So adding another ten of the same metrics differentiates the product weakly. A possible specialization for Bet or Book is a short check of the interpretation of a whale alert, with reproducible dated evidence, ownership boundaries and an explanation of changes. The uniqueness of this offer still has to be tested with users and a competitive review; this document does not claim that competitors cannot do anything similar.

For the application, explain the development path: consumer evidence card → analyst workflow → paid API/embedded context for channels/terminals. Do not present the current internal `/api/*` as a ready commercial API with keys, pricing, SLA and contractual data rights.

## 7. CJM: where the user goes and where they are lost

| Stage | What already works | Friction | Proposed change |
|---|---|---|---|
| Saw an alert | Clear link to the whale headline | There may be no address | An example post and a hint on where to get the address; later an extension/bot |
| Came via a link to a reading | Dated permalink | The form and hero are at the top again | Result first, a compact `Check another` |
| Pasted a wallet/link | Addresses and links are supported, the tx hash error is correct | Several addresses in the text select the first one; a tweet URL alone is not read | Briefly show the chosen address; for several, a simple choice |
| Chose a position | Chips exist | Only the top 5, selection after the full read | Asset selector / All positions when needed |
| Waiting | Progress without an invented percentage, guess is optional | Up to 45 seconds; no sense of when to expect the result | An honest message after 5-10 seconds; an explanation of a partial answer and access to a saved case |
| Reads the result | Summary, numbers, sources, caveats | Repetition, jargon, a long card | One main fact, 2-3 pieces of evidence, a concrete limitation |
| Wants to act | Share, PNG, watchlist | Share is deep; it is unclear what gets saved | Share/Save next to the conclusion; a description of the saved watchlist |
| Comes back | Recent checks and a manual re-check | The watchlist shows short addresses | Save the asset, label, last snapshot and the age of the reading |
| Gets an update | Comparison exists | No automatic alerts; Unknown reasons are lost | Fix compare; then test demand for budgeted alerts |

On a 390 px viewport, with an existing recent-check chip, the direct linked-wallet permalink had `cardTop ≈ 634px`, `shareTop ≈ 2769px`, body height ≈ 3418px. This is a measurement of a specific state, not a universal figure for all devices. Even without the recent chip the point stands: a shared reading should show the answer before the new-search form.

At 320 px the main screen had no horizontal overflow when checking the error: clientWidth = scrollWidth = 305 px at a 320 px viewport. The transaction hash was correctly rejected, `aria-invalid=true`; the message was shown in status. These are good properties; keep them.

## 8. UI, visuals and clarity

### Recommended card order

1. Asset/side/size, address, relative age + exact time.
2. One concrete conclusion in plain language.
3. Two or three pieces of evidence: what we observe, what it explains, what we do not know.
4. Share / Save / Refresh with an exact freshness label.
5. The diagram as an additional explanation.
6. Compact risk context: at most 2-3 needed metrics; the rest inside Full analysis.
7. Full rules, provenance and technical details.

A material limitation of the conclusion must stay next to the conclusion itself. What needs simplifying is repetition, not hiding the absence of data.

### Constellation

Visually recognisable and suitable for a card in a feed. But the lines and dots are generated from the address seed; they do not depict the actual graph of wallet links. The legend currently explains the sides but not this aspect. A user may take the artistic links for transactional evidence.

Before the deadline: labels directly at the sides (`Short position`, `Matching spot at this address`, `At funders - ownership unverified`), explicit amounts, a lower height on phones, and the phrase "illustration of coverage" if needed. Do not build a new complex network visualization. If a user cannot explain the drawing in 5 seconds, test a variant with a compact coverage strip and a separate funders block.

For a long, `0% covered` results by the definition of the spot metric, not from a comprehensive search for a short hedge. It is better to say `Spot coverage: not applicable to a long` and add a separate description of the discovered offsets. Do not draw the absence of a check as a proven zero hedge.

For Book the figure on the right is matched quoting, for a short it is spot coverage. These are different units of meaning: the legend must change together with the diagram type; orders must not be called "matching holdings".

### Noise reduction

- Size/percentage are repeated in the summary, the drawing and the evidence. At the first level keep each piece of evidence once.
- Leverage, liquidation distance, PnL, funding, OI, volume, premium and account margin must not be on an equal footing with the conclusion.
- Remove the repeated Nansen credits/call counts from the main user path, keeping the required attribution and the source next to the facts.
- A glossary already exists; explain important terms such as Book directly in context, without requiring the user to find the glossary inside Full analysis.
- Keep the date exact and add `read yesterday`/`19 days old`; a raw `v7` does not replace an explanation of how current the reading is.
- `Best covered shorts` sounds like quality/safety, while the sort simply descends by ratio. Better is `Shorts with matching spot`; if ranking by closeness to parity, use the residual, not "the higher the better".

A full redesign is not needed. Keep the dark theme, the calm typography, the limited verdict colors and the clear form. The next visual work is hierarchy, mobile density, concrete labels and empty/error states.

## 9. Engagement and mechanics

### Do now or improve what exists

**Evidence takeaway.** One line, "what the headline does not prove": for funders - matching assets exist, but ownership is not established; for spot cover - a large short is not the same as an equally clean bearish exposure. The existing summary gives facts; the takeaway links them to the user's question.

**Three contrasting cases.** On the first screen: Bet / Spot-covered / Ownership unclear. Each with a question before opening and a short explanation after. This demonstrates the product better than five historical rankings. Keep the fourth case as a deeper example.

**Saved positions.** Improve the existing watchlist: human label, coin/side, snapshot ID, last checked, open for free / refresh separately. Currently it stores the address and only fills in the field. Do not promise monitoring or alerts that do not exist.

**Share with the main fact.** The saved date, the limitation and a link to the evidence. Move the action closer to the result. First remove the loss at the transition from the shared link, then discuss growth through sharing.

### After demand is verified

**Meaningful-change alerts.** The position size, spot coverage, side, data quality or reason changed; do not notify merely because of new rules. A budget-aware schedule, address deduplication, manual refresh kept separate. Start with a small pilot, do not enable mass background paid checks.

**Claim checker.** The user specifies an asset and a claim from a post; the tool shows what is confirmed. Before the deadline a field/example without an LLM can be provided. Do not promise to read any X URL if there is no post parsing and no source of the address.

**Publisher widget / bot.** A context card next to an alert, if real authors are found who are ready to use it. This is the next channel, not a reason to write a standalone social network now.

**Case of the day / learning.** Free saved cases, a guess first, then the evidence. The current guess during loading can be kept, but should not be made the central retention mechanic: hidden data cannot be guessed, and a match with the heuristic does not prove correct knowledge of the true strategy.

### Do not add before the contest

Trading and copytrade execution, wallet connect without necessity, a token/points/referral economy, a PnL leaderboard of users, an AI chat about everything, a social feed, a new network for the sake of a logo, mass live scans, full owner attribution, a derivatives/options risk engine. These directions add scope of work before the core need has been verified.

## 10. Reliability, cost, security and architecture

### The main operational risk is the availability of a full answer

Config: cap 80, operator reserve 40, account floor 100. Public budget = 40, reservation = 18 per fresh check. In an isolated sequential simulation, without cache hits, operator traffic and exhaustion of the account balance:

| Real price of a fresh check | How many fit before the next reserve is refused | Spent |
|---:|---:|---:|
| 3 credits | 8 | 24 |
| 4 credits | 6 | 24 |
| 7 credits | 4 | 28 |

This is correct conservative protection: one cannot reserve 18 when the remaining public capacity is 12. But the product can degrade after a few new public checks even when the daily cap is nominally not yet spent. Cache hits and saved cases do not carry this cost. This is a calculation from the config, **not a measurement of today's production balance**.

Before the deadline: check the balance and the reserve for the judging days, consciously choose the public budget; when a full check is unavailable, offer a saved case and honestly state the limitation. Do not present "Unknown" as a property of the wallet if the cause is the application's budget. Do not lower the worst-case reserve without staged spend control.

Afterwards: do not buy PnL/funding context before the main classification is obtained, lazy optional reads, reuse the observation when choosing an asset, stage-level reservation. This could reduce cost/latency, but requires budget verification under cancellations and retries.

### What to keep

- Separation of observe/interpret/present and versioned observations.
- An atomic spend ledger in a Durable Object, reserve/settle, retry accounting.
- POST for paid work, read-only saved examples, cache and saved links.
- Source boundaries, separate ownership of funder assets, fail-soft presentation.
- Real workerd tests and CI; a hand-written Node emulation does not replace the runtime.
- Self-hosted fonts, a small browser bundle (~44.5 KB minified without compression in this build), an on-demand gallery.

### What else to check before release

- Whether the prepared WAF/rate-limit configuration has been applied. `docs/cloudflare-edge-protection.md` says "prepared but not applied"; the current dashboard was not checked.
- Full data budget/DEMO access and ordinary judge access without an operator key.
- For a fresh snapshot, OG may depend on a background render; for the demo use verified precached examples. Do not treat the published old PNGs as proof that a fresh OG always fits within the runtime CPU limit.
- Client timeout/recovery after a hung GET. There is a backend deadline, but the browser fetch in `load()` is not itself bounded by an AbortController.
- A small browser regression suite: shared link → result, mobile invalid input, history/back, incomplete banner, saved Share. Most of the existing UI tests check code/strings, not the whole rendered user chain.

Do not migrate the frontend to a new framework and do not rewrite the DO onto RPC just for style before the deadline. Afterwards: split the large `web/app.js` into transport/state/presentation/watchlist/share, reuse DTOs and metric semantics; remove manual copies of classifier inputs. Production blast radius and technical debt matter more than decorative refactoring.

## 11. Demand, metrics and commercial verification

`submission-materials.md` cites small figures from the 7 October audit; these are not freshly confirmed analytics from this audit. The number of gallery snapshots and Nansen calls cannot be passed off as users/traction. Do not count your own test operator actions and crawlers as activation.

In the remaining time run **5-8 short sessions**: 3-5 whale-alert readers, 2 authors/analysts, and if possible one terminal builder. This is a target research volume, not completed work.

Task: give a real alert and ask them to find out the asset/side, what is actually known about the hedge, and how confidently the position can be interpreted. Do not explain the interface beforehand. Observe: where they stopped; whether they understood the own/funder distinction; whether they found the date; whether they treat Hedged as a recommendation to copy; whether they can retell the result in 20-30 seconds. Afterwards ask for a second case of their own and ask when they would use the tool again.

Record actual quotes and actions, with the participants' consent. For a publisher a stronger signal is readiness to use the card in the next publication or to agree a pilot than "a nice website". Do not invent partnerships or paying users.

Minimal funnel: `landing_view → example_open/check_start → reading_view → share_copy/watch_save → repeat_read`. Distinguish entry from a shared link, an example and a fresh check, cache hit, incomplete, operator. Current backend telemetry counts technical work well, but does not measure the whole user chain.

Benchmarks for the next iteration, not promises: how many people correctly understand the conclusion without help; time to the first understandable answer; the share of repeat opens; the cost of a full fresh answer; how many share links were opened by other people. Do not set the effect of the redesign in advance and do not claim statistical accuracy on a small sample.

Business hypothesis: saved readings are free; checks are limited; a paid author/analyst workflow or an API/widget pilot. Do not set a price out of thin air. For commercial embedding, separately verify the data provider's rights, account limits, the cost of a successful answer and support.

## 12. Plan until submission

The estimates below are an order of effort for one developer, not a guarantee. **The mandatory set is ≈ 20-30 hours**, including stabilization, materials and communication. If there is less time, remove the optional mechanics and shrink the showcase rather than postpone the submission.

| When, Budapest | Result | Priority and estimate |
|---|---|---|
| 8 October | A01-A03, consistent completeness/normalization/gallery; a list of real interviews | P1, 4-6 h |
| 9 October | A04-A06, stale-state wording; result-first shared links; Share higher up; compact risks | P1/P2, 4-6 h |
| 10 October | 5-8 user sessions; 3 clear cases; actual feedback; if time allows, an improvement of Saved positions | Demand check 3-4 h; optional watchlist another 2-3 h |
| 11 October | Dated final examples, regression smoke, judging budget, final pitch/demo and recording | 5-7 h |
| 12 October until 18:00 | Videos/links are accessible, repo and disclosure are aligned, the application is submitted, confirmation is saved | 2-3 h + buffer |
| After submission until closing | Only breakages, availability and fixes to materials | No new subsystems |

The morning of 13 October is a reserve, not planned time for the main work.

### Definition of done

- A01-A06 are no longer confirmed in the reproductions; new tests check boundaries, not a string copy of the implementation.
- A shared link immediately shows the subject of the reading, the conclusion and the time; 390/320 px, keyboard and Back do not break.
- Missing/partial/stale do not look like a proven absence of an asset/positions.
- No `$0` in place of not measured, and no "current" rankings built on old incomparable rules.
- Three working, honest cases; the video scenario matches today's saved data.
- The public fresh check, the budget-off path and recovery are verified before recording, within the agreed credit budget.
- The 645 baseline tests plus targeted regression tests, typecheck, workerd and CI pass after the fixes.
- There is a record of observations from at least a few real users; every traction claim has provenance.
- Pitch and demo are available at their links; the application has actually been sent.

**If only three things can be done:** fix the proven data errors, show the answer and Share on the first screens, get real user cases and record a convincing demo. A useful next mechanic is returning to a saved position and explaining the change; a new trading mechanic is not needed now.
