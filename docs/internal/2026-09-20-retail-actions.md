# Product search for ordinary crypto users: 20 September

## User clarifications

- An ordinary agent with access to the data can perform the analysis from ONE RULE; a convincing advantage of a separate product has not yet been shown.
- Monitoring the behavior of one address breaks off when the address changes. The Smart Money label does not guarantee usefulness for the person following it.
- ALERT LAB is perceived as yet another notification service. CoinMarketCap does indeed offer price alerts and AI Alerts; whether it has identical historical testing of on-chain conditions has not been established. [CMC, description of features](https://coinmarketcap.com/academy/article/coinmarketcap-features-track-research-and-build-with-crypto-data).
- Search for ordinary crypto users and traders; products for teams and developers are not a priority.

## What was checked additionally

Protection of AI agent wallets is already offered by Coinbase, MetaMask, OnlyFence, Cabal and others. In particular, Cabal describes limits on liquidity, trade sizes and the signal stream. This makes a generic "seat belt for the agent" a weak claim of originality. [Coinbase](https://www.coinbase.com/developer-platform/products/agentic-wallets), [MetaMask](https://metamask.io/agent-wallet), [OnlyFence](https://github.com/seallabs/onlyfence), [Cabal](https://cabal.trading/docs/agentic-guardrails).

Verification of public predictions is also taken: OnlyKOLs, CallScore, SCHROD and Notch describe tracking of results or immutable records of predictions. Their claims have not been verified by an audit of the implementation. [OnlyKOLs](https://onlykols.io/), [CallScore](https://call-score.com/about), [SCHROD](https://schrod.io/), [Notch](https://www.notch.finance/).

The existence of an analogue does not prohibit participation in the competition. But merely renaming a known feature does not justify a strong competition entry.

## New candidate A: an order with cancellation conditions

**User situation:** a person placed a buy at a lower price, based on a certain picture of token ownership. While the order was waiting, the picture changed. The price reaches the entry level, but the original grounds no longer hold.

**Proposed product:** when creating a buy, save one or two precise on-chain conditions and the conditions for final cancellation. Nansen updates the observations; the application decides whether to keep waiting, cancel the order or allow execution. The price is responsible for the moment of purchase, the on-chain conditions for its admissibility within the user's order.

**Illustrative example, not investment advice:** the user chooses a price, an amount and a fixed group of addresses. If the total token balance on these addresses has decreased by more than a specified share, the order is cancelled. A transfer to a new address also reduces the observed balance: the application does not declare the transfer a sale and does not draw a conclusion about the owner's identity. The conditions must clearly explain such a conservative cancellation.

Another template based on aggregated flows is possible. Its meaning, measurement period and data availability need to be confirmed separately; a filter against all manipulation or a determination of the "real smartness" of holders must not be promised.

**Demo:** two orders with the same price; for one, the conditions continue to hold, for the other, the data triggers a cancellation. The feed explains each state and shows the source. The demo history is marked as a replay; an executed real order is confirmed by a transaction.

**Technical feasibility:** Nansen has a holders API and quote/prepare for swaps on Solana and Base. This is not a ready-made conditional order API: condition checking, cancellation, state storage and safe execution will need to be implemented. [Holders](https://docs.nansen.ai/api/token-god-mode/holders), [Quote](https://docs.nansen.ai/api/trade/spot-trading/quote).

**Critical boundaries:** data freshness; re-checking before signing; quote expiry; single execution; no automatic approval when data is unavailable; limited permissions of the executing service. The state may change between the check and execution - the Nansen API does not promise exact block-level protection. According to the current documentation, the premium labels of the holders API require a paid plan and cost 150 credits per call; they must not be enabled unnoticed.

**Competition:** Coinrule already provides combinations of conditions and execution, and Nansen CLI provides price limit orders on Solana. The proposed difference is a specific scenario of cancelling a stale trading order based on on-chain conditions with a clear explanation. The market check does not prove that this is the first such product. [Coinrule](https://help.coinrule.com/articles/497089-build-your-condition-block), [Nansen CLI](https://github.com/nansen-ai/nansen-cli).

**Assessment:** meets the "data drives the logic" requirement more strongly than the previous analytical options. Originality and demand have not yet been proven. First version: one chain, one type of buy, one or two condition templates, without a general AI builder.

## New candidate B: take a specified amount out of several tokens

**Order:** obtain a specified amount of USDC while keeping the assets listed by the user and not exceeding the cost limit.

**Logic:** Nansen provides the supported balances and quotes. The application chooses permissible sale volumes subject to the constraints and prepares execution. The difference between the portfolio valuation and the sale quote becomes visible before confirmation. The absence of a route is a separate result, not a zero price.

**Benefit:** the person does not need to manually work out which portions of several positions to sell to obtain the required amount.

**Limitations:** quotes for several trades are not a guarantee of the total proceeds; they may compete for the same liquidity. Re-evaluation after execution, handling of a partial result and explicit limits are needed. Limit the first version to spot tokens on one chain. Withdrawal into USDC does not mean withdrawal to a bank account.

**A close analogue was found:** Equicaelum describes choosing the required amount, a sale strategy and confirmation of execution; the site is in early access. Vexidus documents liquidate/cash out commands with asset exclusions. Therefore the scenario is useful, but is not chosen as a convincing competition favorite. [Equicaelum](https://equicaelum.finance/), [Vexidus](https://docs.vexidus.io/developers/intentvm-guide/).

## Status

This is research and a concretization of hypotheses. No new applications have been implemented, paid APIs have not been tested, no trading operations have been performed. The presence of execution by itself does not make an idea original. For a trading bot, the organizer requires a demonstration of real trades: a paper simulation must not be passed off as a completed trading bot. [Competition FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).
