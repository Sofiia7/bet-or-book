**Bet or Book - audit of 24 September 2026 (evening, after the 23.09 audit was closed)**

Version checked: `ff92691`, which is also the one deployed. Checked: the Worker sources (routes, the three check stages, rules, features, source normalisation and validation, budget and limits, snapshots and comparison, the og image), the page and its script, the gallery and demo-reading data, the documentation and the live site. Sources, data and deployment were not changed during the audit; not a single paid check was run.

**Conclusion.** Everything the 23.09 audit asked for has been done and works: three stages, validation of every upstream response, honest comparison of readings, the link image, the operator key in a header, four fresh demo readings, runtime tests. Logic and security are in order. What remains is presentation: the first screen has no image, the Book and Bet cards have no image "of their own" and no decisive number, one and the same account appears twice on the page with different figures, the "Your recent checks" line lies. These are cheap fixes, and they are exactly what decides the first three seconds with a judge. By the contest criteria this is the top group of entries; it cannot be called a "strong favourite" without knowing the field, and the video, the post and the form are not done yet.

**What was actually checked.**

- `npm test`: **551/551**, 42 files. `npm run test:runtime`: **9/9** on workerd. `npm run typecheck`: both configurations. `npm audit`: 0 vulnerabilities.
- Live site: `/`, `/app.js`, `/api/gallery` (110 KB instead of the previous 730), `/api/ledger`, `/api/snapshot`, `/api/og` (PNG), `/?s=` with the og tags substituted - all 200. `GET /api/check` with no record - 404 and spends nothing. POST with a foreign `Origin` - 403 before any spend. A garbage address and a garbage id - 400. `/?s=nonexistent` - the ordinary page.
- Headers: CSP without inline-script, `frame-ancestors 'none'`, `nosniff`, `referrer-policy`.
- All four demo readings opened in the browser: desktop, 375 px, dark and light theme. Downloaded the canvas image ("Download image") and the og images of all four readings plus the placeholder.
- Cross-checked `data/featured.json` and `data/gallery.json`: rule versions, `superseded`, duplicate addresses.

Not checked: the Nansen and Cloudflare dashboards, real multi-region contention, rule accuracy on an independent labelling, the video, the post, the form.

**Logic and data.**

**L01 · P1 - The Book card does not show the number the verdict stands on, and its image argues with the badge.** Rules v5 recognise a book by the quotes in the market of the position itself: on the demo account `headlineTwoSidedNotionalUsd` = $42.9M against a $46.9M short (91%). That number appears nowhere on the card: the summary is "2,613 resting orders quote both sides of 123 markets", the Resting orders tile is a count and the number of markets. The README takes pride in this number, the card is silent. Worse: the diagram for Book draws a hedge - "$45.9M (98%) not checked for a hedge" under the Book badge. A hedge was not looked for on a book by rule (`hedgeCanChangeVerdict` returns false), yet the picture shows the omission as a hole in the reading. `docs/demo-script.md` itself admits that the book's bar "says less than the sentence" and drops the Book beat from the video. Location: `src/engine/evidence.ts` (`bookSummary`, the Book tiles), `src/engine/breakdown.ts`. Fix: for Book the bar = quotes in the position's market (matched $42.9M of $46.9M), the decisive tile "Two-sided quoting in ETH: $42.9M (91% of the position)", and in the summary add "including $42.9M matched in ETH itself". Then the Book beat can go back into the video.

**L02 · P1 - The most frequent answer has neither a decisive number nor an image.** "Looks like a bet" - 132 of the 191 current cards. Its decisive tile is "Largest position $130.0M HYPE long": a tautology, because `DECISIVE_LABEL_BY_REASON` does not know `directional_concentration` and `markDecisive` takes the first element. There is no diagram for a long at all, and the og image is an empty lower half (checked on `3p2dqa2fjl01r`). Fix: one visual language for all four answers - bet = exposure bar (gross across positions, the main one highlighted; a single position = 100%), hedged = coverage, book = quotes, unknown with funders = coverage plus the dashed block. The decisive tile for bet - "Share of exposure 100%, no two-sided quotes, no cover found".

