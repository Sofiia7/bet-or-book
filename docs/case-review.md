# Seventeen readings, read by hand

The 23 September audit asked for this before submission: take 12-20 different readings, especially the ones where the answer is not the expected one, and write down which conclusions the data itself establishes, where the card only interprets, and where it has to abstain. More tests on the same thresholds would not have done it; tests prove the rules run as written, not that the rules say something true about a position.

This review was made on 24 September from readings already stored ([`data/gallery.json`](../data/gallery.json), [`data/featured.json`](../data/featured.json)); no new calls. It is not an independent validation. Nobody outside an account knows what its owner intends, so there is no ground truth to score against; what this can check is whether each card says more than the data behind it supports.

Three words, used strictly:

- **Observed**: a fact in the data that was read. "100% of the exposure is one long" is observed.
- **Interpreted**: meaning the card adds on top. "Looks like a bet" means "a directional view", and that is an interpretation of an observed shape: the same shape with a hedge on an exchange would not be a bet at all.
- **Abstains**: the card declines to conclude. The question is then whether declining was right.

| # | Reading | Verdict | What the data shows | Observed / interpreted / abstains | Holds? |
|---|---|---|---|---|---|
| 1 | `3p2dqa2fjl01r`, $130.0M HYPE long, 24 Sep | Looks like a bet | One position, 100% of exposure, no resting orders, no hedge possible for a long; 5x cross, liquidation 22% away | Concentration and the absence of quotes are observed. "Bet" is interpreted: a short on an exchange would not show | Yes |
| 2 | `a2ce501d-mu71ndrn`, $25.7M ETH long, 18 Sep | Looks like a bet, portfolio | 7 positions, all long, net 100% of gross, no quotes | Direction observed; one stance across seven positions interpreted | Yes |
| 3 | `ec4a6f59-mu7220jh`, $24.2M BTC long, 18 Sep | Looks like a bet, portfolio | 15 positions all long, net 100% of gross, no two-sided quotes, 2,000+ fills a day with 72% of them sells | Holdings direction observed. The flow says the account is busy, and selling more than it buys - which could be the position shrinking or simply turning over; "bet" describes the holdings at one moment, not where they are going | Yes, with the caveat that this 18 September card predates the position-flow line; a fresh check shows it |
| 4 | `0y4xhntgcjxhf`, $289.6M ETH short, 21 Sep | Looks like a bet, portfolio | 15 positions all short, net 100% of gross, holdings read in full: 0.0% covered, funders hold 2% | Observed; the one short among 132 bets in the scan (see below) | Yes |
| 5 | `0x4uv7ru4tpka`, $43.2M HYPE short, 24 Sep | Hedged | 97% covered by $41.7M of spot HYPE on Hyperliquid in the same account; every other chain read, nothing | Coverage on visible balances is observed. Hedged as "safe" would be interpreted; the card says debts are not read and asks whether any of it is owed | Yes |
| 6 | `070mdl1lurxwg`, $5.0M HYPE short, 21 Sep | Hedged | 100% covered by Hyperliquid spot; 397 fills a day | Same as 5 | Yes |
| 7 | `075ocy85yngsu`, $209.1M ETH short, 24 Sep | Unknown: assets at the funders | Under 1% covered at the address; two funding wallets hold $443.7M of ETH | Funding links and balances observed (Nansen); ownership not established, so it abstains. Re-run without the links, the same numbers read as "Looks like a bet" | Yes: abstaining is the only honest answer |
| 8 | `0tx322smj5om6`, $45.6M ETH short, 18 Sep | Unknown: hedge not checked | 44 positions; holdings read only on Hyperliquid, at least $5K of matching spot found | Abstains: "no hedge" was never established | Yes |
| 9 | `2vihlf2frwr3b`, $30.8M HYPE short, 18 Sep | Unknown: hedge not checked | 18 positions, two-sided quotes in 2 markets, holdings read partly | Abstains | Yes |
| 10 | `77375a8c-mub6s32f`, $24.5M NEAR long, 21 Sep | Unknown: dollars net out across assets | 8 positions, net 24% of gross, none of it in the same asset | Dollar balance observed; declines to call a cross-asset portfolio a hedge | Yes |
| 11 | `147farhy3qzkj`, $4.0M NEAR short, 21 Sep | Unknown: book-shaped, no quotes | 90 positions, net 17% of gross, 2,000+ fills a day, all buys | Shape observed; declines "book" without quoting behind it | Yes |
| 12 | `53969485-mu72olu2`, $5.2M ETH long, 18 Sep | Unknown: maker flow only | 2,000+ fills, 98% as maker, yet no resting orders at the moment of reading | Abstains; one snapshot of orders cannot show whether this is a quoting algorithm between orders | Yes; only observation over time could settle it |
| 13 | `152e41f0-mu723w29`, $20.8M HYPE long, 18 Sep | Unknown: signals disagree | 3 positions, net 100% of gross, 64% in HYPE, 49 resting orders, two-sided in one market | Abstains because one two-sided market exists anywhere in the account | Probably over-cautious (see below), never too strong |
| 14 | `2ui4uw0akafm9`, $16.0M xyz:SP500 short (HIP-3), 21 Sep | Unknown: signals disagree | 24 positions, net 47% of gross | Neither concentrated nor balanced; abstains | Yes |
| 15 | `17adm6ld3op4a`, $46.9M ETH short, 24 Sep | Book (likely) | 134 positions; 2,613 resting orders, both sides of 123 markets, $42.9M of it matched in ETH itself | Quoting in the headline market observed; that this short is inventory is interpreted, and the card asks it as the open question | Yes |
| 16 | `9eec98d0-mu7237sy`, $20.8M ETH long, 18 Sep | Unknown: signals disagree | Nansen positions unavailable: main dex only; 2 positions; two-sided in one market | Abstains twice over: positions incomplete, and a quote | Yes |
| 17 | `dd9f2744-mu71kc0i`, $41.1M BTC short, 18 Sep | Unknown (rules v2, history) | 48% covered, read before the current rules existed | Kept as history rather than re-judged from an aggregate the current rules cannot read | Yes |

