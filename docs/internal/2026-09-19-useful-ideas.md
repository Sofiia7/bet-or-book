# Useful directions for Meridian: a new selection

**Revision on 20 September after user feedback.** ONE RULE is no longer recommended as the first candidate: the standalone analysis can be reproduced by an agent with the same tools, and the advantage of a ready-made product is insufficiently justified. STILL THE SAME depends on continuous observation of an address and does not handle a move to other wallets; the user considers this scenario insufficiently relevant. ALERT LAB differs from simple price notifications, but the standalone value of the difference is weak so far. The audience of the next search is ordinary crypto users and traders. The initial ranking below is preserved as a history of the discussion. New results: [execution of trading orders](2026-09-20-retail-actions.md).

Research date: 19 September 2026. This document replaces the previous CASEFILE recommendation from `2026-09-19-pivot-ideas.md`.

Request: propose a stronger competition product with obvious usefulness and logic that depends on Nansen. Keeping Bet or Book is not a constraint. These are proposals for development; working prototypes of these ideas, demand and the availability of the historical APIs for the user's key have not yet been checked. The application code has not been changed. The working names are provisional.

## Selection

The first one I would test is **ONE RULE**: find and test one specific change in the trading behavior of a wallet owner, then apply the chosen rule to subsequent prospective entries. The second option is **STILL THE SAME**, monitoring changes in the behavior of a tracked trader. The third is **ALERT LAB**, checking and tuning the usefulness of on-chain notifications before enabling them.

