# Bet or Book: full audit of 25 September 2026

Commit `4b0b00d` was checked, after the merge of the 25 September fixes. This is a new audit of the current product, not a repetition of the list of errors from the previous reports. Product code was not changed as part of the audit.

**Conclusion:** this is a strong, well-thought-out project for the Nansen Meridian Buildathon. Its most convincing value: explaining what hides behind a loud message about a whale's position, and providing a verifiable card for distribution. The engineering side is already stronger than the first impression of the product. The project cannot be called a proven favourite: the composition of the current entries is unknown, there is no independent check of classification quality and no confirmed user funnel. My subjective assessment of current readiness: about 7.5/10; the potential after targeted fixes and a good video: 8-9/10. This is an assessment of the product, not a probability of winning.

The most useful next step: remove several contradictions between the data and its presentation, make the first result clearer, and finish the contest submission. Adding yet another large section would bring less benefit now.

## What was checked and what was confirmed

- README, architecture, rules, sources, API, storage, budget, tests, frontend, gallery data, submission documents and the latest fixes.
- The public site in a browser: the starting card, mobile size 390 × 844, the saved hedge, a real live-check, loading states, text and graphics.
- `npm test`: **562 tests, 42 files, passed**.
- `npm run typecheck`: passed.
- `npm run test:runtime`: **9 tests passed**, with the Worker built through Wrangler and run in workerd. This is not a substitute for measuring production CPU and multi-region load.
- `npm audit --omit=dev --json`: **0 known vulnerabilities in production dependencies** per npm's response at the time of the check. This is not proof of the absence of all application vulnerabilities.
- Five additional local reproductions: the sixth-position error; an incomplete reading with 100% of coverage found; an unpriced matching asset; behaviour with debt in the position's asset; erroneous text after a failed funder read. The checks confirmed the current behaviour. They live in the ignored `.replay/audit-20260925.test.ts`, run through `.replay/audit-20260925.config.ts`, and are not added to the main test base.
- One live-check of the flagship address: snapshot `193fqdtfn166i`, `2026-09-25T05:43:17.537Z`, source Nansen, 7 calls, rules v5, `degraded=false`. Result: approximately **$207.9M ETH short**, less than 1% at this address, **$437.1M ETH** at the two wallets that funded it. This is one verified scenario, not a measurement of overall availability.
- The public `/api/ledger`: 1,173 calls at the start, 1,180 after the check. This is the application's own counter, not independent confirmation from Nansen.
- The four featured OG images: HTTP 200, specific PNGs, not the generic fallback. The public `app.js` matched the local one.
- The GitHub API confirmed that the repository is public. The video recording, the X post and the form submission were not externally confirmed; the project's checklist marks them as unfinished.

Not carried out: a study with real newcomers, independent labelling of a sample, a load attack, a full Core Web Vitals measurement, an audit of the Nansen account or a look at the secrets. The UX conclusions below are expert judgement; where an experiment is needed, this is stated.

## Priority confirmed defects

P1: fix before submission, because the meaning of the data is conveyed incorrectly. P2: a substantial improvement in quality and understanding. P3: maintainability or development after the deadline. No new confirmed P0s were found within the checked scope.

### A01. P1: the Least covered shorts ranking turns unknown coverage into zero

**Fact:** four of the top five rows of this ranking on the public site had `hedgeCoverage=partial` and the reason `hedge_not_checked`, but were shown as `0% covered`. Reproduced by reading the snapshots themselves through the public API, not only by code analysis:

| Position in the ranking | Snapshot | What is actually known |
|---|---|---|
| $30.8M HYPE short | `2vihlf2frwr3b` | partial, hedge_not_checked |
| $24.2M BTC short | `519c721d-mu721eww` | partial, hedge_not_checked |
| $17.3M ETH short | `2osdjbgu16xs9` | partial, hedge_not_checked |
| $16.0M xyz:SP500 short | `2ui4uw0akafm9` | complete; a different Unknown |
| $12.2M xyz:XYZ100 short | `1x2wuazw6krga` | partial, hedge_not_checked |

**Cause:** `src/gallery.ts:23` passes the ratio, but not the quality of its measurement. `web/app.js:1068` filters only on short and ratio < 0.1. This repeats at the UI level the very error the classifier is already protected against.

**Fix:** add `hedgeCoverage`, the asset identification state and the meaning of the reason to GalleryRow. Rank only comparable measurements. For partial, show "coverage not established", without a percentage as a final result. Until a suitable sample appears, this board can be removed.

