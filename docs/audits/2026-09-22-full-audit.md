# Bet or Book: full audit, 22 September 2026

Logic, code, UI, CJM, engagement, ease of understanding and the odds at the Nansen Meridian Buildathon.

Version checked: `5ec89b1` (local HEAD equals remote `main`; the deploy on workers.dev matches it byte for byte: `app.js` is identical, the page differs only in the script version in `?v=`). The product sources were not changed in this audit. Only this file was added.

## 0. What was checked and how

- Read: the README, the specification, the three previous audits and both documents on choosing the direction, the demo script, the submission checklist, `web/index.html`, `web/app.js`, `src/api/check.ts`, `src/engine/verdict.ts`, `src/engine/evidence.ts`, `src/engine/features.ts` (positions and trades), the Nansen and Hyperliquid fixtures. The rest of `src/` was read in a separate pass over the code (section 5).
- `npm run typecheck` and `npx vitest run`: 29 files, 339 tests, all green. `npm audit`: 0 vulnerabilities. CI on GitHub for `5ec89b1`: success. The offline check of the previous audit's fixes, `docs/audits/2026-09-21-verify.ts`: 19 observations, all assertions hold.
- The live site was walked through as a user: the home page, a card from the gallery, a live check of the demo address `0xB83DE012...` (7.1 s, 7 Nansen calls, result Unknown), a check of a selected position via the chips (BTC short, 6.4 s, 7 calls), garbage input, a transaction hash, a non-existent `?s=...` link, the PNG card (taken from the canvas and viewed), a 375 px width, the meta tags of a saved link.
- Gallery: recounted from `data/gallery.json` (300 records, 22 of them superseded old readings that the route filters out; 277 on the page, of which 183 were read by rules v3 and 94 are marked as history).
- Contest terms: re-read the campaign page, the submission form, Nansen's redistribution guidelines, the endpoint documentation, the Nansen changelog on Hyperliquid, the public repositories of other participants. Links in section 3.

Not checked: the Cloudflare account, the secrets on the server, the call counter on Nansen's side, the behaviour of Durable Objects under load.

## 1. The verdict in one page

