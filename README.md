# Bet or Book

**Paste a Hyperliquid address. Find out whether that whale position is a bet you could follow, a hedge, or a market maker's book.**

**Live: [bet-or-book.sofiaseremeteva.workers.dev](https://bet-or-book.sofiaseremeteva.workers.dev)**

Built for the [Nansen Meridian Buildathon](https://www.nansen.ai/campaigns/meridian-buildathon) (14-27 September 2026). Powered by Nansen API.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not what the headline makes of it:

- The account behind one of those posts is a **market-making book**: 134 open positions, 1,403 resting orders quoting both sides of 76 markets, 2,000+ fills a day. That is a business, not a view on price.
- Another was reported as hundreds of millions in bearish shorts, and the first version of this tool agreed it was hedged. It is not that simple: **next to none of its $216.7M ETH short is covered by anything that address holds**, and the matching ETH sits in wallets that funded it. A funding transfer is not ownership, one such funder turned out to be an exchange, and part of that ETH is an Aave deposit with an invisible loan against it.
- And sometimes it really is a bet: **one $125.9M HYPE long, the account's entire exposure, nothing offsetting it**.

Bet or Book answers one question per address, shows the numbers that decided it, and says what it could not read.

## What a check returns

- **A verdict**: Book, Hedged, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` for a book).
- **One sentence built from the numbers**, e.g. *"The $42.7M HYPE short is 97% covered by $41.3M of spot HYPE held by this address on Nansen-supported chains."*
- **A picture of what stands against the position**: one bar for the position, split into what this address holds against it, what could not be identified, and what nothing was found against - with anything held by a wallet that merely funded this one drawn beside the bar on a dashed connection, never inside it. That distinction is the whole card, and a row of percentages is a poor way to carry it.
- **A choice of position.** A post says BTC and the largest position at the address is ETH. The card offers the address's largest few and will answer about the one you came for.
- **What changed since the last reading**, where there is one - and whether the answer moved because the account did something or because the rules did. Those look identical on a card and are not the same event.
- **Up to five evidence numbers**, each tagged with the source that produced it (Nansen, Hyperliquid, or both).
- **The funding wallets**, with explorer links, when they hold the matching asset. They hold it; that is not the same as this account holding it, and the card says so.
- **What could not be read**, every time: which sources were missing or cut short, how old the numbers are, and which rules read them.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **A share card** (PNG, carrying those limits) and a link that reopens *this* reading rather than starting a new one.

## How the verdict is decided

Rules run in order; the first one that fires wins ([`src/engine/verdict.ts`](src/engine/verdict.ts)). The set is versioned: `CLASSIFIER_VERSION` travels with every answer, because a verdict means nothing without the rules that produced it.

| # | Verdict | Rule |
|---|---|---|
| 0 | Unknown | no open positions |
| 1 | Book | 50+ resting orders with 25-75% bids quoting both sides of 5+ markets, **and that two-sided quoting worth at least 10% of the headline position** (floor $10K). A wide spread of positions and a busy fill count corroborate and raise it to `strong`; neither decides alone |
| 2 | Hedged | 2-19 positions netting to 35% or less of gross **with 80%+ of that gross cancelling inside individual assets**, or spot of the same asset held by this address covering 85-115% of a headline short **when those holdings were read in full** |
| 3 | Unknown, `over_covered` | the spot leg is larger than the short: the account is long the asset it is short. The one conclusion an incomplete read still supports, since missed holdings can only add to it |
| 4 | Unknown, `hedge_not_checked` | the holdings could not be read in full, so neither their absence nor a ratio measured over part of them proves anything. What was found is reported as a floor |
| 5 | Unknown, `unrecognised_assets` | 10%+ of the position sits in holdings whose asset this tool could not establish, so "nothing offsets this" is not available to say |
| 6 | Unknown, `partial_offset` | 10-85% covered: what is left over is still a position, and the card says how much |
| 7 | Looks like a bet | 5 or fewer positions, net 80%+ of gross, the largest 50%+ of exposure, under 10% covered, no two-sided quotes - **and the orders and positions both read in full**, because every clause of this rule is an absence |
| 8 | Unknown | `quotes_not_checked` / `positions_not_complete` (a source the bet rule asserts something about would not answer), `mixed_long_short_book` (the dollars net out across different assets), `diversified_book_no_quotes` (the shape of a book with nothing quoted to say so), `maker_flow_only` (busy, but nothing says this position is inventory), `linked_exposure_unverified` (the matching assets are in a wallet that funded this account), or the signals simply disagree |

Seven things the rules refuse to do, each one an audit finding:

- **A funding wallet's holdings are never this account's hedge.** A transfer shows where money came from, not who holds it now, and an exchange is a common funder. Such holdings can withhold a verdict, never grant one.
- **A dollar balance is not an offset.** $1M BTC long against $1M TRUMP short nets to zero and leaves both bets running.
- **A hedge is a band, not a floor.** 52% and 195% coverage are different situations and get different answers.
- **A gap in the reading is not a finding.** A failed or truncated read can only hide holdings, so a low coverage number measured under one says nothing - and neither does a ratio of 100% measured over the first page of them.
- **A count of positions is not evidence about one of them.** A spread of positions describes the account; that the position in front of the reader is a market maker's inventory is a claim about quoting, and needs quoting large enough to matter against it.
- **An asset that could not be identified is not an absent one.** Holdings named like the position but on a chain or in a token this tool cannot verify are reported as dollars of unknown identity, and enough of them withhold the answer.
- **A rule that asserts an absence needs the source that absence is about.** A HIP-3 dex answering 503 is not an account that quotes nothing.

Spot counts as a hedge only against a short: holding the asset while also long the perp is more of the same bet. An on-chain balance is identified by its contract, not its ticker, because a ticker is a label anyone can reuse, and a Hyperliquid spot balance by its token index, because its names are not unique either ([`src/engine/assets.ts`](src/engine/assets.ts)). Which of the two a holding is comes from the endpoint that produced it, never from whether an address happens to be present. Lending-market deposits still count, with a note on the card that a loan against them would not show - and a leg mostly made of them is called visible coverage, not a net position.

Thresholds are ordinary numbers chosen against observed data, not a measured accuracy. See **Calibration** below for what that does and does not mean.
## What the Nansen data decides

| Nansen endpoint | What it drives |
|---|---|
| `profiler/perp-positions` | Every rule. Covers all Hyperliquid perp dexes, HIP-3 included: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint |
| `profiler/address/current-balance` (chain `all`) | The account's own hedge on any chain, for a headline short. Each row's contract decides what the asset is, and its completeness decides whether "no hedge found" may be said at all |
| `profiler/address/related-wallets` (Arbitrum, Ethereum) | The First Funder wallets, then their `current-balance`. This is reported as its own observation, never folded into the account's coverage: it can stop a verdict, not make one |
| `profiler/perp-pnl-summary` | 30-day realized PnL on the card. Context, not a rule: no verdict turns on it |

Hyperliquid's free API supplies resting orders (per dex, including HIP-3 markets the account has positions on), 24-hour fills and open interest.

## Every credit has to be able to change the answer

A check reads in stages ([`src/api/check.ts`](src/api/check.ts)):

1. Free Hyperliquid reads first. If Hyperliquid is down, the check fails before a single credit is spent.
2. Nansen positions and PnL: 2 calls, always.
3. The account's balances on every chain: 1 call, only when the headline is a short, no book signal fired and the legs do not already cancel within their own assets. Otherwise no hedge could move the verdict.
4. Funding links (2 calls) and up to two funders' balances: only when the account's own holdings explain less than half of the short.

So a book or a long bet costs 2 calls, a short hedged inside the account 3, and the full funder search 7.

**The cap is held, not counted afterwards.** A check reserves the most it could spend before it starts and settles with what it actually spent; whatever it did not use goes back. That arithmetic lives in a Durable Object, because Workers KV is eventually consistent and a read-modify-write through it is not a transaction: two overlapping checks used to read the same total, both pass, and the second write erased the first. Rate limiting (20 checks a minute per client, plus a global burst limit across every client at once) lives in a Durable Object too, counting in memory, so an abuse guard cannot exhaust KV's write quota. A timed-out call is charged as spent, because Nansen may well have served it, and a 401/402/403 that reports no credits left stops that check immediately.

Two things that are money and look like clock problems:

- **A reservation nobody settles is charged, not refunded.** A request that dies after Nansen has served it reports nothing, and an unknown outcome is not a zero one. The hold is charged at its worst case and marked uncertain; a settle arriving later corrects it to what it really cost, once, however many times it is redelivered.
- **Midnight resets the daily cap and nothing else.** The account balance is the account's, not the day's; a reservation belongs to the day it was taken on and settles against that day. When the breaker trips on an empty balance, one check an hour is let through to find out whether credits have arrived, because otherwise nothing would ever ask.

A Durable Object runs one JavaScript thread, which is not the same as one request at a time: the thread yields at every await and two requests interleave around I/O. What makes storage safe is the runtime's gates, so the code is written for the weaker guarantee - concurrent callers wait on one load rather than each building their own state.

KV keeps what it is good at: cached results and saved readings. The per-day call counts moved into the budget object with the money, because a read-modify-write on one shared key loses counts whenever two checks finish together, and those counts are what this submission rests on.

## The gallery: one dated scan, not the market

On 18 September 2026 the same check ran over a set of large Hyperliquid positions: accounts from the top 3,000 by value on Hyperliquid's public leaderboard, ranked by their largest main-dex position (864 had one open), checked from the top until the credits ran out. That is 278 accounts; one had closed its position by the time it was checked, which leaves 277. Thirty-one cards have since been re-read live - nine on 21 September when the rules first changed, twenty-two after the 21 September audit - so the set spans several dates and each card carries its own.

Each card is re-judged offline against the current rules from the numbers already stored in it, without spending a credit ([`scripts/reexplain.ts`](scripts/reexplain.ts)) - **but only where the stored observation carries what those rules read.** Re-running a classifier over an old aggregate is cheap and useful; it is not a re-check of the account, and the 21 September audit found the two being presented as one. An observation now carries its own schema version, and an entry the current rules cannot read keeps the verdict it was given, keeps the version of the rules that gave it, and is shown as history.

| Verdict | Positions | Share of the 183 judged |
|---|---|---|
| Looks like a bet | 107 | 58% |
| Unknown | 66 | 36% |
| Book | 3 | 2% |
| Hedged | 7 | 4% |
| *Read by earlier rules* | *94* | *not judged by v3* |

Every card that had read Book or Hedged under the older rules was **re-read live on 21 September**, because that is the only way to move one: 22 accounts, 83 Nansen calls. The verdicts that came back are not the ones that went in.

- **Three books survive, and they are unmistakable.** The largest quotes both sides of 120 markets with $226M resting against an $81M headline position. Six of the old twelve had a wide spread of positions and nothing quoted behind them at all, which is now reported as what it is rather than as a book.
- **Seven hedges hold, all HYPE shorts between 97% and 100% covered** - and the card now says the coverage came from **Hyperliquid's own spot balances, not from Nansen**. Every one of those seven had been signed "Nansen" before, because Nansen had been asked; it had not supplied a dollar of the number.
- **The two largest positions in the set both read Unknown.** The $289.6M ETH short, and the Abraxas-linked $216.7M ETH short that the first version of this tool called a probable hedge: the matching ETH is in wallets that funded the account, and part of it is an Aave deposit with an invisible loan against it.

The Unknowns are not a shrug. Each says which question it could not close: the dollars net out across different assets, the flow is busy but says nothing about this position, the matching assets are in a wallet that funded the account, the holdings could not be read in full, or the signals simply disagree.

The 94 remaining cards from the original scan are history, not present findings: their observations recorded neither the order notional a book now needs nor what the hedge sum left out, so the current rules cannot read them. None of them claims a Book or a Hedged verdict.

**What this table is not.** It is one scan of a set chosen a particular way. Leverage breaks the link between what an account is worth and what it holds, a HIP-3-only account can fall out of the ranking before it is ever checked, and the scan spent its last credits on the cheaper checks. Read it as "of the 277 read", never as "of the market".

Two cards in the set have positions from Hyperliquid's main dex rather than Nansen, because Nansen answered 502 while they were being read; their cards say so. The scan data is in [`data/gallery.json`](data/gallery.json), the candidate ranking in [`data/prescan-candidates.json`](data/prescan-candidates.json).

## Calibration, and what it is not

Three accounts with publicly known answers were used to check that each rule fires and stays silent where it should: [`docs/wiki/calibration.md`](docs/wiki/calibration.md), which is kept as a record of that run and is **superseded** - it still reads one of the three as a delta-neutral carry trade, which later reading did not support. Those were smoke tests. They are **not** a measurement of how often the verdicts are right, and nothing here should be read as one:

- the example chosen as a bet was picked for its shape, not from confirmed knowledge of every leg it holds;
- one case rests on an inferred link rather than an established one;
- the thresholds were adjusted after looking at the same sample they are judged on.

What would make it a measurement is an independently labelled set of 30-60 varied cases (directional, mixed, same-asset partial and full, multi-strategy, a service funder, no label, an API failure, HIP-3, empty), scored for false hedges and false books and for how often the tool abstains. That does not exist yet, and until it does there is no confidence percentage anywhere in this product, because there is nothing to base one on.

## Honest limits

- A hedge on a centralized exchange, in OTC or in a wallet with no on-chain link is invisible. The card says so every time.
- Ownership through a funding link is not established by the link. A funder's holdings are reported as theirs and never counted as this account's hedge.
- Debts are invisible. A lending deposit counts toward a hedge because the balance is real, but nothing here can see what was borrowed against it, so a leveraged position can still look flat.
- Only the headline position's hedge is searched. A pair trade (long A against short B) is not modeled; net versus gross exposure and the same-asset offset share catch part of it.
- An on-chain token whose contract is not one this tool recognises is left out of the hedge rather than counted by its ticker. The registry is short, so a real holding can be missed; the card says how much was left out.
- Hyperliquid returns at most 2,000 fills per call; a busier account shows "2,000+", a lower bound. The card also says how many hours the fills actually span, which can be far less than the window asked for.
- Nansen address labels are never shown or stored. They are read in one place only, to decide whether a funding link leads to an exchange or bridge, and dropped there ([`src/sources/normalize.ts`](src/sources/normalize.ts)). In practice Nansen sends no label for most addresses, which the card reports as unverified rather than treating as "a private wallet". Test fixtures are saved with every label field set to null.
- The contract registry covers Ethereum and Arbitrum, while the balance read asks for every chain. A matching holding on a chain outside it is reported as dollars of unknown identity, not as an absence, and enough of them withhold the verdict instead of producing a confident one.
- Thresholds - 85-115%, 5 and 20 positions, 10% of the headline in quotes - are ordinary numbers chosen against observed data. None has been validated against an independently labelled sample, and none of them is a confidence level.
- Nothing here is advice. The tool describes a position and names what it could not read; whether to copy anything is the reader's call.

## Run it locally (about 10 minutes)

Needs Node.js 22.12 or newer (Wrangler 4 and Vitest 5 require it).

```bash
git clone https://github.com/Sofiia7/bet-or-book.git
cd bet-or-book
npm install
npm test
```

Optional, for live Nansen reads: copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and put your key in it. Without one every check runs Hyperliquid-only and says so on the card.

```bash
npm run dev
```

Then open http://localhost:8787.

## Deploy to Cloudflare Workers

```bash
npx wrangler kv namespace create KV
```

Put the printed id into `wrangler.toml` under `[[kv_namespaces]]`, then:

```bash
npx wrangler secret put NANSEN_API_KEY
npx wrangler deploy
```

`NANSEN_DAILY_CREDIT_CAP` and `NANSEN_CREDIT_FLOOR` in `wrangler.toml` bound the spend.

## The API

| Route | What it does |
|---|---|
| `POST /api/check?address=0x...` | Runs a check. Optional `&coin=ETH&side=short` asks about one position rather than the largest. This is the only route that spends anything, and it is a POST from this site for that reason |
| `GET /api/check?address=0x...` | An answer that already exists, or 404. Spends nothing, so a crawler or a prefetch cannot |
| `GET /api/snapshot?id=...` | One saved reading, exactly as it was read |
| `GET /api/compare?a=...&b=...` | Two readings of one address, side by side: what moved, and whether the answer moved with the data or with the rules. Reads stored readings only |
| `GET /api/gallery` | The dated scan |
| `GET /api/ledger` | Nansen calls made, attempted against answered, credits quoted against credits assumed |

## Scripts

| Script | What it does |
|---|---|
| `scripts/prescan.ts` | Builds the gallery with the Worker's own `checkAddress`; stops at a credit reserve; resumable |
| `scripts/ledger.ts` | Sums `data/nansen-calls.jsonl` into `data/ledger.json`, served at `/api/ledger` |
| `scripts/reexplain.ts` | Re-judges and re-explains the gallery cards whose stored observation carries what the current rules read, and marks the rest as history. No network: a rules fix never needs the credits the scan cost |
| `scripts/fetch-fixtures.ts`, `scripts/fetch-nansen-fixtures.ts` | Capture real API responses for the tests (labels redacted) |
| `docs/audits/2026-09-21-verify.ts` | Re-runs the nineteen observations of the 21 September audit against the fixes, offline. `node --import tsx docs/audits/2026-09-21-verify.ts` |

## Nansen API usage

Every scripted call is logged in [`data/nansen-calls.jsonl`](data/nansen-calls.jsonl) and summed in [`data/ledger.json`](data/ledger.json); the deployed page adds its own calls from the budget Durable Object and serves the total at `/api/ledger`. Requests attempted, requests answered, credits the API itself priced and credits assumed for a call it did not price are four separate numbers, because a total that mixes a quoted figure with an assumed one is not a measurement.

Between 14 and 27 September: **1,117 calls, 1,109 of them answered 2xx.** The gallery scan of 18 September accounts for most of it; 26 more went to re-checking nine cards on 21 September after the rules first changed, and 83 to re-reading the 22 cards that had claimed Book or Hedged, once the audit of 21 September showed their stored observations could not support those claims.

Seven of those calls did not return data, and each one taught something:

- One 403, on the very first call made with a freshly issued key, while the same response reported 1,100 credits available. Later calls to that endpoint succeeded; **why the first one did not is not established** - a key still propagating and a transient permission look the same from here, and an earlier version of this file asserted the first. What the episode settled is narrower and does not depend on the cause: the breaker could not tell a refusal about an endpoint from an empty account, and it can now, because a refusal counts as exhaustion only when it reports no credits left.
- Two that never answered at all, a local network drop. They are recorded with status 0, attempted and outcome unknown, and charged as spent, because Nansen may have served them. Silence is the one thing that must not be recorded as nothing having happened.
- Three 502s and one 500 during the original scan. The 502s cost three cards their Nansen positions, and those cards say they read Hyperliquid's main dex instead; one of the three has since been re-checked, which leaves two. The 500 cost one card its realized PnL.

The live count restarts from the deploy that moved it out of KV (21 September). The Worker's own calls before that - about a dozen, from `wrangler dev` and the smoke tests - are in the scripted ledger already and are not double-counted here; nothing is lost, but the two halves of the total come from different places and the boundary is a deploy, not a date.

The ledger counts calls made. It is a record, not the spend cap: what a check is allowed to spend is decided before it runs (see above), and an answered call's own cost header is what settles it. The local count is this Worker's own arithmetic and is not an independent confirmation; the figure Nansen's account side reports is the one that counts.

| Endpoint | Calls |
|---|---|
| `profiler/perp-positions` | 341 |
| `profiler/perp-pnl-summary` | 341 |
| `profiler/address/current-balance` | 255 |
| `profiler/address/related-wallets` | 179 |
| `profiler/perp-trades` | 1 |

| Purpose | Calls |
|---|---|
| Gallery scan (`scripts/prescan.ts`), including a first run of 66 calls discarded after the book-rule fix | 964 |
| Local development checks through `wrangler dev` | 21 |
| Fixture captures for the tests | 12 |
| Live smoke test of the three calibration accounts | 11 |
| Re-checking nine gallery cards after the rules changed (21 September) | 26 |
| Re-reading the 22 cards that had claimed Book or Hedged, after the 21 September audit | 83 |

`profiler/perp-trades` was tried once and dropped: it aggregates partial fills into one trade, and a thousand records covered sixteen minutes of the busiest account.

## Security

Checked against a twelve-point launch checklist ([`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md), section 9): no logins, sessions, uploads, webhooks or SQL; the only user input is an address matched by `0x` plus 40 hex characters; the Worker calls two fixed hosts; the key lives in a Worker secret and `.dev.vars` (git-ignored, absent from the whole history); errors reach the client as a generic message; `npm audit` reports 0 vulnerabilities.

Two things the 21 September audit changed here. **Starting a check is a POST from this site**, because GET and HEAD ran the paid branch and a link preview, a browser prefetch or a scanner could spend credits by looking; GET and HEAD now return an answer that already exists, or 404, and spend nothing. And the page's script moved into a file of its own, so its Content-Security-Policy forbids inline script outright rather than allowing it - along with `frame-ancestors 'none'`, no cross-origin requests and no plugin content. A reserve of the daily cap is kept out of the public path so an afternoon of visitors cannot leave the demo with a Hyperliquid-only answer.

## Stack

Cloudflare Workers, Workers KV and two Durable Objects (the spend cap with its call ledger, and the rate limiter - both need an atomic read-modify-write that KV cannot promise), TypeScript, Vitest (305 tests on recorded real responses, including the Worker's own routes driven through real Requests). No runtime dependencies, no frontend framework: one HTML page, one script file and a canvas for the share card.