**Done when:** no incomplete/unestablished coverage takes part in the ranking by exact ratio; an automated check uses the current real gallery rows.

### A02. P1: an existing sixth position is declared absent

**Fact:** `computePositionFeatures` keeps only the five largest positions in `candidates` (`src/engine/features.ts:44,129`). When a cached ordinary check exists, the API uses this list as the complete registry (`src/index.ts:453`). A request for a sixth, actually open position returns "No C5 long is open" and the card of the largest position, without going to the source. Reproduced on the real Worker handler with test bindings.

**For the user:** from a post about a small position one can get a denial of its existence only because the address has already been checked. The result depends on the state of the cache. Today the UI offers only the first five, so the most direct reproduction path goes through the API or a saved focus card.

**Fix:** separate `allPositionKeys` from the short selection list. Do not conclude absence from the top-5. Minimal fix: allow this optimisation only when all positions are known to be listed; otherwise run a targeted check.

**Done when:** an open sixth position is found correctly even after the cache is warmed; a genuinely closed position still gives a clear message.

### A03. P1: the diagram loses uncertainty when 100% coverage is found and when the price is unknown

Two reproduced scenarios:

1. A $1M short, $1M of spot found, but only part of the holdings read. The classifier correctly returns `Unknown / hedge_not_checked`. `exposureBreakdown` produces only the `covered` segment, because the remainder equals zero. `drawScale` does not see a `not-checked` segment and draws definite, balanced coverage.
2. There is a matching asset, but its price is unknown (`unpricedMatches=1`). The classifier returns `Unknown / unrecognised_assets`. The breakdown draws the whole $1M as `residual`, and the UI reports `Only 0% covered`.

**Code:** `src/engine/breakdown.ts:85-98`, `web/app.js:320-326`. The problem is in the contract: the fact of incomplete knowledge is encoded as the area of a segment, although it does not always have a known monetary value.

**Fix:** pass a separate state `measured / partial / unpriced / unsupported`. The diagram must read it directly, independently of the remainder in dollars. "$1M found, upper bound unknown" and "$1M, measured in full" must look different.

**Done when:** the text, the badge, the SVG, the downloaded PNG and the OG convey the uncertainty identically in both scenarios.

### A04. P2: different thresholds on the badge and the scales

`src/engine/verdict.ts:123` allows Hedged at 85-115%. But `web/app.js:346` already writes "leans long, not neutral" at 105%, while the next branch reports "level, in band". At 110% one gets one classification and a different visual explanation. The presence of a remainder at 110% is mathematically normal; it is not explained that "hedged" here means an acceptable range, not an exact zero.

**Fix:** a single presentation model of the range from the server. Show the actual residual even inside the band, for example: "110% spot coverage; $100K net long remains; within the hedge band". Do not keep the thresholds 1.05, 0.85 and 1.15 independently in different files.

### A05. P2: the Book image shows a different share than the caption

In `web/app.js:397` the fill width equals `matched / totalQuoted`, while the caption explains `matched / headlinePosition`. The visual scale and the number answer different questions. For example, fully symmetric quotes of $100K will fill the whole bar regardless of whether this relates to a $1M or a $10M position.

**Fix:** label the scale explicitly or make the scale's length equal to the position size; show bid/ask symmetry separately. For the specific demo book the main fact is useful: $42.9M matched against a $46.9M position, roughly 91%.

### A06. P2: after a funder failure the Nansen contribution claims there are no assets

`readLinkedHedge` skips a wallet whose balances could not be read, and can return an object with zero and an empty `funders`. For it, `src/engine/nansenContribution.ts:142` writes: "Funding links: read; the wallets that funded this account hold no ETH". A separate warning about the failure does not make this sentence true. Reproduced.

**Fix:** store the reading quality of linked holdings structurally: requested/read/failed/truncated/identified. Distinguish "nothing found in the part that was read" from "everything read, no matches".

### A07. P2: the Unknown qualifier is lost in the rankings and in recent

The large card explains `Unknown · assets sit with funders`, while the current recent and boards again output plain Unknown. `GalleryRow.verdict` contains only verdict/strength; `renderRecent` takes the general `VERDICTS` without a qualifier. This is visible after a live-check: the card has the reason, recent does not.

**Fix:** pass one short display model to all compact representations, including the specific reason and the data quality.

### A08. P2: dark mode weakens the main visual