**This is the most evidence-based and honest product in its niche among the publicly visible submissions, and the only one that classifies the meaning of a position (a bet, a hedge, a market maker's book). But for now it is a product for an auditor, not for the reader of a tweet.** The main limitations right now are not in correctness (it has grown a lot in a week) but in what a judge sees in the first thirty seconds:

1. **The flagship example answers "Unknown".** The demo address that opens the video gives the verdict Unknown. The story ("$465M ETH sits in wallets that funded the account, and funding is not ownership") is strong, but the badge and the headline read as "the tool could not".
2. **For 87% of the cards Nansen decides almost nothing.** Of the 183 current gallery cards, 159 are longs. For a long no hedge is looked for, the funder wallets are not read, and the verdict is determined by Hyperliquid data plus the completeness of positions from Nansen. All 107 "Looks like a bet" verdicts in the gallery are longs, 56 of them accounts with a single position. A judge who pastes a random address will most likely get exactly such a card: "Share of exposure 100%, Net/gross 100%", no diagram, no Nansen leg.
3. **The Nansen fields that have already been paid for are not shown.** Leverage, cross/isolated, the liquidation price (the distance to it is already computed in `features.ts` and is displayed nowhere), unrealised PnL, funding paid since open. This is exactly what the reader of a tweet wants to know before copying, and it costs zero additional credits.
4. **47 of the 66 Unknowns in the gallery say "signals disagree".** 25 of them are accounts where all positions point the same way (net/gross at least 80%, no two-sided quotes, no hedge). This is not "not enough data", this is a directional portfolio, and the rules cannot say so.
5. **The "what changed" mechanic does not fire for a live user.** It only kicks in for the 22 re-read gallery cards. A live check of the same address is not linked to the previous reading (checked: `supersedes` is absent), and the strongest reason to come back stays invisible.
6. **The diagram is unreadable on a phone.** At 375 px the SVG labels are 7-9 px. The page with a card is 4 458 px tall.

If items 3, 4, 5, 6 are closed over 22-24 September and a clean video is recorded, this is a strong contender for a prize place. Without that, it is a very well documented auditor's tool with a heavy screen, whose main example says "Unknown".

## 2. What has become stronger since 21 September

Almost all critical items of the previous audit are closed, and this is visible in the code, not only in the README: POST for the paid check and a CSP without inline script; a budget reserve that on failure is charged rather than returned; the balance is decoupled from the calendar day; asset identity by contract and by token index; completeness of the reading is checked before the hedge range; the Book rule requires material two-sided quoting; unrecognised assets hold the verdict; rules that assert absence require a complete read of the source; the observation version is separated from the rules version; 22 cards re-read live; the "what stands against the position" diagram; position selection; comparison of two readings; the PNG carries the permanent limitation; CI; the call counter in a Durable Object. This is real movement, and it must not be rolled back for the sake of effect.

## 3. The contest: facts and consequences

Sources: [campaign page](https://www.nansen.ai/campaigns/meridian-buildathon), [submission form](https://nansen-ai.typeform.com/meridian-submit), [redistribution guidelines](https://docs.nansen.ai/mcp/redistribution-guidelines), [API overview](https://docs.nansen.ai/api/overview).

**Facts from the campaign page.** There are no tracks. Four criteria at 25% each, verbatim: *Data Integration: "Nansen data drives the logic - not just appears on screen"*; *Creativity & Originality: "We've seen dashboards. Show us something we haven't"*; *Functionality & Workability: "Live data loads. End to end. No crashes. If it breaks in the recording, it doesn't qualify"*; *Documentation & Submission: "Clean README. Followable recording. No narration needed. Another builder can run it in under 10 minutes"*. Above them: *"Creativity beats complexity. A simple tool that runs beats an impressive one that doesn't"*. Prizes: $10 000 USDC for first place, hardware for second and third, 100 000 credits for an honorable mention. Submission: 1 000 API calls, a post on X with the recording and the tag @nansen_ai, a three-field form (the email of the Nansen key, a link to the post, a link to GitHub). A video length of 30-60 s is not stated on the page; it is the community norm. The deadline hour is not stated on the page; the checklist relies on the FAQ (23:59 UTC on the 27th), worth re-checking before submission.

**Redistribution guidelines.** The attribution "Powered by Nansen API" is required (present). Public leaderboards, near-real-time redistribution of data and products competing with Smart Money are prohibited. The gallery ranks addresses by position size (the source of the rank: Hyperliquid's public leaderboard, not Nansen) and shows a "PnL 30d" from Nansen for each. Formally this is a list of saved readings, not a leaderboard, but a PnL column in a ranked list of 277 addresses looks like one from the outside. Cheap insurance: remove the PnL from the list row (keep it on the card) and call the section "saved readings" rather than "scan of the biggest positions".

**Who else is building nearby.** In the Hyperliquid niche, [PerpPilot](https://github.com/TheRealNajim/PerpPilot) (a copy-trading terminal with a "Copy Score 0-100" per trader) and [Follow or Fade](https://github.com/Tonychdid/follow-or-fade) (a game: put chips on real Smart Money positions, 20 068 calls, a 64 s video) were found. The "thesis check" cluster (thesis-court, singulant-proof, rebuttal, proofpulse) is close in spirit to "check a claim against data", but is about wallets and tokens, not about the meaning of a perp position. None of those found answers the question "is this position a bet, a hedge or market maker inventory". Nansen in its own materials on Hyperliquid does not do this either (their frame: "who is winning", cohort long/short skew). This is our angle, and it is free.

**What this means for us.** (1) The Data Integration criterion is literally about Nansen driving the logic. For us this is true for shorts and almost invisible for longs; see section 4. (2) "We've seen dashboards" hits the dense screen of tiles; our originality is in the question and in the diagram, and it has to be shown within three seconds. (3) "If it breaks in the recording, it doesn't qualify": a live check goes through three external APIs and 7 seconds; the recording has to be made with a reserve of credits and with a plan B. (4) "Another builder can run it in under 10 minutes": a 26 KB README with essays about the budget and the gallery hinders this criterion rather than helping it.

## 4. Logic and rules

**L01 · P1. A directional portfolio has no verdict.** The bet rule requires no more than 5 positions and a headline position share of at least 50%. An account with 7-20 longs, net/gross 100%, no quotes and no hedge falls into "signals disagree: not enough evidence". In the gallery this is 25 of the 47 such Unknowns (plus 12 that fail only on the 50% share). The demo address, after selecting BTC, gets "Not enough evidence either way" with 20 shorts at $580M gross and net/gross 100%; a human would say "he is shorting everything". Proposal: a reason `directional_portfolio` inside "Looks like a bet" (without a fifth verdict): net/gross at least 0.8, no two-sided quotes, coverage of the headline position below 10% (for a short) or not applicable (for a long), orders and positions read completely, and the rule stands **after** the `linked_exposure_unverified` check so as not to lose the finding about the funders. Text: "All 20 positions on this address point the same way: $580M short, the largest of them ETH $212M (36%)". This is a change of rules, hence v4, an offline `reexplain` of the gallery and an entry in the "what changed because of the rules" block; the mechanism for that already exists.

**L02 · P1. For a long, Nansen takes no part in the answer.** `hedgeCanChangeVerdict` returns false for a long, `readLinkedHedge` is not called, and a long costs 2 calls: positions and PnL. This is right from the credits point of view, but for 87% of the cards "Nansen drives the logic" is not demonstrated. Two cheap ways for Nansen to decide for a long too: (a) **wallet age and funding source** from `related-wallets` (2 calls, the `block_timestamp` field of the first funding and the service status of the funder, which the code already determines from the label without showing the label itself): "wallet first funded from an exchange address 3 days ago, one position, 5x cross" is the classic storyline of a viral post and it is Nansen data; (b) **an opposing perp leg** on another dex for the same asset is already counted in `sameAssetOffsetShare`, but a long is never told about it. Item (a) raises the cost of a long from 2 to 4 calls; with a cap of 300 per day that is acceptable; it can be enabled only for accounts with no more than 5 positions.

**L03 · P1. Position fields that have already been read are thrown away.** `normalizeNansenPositions` puts leverage, the liquidation price, unrealised PnL and funding since open into `Position`; `computePositionFeatures` computes `headlineLiqDistancePct`; none of these fields reaches `evidence`, the card or the PNG (checked with grep: `headlineLiqDistance` is read nowhere outside `features.ts`). The Nansen response also has `leverage_type`, `margin_used_usd`, `return_on_equity`, which are not even normalised. A "vitals" strip of five numbers (leverage and type, ±X% to liquidation, unrealised PnL, funding since open, size against OI) gives a long some content and Nansen a visible role, and costs 0 credits.

**L04 · P2. Fills lose their direction.** Hyperliquid returns `dir` ("Open Short", "Close Short", "Buy") and `startPosition` in every fill; `normalizeTrades` discards them. In the demo address fixture there are 808 "Open Short" against 242 "Close Short" over the window: the position is being built up, and that is the liveliest fact about it. In the live reading of 22.09 the same address has 2 000 fills in 31 minutes, 96% as taker, 0 buys, but 0 fills in ETH; the card says neither. One line "over the last 24 h in ETH: opened $X, closed $Y" (or "no trades in ETH, all activity in other markets") is cheaper than any new integration.

**L05 · P2. The labels do not know about the selected position.** After selecting BTC via the chips the tile is called "Largest position $147.9M BTC short", although it is the second-largest position; `explain()` in `evidence.ts` labels the first tile with a hard-coded caption. The summary meanwhile is generic ("not a book, not hedged, and not a clean bet: 20 positions, largest position 25% of exposure"). The label should be "Position asked about", and the summary under focus should start with the portfolio (L01).

**L06 · P2. Book almost never occurs in the gallery, and that is suspiciously few.** 3 books per 183 cards with a threshold of 50 orders, 5 markets and quoting at 10% of the headline position. A threshold of 10% of the position is reasonable for "this position is inventory", but a large market maker with an $80M position and $5M of quotes across 40 markets reads as "diversified_book_no_quotes". Not to be changed before submission, but the README should say directly that Book means "quotes materially relative to this position", not "this account is a market maker"; right now the "Book" badge reads as the latter.

**L07 · P2. The 85-115% hedge threshold and the "over_covered" rule give three different answers to almost the same situation.** 84% coverage is Unknown/partial_offset, 86% is Hedged, 116% is Unknown/over_covered. For a reader the difference between 84 and 86 is not a change of category. It is more useful to show the remainder ("$2.9M of $7.2M remains short") and keep the Hedged badge for 85-115, as now, but in the partial_offset summary near the boundary add "almost completely". A small thing, but it removes the judge's question "why is 84 not a hedge".

**L08 · P3. Where the README promises more than the code.** "305 tests" in the README against 339 actual. The wording "A choice of position" promises a choice, but on a saved reading there are no chips (this is by design, but a card from the gallery does not say that you need to press Check live to choose). The specification promises a card "in 1-3 seconds", the reality is 6-7 s; the README says nothing about response time, better to say it.

## 5. Code

A separate pass over all of `src/`, `scripts/` and `test/`. Items marked "checked" were reproduced by me from the code, the fixtures or the live API; the rest from reading the code.

**K01 · P1 (for the demo). Comparing two readings invents changes where the old reading did not measure the field.** `src/engine/compare.ts:88-99` reads `orders.twoSidedNotionalUsd` and `linkedHedge.linkedHedgeUsd` via `?? 0`. None of the 22 superseded cards has the first field. Checked on the live route: `/api/compare` for the book `0xecb63caa` (old reading `ecb63caa-mu71kz95`, new `2b2e7wqput6yt`) answers "two-sided quoting: $0 → $226.1M". This is exactly the card the demo-script shows at seconds 41-49; the "What changed" block on it will show a false change in the recording. Two more pairs have a phantom "held by wallets that funded it: $0 → …", where the old reading simply did not go to the funders. When this gets into `because`, the comparison says "both the reading and the rules changed", although only the rules changed: the very distinction the route exists for. Fix: a field absent from one of the readings should not be compared but reported as "not measured in the reading of …".

**K02 · P1. HyperEVM is not in the contract registry, and it is the home chain of the only asset that is ever a hedge at all.** All 7 Hedged in the gallery are HYPE shorts. Nansen returns native HYPE on `hyperevm` under the placeholder `0xeeee…` (present in the fixtures `current-balance-abraxas-all.json` and `…-funder-eth-all.json`, checked), `classifyHolding` in `assets.ts:122` assigns it to `unsupported-chain`, and `unrecognised_assets` in `verdict.ts` is checked before `hedge_leg`. Result: a HYPE short covered 100% by Hyperliquid spot and a further 10% by HYPE on HyperEVM reads as Unknown. The README acknowledges the two-chain registry in general, but not that it excludes precisely this case. Add `hyperevm` with native HYPE and WHYPE to `KNOWN_CONTRACTS`, bump `ASSET_REGISTRY_VERSION`.

**K03 · P2. `maker_flow_only` fires before Hedged, and the hedge read is still paid for.** In the README the Hedged row (2) comes before `maker_flow_only` (8); in `verdict.ts:255` `maker_flow_only` returns before any hedge rule. An active account with a short covered at 97% reads Unknown. Worse for the principle "every credit must be able to change the answer": `hedgeCanChangeVerdict` looks only at the `orders` signal, not `trades`, so `check.ts` reads the balances (and, with coverage below 50%, 4 more calls on the funders) for a verdict that is already fixed. In the gallery 12 of 300 checks had a short and a triggered trades signal. Checked in the code.

**K04 · P2. Position selection is confirmed by coin, without the side.** `features.ts` looks for the position by coin and side and on a miss falls back to the largest one; `check.ts:306` then confirms the focus by comparing the coin alone. A request `coin=ETH&side=short` on an address where the largest position is ETH long answers about the long, writes `focus: {ETH, short}`, the page labels it "asked about ETH short", and the response is cached under the key `…:ETH:short`. The test `focus.test.ts` covers only a missing coin. Checked in the code.

**K05 · P2. Spot orders are counted in the perp book.** `normalizeOrders` (`normalize.ts:66-74`) discards only trigger orders; `frontendOpenOrders` without `dex` returns spot too (in the Wintermute fixture 281 of 1 059 orders are `@272`, `@107`, `PURR/USDC`, checked). They get into `restingOrders`, `bidShare`, `coinsBothSides`, `twoSidedNotionalUsd`. An account quoting five spot pairs alongside one large perp short reads as "Book: this position is inventory". For pairs with a non-dollar quote asset `sz * limitPx` is not dollars at all. This is a definition, not a bug, but the README says "5+ markets" without specifying that spot counts; either exclude spot from the signal about a perp position, or say so in the README.

**K06 · P2. The observation version stamp is set by the rules, not by fact.** `scripts/reexplain.ts:127` writes `observationSchemaVersion ?? OBSERVATION_SCHEMA_VERSION`: the 169 cards of the 18.09 scan, which nobody re-read, carry schema 3. `missingForCurrentRules` is honest here and looks at the content (the field is needed only if there are at least 50 orders or it is a short across all chains), so for v3 this is justified. The trap ahead: when the versions are equal the check immediately returns empty, and any new field that v4 will need will be silently absent on these 169 cards. For the v4 from L01 only net/gross, source coverage and the hedge are needed, and they are present; but the stamp should reflect what was observed, not what the rules were able to read. Checked against the data.

**K07 · P2. `DEMO_KEY` travels in the query string.** `index.ts:264` reads `?demo=`; with `[observability]` enabled the request URL ends up in the Workers logs, in the browser history and in any proxy. Move it to a header. The comparison is not constant-time, a minor point. Checked in the code.

**K08 · P2. The global burst limit sits before the cache and counts cache hits.** Both limiters in `index.ts:246-268` run before the KV read; every click on a position chip is a POST; 10 requests per 10 s across all clients means two addresses can keep everyone else on 429. Put the limit after the cache, or do not count cache hits.

**K09 · P3. A DO failure at settle loses a ready, paid-for answer.** `index.ts:330-347`: if `settle` throws, `record` is skipped, the result is not cached, the client gets a 502, and the reserve is later charged at the worst case (7) rather than the real price.

**K10 · P3. A 401 from a corrupted or revoked key turns on the "credits exhausted" breaker for an hour.** `nansen.ts:318-321` treats any 401/402/403 without a credits header as exhaustion; `budget.ts:213` holds the refusal for `REFUSAL_PROBE_MS` with the wrong reason on every card.

**K11 · P3. Minor inconsistencies.** An on-chain balance without a price is discarded silently (`normalize.ts:203`), while the same Hyperliquid spot balance is kept as `priced: false` and holds the verdict: two opposite answers to "a balance that nobody priced". `unpricedMatches > 0` has no materiality threshold (`verdict.ts:291`): dust of an unpriced namesake holds the verdict, the README mentions only 10%. "Nansen positions unavailable" sets `degraded = true` but goes into `coverage` without `failure`, and the PNG ranks it below real failures (`check.ts:244-251`). `maker_flow_only` never marks the decisive row: `DECISIVE_LABEL_BY_REASON` points to "Fills, last 24h", but such a tile exists only in the book branch (`evidence.ts`). The first tile is called "Largest position" even under focus (see L05).

**K12 · P3. Dead code and discrepancies between the README and the code.** `looksLikeButUnverified` (`assets.ts:154`) is called by nobody; the budget `sync` action (`budget.ts:326`, `coordinator.ts:102-109`) is unreachable (no route and no cron); `WORST_CASE_CALLS` is declared twice (`budget.ts:40`, `prescan.ts:36`); the branch `assets.ts:121` is unreachable for Hyperliquid spot. Stale comments: `index.ts:177` ("up to 14 KV reads", in fact one DO call), `index.ts:413-416` (daily counters in KV), `budget.ts:43` ("four paid stages at 20 s" against a 45 s deadline and a 300 s hold), a Cyrillic "(v)" (the letter U+0432) in `verdict.ts:132`. README: "the only user input is an address", but the Worker also reads `coin`, `side`, `demo`, `s`, `id`, `a`, `b`; "a POST from this site", but `fromThisSite` lets through a client without `Origin` and `Sec-Fetch-Site` (the code comment says so, the README does not); "spot identified by its token index", but the index is used only for the price, matching is by name (`assets.ts:149`). `reexplain.ts:143` creates an id without `classifierVersion`, `index.ts:314` with it. Nothing in `scripts/` sets `superseded`: this was done outside the repository's scripts.

**K13 · P3. Latency.** A full check of a short makes up to 15 sequential network steps: two gate DO calls, KV get, reserve DO, the Hyperliquid batch, Nansen positions and PnL, clearinghouse on fallback, HIP-3 orders, balances, related-wallets ×2, funder balances, KV put, settle DO, record DO, KV put. Four hops to storage before the first byte from an external API. Cheap to cut: the two gate calls into one; `settle` and `record` as a single DO action; `spotMetaAndAssetCtxs` (845 contexts) and `metaAndAssetCtxs` are global and are re-fetched and re-parsed on every check, a 60 s memo in the isolate removes two calls and the largest JSON parse. `/api/gallery` returns about 1 MB on every uncached request.

Own observations from reading the page and `check.ts`:

**C01 · P2. The message about a non-existent link comes from the server in lower case and overrides the page's text.** `/?s=doesnotexist123` shows "that snapshot has expired or never existed", the card is hidden; `app.js` has a more useful `failureText`, but the server's `data.error` takes priority.

**C02 · P3. `Trade` does not store `dir` and `startPosition`** (see L04): a few lines in `normalize.ts` and `types.ts`.

**C03 · P3. The CSP still has `style-src unsafe-inline`** because of the inline `<style>`. Not a vulnerability; moving it out to `/app.css` on the model of `app.js` makes the policy strict in its entirety.

**C04 · P3. `data/rescan-offset*.json` in the repository** look like working leftovers: either describe them in the README or remove them.

**What the tests do not cover** (with 339 green): focus with an existing coin on the other side (K04); spot orders in the book signal (K05); the order of Hedged against `maker_flow_only` and spending the hedge read on a trades signal (K03); comparing readings of different schemas (`routes.test.ts:205-213` runs a v2/v3 pair but does not check the list of changes, so "$0 → $226M" passes) (K01); `reexplain.ts` itself; HYPE on HyperEVM (K02); the per-IP limiter through the Worker (only the DO is tested); failure at settle (K09); a 401 with the wrong reason (K10); the shape of `normalizeTrades` (no guard); the number of tests in the README.

## 6. UI

**U01 · P1. The diagram on a phone.** An SVG with a fixed `viewBox` of 640 is scaled down to 301 px, the labels are 7-9 px. Solution: at widths below 520 px draw the "held elsewhere" block under the bar rather than to the right (two `viewBox` variants, or HTML/CSS instead of SVG text); labels no smaller than 12 px. This is the first thing a judge will see if they open the link from a phone via X.

**U02 · P1. The first screen does not lead to a result.** A title, a subtitle, an input field, a button. Someone arriving without an address in hand has nothing further than scrolling down to the gallery. Three example chips are needed right under the field: "$125.9M HYPE long: bet", "$42.7M HYPE short: hedged", "market maker, 2 722 orders". One click and a card. This is also the path for a judge who has no address.

**U03 · P1. The promise in the subtitle argues with the product.** "Should you copy this whale?" promises advice, while everything else on the page explains why there will be no advice. The previous audit already noted this; the text has not changed. Option: "Before you copy the headline, check the position" and a second line "Is it a bet, a hedge, or a market maker's book? Nansen and Hyperliquid data, one address".

**U04 · P2. A 6-7 second wait with a single static line.** "Reading positions from Nansen and orders from Hyperliquid..." hangs there for all seven seconds. The honest option without invented progress: stream NDJSON stage events from `checkAddress` (the stages are already named in the code: free reads, positions, balances, funders) and show them as they arrive. A one-day compromise: show the list of stages immediately and highlight the current one only on an actual event; without streaming it is better to leave it as is than to draw timer-based progress.

**U05 · P2. Three limitation blocks in a row.** "Wallets that funded...", "What we cannot see", "Not read this time" plus the meta line. On the card of a single-position long this is most of the screen. Merge "What we cannot see" and "Not read this time" into one block "Limits of this reading" with a permanent first line; keep the funders block, it has substance.

**U06 · P2. Empty tiles on a single-position account.** "Share of exposure 100%", "Net / gross 100%" say nothing with one position (56 of the 107 bet cards). Hide both when there is one position, and give the space to the vitals (L03).

**U07 · P2. Service labels compete with the answer.** "rules v3", "7 Nansen API calls", "positions from Nansen", a link to Hypurrscan, all in one grey line. For a judge this is valuable, for a reader it is noise. Keep the line, but move it below the action buttons and make "rules v3" a link to the rules table in the README.

**U08 · P3. Position selection sits below the summary.** The "This answer is about" chips appear after the headline and the summary; a reader who came for BTC will first read the answer about ETH. Put the chips right under the badge, or make the summary explicit: "Answer about the largest position, ETH short. Came for BTC? Pick it below".

**U09 · P3. Two buttons for one image.** "Copy card" and "Download PNG" do the same thing in different ways. One primary "Share card" (copies, downloads on failure) and "Copy link". Dark theme, focus, keyboard: checked, works.

## 7. CJM step by step

**J01. Entry.** Where a person will come from: a post about a whale (a Hypurrscan/HyperDash link in the thread), a judge (the link from the form), the repository. The field accepts a link containing an address: good. But a link to a saved reading opened in X shows a preview without an image (`twitter:card: summary`, no `og:image`), with the title "ETH short: not settled by what could be read". For a product whose main value is in the diagram, a preview without the diagram is half the click lost. Solution: on the first render of a live card the client sends the PNG from the canvas to `POST /api/snapshot/:id/image` (only for an existing id, size limit, once), the Worker puts it in KV and serves `/s/:id.png`, the meta gets `og:image` and `summary_large_image`. For gallery cards the PNG can be generated once offline. The same preview becomes the image of the contest post itself.

**J02. Input.** Garbage, a transaction hash, several addresses: the messages are clear, checked. No examples (U02).

**J03. Waiting.** 6-7 s without movement (U04). No time estimate ("usually 5-10 seconds").

**J04. The card.** Badge, headline, summary, diagram, tiles, funders, limitations, meta, buttons. The order is right for a short with funders (the best case). For a long: badge, the headline "This looks like a real bet", summary, two empty tiles, "What we cannot see", meta. This is 80% of live checks, and it is the weakest screen of the product (L02, L03, U06).

**J05. "What changed".** Works only on the 22 gallery cards. A live check of an address from the gallery (checked on the demo address) does not show the block, although a previous reading exists and the comparison already knows how to do everything needed. A `latest:<address>` index in KV is needed: on a live check, fill `supersedes` from it and save the new id there. Then any repeat check, including the one in the video, will show "position size: $216.7M → $211.9M, funders: $464.7M → $414.6M". This is the main reason to come back, and right now it does not exist.

**J06. Position selection.** Works, 6.4 s, a new link. The "Largest position" label is wrong (L05). The chips disappear on a saved reading without explanation.

**J07. Sharing.** The PNG is honest and readable (checked): badge, headline, summary, diagram, limitation, time, link. The link returns exactly this reading. Missing: the preview (J01) and a ready-made text for a post (a "Copy post text" button: the summary plus the link, 280 characters; half an hour of work and a direct bridge to X).

**J08. Return.** There is not a single reason to come back other than remembering the product: no local "my checks" list (localStorage, no registration), no notifications, "what changed" does not fire (J05). The minimum: a list of recent checks in the browser with the date and the verdict, and a "Check again" button next to each.

## 8. Engagement and ease of understanding

The "three seconds" test: what a person understands on seeing a card for the first time. For a short with funders: a grey Unknown badge, a long headline, a bar, a dashed rectangle. The meaning arrives at the 10th second, after reading the summary. For a long: a brown "Looks like a bet" badge, "This looks like a real bet", and that is all; below, tiles without content.

What gets in the way: (1) the top line is a category, not a fact; the fact ("$465M ETH lies in wallets that funded this account, not in it") is hidden in the third line; (2) four grey blocks of equal weight under the diagram; (3) the words "unverified", "not counted", "could not identify", "not read" are repeated in six places on one card. The honesty is right, but it should be said once in large type and once in small, not six times in medium.

What raises engagement without losing honesty: vitals (L03), the direction of fills (L04), "what changed" on any repeat (J05), examples on the first screen (U02), a preview with an image (J01), text for a post (J07), a local list of checks (J08). None of these mechanics requires new sources, registration, a wallet or an LLM.

Ease of understanding for a judge: the rules table in the README is good, but on the card there is no path to "why it was decided this way". An expandable "How this was decided" block with the number and the text of the rule that fired, from the same table (`verdict.reasons` already exists), closes the question in an hour.

## 9. Superfluous and outdated

Superfluous on the page: the second button for the image (U09); the two empty tiles with a single position (U06); the second gallery paragraph "How these were picked" before the list (collapse into `<details>`); "PnL 30d" in the gallery list rows (a redistribution risk, section 3, and it is a second number that distracts from the verdict).

Superfluous in the repository for a public submission: `docs/audits/2026-09-19-pivot-ideas.md`, `2026-09-19-useful-ideas.md`, `2026-09-20-retail-actions.md`, `2026-09-20-competition-decision.md`. These are internal documents about choosing the direction; they say outright that the author "does not consider the current version a convincing bid for first place" and was considering other products. A judge browsing the repository will read this. The audits of 19.09 and 21.09 together with `reproduce.ts` and `verify.ts` are, on the contrary, a strength (one can see how the defects found were reproduced and closed); keep them. All six Russian documents contain the em dash (27, 17, 11, 2, 4 and 19 occurrences) contrary to the rule in the shared CLAUDE.md; if they remain public, replace the dashes.

Outdated: "305 tests" in the README (339); the subtitle about "copy this whale" (U03); in the demo-script the numbers from 21.09 and "995 credits" (the file warns about this itself, but before recording it has to be rewritten around vitals and "what changed"); `submission-checklist.md` names the deadline per the FAQ, the campaign page does not state the hour, re-check; the specification of 17.09 describes the old `/a/0x...` routes and "1-3 seconds", it is historical, worth marking this in its header, as was done with calibration.md.

What not to do before the 27th: LLM explanations, alerts and background jobs, wallet connect, a Telegram bot, a "best whales" leaderboard (directly prohibited by the redistribution guidelines), auto-refreshing the gallery (close to "near real-time redistribution" and burns credits), new endpoints for the sake of numbers. Each of these things adds failure surface before the recording, and the criterion "if it breaks in the recording, it doesn't qualify" is the harshest of the four.

## 10. Mechanics for this project and these users

User one: a person from Crypto X who saw a post "a whale opened a $200M short", and their question "to copy or not, and what is really there". The second: a judge with the criteria from section 3. Below is what gives the most over the remaining days, with an estimate of the effort.

| # | Mechanic | What it gives the reader | What it gives on the criteria | Effort |
|---|---|---|---|---|
| 1 | Position vitals: leverage and type, ±% to liquidation, unrealised PnL, funding since open (L03) | An answer to "what is happening with this position now" | Data Integration: Nansen is visible on every card, including the 87% of longs | 2-3 h with tests and PNG |
| 2 | `directional_portfolio` inside "Looks like a bet" (L01), v4, offline reexplain | 25-37 Unknowns become answers; the demo address on BTC gets "all 20 positions short" | Functionality: fewer "don't know"; honesty is preserved through source completeness | 3-4 h with tests |
| 3 | `supersedes` for any live check via the `latest:<address>` index (J05) | "What changed" on every repeat | Originality: the product shows movement, not a snapshot; the video shows it live | 2-3 h |
| 4 | A diagram readable at 375 px (U01) | A card from X opens on a phone | Functionality/Submission | 1-2 h |
| 5 | Three example chips under the field and a new subtitle (U02, U03) | The first click leads to a result | Submission: a judge without an address sees the product in 5 s | 1 h |
| 6 | Direction of fills in the headline coin over 24 h (L04) | "Building up or closing" | Data Integration (Hyperliquid), engagement | 2 h |
| 7 | `og:image` from the card PNG (J01) | A preview with the diagram in X and Telegram | Submission: the contest post itself gets an image | 3-4 h |
| 8 | Wallet age and funding source for longs with no more than 5 positions (L02a) | "A fresh wallet from an exchange, one position" | Data Integration for longs; +2 calls per long | 3 h |
| 9 | "How this was decided": the rule that fired, on the card | The "why" is clear | Documentation | 1 h |
| 10 | Text for a post and a local list of checks (J07, J08) | A bridge to X, a reason to come back | Engagement | 1.5 h |
| 11 | README: a short header (what, three commands, a GIF, the rules table), the long sections in `docs/` | "Run it in 10 minutes" | Documentation | 2 h |

The minimal strong set for the recording: 1, 2, 3, 4, 5. Then 7 and 11. Items 6, 8, 9, 10 with whatever time remains. The order matters: 2 changes the rules and requires a reexplain and re-reading the demo addresses, so it should be done first, not last.

## 11. Repository, documentation, submission

- The repository is public, CI is green, `.dev.vars` is not in the history, `npm audit` is clean. Good.
- README: in substance the best in the niche, but it is a 26 KB essay. The criterion "Clean README... run it in under 10 minutes" asks for something else: at the top, what this is, a screenshot or GIF of a card, three commands, the verdicts table, a link to the live site; the budget, the gallery, the ledger and "seven things the rules refuse to do" in `docs/`. Fix 305 → 339.
- The demo is not recorded, the post is not published, the form is not submitted. With five days left this is the main risk, bigger than any bug. Record on the 25th, not the 27th.
- The video script changes after items 1-5: open on an account with vitals and "what changed" (a live repeat of the demo address will show it, if item 3 is done), then the 97% hedge, then the book, then the PNG. The first frame should carry a fact, not an Unknown badge: the card headline for the reason `linked_exposure_unverified` is better rewritten as "$414.6M of matching ETH is in wallets that funded this account, not in it".
- The 1 000 calls counter: locally 1 125, not reconciled on Nansen's side. Reconcile in the dashboard before submission; the form asks for the key's email, so the check is done per account.
- Remove the internal strategy documents from the public tree (section 9).

## 12. Assessment by criteria and the plan

A subjective assessment of readiness, not a jury score and not a probability of winning.

| Criterion (25% each) | Now | What gets in the way | After items 1-5, 7, 11 |
|---|---|---|---|
| Data Integration | 7/10 | Nansen decides only for shorts (13% of cards); the paid-for fields are not shown | 8.5/10 |
| Creativity & Originality | 8/10 | The question and the diagram are unique among the submissions found; but the flagship says Unknown, and the screen looks like a dashboard | 8.5/10 |
| Functionality & Workability | 7/10 | Works, 339 tests; 47 "signals disagree", an unreadable diagram on a phone, 7 s without progress, the risk of external API failure in the recording | 8/10 |
| Documentation & Submission | 6/10 | An essay README, internal documents in the repository, the video and the post not done | 8.5/10 |

The average now is about 7/10, after the fixes about 8.5/10. Against the visible competitors (copy-trading scoring, a betting game, thesis checking) this is the submission with the rarest question and the strongest evidence base; the weak spot is not the idea but the first thirty seconds and the unfinished submission.

The plan by day:

| Day | What |
|---|---|
| 22-23 September | Items 2 (rules v4, reexplain), 1 (vitals), 3 (supersedes for live checks), 4 (the diagram on a phone), 5 (examples and the subtitle). Tests for each. Deploy on the evening of the 23rd |
| 24 September | Items 7 (og:image), 11 (README), clean-up of the internal documents, 6 and 9 with what remains. Re-read the demo addresses live, update the demo-script |
| 25 September | Rules freeze. Recording of the video (two or three attempts, with a reserve of credits and DEMO_KEY). The post on X. Reconciling the counter in the Nansen dashboard. The form |
| 26-27 September | Reserve: only fixes for what broke; no new mechanics. A repeat smoke-check of the live site from a clean window and from a phone |

If there is less time: drop 6, 8, 9, 10 first, then 7. Do not cut items 1-5 and the recording.
