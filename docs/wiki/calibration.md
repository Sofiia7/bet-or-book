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
