# Budget, rate limiting, and security

The [README](../README.md) links here for how the spend cap actually holds, and what the 21 September security audit changed.

## Every credit has to be able to change the answer

A check reads in stages ([`src/api/observe.ts`](../src/api/observe.ts)):

1. Free Hyperliquid reads first. If Hyperliquid is down, the check fails before a single credit is spent.
2. Nansen positions and PnL: 2 calls, always.
3. The account's balances on every chain: 1 call, only when the headline is a short, no book signal fired and the legs do not already cancel within their own assets. Otherwise no hedge could move the verdict.
4. Funding links (2 calls) and up to two funders' balances: only when the account's own holdings explain less than half of the short.
5. For a long with five or fewer positions - the shape a single viral post usually highlights - funding links again (2 calls), read for when the wallet was first funded and by what kind of address. A hedge search never applies to a long at all, so this is the one piece of Nansen context it can still carry, and it stops at the links: no funder balance is fetched, because a long has no ratio for one to feed.

So a diversified book or a large long costs 2 calls, a small long 4, a short hedged inside the account 3, and the full funder search on a short 7.

**The cap is held, not counted afterwards.** A check reserves the most it could spend before it starts and settles with what it actually spent; whatever it did not use goes back. That arithmetic lives in a Durable Object, because Workers KV is eventually consistent and a read-modify-write through it is not a transaction: two overlapping checks used to read the same total, both pass, and the second write erased the first. Rate limiting (20 checks a minute per client, plus a global burst limit across every client at once) lives in a Durable Object too, counting in memory, so an abuse guard cannot exhaust KV's write quota. A timed-out call is charged as spent, because Nansen may well have served it, and a 401/402/403 that reports no credits left stops that check immediately.

Two things that are money and look like clock problems:

- **A reservation nobody settles is charged, not refunded.** A request that dies after Nansen has served it reports nothing, and an unknown outcome is not a zero one. The hold is charged at its worst case and marked uncertain; a settle arriving later corrects it to what it really cost, once, however many times it is redelivered.
- **Midnight resets the daily cap and nothing else.** The account balance is the account's, not the day's; a reservation belongs to the day it was taken on and settles against that day. When the breaker trips on an empty balance, one check an hour is let through to find out whether credits have arrived, because otherwise nothing would ever ask.

A Durable Object runs one JavaScript thread, which is not the same as one request at a time: the thread yields at every await and two requests interleave around I/O. What makes storage safe is the runtime's gates, so the code is written for the weaker guarantee - concurrent callers wait on one load rather than each building their own state.

KV keeps what it is good at: cached results and saved readings. The per-day call counts moved into the budget object with the money, because a read-modify-write on one shared key loses counts whenever two checks finish together, and those counts are what this submission rests on.

## Three stages, and what an answer has to look like before it is used

A check is three stages with one contract between each ([`src/api/check.ts`](../src/api/check.ts) is only that composition):

1. **Observe** ([`src/api/observe.ts`](../src/api/observe.ts)): every request a check makes, and nothing else. It returns an `Observation` - features, coverage of each source, notes - and decides no verdict.
2. **Interpret** ([`src/engine/interpret.ts`](../src/engine/interpret.ts)): the rules, applied to an `Observation` and nothing else. No rule can reach a source, so a saved reading can be judged again under newer rules without a single request, which is what [`scripts/reexplain.ts`](../scripts/reexplain.ts) and the gallery do.
3. **Present**: the summary, the evidence, the exposure breakdown and the share card, in words from the verdict and the observation.

The split was held to what the one long function produced before it: twelve whole results pinned as snapshots on recorded real answers and a fixed clock ([`test/api/check-golden.test.ts`](../test/api/check-golden.test.ts)) - the main paid path, a failed source, no Nansen, a chosen position, an expired deadline and the rest - and to sixteen replays of live Hyperliquid answers for eight accounts, identical byte for byte before and after.

Every upstream answer passes [`src/sources/validate.ts`](../src/sources/validate.ts) before any of it is used. Two rules:

- **A wrong envelope is not read at all.** A list that is not a list, a spot state that is not an object: that throws the same error a failed request does, so a source answering garbage and a source that is down end in the same place.
- **A wrong row is left out, counted, and lowers the claim.** An order with a size of `"abc"` used to become NaN inside a notional sum, and a side that was neither buy nor sell became a sell. Now an order that is not one leaves the orders read in part, and in-part orders cannot support "quotes nothing", so the position is not called a clean bet. A spot balance that is not one leaves a short's cover open rather than at zero; a fill that is not one is left out of the trading figures and said to be; a Nansen balance makes the cover found on other chains a floor. Open interest decides nothing, so perp metadata of the wrong shape only hides it.

