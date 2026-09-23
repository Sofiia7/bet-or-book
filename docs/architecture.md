# Budget, rate limiting, and security

The [README](../README.md) links here for how the spend cap actually holds, and what the 21 September security audit changed.

## Every credit has to be able to change the answer

A check reads in stages ([`src/api/check.ts`](../src/api/check.ts)):

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

## A reading's own picture, and the CPU budget it has to fit in

A link preview needs a real image, and neither X, Telegram nor Discord will render an SVG for one - it has to be a rasterized PNG ([`src/engine/ogRender.ts`](../src/engine/ogRender.ts) builds the picture with [`satori`](https://github.com/vercel/satori), a flexbox layout engine, and rasterizes it with [`@resvg/resvg-wasm`](https://github.com/yisibl/resvg-js)).

That render is not free, and the Workers **free** plan's CPU budget is 10 ms per request. Measured directly, on the real `workerd` runtime and independently in Node: **roughly 26-28 ms warm, up to 127 ms on a cold isolate.** A minimal one-line card alone measured 40 ms cold - there is no version of this render that reliably fits a 10 ms budget. A **paid** plan's default 30 s budget clears it with room to spare.

So the render is never load-bearing:

- **Every gallery card's picture is rendered once, offline, before it is ever requested.** [`scripts/prerender-og.ts`](../scripts/prerender-og.ts) runs the same renderer in a plain Node process - no CPU limit there at all - and uploads the results straight into the same KV namespace the deployed Worker reads (`wrangler kv bulk put`), under the key a live render would have used anyway. `/api/og` for any of the 277 gallery cards is a cache read, not a render, from the day this last ran.
- **A freshly live-checked address is attempted for real**, because there is no way to pre-render a reading that does not exist yet. If it renders in time, it is cached in KV the same way and every later request is a cache read. If the isolate is cold and it does not, the route falls back to a small, always-bundled generic picture ([`assets/og-fallback.png`](../assets/og-fallback.png)) rather than a broken image link - which is exactly what every reading's preview looked like before this existed. Nothing that calls `/api/og` is ever this site's own code, so a slow or failed render here costs nothing else: the check itself, the page, and every other route are unaffected either way.

## Security

Checked against a twelve-point launch checklist ([`docs/specs/2026-09-17-bet-or-book-design.md`](specs/2026-09-17-bet-or-book-design.md), section 9): no logins, sessions, uploads, webhooks or SQL; every user input is validated before it becomes a request path or a KV key - an address matched by `0x` plus 40 hex characters, a coin and a side against a short allow-list, a snapshot id against its own pattern; the Worker calls two fixed upstream hosts; the key lives in a Worker secret and `.dev.vars` (git-ignored, absent from the whole history); errors reach the client as a generic message; `npm audit` reports 0 vulnerabilities.

The two embedded fonts ([`assets/inter-regular.woff`](../assets/inter-regular.woff), [`assets/inter-bold.woff`](../assets/inter-bold.woff)) are Inter, [SIL Open Font License 1.1](https://openfontlicense.org/), fetched once from Google Fonts and committed rather than downloaded on every render.

The two rendering dependencies (`satori`, `@resvg/resvg-wasm`) never see anything a caller supplies directly: every string that reaches them - the badge, the summary sentence, the footer - already passed through this Worker's own formatting functions, and satori treats a JS string as a literal text node rather than markup, the same guarantee `textContent` gives the page. `og-fallback.png` and the two font files are static, checked-in binaries loaded once per isolate; no font or image is ever fetched from the network.

Two things the 21 September audit changed here. **Starting a check is a POST from this site**, because GET and HEAD ran the paid branch and a link preview, a browser prefetch or a scanner could spend credits by looking; GET and HEAD now return an answer that already exists, or 404, and spend nothing. And the page's script moved into a file of its own, so its Content-Security-Policy forbids inline script outright rather than allowing it - along with `frame-ancestors 'none'`, no cross-origin requests and no plugin content. A reserve of the daily cap is kept out of the public path so an afternoon of visitors cannot leave the demo with a Hyperliquid-only answer.
