# Bet or Book

**Paste a Hyperliquid address. See what actually stands behind that whale position - a bet, a hedge, or a market maker's book.**

**Live: [bet-or-book.trade](https://bet-or-book.trade)**

Hyperliquid position intelligence: reads HyperCore positions on every perp dex, spot balances, orders, fills and the 30-day perp PnL from Hyperliquid's public API, balances on Ethereum, Arbitrum and HyperEVM from public JSON-RPC nodes, and the wallets that first funded an account from the Blockscout block explorer. Built on Cloudflare Workers, Durable Objects and KV.

Development began on 17 September 2026 on the Nansen API, and the project was submitted to the Nansen Meridian Buildathon (14-27 September), where it was not a winner or honourable mention and was listed among Nansen's Examples of API Builds; the current code no longer calls Nansen, and the readings made with it stay as dated facts, with their Nansen credit, together with the historical audits.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not what the headline makes of it:

- On 26 September the account behind one of those posts read as a **market-making book**: 134 open positions, 2,730 resting orders quoting both sides of 123 markets - including its own $52.0M ETH short, $41.6M of that quoting genuinely matched in ETH itself, not just activity somewhere else in the account. That is a business, not a view on price (read on 26 September, after the fix in [L01](docs/audits/2026-09-23-full-audit.md) made "quoted elsewhere" stop counting as evidence about this position).
- Another was reported as hundreds of millions in bearish shorts, and the first version of this tool agreed it was hedged. It is not that simple: **next to none of its $208.2M ETH short is covered by anything that address holds**, and $395.8M of matching ETH sits in two wallets that funded it. A funding transfer is not ownership, one such funder turned out to be an exchange, and part of that ETH is an Aave deposit with an invisible loan against it.
- And sometimes it really is a bet: **one $126.4M HYPE long, the account's entire exposure, nothing offsetting it**.

Those three stories are readings dated 26 September, kept in the archive. The four cards at the top of the page were re-read on 7 October with the current rules: the HYPE long ($122.1M) and the funder-linked ETH short ($212.1M, with $318.7M of matching ETH in two funding wallets) read the same way; the former Book example now reads Unknown, because busy two-sided trading alone does not prove inventory. Every card carries its date and opens for free. Those readings were made with Nansen; a new check uses Hyperliquid, public nodes and Blockscout, so a re-read of the same address can differ (see Honest limits).

Bet or Book answers one question per address, shows the numbers that decided it, and says what it could not read.

## What a check returns

- **A verdict**: Book, Spot-covered short, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` counts corroborating Book signals, not a probability). The API retains `hedged`. An Unknown names its kind on the badge itself, e.g. *Unknown · assets sit with funders*.
- **One sentence built from the numbers**, e.g. *"The $42.0M HYPE short is 99% covered by $41.6M of spot HYPE held by this address on Hyperliquid - the recognised tokens on Ethereum, Arbitrum and HyperEVM were checked and held none."*
- **A picture of what stands against the position**: a constellation diagram, the position drawn on the left and what this address holds against it on the right, with the share it covers as the one number in the middle. A short that is covered fills the right side; one that is not leaves it nearly empty. A holdings read that did not finish is flagged as incomplete next to the number rather than drawn as an absence. Anything held by a wallet that merely funded this one is drawn as a dashed ghost of a constellation, never as this account's own. That distinction is the whole card, and a row of percentages is a poor way to carry it. A long marks spot coverage as not applicable, since spot cannot offset one; a book shows how much of its own market it quotes on both sides, the number its verdict turns on. The share picture and the link preview draw the same constellation.
- **A choice of position.** A post says BTC and the largest position at the address is ETH. The card offers the largest five first and an asset search across all positions read; choosing a leg runs a new check.
- **What changed since the last reading**, where there is one - and whether the answer moved because the account did something or because the rules did. Those look identical on a card and are not the same event.
- **The number the verdict turned on**, first, where there is no picture to show it. The other evidence numbers, each tagged with the source that produced it (`Hyperliquid`, `On-chain` for the public nodes, `Explorer`, or two together such as `Hyperliquid + On-chain`; a reading made with Nansen says `Nansen`), and a strip of vitals - leverage, distance to liquidation, unrealized PnL, funding since open - that never decide the verdict, are visible on the card. Where there is room among the five numbers, the 30-day PnL appears as "Perp PnL, 30d (realized and unrealized)": perps only, no spot, context that no verdict turns on.
- **How this was decided**, in words: the rule that fired, with the thresholds it used. The raw reason code and the rules version are underneath it, for anyone checking the rules themselves.
- **What each source added**: every number on the card names the source that produced it. Positions, orders, fills and the 30-day PnL are Hyperliquid's own, read from every dex, and the card says how many dexes answered; balances on Ethereum, Arbitrum and HyperEVM come from public nodes, and the card says which tokens and chains were read; the wallets that first funded the account come from the Blockscout explorer. A reading made with Nansen in September or October (the saved examples and the archive) has its own "Data from Nansen" section, in full one click down: balances on every chain, funding links, funding history and realized PnL. Where the funding links are what stop a verdict on such a reading, the section runs the same rules over the same numbers without them and says what those numbers would have read as - for the $208.2M ETH short above, "Looks like a bet".
- **What is still open**: the question the reading cannot settle, in its own terms - "whether any of that HYPE is owed to someone", "who controls the wallets that funded this account".
- **The funding wallets**, with explorer links, when they hold the matching asset. They hold it; that is not the same as this account holding it, and the card says so.
- **What could not be read**, every time: which sources were missing or cut short, how old the numbers are, and which rules read them.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **Save and Share**: save a named position in this browser, reopen its dated reading free from the **Saved** tab in the header, or refresh it manually. Share offers the exact reading link, copyable evidence text, an X draft with date and limits, and a PNG card. The link carries a matching preview when pasted into X, Telegram or Discord.
- **A guess while it loads**: a live check takes a few seconds, and after the first moment the page offers an optional guess - bet, hedge, book or can't tell. When the answer arrives it says what you guessed against what the reading found, with a running count kept in your own browser only.
- **Ranked boards** on the Explore screen, drawn from the readings already on file and free to open: the biggest bets, the biggest positions against their market's open interest, the best and the least covered shorts, and the market makers by how much of their own market they quote on both sides.

## Run it locally (about 10 minutes)

Needs Node.js 22.12 or newer (Wrangler 4 and Vitest 5 require it).

```bash
git clone https://github.com/Sofiia7/bet-or-book.git
cd bet-or-book
npm install
npm test
```

`npm run test:runtime` then builds the Worker with Wrangler and runs a second set of tests against it inside workerd, Cloudflare's own runtime: twelve overlapping checks that make no Nansen call (the retired credit-meter class still answers), the burst limit in real Durable Objects, the monitoring pilot's capacity and cron delivery, KV failing and KV lagging. Under a minute.

No key is needed for Hyperliquid or the public nodes, and no paid credit is spent: a local check sends read-only requests to the public sources. Optional: copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars`. `BLOCKSCOUT_API_KEY` is a Blockscout PRO API key (free to register at https://dev.blockscout.com; the terms shown at sign-up are yours to read): with it the funding links are read on Ethereum and Arbitrum through `api.blockscout.com` (Ethereum from its REST path, Arbitrum from the Etherscan-style `txlist`, because Blockscout's Arbitrum REST cannot sort oldest first), and the key is sent only in an `Authorization` header. Without it Ethereum is read from the keyless public explorer (bot protection can refuse a script, and then that chain reads as not read) and Arbitrum funding links are not read at all. An unread funding-link chain leaves the funder search partial, so a short that needs that search reads Unknown rather than Looks like a bet, and the card says why. `DEMO_KEY` is an operator key: a request carrying it in the `x-demo-key` header skips the public rate limits. Missing cross-chain evidence, or a Hyperliquid dex that did not answer, usually means Unknown; Bet and Hedged require complete reads. Saved examples open for free either way.

```bash
npm run dev
```

Then open http://localhost:8787.

## How the verdict is decided

Rules run in order; the first one that fires wins ([`src/engine/verdict.ts`](src/engine/verdict.ts)). The set is versioned: `CLASSIFIER_VERSION` travels with every answer, because a verdict means nothing without the rules that produced it.

| # | Verdict | Rule |
|---|---|---|
| Time | Unknown, `positions_stale` | Position source time is at least 15 minutes behind the original check, or over a minute ahead. Newer holdings/orders cannot establish coherent exposure from that reading |
| 0 | Unknown | no open positions |
| 1 | Book | **The headline position's own market quoted on both sides**, worth at least 10% of the headline position there (floor $10K, `2 x min(bid, ask)` so a large bid against a token ask does not count as matched) - plus the account-wide shape: 50+ non-trigger, non-reduce-only resting orders, 25-75% bids, 5+ markets quoted on both sides. A wide spread of positions and a busy fill count corroborate and raise it to `strong`; none of them decides alone, and quoting elsewhere is the account's activity, not evidence about this position |
| 2 | Unknown, unresolved exposure | Opposing perpetual legs, a known same-asset Hyperliquid spot liability, or an unverified HIP-3 underlying. The spot-only ratio cannot settle combined exposure in these cases |
| 2a | Unknown, `positions_not_complete` | Unseen perp venues may change combined exposure; complete matching spot cannot establish a hedge from an incomplete position read |
| 3 | Unknown, `over_covered` | the spot leg is larger than the short. Incomplete holdings can only add to it, but positions must still be complete before interpreting the combined exposure |
| 4 | Unknown, `hedge_not_checked` | the holdings could not be read in full, so neither their absence nor a ratio measured over part of them proves anything. What was found is reported as a floor |
| 5 | Unknown, `unrecognised_assets` | 10%+ of the position sits in holdings whose asset this tool could not establish, so "nothing offsets this" is not available to say |
| 6 | Spot-covered short (`hedged`) | Spot of the same asset held by this address covers 85-115% of a headline short, with positions and holdings read in full and asset identity established. Portfolio-wide dollar cancellation alone never grants Hedged |
| 7 | Unknown, `partial_offset` | 10-85% covered: what is left over is still a position, and the card says how much. Busy two-sided maker fills without decisive quoting also withhold a verdict after the hedge checks |
| 8 | Looks like a bet | 5 or fewer positions, net 80%+ of gross, the selected position 50%+ of exposure, under 10% covered, no two-sided quotes; or the same directional test across a wider portfolio (`directional_portfolio`). Both paths require complete order and position reads, and a completed funding-wallet search when one was attempted |
| 9 | Unknown | `quotes_not_checked` / `positions_not_complete` (a source either bet path asserts something about would not answer), `mixed_long_short_book` (the dollars net out across different assets), `diversified_book_no_quotes` (the shape of a book with nothing quoted to say so), `maker_flow_only` (busy, but nothing says this position is inventory - checked only after a hedge this tool could prove or rule out, so a proven hedge is never withheld for something true about the account rather than the coverage), `linked_exposure_unverified` (the matching assets are in a wallet that funded this account, checked before the portfolio path so a funding link keeps first refusal), or the signals simply disagree |

What each rule refuses to conclude, how an asset is identified, and what the three-account calibration run does and does not establish: [`docs/rules-in-depth.md`](docs/rules-in-depth.md). Seventeen real readings of every kind, gone through by hand for whether any card claims more than its data: [`docs/case-review.md`](docs/case-review.md).

## What each source decides

| Source | What it drives |
|---|---|
| Hyperliquid's info API | Everything about the position itself, for every rule: positions on every perp dex (`perpDexs`, then `clearinghouseState` on each one, HIP-3 dexes included), resting orders on the dexes the account has positions on, 24-hour fills, spot balances, marks and open interest. As context only, the 30-day perp PnL (`portfolio`): no verdict turns on it |
| Public JSON-RPC nodes (PublicNode for Ethereum and Arbitrum One, Hyperliquid's own RPC for HyperEVM) | The account's own hedge on other chains, for a headline short: one Multicall3 call per chain per wallet over the registry's tokens, the chain's own coin and a short watchlist of look-alike staking tokens (flagged, never counted as cover), priced with Hyperliquid's marks. A token is identified by its contract, never by its ticker, and the completeness of the read decides whether "no hedge found" may be said at all. The same read, wallet by wallet, for the funders |
| Blockscout block explorer (keyless `eth.blockscout.com`, or `api.blockscout.com` with a key) | The First Funder wallets on Ethereum and Arbitrum (an Arbitrum sender is looked up once more, on the Ethereum chain, for its tag), then their balances from the nodes. This is reported as its own observation, never folded into the account's coverage. A funder search that completes and finds no funder holding the matching asset is what lets a Bet stand; one that could not be read in full withholds the verdict, and a funder found holding the asset makes it Unknown. Its tags are read only to decide whether a funder is an exchange or bridge, which is skipped (which can also let a Bet stand) |

Hyperliquid has to be read dex by dex, not through one endpoint. The reading that showed why was made on 26 September through Nansen's `profiler/perp-positions`: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint. Since then every rule reads the positions from Hyperliquid itself, and a dex that does not answer leaves the reading partial, and the card names it.

A check sends at most 45 outbound requests (the Workers Free plan allows 50 for one invocation); the heaviest case the tests build sends 42. Reads that cannot change the verdict give way first, and the card says when the limit stopped one.

## The four readings at the top, and the scan below them

The four example cards were refreshed on 7 October through the `checkAddress` of that date, which still read Nansen (21 Nansen credits). They keep their dates and their Nansen credit; a new check of the same addresses uses the current sources and can read differently. The answers at that date are a HYPE bet, a covered HYPE short, an ETH short whose matching assets sit with funders, and a busy ETH account without enough quoting evidence to establish inventory. The former Book example now reads Unknown; examples follow the evidence rather than preserving a desired set of badges. [`data/featured.json`](data/featured.json) keeps earlier IDs and comparisons. Opening a saved example is free. The card shows its verdict, evidence, position risks, comparison and missing sources; Full analysis contains rules and details. Share supports a link and downloadable PNG. A browser-local watchlist never runs a check automatically.

The earlier scan checked 277 open accounts selected from the top 3,000 by account value and ranked by their largest main-dex position. These remain historical: they predate evidence required by the current rules and keep their original verdicts. Explore boards include those readings with explicit rule-version labels; the archive remains separate in All readings. A fresh check produces a current reading. How the scan was built: [`docs/gallery-scan.md`](docs/gallery-scan.md). October fixes: [`docs/audits/2026-10-07-fixes.md`](docs/audits/2026-10-07-fixes.md).

## Honest limits

- A hedge on a centralized exchange, in OTC or in a wallet with no on-chain link is invisible. The card says so every time.
- Ownership through a funding link is not established by the link. A funder's holdings are reported as theirs and never counted as this account's hedge.
- Debts outside Hyperliquid are invisible. A negative Hyperliquid spot balance in the position's own asset now withholds the exposure verdict. Other loans are listed as context. Lending deposits elsewhere count as visible assets, but debts against them are not read, so visible coverage still does not establish net neutrality.
- Only the headline position's hedge is searched. A pair trade (long A against short B) is not modeled; net versus gross exposure and the same-asset offset share catch part of it.
- An on-chain token whose contract is not one this tool recognises is left out of the hedge rather than counted by its ticker. The registry is short, so a real holding can be missed. A reading that read only the registry tokens (balances from public nodes on Ethereum, Arbitrum and HyperEVM) says which tokens and chains it read, and flags a listed look-alike staking token (rsETH, ezETH, mETH, ETHx, osETH) held in a material amount, but it cannot say what any other token holds or how much of an account sits outside the registry. Readings saved earlier, which read the full balance list, say how much was left out.
- Hyperliquid returns at most 2,000 fills per call; a busier account shows "2,000+", a lower bound. The card also says how many hours the fills actually span, which can be far less than the window asked for.
- Blockscout address tags are never shown or stored. They are read in one place only ([`src/sources/explorer.ts`](src/sources/explorer.ts)), to decide whether a funding link leads to an exchange or bridge (such a wallet is skipped, and a long's funding history says "by an exchange or bridge"), and dropped there. Blockscout's Arbitrum answer carries no tags, so the sender of an Arbitrum link is looked up once on the Ethereum chain, where the exchange hot wallets are tagged (an exchange funds from the same address on both chains); a lookup that fails or finds no tag leaves the sender unlabelled, which is followed, and following it can only push the reading toward Unknown, never make it a Bet. Most wallets carry no Blockscout tag, which the card reports as "no exchange label here" and unverified rather than treating as "a private wallet"; a tag can also be missing or wrong. The explorer test fixtures are trimmed to the fields the reader uses, with each sender's metadata cut down to its tag names.
- First funder means the first direct sender of native coin to the address, on Ethereum and Arbitrum, read from the explorer's list of transactions. Funding that arrives through internal transactions (a contract or batch withdrawal, an Arbitrum deposit from Ethereum) is not in that list and is not seen, and transfers between Hyperliquid accounts are not part of the reading, so the wallet this tool names can differ from the one Nansen's related-wallets answer named in the September readings. Only the first page (50 transactions, oldest first; on Arbitrum both directions, the wallet's own calls included) is read: if it holds no incoming transaction with a value and there are more pages, the card says the earliest funder may be missing. A page that holds a transaction with no recipient (a contract creation) is refused whole, and that chain reads as not read. In the keyed capture of 2026-11-10 the Arbitrum funder of the Abraxas wallet (`0xb38e...891d`, 0.2 ETH on 2025-02-20) is the same wallet Nansen named in September, and Blockscout tags it on Ethereum as a Binance hot wallet, so a new reading of that account skips it as an exchange and follows only its Ethereum funder.
- Without a Blockscout key the funding links on Arbitrum are not read. The funder search is then partial, and a short that needs it reads Unknown, never Looks like a bet.
- Blockscout's free key allows about 5,000 calls a day (100K credits a day at 20 credits a call). A check that reaches the funder search spends 2 explorer calls (40 credits), and 3 (60 credits) when its Arbitrum read finds a sender to look up, so the allowance covers roughly 1,600 such checks a day. Nothing bounds traffic except the rate limiters, so heavy traffic can exhaust it. The shorts that need the funder search then read Unknown until the daily allowance resets, and the owner can see which links were not read in the telemetry field `fundingLinksNotes` (the coverage notes that start with "Funding links on ", at most four per line, present only when there are any).
- The explorer has been called from a development machine only, never from Cloudflare's network, though with a real key: the keyed answers were captured on 2026-11-10 and the fixtures are those captures. The first production check after a deploy must show that it works; until then a chain it refuses reads as not read.
- The 30-day PnL tile is Hyperliquid's `perpMonth` figure: the change in cumulative perp PnL over 30 days, realized and unrealized, perps only. Spot is not in it, and it is not the closed-trade PnL and win rate the September readings showed, so the two are not comparable.
- Readings made with Nansen in September and October asked every chain Nansen covers and took their funding links from its related-wallets answer. A new reading of the same address reads fewer tokens on three chains and takes its links from the explorer, so it can differ from the saved one: the sources differ, not only the date.
- The nodes are read on three chains, Ethereum, Arbitrum and HyperEVM, and only for the registry's tokens, the chain's own coin and the look-alike watchlist. A holding on any other chain, or in any other token, is not seen at all: it is neither counted nor reported, and the card says which tokens and chains were read. Readings made with Nansen asked every chain it covers and report a matching holding outside the registry as dollars of unknown identity, which can withhold the verdict; for a new reading a flagged look-alike staking token held in a material amount, or a holding that could not be priced, can.
- Thresholds - 85-115%, 5 and 20 positions, 10% of the headline in quotes - are ordinary numbers chosen against observed data. None has been validated against an independently labelled sample, and none of them is a confidence level.
- Nothing here is advice. The tool describes a position and names what it could not read; whether to copy anything is the reader's call.

## Deploy to Cloudflare Workers

```bash
npx wrangler kv namespace create KV
```

Put the printed id into `wrangler.toml` under `[[kv_namespaces]]`, then:

```bash
npx wrangler secret put BLOCKSCOUT_API_KEY
npx wrangler secret put DEMO_KEY
npx wrangler deploy
```

Both secrets are optional. `BLOCKSCOUT_API_KEY` is the explorer key (without it Arbitrum funding links are not read); `DEMO_KEY` is the operator key. There is no Nansen key and `wrangler.toml` has no variables: a leftover `NANSEN_API_KEY` secret is never read and can be removed with `npx wrangler secret delete NANSEN_API_KEY`. What bounds a check is a per-check budget of 45 outbound requests and the rate limits, both in code; how they hold under concurrent requests is in [`docs/architecture.md`](docs/architecture.md).

## The API

| Route | What it does |
|---|---|
| `POST /api/check?address=0x...` | Runs a check. Optional `&coin=ETH&side=short` asks about one position rather than the largest; `&context=0` skips the optional PnL and a long's funding history. This is the only route that sends requests to the data sources, and it is a POST from this site for that reason |
| `GET /api/check?address=0x...` | An answer that already exists, or 404. Reads nothing from the sources, so a crawler or a prefetch cannot cause any |
| `GET /api/snapshot?id=...` | One saved reading, exactly as it was read, with the rule behind its verdict in words (`rule`) and whether it is a gallery card or a saved reading (`kind`). A reading saved in the last minute can briefly answer 404 in a region KV has not reached yet; that 404 is never cached |
| `GET /api/compare?a=...&b=...` | Two readings of one address, side by side: what moved, and whether the answer moved with the data or with the rules. Reads stored readings only |
| `GET /api/gallery` | The dated scan and the four demonstration readings, one short row per card; a card itself opens through `/api/snapshot` |
| `GET /api/og?id=...` | That reading's social-preview picture (PNG), or a standing picture, briefly cached, while its own has not been drawn. Never draws on the request itself: that is what a crawler sends, and the render does not fit the free plan's CPU budget |
| `POST /api/og?id=...` | Draws that picture and keeps it. Sent by this site's own page once a reading is saved and when its Share button is opened, so the picture exists before any crawler asks for it |
| `POST /api/demo-access` | Whether the operator key in the `x-demo-key` header is accepted (it lets a request skip the public rate limits): 204 or 403, nothing else, and it reads nothing from the sources. The page's `/#operator` uses it to check a key before a recording |
| `POST /api/events` | Bounded anonymous usage enums for the product funnel, in Worker logs; no wallet, text, URL or user identifier. No provider calls or KV writes |
| `GET /api/v1/readings/<id>?claim=...` | A saved reading as versioned, read-only JSON for publishers: the dated evidence, its limits, attribution (the `attribution` field, which names exactly the sources that reading used: Hyperliquid, public nodes, Blockscout, or Nansen for a reading made with it) and, with `claim` (for example `ownership`), what the evidence does and does not establish about that assertion. Open CORS; it answers from stored readings and never starts a check |
| `GET /embed?s=<id>&claim=...` | The same reading as a small card that other sites may frame. It carries the date and the limits and cannot start a check |
| `POST /api/watch` | The monitoring pilot: subscribe, status and unsubscribe for one saved reading. Four slots in all, about every four hours for 72 hours, same-site POST only; its checks go through the same public path and rate limits as a visitor's |
| `GET /api/ledger` | Two static archives of the Nansen calls made for the September build: `scripted` (`data/ledger.json`: the scripts and smoke runs, attempted against answered) and `live` (`data/ledger-worker.json`: the Worker's own 55 calls, frozen from the retired credit meter on 10 November 2026, credits quoted against credits assumed). A check makes no Nansen call, so nothing counts them any more and neither archive changes |

## Scripts

| Script | What it does |
|---|---|
| `scripts/prescan.ts` | Builds the gallery with the Worker's own `checkAddress`; stops after five failed checks in a row; resumable. Run over a few named addresses into `data/featured.json`, it makes the demonstration readings. Reads `BLOCKSCOUT_API_KEY` from the environment or `.dev.vars`, never printing it |
| `scripts/refresh-featured.ts` | Re-reads the featured examples through `checkAddress` and replaces one only when the new reading is complete and no thinner than the one it replaces; refuses to start without a Blockscout key |
| `scripts/ledger.ts` | Sums `data/nansen-calls.jsonl` (the September archive; nothing appends to it) into `data/ledger.json`, served at `/api/ledger` |
| `npm run release:check` | Checks deployed saved examples, dates, API/widget and exact bundled PNGs with GET only; reports which launch requirements it cannot verify |
| `scripts/reexplain.ts` | Re-judges and re-explains the gallery cards whose stored observation carries what the current rules read, and marks the rest as history. No network: a rules fix never needs a new scan |
| `scripts/fetch-fixtures.ts`, `scripts/fetch-portfolio-fixtures.ts`, `scripts/fetch-onchain-fixtures.ts`, `scripts/fetch-explorer-fixtures.ts` | Capture real responses for the tests: Hyperliquid's info API, its `portfolio` answer, the nodes' Multicall3 answers and Blockscout's answers (the Arbitrum `txlist` and the label list with the key in the shell or `.dev.vars`; `--keyless-ethereum` for the public Ethereum pages), trimmed to the fields the reader uses. Read-only, the key is never printed |
| `scripts/smoke-holdings.ts`, `scripts/smoke-stage3.ts` | Live read-only checks against the public sources with a request count per host: the on-chain holdings reads, and the whole check for the Abraxas wallet (`smoke-stage3` makes no Nansen call and stays within the 45-request budget) |
| `scripts/prerender-og.ts` | Renders current demonstration previews offline and bundles them with the Worker; optional `--upload` writes KV, and `--all` rebuilds the archive, so a shared link to one of them has its own picture from the start (see [`docs/architecture.md`](docs/architecture.md)) |

## Nansen API usage (historical)

The September build read the Nansen API: **1,155 calls between 14 and 27 September, 1,147 answered 2xx** ([full breakdown by endpoint and purpose, and what each of the eight failed calls taught](docs/nansen-api-usage.md), kept as the archive of that build). `/api/ledger` serves that archive as a static file; it is not a lifetime usage counter. The current code makes no Nansen call, and no check settles anything against a credit meter.

## Security

No wallet connection, login, user uploads or outbound message delivery. Inputs include wallet/position selection, bounded assertions, usage events and monitoring capabilities; public publisher endpoints expose saved evidence. Monitoring uses an unguessable browser token and SQLite-backed Durable Object storage. The optional explorer key and the operator key stay in Worker secrets and git-ignored `.dev.vars`; the explorer key is sent only in an `Authorization` header to Blockscout. A check requires a POST, refuses requests that other websites make through a visitor's browser, allows command-line clients within the rate limits, and stops itself at 45 outbound requests. The main page forbids framing and inline scripts; the static widget permits embedding. The October 8 dependency audit reported zero known vulnerabilities; that is a dated audit result, not a continuing guarantee. On 9 November `npm audit --omit=dev` reported one moderate advisory in the production dependency `satori` (GHSA-wx4j-mvgx-mqwp, improper escaping in generated SVG; fixed in satori 0.63.2, a major upgrade tracked as a follow-up; see [`SECURITY.md`](SECURITY.md)). See [`docs/architecture.md`](docs/architecture.md) and [`docs/publisher-pilot.md`](docs/publisher-pilot.md). How to report a vulnerability, and how each scanner finding was triaged: [`SECURITY.md`](SECURITY.md).

## Stack

Cloudflare Workers, Workers KV and two live Durable Objects (the pilot watch coordinator and the rate limiter - these need an atomic read-modify-write that KV cannot promise), plus the retired `NansenBudget` class, which answers 410 to anything and keeps its name because deleting a Durable Object class takes a migration, TypeScript, Vitest (1,402 tests on recorded real responses, including the Worker's own routes driven through real Requests and the real image renderer with no mocks, plus 8 that run the built Worker inside workerd through Miniflare). No frontend framework: one HTML page, bundled script modules and a canvas for the share card. Two runtime dependencies, both for the one thing this Worker cannot do without them: [`satori`](https://github.com/vercel/satori) lays out a reading's social-preview picture and [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) rasterizes it to PNG - see [`docs/architecture.md`](docs/architecture.md) for why that render never runs on a crawler's request.

## License

[MIT](LICENSE). The self-hosted Geist and Geist Mono fonts in `assets/` are under the SIL Open Font License 1.1 ([`assets/GEIST-LICENSE.txt`](assets/GEIST-LICENSE.txt)).

## Further reading

- [`docs/rules-in-depth.md`](docs/rules-in-depth.md) - what each verdict rule refuses to conclude, asset identity, and the calibration run
- [`docs/gallery-scan.md`](docs/gallery-scan.md) - how the 277-account scan was built and what moved when the rules changed
- [`docs/case-review.md`](docs/case-review.md) - seventeen readings read by hand: what each one observes, interprets, or declines to say
- [`docs/nansen-api-usage.md`](docs/nansen-api-usage.md) - every Nansen call of the September build accounted for, including the eight that failed (historical)
- [`docs/architecture.md`](docs/architecture.md) - the order of reads and the per-check request budget, rate limiting, the link-preview picture on the free plan, what the Worker counts, the runtime tests, and the security checklist
- [`docs/wiki/calibration.md`](docs/wiki/calibration.md) - the original three-account smoke test (superseded; kept as a record)
- [`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md) - the original design spec (historical; routes and timings in it predate later audits)
- [`docs/audits/`](docs/audits/) - the seven audits from 19 to 27 September; the 19, 21 and 23 September ones each come with an offline reproduction of the defects they found, and the 27 September one records the v6 rule changes. The October audits (7 to 9 October: [full audit](docs/audits/2026-10-08-full-audit.md), [fixes](docs/audits/2026-10-09-fixes.md), [what remains open](docs/audits/2026-10-09-remaining.md)) cover the v7 to v10 rules, credit protection and the evidence-sharing features; [`docs/audits/2026-10-07-fixes.md`](docs/audits/2026-10-07-fixes.md) is the public fixes matrix