**L03 · P2 - One account is shown twice with different figures.** The chip "$209.1M ETH short" and gallery row #2 "$216.7M ETH short · 0xb83d...6e36" are one address; the chip "$130.0M HYPE long" and row #3 "$125.9M HYPE long"; the chip "$41.8M HYPE short" and row #15 "$42.7M HYPE short". `galleryIndex` removes only the entries with `superseded` inside `gallery.json`; the demo readings reference the gallery ones through `supersedes`, but there is no reverse mark in the gallery. Checked against the data: `07dr4tcn26rwx`, `082e843a-mu71i2vu`, `1ny4ncx4j6myd` - `superseded=false`. Fix: in `listedGallery` (`src/index.ts`) do not show a row whose address has a newer featured reading, or label it "re-read 24 Sept".

**L04 · P2 - "Your recent checks" fills up with readings the visitor merely opened.** `saveRecent` is called in `renderResult` for any `kind`, including chips and the gallery. Checked live: after three chips the line shows three "recent checks", although no checks were run. Either "Recently opened", or save only live ones.

**L05 · P2 - Nansen's contribution for Book and Bet sounds weak, although the proof lies right there for free.** The "From Nansen" line on the book: "positions on every dex, 134 open positions". Meanwhile the README gives the contrast "134 versus 86 on the main dex", which the card does not know about: `clearinghouseState` is read only as a fallback. The free request already exists; read it always, in parallel with the other free ones, and print the delta: "134 positions on Nansen; 86 visible on Hyperliquid's main dex". Zero credits, direct proof of Data Integration on every card, plus a cross-check of position sizes between sources.

**L06 · P2 - A duplicate tile.** "Size vs open interest" appears both in evidence and in vitals on the same card (the demo bet). It decides nothing - its place is in vitals. It is logical to move "Realized PnL, 30d" there as well: the 23.09 audit asked not to make the account's PnL evidence about the position, yet it is still among the evidence.

**L07 · P3 - Bet is withdrawn on any two-sided market, with no materiality threshold.** `concentrated` and `directional` require `coinsBothSides === 0`, while `coinsBothSides` counts a market as two-sided at bid > 0 and ask > 0 of any size. Since 23.09 Book requires materiality (2 × min(bid, ask) ≥ $10K and 10% of the position); withdrawing bet does not: $200 of two-sided orders in a memecoin remove the answer on a $20M HYPE long (case 13 in `docs/case-review.md`; 21 "signals disagree" out of 191). It is logical to apply the same threshold. But this is a rule change (v6) with a re-reading of the gallery three days before the deadline - postpone until after submission unless there is a spare day.

**L08 · P3 - The `check:` cache key does not contain `ASSET_REGISTRY_VERSION` and `OBSERVATION_SCHEMA_VERSION`.** After a deploy with a new registry, answers from the old one are served for up to ten minutes. A trifle.

**L09 · P3 - Dead code.** `looksLikeButUnverified` (`src/engine/assets.ts`) and the budget's `sync` action (`src/budget.ts`, `src/coordinator.ts`) are called by no one. Noted on 22.09 (K12), still there.

**L10 · P3 - A reasons dictionary on the frontend.** `headlineFor` in `web/app.js` holds seven `reasons.indexOf(...)` with headlines of its own, although `rule`, `openQuestion` and `nansen` already come from the server out of `explained()`. Move the headline there too - a single point of truth.

**Interface, user journey, visuals.**

**U01 · P1 - The first screen is text, while the strongest visual is one click away.** Title, subtitle, field, four chips, the gallery list. The bar with the dashed "held elsewhere" block - the thing a judge should see within three seconds - appears only after a click on a chip. Fix: on arrival without `?s=` and without `?address=`, open the flagship reading (funders) straight away as "Saved reading from 24 Sept" - it is free, is bundled with the Worker and is already honestly labelled. One line at the end of `web/app.js`. Close L04 first, otherwise the auto-open will land in "recent checks".

**U02 · P2 - The "Unknown" badge on the flagship and on 21% of the gallery.** The headline explains, but the badge is what is seen in three seconds, on the "recent" chips and in the link's og title ("ETH short: not settled by what could be read"). Keep the internal four verdicts; give the badge for unknown a state by reason: "Unknown · assets sit with funders", "Unknown · hedge not checked", "Unknown · partly covered". The dictionary already exists in `src/engine/reasons.ts`.