The text CSS variables adapt to the theme, while `web/app.js:7-10` sets dark fixed SVG colours. In the checked browser the beam and the pans of Unknown used `#444441` on `#141414`: a calculated contrast of about **1.89:1**. In the screenshot the diagram looks substantially less noticeable than the text.

**Fix:** separate theme-aware graphic tokens, contrasting pan labels, differences by line state and labels rather than by colour alone. The export card with a light background may use a separate palette, but the same meanings.

### A09. P2: the long diagram hides the evidence instead of visualising it

Previously a long position did without a diagram. Now an empty pan "Spot cannot offset a long" appears. But this is a general rule for any long, not evidence about the specific address. `web/app.js:565` hides the decisive tile whenever there is any diagram at all. For the most frequent answer, the useful "100% of exposure in one position" and the absence of material two-sided quoting end up less noticeable.

**Fix:** for Bet, visualise the position's concentration and the observed offset/quoting, rather than automatically showing an empty pan. The short fact: "100% of observed perp exposure; no material two-sided quotes found". State the coverage limitations.

### A10. P2: the rankings date does not cover all incoming rows

`loadGallery` passes the current gallery together with featured into the boards, but builds the "read between ..." line from the gallery alone (`web/app.js:1182`). As a result the text ends on 21 September, although the rankings contain data from 24 September. The date is not visible in the board rows themselves.

**Fix:** a date on every row; a general description "Saved cases, sampled at different times". Call it a historical selection until there is regular updating. One ranking made of measurements from different days is not equal to a current market ranking.

### A11. P2: the new source-comparison capability is absent from the four featured

In live processing `mainDexPositionCount` has appeared, but the four current featured lack it. Consequently, the saved Book example with 134 positions does not show the new numeric comparison with the main dex. This is not an error of the historical snapshot; it must not be rewritten with today's figures.

**Fix:** before the final recording, make a new dated featured selection if the state of the addresses still illustrates the four scenarios well. Update the snapshots, captions, links and OG consistently. Be sure to keep a stable fallback in case the fresh example has stopped being Book/Hedged.

### A12. P2: the public promise "bet you could follow" is stronger than what the product checks

It remains in the README and the meta description. The classifier checks the visible structure of exposure; it does not establish a good entry moment, the trader's quality or a suitable risk size. Even a clean directional position may already be a losing one, old, or too close to liquidation.

**Fix:** "Check what sits behind a whale position" or "Is this whale actually taking a directional bet?". In the card, explain what changes in the interpretation of the headline, without recommendations to copy.

### A13. P2: the new rankings have a broken grid even on desktop

**Fact:** on the public site at a window width of 954px the position name in the boards is squeezed into the first 34px column and wraps onto three or four lines; the badge stretches across almost all the remaining width. This is confirmed visually and by the CSS, not an assumption about a mobile breakpoint.

**Cause:** `web/index.html:164` sets the shared `.list button` grid `34px 1fr auto` for the old gallery with a row number. The new `boardRow` (`web/app.js:1084`) does not insert a number, so the position size lands in the number column and the badge in the stretching column.

**Fix:** a separate two-column `.board .list button` grid with `minmax(0, 1fr) auto`, consistent placement of the metadata, and stacking on a narrow screen. Or bring back an explicit number and correct grid-areas. Check both ordinary and long HIP-3 names. This is a small fix with a large visual effect; it is worth getting done before the video.

## Logic: what else is worth revisiting

**Separate the type of exposure from the quality of knowledge.** Currently Unknown includes a partial hedge, excess coverage, an incomplete API, an unrecognised token, the absence of proof of ownership, and a mixed portfolio. These are different results. The internal four verdicts can be kept, but the person should be shown the observed fact and the check status separately:

| Situation | Main result for the person | Quality/limitation |
|---|---|---|
| 60% coverage | Partly offset; 40% remains short | By the assets read and identified |
| 130% coverage | More spot than the short; residual long | Completeness of the read and debts separately |
| Assets with funders | Matching assets found elsewhere | Ownership unverified |
| API did not respond | Coverage not checked | The check can be repeated |
| Two-sided orders | Market-making activity detected | Does not prove intent on a single position |

**Book shows behaviour, not the owner's psychology.** Even significant bid/ask in the same market do not prove the absence of a directional bet. The current `openQuestion` acknowledges this, while the headline "This is a market-making book" sounds more categorical. "Looks like market-making inventory" with a specific piece of evidence is preferable. For the next version it is more useful to look at the persistence of quoting across several snapshots, the distance of orders from mark, the volume of orders actually filled in this market and reduce-only status, than to add yet another general account metric. This is a research improvement, not a reason to change v5 urgently.

