# Colosseum application drafts

## Product

Bet or Book is Hyperliquid position intelligence for readers of whale alerts. Paste an address or wallet link to see whether a selected position looks like a directional bet, a same-address spot hedge, or market-making inventory. Each dated answer shows its evidence, rules and missing sources. Funding-wallet holdings never count as proven ownership. The tool inspects public data and never connects a wallet or trades.

HyperCore supplies positions, orders, fills, spot balances and market context. Nansen supplies cross-dex positions, cross-chain holdings, PnL and funding links. Cloudflare Workers, Durable Objects and KV provide atomic spend protection, request limits, saved readings and previews.

## Go to market and demand validation

The initial audience is people evaluating whale alerts, authors explaining positions, and terminals or copytrading interfaces that need context beside a headline. Start with three public case studies linking to dated evidence cards and ask readers what the context changes. Seek a HypurrCollective listing and interview channel authors and terminal builders; these are planned channels, not existing partnerships. The October 7 internal audit reported 31 saved live readings in 30 days, roughly 17 apparently external readings, 278 listed saved readings and zero paying users. These are small, dated signals, not validated product-market fit. Willingness to pay and repeat use are untested; test paid embedding/API pilots with publishers before setting a price. Track repeat readers, verified interview feedback and actual pilot commitments, rather than crawler visits or saved scan rows. Meter checks to keep spending within the remaining data credits.

## Previous work disclosure

Development began September 17, 2026. Bet or Book was submitted to the Nansen Meridian Buildathon (September 14-27). The October 7 audit reports it was not among winners or honourable mentions and was listed in Nansen's Examples of API Builds. September source, examples and audits predate this entry. October work improves reliability, credit protection, rules, presentation and sharing. Confirm the dates, outcome and official links before signing the declaration.

## Pitch script: approximately 2-3 minutes

Every week, someone posts a whale's hundred-million-dollar short. People read the headline as a view on price. But that short can be a directional bet, one side of a spot hedge, or inventory in a market maker's book. The number alone does not tell you which.

I built Bet or Book to make that difference visible. Paste a Hyperliquid address or wallet link and select the position you came to investigate. The tool reads public positions, orders, fills and balances. It gives a dated answer, the supporting numbers, and the evidence it could not obtain.

The three main examples show different stories. A concentrated HYPE long looks directional. A HYPE short has matching spot at the same address. An ETH short coexists with matching assets in wallets that funded the account. A transfer does not establish ownership, so those assets do not become its hedge. The optional fourth example shows why busy maker-style trading alone does not prove inventory. The current showcase contains no Book verdict; older Book readings remain explicitly dated in the archive. Use the actual dates and figures on screen in the recorded demo.

The constellation carries these distinctions. The position is on the left, this address's matching holdings on the right, and funder holdings are dashed. Leverage, liquidation distance and funding describe position risk separately. A second reading shows what changed, including whether the account moved or the rules changed.

The first audience is people reading whale alerts and authors explaining them. Our distribution hypothesis is a dated evidence card beside the alert, then pilots with publishers and terminals. Demand is early: the October audit counted a few dozen live readings, and there are no paying users. I will test repeated use and paid pilots rather than claim traction from bots or historical scans.

The project is open source. It uses Hyperliquid, Nansen and Cloudflare, never trades, and cannot see off-chain hedges. Earlier work was submitted to the September Nansen buildathon; this entry discloses that history. Next comes distribution validation with actual readers.
