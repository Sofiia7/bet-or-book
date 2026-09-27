# Bet or Book - design

Date: 17.09.2026. Status: approved verbally, awaiting review of this file.

## 1. Goal

A public web page for the Nansen Meridian Buildathon (14-27.09.2026, deadline
27.09 23:59 UTC, results 01.10). A person sees a viral post "a whale opened a
$190M short", pastes a Hyperliquid address and within 10 seconds gets a
verdict: is this a bet, a hedge or a market maker's book, and is it worth
copying.

The contest criteria, 25% each, and how we answer them:

| Criterion | Answer |
|---|---|
| Nansen data drives the logic rather than just being displayed | the verdict is computed from positions, trades, related wallets and balances on other chains - all from Nansen |
| Originality ("we have seen dashboards") | among the public submissions as of 17.09 nobody classifies an address as a bet, a hedge or a book |
| Live data, no crashes | a live link, a cache, an honest Unknown verdict instead of a crash |
| README, a recording without voice, launch in 10 minutes | README in English, a script for a 30-60 s video |

Participation requirements: 1 000 API calls within the contest window from the
account whose email is given in the form; a demo on X tagging @nansen_ai; a
public GitHub repository.

The language of the product and the README is English. This document was
written as a working document in Russian and translated on 27 September.

## 2. Scenario

1. A person opens the page and pastes an address `0x...` or any link that
   contains an address (HyperDash, Hypurrscan, a Nansen profile).
2. Within 1-3 seconds they see a card: the verdict, a one-line explanation,
   3-5 pieces of evidence with a named source, a "what we cannot see" block.
3. If the trade history has not been read yet (limit of 5 requests per
   minute), the card shows the verdict based on positions and orders, and the
   history rows are marked "queued" and load on their own.
4. The "Copy card" (image to clipboard) and "Copy link" (permanent link
   `/a/0x...`) buttons - to reply under the post.
5. The second page is a gallery "Biggest positions right now: bet, hedge or
   book?" with pre-computed verdicts for the largest positions.

There are no trading buttons, copy trading or position-size recommendations,
and there never will be: the tool only inspects.

## 3. Verdicts

Four outcomes. The rules are applied in order; the first one that fires wins.

| No. | Verdict | Condition (initial thresholds) | Text |
|---|---|---|---|
| 0 | Unknown | no position data from any source, or there are no open positions | the reason is stated explicitly |
| 1 | Book | any of: (a) positions >= 20 and net/gross <= 0.35; (b) resting limit orders >= 50, bid share between 25% and 75%, coins with orders on both sides >= 5; (c) trades per day >= 200 and share of spread-crossing trades <= 40% | "This is a market-making book. There is nothing to copy." |
| 2 | Hedged | the opposing leg covers >= 50% of the headline position; or positions between 2 and 19 and net/gross <= 0.35 | "The headline position is not a directional view." |
| 3 | Looks like a bet | positions <= 5, net/gross >= 0.8, headline position >= 50% of gross, opposing leg < 10%, no two-sided orders | "Looks like a bet. A hedge on a centralized exchange would be invisible to us." |
| 4 | Unknown | the features disagree | the features are printed |

Strength of the Book verdict: one of the three features firing - "likely", two
or more - "strong".

The thresholds live in a single configuration object. A threshold is
considered accepted only after it has shown both outcomes on live addresses:
both when it fires and when it does not. Addresses with a known answer for
calibration: the Wintermute account (a book; there is a public breakdown on
GitHub), Abraxas (a hedged book, according to media reports), an account of
the "directional whale" class from public sagas (a bet). The addresses
themselves are collected at the planning stage from open sources.

### Features

