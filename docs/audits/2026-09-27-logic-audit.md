# Logic check before submission, 27 September 2026

Checked: the observe → interpret → present path, the choice of position, the Bet / Hedged / Book rules, incomplete answers from the sources, and the re-interpretation of stored results. That the site is up says nothing by itself about whether these rules are right.

## Defects reproduced, and the v6 fixes

1. **Portfolio balance was taken as proof that the selected position is hedged.** Test case: a $10M BTC long, a $10M BTC short and a selected $1M ETH short. The old code read Hedged because 95% of the whole portfolio cancelled out. Opposing perpetual legs now give Unknown: the combined exposure of those positions together with spot is not modelled. In particular, 100% spot coverage on its own no longer proves neutrality while an opposing perp position exists. This is a check on admissible inputs, not a claim that such a portfolio was found in production.
2. **A failed funder search turned into zero coverage.** With the account's own holdings read in full and the balance read of a discovered funder failing, the result was Looks like a bet. `linkedHedgeCoverage` now reaches both Bet rules. Partial or missing gives Unknown. A funder's material holdings are still never counted as the account's own hedge.
3. **A known liability stayed a footnote.** A negative spot balance in the selected position's asset could sit next to a confident Bet, or a spot-only Hedged. Observation schema 6 now records `hasUnresolvedLiability`, and that case gives Unknown. A debt in another asset remains context. A damaged spot-balance row also blocks Bet for a long: it could have hidden a liability.
4. **An unverified HIP-3 asset was taken as the absence of matching spot.** For `xyz:ETH` the registry does not establish a correspondence with ETH/WETH. Without a confirmed identity for the underlying, the answer is now Unknown. Two-sided quotes observed in that market itself can still give Book: that is a separate fact about activity.

Each defect was first reproduced by one of five failing checks, then fixed. The new tests also cover both Bet paths, incomplete data, a known debt at different coverage ratios, Book staying Book, and ordinary hedges still reading correctly.

## Consistency of results

- Rules are at v6; new observations use schema 6. The cache key includes the rules version.
- The diagram marks unresolved exposure; such a ratio does not enter the least-covered ranking as a full measurement.
- The four examples from 26 September were re-interpreted without API calls. Their verdicts and public links are unchanged. `snapshotClassifierVersion` keeps the version the original ID was produced under.
- All 277 open positions of the earlier scan are kept as history: the scan did not record the liability and funder-search-completeness evidence v6 requires. Their original conclusions are not rewritten. The current rankings carry the four newer examples; the archive is reachable from Explore.
- Explanations, the README and the social pictures are updated with the rules. Older results are never presented as a fresh check of an address.

## Checks run

- TypeScript: the application and the scripts.
- 631 unit and integration tests, including 14 new checks and extra assertions in existing scenarios.
- 9 tests of the built Worker inside workerd: concurrent budget, a Durable Object restart, a client disconnecting, KV failures and delays.
- A Wrangler dry run and a diff check.
- In the browser: the four examples, Ranked boards, All readings and the archive; no JavaScript errors found.

## Limits of this conclusion

The tests check the rules and their consistency with the data, not the accuracy of classifying what real traders intend. There is no independently labelled sample. Book is an observation of two-sided activity, not proof that no directional bet exists. Coverage compares USD value and does not fully model debt obligations, collateral and liquidation, the delta of derivative tokens, or exposure carried across venues. External exchanges, OTC and unlinked addresses remain invisible. The asset registry is short; proper HIP-3 support needs a verified map of underlying assets.

Nothing in this check supports claiming "there are guaranteed to be no bugs" or "the wallet's real strategy has been identified exactly".
