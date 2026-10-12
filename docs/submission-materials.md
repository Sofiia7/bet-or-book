# Colosseum application drafts

## Product

Bet or Book is Hyperliquid position intelligence for readers of whale alerts. Paste an address or wallet link to see whether a selected position looks like a directional bet, a same-address spot hedge, or market-making inventory. Each dated answer shows its evidence, rules and missing sources. Funding-wallet holdings never count as proven ownership. The tool inspects public data and never connects a wallet or trades.

HyperCore supplies positions, orders, fills, spot balances and market context. Nansen supplies cross-dex positions, cross-chain holdings, PnL and funding links. Cloudflare Workers, Durable Objects and KV provide atomic spend protection, request limits, saved readings and previews.

## Current demonstrated workflow

Named browser-local positions, listed under the Saved tab, reopen saved readings for free and compare against the user's previous saved evidence. Four bounded claim checks travel in the shared link, static publisher widget and versioned read-only API. Copy reading includes the date, source limits and attribution. A limited in-app monitoring pilot supports four questions globally for 72 hours and uses the public credit budget; external notification delivery is not connected. No publisher partner or commercial licence is claimed. These features are implemented, while demand and business assumptions below remain unvalidated.

The four current showcase observations are dated 7 October; v10 reinterpretation does not make them new market observations. Main previews ship in the Worker. New live snapshot persistence must be verified after the 9 October KV write-quota exhaustion before presenting a live-save workflow.

## Go to market and demand validation

The initial audience is people evaluating whale alerts, authors explaining positions, and terminals or copytrading interfaces that need context beside a headline. Start with three public case studies linking to dated evidence cards and ask readers what the context changes. Seek a HypurrCollective listing and interview channel authors and terminal builders; these are planned channels, not existing partnerships. The October 7 internal audit reported 31 saved live readings in 30 days, roughly 17 apparently external readings, 278 listed saved readings and zero paying users. These are small, dated signals, not validated product-market fit. Willingness to pay and repeat use are untested; test paid embedding/API pilots with publishers before setting a price. Track repeat readers, verified interview feedback and actual pilot commitments, rather than crawler visits or saved scan rows. Meter checks to keep spending within the remaining data credits.

## Previous work disclosure

Development began September 17, 2026. Bet or Book was submitted to the Nansen Meridian Buildathon (September 14-27). The October 7 audit reports it was not among winners or honourable mentions and was listed in Nansen's Examples of API Builds. September source, examples and audits predate this entry. October work improves reliability, credit protection, rules, presentation and sharing. Confirm the dates, outcome and official links before signing the declaration.

## Pitch script: up to 2 minutes

The submission form accepts a pitch video of up to 2 minutes: introduce yourself, say what you are building and why you are the person to build it. About 235 words at an even pace.

Every week someone posts a whale's hundred-million-dollar short on Hyperliquid, and people read it as a view on price. But the same short can be a directional bet, one side of a spot hedge, or inventory in a market maker's book. The number alone cannot tell you which.

I'm Sofia, a solo builder from Serbia. I built Bet or Book to answer that question with evidence.

You paste an address and choose the position. The tool reads public data from Hyperliquid and Nansen, and gives a dated answer, the numbers behind it, and what it could not see. For example, a two-hundred-million-dollar ETH short has three hundred million of matching ETH, but only in wallets that funded the account. A transfer is not ownership, so the tool says Unknown, not hedged.

Why me: I built this alone, with AI coding assistants, in under four weeks. Honesty is the product. Every rule is versioned, every answer is dated, and I audited my own verdicts again and again and changed them when they were wrong. One example I first read as a market-making book now reads Unknown, and the card says why.

Traction is early: a few dozen live readings, no paying users. Next I test paid pilots with whale-alert publishers. It is open source, and it never trades. Bet or Book: check before you copy.