## What the review found

**No card claims more than its data.** Every verdict above is either an observed shape with a stated interpretation, or an abstention that names what it could not establish. None of the seventeen needed changing.

**The "bets" in the scan are almost all longs, for two reasons, and only one of them is the market.** Of the 132 readings the current rules call a bet, 131 have a long headline. Partly that is the sample: 158 of the 177 positions judged are longs. Partly it is how a short is read: before it can be a bet it has to pass a complete read of the account's holdings, and 8 of the 19 shorts judged never got one on 18 September, so they sit under "hedge not checked"; 7 more are covered, and only 1 reads as a bet. 83% of the longs read as bets against 5% of the shorts. The 75% bet share in the README is a count of what this scan could establish, and says nothing about how many whales are short and unhedged.

**One two-sided market anywhere withholds "bet".** Case 13 holds 64% of its exposure in one HYPE long and quotes both sides of a single market - which one, this 18 September reading did not record. The bet rule treats any two-sided quoting as a sign the account might be making markets, and abstains. After the 23 September fix, quoting elsewhere no longer counts as evidence *for* a book; it still counts against a bet. That asymmetry errs toward saying less, which is the right direction for a tool people copy trades from, and the threshold is worth revisiting with more cases rather than moving on this one.

**Flow is not direction.** Case 3 is all long and trading hard, mostly selling. The card is right about what it holds; what it is doing is a different question, which the position-flow line now answers on a fresh check and did not on the 18 September scan.

**Nansen decides the hardest case.** Case 7 is where the answer turns: with the funding links, Unknown; without them, the same numbers read as a bet. That is the one counterfactual the page states ("From Nansen" on the card), because the links are the only input that comes from Nansen alone.

What would make this stronger than a read-through: a labelled set of accounts whose owners are publicly known (market makers that say so, funds that report hedges), read the same way, with the misses written down. Until then the thresholds are what the README calls them: ordinary numbers chosen against observed data, none of them a probability.
