# Bet or Book

**Paste a Hyperliquid address. See what actually stands behind that whale position - a bet, a hedge, or a market maker's book.**

**Live: [bet-or-book.trade](https://bet-or-book.trade)**

Hyperliquid position intelligence: reads HyperCore positions, spot balances, orders and fills, with [Nansen API](https://app.nansen.ai/r/36RkYL4jJsy) for cross-dex positions, cross-chain holdings and funding links. Built on Cloudflare Workers, Durable Objects and KV.

Development began on 17 September 2026. The project was previously submitted to the Nansen Meridian Buildathon (14-27 September); it was not a winner or honourable mention and was listed among Nansen's Examples of API Builds. The dated readings and historical audits preserve that work.

## Why

Every week a post goes viral: "a whale just opened a $190M short". People copy it. Often the position is not what the headline makes of it:

- The account behind one of those posts is a **market-making book**: 134 open positions, 2,730 resting orders quoting both sides of 123 markets - including its own $52.0M ETH short, $41.6M of that quoting genuinely matched in ETH itself, not just activity somewhere else in the account. That is a business, not a view on price (read on 26 September, after the fix in [L01](docs/audits/2026-09-23-full-audit.md) made "quoted elsewhere" stop counting as evidence about this position).
- Another was reported as hundreds of millions in bearish shorts, and the first version of this tool agreed it was hedged. It is not that simple: **next to none of its $208.2M ETH short is covered by anything that address holds**, and $395.8M of matching ETH sits in two wallets that funded it. A funding transfer is not ownership, one such funder turned out to be an exchange, and part of that ETH is an Aave deposit with an invisible loan against it.
- And sometimes it really is a bet: **one $126.4M HYPE long, the account's entire exposure, nothing offsetting it**.

All three are among the four readings at the top of the page, each dated 26 September and each opening for free.

Bet or Book answers one question per address, shows the numbers that decided it, and says what it could not read.

## What a check returns

- **A verdict**: Book, Spot-covered short, Looks like a bet, or Unknown, with a strength where it applies (`likely` / `strong` counts corroborating Book signals, not a probability). The API retains `hedged`. An Unknown names its kind on the badge itself, e.g. *Unknown · assets sit with funders*.
- **One sentence built from the numbers**, e.g. *"The $42.0M HYPE short is 99% covered by $41.6M of spot HYPE held by this address on Hyperliquid - other Nansen-supported chains were checked and found nothing."*
- **A picture of what stands against the position**: a constellation diagram, the position drawn on the left and what this address holds against it on the right, with the share it covers as the one number in the middle. A short that is covered fills the right side; one that is not leaves it nearly empty. A holdings read that did not finish is flagged as incomplete next to the number rather than drawn as an absence. Anything held by a wallet that merely funded this one is drawn as a dashed ghost of a constellation, never as this account's own. That distinction is the whole card, and a row of percentages is a poor way to carry it. A long marks spot coverage as not applicable, since spot cannot offset one; a book shows how much of its own market it quotes on both sides, the number its verdict turns on. The share picture and the link preview draw the same constellation.
- **A choice of position.** A post says BTC and the largest position at the address is ETH. The card offers the largest five first and an asset search across all positions read; choosing a leg runs a new check.
- **What changed since the last reading**, where there is one - and whether the answer moved because the account did something or because the rules did. Those look identical on a card and are not the same event.
- **The number the verdict turned on**, first, where there is no picture to show it. The other evidence numbers, each tagged with the source that produced it (Nansen, Hyperliquid, or both), and a strip of vitals - leverage, distance to liquidation, unrealized PnL, funding since open - that never decide the verdict but are already paid for, are visible on the card.
- **How this was decided**, in words: the rule that fired, with the thresholds it used. The raw reason code and the rules version are underneath it, for anyone checking the rules themselves.
- **What Nansen added**, on one line without opening anything, and in full one click down: positions on every dex (beside the count Hyperliquid's own free main-dex endpoint shows), balances on every chain, funding links, funding history. Where the funding links are what stop a verdict, the card runs the same rules over the same numbers without them and says what those numbers would have read as - for the $208.2M ETH short above, "Looks like a bet".
- **What is still open**: the question the reading cannot settle, in its own terms - "whether any of that HYPE is owed to someone", "who controls the wallets that funded this account".
- **The funding wallets**, with explorer links, when they hold the matching asset. They hold it; that is not the same as this account holding it, and the card says so.
- **What could not be read**, every time: which sources were missing or cut short, how old the numbers are, and which rules read them.
- **What we cannot see**, always: centralized exchanges, OTC, wallets with no on-chain link. A hedge there is invisible, so a bet is only ever "looks like a bet".
- **Save and Share**: save a named position in this browser, reopen its dated reading free, or refresh it manually. Share offers the exact reading link, copyable evidence text, an X draft with date and limits, and a PNG card. The link carries a matching preview when pasted into X, Telegram or Discord.
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

`npm run test:runtime` then builds the Worker with Wrangler and runs a second set of tests against it inside workerd, Cloudflare's own runtime: the spend cap under concurrent checks, a Durable Object restarting, a reader disconnecting mid-check, KV failing and KV lagging. About twenty seconds.

Optional, for live Nansen reads: copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and put your key in it. Without one every check runs Hyperliquid-only and says so on the card. Missing cross-dex and cross-chain evidence usually means Unknown; Bet and Hedged require complete reads. Saved examples still open for free.

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

## What the Nansen data decides

| Nansen endpoint | What it drives |
|---|---|
| `profiler/perp-positions` | Every rule. Covers all Hyperliquid perp dexes, HIP-3 included: for the market maker above, 134 positions against 86 visible to Hyperliquid's free main-dex endpoint |
| `profiler/address/current-balance` (chain `all`) | The account's own hedge on any chain, for a headline short. Each row's contract decides what the asset is, and its completeness decides whether "no hedge found" may be said at all |
| `profiler/address/related-wallets` (Arbitrum, Ethereum) | The First Funder wallets, then their `current-balance`. This is reported as its own observation, never folded into the account's coverage: it can stop a verdict, not make one |
| `profiler/perp-pnl-summary` | 30-day realized PnL on the card. Context, not a rule: no verdict turns on it |

Hyperliquid's free API supplies resting orders (per dex, including HIP-3 markets the account has positions on), 24-hour fills and open interest.

## The four readings at the top, and the scan below them

The four example cards were refreshed on 7 October through the same `checkAddress` used for live checks, spending 21 Nansen credits. The current answers are a HYPE bet, a covered HYPE short, an ETH short whose matching assets sit with funders, and a busy ETH account without enough quoting evidence to establish inventory. The former Book example now reads Unknown; examples follow the evidence rather than preserving a desired set of badges. [`data/featured.json`](data/featured.json) keeps earlier IDs and comparisons. Opening a saved example is free. The card shows its verdict, evidence, position risks, comparison and missing sources; Full analysis contains rules and details. Share supports a link and downloadable PNG. A browser-local watchlist never runs a check automatically.

The earlier scan checked 277 open accounts selected from the top 3,000 by account value and ranked by their largest main-dex position. These remain historical: they predate evidence required by the current rules and keep their original verdicts. Explore boards include those readings with explicit rule-version labels; the archive remains separate in All readings. A fresh check produces a current reading. How the scan was built: [`docs/gallery-scan.md`](docs/gallery-scan.md). October fixes: [`docs/audits/2026-10-07-fixes.md`](docs/audits/2026-10-07-fixes.md).

## Honest limits

- A hedge on a centralized exchange, in OTC or in a wallet with no on-chain link is invisible. The card says so every time.
- Ownership through a funding link is not established by the link. A funder's holdings are reported as theirs and never counted as this account's hedge.
- Debts outside Hyperliquid are invisible. A negative Hyperliquid spot balance in the position's own asset now withholds the exposure verdict. Other loans are listed as context. Lending deposits elsewhere count as visible assets, but debts against them are not read, so visible coverage still does not establish net neutrality.
- Only the headline position's hedge is searched. A pair trade (long A against short B) is not modeled; net versus gross exposure and the same-asset offset share catch part of it.
- An on-chain token whose contract is not one this tool recognises is left out of the hedge rather than counted by its ticker. The registry is short, so a real holding can be missed; the card says how much was left out.
- Hyperliquid returns at most 2,000 fills per call; a busier account shows "2,000+", a lower bound. The card also says how many hours the fills actually span, which can be far less than the window asked for.
- Nansen address labels are never shown or stored. They are read in one place only, to decide whether a funding link leads to an exchange or bridge, and dropped there ([`src/sources/normalize.ts`](src/sources/normalize.ts)). In practice Nansen sends no label for most addresses, which the card reports as unverified rather than treating as "a private wallet". Test fixtures are saved with every label field set to null.
- The contract registry covers known assets on Ethereum, Arbitrum, HyperEVM and Solana, while the balance read asks for every chain. A matching holding on a chain outside it is reported as dollars of unknown identity, not as an absence, and enough of them withhold the verdict instead of producing a confident one.
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
| `POST /api/events` | Bounded anonymous usage enums for the product funnel, in Worker logs; no wallet, text, URL or user identifier. No provider calls or KV writes |
| `GET /api/ledger` | Nansen calls made, attempted against answered, credits quoted against credits assumed |

## Scripts

| Script | What it does |
|---|---|
| `scripts/prescan.ts` | Builds the gallery with the Worker's own `checkAddress`; stops at a credit reserve; resumable. Run over a few named addresses into `data/featured.json`, it makes the demonstration readings |
| `scripts/ledger.ts` | Sums `data/nansen-calls.jsonl` into `data/ledger.json`, served at `/api/ledger` |
| `npm run release:check` | Checks deployed saved examples, dates, API/widget and exact bundled PNGs with GET only; reports which launch requirements it cannot verify |
| `scripts/reexplain.ts` | Re-judges and re-explains the gallery cards whose stored observation carries what the current rules read, and marks the rest as history. No network: a rules fix never needs the credits the scan cost |
| `scripts/fetch-fixtures.ts`, `scripts/fetch-nansen-fixtures.ts` | Capture real API responses for the tests (labels redacted) |
| `scripts/prerender-og.ts` | Renders current demonstration previews offline and bundles them with the Worker; optional `--upload` writes KV, and `--all` rebuilds the archive, so a shared link to one of them has its own picture from the start (see [`docs/architecture.md`](docs/architecture.md)) |

## Nansen API usage

**1,155 calls between 14 and 27 September, 1,147 answered 2xx** ([full breakdown by endpoint and purpose, and what each of the eight failed calls taught](docs/nansen-api-usage.md)). `/api/ledger` preserves the September competition window, including deployed calls in that window; it is not a lifetime usage counter. Current checks emit metered telemetry and settle actual calls in the budget Durable Object.

## Security

No wallet connection, login, user uploads or outbound message delivery. Inputs include wallet/position selection, bounded assertions, usage events and monitoring capabilities; public publisher endpoints expose saved evidence. Monitoring uses an unguessable browser token and SQLite-backed Durable Object storage. Provider credentials stay in Worker secrets and git-ignored `.dev.vars`. Paid checks require same-site POST and atomic credit reservation. The main page forbids framing and inline scripts; the static widget permits embedding. The October 8 dependency audit reported zero known vulnerabilities; that is a dated audit result, not a continuing guarantee. See [`docs/architecture.md`](docs/architecture.md) and [`docs/publisher-pilot.md`](docs/publisher-pilot.md).

## Stack

Cloudflare Workers, Workers KV and three Durable Objects (the spend cap with its call ledger, the pilot watch coordinator, and the rate limiter - these need an atomic read-modify-write that KV cannot promise), TypeScript, Vitest (713 tests on recorded real responses, including the Worker's own routes driven through real Requests and the real image renderer with no mocks, plus 12 that run the built Worker inside workerd through Miniflare). No frontend framework: one HTML page, bundled script modules and a canvas for the share card. Two runtime dependencies, both for the one thing this Worker cannot do without them: [`satori`](https://github.com/vercel/satori) lays out a reading's social-preview picture and [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js) rasterizes it to PNG - see [`docs/architecture.md`](docs/architecture.md) for why that render never runs on a crawler's request.

## License

[MIT](LICENSE).

## Further reading

- [`docs/rules-in-depth.md`](docs/rules-in-depth.md) - what each verdict rule refuses to conclude, asset identity, and the calibration run
- [`docs/gallery-scan.md`](docs/gallery-scan.md) - how the 277-account scan was built and what moved when the rules changed
- [`docs/case-review.md`](docs/case-review.md) - seventeen readings read by hand: what each one observes, interprets, or declines to say
- [`docs/nansen-api-usage.md`](docs/nansen-api-usage.md) - every Nansen call accounted for, including the eight that failed
- [`docs/architecture.md`](docs/architecture.md) - the credit-reservation and rate-limiting design, the link-preview picture on the free plan, what the Worker counts, the runtime tests, and the security checklist
- [`docs/wiki/calibration.md`](docs/wiki/calibration.md) - the original three-account smoke test (superseded; kept as a record)
- [`docs/specs/2026-09-17-bet-or-book-design.md`](docs/specs/2026-09-17-bet-or-book-design.md) - the original design spec (historical; routes and timings in it predate later audits)
- [`docs/audits/`](docs/audits/) - the seven audits from 19 to 27 September; the 19, 21 and 23 September ones each come with an offline reproduction of the defects they found, and the 27 September one records the v6 rule changes
