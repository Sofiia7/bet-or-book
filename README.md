# Bet or Book

**Paste a Hyperliquid address. Find out whether that whale position is a bet you could follow, a hedge, or a market maker's book.**

**Live: [bet-or-book.sofiaseremeteva.workers.dev](https://bet-or-book.sofiaseremeteva.workers.dev)**

Built for the [Nansen Meridian Buildathon](https://www.nansen.ai/campaigns/meridian-buildathon) (14-27 September 2026). Powered by Nansen API.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not a view at all:

- The account behind one of those posts is a **market-making book**: 134 open positions, 1,403 resting orders quoting both sides of 76 markets, 2,000+ fills a day. There is nothing to copy.
- Another was reported as hundreds of millions in bearish shorts. Its **$182.9M ETH short is covered 219% by staked and wrapped ETH** held in the two wallets that funded the account: a carry trade, neutral on price.
- And sometimes it really is a bet: **one $20.9M ZEC long, 80% of the account's exposure, nothing offsetting it**.

Bet or Book answers one question per address and shows the numbers that decided it.

## What a check returns

- **A verdict**: Book, Hedged, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` for a book, `probable` for a hedge found in linked wallets).
- **One sentence built from the numbers**, e.g. *"The $182.9M ETH short is 219% covered by ETH held in 2 wallets that funded this account. Ownership is inferred from the funding link, not confirmed."*
- **Up to five evidence numbers**, each tagged with the source that produced it (Nansen or Hyperliquid).
- **The funding wallets**, with explorer links, when the hedge was found there.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **A share card** (PNG) and a link that reopens the same check.

## How the verdict is decided

Rules run in order; the first one that fires wins ([`src/engine/verdict.ts`](src/engine/verdict.ts)).

| # | Verdict | Rule |
|---|---|---|
| 0 | Unknown | no open positions |
| 1 | Book | any of: (a) 20+ positions netting to 35% or less of gross exposure; (b) 50+ resting orders, 25-75% of them bids, both sides quoted in 5+ markets; (c) 200+ fills in 24 hours, 40% or less of them taker. One signal is `likely`, two or more `strong` |
| 2 | Hedged | spot of the same asset in the account covers 50%+ of a headline short; or 2-19 positions netting to 35% or less of gross |
| 2b | Hedged (probable) | the account plus the wallets that funded it cover 50%+ of the headline short |
| 3 | Looks like a bet | 5 or fewer positions, net 80%+ of gross, the largest 50%+ of exposure, under 10% covered, no two-sided quotes |
| 4 | Unknown | the signals disagree; the card names which bet conditions failed |

Spot counts as a hedge only against a short: holding the asset while also long the perp is more of the same bet. Wrapped and staked forms count (`WETH`, `stETH`, `weETH`, `rsETH`, Aave `aETH` tokens, `UBTC`, `WBTC`... see [`src/engine/assets.ts`](src/engine/assets.ts)); similar tickers do not (`ETHFI` is not ETH).

The thresholds were calibrated on three accounts with publicly known answers, and each one was checked to fire and to stay silent on live data: [`docs/wiki/calibration.md`](docs/wiki/calibration.md).

## What the Nansen data decides

| Nansen endpoint | What it drives |
|---|---|
| `profiler/perp-positions` | Every rule. Covers all Hyperliquid perp dexes, HIP-3 included: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint |
| `profiler/address/current-balance` (chain `all`) | The account's own hedge on any chain, for a headline short |
| `profiler/address/related-wallets` (Arbitrum, Ethereum) | The First Funder wallets, then their `current-balance`: the `probable` hedge |
| `profiler/perp-pnl-summary` | 30-day realized PnL on the card |

Hyperliquid's free API supplies resting orders, 24-hour fills and open interest.

## Every credit has to be able to change the answer

A check reads in stages ([`src/api/check.ts`](src/api/check.ts)):

1. Free Hyperliquid reads first. If Hyperliquid is down, the check fails before a single credit is spent.
2. Nansen positions and PnL: 2 calls, always.
3. The account's balances on every chain: 1 call, only when the headline is a short, no book signal fired and the book is not already balanced. Otherwise no hedge could move the verdict.
4. Funding links (2 calls) and up to two funders' balances: only when the account's own holdings leave the answer open.

So a book or a long bet costs 2 calls, a short hedged inside the account 3, and the full funder search 7.

Around it: a 10-minute cache per address, 20 checks a minute per IP, a daily credit cap, and a stop for the day after any 401/402/403 from Nansen. If Workers KV fails anywhere in a request (the free tier allows 1,000 writes a day), that check runs Hyperliquid-only instead of trusting a cap it cannot read.

## The gallery: biggest positions right now

On 18 September 2026 the same check ran over the largest open positions on Hyperliquid: accounts from the top 3,000 by value on Hyperliquid's public leaderboard, ranked by their largest position (864 had one open), checked from the top until the credits ran out. That is 278 accounts, led by a $263.8M ETH short; one had closed its position by the time it was checked, which leaves 277.

| Verdict | Positions | Share |
|---|---|---|
| Looks like a bet | 135 | 49% |
| Unknown | 80 | 29% |
| Hedged | 38 | 14% |
| ... of which `probable`: the hedge sits in the wallets that funded the account | 13 | |
| Book | 24 | 9% |

What stands out:

- **About half of the biggest positions look like real bets**, mostly longs (109 of 135), 36 of them without a single trade closed in 30 days.
- **13 shorts are probably hedged by the wallets that funded them, 10 of them in ETH**: the same staked-ETH carry trade as in the example above, invisible from the account alone and found only through Nansen's related-wallets and cross-chain balances.
- Of the ten largest positions, seven look like bets. The largest of all, a $263.8M ETH short, stays **Unknown**: 15 shorts, and the wallets that funded the account hold ETH worth only 3.7% of it.
- A check cost **3.2 Nansen calls on average**; 192 of the 278 needed only 2.

Three of the 278 were read while Nansen answered 502, so their positions came from Hyperliquid's main dex; their cards say so. The scan data is in [`data/gallery.json`](data/gallery.json), the candidate ranking in [`data/prescan-candidates.json`](data/prescan-candidates.json).

Calibration notes, including the fix this scan forced on book rule (c) - maker fills in one direction are a position being built, not market making - are in [`docs/wiki/calibration.md`](docs/wiki/calibration.md).

## Honest limits

- A hedge on a centralized exchange, in OTC or in a wallet with no on-chain link is invisible. The card says so every time.
- Ownership through a funding link is inferred, not proven. That is why such a hedge is `probable`, never plain `hedged`.
- Only the headline position's hedge is searched. A pair trade (long A against short B) is not modeled; net versus gross exposure catches part of it.
- Hyperliquid returns at most 2,000 fills per call; a busier account shows "2,000+", a lower bound.
- Nansen address labels are never shown or stored. They are read in one place only, to avoid following a funding link into an exchange or bridge, and dropped there ([`src/sources/normalize.ts`](src/sources/normalize.ts)). Test fixtures are saved with every label field set to null.

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
| `scripts/fetch-fixtures.ts`, `scripts/fetch-nansen-fixtures.ts` | Capture real API responses for the tests (labels redacted) |

## Nansen API usage

Every call is logged in [`data/nansen-calls.jsonl`](data/nansen-calls.jsonl) and summed in [`data/ledger.json`](data/ledger.json); the deployed page adds its own calls from Workers KV and serves the total at `/api/ledger`.

Between 14 and 27 September: **1,008 calls, 1,004 of them answered 2xx.** Nansen's own balance agrees: the three calls that got a 502 were not charged, and 1,005 credits were spent.

| Endpoint | Calls |
|---|---|
| `profiler/perp-positions` | 308 |
| `profiler/perp-pnl-summary` | 308 |
| `profiler/address/current-balance` | 228 |
| `profiler/address/related-wallets` | 163 |
| `profiler/perp-trades` | 1 |

| Purpose | Calls |
|---|---|
| Gallery scan (`scripts/prescan.ts`), including a first run of 66 calls discarded after the book-rule fix | 964 |
| Local development checks through `wrangler dev` | 21 |
| Fixture captures for the tests | 12 |
| Live smoke test of the three calibration accounts | 11 |

`profiler/perp-trades` was tried once and dropped: it aggregates partial fills into one trade, and a thousand records covered sixteen minutes of the busiest account.

## Security

Checked against a twelve-point launch checklist ([`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md), section 9): no logins, sessions, uploads, webhooks or SQL; the only user input is an address matched by `0x` plus 40 hex characters; the Worker calls two fixed hosts; the key lives in a Worker secret and `.dev.vars` (git-ignored, absent from the whole history); errors reach the client as a generic message; the page sets a Content-Security-Policy with `frame-ancestors 'none'`; `npm audit` reports 0 vulnerabilities.

## Stack

Cloudflare Workers and Workers KV, TypeScript, Vitest (108 tests on recorded real responses). No runtime dependencies, no frontend framework: one HTML page with a canvas for the share card.