| Feature | How it is computed | Source |
|---|---|---|
| `nPositions` | number of open perp positions | Nansen `profiler/perp-positions` |
| `gross`, `net`, `netToGross` | sum of the absolute notionals; absolute value of the signed sum; their ratio | same |
| `headline`, `headlineShare` | the position with the largest notional; its share of gross | same |
| `restingOrders`, `bidShare`, `coinsBothSides` | limit orders excluding trigger and reduce-only ones; share of bids by count; coins with orders on both sides | Hyperliquid `frontendOpenOrders` |
| `tradesPerDay`, `crossedShare` | trades per day over the period read; share of trades with `crossed = true`; N trades and the period are printed alongside | Nansen `profiler/perp-trades` |
| `hedgeRatio` | (spot of the same coin on the HL account + the same asset in the address's balances on other chains + opposing positions and spot at related wallets) / notional of the headline position | Hyperliquid `spotClearinghouseState`; Nansen `profiler/address/current-balance` (chain `all`), `profiler/address/related-wallets` (chain `arbitrum`, `ethereum`), then `perp-positions` and `current-balance` for the related ones, no more than three wallets |
| `fundingCarry` | sign and amount of the accumulated funding of the headline position; together with `hedgeRatio >= 0.5` yields the "carry trade" label | Nansen `cumulative_funding_since_open_usd` |
| `sizeVsOI` | notional of the headline position / open interest of the market | Hyperliquid `metaAndAssetCtxs` |
| `liqDistance` | distance from the mark price to the liquidation price of the headline position | Nansen `liquidation_price_usd` |
| `realizedPnl30`, `realizedPnl90`, `winRate` | realized PnL and win rate per window | Nansen `profiler/perp-pnl-summary` |

The spot leg needs a mapping table: BTC - UBTC, WBTC, cbBTC, tBTC, BTCB;
ETH - UETH, ETH, WETH, stETH, wstETH, weETH, rETH, cbETH; SOL - USOL, SOL,
mSOL, jitoSOL; HYPE - HYPE, WHYPE; for the rest - a ticker match. Nansen's
`hide_spam_token` is enabled. The list of tokens counted into the leg is
printed in the evidence so that a classification error is visible.

A pair hedge "long A against short B" within a single account is not
recognized separately (a correlation model is needed); `netToGross` partially
catches it.

## 4. Honesty rules

1. **A source failure is not a number.** A failed or empty call marks the
   feature as "not computed" with a reason. If the verdict depended on it -
   Unknown.
2. **One step - one source, and it is named.** Positions are read from
   Nansen. If it is unavailable, reading positions from the public Hyperliquid
   API is allowed, but the card prints "source: Hyperliquid API (Nansen
   unavailable)".
3. **A full page is a sign of continuation.** `perp-trades` is read up to
   three pages of 1 000 each. If the third one is full too, `tradesPerDay` is
   printed as a lower bound ("at least"), and `crossedShare` as a share over
   the sample with N named. Nansen's perp history is reliable from May 2025 -
   the window does not go earlier than that.
4. **Size is not printed without a denominator.** Next to the notional there
   is always the share of the market's open interest.
5. **The "What we cannot see" block is always shown:** centralized exchanges,
   OTC, wallets with no on-chain link to this address.
