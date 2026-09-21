# Demo - about 55 seconds, no voice

The recording for the X post (tag @nansen_ai). The page's own sentences carry the story, so no captions or narration are needed.

The story changed on 21 September, and it is a better one. The old script showed the $184M ETH short as **Hedged (probable)**, "220% covered by ETH held in 2 wallets that funded this account". That reading was wrong: a funding transfer shows where money came from, not who holds it now, and two of the four accounts the old rule called hedged had been funded by an exchange. So the demo no longer shows a tool agreeing with the timeline. It shows a tool refusing to.

**Before recording.** The live site in Chrome or Edge, window maximized, page zoom 125%, notifications off. Reload the page (F5) and copy the address `0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36` before pressing record.

No rehearsal run to warm the cache. A cached answer replayed as a fresh request is the one thing a demo must not do, and the card carries its own timestamp, so it would show. Check once, for real, on camera.

> **Credits.** On 21 September the Nansen account answered with **8 credits left**. This check costs up to 7. There is room for exactly one live run, so either top the account up first or record the live check first and everything else after. If the budget refuses, the card says "today's Nansen credits are used up" and the run is wasted, not broken.

| Time | Action | What the viewer reads |
|---|---|---|
| 0-4 s | Nothing, page at the top | "Bet or book. Should you copy this whale?" |
| 4-7 s | Click the address field, paste, click **Check** | "Checking...", then the card |
| 7-18 s | Hold still | **Unknown**: "Less than 1% of the $184.0M ETH short is covered by ETH in this account. 2 wallets that funded it hold $405.3M of ETH, but funding does not establish ownership, so it is not counted as a hedge." |
| 18-24 s | Scroll to the evidence rows, hold | "Hedge found 0.0% (all chains)" next to "Linked wallets $405.3M ETH in 2 wallets, owner unconfirmed", both sourced to Nansen |
| 24-29 s | Scroll on to the gallery, hold | "One scan of big Hyperliquid positions: bet, hedge or book?" and the counts |
| 29-36 s | Click the **Hedged** chip, click the $6.0M HYPE row (`0x8c830d21...`) | **Hedged**: "The $6.0M HYPE short is 100% covered by spot HYPE held by the same account across chains." |
| 36-45 s | Back to the gallery, open `0x37b81ab9...` ($25.1M HYPE short) | **Unknown**: "more than covered: $30.9M of spot HYPE ... leaves it net long $5.8M of HYPE" |
| 45-52 s | Click **Copy card** | the button says "Copied" |
| 52-55 s | Stop recording | |

Three readings of the same shape of position, in order: the assets are somewhere else and nobody can prove whose they are; the assets are right here and they match; there are more assets than the short, so the account is long. That contrast is the product, and every number on screen comes from a Nansen read the card names.

The first check is live; the two gallery cards are labeled "Snapshot from the gallery scan" on screen.

Post text (261 of 280 characters - X counts each link as 23 whatever its length):

> A whale is short $184M of ETH. The timeline calls it hedged.
>
> Bet or Book: under 1% is covered inside that account. Two wallets that funded it hold $405M of ETH - but funding is not ownership.
>
> Built on @nansen_ai
> https://bet-or-book.sofiaseremeteva.workers.dev
> https://github.com/Sofiia7/bet-or-book

The GitHub link is required by the buildathon FAQ and was missing from the previous draft.

## Check these before recording

- Every number above comes from the gallery snapshot of 18 September and one card re-checked on 21 September. The live check will show today's figures, which will differ. Read the card on screen; do not read this file.
- The gallery counts in the subtitle are computed in the page from the data, so they update themselves. As of 21 September: 137 of 277 look like bets, 12 books, 7 hedged.
- `0x8c830d21...` and `0x37b81ab9...` are snapshot cards from 18 September. If either has changed shape since, pick the next row with the same verdict rather than explaining the difference on camera.
