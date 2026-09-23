# Nansen API usage, in full

The [README](../README.md) has the total. This is every call accounted for, including the seven that did not return data and what each one taught.

Every scripted call is logged in [`data/nansen-calls.jsonl`](../data/nansen-calls.jsonl) and summed in [`data/ledger.json`](../data/ledger.json); the deployed page adds its own calls from the budget Durable Object and serves the total at `/api/ledger`. Requests attempted, requests answered, credits the API itself priced and credits assumed for a call it did not price are four separate numbers, because a total that mixes a quoted figure with an assumed one is not a measurement.

Between 14 and 27 September: **1,117 calls, 1,109 of them answered 2xx.** The gallery scan of 18 September accounts for most of it; 26 more went to re-checking nine cards on 21 September after the rules first changed, and 83 to re-reading the 22 cards that had claimed Book or Hedged, once the audit of 21 September showed their stored observations could not support those claims.

Seven of those calls did not return data, and each one taught something:

- One 403, on the very first call made with a freshly issued key, while the same response reported 1,100 credits available. Later calls to that endpoint succeeded; **why the first one did not is not established** - a key still propagating and a transient permission look the same from here, and an earlier version of this file asserted the first. What the episode settled is narrower and does not depend on the cause: the breaker could not tell a refusal about an endpoint from an empty account, and it can now, because a refusal counts as exhaustion only when it reports no credits left.
- Two that never answered at all, a local network drop. They are recorded with status 0, attempted and outcome unknown, and charged as spent, because Nansen may have served them. Silence is the one thing that must not be recorded as nothing having happened.
- Three 502s and one 500 during the original scan. The 502s cost three cards their Nansen positions, and those cards say they read Hyperliquid's main dex instead; one of the three has since been re-checked, which leaves two. The 500 cost one card its realized PnL.

The live count restarts from the deploy that moved it out of KV (21 September). The Worker's own calls before that - about a dozen, from `wrangler dev` and the smoke tests - are in the scripted ledger already and are not double-counted here; nothing is lost, but the two halves of the total come from different places and the boundary is a deploy, not a date.

The ledger counts calls made. It is a record, not the spend cap: what a check is allowed to spend is decided before it runs (see [`docs/architecture.md`](architecture.md)), and an answered call's own cost header is what settles it. The local count is this Worker's own arithmetic and is not an independent confirmation; the figure Nansen's account side reports is the one that counts.

| Endpoint | Calls |
|---|---|
| `profiler/perp-positions` | 341 |
| `profiler/perp-pnl-summary` | 341 |
| `profiler/address/current-balance` | 255 |
| `profiler/address/related-wallets` | 179 |
| `profiler/perp-trades` | 1 |

| Purpose | Calls |
|---|---|
| Gallery scan (`scripts/prescan.ts`), including a first run of 66 calls discarded after the book-rule fix | 964 |
| Local development checks through `wrangler dev` | 21 |
| Fixture captures for the tests | 12 |
| Live smoke test of the three calibration accounts | 11 |
| Re-checking nine gallery cards after the rules changed (21 September) | 26 |
| Re-reading the 22 cards that had claimed Book or Hedged, after the 21 September audit | 83 |

`profiler/perp-trades` was tried once and dropped: it aggregates partial fills into one trade, and a thousand records covered sixteen minutes of the busiest account.
