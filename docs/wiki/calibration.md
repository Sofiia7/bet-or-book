# Bet or Book - calibration (Phase 1, Hyperliquid-only)

Date: 2026-09-17. All three checks run live against `http://127.0.0.1:8787/api/check`
(`npm run dev`), source `hyperliquid` (no Nansen key in Phase 1). Full raw
responses are in the run log below the table.

| Address | Expected shape | Source | Verdict | Strength | nPositions | netToGross | hedgeRatio | Reasons | Match? |
|---|---|---|---|---|---|---|---|---|---|
| `0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00` | book | [Wintermute Hyperliquid analysis, GitHub](https://github.com/0xLoris/wintermute-hyperliquid-analysis) - 1,732 resting orders across 76 markets, 51/49 bid/ask split | book | likely | 85 | 0.661 | 0.030 | orders | yes |
| `0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36` | hedged | [Arkham research: Abraxas-linked address shorting HYPE](https://info.arkm.com/research/abraxas-linked-address-shorting-hype) and [Bitcoin.com: Abraxas $32M ETH hedge against a $353M short](https://news.bitcoin.com/crypto-news/abraxas-capital-32m-eth-hedge-353m-hyperliquid-short/) - reported market-neutral short hedged by a separate spot ETH purchase | unknown | - | 14 | 1.000 | 0.000 | signals disagree | no, honestly |
| `0xbf732ea04197942783e34730ed6e0f6099575d58` | looks_like_a_bet | Not attributed to a named entity - James Wynn's own tracked wallet (`0xBC4761...` per [Phemex coverage of his liquidation](https://phemex.com/news/article/crypto-trader-james-wynn-faces-100m-liquidation-on-hyperliquid-71149)) is flat today (0 positions live-checked), so per the plan's fallback rule this address was found independently via the [Hyperdash leaderboard](https://hyperdash.com) and verified live: one 10x-leveraged long ZEC position (+$3.9M unrealized PnL) with a 30-order ask-only exit ladder on the same coin, no hedge, no two-sided quoting | looks_like_a_bet | - | 1 | 1.000 | 0.000 | directional_concentration | yes |

## Notes

**Wintermute - matched.** The position-spread signal alone did not fire this
time (`netToGross` 0.661 is above the 0.35 book threshold - inventory is not
always balanced even for a real market maker, it drifts with flow). The
order-book signal carried it instead: 1,626 resting orders, 50.2% bid share,
77 coins quoted on both sides, comfortably past every `book.orders`
threshold. This is exactly why the two book rules are independent
"any signal fires" checks rather than a single combined score - on this
account, only one of the two would have been enough on its own.

**Abraxas - did not match, and the reason is the one Phase 1 is honestly
scoped not to solve.** `hedge.hedgeUsd` came back `0` because this
Hyperliquid account's own spot balance holds no BTC/ETH/SOL (checked
directly: `UBTC` and `USDE` both show `0.0`, and there is no ETH spot line
at all). The reporting is explicit that the hedge is a *separate* spot
purchase, not a same-account spot balance - `news.bitcoin.com` describes ETH
bought on the spot market and Binance withdrawals funding the position,
not a Hyperliquid spot trade by this address. With `netToGross` at 1.0
(fully one-directional) and `nPositions` at 14 (inside the 2-19 balanced-book
window but nowhere near the required `netToGross <= 0.35`), no threshold in
`src/engine/verdict.ts` `DEFAULT_THRESHOLDS` is close to flipping this
result - the missing input is cross-account data (a spot or CEX leg on a
*different* wallet), which Hyperliquid's own API cannot see by definition.
This is spec risk 1 (`docs/specs/2026-09-17-bet-or-book-design.md` section
14) happening on a real, currently-live account, not a hypothetical: Phase 1
correctly refuses to guess and returns `unknown` rather than a wrong
`book` or `bet`. Fixing this is exactly what Phase 2's Nansen
`profiler/address/related-wallets` and `profiler/address/current-balance`
(`chain: "all"`) are for.

**ZEC account - matched, found independently.** James Wynn's own wallet from
the coverage of his liquidation is flat today - a useful reminder that
"the famous wallet" from a months-old story is not guaranteed to still show
the shape that made it famous, which is exactly why the plan's fallback
rule (verify live, substitute if needed) exists. The substitute found via
Hyperdash's leaderboard is a clean real example of the shape this verdict is
for: one leveraged position, no hedge, and an order list that is a
take-profit ladder (30 sell-side-only limit orders on the *same* coin as the
position, `coinsBothSides: 0`) rather than market-making - the
`orders.coinsBothSides === 0` guard in the bet rule is what correctly keeps
a profit-taking ladder from being misread as quoting.

## Raw responses

```json
// 0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00 (Wintermute)
{"address":"0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00","verdict":{"verdict":"book","strength":"likely","reasons":["orders"]},"positions":{"nPositions":85,"grossUsd":113681943.05306903,"netUsd":75190749.030565,"netToGross":0.6614132993439814,"headlineCoin":"ETH","headlineNotionalUsd":35680893.3081,"headlineShare":0.3138659698263904,"headlineLiqDistancePct":0.9883634020903072},"orders":{"restingOrders":1626,"bidShare":0.5018450184501845,"coinsBothSides":77},"hedge":{"hedgeUsd":1053127.7325687555,"hedgeRatio":0.029515172825835125},"sizeVsOi":0.014611242189024813,"source":"hyperliquid","checkedAt":"2026-09-17T16:40:18.318Z"}

// 0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36 (Abraxas-linked)
{"address":"0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36","verdict":{"verdict":"unknown","strength":null,"reasons":["signals disagree: not enough evidence for book, hedge, or bet"]},"positions":{"nPositions":14,"grossUsd":405216827.19736505,"netUsd":405216827.19736505,"netToGross":1,"headlineCoin":"ETH","headlineNotionalUsd":176761867.25589,"headlineShare":0.43621551572387274,"headlineLiqDistancePct":0.5336446985514176},"orders":{"restingOrders":1,"bidShare":1,"coinsBothSides":0},"hedge":{"hedgeUsd":0,"hedgeRatio":0},"sizeVsOi":0.0723718097847719,"source":"hyperliquid","checkedAt":"2026-09-17T16:40:20.020Z"}

// 0xbf732ea04197942783e34730ed6e0f6099575d58 (ZEC long, substitute for the bet role)
{"address":"0xbf732ea04197942783e34730ed6e0f6099575d58","verdict":{"verdict":"looks_like_a_bet","strength":null,"reasons":["directional_concentration"]},"positions":{"nPositions":1,"grossUsd":22069500,"netUsd":22069500,"netToGross":1,"headlineCoin":"ZEC","headlineNotionalUsd":22069500,"headlineShare":1,"headlineLiqDistancePct":0.15426401678357457},"orders":{"restingOrders":30,"bidShare":0,"coinsBothSides":0},"hedge":{"hedgeUsd":0,"hedgeRatio":0},"sizeVsOi":0.023414979911352135,"source":"hyperliquid","checkedAt":"2026-09-17T16:40:21.516Z"}
```

## 2026-09-17, after adding the trades signal

Same three addresses, same live endpoint, after wiring `computeTradeFeatures`
(book rule в: `tradesPerDay >= 200`, `crossedShare <= 40%`) via Hyperliquid's
free `userFillsByTime`, no Nansen involved. All three accounts moved in the
few hours between runs (open positions and order counts differ slightly from
the table above - expected for live accounts), but every verdict either held
or strengthened for a sound reason.

| Address | Verdict before | Verdict after | tradesPerDay | crossedShare | Changed? |
|---|---|---|---|---|---|
| Wintermute | book (likely, reason: orders) | **book (strong, reasons: orders + trades)** | 2000 (capped) | 24.4% | strengthened |
| Abraxas-linked | unknown | unknown | 2000 (capped) | 52.3% | unchanged, and for the right reason (below) |
| ZEC long | looks_like_a_bet | looks_like_a_bet | 1482 | 95.1% | unchanged, unaffected by design - the bet rule does not read trades |

**Wintermute strengthened as expected.** The trades signal agreed with the
orders signal instead of just the positions signal: 2000+ fills/day (hit the
API cap again, so this is a floor) with only 24.4% crossing the spread -
mostly passive quoting, the market-maker shape.

**Abraxas is the interesting one.** Trade volume came back surprisingly
high - 2000+ fills/day, capped again - which could easily have been
misread as more market-making evidence. It was not: 52.3% of those trades
crossed the spread, above the 40% ceiling, so the trades signal correctly
declined to fire. High volume alone is not the book signal; high volume
with *mostly passive* fills is. This account still reads as fourteen
concentrated, one-directional short positions with a trading style that
looks like active position management, not liquidity provision - and with
the hedge leg still invisible from Hyperliquid-only data (see the note
above), `unknown` remains the honest answer.

**ZEC long's 95.1% crossed share is itself informative**, even though the
bet rule does not use it: an account entering and exiting mostly by taking
the book, rather than resting orders, is a directional trader's footprint,
not a market maker's - consistent with the single-position, ask-only-ladder
shape already driving the `looks_like_a_bet` verdict.

```json
// 0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00 (Wintermute)
{"address":"0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00","verdict":{"verdict":"book","strength":"strong","reasons":["orders","trades"]},"positions":{"nPositions":85,"grossUsd":112935793.81381904,"netUsd":79407649.59254897,"netToGross":0.70312207415354,"headlineCoin":"ETH","headlineNotionalUsd":36411466.38591,"headlineShare":0.32240855760872705,"headlineLiqDistancePct":0.9610359282290284},"orders":{"restingOrders":1765,"bidShare":0.5042492917847026,"coinsBothSides":78},"hedge":{"hedgeUsd":1155089.626704574,"hedgeRatio":0.03172323834646645},"trades":{"tradesPerDay":2000,"crossedShare":0.244,"sampleSize":2000,"cappedByApiLimit":true},"sizeVsOi":0.014903103280504213,"source":"hyperliquid","checkedAt":"2026-09-17T17:25:36.068Z"}

// 0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36 (Abraxas-linked)
{"address":"0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36","verdict":{"verdict":"unknown","strength":null,"reasons":["signals disagree: not enough evidence for book, hedge, or bet"]},"positions":{"nPositions":14,"grossUsd":406956065.90041494,"netUsd":406956065.90041494,"netToGross":1,"headlineCoin":"ETH","headlineNotionalUsd":177537296.05737,"headlineShare":0.4362566648676387,"headlineLiqDistancePct":0.5251872882476846},"orders":{"restingOrders":0,"bidShare":0.5,"coinsBothSides":0},"hedge":{"hedgeUsd":0,"hedgeRatio":0},"trades":{"tradesPerDay":2000,"crossedShare":0.523,"sampleSize":2000,"cappedByApiLimit":true},"sizeVsOi":0.07267723420371408,"source":"hyperliquid","checkedAt":"2026-09-17T17:25:38.093Z"}

// 0xbf732ea04197942783e34730ed6e0f6099575d58 (ZEC long)
{"address":"0xbf732ea04197942783e34730ed6e0f6099575d58","verdict":{"verdict":"looks_like_a_bet","strength":null,"reasons":["directional_concentration"]},"positions":{"nPositions":1,"grossUsd":21553257.782596,"netUsd":21553257.782596,"netToGross":1,"headlineCoin":"ZEC","headlineNotionalUsd":21553257.782596,"headlineShare":1,"headlineLiqDistancePct":0.16979161887224903},"orders":{"restingOrders":28,"bidShare":0,"coinsBothSides":0},"hedge":{"hedgeUsd":0,"hedgeRatio":0},"trades":{"tradesPerDay":1482,"crossedShare":0.9507422402159245,"sampleSize":1482,"cappedByApiLimit":false},"sizeVsOi":0.02280365610511598,"source":"hyperliquid","checkedAt":"2026-09-17T17:25:39.235Z"}
```

## 2026-09-18, after Nansen

Same three addresses, one live check each through the Worker
(`wrangler dev`, key from `.dev.vars`), source `nansen` for all three,
`coverage` empty for all three. Spend read back from the Worker's own KV
ledger: 19 calls, 19 credits, last reported balance 974 (7 + 7 + 5: the
ZEC account's headline is a long, so its funders were not read - spot
cannot hedge a long).

| Address | Hyperliquid-only (17.09) | With Nansen (18.09) |
|---|---|---|
| Wintermute | book (strong), 85 positions | book (strong), **134 positions** (48 on HIP-3 dexes the default Hyperliquid call never reads), realized PnL 30d **-$13.6M** over 2.4M closed trades |
| Abraxas-linked | unknown, 14 positions, no hedge visible | **hedged (probable)**, 17 positions (3 on HIP-3, incl. a $26.4M `xyz:GOLD` short), ETH short $179.4M covered **222%** by its two First Funders |
| ZEC long | looks like a bet | looks like a bet, realized PnL 30d **+$7.7M**, win rate 59.8% |

**Abraxas, the case Phase 1 could not answer.** Its own address holds
no hedge on any chain (largest holding $3.3k). Nansen's related-wallets
names two First Funders, one per chain, and neither is labeled as an
exchange (labels checked internally, never stored or shown):

| Funder | Chain | ETH-like holdings | What |
|---|---|---|---|
| `0xb38e...891d` | Arbitrum | $31.4M | ETH |
| `0xed0c...4312` | Ethereum | $367.6M | weETH $136.3M, aEthWETH (Aave) $117.5M, wstETH $113.7M, rsETH, ETH |

About $399M of staked and wrapped ETH against a $179.4M ETH short is a
delta-neutral carry trade, not a bet on ETH falling - the opposite of
the "$980M of shorts, bearish signal" reading in the press (CryptoBriefing,
14.09). The verdict strength is `probable`, not plain `hedged`:
ownership through a funding link is inferred, not proven, and the card
has to say so. The BTC and SOL shorts ($138M together) have no hedge
visible on-chain.

**Wintermute's funders** were read too (2 credits: headline is a short,
own hedge 3.8%) and hold $913 of ETH between them - the book verdict
had already been decided by orders and trades, so those two calls
changed nothing. Worth skipping funder reads once a book signal fires;
noted for Phase 2b, not changed here.

**ZEC's PnL** makes the useful contrast for the card: the one account
here that is actually a directional bet is also the one with positive
realized PnL (+$7.7M in 30 days). "Looks like a bet" answers what the
position is; the PnL line answers whether copying the wallet would
have paid.