**The no-quoting threshold is asymmetric.** Book requires material orders in the relevant market, while Bet is blocked by any two sides anywhere (`coinsBothSides === 0`). A couple of small orders in an unrelated asset remove the directional conclusion about a large position. The remark from the previous audit remains valid. For v6 a single materiality test and tests for dust/unrelated markets are needed. Before the deadline it is safer to keep the known rules with a clear explanation than to recalibrate the whole gallery in a hurry.

**The asset registry limits the conclusions more than the word all-chains suggests.** All chains supported by Nansen are read, but the contract registry mostly covers Ethereum and Arbitrum and a short list of assets. Equivalents with an unknown name may not even fall into the name-like unverified category. For new assets and HIP-3 markets the supported offset model should be shown explicitly. "Not found among recognisable assets" is more accurate than "there is nothing". The registry is better expanded from real cases with provenance and tests than by trusting all tickers.

**Coverage in USD is not identical to exact neutrality.** Wrapped/staked assets carry their own ratios and risks; debt or positions on other venues change the picture. The current caveats are useful. The next model should distinguish gross assets, known liabilities and net observed exposure, as well as the measurement time of both legs.

**Known debt is currently text, not an input to the classifier.** A synthetic reproduction: a long of 10,000 HYPE plus a negative spot of 10,000 HYPE gives Bet and at the same time a warning that the debt works as a short. This is a confirmed gap in the model, but not a confirmed defect of a real current HYPE account: the official portfolio margin rules separately restrict borrowable assets, and the audit did not establish that such HYPE debt is available today. When borrowing support is extended, debt in the position's asset must change the calculation or block a strong conclusion; unrelated debt in USDC should not be mechanically subtracted from HYPE coverage. [Official description of portfolio margin](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-margin).

**`balanced_book` needs its scope clarified.** It is computed over the whole portfolio and fires before the position completeness checks; the selected small position may not take part in the offsetting pair at all. In the current normalised data the opposite legs often have different dex-qualified names, so a specific production case is not confirmed here. This is a verifiable contract gap for v6: the offset of the selected position separately from the offset share of the whole portfolio; plus normalisation of the underlying without losing the identity of the contract/market.

**Ordered heuristics are not the same as independent accuracy.** The 562 tests check that the rules execute, but do not prove that the rules recognise real market makers and hedges with a given accuracy. I propose a separate set of 30-50 cases with a labelled observable basis, two independent reviewers and the option "cannot determine". Count coverage/abstention, false confident conclusions and robustness under small threshold changes separately. Do not show a confidence of 87% until there is something to justify it.

## UI, text and visuals

**The first screen is still too long.** In the 390 × 844 check with an existing recent, the card block started at roughly y=488, the diagram at y=934, the Nansen explanation at y=1243, Share at y=1451. Recent adds a little height, but its absence does not fit all the essentials into the first screen. This is a specific measurement of one state, not an average across all phones.

In the current order a person goes through the name, a multi-line subtitle, the form, four long chips, recent, the saved reading banner, the subject, the badge, the headline, the summary, the diagram caption. The flagship is opened automatically, but the value still appears only after considerable reading.

Proposed card structure:

1. **Position and freshness:** `$207.9M ETH short · checked 25 Sep 05:43 UTC`.
2. **Short conclusion:** `Matching ETH is elsewhere. Ownership is unverified.`
3. **Main numbers:** `<1% at this address` and `$437.1M with funding wallets`, in different visual areas.
4. **Diagram:** labelled legs; other people's assets outside.
5. **One substantive caveat:** a funding link does not establish ownership.
6. **Share this finding** and a secondary Check another.
7. Expandable Why / Sources & coverage / Position details.

The full explanation and the standing limitations are kept, but are not repeated in three wordings in a row. At the first level the reader gets the fact, the evidence and the boundary of the conclusion.

**The name can stay.** Bet or Book is short and memorable. But to a newcomer book sounds like a book or simply an order book. Explain once: "directional bet / offsetting hedge / market-making inventory". Do not make people decode the term from five metrics.

**The scales suit one task.** For short vs spot it is a good metaphor, provided the pans have their own amounts and names under them. Currently the pan rectangles are identical and unlabelled; the tilt has to be decoded from a paragraph. For funders an explicit small graph is more useful: `this address ← funding transfer ← another address`, with the assets under the other address. For Book, bid/ask and the position's scale are needed; for Bet, concentration. Design unity is provided by typography and colours, not by mandatory identical scales in every state.