**U03 · P2 - Waiting with a single static line.** A check takes 5-10 seconds, and there is one phrase on the screen. Without streaming, the honest option: show the reading plan as a list (Hyperliquid: orders, fills, spot balances; Nansen: positions on every dex, balances on every chain, funding links) with an indicator and the caption "usually 5-10 seconds", ticking nothing off - the client does not know where the server is.

**U04 · P2 - The name.** On the page "Bet or book", in the README, og and the tab title "Bet or Book". The first word on the screen must match the brand.

**U05 · P2 - og images.** For the short - excellent (badge, sentence, bar, dashed block, date, limit). For the long - an empty half, for Book - an almost empty "hedge" bar (see L01, L02). It will resolve itself after those. The placeholder "Paste a Hyperliquid address…" is good.

**U06 · P3 - Mobile version and light theme.** 375 px checked: the card is readable, the stacked diagram works, captions are 12 px. The light theme works. On a phone there are about 1000 px of chips and captions before the card; with auto-open (U01) the chips can be squeezed into a single scrollable row.

**U07 · P3 - The gallery under the card.** 177 rows, 132 bet, almost all longs: honest, but of little information to a judge. Collapse it into a `<details>` "Browse the 177 scanned positions" by default, so that the page ends with the card and the footer.

**U08 · P3 - Copy.** "This looks like a real bet." - the word real argues with "looks like"; better "This looks like a directional bet." "What changed since…" on the book: "went from Book (strong) to Book (likely) because both the reading and the rules changed" - correct and good.

**Security and operations.**

**S01 · P2 - The public daily budget runs out in minutes, and the judges will be pressing Check all week.** 260 of 300 credits are publicly available; a check costs 2-7. A curl POST without `Origin` passes `fromThisSite` deliberately. 40-130 checks - and until midnight UTC every judge gets "Nansen not used (today's credits are used up)". The reserve of 40 protects the video, not the judges. For 25-30 September raise `NANSEN_DAILY_CREDIT_CAP` (balance 916 credits), keep the reserve; revert after the results. Turnstile - only if abuse is noticed.

**S02 - The rest of the launch checklist has not changed since 23.09 and is in order:** no logins, sessions, SQL, webhooks or uploads; the only input is the address, coin, side, snapshot id, all checked by regexes before reaching a path or a key; two fixed upstream hosts; the key in a Worker secret and git-ignored `.dev.vars`, CI looks for a leak by pattern; paid - only a POST from this site; budget and limits in Durable Objects; the operator key in a header, compared by SHA-256; errors to the client are generic; `npm audit` 0.

**Documentation and repository.**

**D01 · P2 - The README is already out of date in its figures today.** 1,136 calls versus 1,173 in the live `/api/ledger`; 548 tests versus 551. Before submission, update or replace the fixed numbers with a link to the ledger.

**D02 · P2 - Internal strategy documents in the public repository.** `2026-09-19-pivot-ideas.md`, `2026-09-19-useful-ideas.md`, `2026-09-20-retail-actions.md`, `2026-09-20-competition-decision.md` - in Russian, about whether to abandon the product for a detective game or conditional orders. To a judge this is noise and a misleading signal. Move them to `docs/internal/` or remove them from the tree (the history will remain in git). The 19-23.09 audits with reproductions are, on the contrary, an asset: keep them.

**D03 · P3 - Working leftovers in `data/`.** `rescan-offset.json`, `rescan-offset2.json`, `rescan-offset3.json`, `prescan-candidates.json` (6,054 lines) are not described in the README (22.09, C04). Describe them in one line or remove them.

**D04 · P3 - Comment density.** The audit history in the comments explains the "why"; for a hackathon that is more of a plus. After submission - move the history into ADRs, keep the invariants.

**What is superfluous or out of date.**

- The internal documents about the pivot (D02).
- The `rescan-offset*` files (D03).
- The duplicate "Size vs open interest" and the PnL among the evidence (L06).
- Dead functions (L09).
- The "Your recent checks" line in its current form (L04).
- The gallery row for an account that has a fresh demo reading (L03).

