# Demo - about 58 seconds, no voice

The recording for the X post (tag @nansen_ai). The page's own sentences carry the story, so no captions or narration are needed.

The story has changed twice, and it is better each time. The first script showed the big ETH short as **Hedged (probable)**, "220% covered by ETH held in 2 wallets that funded this account" - a reading that was wrong, because a funding transfer shows where money came from and not who holds it now. The 21 September audit changed it again: the tool now draws what it found rather than listing it, and it can put two readings of the same address side by side. So the demo is no longer a tool agreeing with a timeline. It is a tool showing you the shape of the position, and what moved in it since it was last looked at.

**Before recording.** The live site in Chrome or Edge, window maximized, page zoom 125%, notifications off. Reload the page (F5) and copy the address `0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36` before pressing record.

No rehearsal run to warm the cache. A cached answer replayed as a fresh request is the one thing a demo must not do, and the card carries its own timestamp and says "cached, N minutes old" when it is one, so it would show. Check once, for real, on camera.

> **Credits.** The account answered with **995 credits left** on 21 September, so there is room for as many takes as the recording needs. This check costs up to 7. The daily cap in the Worker is 300 - and 40 of it is a reserve the public path cannot reach, which is what keeps a busy afternoon from leaving the demo on Hyperliquid-only data.

| Time | Action | What the viewer reads |
|---|---|---|
| 0-4 s | Nothing, page at the top | "Bet or book. Should you copy this whale?" |
| 4-7 s | Click the address field, paste, click **Check** | "Checking...", then the card |
| 7-16 s | Hold on the diagram | One bar, the ETH short, **empty**. A dashed box outside it: **$464.7M**, "in 2 wallets that funded this account, ownership unverified, not counted" |
| 16-22 s | Hold on the sentence above it | "Less than 1% of the $216.7M ETH short is covered by ETH at this address. 2 wallets that funded it hold $464.7M of ETH, but funding does not establish ownership, so it is not counted as a hedge." |
| 22-28 s | Hold on **What changed since 18 Sept** | "position size: $184.0M → $216.7M", "held by wallets that funded it: $405.3M → $464.7M", and "The answer did not change" |
| 28-33 s | Scroll to the gallery, hold | "One scan of big Hyperliquid positions: bet, hedge or book?" and the counts, including **Earlier rules 94** |
| 33-41 s | Click the **Hedged** chip, open the $42.7M HYPE row (`0xf02d16a2...`) | **Hedged**, and the same bar **97% full**: "$41.3M (97%) covered by this address". Source line: **Hyperliquid** |
| 41-49 s | Back, click the **Book** chip, open `0xecb63caa...` | **Book (strong)**: "2,722 resting orders quote both sides of 120 markets" |
| 49-55 s | Click **Download card** and show the PNG | the same bar, the standing limit, the time, the link back |
| 55-58 s | Stop recording | |

Three positions of the same shape, in order: the assets are somewhere else and nobody can prove whose they are; the assets are right here and they match; and an account whose business is quoting, not holding a view. The bar is the same bar in all three, which is what makes the contrast land without a word of narration.

The first check is live. The gallery cards are labeled "Snapshot from the gallery scan" on screen, with the date they were read.

Post text (262 of 280 characters - X counts each link as 23 whatever its length):

> A whale is short $216M of ETH. The timeline calls it hedged.
>
> Bet or Book: under 1% is covered at that address. Two wallets that funded it hold $464M of ETH - but funding is not ownership.
>
> Built on @nansen_ai
> https://bet-or-book.sofiaseremeteva.workers.dev
> https://github.com/Sofiia7/bet-or-book

## Check these before recording

- Every number above comes from the readings of 21 September. The live check will show today's figures, which will differ. Read the card on screen; do not read this file.
- The gallery counts in the chips are computed in the page from the data, so they update themselves. As of 22 September: 183 cards judged by the current rules - 132 look like bets, 41 unknown, 3 books, 7 hedged - and 94 more kept as history because their observations predate those rules.
- The 22 cards that had claimed Book or Hedged were re-read live on 21 September. Each of those carries a **What changed** block against the reading it replaced; the other 256 do not, and that is why the demo opens on one that does.
- `0xf02d16a2...` and `0xecb63caa...` were read on 21 September. If either has changed shape since, pick the next row with the same verdict rather than explaining the difference on camera.
- The diagram only appears for a **short**: spot cannot offset a long, so there is nothing to draw. Every card in the script above is a short.