**Big money must not visually outweigh reliability.** $437M of other people's assets is more striking than <1% of own coverage, so it is important to show them as secondary context with an ownership status. Otherwise even honest text cements the viewer's initial mistake about a hedge.

**Make the examples scenarios.** Today a chip reveals the answer immediately and is overloaded with figures. For a first acquaintance, better: "One concentrated long", "A short with its offset", "Assets in another wallet", "Market-making inventory". For the learning mode the answer is hidden until a choice is made. For the working mode the answer can be shown immediately. Do not mix these two modes.

**Controls and accessibility:** the example chips in the checked DOM are 24px high. About 40-44px is more comfortable for a finger, but the enlargement must not lengthen the header even further: use a compact scenario selector or a separate examples screen. Add a proper form with submit, check focus after the result updates, an accessible description of the chart with numbers, the keyboard, 200% zoom and the widths 320/390/768. The reading state must be available to a screen reader, and the error reason associated with the field. This is a list of needed checks, not a claim that all of them are currently broken.

**Browser Back is currently not a history of exploration.** `showLink` uses replaceState. Opening a new case replaces the current entry; Back does not bring back the previous card. For an application where several cases are explored, pushState + popstate or an explicitly visible local history is better. The automatic opening of the flagship can remain replaceState.

**The default flagship is useful, but it must be presented as an example.** A new visitor has not entered an address; an "Example case" line should explain where the result came from. Do not create the impression of a personal recommendation, or one automatically found for them.

## CJM: the user journey and the changes needed

The primary user: a reader of crypto X/Telegram who has already seen a big long/short and wants to understand what it means. The secondary: a channel author/analyst who needs a verifiable fact for publication. The hackathon judge is yet another entry path, but should not define the whole product.

| Stage | As it is now | Where value is lost | What to improve |
|---|---|---|---|
| Saw a loud post | Has to get hold of the address | The post often has only a name/screenshot | Explain the acceptable sources of an address well; accept an address or an explorer link; parsing of text with a pasted address already exists |
| Opened the site | A ready-made complex ETH case | Unclear whose address this is and what to do first | An Example label; one short scenario and a prominent form |
| Pasted the address | Check of the largest, then a choice from the top-5 | The post may be about a different asset | Confirm coin/side; fix A02; selection of the other positions on request |
| Waits | Status and an optional guess after 700ms | Attention drifts into the game; the reading stages are not visible | A stable loading state and the option to calmly skip the guess; do not depict invented progress |
| Got the answer | Badge, two explanations, chart, caveats | Has to derive the meaning for the headline themselves | One phrase "what can be asserted" and one main fact |
| Checked whether to trust it | Details and links are available | Many details, the source of the important number is further down | Provenance next to the number; one click to the evidence |
| Shared | Share at the bottom of the card | The path does not feel like a natural conclusion | Share next to the result; a readable self-contained card |
| Came back | Recent and What changed | No guaranteed new reason | A saved watchlist and meaningful change, initially without background credit spending |
| Opened someone else's link | The exact snapshot | May mistake a historical snapshot for now | "Checked X ago", a visible Check current state; keep the original conclusion as a separate snapshot |

The URL of an ordinary X post does not by itself contain a wallet address. The field should not promise a full check of any post while there is no separate mechanism for extracting the content and confirming the selected address. Before the hackathon a precise promise is better than an unreliable parser.

## Engagement: what to keep, remove and add

**The product's main loop:** saw a contested claim → checked the facts → got an explanation that changes the interpretation → shared → another person checked the next case. For this project it is more natural than a competition by trading volume.

| Mechanic | Decision | Why |
|---|---|---|
| Four contrasting cases | Keep, shorten the entry text | They quickly teach what the product does |
| Guess during the wait | Keep optional, rework the scoring | What is measured now is agreement with the heuristic, not the user's proven correctness |
| The Matched X of Y counter | Do not make it the central achievement | It encourages guessing the classifier; cant_tell does not take part in the count like the other answers |
| Five open rankings | Cut down to 1-2 selections or collapse | Repeating addresses/metrics turn a verification tool into a generic screener |
| Least covered shorts | Remove until A01 | Currently creates a wrong conclusion |
| Biggest slice of a market | Keep in the exploratory details | This is interest in risk/concentration, not an explanation of Bet vs Book |
| What changed | Develop | A natural reason to come back; already distinguishes a change of data from a change of rules |
| Share exact reading | Make it the main continuation | The project's strongest organic distribution |
| PnL leaderboard | Do not add | Shifts the meaning towards a competition between traders and copying |
| Wallet connect/registration | Not needed now | For the first result they would only add friction |
| Trading/copy-trading | Do not add before the hackathon | A new product, a new class of risks and a weaker demo focus |
| An AI chat about everything | Do not add | The project already has a definite question and a verifiable answer |