**Mechanics before submission, by cost and effect.**

| # | What | Closes | Estimate |
|---|---|---|---|
| 1 | Quotes bar and decisive tile for Book | L01, U05 | 2-3 h |
| 2 | Exposure bar for the long and the portfolio bet, including og | L02, U05 | 2-3 h |
| 3 | Dedup of chips and gallery | L03 | 30 min |
| 4 | "Recently opened" or live only | L04 | 15 min |
| 5 | Always read the main dex for free, print the delta with Nansen | L05 | 1 h |
| 6 | Auto-open the flagship on an empty arrival | U01 | 30 min |
| 7 | Badge by reason for Unknown | U02 | 1 h |
| 8 | Raise the cap for judging week | S01 | 5 min and a deploy |
| 9 | README figures, moving the internal documents | D01, D02 | 30 min |

After submission: a materiality threshold for withdrawing bet (L07, v6), a watchlist in the browser, observing quotes over time, Turnstile. Do not add: trading, copy-trading, an AI chat, a 0-100 score, a Telegram bot, new chains - they close nothing that was found and dilute the question.

**Assessment by the contest criteria.** Subjective, not a forecast of the judges.

| Criterion | 23.09 | Now | What will raise it |
|---|---|---|---|
| Data Integration | 7 | 8 | L05 and L01: Nansen's contribution visible on every card, not only on the flagship |
| Originality | 8 | 8.5 | the question, the refusal to conclude, the dashed "held elsewhere" block |
| Functionality | 6.5 | 8 | after L01-L04 - 8.5 |
| Documentation & Submission | 7 | 7 | the video, the post and the form are not done; after them - 8.5 |

The main risks of the entry: the video and the submission are not done yet; the first three seconds on the site are text; exhaustion of the public budget during judging week. None of them is about logic or about security.

**Order of work.**

1. L04, L03, U04 - half an hour, they remove the visible inconsistencies.
2. L01 and L02 - one visual language for the four answers; after that re-render the bundle's og (`scripts/prerender-og.ts --upload`, this is a new layout v4 and a new key).
3. L05, U01, U02 - Nansen's contribution and the first screen.
4. S01, D01, D02 - configuration and the repository.
5. The video per `docs/demo-script.md` with the Book beat restored, the post, the form, reconciling the counter on Nansen's side.

**Appendix. Review of the external marketing feedback (received 24.09 in the evening).**

The feedback's diagnosis is correct and coincides with U01, U02, L01, L02: the presentation is drier than the product, the first screen has no image, Book and Bet have no visualisation of their own. The remedies mostly do not fit: they change the metaphor instead of the hierarchy and require drawing every picture twice (SVG on the page and satori for the link image), which has already once led to the page and the preview diverging (U02 of 23.09). The general selection criterion: we take what makes the existing figures more noticeable; we reject what replaces figures with a metaphor or adds a judgement ("reckless", "Debunked") that the data does not support.

