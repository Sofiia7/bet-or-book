# Demo - about 58 seconds, no voice

The recording for the X post (tag @nansen_ai). The page's own sentences carry the story, so no captions or narration are needed.

The story has changed three times, and it is better each time. The first script showed the big ETH short as **Hedged (probable)**, "220% covered by ETH held in 2 wallets that funded this account" - a reading that was wrong, because a funding transfer shows where money came from and not who holds it now. The 21 September audit made the tool draw what it found rather than list it, and put two readings of the same address side by side. The 23 September audit cut the first screen down to the question, the answer and the one picture that decided it, and added four fresh, dated readings at the top of the page - one of each kind of answer - so the contrast beats no longer depend on a days-old scan.

**Before recording.** The live site in Chrome or Edge, window maximized, page zoom 125%, notifications off. Once, before anything else, open the site at `/#operator` and paste `DEMO_KEY` from `.dev.vars`: the page answers "Operator key accepted", and from then on this browser's checks can use the demo reserve and skip the public rate limits. The key is never on screen after that. Then reload the page (F5) and copy the address `0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36` before pressing record.

No rehearsal run to warm the cache. A cached answer replayed as a fresh request is the one thing a demo must not do, and the card says "cached, N minutes old" when it is one, so it would show. Check once, for real, on camera - and if the same address was checked on the site in the last ten minutes, wait that out first.

> **Credits.** The account answered with **916 credits left** on 24 September, after the four demonstration readings and a second read of the Hedged one. This check costs up to 7. The two contrast beats below open saved readings and cost nothing. The daily cap in the Worker is 300, and 40 of it is a reserve the public path cannot reach, which is what keeps a busy afternoon from leaving the demo on Hyperliquid-only data.

| Time | Action | What the viewer reads |
|---|---|---|
| 0-4 s | Nothing, page at the top | "Bet or book. Before you copy the headline, check the position." |
| 4-8 s | Click the address field, paste, click **Check** | "Reading positions from Nansen and orders from Hyperliquid...", then the card: "The position: $2xxM ETH short" |
| 8-17 s | Hold on the diagram | One bar, the ETH short, **empty**. A dashed box outside it: about **$440M**, "in 2 wallets that funded this account, ownership unverified, not counted" |
| 17-23 s | Hold on the sentence above it and the **From Nansen** line under it | "Less than 1% of the ... ETH short is covered by ETH at this address..." and, from Nansen: "2 funding wallets hold ... of ETH; without them this would read as "Looks like a bet"". The one line that says what the Nansen data changed |
| 23-28 s | Hold on **What changed since 24 Sept** | the position size and the funders' ETH, each with an arrow, and "The answer did not change" |
| 28-35 s | Click the chip **$41.8M HYPE short · 97% covered** | **Hedged**, the same bar **97% full**, and "Saved reading from 24 Sept". The same shape of question, the opposite answer |
| 35-43 s | Click the chip **$46.9M ETH short · market maker**, then open **How this was decided** | **Book (likely)**: "2,613 resting orders quote both sides of 123 markets", and the rule in one sentence: this account quotes the position's own market on both sides |
| 43-52 s | Click the first chip under **Your recent checks** (the live reading from 4 s), then **Share this reading**, then **Download image**, and show the PNG | the same bar, the standing limit, the time, the link back |
| 52-58 s | Stop recording | |

Three positions of the same size and shape, in order: the assets are somewhere else and nobody can prove whose they are; the assets are right here and they match; and an account whose business is quoting, not holding a view. The bar is the same bar in the first two, which is what makes the contrast land without a word of narration.

The first check is live. The two chips open readings saved on 24 September, and say so on screen, with the time they were read.

Post text (under 280 characters - X counts each link as 23 whatever its length). The numbers are the 24 September reading; put in what the card on screen says:

> A whale is short $209M of ETH. The timeline calls it hedged.
>
> Bet or Book: under 1% is covered at that address. Two wallets that funded it hold $443M of ETH - but funding is not ownership.
>
> Built on @nansen_ai
> https://bet-or-book.sofiaseremeteva.workers.dev
> https://github.com/Sofiia7/bet-or-book

## Check these before recording

- Every number above comes from the readings of 24 September. The live check will show today's figures, which will differ. Read the card on screen; do not read this file.
- The first live check of an address shows **What changed** against the last reading of the same question the site knows about - a live one if there is one, otherwise the demonstration reading the page ships with. If the answer and every number are unchanged since then, the block does not appear; the beat at 23-28 s is then simply skipped.
- The four chips at the top are fixed readings; they do not move. The gallery further down reads "More readings of big Hyperliquid positions", counts only what the current rules judged (177: 132 look like bets, 38 unknown, 7 hedged), and keeps the 100 older readings and how the set was chosen in an archive under it.
- The diagram only appears for a **short**: spot cannot offset a long, so there is nothing to draw. The book has one too; it is not in the script because its bar says less than its sentence does.
- The picture a pasted link shows is drawn when the reading's Share button is first opened. Open it once on the live reading before pasting the link anywhere, and give it a minute: a crawler that asks earlier gets the standing picture, briefly cached, and comes back later for the real one.