**The best new small mechanic: What the headline leaves out.** Do not require parsing of social networks: in the selected case show the contrast between "the visible position" and "what else was found". Example: "$208M ETH short" → "almost no ETH here; $437M in funding wallets; ownership unverified". Show the original phrase from the social network as a quotation only when there is a verifiable link; otherwise it is a scenario headline, not a claim about what a specific person supposedly wrote.

**For learning: Blind case.** At the press of a button the person is shown the raw observations, then chooses bet/hedge/book/not enough data, gets the explanation and opens one next contrasting case. There must be an explicit mode: an ordinary working check returns the result immediately. Balance the set of cases, because in the current selection most verdicts are Bet. The reward here: noticing an important limitation, not guessing the price.

**For returning: Follow this position.** The first step after the hackathon: a local watchlist of address+coin+side, a re-check button, a clear diff. Then budgeted refreshing and opt-in notifications only on a substantive change: coverage changed, the position disappeared, material quotes appeared, the conclusion changed. Separate price movement, a change in the number of contracts and a change of methodology. A percentage change in USD by itself does not prove that the whale added to/closed the position.

**For channel authors:** a small self-contained evidence card. It should contain the position, the observed fact, the most substantive limitation, the timestamp, the source and a link to the exact snapshot. This is more useful than a long technical report in the preview.

## Sharing and visual distribution

The page draws the scales, while the canvas download and the server-side OG use the previous bar. For Book and long these paths tell the story differently. This is an already known open continuation of the previous work; right now it is especially important, because the main distribution is expected to go through X.

A shared `PresentationModel` is needed: subject, short fact, quality status, figures, visual kind, captions, time and limitations. The three renderers may differ, but must not make the semantic decisions anew themselves. This will both eliminate A03-A05 and lower the cost of the next changes.

`postText` mechanically cuts the summary by length. On the four current featured the key caveat about funding survived, so it would be wrong to claim that these particular examples are currently distorted by truncation. But the Book text turns into simply "2,613 orders / 123 markets" and loses the position itself; the timestamp is missing from all of them. A separate short template per type of fact is needed, with the mandatory substantive caveat and the date, rather than an arbitrary cut-off of the end of a sentence.

All four featured already have public OGs: recreating them merely for the sake of existing is not required. For the new version of the diagrams a new layout version, consistent generation and a check of the real link preview are needed. For fresh live snapshots the render may not fit into the free CPU budget: the current fallback protects the delivery of an image, but does not guarantee an individual visual for every new link. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) confirm a separate CPU budget; the decision on a plan or a separate renderer should be made from production measurements.

## Code, architecture, operations

**What is good and worth keeping:**

- Observe → Interpret → Present. The verdict can be re-checked without new paid requests.
- Versions of the classifier and the registry; snapshots and a link to a specific reading.
- Real upstream validation, handling of partial/missing, separation of funder holdings from own holdings.
- POST for the paid check, rate limits, a budget with reservation and settlement in a Durable Object.
- KV is used for the cache/snapshots; losing KV does not reset the budget.
- Handler tests, real fixtures, runtime scenarios with contention and failures.
- The absence of a heavy framework in itself suits such an application. A migration to React/Next before the deadline solves nothing that is necessary.

**The main architectural weakness is now at the boundary between the domain model and the UI.** The classifier understands source quality, while the gallery index discards it. The breakdown expresses uncertainty as an amount of dollars. The frontend contains its own thresholds, texts and visualisation rules. So the backend tests can be green while the screen reports the opposite.

Proposed order of technical work:

