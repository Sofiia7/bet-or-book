# Remaining items from the full audit, 9 October 2026

Source: [full audit](2026-10-08-full-audit.md). Completed changes are described in the [fixes report](2026-10-09-fixes.md). Closing A01-A06 does not mean the full audit is closed. The main code was published on 9 October; below is the current list of what remains, including tasks that cannot be confirmed by code tests.

## Current sprint improvements in order of execution

| Queue | Recommendation | Current state | What still needs to be done |
| --- | --- | --- | --- |
| 1 | Three contrasting cases | Done: three main cases with questions; a fourth in an expandable block; takeaway after opening. | Check understanding with real users. |
| 2 | A concrete fact instead of a generic Unknown | Done for partial spot, overcoverage and funders: amounts, share and the boundary of the conclusion. Partial/stale readings do not get a computed proven remainder. | Extend the wording according to the difficulties users actually have; do not change the class to get a nicer-looking answer. |
| 3 | Input from a whale alert | Done: hint and example, choice of a unique address before the paid request, selected address shown in status. | A full X parser remains a separate piece of work; support for it is not promised at this time. |
| 4 | Waiting and recovery | Done: explanation after 8 seconds, free example while waiting, timeouts, budget-off path. An isolated replay without paid POSTs was prepared for verification. | Do not treat test responses as production checks of the provider. |
| 5 | Saved positions | Done: names, asset/side, snapshot, date, separate open/refresh, Save confirmation and a jump to the list. A live reading keeps the user's previous snapshot for comparison and the name, and does not replace a newer record with an older one. | In-app alerts are implemented in a limited v9 pilot; Telegram/email are not connected. Comparison after a refresh was checked on a local fixture without a paid POST; different questions are not presented as a change in the position. |
| 6 | Explore as case studies | Done: Recent case studies first; Compare readings, All readings and Archive are separate. Each selected case has dates and a description of its usefulness. | Add new cases based on the quality of the evidence, not to fill space. |
| 7 | Share, visuals and terminology | Done: result/date/Share above the diagram, funder amounts/boundaries, long N/A, Book legend and takeaway. Copy reading keeps the date, fact, limitation and link; the X draft keeps the date/limitation when shortened. Copy link was checked in a browser, PNG OG was checked over HTTP. | The IAB did not confirm the download event of the client-side PNG: a download smoke test in a regular browser is needed. There was no other connected browser on 9 October. Judge the alternative coverage bar by real misunderstanding. |
| 8 | Browser regression | Done: 25 core + 12 Save/Share checks on production. Another 9 saved position comparisons on a local fixture. Shared link, invalid input, multiple addresses, Back, incomplete banner, Copy link, keyboard, real viewports 320/390/1280. | Repeat before subsequent releases. |

## Release and readiness evidence

| Recommendation | Status |
| --- | --- |
| Publish the Worker and OG, production smoke | Done: Worker v10 published; four main PNGs embedded, archived v9 PNGs reused. Production UI/API/PNG checked; the quota for new KV writes is temporarily exhausted. |
| WAF / edge rate limit | Configuration prepared, application not confirmed; access to the zone is needed. |
| Public judge access and Nansen budget | Checked without the operator key: full fresh check in 6.8 sec, 4 calls / 4 credits, snapshot saved. Nansen reported 858 credits at 2026-10-09 06:49:20 UTC. Cap 80 / reserve 40 / floor 100 kept. What remains is a measurement of that one request, not a guarantee for future judging. |
| A fresh, correct Book | Not found among the current showcase items. Not a required result: the demo can honestly show three other contrasts. Do not change thresholds for the sake of the showcase. |
| Anonymous funnel | Published. This is not yet evidence of demand; own smoke events on 9 October must not be counted as user activation. Events do not give exact unique users or a complete individual chain. Cache hit and operator must be considered together with technical telemetry. |
| 5-8 user sessions | A protocol is prepared, the sessions themselves have not been held. Check understanding of the date, own/funder, the meaning of coverage, and the ability to retell the conclusion. |
| Feedback from authors/analysts | Pilot not agreed. Real cases and a willingness to use the card in the next publication are needed. |
| Video, pitch, disclosure, team, application | Materials updated; final recording, confirmation of facts and submission not done. |

## Additional v9 package

At the user's request, the following package was implemented. There is no pilot partner; the Telegram/email channel has not been chosen. Description of the connection and limitations: [publisher-pilot.md](../publisher-pilot.md).