This is my product assessment, not an established ranking of participants. The competition has four equal criteria: data integration, originality, working functionality and documentation/submission. [Official page](https://nansen.ai/campaigns/meridian-buildathon).

## 1. ONE RULE - which one change is worth testing in my trading?

**User:** an active DEX trader with sufficient trade history on one supported chain.

**Task:** understand whether a repeated action is worth changing, and obtain a specific rule for further testing.

**Scenario:**

1. Enter an address and choose a period. The application reconstructs the trades and checks the completeness of the history.
2. Test a small predefined set of rules: for example, do not buy tokens younger than a day, or do not return to the same token within a day after closing a losing position.
3. Use the early part of the history to choose a candidate. Test the fixed candidate on the following period, which did not take part in the selection.
4. Show the model result, the skipped profitable and losing trades, the impact of costs and the cases that could not be reconstructed.
5. Save the rule. Before a prospective purchase, the user enters the token address and receives an answer on whether their rule is complied with, along with an explanation.

**Role of Nansen:** the history of swaps and transfers determines the trading episodes, the entry conditions, the test results and the current state of the rule. Changing the source transactions changes the outcome. Nansen provides DEX trade history with token addresses, times, volumes and additional fields; the historical APIs provide data as of a given date. [Address DEX Trades](https://docs.nansen.ai/api/profiler/address-dex-trades), [Backtesting Data](https://docs.nansen.ai/api/backtesting-data).

**Demo:** address → repeated action → result of testing the rule on the following period → saving the rule → checking a prospective entry. All on-screen numbers must come from a reproducible example, and the demo time skip must be explicitly marked.

**Why come back:** to check new entries and see whether the observed effect persists on new data.

**Analogues and the difference:** TraderSync offers rules, compliance checking and analytics; TradeZella offers automatic backtesting of user-described strategies. Their existence confirms the existence of the category, but not demand for our variant. The proposed difference is a short path from a public wallet to one testable constraint and its subsequent application. The precise absence of such a feature at all competitors has not been established. [TraderSync](https://tradersync.com/support/what-the-strategy-tester/), [TradeZella](https://www.tradezella.com/backtesting).

**Boundaries of correctness:**

- First version: one chain, spot swaps, a small set of supported pairs and rules. A full simulator of all DeFi positions is not part of the MVP.
- Starting balances, transfers, incomplete pagination and unknown cost basis must block the calculation of the corresponding episode or explicitly limit it. A gift/transfer must not be turned into a free purchase.
- The counterfactual model must maintain its own cash and token balance. After skipping a purchase, a sale of an absent asset must not be left in. Do not use the future outcome to decide on skipping an entry.
- Account for costs where they are confirmed; with unknown fees, show a range and the incompleteness of the calculation. The provider's USD estimate is not an exact execution quote for the alternative trade.
- It is not permissible to iterate over hundreds of parameters, pick a nice-looking curve and pass it off as a tested rule. Predefined candidates, chronological testing and a complete log of the selection are required.
- A positive result on history does not prove causation or future profit. A legitimate product outcome is "insufficient data" or "no candidate was confirmed".
- A prospective entry's compliance with the rule does not mean that the token is safe or that the purchase is profitable.

**What the first day must decide:** whether, on several wallets and without cherry-picking for a nice-looking result, a sufficient share of the history can be reconstructed and an explainable calculation obtained. If not, do not mask the gaps with a nice interface; narrow the supported scenario or move on to option 2.

## 2. STILL THE SAME - is the tracked trader still doing what I chose them for?

**User:** a person who follows several wallets and uses their actions as a source of trading ideas.

**Task:** notice that the previous basis for trust no longer matches the observed behavior.

**Scenario:** add a wallet → obtain a historical profile → confirm the attributes that matter to you → track changes → reconsider the source on a significant deviation. For example, long-held positions in more mature tokens used to predominate, and then frequent short entries into new tokens and a sharp increase in trade sizes appeared.

**Role of Nansen:** trades and reconstructed positions determine the baseline profile, the current deviations and the further routing of notifications. Count the trade size in USD and the share of available capital separately; the second metric is unavailable without sufficient balance history.

**Result:** an explainable "reconsider the source" event and management of its notifications. The user can choose in advance for the application to pause the regular alerts for that wallet on such an event until the review. Autonomous trading is not required for the MVP.

**Demo:** replaying the history of one address; the previous profile; a series of new operations; a change of status and of the list of delivered events. Do not pass off a change in behavior as proof that the trader has lost their skill or will soon lose money.

**Competition:** Strategy Drift Pro already compares the behavior of strategies and copied trades against a baseline profile in MT5. Our hypothesis is a similar workflow for public on-chain wallets and an individual choice of sources. This is a transfer and adaptation of a useful mechanic, not the invention of drift control itself. [Author's description](https://www.mql5.com/en/market/product/192883).

**Limitations:** a minimum sufficient sample; robust thresholds; separating capital top-ups from growth in risk; no inference of a common owner from the first funding or similar trades. Market conditions may explain the changes: the application shows the difference, not its unproven cause. A wallet's history does not reveal all of the owner's external positions.

## 3. ALERT LAB - test a notification before subscribing

**User:** a trader or analyst who follows tokens and wants to limit the stream of messages.

**Task:** check how many notifications a rule will generate, what exactly they mean and which condition reduces repetitions without losing the event chosen by the user.

**Scenario:** choose a token, a condition and a monitoring goal → replay the rule on history → see the calendar of triggers and misses → compare a small set of thresholds and waiting periods → enable the chosen configuration in the application.

**Example goal:** detect a sufficiently large distribution of a token by a chosen group of holders while receiving no more than a specified number of notifications. The word "useful" is defined by the user's goal. The subsequent price movement can be shown as context, but it does not turn any alert into a proven trading signal.

**Role of Nansen:** historical flows and cohort composition determine the triggers; new data determines the delivery of notifications after enabling. Historical testing requires group membership as of the corresponding date. Today's list of successful wallets must not be carried over to last year. [Historical data](https://docs.nansen.ai/api/backtesting-data).

**Demo:** a noisy event calendar → configuring rate limiting and merging of related triggers → visible misses after the filter → launching the chosen rule. The final result is a saved, executable monitoring configuration.

**Competition:** MOONBERG describes a rule builder, backtesting and merging of purchases by several wallets; SpotX describes signal ranking and deduplication. Therefore "smart alerts" by themselves are insufficient as a difference. The working hypothesis is transparent testing of notifications with an explicit cost of filtering in missed events. [MOONBERG](https://moonberg.net/), [SpotX](https://www.tryspotx.com/). The claims of these services were not verified by an audit of their implementation.

**Why third place:** strong dependence on Nansen, but a less noticeable difference and a harder explanation within a minute.

## General feasibility conditions

- The historical Nansen APIs are in Beta; the documentation states a price of 5× relative to the equivalent regular calls and allows for corrections to historical data. Availability and budget for the specific key have not yet been checked. [Documentation](https://docs.nansen.ai/api/backtesting-data).
- For reproducibility, save the calculation parameters, the time the data was obtained, the algorithm version and the source data that is permitted to be stored. Do not promise that a repeated request to the provider will always return an identical response.
- Before displaying data publicly, check the redistribution rules for the specific endpoints, especially the new historical ones. Do not publish arrays of proprietary labels or Smart Money lists by default. [Redistribution Guide](https://docs.nansen.ai/guides/redistribution-guide).
- Cap the cost before starting the calculation; account for pagination and repeated calls. Do not carry over the non-atomic limit counter from Bet or Book as protection for the paid API.
- The first interface must contain an input, a computed result, an explanation and an action. A general chat, many chains and complex rankings are not needed to test the chosen hypothesis.

## Proposed plan for ONE RULE

19-20 September: check the available fields, episode reconstruction, costs and one rule candidate. 21-23 September: implement the limited model, testing on the following period and reproducible examples. 24-25 September: assemble the user scenario and the prospective entry check; check comprehensibility with available users. 26-27 September: fixes, documentation, video and submission. This is a preliminary estimate of scope that depends on the data check in the first two days; no publication or messages to people are carried out by this document.