| Idea from the feedback | Decision | Why |
|---|---|---|
| A "so what" layer after the verdict | Take as the wording of the headline, without advice | The card headline already exists; make it the answer to the reader's question: "Not a view on price: a market maker's inventory", "One directional view, nothing found against it". The product deliberately gives no "don't take your cue from this" advice |
| Guess the outcome before it is shown | Take (user's decision 24.09) for the live wait | The slot is honest: the 5-10 s of waiting are empty, the answer is not delayed. Only on a live check and only if the answer has not arrived within ~700 ms; four chips Bet / Hedge / Book / Can't tell, optional; after the answer one line "You guessed X. The reading says Y", a match counter in localStorage. Do not write the word "correct". A ready-made beat for the video at seconds 4-8 |
| A rankings board | Take (user's decision 24.09), in a measurable form and without the word "reckless" | Rank what is observed: bets by size, share of a market's open interest, shorts with coverage below 10% and within 85-115%, books by quotes; each row with the date of the reading. Rows: the 191 current readings plus today's 4 already make a board; dynamics - daily re-reading of the top 10-15 addresses via prescan (40-50 credits a day) or visitors' live checks. Do not write "leaderboard" in the interface; before publishing, re-read Nansen's redistribution guide: we rank our own computed features from the profiler endpoints, not perp-leaderboard data. Replaces the "More readings" list (closes U07) |
| The card as a "trophy" or an "exposé" | Strengthen the hierarchy, keep the words | A bigger badge and bar, less grey text - yes. "Debunked" - no: the project's best card says "Unknown: the ETH sits with its funders", and that is not an exposé |
| A gravity model, planets and orbits | Reject | An orbit does not encode magnitude; the bar answers the question "what share is covered" in a second, an orbit does not. Plus double rendering for the preview |
| A scanning beam during loading | Take a neutral version | An honest waiting animation solves U03. Showing "the market maker's gears" before the verdict is not allowed: there is no verdict yet |
| Flooding the screen with the verdict colour | Reject; strengthen the existing accent | Red for bet is an editorial judgement (a bet is not "bad"); colour as the sole carrier of meaning is bad for accessibility. The four muted colours already exist; moving them onto the card border is acceptable |
| "Anti-FUD patrol", reply templates for tweets | Take as positioning | The product's entry point is a reply under a post about a whale (J01 in the 22.09 audit). The "Copy post text" button already does this; rename it to "Copy reply for X" and add a headline. Without the word Debunked |
| An embed widget for the media | After submission | The CSP `frame-ancestors 'none'` is there deliberately. Only saved readings can be embedded, on a separate route, without the Check button: otherwise someone else's page spends our credits on a reader's click. Nobody will embed it before the deadline |
| A "dossier", details decoded before your eyes | Reject | The details are hidden at the audit's request, so as not to make noise; theatre delays the reading and annoys whoever came to check a figure |
| Risk scales | Take (user's decision 24.09: the bar was found incomprehensible by the very first reader) | The left pan is the position, the right one only the counted coverage, the beam's tilt = the ratio (0% maximum tilt, 85-115% level, above that an overweight with the caption "leans long"). What is not counted does not sit on the pan: the funders' ETH hangs beside it on a dashed thread "not on the scale: funding is not ownership", unrecognised tokens there too as a hatched mark, "not checked" as a ghost pan with a question mark. Book is not scales but a mini order book: bids on the left, asks on the right, the position's market highlighted, the caption "$42.9M quoted both sides of ETH itself". Long: the right pan is empty by definition, the caption must say "spot cannot offset a long", otherwise it reads as "we looked and found nothing". Three renderings (SVG, canvas, satori) and a new preview layout v4 with re-uploading 310 images - a day's work; first the page SVG and showing it to two or three people next to the bar, and if it is not ready by the evening of 26.09 - the bar goes into the video |
| A detective's link board | Already exists in minimal form | The dashed link to the "held elsewhere" block is a two-node graph; no more than two funders are read (`MAX_FUNDERS`) |
| An echo radar for Book | Possibly, as a second line under the bar, after L01 | The only idea that closes a real hole (Book has no image). But the hero must remain the figure of quotes in the position's market ($42.9M of $46.9M); the dots for 123 markets are decoration under it |
| A Telegram bot | After submission | Out of scope per the spec and the 23.09 audit. A bot is a paid check by a single command without the site: the public budget would go in an hour. Technically a thin client over `/api/check` and `/api/og` can be written in a day, but it needs its own reserve and a per-user limit, and it moves none of the judges' criteria |

**The user's decisions on the evening of 24.09 and the order of work with them.** Three mechanics from the feedback are accepted: guessing during the live wait (1-2 h, app.js only), a rankings board by measurable features (3-4 h plus 1 h for the daily re-reading of the top addresses), scales instead of the bar for shorts with a mini order book for books (a day's work, three renderings). L01 and L02 are absorbed by the move to scales: the book gets an image of its own, the long an honest empty pan with a caption. Order: 25.09 - L03, L04, guessing, the board; 26.09 - scales (SVG, then canvas and satori), re-rendering the bundle's og, a final check of the page at 375 px; 27.09 - the video, the post, the form, reconciling the counter on Nansen's side. Do not touch the rules (v5).