6. **Wallets, not people.** Nansen address labels are not shown anywhere
   (their public display is prohibited by Nansen's rules, and the verdict is
   built on the account's behavior). There are no names on the card.
7. The "Powered by Nansen API" attribution stands next to the data on every
   page.

## 5. Sources and limits

Verified by reading the documentation on 17.09.2026, not by calling. The
first step after receiving the key is a live check on addresses with a known
answer.

Nansen: base `https://api.nansen.ai/api/v1/`, header `apikey`, all endpoints
are POST. Plan limit: 15 requests per second and 300 per minute (free), 75 and
1 500 (paid). A separate limit for `profiler/perp-trades` - 5 requests per
minute. Cost: most endpoints 1 credit, `tgm/perp-positions` 5. The actual
price is read from the `X-Nansen-Credits-Cost` header and written to the log.

| Endpoint | Purpose | Public display |
|---|---|---|
| `profiler/perp-positions` | account and positions | allowed |
| `profiler/perp-trades` | history, `crossed`, `closed_pnl` | allowed |
| `profiler/perp-pnl-summary` | PnL over a date window | allowed |
| `profiler/address/current-balance` | balances on other chains, chain `all` | allowed |
| `profiler/address/related-wallets` | related wallets, chain is required | allowed, with attribution |
| `tgm/perp-positions` | largest positions per token for the gallery | allowed |
| address labels, `perp-leaderboard`, `smart-money/*` | not used | prohibited |

Hyperliquid: `POST https://api.hyperliquid.xyz/info`, no key. Types:
`frontendOpenOrders`, `spotClearinghouseState`, `spotMetaAndAssetCtxs`,
`metaAndAssetCtxs`, fallback `clearinghouseState`. `userFills` returns no
more than the 2 000 most recent trades - which is why we read the history from
Nansen.

Nansen calls per check: from 7 (one page of history, no related wallets) to
15 (three pages of history and three related wallets).

## 6. Architecture

A Cloudflare Worker (TypeScript) plus static files. Storage is Workers KV.
The free tier is sufficient.

```
src/
  sources/nansen.ts        Nansen client: one method per endpoint, every call goes to the log
  sources/hyperliquid.ts   client for the public Hyperliquid API
  engine/features.ts       pure feature functions, no network
  engine/verdict.ts        pure verdict rules and threshold configuration
  engine/assets.ts         mapping table perp coin - spot tokens
  api/check.ts             check orchestration, cache, credit ceiling
  api/gallery.ts           serves the pre-computed gallery
  api/ledger.ts            call counter
  guard.ts                 address validation, per-IP limit, common errors
  index.ts                 routes
web/                       one page: input, card, gallery, log
scripts/prescan.ts         local gallery run, writes the result and the log
test/                      vitest: features, verdict, clients on recorded responses
```

Boundaries: `engine/*` knows nothing about the network and is tested on
fixtures; `sources/*` knows nothing about the rules; `api/check.ts` only glues
things together.

### Routes

| Route | Response |
|---|---|
| `GET /api/check?address=0x...` | verdict, strength, features (value, source, coverage), the list of what is invisible, check time, history state `ready` or `queued` |
| `GET /api/check?address=0x...&part=history` | loading of the trade history once its turn in the queue has come |
| `GET /api/gallery` | the pre-computed list |
| `GET /api/ledger` | total Nansen calls, per endpoint, since which date |
| `/`, `/a/0x...`, `/gallery`, `/ledger` | pages |

### Cache, queue, ceiling

- The verdict based on positions and orders is cached for 10 minutes, the
  trade history for 6 hours.
- The `perp-trades` queue: a per-minute slot counter in KV; no slot, or
  Nansen answered 429 - the "queued" row, the page re-asks on its own.
- The daily credit ceiling (300 by default, set by a variable): after it,
  live checks return only the cache and suggest the gallery. The counter in
  KV is approximate under races; overrun is bounded by the per-IP limit and
  the cache.

## 7. Gallery and 1 000 calls

`scripts/prescan.ts` runs locally: it takes `tgm/perp-positions` for the 15
tokens with the largest open interest, collects about 100-150 addresses with
the largest positions and runs a full check on each at the pace of the limits
(`perp-trades` - no more than once every 13 seconds). Total: 1 000-1 500
calls, 1 500-2 500 credits including debugging. The result is stored in KV
under one key; the call log under a second one. The `/ledger` page shows the
counter publicly.

**How it actually went, 18.09.** The candidates were taken for free rather
than through `tgm/perp-positions` (5 credits per call with a budget of a
thousand): the public Hyperliquid leaderboard, the top 3 000 accounts by
value, a free `clearinghouseState` for each, ranking by the largest position
(864 accounts with open positions). The checks went from the top down until
credits hit zero: 278 accounts, 898 calls, 3.2 per check on average. The
result lives not in KV but in `data/gallery.json`, which the Worker bundles
into itself and serves on `/api/gallery`; the log is `data/nansen-calls.jsonl`
and the summary `data/ledger.json` on `/api/ledger`, with the counter in the
page footer. The total for the contest window is 1 008 calls, of which 1 004
with a 2xx response.

## 8. Card

Drawn in the browser on a canvas without third-party libraries: the verdict,
a one-line explanation, up to four numbers, a "cannot see" line, the source
attribution, the address in shortened form, the check date. "Copy card" puts
a PNG in the clipboard, "Copy link" - the permanent link.

## 9. Security (launch checklist)

| Item | Verdict |
|---|---|
| Login attempt limit | not applicable: there is no login |
| Secrets | the Nansen key only in a Worker secret; `.dev.vars` in `.gitignore`; a secret scan before the first push |
| IDOR | not applicable: there is no user data |
| Admin requests bypassing checks | there are no admin routes; the prescan runs locally |
| SQL injection | no SQL, only KV |
| Forged webhooks | there are no webhooks |
| Library versions | minimal dependencies (wrangler, typescript, vitest); `npm audit` before launch |
| Session hijacking | there are no sessions |
| SSRF and uploads | third-party URLs are not requested; only the address `0x` + 40 hex is taken from the input by a regex; the source hosts are hardcoded; there are no uploads |
| CORS | own origin only |
| Races | the ceiling counter is approximate, the risk is bounded by the per-IP limit and the cache |
| Leaks in errors | the client gets a generic text; details only in the Worker logs, the key is not written to the logs |

### Re-check 17.09.2026, after KV, cache, rate limit and card

The table above is not edited; this is an addendum to it based on the actual
code at the end of Phase 1.6 (`git log`, the commits for the KV rate limit,
the cache and the card). There is still no Nansen key in the project -
nothing below is about it.

- **Login attempt limit.** The row above about login remains true - there
  was no login and there still is none. But now there is an adjacent
  protection that did not exist at the time of the first table:
  `KVRateLimiter` in front of `/api/check` (`src/guard.ts`, 20 requests per
  IP per 60 seconds), verified live through `wrangler dev` - 25 parallel
  requests produced 23 rejections with 429 and 2 successes, that is, the
  limit really cuts and is not merely declared in the code.
- **Secrets.** `.dev.vars` is confirmed in `.gitignore` line by line
  (`cat .gitignore`). There is still no Nansen key in the tree - there was
  nothing to wire in and nowhere for it to leak from.
- **SQL injection / KV key structure.** There was no SQL and there still is
  none. Verified concretely: the only keys our code writes are
  `` check:${address} `` and `` ratelimit:${key}:${windowStart} `` - and
  `address` has already passed through `extractAddress`
  (`/^0x[0-9a-fA-F]{40}$/` after `.toLowerCase()`) before reaching this
  point, so it physically cannot contain a colon or anything else that breaks
  the key structure. An arbitrary key cannot be injected through the input.
- **SSRF.** The new `?address=` path on the page (Task 4) was verified by
  reading the code, not taken on faith: it simply writes the value into the
  same `#address` field and calls the same `runCheck()`, which reads that
  field and passes it through the same `extractAddress()` - there is no
  separate path to the network here, it is the same input field as before.
- **CORS.** Neither `src/index.ts` nor `web/index.html` contains a single
  `Access-Control-*` header (verified with `grep`) - that is, the
  `Access-Control-Allow-Origin` header is not set at all, and by default the
  browser does not let a foreign origin read the `/api/check` response via
  fetch. This is not "configured", it is the absence of configuration, but
  the effect is the same: own origin only.
- **Races - new, honestly.** Not only is the credit ceiling now approximate
  (and the ceiling does not exist yet either, that is Phase 2), but so is
  `KVRateLimiter` itself: reads and writes to KV are not atomic. The run of
  25 parallel requests confirmed this - the limit fired, but skewed in the
  direction opposite to the one expected (it let through fewer than 20, not
  more): under a real race the limiter in this run erred on the side of
  strictness rather than permissiveness. That is safer for us, but it is not
  a guarantee for every following run - the nature of the race has not
  changed, only the recorded line in the code has changed (`src/guard.ts`,
  the class comment of `KVRateLimiter`), which now states this explicitly
  instead of staying silent.
- **The IP header - spoofable locally, not verified in production.** Found
  during the live check: `wrangler dev` does NOT strip a client-supplied
  `cf-connecting-ip` - sending a forged value created its own separate KV
  rate-limit bucket. On production Cloudflare this header is rewritten by
  their perimeter and cannot be forged from the client - this is documented
  Cloudflare behavior, but we did not verify it live in this session, because
  that requires a real deploy. The row will appear with the fact once the
  deploy happens.
- **Libraries.** `npm audit` was run on 17.09.2026: 0 vulnerabilities.
- **New, not covered by the previous table: the error path in the page
  itself.** During the live check of the card for sharing (Task 4), two real
  bugs were found in the client-side JS, not directly related to server-side
  security but related to the interface's honesty towards the user: (1) the
  fallback path for copying the card opened `window.open()` from an `async`
  callback after an `await` - at that moment the browser no longer considers
  this a direct consequence of the click and silently blocks the popup, while
  the button lied "Opened in a new tab"; fixed by showing the image directly
  on the page, without `window.open()` at all. (2) the canvas itself was
  meanwhile measured at zero size with a lone `max-width: 100%` - replaced
  with the pair `width: 100%; height: auto`. Both were found and fixed only
  thanks to checking in a live browser rather than by reading the code -
  recorded here because "the interface does not lie about what it did" is
  the same principle as "a source failure is not a fact about the world" from
  the project rules, only on the client side rather than the data-source
  side.

### Re-check 18.09.2026, after Phase 2b (Nansen, gallery, log)

For each of the twelve items, based on the code at commit `deaba70` and later.

| Item | Verdict 18.09 | Verified by |
|---|---|---|
| Login attempt limit | there is no login; `/api/check` - 20 requests per IP per 60 s; `/api/gallery` is static; `/api/ledger` - a 60 s memo in the isolate's memory (up to 14 KV reads at a time) | code `src/index.ts`; the limit was verified live on 17.09 (25 parallel - 23 rejections) |
| Secrets | the key only in `.dev.vars` (in `.gitignore`) and in the future Worker secret. The key's value across the whole git history - 0 occurrences, in the working tree - 0, `.dev.vars` was never committed; the patterns `apikey/secret/token/password` in tracked files - 0; non-empty `address_label` in fixtures and data - 0 | `git log --all -p` with counting, without printing the key |
| IDOR | not applicable: there is no user data, everything served is public on-chain data | reading the routes |
| Admin requests bypassing checks | there are no admin routes, the Worker only reads; the prescan and the log are local scripts with the key from `.dev.vars` | reading `src/index.ts` |
| SQL injection | no SQL; KV keys are built from the address after the regex | as on 17.09 |
| Forged webhooks | there are no webhooks | - |
| Library versions | `npm audit` 18.09 - 0 vulnerabilities; no runtime dependencies | running it |
| Session hijacking | there are no sessions or cookies | - |
| SSRF and uploads | the Worker calls two hardcoded hosts; only `0x` + 40 hex is taken from the input; explorer links are built on the page from the validated address and the chain table; there are no uploads | reading the code |
| CORS | no `Access-Control-*` headers; plus CSP `connect-src 'self'` | `curl -I` |
| Races | KV counters are approximate. **New:** when the KV quota is exhausted (1 000 writes per day on the free tier) the rate limit and the daily ceiling would read as "nothing spent" and let everything through. Now `safeKv` marks the request as `degraded`, and such a check runs without Nansen: the page works, no credits are spent | test `test/safeKv.test.ts` |
| Leaks in errors | the client gets 400/429/502 with a generic text; details only in the Worker log; a Nansen client error - the path and the status, without the key; the coverage rows are pre-written phrases | reading the code |

Beyond the list: XSS - the page has not a single `innerHTML`, `insertAdjacentHTML`, `document.write` or `eval` (verified by search), all data goes through `textContent`; page headers - CSP with `frame-ancestors 'none'` and `object-src 'none'`, `nosniff`, `referrer-policy`; the browser console after enabling them - 0 errors.

Verified in production on 18.09 after the deploy: a request with a forged `cf-connecting-ip` is rejected by Cloudflare itself - 403, `error code: 1000`, `Server: cloudflare`, it does not reach the Worker (20 requests out of 20); a normal request from the same address - 200. The limit cannot be bypassed by spoofing the header.

## 10. Tests

Vitest. Test first, then code. Features and verdict - on recorded real
responses from both APIs (fixtures without keys). Clients - contract tests on
the same recordings. One smoke run through `wrangler dev`. Before submission -
three known addresses produce the expected verdicts on the live link.

## 11. Out of scope

Parsing X posts by link; trading and copying; labels and names; other venues;
user accounts; a Telegram bot; server-side rendering of OG images; interface
translations; a correlation model for pair hedges.

## 12. Plan

| Days | What |
|---|---|
| 17-18.09 | spec, plan, skeleton, Hyperliquid client, features and verdict on live Hyperliquid data (no credits needed) |
| 19-20.09 | Nansen client (key and credits needed), calibration on known addresses, the screen and the card |
| 21.09 | gallery, prescan, log |
| 22.09 | security, README, launch checklist |
| 23.09 | video script; Sofia does the recording |
| 24.09 | the X post and the form |
| 25-27.09 | buffer |

Done when: the live link returns the expected verdicts for the three known
addresses; the log has at least 1 000 calls within the contest window; the
README allows the project to be launched in 10 minutes; the 30-60 s video is
understandable without voice; the repository is public; the form has been
submitted.

## 13. What Sofia does

- A separate Nansen key for this application and credits (1 000 free ones in
  the Points Hub plus a top-up of about $10; credits are doubled during the
  contest window).
- She enters the key herself: locally in `.dev.vars`, in the Worker with the
  `wrangler secret put` command. The key's value does not go into the chat,
  git or the logs.
- A separate "yes" for the deploy, for the public repository and for the post.
- Recording the video and publishing the post from her own account;
  submitting the form.

## 14. Risks

1. A hedge on a centralized exchange is not visible: a "bet" cannot be
   proven, only "looks like a bet". Answer: four verdicts and a permanent
   block of what is invisible.
2. A confident mistake about a named fund is worse than no verdict. Answer:
   no names, thresholds are calibrated on known addresses, Unknown when the
   features disagree.
3. The free Hyperliquid API also returns positions - the judges may consider
   Nansen's contribution small. Answer: the hedge leg is searched for only
   with Nansen data (related wallets, balances on other chains), history and
   PnL also come from Nansen.
4. The limit of 5 requests per minute on the trade history. Answer: the
   verdict without history right away, history via the queue and the cache,
   the gallery computed in advance.
5. A public page can burn through the credits. Answer: cache, per-IP limit,
   daily ceiling.
6. Blacklight and Arkham partially cover the mechanics. Answer: our product is
   a verdict on a viral claim and a card for replying, not a tracker.

## 15. Documentation checked against

- Nansen: `docs.nansen.ai/api/overview`, `.../api/hyperliquid/address-perp-positions.md`,
  `.../address-perp-trades.md`, `.../token-perp-positions.md`,
  `.../api/profiler/perp-pnl-summary.md`, `.../address-related-wallets.md`,
  `.../address-current-balances.md`, `.../getting-started/authentication.md`,
  `.../getting-started/rate-limits.md`, `.../guides/redistribution-guide.md`
- Hyperliquid: `hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint`
  and the subpages `perpetuals`, `spot`
- Contest: `nansen.ai/campaigns/meridian-buildathon`