The checks were calibrated on the recorded fixtures and on live answers for eight accounts taken on 24 September; not one real row is refused. That calibration is what caught Hyperliquid **portfolio margin**: a borrowed balance arrives as a negative spot `total` beside a `borrowed` amount, and collateral as `supplied` with its loan-to-value. The demonstration account for "Hedged" owes 17,967,395 USDC against the 443,316 HYPE it holds against its HYPE short - the carry trade Hyperliquid's own documentation describes. A validator that refused negative totals would have turned that reading into "hedge not checked"; the holdings normaliser, which drops balances that are not above zero, had been losing the loan without a word. Now a loan is listed with the reading, and a loan in the position's own coin - owed and not held, it works as a short - stands next to the answer. No rule counts a loan either way, so the rules and their version did not change.

## A reading's own picture, and the CPU budget it has to fit in

A link preview needs a real image, and neither X, Telegram nor Discord will render an SVG for one - it has to be a rasterized PNG ([`src/engine/ogRender.ts`](../src/engine/ogRender.ts) builds the picture with [`satori`](https://github.com/vercel/satori), a flexbox layout engine, and rasterizes it with [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js)).

That render is not free, and the Workers **free** plan's CPU budget is 10 ms per request. Measured directly, on the real `workerd` runtime and independently in Node: **roughly 26-28 ms warm, up to 127 ms on a cold isolate.** A minimal one-line card alone measured 40 ms cold - there is no version of this render that reliably fits a 10 ms budget. A **paid** plan's default 30 s budget clears it with room to spare.

The first version drew the picture on the crawler's own request, inside a `try/catch`, on the theory that the worst case was a generic fallback picture. It was not: a request over its CPU limit is stopped by the runtime, which answers with Error 1102, and no catch block runs. A crawler that met that on a cold isolate got an error where the picture should be, and the fallback went out marked immutable for a year, so a crawler that came early kept the fallback for good ([S04](audits/2026-09-23-full-audit-ru.md)). Now the render is never on a path anyone waits for:

- **A crawler's request never draws.** `GET /api/og` reads the picture from KV if it exists and otherwise serves a small, always-bundled standing picture ([`assets/og-fallback.png`](../assets/og-fallback.png)) with a one-minute cache, so a crawler that comes back later finds the real one. Only a picture that exists is served as immutable.
- **Drawing is a request of its own that nothing displays.** The page sends `POST /api/og` once a live reading is saved, and again when its Share button is opened - before any crawler has the link. If that request is stopped for CPU, the reader's page does not notice and a crawler still gets the standing picture rather than an error. A paid plan's 30 s budget clears the render with room to spare; the free plan's "some built-in flexibility" for an isolate that goes over only occasionally is what lets it succeed most of the time there.
- **Every bundled card's picture is rendered once, offline.** [`scripts/prerender-og.ts`](../scripts/prerender-og.ts) runs the same renderer in a plain Node process - no CPU limit there at all - over the gallery and the four demonstration readings, and uploads the results into the same KV namespace (`wrangler kv bulk put`) under the key the Worker itself uses.
- **The layout is part of the key and the URL** (`og:v3:<id>`, `/api/og?id=<id>&v=3`). A reading never changes under its id, but what its picture says about it did: version 2 added the date and the reading's own limit ([U02](audits/2026-09-23-full-audit-ru.md)), and version 3 draws what the account's funders hold beside the bar on a dashed line, as the page and the downloaded picture already did. A new layout is a new key and a new URL, so no stored or crawler-cached picture from an older one can stand in for it.

## A reading KV has not shown yet

KV is eventually consistent: a write is visible at once where it was made and can take up to a minute to show everywhere else. A shared link is opened, and fetched by a crawler, within that minute all the time. So a saved reading that cannot be found answers 404 with `cache-control: no-store` and says it may have expired or may not have reached this region yet, rather than "never existed"; the page retries it for about twenty seconds, saying why, before giving up; and the picture route's standing picture is cached for a minute, not a year. Reproduced on workerd with a KV that lags (below).

## What the Worker counts

Every check, picture and saved-reading request leaves one line of JSON ([`src/telemetry.ts`](../src/telemetry.ts)), and Workers Logs indexes its fields, so the dashboard's query builder can group by them and take percentiles over them. No binding and no second store: the measurements the 23 September audit asked for ([S06](audits/2026-09-23-full-audit-ru.md)) are queries over those lines.

| To see | Query in Workers Logs |
|---|---|
| Latency | P50 and P95 of `ms`, where `event` = `check`, grouped by `outcome` |
| Cache hits | count grouped by `outcome` (`fresh` against `cached`) |
| Degraded answers | count where `outcome` = `fresh`, grouped by `degraded` |
| Why a verdict came out Unknown | count where `verdict` = `unknown`, grouped by `reason` |
| What a full answer costs | sum or P95 of `credits` and `nansenCalls` where `outcome` = `fresh` |
| Budget refusals | count grouped by `nansenOff` |
| Readings that could not be kept | count where `saved` = false |
| Link pictures | count where `event` = `picture`, grouped by `outcome` (`served`, `stand_in`, `drawn`, `draw_failed`, `save_failed`) |
| KV trouble | count where `kvDegraded` = true |
| Links that found nothing | count where `event` = `snapshot` and `outcome` = `missing` |

A failure goes out at error level. What never goes in: the Nansen key, the demo key, the client's IP and the wallet address; none of them is needed to count anything, and a KV failure line names the kind of key (`check`, `snapshot`, `og`) rather than the key itself, which is usually an address. A draw stopped by the runtime for CPU leaves no line of its own; it shows up as an `exceededCpu` outcome on the platform's invocation log for that request. One request in ten is traced, which at this site's traffic stays far inside the free plan's 200,000 observability events a day. None of this is shown to the reader of a card.

## Tested in the real runtime

The route tests drive the Worker through in-process fakes of KV and the Durable Objects. Those prove the routing and the arithmetic, and do not model what the audit named ([S05](audits/2026-09-23-full-audit-ru.md)): input and output gates, an object restarting with only its storage, a reader disconnecting, KV failing or lagging. [`test/runtime/`](../test/runtime/) builds the Worker with Wrangler exactly as `wrangler deploy` does and runs it inside workerd through Miniflare, the library Cloudflare's own Vitest integration is built on; that integration needs Vitest 4, and this project is on 5. `npm run test:runtime`, and in CI after the rest:

- Twelve paid checks arriving together never hold or spend more than the cap, and once they finish the cap is charged exactly the calls Nansen received.
- A settle delivered twice is charged once, including when the second comes after the process restarted; a hold taken before a restart still stands against the cap after it.
- Twenty ledger records arriving together right after a restart all count: they wait on one load of the object's state.
- A reader who disconnects while Nansen has not answered leaves the check's worst case held, not handed back.
- The global burst limit lets exactly ten of twenty-five simultaneous checks through.
- With KV down, a check still answers, says it could not be kept and offers no link, the budget still settles, and the picture route still answers with the standing picture; with KV refusing writes (the free plan's daily quota), a repeat is a real second check and is charged as one.
- With KV lagging, a saved reading's early 404 is `no-store` and does not say "never existed", and the same link opens once KV catches up.

## Security

Checked against a twelve-point launch checklist ([`docs/specs/2026-09-17-bet-or-book-design.md`](specs/2026-09-17-bet-or-book-design.md), section 9): no logins, sessions, uploads, webhooks or SQL; every user input is validated before it becomes a request path or a KV key - an address matched by `0x` plus 40 hex characters, a coin and a side against a short allow-list, a snapshot id against its own pattern; the Worker calls two fixed upstream hosts; the key lives in a Worker secret and `.dev.vars` (git-ignored, absent from the whole history); errors reach the client as a generic message; `npm audit` reports 0 vulnerabilities.

The two embedded fonts ([`assets/inter-regular.woff`](../assets/inter-regular.woff), [`assets/inter-bold.woff`](../assets/inter-bold.woff)) are Inter, [SIL Open Font License 1.1](https://openfontlicense.org/), fetched once from Google Fonts and committed rather than downloaded on every render.

The two rendering dependencies (`satori`, `@resvg/resvg-wasm`) never see anything a caller supplies directly: every string that reaches them - the badge, the summary sentence, the footer - already passed through this Worker's own formatting functions, and satori treats a JS string as a literal text node rather than markup, the same guarantee `textContent` gives the page. `og-fallback.png` and the two font files are static, checked-in binaries loaded once per isolate; no font or image is ever fetched from the network.

Two things the 21 September audit changed here. **Starting a check is a POST from this site**, because GET and HEAD ran the paid branch and a link preview, a browser prefetch or a scanner could spend credits by looking; GET and HEAD now return an answer that already exists, or 404, and spend nothing. And the page's script moved into a file of its own, so its Content-Security-Policy forbids inline script outright rather than allowing it - along with `frame-ancestors 'none'`, no cross-origin requests and no plugin content. A reserve of the daily cap is kept out of the public path so an afternoon of visitors cannot leave the demo with a Hyperliquid-only answer.

Two more from 23 September. Opening `?address=...` in a browser used to run the check itself, on load, with no click involved - a same-origin POST is exactly what a same-origin `fetch()` triggered by any page a reader had open could also send, so a crafted link was one open-in-a-tab away from spending credits; the URL now only fills the field, and `Check` is a separate, deliberate action ([S01](audits/2026-09-23-full-audit-ru.md)). And the operator key that reaches the demo reserve moved from a `?demo=` query parameter to an `x-demo-key` request header: a query string is what ends up in browser history, server access logs, and the URL bar of a screen recording made for this project's own submission video, which is the specific way this was found. The check for it also moved ahead of the public rate limiter and the global burst limiter, and a demo request now skips both outright - a reserve that still has to clear the same gate the public traffic just exhausted is not a reserve. An empty or unset `DEMO_KEY` can no longer grant it to anyone by accident ([S03](audits/2026-09-23-full-audit-ru.md)). The key is compared as SHA-256 digests, so a guess learns nothing from how long the comparison took. And the operator has a way to use it that never touches a URL: opening `/#operator` once, before recording, asks for the key, checks it at `POST /api/demo-access` there and then - so a wrong key is found before the recording, not on it - and keeps it in that browser only, sent as a header with a check and never shown.