- Meaningful-change alerts are implemented as an in-app pilot: four different questions globally, roughly once every four hours, for 72 hours, at most one cron job per hour. Protection against repeats, atomic capacity/lease, browser capability token, Stop. An incomplete/unsaved result does not replace the baseline; the budget can pause the cycle. Notifications are available in the open app. Telegram/email/Web Push are not connected.
- Claim checker implemented: four bounded claims, assessed from dated data without an LLM and without new paid calls. The selection is carried in the link and in the publisher API/widget.
- Publisher widget and read-only API implemented; Copy embed is available in Share. The bot adapter prints ready-made text but does not send it. A paid API and commercial rights are not announced.
- Educational saved cases: question → evidence. Do not present a match with the heuristic as knowledge of the owner's real strategy.
- Opposing legs are counted for the selected asset (long/short/net), not for an irrelevant pair in the portfolio. Existing uncertainties of the selected asset keep Unknown; spot + opposing contracts are not declared a proven safe hedge.
- HIP-3 live venue/deployer/oracle-updater provenance is implemented, with a separate state for an unavailable registry. The registry does not prove the underlying: the bounded asset identity model is kept for now. Full verification of oracle definitions remains open and is not replaced by guessing from the ticker.
- Book diagnostics implemented: distance from a fresh L2 mid or an explicitly labelled mark, separate quote observations. Best-effort KV samples do not prove continuity. A tool for evaluating independent labelling is ready; the labelling is empty, precision/recall are not measured. Grade is not a probability.
- Lazy PnL/funding-age implemented: the main UI uses core; additional context is loaded separately. Source positions are reused for up to a minute when the asset is changed, and the original source timestamp is preserved. Core uses a staged atomic reserve with retries/pages; the full context keeps the maximum reserve. Concurrent requests and spend accounting were checked in workerd. Other source observations are re-read for the selected question.
- The frontend extracts transport and monitor modules and uses shared TypeScript claim/share/saved-reading models. The publisher DTO is versioned. In v10 the canvas, share-card and Explore are extracted into standalone modules; the framework was not changed.
- Pricing, embedding rights, SLA and commercial keys come after verification with a buyer, not from hypothetical demand.

## Keep and do not expand for now

Kept: observe/interpret/present, versioned observations, atomic spend ledger, POST for paid checks, free saved links, ownership boundaries, workerd/CI and a small frontend without a framework.

"Don't Get Rekt Copytrading" is excluded from changes at the user's direct instruction. Execution, wallet connect, token/points, referrals, PnL leaderboard, a general AI chat, a social feed, new networks, mass scans, full ownership attribution and a derivatives risk engine are not part of the recommendations for this sprint.

## Completion of the v10 technical package

- HIP-3 no longer treats an underlying as known from a ticker alone. A catalogue of 11 exact `xyz:` contracts is bound to the official specification, the live deployer/oracle updater and a verification period of 9-16 October. A different operator, an unknown contract, an unavailable registry or an expired verification do not confirm the underlying. This is a check of the published definition and operator, not an audit of oracle behaviour; crypto aliases and spot equivalence are not confirmed. Old observations without a definition remain historical.
- Canvas constellation, Share PNG and Explore are extracted from app.js. 25 core, 12 Save/Share and 9 saved-comparison scenarios were checked locally.
- Monitor records the selected asset/side even when the initial headline is the default one. An old, repeated, unsaved or incomplete result pauses the cycle without a false "no changes". The real scheduled Worker was checked in workerd: one paid call, a repeated cron does not spend a credit, the demo reserve is not used.
- The four current demo PNGs are included in the Worker and available without KV. An unchanged archive uses the existing v9 PNGs. Prerender processes only the current cases by default; the full archive requires `--all`.
- On 9 October KV refused the v10 upload with code 10048: the daily write quota is exhausted. The upload of 315 new PNGs was not completed. Until the quota resets, a new live snapshot write may be unavailable; saving a link is not promised if the write fails. Reading existing examples and built-in previews works.
- Checks: 710 unit/API tests and 12 workerd tests; typecheck. Independent Book labelling, user sessions, a partner, channel credentials, commercial rights and the final submission remain external tasks from the table above.

Release v10 published: `1999a112-3a5b-4cd8-bb5f-6561991b8ab0`. Production: 25 core + 12 Save/Share + 6 publisher browser checks; the four PNGs matched the manifest byte for byte, the historical preview is available, the publisher DTO contains market definition/provenance. Paid production scans and new monitor subscriptions were not run in the smoke test. Limits cap 80 / reserve 40 / floor 100 kept.

## Addendum: preparation of the final demo

- `npm run release:check` performs GET requests only: app/bundle, the four current snapshots, API/widget and PNGs. It checks the ID, question, real date, current rules, completeness and exact match of the PNG against the manifest. A failure returns a non-zero exit code. Success means the saved demo is reachable, not a check of KV writes, provider balance, WAF, demand or the application.
- Production check on 9 October at 17:23 UTC: 13/13, age of the observations about 49.4 hours; this is saved data from 7 October, not the live market state.
- `refresh-featured.ts` pins the previous asset/side and does not replace the example with a different largest position, a closed position, or an older/partial/stale reading. Three regression tests passed without a paid refresh.
- The script of the video, up to 2:55, is updated for Save, claim checker and widget; there is a free path if the provider/KV is unavailable. The checklist and application draft are aligned with the current pilot. Recording, video upload and submission of the application are not done yet.

## Save: protection of the saved record

An additional defect in manual Save was fixed: an old card or a new result with `snapshotSaved=false` could replace a newer bookmark and lose the link/previous baseline. Manual Save now uses the same `advanceSavedReading` as the automatic update; the label and monitoring capability are kept. The confirmation shows the date of the retained record and copies exactly its link. With 12 records, a new Save is rejected explicitly, without deleting the last bookmark and monitor control. Stop is available by capability even without a snapshot ID.

Checks: typecheck, 713 unit/API tests; 14 saved-reading and 4 capacity browser checks on local replay without paid forwarding; 12 Save/Share locally; 25 core + 12 Save/Share on production. The production card from 7 October did not replace the saved reading from 9 October: Copy saved reading link opened the 9 October date for free. New Worker `f643fd52-78b5-492c-bb3c-4e86291caf19`; rules remain v10, budget limits unchanged. The write-failure test was reproduced locally; a production live write was not checked in this release.