1. A typed `ResultPresentation` and `GalleryRow` with quality/qualifier. The financial value and its reliability go together.
2. Pure functions for building the diagram model; separate SVG/canvas/OG renderers. Edge cases covered by short meaningful tests.
3. Five browser scenarios: a new check; opening a snapshot; selecting a position after the cache; partial/unpriced; share and reload/back. Checks of the result's meaning and the mobile layout are needed, not hundreds of HTML repetitions.
4. Gradually split `web/app.js` (1,682 lines), `src/index.ts` (822) and `observe.ts` (740) along the existing responsibilities. A big refactoring before the deadline is not needed.
5. Check raw responses and data volumes for overly large upstream bodies, as well as the behaviour of hung reads. Keep the existing timeout/abort.

**Credits and latency.** PnL is requested on every check, although it changes no verdict (`observe.ts:183-185`). It is a candidate for lazy details: one paid call fewer per check, that is roughly 14-50% of the call count for the paths with 7-2 calls, if the mandatory upfront PnL is dropped. This is not a promise of the same reduction in latency: it needs measuring which request is the slowest.

The free reads start with a shared `Promise.all`: a failure of fills or spot metadata cuts everything off before any useful partial result. In the next version it is worth separating required and conditionally required sources: the absence of fills need not cancel the reading of the position. Any degraded path must weaken the corresponding conclusions, rather than treating a missing response as empty.

The main-dex state is already read for the comparison, but the fallback requests it again. A valid response can be reused if it is fresh enough, keeping a separate retry on error. A small saving of external requests without changing the product's idea.

With a cap of 600 and a reserve of 40 the public part equals 560 credits: a maximum of about 80 of the most expensive seven-credit checks per day, if everything goes down that path. The cache and the cheap scenarios increase the number of users served, but a viral stream of new addresses would quickly exceed this order of magnitude. An honest user mode after the limit is exhausted is needed: saved examples and an explicitly limited new check, not a promise of a full Nansen breakdown. The remaining credit of the Nansen account was not checked in this audit.

The current per-isolate in-flight dedupe does not prevent repeated checks of the same address in different regions. This is a known trade-off, not a new critical bug: the budget is limited globally separately. Distributed dedupe makes sense once there is measured load. One global object for the shared monetary budget is justified here by the task; rewriting it for an abstract sharding requirement is not needed.

**Observability:** technical events already exist. What is missing is measurement of the product path: opening an example, a successful live-check, opening Why, start/success of copying the link, a return visit. Minimise the data: aggregates and the scenario type, without storing clipboard/post contents and without any need to record the address of the wallet being examined in product analytics. Technical metrics: p50/p95, the share of degraded, errors by source, the cost of a successful full check, the share of budget refusals, snapshot/OG saving.

## Documentation and submission readiness

The README is substantive, but about 3,600 words demand too much of a judge's time. The first screen of the README should have: one sentence of the problem, one screenshot, the live link, a 30-60s demo, three launch steps, a paragraph on which decision the Nansen data changes. The full rules, the honest limitations and the audit history remain in the documentation behind links.

The README now describes the current 562 tests. But the submission-checklist still says 548, and the demo-script says cap 300 while `wrangler.toml` has the value 600. These specific discrepancies are worth fixing. Keep the old audits as dated history; do not rewrite old measurements with today's numbers. Instead of growing the number of overlapping plans, start a short up-to-date release/submission status.

`package.json` has an empty description and a nominal ISC, but no separate licence was found in the checked root. This is a secondary repository-tidiness task, not a blocker for a working demo. The choice of licence should reflect the author's intent.

The current video script is too dense: it tries to show a live-read, the guess, unknown ownership, a change, hedge, book, the rules and five boards in 58 seconds. There is not enough time to read several English paragraphs. The guess appears on a timer and may not make it into the real recording; a mandatory editing transition should not depend on it. A live call has variable duration, and the code's deadline reaches 45 seconds.

Proposed 50-60 second video:

| Time | Meaning of the shot |
|---|---|
| 0-5 | A large position and the question: what stands behind it? |
| 5-18 | One real live-check, with the source and freshness visible; no passing off the cache as a new request |
| 18-32 | The strongest contrast: almost no own coverage, the funders' assets outside, ownership not established |
| 32-41 | A saved example of a real spot offset with an explicit date |
| 41-49 | A saved Book example, one piece of quoting evidence in the relevant market |
| 49-58 | The Share card, the live URL, GitHub and Powered by Nansen |

This is an editing guide: if the real request takes longer, shorten the secondary shots or transparently mark the cut in the wait. 2-3 short meaningful captions are acceptable; "understandable without voice-over" does not mean a ban on captions. Do not publish claims about a specific viral post without a link to it.

## How well the project fits the Nansen Buildathon

