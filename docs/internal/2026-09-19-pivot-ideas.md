**New directions for Meridian - research of 19 September 2026**

**Clarification after discussion with the user.** Obvious practical usefulness is required together with the logic depending on Nansen. CASEFILE is no longer considered the first recommended option: entertainment value and presumed learning do not confirm demand. The ideas presented below remain researched hypotheses. A dashboard by itself does not contradict the competition criterion; what needs to be checked is whether the computed decision changes when the input data changes. The new selection should start from a concrete user action and a measurable result, then check the role of Nansen and originality.

Task: choose a concept with a stronger competition submission than the current Bet or Book. Keeping the existing product is not a condition. These are product hypotheses after checking analogues and documentation; the new ideas have not yet been tested on users or with paid API requests. The working names have not been checked for trademarks or domain availability.

**Previous recommendation, replaced after the task was clarified.** Initially the first candidate was CASEFILE, followed by REWIND, CHAIN DIRECTOR and DOMINO. This order no longer applies. The new selection with priority on practical usefulness: [ONE RULE, STILL THE SAME and ALERT LAB](2026-09-19-useful-ideas.md). The research of the previous hypotheses and analogues is preserved below.

This is an order for testing hypotheses, not a forecast of placings. There is no complete public list of the current participants or the results of their evaluation; calling a product that has not yet been built the favorite would be unfounded.

