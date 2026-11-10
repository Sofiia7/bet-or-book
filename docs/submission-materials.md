# Colosseum application drafts

## Product

Bet or Book is Hyperliquid position intelligence for readers of whale alerts. Paste an address or wallet link to see whether a selected position looks like a directional bet, a same-address spot hedge, or market-making inventory. Each dated answer shows its evidence, rules and missing sources. Funding-wallet holdings never count as proven ownership. The tool inspects public data and never connects a wallet or trades.

Hyperliquid's public API supplies positions on every perp dex, orders, fills, spot balances, market context and the 30-day perp PnL. Public JSON-RPC nodes (PublicNode, and Hyperliquid's own HyperEVM RPC) supply balances on Ethereum, Arbitrum and HyperEVM for the tokens the tool recognises, and the Blockscout block explorer supplies the wallets that first funded an account. No paid data source is used. Cloudflare Workers, Durable Objects and KV provide a per-check request budget, rate limits, saved readings and previews.

The four showcase examples and the archive were read in September and October through the Nansen API, which the current code no longer calls. They are dated facts, keep their dates and their Nansen credit, and say so; a new check of the same addresses uses the sources above and can read differently.

## Current demonstrated workflow

Named browser-local positions, listed under the Saved tab, reopen saved readings for free and compare against the user's previous saved evidence. Four bounded claim checks travel in the shared link, static publisher widget and versioned read-only API. Copy reading includes the date, source limits and attribution. A limited in-app monitoring pilot supports four questions globally for 72 hours and runs its checks through the public path, under the public rate limits; external notification delivery is not connected. No publisher partner or commercial licence is claimed. These features are implemented, while demand and business assumptions below remain unvalidated.

The four current showcase observations are dated 7 October; v10 reinterpretation does not make them new market observations. Main previews ship in the Worker. New live snapshot persistence must be verified after the 9 October KV write-quota exhaustion before presenting a live-save workflow.

## Go to market and demand validation

The initial audience is people evaluating whale alerts, authors explaining positions, and terminals or copytrading interfaces that need context beside a headline. Start with three public case studies linking to dated evidence cards and ask readers what the context changes. Seek a HypurrCollective listing and interview channel authors and terminal builders; these are planned channels, not existing partnerships. The October 7 internal audit reported 31 saved live readings in 30 days, roughly 17 apparently external readings, 278 listed saved readings and zero paying users. These are small, dated signals, not validated product-market fit. Willingness to pay and repeat use are untested; test paid embedding/API pilots with publishers before setting a price. Track repeat readers, verified interview feedback and actual pilot commitments, rather than crawler visits or saved scan rows. Checks cost no paid credits now; they are bounded by rate limits and a budget of 45 outbound requests per check, and the one optional key (Blockscout, for Arbitrum funding links) has a free tier.

## Previous work disclosure

Development began September 17, 2026. Bet or Book was submitted to the Nansen Meridian Buildathon (September 14-27), built on the Nansen API. The October 7 audit reports it was not among winners or honourable mentions and was listed in Nansen's Examples of API Builds. September source, examples and audits predate this entry. October and November work improves reliability, rules, presentation and sharing and moves the data off Nansen: positions, orders, fills and PnL from Hyperliquid, balances from public nodes, funding links from Blockscout. Confirm the dates, outcome and official links before signing the declaration.

## Pitch script: up to 2 minutes

The submission form accepts a pitch video of up to 2 minutes: introduce yourself, say what you are building and why you are the person to build it. About 235 words at an even pace.

Before recording: the ETH example in the script ("three hundred million of matching ETH") is the dated reading from 7 October, made with Nansen. Re-read it through the current sources and say the figures on screen, because the funders' holdings can read differently (Blockscout tags some funding wallets as exchanges, which are skipped).

Every week someone posts a whale's hundred-million-dollar short on Hyperliquid, and people read it as a view on price. But the same short can be a directional bet, one side of a spot hedge, or inventory in a market maker's book. The number alone cannot tell you which.

I'm Sofia, a solo builder from Serbia. I built Bet or Book to answer that question with evidence.

You paste an address and choose the position. The tool reads public data from Hyperliquid, public blockchain nodes and the Blockscout explorer, and gives a dated answer, the numbers behind it, and what it could not see. For example, a two-hundred-million-dollar ETH short has three hundred million of matching ETH, but only in wallets that funded the account. [Old figures: the 7 October reading, made with Nansen. Re-read it and change them before saying this.] A transfer is not ownership, so the tool says Unknown, not hedged.

Why me: I built this alone, with AI coding assistants, in under four weeks. Honesty is the product. Every rule is versioned, every answer is dated, and I audited my own verdicts again and again and changed them when they were wrong. One example I first read as a market-making book now reads Unknown, and the card says why.

Traction is early: a few dozen live readings, no paying users. Next I test paid pilots with whale-alert publishers. It is open source, and it never trades. Bet or Book: check before you copy.