The official FAQ has four equally weighted criteria: Data Integration, Functionality, Creativity & Originality, Documentation & Submission. Also there: the deadline of 27 September 23:59 UTC, a public GitHub, an X post with @nansen_ai and GitHub, a 30-60 second recording and the mandatory form. The FAQ states 100+ calls, the campaign landing still states 1,000; the project's own counter is already above both numbers. [FAQ](https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27), [campaign page](https://nansen.ai/campaigns/meridian-buildathon).

| Criterion | My score /10 | What already convinces | What gets in the way |
|---|---:|---|---|
| Data Integration | 8 | Nansen positions, balances and funding links genuinely change the available conclusions | The main visual effects may look like Hyperliquid-only data; a short provenance is needed |
| Creativity & Originality | 7.5 | A narrow check of the meaning of a whale position, the ownership distinction | The large rankings area brings the product closer to an ordinary screener |
| Functionality | 8 | A verified live flow, tests, budget, snapshots | A01-A03 and the absence of automated control of the UI's meaning |
| Documentation & Submission | 6.5 | Launch, rules and limitations are documented | A long README; video/post/form not confirmed; the script is overloaded |

The average of 7.5/10 is nominal: this is my audit, not a forecast of the jury's scores. After a submitted and well-prepared entry, the score on the last criterion may change substantially.

**It is important to show Nansen honestly.** The comparison "134 positions at Nansen versus 86 in the main-dex request" demonstrates convenient aggregation and the completeness of the chosen integration, but does not prove that HIP-3 is fundamentally impossible to get for free: the official Hyperliquid API has `perpDexs` and a `dex` parameter on `clearinghouseState`. It is better to phrase it as "Nansen gives this app a consolidated cross-dex view" and to show the more strongly differentiating cross-chain/funding part. [Hyperliquid Perpetuals API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).

From the [official selection of the previous CLI campaign](https://release.nansen.ai/help/articles/6399546-nansen-cli-builds) it is evident that wallet reports, trackers, trading agents, games and thesis-checking tools have already appeared. This is a March selection, not a list of the current competitors. So a winning story cannot be built on the single phrase "we have wallets and Nansen". What sets Bet or Book apart: a small verifiable answer to a specific popular type of mistaken conclusion, with an explanation of who the assets belong to and convenient distribution.

The project has grounds to contend for a prize: a finished application, a real data-driven conclusion, a compact story, good technical foundations. The status of a clear favourite is not confirmed so far. The main missing element: the viewer must grasp the interesting twist in 5-10 seconds and then easily retell it to another person.

## Plan up to the deadline and after it

### Before submission: the mandatory small scope

1. Fix A01-A03. Check the reproductions and the current real cards.
2. Fix the rankings grid A13, remove the threshold discrepancy, correct the Book scale's denominator and the dark palette. Do not change the whole classification for the sake of cosmetics.
3. Shorten the first screen, label the diagram's legs, raise the Nansen fact and Share. Remove or collapse the superfluous boards.
4. Reconcile the page graphics and the share graphics, first for the three cases in the video. Keep the limitations in the image.
5. Run the path without reading the README on five target users. Check: "Is this a signal to buy/sell?", "Who owns the assets?", "How fresh is the data?", "What did Nansen contribute here?". Goal: at least four of the five correctly retell the meaning of the card; this is a proposed criterion, not a result already obtained.
6. Update only the outdated current documents, capture fresh featured if necessary, record a clear video, publish on X and submit the form. Publication/submission remain the author's separate actions; this audit does not perform them.

### If time remains

- Pass the qualifiers into boards/recent and quality into the contribution.
- Improve the Bet/Book texts and cut the repeated caveats.
- Add a short provenance next to the two main numbers.
- Check the public share links from someone else's browser after the current build is published.

### After the hackathon

- v6: material quoting, the correct offset scope, known liabilities, normalisation of the underlying, temporal persistence of Book.
- Independent labelling and threshold sensitivity.
- A watchlist and budgeted meaningful-change notifications.
- A more complete search for the selected position and handling of closed/changed positions.
- Lazy PnL, conditional sources, paginated balances as needed.
- UI tests and a shared presentation contract.
- The funnel and the first real users. The decision on a subscription/API for channel authors to be made after repeat use is confirmed.

**What I would not do now:** a new large dashboard, a mandatory wallet connect, copy-trading, an AI chat, an own token, earnings rankings and a full change of stack. Each may have its own product logic, but for the nearest goal they dilute the strong story already found.
