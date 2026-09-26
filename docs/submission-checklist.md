# Submission checklist - verified 26 September 2026

Deadline: **27 September 2026, 23:59 UTC**, or **28 September, 01:59 in Budapest**.

Sources: [official FAQ](https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27), [campaign](https://nansen.ai/campaigns/meridian-buildathon), [submission form](https://nansen-ai.typeform.com/meridian-submit).

The current FAQ requires **100+ API calls** within September 14-27. The campaign landing page still says 1,000; the project's recorded 1,136 calls exceed both. Confirm the qualifying count in the Nansen account before submitting.

| Requirement | Status |
| --- | --- |
| Meaningful Nansen API use | Implemented: cross-dex positions, cross-chain balances and funding links affect the verdict |
| Public GitHub repository | Confirmed PUBLIC on 26 September: https://github.com/Sofiia7/bet-or-book |
| 100+ qualifying calls | Local ledger: 1,136 calls, 1,128 successful; account-side confirmation still needed |
| Working demo | Application implemented; deployed URL: https://bet-or-book.sofiaseremeteva.workers.dev |
| 30-60 second screen recording with live Nansen data visible | Still to record; updated shot list in demo-script.md |
| X post with recording, @nansen_ai and GitHub link | Draft prepared in demo-script.md; not posted by this task |
| Entry form: email, X post URL, GitHub link | Still to submit after posting |

A purchased domain is not listed as an entry requirement. The existing workers.dev URL can be used.

## Technical release checks

Run `npm run typecheck`, `npm test`, `npm run test:runtime`, and `npm exec wrangler deploy -- --dry-run`. Verify the live landing page, all four examples, Full analysis, Explore, and one fresh Nansen-backed check before recording. Saved examples must stay labelled as saved readings.

Do not record credentials. If needed, set up the existing operator access before recording, using /#operator. Keep the actual DEMO_KEY out of this document, screen recordings and logs.

Shared preview images use layout v6. After a picture-layout change, run `node --import tsx scripts/prerender-og.ts --upload` so bundled readings have their new pictures in KV.

## Remaining submission work

1. Confirm the API call count and available credits in the Nansen account.
2. Record the current production application, including a fresh check. Use the numbers and verdict that actually arrive.
3. Publish the demo on X with the required tag and repository link.
4. Submit https://nansen-ai.typeform.com/meridian-submit and retain the confirmation.

Judging has four equal criteria: data integration, functionality, creativity/originality, and documentation/submission. Technical readiness alone does not complete the entry.
