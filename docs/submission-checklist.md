# Nansen Meridian Buildathon - what the submission needs

Deadline **27 September 2026, 23:59 UTC** (01:59 on the 28th in Budapest), per the
[official FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27).
This file is the checklist, not a claim that everything on it is done: each line
says what is required, what is true right now, and what is left.

| Requirement | Where it stands |
|---|---|
| 100+ Nansen API calls inside 14-27 September (lowered from 1,000 by a Nansen email on 23 September) | **1,133 calls, 1,125 answered 2xx** - already well past either threshold. Counted locally in [`data/ledger.json`](../data/ledger.json) plus the deployed Worker's own, served at `/api/ledger`. Local arithmetic is not an independent confirmation - the figure on Nansen's account side is the one that counts, and it is worth checking there before submitting |
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
  funding links for the one finding that changes the answer most often - the third
  of the four readings at the top of the page, a $209M ETH short whose matching
  $443M of ETH sits with two wallets that funded it. Since the
  audit the card also says *which* source produced each number, which turned out to
  matter: all seven hedges in the scan came from Hyperliquid's own spot balances,
  and used to be signed "Nansen" because Nansen had been asked.
- **Functionality.** 489 tests on recorded real responses, including the Worker's own
  routes driven through real Requests, plus 9 that run the Worker as Wrangler builds it
  inside workerd through Miniflare (`npm run test:runtime`, also in CI): the spend cap
  under concurrent checks, a Durable Object restarting, a reader disconnecting mid-check,
  KV failing and KV lagging. Cloudflare's own Vitest integration would have meant
  downgrading Vitest; Miniflare, which it is built on, did not. Still not proven here:
  behaviour across real regions and the platform's CPU limit, which only a deploy shows.
- **Originality.** The narrow question - is this headline position a bet, a hedge or
  inventory - and the refusal to answer it past the evidence. The diagram is the part
  a judge sees in three seconds.
- **Documentation.** The README says what the scan supports and what it does not,
  including the counts that are zero. Four audits are in [`docs/audits`](audits),
  with the defects they found reproduced offline and the fixes verified the same way.

## Before submitting

- Re-read the card for the demo address live, and watch the timestamp on screen.
- Confirm the call count on Nansen's account side, not only in `/api/ledger`.
- Deploy, then open the deployed page in a private window: the script is versioned by
  content, so a stale one should be impossible, but look once.
- `npm test`, `npm run test:runtime`, `npm run typecheck`, and `npx wrangler deploy --dry-run` all green.
- After every deploy that changes the picture's layout, pre-render and upload the bundled
  cards' link pictures (`node --import tsx scripts/prerender-og.ts --upload`). Pictures
  are kept under the layout's own key (`og:v3:<id>` since 24 September), so anything
  uploaded under an older one is simply unused, and the four demonstration readings are
  included.
  Until this runs, a shared link to a bundled card shows the standing picture until
  someone opens that card's Share button; the Worker no longer draws on a crawler's
  own request, because on the free plan's CPU budget that request could fail outright
  (`docs/architecture.md`).
- In Workers Logs, run one query from `docs/architecture.md` ("What the Worker counts")
  after the deploy, to see the check events arriving before relying on them.
- The Book beat is settled: the fourth reading at the top of the page is a fresh
  **Book (likely)** under the current rules, free to open on camera (`demo-script.md`).
- Before recording, open the live site at `/#operator` and paste `DEMO_KEY` from
  `.dev.vars` (set on the Worker on 24 September). The page says whether the server
  accepted it; from then on that browser's checks can use the 40-credit demo reserve
  and skip the public rate limits. Nothing about it shows on screen afterwards.
- By hand, and nobody else can do these: give five people who have not read the README
  thirty seconds with a card and ask them whether it is a buy or sell signal, where the
  cover was found, who owns the linked assets and how old the numbers are; then the
  recording, the X post and the form. The case review the audit asked for is in
  [`case-review.md`](case-review.md) - a read-through of stored readings, not an
  independent validation.
