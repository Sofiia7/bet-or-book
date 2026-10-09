# Crypto World's Fair submission

Official portal: https://colosseum.com/worldsfair. The October 7 audit gives the deadline as October 12, 2026, 23:59 Pacific (October 13, 08:59 Budapest/Serbia). Confirm the portal clock before submission.

| Field | Prepared material | Remaining founder action |
| --- | --- | --- |
| Product | Bet or Book: Hyperliquid position intelligence | Copy description from submission-materials.md |
| Website / repository | https://bet-or-book.trade / https://github.com/Sofiia7/bet-or-book | Verify public links |
| Integrations | HyperCore info API, Nansen, Cloudflare Workers, Durable Objects, KV | Confirm competition tracks |
| Team / location | Founder-provided details required | Confirm team, identity and location; do not infer them from an audit or timezone |
| Logo | assets/logo.svg and generated assets/logo.png | Upload |
| Pitch video | 2-3 minute script in submission-materials.md | Record and upload |
| Demo video | Shot list in demo-script.md | Record final deployed site, under 3 minutes |
| GTM / demand | Dated evidence and hypotheses in submission-materials.md | Add verified feedback |
| Previous work | Disclosure in README and submission-materials.md | Confirm facts |
| Entry | Official portal | Register, accept terms, submit and retain confirmation |

Release: typecheck, tests, workerd tests, dry run and PR CI must pass. Run `npm run release:check -- https://bet-or-book.trade .replay/release-readiness.json` before recording and submission. It checks root, browser bundle, all current saved examples, publisher API/widget and exact bundled PNGs using GET only. It reports the examples' actual age; success does not establish fresh-check availability, KV write allowance, WAF or user demand.

When a refresh is needed, `scripts/refresh-featured.ts` is a paid provider operation with its own allowance; preserve dates and prior IDs. Reexplain data, then run offline `scripts/prerender-og.ts` to bundle current previews. `--upload` is optional; `--all` rebuilds the archive. KV write quota was exhausted on 9 October. Verify successful new snapshot persistence before recording a live-check scene. Existing dated examples can be filmed honestly without a fresh scan. Configure /#operator privately beforehand; keep credentials out of recordings and logs. Registration, identity declarations, filming and final submission require the founder.
