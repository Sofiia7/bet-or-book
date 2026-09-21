# Bet or Book

**Paste a Hyperliquid address. Find out whether that whale position is a bet you could follow, a hedge, or a market maker's book.**

**Live: [bet-or-book.sofiaseremeteva.workers.dev](https://bet-or-book.sofiaseremeteva.workers.dev)**

Built for the [Nansen Meridian Buildathon](https://www.nansen.ai/campaigns/meridian-buildathon) (14-27 September 2026). Powered by Nansen API.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not what the headline makes of it:

- The account behind one of those posts is a **market-making book**: 134 open positions, 1,403 resting orders quoting both sides of 76 markets, 2,000+ fills a day. That is a business, not a view on price.
- Another was reported as hundreds of millions in bearish shorts, and the first version of this tool agreed it was hedged. It is not that simple: **under 1% of its $184M ETH short is covered inside the account**, and the $405M of matching ETH sits in two wallets that funded it. A funding transfer is not ownership, one such funder turned out to be an exchange, and $117.5M of that ETH is an Aave deposit with an invisible loan against it.
- And sometimes it really is a bet: **one $125.9M HYPE long, the account's entire exposure, nothing offsetting it**.

Bet or Book answers one question per address, shows the numbers that decided it, and says what it could not read.

## What a check returns

- **A verdict**: Book, Hedged, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` for a book).
- **One sentence built from the numbers**, e.g. *"The $41.1M BTC short is 48% covered by spot BTC held by the same account across chains, which leaves $21.6M of it short."*
- **Up to five evidence numbers**, each tagged with the source that produced it (Nansen or Hyperliquid).
- **The funding wallets**, with explorer links, when they hold the matching asset. They hold it; that is not the same as this account holding it, and the card says so.
- **What could not be read**, every time: which sources were missing or cut short, how old the numbers are, and which rules read them.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **A share card** (PNG, carrying those limits) and a link that reopens *this* reading rather than starting a new one.

## How the verdict is decided

Rules run in order; the first one that fires wins ([`src/engine/verdict.ts`](src/engine/verdict.ts)). The set is versioned: `CLASSIFIER_VERSION` travels with every answer, because a verdict means nothing without the rules that produced it.

| # | Verdict | Rule |
|---|---|---|
| 0 | Unknown | no open positions |
| 1 | Book | 20+ positions netting to 35% or less of gross exposure, or 50+ resting orders with 25-75% bids quoting both sides of 5+ markets. Fills corroborate (200+ in 24 h, 40% or less taker, 25-75% buys) but never decide alone. One signal is `likely`, two or more `strong` |
| 2 | Hedged | spot of the same asset in the account covers 85-115% of a headline short, or 2-19 positions netting to 35% or less of gross **with 80%+ of that gross cancelling inside individual assets** |
| 3 | Unknown, `over_covered` | the spot leg is larger than the short: the account is long the asset it is short |
| 4 | Unknown, `hedge_not_checked` | the holdings could not be read in full, so their absence proves nothing |
| 5 | Unknown, `partial_offset` | 10-85% covered: what is left over is still a position, and the card says how much |
| 6 | Looks like a bet | 5 or fewer positions, net 80%+ of gross, the largest 50%+ of exposure, under 10% covered, no two-sided quotes |
| 7 | Unknown | `mixed_long_short_book` (the dollars net out across different assets), `maker_flow_only` (busy, but nothing says this position is inventory), `linked_exposure_unverified` (the matching assets are in a wallet that funded this account), or the signals simply disagree |

Four things the rules refuse to do, each one an audit finding:

- **A funding wallet's holdings are never this account's hedge.** A transfer shows where money came from, not who holds it now, and an exchange is a common funder. Such holdings can withhold a verdict, never grant one.
- **A dollar balance is not an offset.** $1M BTC long against $1M TRUMP short nets to zero and leaves both bets running.
- **A hedge is a band, not a floor.** 52% and 195% coverage are different situations and get different answers.
- **A gap in the reading is not a finding.** A failed or truncated read can only hide holdings, so a low coverage number measured under one says nothing.

Spot counts as a hedge only against a short: holding the asset while also long the perp is more of the same bet. An on-chain balance is identified by its contract, not its ticker, because a ticker is a label anyone can reuse; anything named right with an unrecognised contract is left out and the card says how much ([`src/engine/assets.ts`](src/engine/assets.ts)). Lending-market deposits still count, with a note that a loan against them would not show.

Thresholds are ordinary numbers chosen against observed data, not a measured accuracy. See **Calibration** below for what that does and does not mean.
## What the Nansen data decides

| Nansen endpoint | What it drives |
|---|---|
| `profiler/perp-positions` | Every rule. Covers all Hyperliquid perp dexes, HIP-3 included: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint |
| `profiler/address/current-balance` (chain `all`) | The account's own hedge on any chain, for a headline short. Each row's contract decides what the asset is, and its completeness decides whether "no hedge found" may be said at all |
| `profiler/address/related-wallets` (Arbitrum, Ethereum) | The First Funder wallets, then their `current-balance`. This is reported as its own observation, never folded into the account's coverage: it can stop a verdict, not make one |
| `profiler/perp-pnl-summary` | 30-day realized PnL on the card |

Hyperliquid's free API supplies resting orders (per dex, including HIP-3 markets the account has positions on), 24-hour fills and open interest.

## Every credit has to be able to change the answer

A check reads in stages ([`src/api/check.ts`](src/api/check.ts)):

1. Free Hyperliquid reads first. If Hyperliquid is down, the check fails before a single credit is spent.
2. Nansen positions and PnL: 2 calls, always.
3. The account's balances on every chain: 1 call, only when the headline is a short, no book signal fired and the legs do not already cancel within their own assets. Otherwise no hedge could move the verdict.
4. Funding links (2 calls) and up to two funders' balances: only when the account's own holdings explain less than half of the short.

So a book or a long bet costs 2 calls, a short hedged inside the account 3, and the full funder search 7.

**The cap is held, not counted afterwards.** A check reserves the most it could spend before it starts and settles with what it actually spent; whatever it did not use goes back. That arithmetic lives in a Durable Object, which handles one request at a time, because Workers KV is eventually consistent and a read-modify-write through it is not a transaction: two overlapping checks used to read the same total, both pass, and the second write erased the first. Rate limiting (20 checks a minute per client) lives in a Durable Object too, counting in memory, so an abuse guard cannot exhaust KV's write quota. A timed-out call is charged as spent, because Nansen may well have served it, and any 401/402/403 stops that check immediately.

KV keeps what it is good at: cached results, saved readings, and the per-day call counts the ledger reports. Those are a record of what happened, not the thing that decides.

## The gallery: one dated scan, not the market

On 18 September 2026 the same check ran over a set of large Hyperliquid positions: accounts from the top 3,000 by value on Hyperliquid's public leaderboard, ranked by their largest main-dex position (864 had one open), checked from the top until the credits ran out. That is 278 accounts, led by a $263.8M ETH short; one had closed its position by the time it was checked, which leaves 277. Nine cards were re-checked on 21 September, so the set spans two dates and the page says so.

Every card was re-judged offline against the current rules, from the numbers already stored in it, without spending a credit ([`scripts/reexplain.ts`](scripts/reexplain.ts)).

| Verdict | Positions | Share |
|---|---|---|
| Looks like a bet | 137 | 49% |
| Unknown | 121 | 44% |
| Book | 12 | 4% |
| Hedged | 7 | 3% |

The Unknowns are not a shrug. Each says which question it could not close: 12 have their matching assets in a wallet that funded the account, 12 are busy accounts whose flow says nothing about the position in front of you, 8 are partly covered and say by how much, 6 net out in dollars across different assets, 5 are over-covered into a net long, 2 could not read the hedge at all, and 76 simply do not fit any rule.

The ten cards that once read "balanced book, therefore hedged" were the reason for re-checking. All eight that could be re-read came back with **nothing cancelling inside a single asset**: their dollars net out across different tokens entirely, which is a portfolio, not a hedge of anything.

What stands out:

- **About half of these positions look like real bets**, mostly longs (110 of 137).
- **Seven shorts are genuinely hedged inside the account**, between 93% and 100% covered. Five more are covered past 122%, which means those accounts are long the asset their headline position is short.
- The largest of all, a $263.8M ETH short, stays **Unknown**. So does the $184M ETH short that the first version of this tool called a probable hedge: the $405M of matching ETH is in wallets that funded the account, and $117.5M of that is an Aave deposit.
- A check cost **3.2 Nansen calls on average**; 190 of the 277 needed only 2.

**What this table is not.** It is one scan of a set chosen a particular way. Leverage breaks the link between what an account is worth and what it holds, a HIP-3-only account can fall out of the ranking before it is ever checked, and the scan spent its last credits on the cheaper checks. Read it as "of the 277 read", never as "of the market".

Two cards in the set have positions from Hyperliquid's main dex rather than Nansen, because Nansen answered 502 while they were being read; their cards say so. The scan data is in [`data/gallery.json`](data/gallery.json), the candidate ranking in [`data/prescan-candidates.json`](data/prescan-candidates.json).

## Calibration, and what it is not

Three accounts with publicly known answers were used to check that each rule fires and stays silent where it should: [`docs/wiki/calibration.md`](docs/wiki/calibration.md). Those are smoke tests. They are **not** a measurement of how often the verdicts are right, and nothing here should be read as one:

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
- Nothing here is advice. The tool describes a position and names what it could not read; whether to copy anything is the reader's call.

## Run it locally (about 10 minutes)

Needs Node.js 22.12 or newer (Wrangler 4 and Vitest 5 require it).

```bash
git clone <this repository>
cd bet_or_book
npm install
npm test
```

Optional, for live Nansen reads: create `.dev.vars` in the project folder with one line, `NANSEN_API_KEY=<your key>`. Without it every check runs Hyperliquid-only and says so on the card.

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

## Scripts

| Script | What it does |
|---|---|
| `scripts/prescan.ts` | Builds the gallery with the Worker's own `checkAddress`; stops at a credit reserve; resumable |
| `scripts/ledger.ts` | Sums `data/nansen-calls.jsonl` into `data/ledger.json`, served at `/api/ledger` |
| `scripts/reexplain.ts` | Re-judges and re-explains every gallery card from the numbers already stored in it, with the current rules. No network: a rules fix never needs the credits the scan cost |
| `scripts/fetch-fixtures.ts`, `scripts/fetch-nansen-fixtures.ts` | Capture real API responses for the tests (labels redacted) |

## Nansen API usage

Every call is logged in [`data/nansen-calls.jsonl`](data/nansen-calls.jsonl) and summed in [`data/ledger.json`](data/ledger.json); the deployed page adds its own calls from Workers KV and serves the total at `/api/ledger`.

Between 14 and 27 September: **1,034 calls, 1,027 of them answered 2xx.** The gallery scan of 18 September accounts for almost all of it; 26 more went to re-checking nine cards on 21 September, after the rules changed.

Seven of those calls did not return data, and each one taught something:

- One 403, on the very first call made with a freshly issued key, while the same response reported 1,100 credits available. Every later call to that endpoint succeeded, so it was the key warming up, not a permission. The scan stopped anyway, because the breaker could not tell a refusal about an endpoint from an empty account. It can now: a refusal counts as exhaustion only when it reports no credits left.
- Two that never answered at all, a local network drop. They are recorded with status 0, attempted and outcome unknown, and charged as spent, because Nansen may have served them. Silence is the one thing that must not be recorded as nothing having happened.
- Three 502s and one 500 during the original scan. The 502s cost three cards their Nansen positions, and those cards say they read Hyperliquid's main dex instead; one of the three has since been re-checked, which leaves two. The 500 cost one card its realized PnL.

The ledger counts calls made. It is a record, not the spend cap: what a check is allowed to spend is decided before it runs (see above), and an answered call's own cost header is what settles it.

| Endpoint | Calls |
|---|---|
| `profiler/perp-positions` | 319 |
| `profiler/perp-pnl-summary` | 319 |
| `profiler/address/current-balance` | 230 |
| `profiler/address/related-wallets` | 165 |
| `profiler/perp-trades` | 1 |

| Purpose | Calls |
|---|---|
| Gallery scan (`scripts/prescan.ts`), including a first run of 66 calls discarded after the book-rule fix | 964 |
| Local development checks through `wrangler dev` | 21 |
| Fixture captures for the tests | 12 |
| Live smoke test of the three calibration accounts | 11 |
| Re-checking nine gallery cards after the rules changed (21 September) | 26 |

`profiler/perp-trades` was tried once and dropped: it aggregates partial fills into one trade, and a thousand records covered sixteen minutes of the busiest account.

## Security

Checked against a twelve-point launch checklist ([`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md), section 9): no logins, sessions, uploads, webhooks or SQL; the only user input is an address matched by `0x` plus 40 hex characters; the Worker calls two fixed hosts; the key lives in a Worker secret and `.dev.vars` (git-ignored, absent from the whole history); errors reach the client as a generic message; the page sets a Content-Security-Policy with `frame-ancestors 'none'`; `npm audit` reports 0 vulnerabilities.

## Stack

Cloudflare Workers, Workers KV and two Durable Objects (the spend cap and the rate limiter, which both need an atomic read-modify-write that KV cannot promise), TypeScript, Vitest (197 tests on recorded real responses). No runtime dependencies, no frontend framework: one HTML page with a canvas for the share card.
