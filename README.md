# Bet or Book

**Paste a Hyperliquid address. Find out whether that whale position is a bet you could follow, a hedge, or a market maker's book.**

**Live: [bet-or-book.sofiaseremeteva.workers.dev](https://bet-or-book.sofiaseremeteva.workers.dev)**

Built for the [Nansen Meridian Buildathon](https://www.nansen.ai/campaigns/meridian-buildathon) (14-27 September 2026). Powered by Nansen API.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not what the headline makes of it:

- The account behind one of those posts is a **market-making book**: 134 open positions, 2,613 resting orders quoting both sides of 123 markets - including its own $46.9M ETH short, $42.9M of that quoting genuinely matched in ETH itself, not just activity somewhere else in the account. That is a business, not a view on price (read on 24 September, after the fix in [L01](docs/audits/2026-09-23-full-audit-ru.md) made "quoted elsewhere" stop counting as evidence about this position).
- Another was reported as hundreds of millions in bearish shorts, and the first version of this tool agreed it was hedged. It is not that simple: **next to none of its $209.1M ETH short is covered by anything that address holds**, and $443.7M of matching ETH sits in two wallets that funded it. A funding transfer is not ownership, one such funder turned out to be an exchange, and part of that ETH is an Aave deposit with an invisible loan against it.
- And sometimes it really is a bet: **one $130.0M HYPE long, the account's entire exposure, nothing offsetting it**.

All three are among the four readings at the top of the page, each dated 24 September and each opening for free.

Bet or Book answers one question per address, shows the numbers that decided it, and says what it could not read.

## What a check returns

- **A verdict**: Book, Hedged, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` for a book).
- **One sentence built from the numbers**, e.g. *"The $41.8M HYPE short is 97% covered by $40.4M of spot HYPE held by this address on Hyperliquid - other Nansen-supported chains were checked and found nothing."*
- **A picture of what stands against the position**: one bar for the position, split into what this address holds against it, what could not be identified, and what nothing was found against - with anything held by a wallet that merely funded this one drawn beside the bar on a dashed connection, never inside it. That distinction is the whole card, and a row of percentages is a poor way to carry it.
- **A choice of position.** A post says BTC and the largest position at the address is ETH. The card offers the address's largest few and will answer about the one you came for.
- **What changed since the last reading**, where there is one - and whether the answer moved because the account did something or because the rules did. Those look identical on a card and are not the same event.
- **The number the verdict turned on**, first, where there is no picture to show it. The other evidence numbers, each tagged with the source that produced it (Nansen, Hyperliquid, or both), and a strip of vitals - leverage, distance to liquidation, unrealized PnL, funding since open - that never decide the verdict but are already paid for, sit one click down.
- **How this was decided**, in words: the rule that fired, with the thresholds it used. The raw reason code and the rules version are underneath it, for anyone checking the rules themselves.
- **What Nansen added**, on one line without opening anything, and in full one click down: positions on every dex, balances on every chain, funding links, funding history. Where the funding links are what stop a verdict, the card runs the same rules over the same numbers without them and says what those numbers would have read as - for the $209.1M ETH short above, "Looks like a bet".
- **What is still open**: the question the reading cannot settle, in its own terms - "whether any of that HYPE is owed to someone", "who controls the wallets that funded this account".
- **The funding wallets**, with explorer links, when they hold the matching asset. They hold it; that is not the same as this account holding it, and the card says so.
- **What could not be read**, every time: which sources were missing or cut short, how old the numbers are, and which rules read them.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **One Share button**: a link that reopens *this* reading rather than starting a new one, a draft post, and the card as a picture (PNG, carrying those limits) - with a matching image for the link itself when it is pasted into X, Telegram or Discord.

## Run it locally (about 10 minutes)

Needs Node.js 22.12 or newer (Wrangler 4 and Vitest 5 require it).

```bash
git clone https://github.com/Sofiia7/bet-or-book.git
cd bet-or-book
npm install
npm test
```

`npm run test:runtime` then builds the Worker with Wrangler and runs a second set of tests against it inside workerd, Cloudflare's own runtime: the spend cap under concurrent checks, a Durable Object restarting, a reader disconnecting mid-check, KV failing and KV lagging. About twenty seconds.

Optional, for live Nansen reads: copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and put your key in it. Without one every check runs Hyperliquid-only and says so on the card.

```bash
npm run dev
```

Then open http://localhost:8787.

## How the verdict is decided

Rules run in order; the first one that fires wins ([`src/engine/verdict.ts`](src/engine/verdict.ts)). The set is versioned: `CLASSIFIER_VERSION` travels with every answer, because a verdict means nothing without the rules that produced it.

| # | Verdict | Rule |
|---|---|---|
| 0 | Unknown | no open positions |
| 1 | Book | **The headline position's own market quoted on both sides**, worth at least 10% of the headline position there (floor $10K, `2 x min(bid, ask)` so a large bid against a token ask does not count as matched) - plus the account-wide shape: 50+ resting orders, 25-75% bids, 5+ markets touched. A wide spread of positions and a busy fill count corroborate and raise it to `strong`; none of them decides alone, and quoting elsewhere is the account's activity, not evidence about this position |
| 2 | Hedged | 2-19 positions netting to 35% or less of gross **with 80%+ of that gross cancelling inside individual assets**, or spot of the same asset held by this address covering 85-115% of a headline short **when those holdings were read in full** |
| 3 | Unknown, `over_covered` | the spot leg is larger than the short: the account is long the asset it is short. The one conclusion an incomplete read still supports, since missed holdings can only add to it |
| 4 | Unknown, `hedge_not_checked` | the holdings could not be read in full, so neither their absence nor a ratio measured over part of them proves anything. What was found is reported as a floor |
| 5 | Unknown, `unrecognised_assets` | 10%+ of the position sits in holdings whose asset this tool could not establish, so "nothing offsets this" is not available to say |
| 6 | Unknown, `partial_offset` | 10-85% covered: what is left over is still a position, and the card says how much |
| 7 | Looks like a bet | 5 or fewer positions, net 80%+ of gross, the largest 50%+ of exposure, under 10% covered, no two-sided quotes; **or, failing only on position count or headline share, the same net-80%+-of-gross and no-quotes test applied to the whole portfolio** (`directional_portfolio`) - eleven positions all short is one stance, not eleven bets, and every clause here is still an absence, so **both paths need the orders and positions read in full** |
| 8 | Unknown | `quotes_not_checked` / `positions_not_complete` (a source either bet path asserts something about would not answer), `mixed_long_short_book` (the dollars net out across different assets), `diversified_book_no_quotes` (the shape of a book with nothing quoted to say so), `maker_flow_only` (busy, but nothing says this position is inventory - checked only after a hedge this tool could prove or rule out, so a proven hedge is never withheld for something true about the account rather than the coverage), `linked_exposure_unverified` (the matching assets are in a wallet that funded this account, checked before the portfolio path so a funding link keeps first refusal), or the signals simply disagree |

What each rule refuses to conclude, how an asset is identified, and what the three-account calibration run does and does not establish: [`docs/rules-in-depth.md`](docs/rules-in-depth.md). Seventeen real readings of every kind, gone through by hand for whether any card claims more than its data: [`docs/case-review.md`](docs/case-review.md).

## What the Nansen data decides

| Nansen endpoint | What it drives |
|---|---|
| `profiler/perp-positions` | Every rule. Covers all Hyperliquid perp dexes, HIP-3 included: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint |
| `profiler/address/current-balance` (chain `all`) | The account's own hedge on any chain, for a headline short. Each row's contract decides what the asset is, and its completeness decides whether "no hedge found" may be said at all |
| `profiler/address/related-wallets` (Arbitrum, Ethereum) | The First Funder wallets, then their `current-balance`. This is reported as its own observation, never folded into the account's coverage: it can stop a verdict, not make one |
| `profiler/perp-pnl-summary` | 30-day realized PnL on the card. Context, not a rule: no verdict turns on it |

Hyperliquid's free API supplies resting orders (per dex, including HIP-3 markets the account has positions on), 24-hour fills and open interest.

## The four readings at the top, and the scan below them

The four chips under the address field open readings made fresh on 24 September and picked by hand, one of each kind of answer: a bet, a short covered in the same account, a short whose matching asset sits with the wallets that funded it, and a market maker's book. They are in [`data/featured.json`](data/featured.json), made by the same `checkAddress` a live check runs, and each one says what changed since the scan's reading of the same address.

Below them, the same check ran once over 277 large Hyperliquid positions (the top 3,000 accounts by value, ranked by their largest main-dex position) and is re-judged offline whenever the rules change, at no cost. Of the 188 cards the current rules can read:

| Verdict | Positions | Share of the 188 judged |
|---|---|---|
| Looks like a bet | 131 | 70% |
| Unknown | 51 | 27% |
| Book | 0 | 0% |
| Hedged | 6 | 3% |
| *Read by earlier rules* | *115* | *not judged by v5* |

Book reads zero in the scan, not because no market maker is in the set, but because the 23 September audit found the rule crediting quoting *anywhere in the account* as evidence about the one position on screen - and no scan before that fix recorded whether the headline market itself was ever quoted. The three cards that used to read Book are part of "read by earlier rules": kept exactly as v4 judged them. One of them has since been read fresh, and the current rules call it a book again, now on quoting in its own headline market - it is the fourth of the readings at the top. Read the whole table as "of the 277 read", never as "of the market" - leverage breaks the link between what an account is worth and what it holds, and the scan spent its last credits on the cheaper checks. How the set was built and what moved when the rules changed: [`docs/gallery-scan.md`](docs/gallery-scan.md).

## Honest limits

- A hedge on a centralized exchange, in OTC or in a wallet with no on-chain link is invisible. The card says so every time.
- Ownership through a funding link is not established by the link. A funder's holdings are reported as theirs and never counted as this account's hedge.
- Debts outside Hyperliquid are invisible. A loan on Hyperliquid itself (portfolio margin) is listed with the reading, and one in the position's own coin stands next to the answer, since owed and not held it works as a short. But a lending deposit elsewhere counts toward a hedge because the balance is real, and nothing here can see what was borrowed against it, so a leveraged position can still look flat.
- Only the headline position's hedge is searched. A pair trade (long A against short B) is not modeled; net versus gross exposure and the same-asset offset share catch part of it.
- An on-chain token whose contract is not one this tool recognises is left out of the hedge rather than counted by its ticker. The registry is short, so a real holding can be missed; the card says how much was left out.
- Hyperliquid returns at most 2,000 fills per call; a busier account shows "2,000+", a lower bound. The card also says how many hours the fills actually span, which can be far less than the window asked for.
- Nansen address labels are never shown or stored. They are read in one place only, to decide whether a funding link leads to an exchange or bridge, and dropped there ([`src/sources/normalize.ts`](src/sources/normalize.ts)). In practice Nansen sends no label for most addresses, which the card reports as unverified rather than treating as "a private wallet". Test fixtures are saved with every label field set to null.
- The contract registry covers Ethereum and Arbitrum, while the balance read asks for every chain. A matching holding on a chain outside it is reported as dollars of unknown identity, not as an absence, and enough of them withhold the verdict instead of producing a confident one.
- Thresholds - 85-115%, 5 and 20 positions, 10% of the headline in quotes - are ordinary numbers chosen against observed data. None has been validated against an independently labelled sample, and none of them is a confidence level.
- Nothing here is advice. The tool describes a position and names what it could not read; whether to copy anything is the reader's call.

## Deploy to Cloudflare Workers

```bash
npx wrangler kv namespace create KV
```

Put the printed id into `wrangler.toml` under `[[kv_namespaces]]`, then:

```bash
npx wrangler secret put NANSEN_API_KEY
npx wrangler deploy
```

`NANSEN_DAILY_CREDIT_CAP` and `NANSEN_CREDIT_FLOOR` in `wrangler.toml` bound the spend; how that cap actually holds under concurrent requests is in [`docs/architecture.md`](docs/architecture.md).

## The API

| Route | What it does |
|---|---|
| `POST /api/check?address=0x...` | Runs a check. Optional `&coin=ETH&side=short` asks about one position rather than the largest. This is the only route that spends anything, and it is a POST from this site for that reason |
| `GET /api/check?address=0x...` | An answer that already exists, or 404. Spends nothing, so a crawler or a prefetch cannot |
| `GET /api/snapshot?id=...` | One saved reading, exactly as it was read, with the rule behind its verdict in words (`rule`) and whether it is a gallery card or a saved reading (`kind`). A reading saved in the last minute can briefly answer 404 in a region KV has not reached yet; that 404 is never cached |
| `GET /api/compare?a=...&b=...` | Two readings of one address, side by side: what moved, and whether the answer moved with the data or with the rules. Reads stored readings only |
| `GET /api/gallery` | The dated scan and the four demonstration readings, one short row per card; a card itself opens through `/api/snapshot` |
| `GET /api/og?id=...` | That reading's social-preview picture (PNG), or a standing picture, briefly cached, while its own has not been drawn. Never draws on the request itself: that is what a crawler sends, and the render does not fit the free plan's CPU budget |
| `POST /api/og?id=...` | Draws that picture and keeps it. Sent by this site's own page once a reading is saved and when its Share button is opened, so the picture exists before any crawler asks for it |
| `POST /api/demo-access` | Whether the operator key in the `x-demo-key` header reaches the demo reserve: 204 or 403, nothing else, and it spends nothing. The page's `/#operator` uses it to check a key before a recording |
| `GET /api/ledger` | Nansen calls made, attempted against answered, credits quoted against credits assumed |

## Scripts

| Script | What it does |
|---|---|
| `scripts/prescan.ts` | Builds the gallery with the Worker's own `checkAddress`; stops at a credit reserve; resumable. Run over a few named addresses into `data/featured.json`, it makes the demonstration readings |
| `scripts/ledger.ts` | Sums `data/nansen-calls.jsonl` into `data/ledger.json`, served at `/api/ledger` |
| `scripts/reexplain.ts` | Re-judges and re-explains the gallery cards whose stored observation carries what the current rules read, and marks the rest as history. No network: a rules fix never needs the credits the scan cost |
| `scripts/fetch-fixtures.ts`, `scripts/fetch-nansen-fixtures.ts` | Capture real API responses for the tests (labels redacted) |
| `scripts/prerender-og.ts` | Renders every gallery card's and demonstration reading's social-preview picture offline and uploads it to KV, so a shared link to one of them has its own picture from the start (see [`docs/architecture.md`](docs/architecture.md)) |

## Nansen API usage

**1,136 calls between 14 and 27 September, 1,128 answered 2xx** ([full breakdown by endpoint and purpose, and what each of the eight failed calls taught](docs/nansen-api-usage.md)). The deployed page adds its own calls from the budget Durable Object and serves the running total, endpoint by endpoint, at `/api/ledger`.

## Security

No logins, sessions, uploads, webhooks or SQL; the only user input is an address, a coin and a side; the Worker calls two fixed hosts; the key lives in a Worker secret and a git-ignored `.dev.vars`, absent from the whole history; `npm audit` reports 0 vulnerabilities. Starting a check spends money, so it is a POST from this site only; the page's script is a file of its own so its CSP forbids inline script outright. Full checklist and what the 21 September audit changed: [`docs/architecture.md`](docs/architecture.md).

## Stack

Cloudflare Workers, Workers KV and two Durable Objects (the spend cap with its call ledger, and the rate limiter - both need an atomic read-modify-write that KV cannot promise), TypeScript, Vitest (562 tests on recorded real responses, including the Worker's own routes driven through real Requests and the real image renderer with no mocks, plus 9 that run the built Worker inside workerd through Miniflare). No frontend framework: one HTML page, one script file and a canvas for the share card. Two runtime dependencies, both for the one thing this Worker cannot do without them: [`satori`](https://github.com/vercel/satori) lays out a reading's social-preview picture and [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) rasterizes it to PNG - see [`docs/architecture.md`](docs/architecture.md) for why that render never runs on a crawler's request.

## Further reading

- [`docs/rules-in-depth.md`](docs/rules-in-depth.md) - what each verdict rule refuses to conclude, asset identity, and the calibration run
- [`docs/gallery-scan.md`](docs/gallery-scan.md) - how the 277-account scan was built and what moved when the rules changed
- [`docs/case-review.md`](docs/case-review.md) - seventeen readings read by hand: what each one observes, interprets, or declines to say
- [`docs/nansen-api-usage.md`](docs/nansen-api-usage.md) - every Nansen call accounted for, including the eight that failed
- [`docs/architecture.md`](docs/architecture.md) - the credit-reservation and rate-limiting design, the link-preview picture on the free plan, what the Worker counts, the runtime tests, and the security checklist
- [`docs/wiki/calibration.md`](docs/wiki/calibration.md) - the original three-account smoke test (superseded; kept as a record)
- [`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md) - the original design spec (historical; routes and timings in it predate later audits)
- [`docs/audits/`](docs/audits/) - the 19, 21, 22 and 23 September audits, each with an offline reproduction of the defects it found
