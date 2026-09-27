# Decision for the Nansen Meridian submission

20 September 2026. Goal: choose the direction with the best justified prospect of winning, taking into account past prize-winning entries, the current criteria and the remaining week. This document replaces the ranking of ideas in the previous research notes.

## Selection

**Bring Bet or Book to automatic selection and evidence-based breakdown of large positions with a saved history of changes.** This is a substantive extension of the existing product. I do not consider the current version, with its known bugs and static gallery, a convincing bid for first place. Moving to execution of conditional orders within a week increases the amount of untested work, while its advantage in originality has not been established.

My assessment is relative: the new version of Bet or Book is preferable to the alternatives considered under the conditions of this task. There is no data on the full set of current participants or the judges' scores; a numerical probability of winning is not calculated.

## Grounds from past results

The previous campaign was the Nansen CLI Mac Mini Challenge in spring 2026; that is a different competition. The official catalog describes all included entries, not only the winners. The placings below were checked against available copies of Nansen's announcements; the direct X posts are only partially accessible.

| Entry | Placing per available announcement | What to adapt |
|---|---|---|
| HeavyOT, analysis of hidden addresses for Polymarket | W1, first | Show meaningful context absent from the initial presentation of a position |
| 0xTakeProfits, non-dollar stablecoins | W1, second | A narrow question and a specific audience can compete with universal systems |
| rien_nft, Alpha Radar | W2, first | Automatically select cases through several checks, deliver a finished result |
| kamalbuilds, Hunt Alpha | W4, first | Link the stages of research and make the provenance of the result visible |
| Magicianafk, Oracle Box | W4, third | A memorable form of interaction helps show a working product |

These are observed properties of the prize-winning entries, not published explanations of the judges' voting. Sources for the placings: [W1, copy on OKX](https://web3.okx.com/zh-hans/discover/kol/850846084531503627), [W2, copy of Nansen's post](https://ww.twstalker.com/3844nori), [W4, copy of Nansen's post](https://www.sotwe.com/dr_rice1). Descriptions: [Nansen catalog](https://academy.nansen.ai/en/help/articles/6399546-nansen-cli-builds), [Hunt Alpha repository](https://github.com/kamalbuilds/nansen-hunt-alpha). The Oracle Box and AION repositories returned 404 on re-checking; their code is not evaluated here.

The presence of a simple dashboard among the prize winners means that rejecting any idea with a dashboard was wrong. The presence of complex systems among the first places means that one nice card is not enough to consider our entry the favorite. For Meridian, four equal criteria are set explicitly: data, originality, a working product, documentation/demo. [Campaign](https://nansen.ai/campaigns/meridian-buildathon), [FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).

## The specific product to submit

Promise: **check what actually follows from a high-profile whale position, and show what changed after the check.**

1. **An up-to-date selection of cases.** From a limited and explicitly described set of large Hyperliquid positions, the system selects cases where additional context substantially changes the interpretation. The ranking takes into account the size and reliability of the observations; the unknown is not turned into an "exposé". Start with a limited list and an update budget; do not promise the whole market in real time.
2. **Breakdown of one case.** The original position → additional positions and assets → the calculated exposure to the corresponding asset → signs of trading activity → the outcome and the boundaries of coverage. The screen shows which Nansen observation affected the calculation.
3. **Saved snapshot and update.** The link opens exactly the previously saved breakdown. "Check now" creates a new snapshot and shows the observed changes in size, direction, coverage and data completeness. The absence of a position counts as a close only when the current source is sufficiently complete.

The first two items develop the already existing prescan, gallery and check. The third turns a one-off card into a tracked case. The demo needs consecutive saved observations with timestamps, without substituting today's values for historical ones.

## Mandatory fixes

- Do not count the First Funder's assets as the checked address's own hedge. Funding by itself does not prove ownership.
- Calculate coverage on identical/reasonably comparable assets; do not reduce opposite-direction positions in different tokens to neutrality by a simple USD sum.
- Separate partial coverage, coverage around the position size and exceeding the position size. Do not call all three an absence of risk.
- Check signs of quoting/trading by the corresponding market and volume. Observed activity does not prove the owner's profession or intentions.
- Preserve the incompleteness and freshness of the data; do not infer a directional bet from a failed search for a hedge.
- Fix the non-atomic spend limit, the continuation of paid calls after failures, the interface race conditions and the immutability of links.

## Material for verification already exists

In `data/gallery.json`, six addresses were found where the saved normalized model shows a ratio of own corresponding assets to the short of 0.98 to 1.02. The data relates to 18 September and does not yet confirm today's state or the correctness of the asset identification.

Example candidate: `0x8c830d21e41ad688dbf1727ae4425573849daf41`, a saved HYPE short of about $6,032,406 and corresponding assets of about $6,032,087, check time 18 September 14:45:22 UTC. This is a starting point for checking the source balances, contracts, prices, debt and timing, not ready-made proof of a neutral strategy.

Thus, the main demo case does not have to rely on the disputed story about the $184M short and the assets of the funding addresses from the current demo-script. The video script must rely on the corrected model and verified observations.

## Time and priority estimate

| Dates | Result |
|---|---|
| Remainder of 20-21 September | Corrected critical calculations and limits; checking candidates for the demo |
| 22-23 September | Breakdown with visible Nansen influence; saved snapshots and comparison |
| 24 September | Limited automatic updating of the selection; start of accumulating new observations |
| 25 September | Checking the comprehensibility and correctness of several real cases; final README structure |
| 26 September | Rehearsal of launching from a clean clone, mobile check, a 30-60 second recording |
| 27 September | Reserve for fixes and submission before 23:59 UTC |

This is a planning estimate, not the result of measuring future development. If the fixes take longer, the breadth of the selection and the update frequency are cut first. The reliability of the examples and the time for verification/demo are preserved.

## Competition demo

0-5 seconds: a large position and a clear question about its interpretation. 5-25: the check; specific Nansen context appearing; recalculation of the visible exposure. 25-40: a second example with a different result. 40-50: a saved case and the change on a new observation. 50-60: a card for publishing, the accessible site and the repository.

The numbers and changes must be real and dated. A reversal of the conclusion on every address must not be promised. One demo case must show a meaningful influence of Nansen data on the result after the model bugs are fixed.

## What is established by this decision

The choice is a substantially strengthened Bet or Book. New trading bots, ONE RULE, games and universal terminals are excluded from the scope before this submission. The research concludes with a specific direction of work. The application, the external site and publications are not changed by this document.
