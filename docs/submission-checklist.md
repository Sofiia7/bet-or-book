# Nansen Meridian Buildathon - what the submission needs

Deadline **27 September 2026, 23:59 UTC** (01:59 on the 28th in Budapest), per the
[official FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).
This file is the checklist, not a claim that everything on it is done: each line
says what is required, what is true right now, and what is left.

| Requirement | Where it stands |
|---|---|
| 1,000+ Nansen API calls inside 14-27 September | **1,117 calls, 1,109 answered 2xx.** Counted locally in [`data/ledger.json`](../data/ledger.json) plus the deployed Worker's own, served at `/api/ledger`. Local arithmetic is not an independent confirmation - the figure on Nansen's account side is the one that counts, and it is worth checking there before submitting |
| Public GitHub repository | https://github.com/Sofiia7/bet-or-book |
| X post tagging `@nansen_ai`, with the repository link | Draft text in [`demo-script.md`](demo-script.md). **Not posted yet** |
| 30-60 second recording of the working product on live Nansen data | Shot list in [`demo-script.md`](demo-script.md), about 58 seconds. **Not recorded yet** |
| The submission form | **Not submitted yet** |

## What the judges are told to weigh

The four criteria carry equal weight: data integration, originality, functionality,
and documentation and submission. Meaningful use of Nansen and a working, legible
demo are rewarded explicitly; complexity on its own is not.

Where this project stands against them, honestly:

- **Data integration.** Nansen decides things rather than decorating: perp positions
  across every HIP-3 dex (134 against the 86 Hyperliquid's free main-dex endpoint
  shows for one account), balances on every chain for the coverage question, and
  funding links for the one finding that changes the answer most often. Since the
  audit the card also says *which* source produced each number, which turned out to
  matter: all seven hedges in the scan came from Hyperliquid's own spot balances,
  and used to be signed "Nansen" because Nansen had been asked.
- **Functionality.** 339 tests on recorded real responses, including the Worker's own
  routes driven through real Requests. Not proven here: Cloudflare runtime behaviour
  (storage gates, eviction, request cancellation), which needs an integration runner
  this project cannot install without downgrading Vitest.
- **Originality.** The narrow question - is this headline position a bet, a hedge or
  inventory - and the refusal to answer it past the evidence. The diagram is the part
  a judge sees in three seconds.
- **Documentation.** The README says what the scan supports and what it does not,
  including the counts that are zero. Three audits are in [`docs/audits`](audits),
  with the defects they found reproduced offline and the fixes verified the same way.

## Before submitting

- Re-read the card for the demo address live, and watch the timestamp on screen.
- Confirm the call count on Nansen's account side, not only in `/api/ledger`.
- Deploy, then open the deployed page in a private window: the script is versioned by
  content, so a stale one should be impossible, but look once.
- `npm test`, `npm run typecheck`, and `npx wrangler deploy --dry-run` all green.