**What this particular competition requires.** The organizer evaluates four equal components: use of data, working functionality, originality, documentation/demo. The FAQ additionally highlights attracting attention and retention. The recording must be understandable without a narrating voice. My conclusion from this: it is necessary to show a completed action and its result within a minute. Sources: [campaign page](https://nansen.ai/campaigns/meridian-buildathon), [FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).

**What I filtered out during the search.** The existence of an analogue does not rule out an idea, but it reduces the value of simple repetition.

| Direction | Analogue found | Reason not to choose the basic version |
|---|---|---|
| AI terminal, conversation with a wallet, signals and trading | [Nansen](https://nansen.ai/) | A significant part of the promise already exists at the organizer |
| "Guess the next candle" game, hidden ticker | [CandleOps](https://www.candleops.com/), [One Candle Ahead](https://play.google.com/store/apps/details?id=com.onecandle.ahead) | Hiding the future/ticker by itself does not create novelty |
| "How much you missed by selling early" | [Bags Fumbled](https://fumbledbags.com/) | A recognizable wallet regret format already exists |
| Wallet roast, buying at a local top | [Exit Liquidity](https://exitliquidity.trade/) | The analogue already combines analysis and a card for publishing |
| Real cost of exiting a position | [Cryptominium Sellability](https://cryptominium.com/tools/sellability), [MoonMath](https://moonmath.info/tools/liquidity-stress) | Useful, but a sale/liquidity calculator by itself is familiar |
| Polymarket leaderboard "skill instead of profit" | [WhaleTracks](https://whaletracks.com/tools/sharp-leaderboard), [PolyTape](https://polytape.io/) | The niche is already taken; justifying the skill metric requires separate work |
| Graph of connected wallets + history | [Bubblemaps, description from the team](https://www.linkedin.com/posts/bubblemaps_bubblemaps-is-now-live-on-monad-users-can-activity-7399824774471852033-qydb) | The graph and the rewind already exist; a new action on top of them is needed |
| Universal DeFi stress test | [DeltaZero](https://github.com/Teecash96/DeltaZero), [ZARQ](https://zarq.ai/) | A lot of mathematics and coverage before a difference noticeable to the user appears |

Product descriptions were studied; no audit of their working applications was carried out. Their claims about accuracy, returns and full coverage are not confirmed here. Some sites are available only through indexed descriptions.

**1. CASEFILE - an investigation in 90 seconds.**

Promise: "Can you reconstruct what happened to the money? All the clues are real transactions."

The user opens one short case. In front of them are several addresses, a timeline and a specific question. They expand the operations, match the amounts and mark the evidence. The finale replays the established sequence and shows links to the transactions. The score depends on correctness and the number of hints used; money bets and wallet connection are not needed.

An example of the task form, not yet a real case that has been found: "Tokens left address A. On which of the addresses shown did a DEX swap into USDC then take place?" The player chooses a route from the observed transfers and attaches the swap to their answer. When funds are mixed, it cannot be claimed that exactly "those same" units were sold; the question is limited to the observed sequence of addresses and operations.

Two more case types: distinguish a token transfer from a confirmed swap; reconstruct the order of three events from timestamps and balance changes. The tasks should be more substantive than reading a single ready-made line, but have a single answer within the designated data set. Ownership of addresses, criminal intent and "insider" are not part of the verifiable answer.

What creates the Nansen value: the API supplies real events, assets, amounts, times, counterparties and balance changes. The program builds the permissible moves from them, confirms the answer and shows the resolution. Replacing the data changes the case itself.

Documentation basis: [Address Transactions](https://docs.nansen.ai/api/profiler/address-transactions), [Address Counterparties](https://docs.nansen.ai/api/profiler/address-counterparties), [Address Historical Balances](https://docs.nansen.ai/api/profiler/address-historical-balances). Sender/recipient addresses, token identifiers, hashes and timestamps are available; this makes it possible to verify facts. Large histories require pagination, so the MVP needs short intervals and a limited graph.

A 50-second demo: 0-5 - the case question; 5-20 - two expanded graph edges; 20-30 - the player marks the swap; 30-40 - verification and the animated resolution; 40-50 - the source, the result card and "give a friend the same case". Show the loading of data from Nansen explicitly. A pre-prepared case has a snapshot date; it is not passed off as current activity.

Why this could spread: a friend receives the same challenge without the answer revealed; one shared task per day gives a reason to compare results. For newcomers it is practice in reading the blockchain, for crypto authors it is interactive material.

Similar ideas exist. [CrimeFiles](https://ethglobal.com/showcase/crimefiles-ijfz3) uses a detective plot, character agents and a payment mechanic. [Cryptopol](https://shura.shu.ac.uk/34181/18/Hancock-DesignOfCryptopol%28%20VoR%29.pdf) studies teaching cryptocurrency investigation through a game. Therefore "the first detective game in crypto" is incorrect positioning. The difference of the proposed product: short public tasks, automatically verified against real Nansen data, without fictional suspects or paid hints. No complete match for this implementation was found in the sources reviewed; the absence of a search result does not prove uniqueness.

MVP: one chain, three manually selected and verified cases, one type of interactive graph, hints, deterministic verification, a debrief, a share link. After the competition - a case editor for authors and automatic search for candidates. Before the competition, do not build free-form investigation of any wallet or an autonomous AI detective.

Main risk: boring or ambiguous tasks. Spend the first day on the data and a playable prototype of one case. If a person either answers at first glance or does not understand what to do after a short explanation, change the mechanics before polishing the presentation.

**2. REWIND - make a decision while the future is hidden.**

Promise: "Look at the market through the eyes of a person who does not yet know how it all ended."

A round shows a token and data at an exact historical moment; the name and date are hidden if necessary. The user first records a preliminary assessment, then chooses two or three research hints: flows, buys/sells, concentration or balance changes. After refining the assessment, they open the next period and the debrief. The result stores both assessments and the evidence used.

The distinctive part that needs to be implemented: a limited choice of research actions, historically correct information and a comparison of one's own decision before/after the information. A single "Buy" button next to the candles would end up too close to existing games.

This is a training environment. The fact of a subsequent rise does not make any argument for buying correct. Show the market outcome and the quality of the verifiable claims separately. Do not write that several won rounds prove skill, and do not select exclusively cases where the Nansen metrics "saved" the player in advance.

The technical possibility is confirmed by the [Backtesting Data](https://docs.nansen.ai/api/backtesting-data) documentation: there are point-in-time versions of the endpoints. They are in Beta, cost more than regular requests and may change after corrections to historical data. The documentation mentions the possibility of using an existing API key, but access with your key specifically has not been checked.

An important detail: [Historical Token Flow Summary](https://docs.nansen.ai/api/backtesting-data/historical-token-flow-summary) uses wallet categories as of the historical date. For a number of categories, coverage starts on 11 March 2025; absence of coverage is denoted by NULL. For the MVP, choose later dates, check the fields and record the snapshot obtained. A missing hint must not be filled in with a zero, nor may today's categories be used in a past task.

MVP: one chain, five rounds, three kinds of hint, the same horizon for revealing the result, a share card, a library of dated snapshots. Live API loading of one selected historical snapshot in the demo is compatible with an honest "data as of date" caption; live does not mean that the event happened today.

Main risks: obtaining complete historical data, the API format, the rights to publicly display the new Beta endpoints and dependence on the quality of round selection. In the current redistribution table the new historical paths are not fully listed - they cannot be considered automatically permitted. Check the applicable terms before choosing this architecture. Separate requests are needed for the future outcome; they must not reach the browser before the player answers.

I rank this option above an ordinary trading simulator, but below CASEFILE in terms of how quickly viability can be checked. It becomes the first choice if the historical dataset is easy to assemble and a trial round is interesting without explanations.

**3. CHAIN DIRECTOR - turn operations into a story that can be verified.**

Promise: "Address and period → a short visual story of the movement of money."

The author pastes an address, chooses a token and an interval. The application extracts confirmed events and assembles a sequence of scenes: inflow, swap, transfer, balance change. The author chooses the events and wording, starts the animation and shares the link. During viewing, a scene can be stopped and the confirmation opened.

A strong demonstration: a long list of operations turns into three understandable scenes within a few seconds. Every caption has a source, and correcting a selected event changes the story. The product's object is material for publication, so there is a clear repeat-use scenario here for analysts, researchers and authors.

Nansen determines the selection of events, the amounts, the graph and the time order. The narrative is built from limited templates and confirmed fields. An LLM edits the style if desired; it must not be entrusted with calculations or with explaining the owners' motives. Without known starting balances, all inflows must not be turned into returns, nor a move to another address into a sale.

MVP: one chain, one address, one token, three scene types, an interactive link, a final card. MP4 export is a separate task to be verified; do not build it into the first prototype as a promise. The demo of the product itself can be made with an ordinary screen recording.

The graph market is already taken, for example by Bubblemaps. Our presumed difference is the automatic preparation of editable material with confirmation of every event. No exact analogue of such a combination was established in the sources reviewed, but a full check of the market of tools for authors is still needed.

Main risk: most addresses produce a boring story. Test: three substantially different addresses should produce different meaningful plots. If each one requires hours of manual investigation, it is better to honestly frame the MVP as an editor of research stories rather than promise generation for any address.

**4. DOMINO - see the shared dependency of different DeFi positions.**

Promise: "You have several positions. What happens to them under one common shock?"

A public address turns into a diagram: assets, deposits, debts, protocols. The user changes the scenario price of one asset; the affected positions are highlighted, the net asset estimate is recalculated. The strong scene is several outwardly different positions turning out to depend on one underlying.

[Portfolio API](https://docs.nansen.ai/api/portfolio) returns current protocols, assets, debts and position types. However, it does not provide a ready-made complete model of dependencies, oracle risks and liquidations. For a narrow MVP, direct token exposures and a few verified adapters are acceptable. `mixed` and opaque positions must remain uncovered; sensitivity is not the same as a prediction of the actual loss.

This is a useful applied product, but existing solutions already do stress testing. In the remaining time it is harder to obtain both a noticeable difference and correct coverage at the same time. Therefore keep it as a fallback option for choosing a serious analytical direction, not as the main competition pivot.

**Comparison for the decision.** The assessments below are qualitative, based on the proposed scope of work and the event's criteria. They are not jury scores.

| Concept | Strongest property | Weakest side | What to check first |
|---|---|---|---|
| CASEFILE | Understandable action, verifiable answer, shared challenge to friends | Quality of the tasks | Whether three interesting unambiguous cases can be assembled |
| REWIND | Visible role of information in decision-making | Beta data, risk of a trivial guessing game | A complete historical snapshot and one strong round |
| CHAIN DIRECTOR | Usefulness to the author and material that spreads by itself | Automatic selection of a meaningful story | Three addresses → three different evidence-backed stories |
| DOMINO | Practical understanding of one's own risk | Coverage and the financial model | One correct protocol adapter and no double counting |

**How to check the strongest option before investing the whole week.**

1. Assemble a real set of events for one CASEFILE and manually confirm the answer through the transactions. Document which information may be incomplete.
2. Make a rough screen: the question, several addresses, two hints, answer selection, the resolution. Presentation is secondary for now.
3. Show it to 3-5 people without explaining the mechanics. This is a diagnostic check of comprehensibility, not statistical proof of demand. Watch whether they understood the task, whether they reached the resolution and whether they wanted to open a second case.
4. Check that the sources allow adding new cases without rewriting the game. A prototype with one manually hard-coded puzzle does not validate the product.
5. Only after that spend time on the visual presentation, the mobile version and the demo.

If the first item fails, move on to REWIND and check its availability/terms. If interest in both game scenarios fails, switch to CHAIN DIRECTOR, having checked the usefulness for a specific author.

**Realistic scope until 27 September.** One day for checking the data and mechanics, two or three for the main scenario, one for additional cases and answer verification, one for the mobile version and export/links, the last reserve for bugs and the competition recording. This is an estimate for a narrow MVP with daily work, not a promise of a deadline. All four concepts cannot be done at the same time.

From Bet or Book, the hosting on Workers, the server-side access to Nansen, some normalizers and the approach to cards can be reused. The spend counters and part of the error handling should first be fixed according to the audit. The new products do not need the bet/book classifier. It is not worth holding on to the code already written.

**Data and the competition submission.** For CASEFILE and DIRECTOR the basis can be limited to transactions, counterparty and historical balances; display terms are published for the corresponding endpoints. Keep the mandatory Nansen attribution. Do not include closed labels or Smart Money lists in public cards. The new Beta endpoints require separate clarification of the applicable terms: [redistribution rules](https://docs.nansen.ai/guides/redistribution-guide).

The competition allows one submission per account. The final repository, recording and application must describe the chosen product. The old Bet or Book counter by itself does not demonstrate meaningful use of data in the new idea; do not carry it over into the demo without explanation. Prepare the data set with useful requests, not by artificially inflating the number of calls.

The research did not change the application and did not spend Nansen credits. No messages were sent to the organizers or to the authors of the products.
