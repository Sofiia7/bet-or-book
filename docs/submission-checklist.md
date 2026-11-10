# Crypto World's Fair submission

Official portal: https://colosseum.com/worldsfair. The October 7 audit gives the deadline as October 12, 2026, 23:59 Pacific (October 13, 08:59 Budapest/Serbia). Confirm the portal clock before submission.

| Field | Prepared material | Remaining founder action |
| --- | --- | --- |
| Product | Bet or Book: Hyperliquid position intelligence | Copy description from submission-materials.md |
| Website / repository | https://bet-or-book.trade / https://github.com/Sofiia7/bet-or-book | Verify public links |
| Integrations | HyperCore info API, public JSON-RPC nodes (PublicNode, Hyperliquid's EVM RPC), Blockscout explorer, Cloudflare Workers, Durable Objects, KV. Nansen appears only in the dated September-October readings; the code no longer calls it | Confirm competition tracks |
| Team / location | Founder-provided details required | Confirm team, identity and location; do not infer them from an audit or timezone |
| Logo | assets/logo.svg and generated assets/logo.png | Upload |
| Pitch video | 2-minute script in submission-materials.md; the submission form accepts up to 2 minutes while the FAQ says 2 to 3 | Record and upload |
| Demo video | Shot list in demo-script.md | Record final deployed site, under 3 minutes |
| GTM / demand | Dated evidence and hypotheses in submission-materials.md | Add verified feedback |
| Previous work | Disclosure in README and submission-materials.md | Confirm facts |
| Founder profile | Role, education and work history drafted from the founder's own facts | Founder completes the personal fields and checks the text |
| Accelerator | Optional toggle; the private answers are drafted from dated facts | Founder answers the legal entity, investment and fundraising questions and decides whether to keep it on |
| Entry | Official portal | Register, accept terms, submit and retain confirmation |

Release: typecheck, tests, workerd tests, dry run and PR CI must pass. Run `npm run release:check -- https://bet-or-book.trade .replay/release-readiness.json` before recording and submission. It checks root, browser bundle, all current saved examples, publisher API/widget and exact bundled PNGs using GET only. It reports the examples' actual age; success does not establish fresh-check availability, KV write allowance, WAF or user demand.

When a refresh is needed, `scripts/refresh-featured.ts` makes no paid call but needs a Blockscout key (it stops before any request without one) and reads the public sources within their rate limits; preserve dates and prior IDs. Reexplain data, then run offline `scripts/prerender-og.ts` to bundle current previews. `--upload` is optional; `--all` rebuilds the archive. KV write quota was exhausted on 9 October. Verify successful new snapshot persistence before recording a live-check scene. Existing dated examples can be filmed honestly without a fresh scan. Configure /#operator privately beforehand; keep credentials out of recordings and logs. Registration, identity declarations, filming and final submission require the founder.

Shared free-plan allowance: on 11 and 12 October another Worker on the same Cloudflare account used the day's Durable Object row allowance by about 09:00 UTC. The build of that date kept its credit meter in a Durable Object, so until the reset at 00:00 UTC a live check answered from Hyperliquid alone and said the credit meter could not be reached; saved examples, the widget and the API were unaffected. The meter is gone and a check reads no Durable Object storage (the rate limiter counts in memory), so a repeat would not do that; the monitoring pilot's state and KV writes are still shared per account.
