# Security

Bet or Book reads public data and tells a reader what stands behind a Hyperliquid position. It has no login, no wallet connection, no uploads and no custody. This page says what the project trusts and what the Worker sends where, what the scanners found on 12 October 2026 and what the code does about each finding. It is a dated triage, not a guarantee: nothing exploitable was found within what is listed under "What was checked", and what was not checked is listed too.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the repository's Security tab, "Report a vulnerability". If that button is not available, open an issue titled "Security contact request" without any technical detail and a private channel will be arranged. Please do not publish a vulnerability before it is fixed.

## What the project trusts

| Thing | Where it lives | What it can do | What limits it |
|---|---|---|---|
| Blockscout API key (optional, `BLOCKSCOUT_API_KEY`) | Worker secret, local git-ignored `.dev.vars` | Reads public chain data from Blockscout's universal API on the owner's account allowance (20 credits a call, 100K a day on the free tier); without it Ethereum is read keyless and Arbitrum funding links are not read | Sent only in an `Authorization` header, never in a URL, a log line, a note or a stored reading; the explorer reader does not follow redirects, so the header cannot be forwarded elsewhere; a value that is not visible ASCII is not used; a check stops itself at 45 outbound requests |
| Operator demo key (optional, `DEMO_KEY`) | Worker secret | Lets a request skip the public rate limits and tags it `demo` in telemetry | Compared as SHA-256 digests; an unset or empty key matches nothing; the endpoint that tests a key is limited to 5 requests per minute |
| Data sources, below | Third-party services | Answer with public data about a wallet address | Every answer is shape-checked before use; an answer that does not parse reads as "not read", never as an empty result, and lowers the coverage; where that source is one of the deciding reads (positions, orders, holdings, the funder search) the verdict is withheld, while the PnL and a long's funding history are context only and decide nothing |
| Cloudflare account | Owner's login | Deploys the Worker, reads KV and Durable Objects; serves the page and its Web Analytics beacon | Owner's own controls |
| Monitoring token | Browser local storage, 72-character random capability | Reads, stops and removes one monitor | Four slots in all, 72 hours, one subscription per connection per day; never returned by the status call |

Nansen is no longer a third party of this project: the Worker makes no Nansen request and holds no Nansen key. A leftover `NANSEN_API_KEY` secret on an older deployment is never read, and the retired `NansenBudget` Durable Object class (kept under its name because deleting a class takes a migration) answers 410 to anything and reads and writes nothing. Readings made with Nansen in September and October remain as dated, saved facts and keep their Nansen credit.

## What the Worker sends where

A check sends the checked wallet address, and the addresses of up to two wallets that funded it, to the services below, from Cloudflare's network. Nothing identifies the visitor: the visitor's IP address and the operator key are never put in a request to a data source, a log line or a stored reading, and the explorer key goes only to Blockscout, in its `Authorization` header, and nowhere else.

| Service | Host | What is sent | What comes back |
|---|---|---|---|
| Hyperliquid info API | `api.hyperliquid.xyz` | The address, in the body of read-only `info` requests (positions per dex, orders, fills, spot balances, market data, the 30-day PnL) | Public account and market state |
| PublicNode JSON-RPC | `ethereum-rpc.publicnode.com`, `arbitrum-one-rpc.publicnode.com` | The address, inside read-only `eth_call` requests (one Multicall3 call per chain per wallet) | Token and native balances |
| Hyperliquid's EVM RPC | `rpc.hyperliquid.xyz/evm` | The same read-only call for HyperEVM | Token and native balances |
| Blockscout | `eth.blockscout.com` without a key (Ethereum only), `api.blockscout.com` with one (Ethereum and Arbitrum) | The address, in the path or query of a read-only transactions request: the Ethereum list, the Arbitrum Etherscan-style `txlist`, and, for the sender of an Arbitrum link, that sender's Ethereum list (a third request) | The first transactions, from which the first funder is taken; the sender's tag names are used once to decide whether it is an exchange or bridge, and are not kept. A check with an Arbitrum link makes about 3 explorer calls (60 credits of the free allowance) |
| Cloudflare | Cloudflare's own network | The page, the API, KV (cached and saved readings, which hold public wallet addresses and numbers), Durable Objects (rate limits, the monitoring pilot), and the Web Analytics beacon the zone injects | n/a |

Those hosts are the only ones the Worker calls; a test asserts that no request reaches Nansen with or without an explorer key. The page itself makes requests to its own origin and, for the analytics beacon, `cloudflareinsights.com`.

## What the scanners found

| Finding | What the code does | Verdict |
|---|---|---|
| gitleaks over the whole git history: 614 hits, 612 in tests, fixtures or names of browser storage keys | Fixtures are recorded API responses with label fields set to null; the explorer fixtures added since keep only the fields the reader uses, with each sender's metadata cut down to its tag names; storage key names are not secrets | Noise |
| gitleaks: two hits outside tests, in `docs/audits/2026-10-08-reproduce.ts` and `docs/audits/2026-09-23-reproduce.ts` | Each is the public contract address of WETH on Ethereum inside an audit reproduction script | False positive |
| Real keys in history | `.dev.vars` and `.env` are git-ignored and were never tracked; only `.dev.vars.example` with a placeholder is. The browser bundle and the page contain no key | None found |
| `npm audit` | Zero known vulnerabilities across production and development packages on 12 October | Clean, dated |
| `npm audit --omit=dev`, 9 November | One moderate advisory in the production dependency `satori` 0.32.0: GHSA-wx4j-mvgx-mqwp, improper escaping in generated SVG. The fix is satori 0.63.2, a major upgrade of the picture renderer, tracked as a follow-up. What reaches satori is text the Worker builds from a reading, of which only coin and dex names come from outside, and the SVG it makes is rasterized by `@resvg/resvg-wasm` without fetching anything | Open, low exposure; follow-up |
| Public links without signing in | The site, a saved reading, the widget, the repository and the project page answer 200 | Clean |

## Known boundaries

- `POST /api/check` refuses requests that other websites make through a visitor's browser, but allows command-line clients, because refusing them would only refuse people using the API on purpose. It is bounded by per-connection and global rate limits and, per check, by a budget of 45 outbound requests.
- `GET /api/v1/readings/<id>` sends `Access-Control-Allow-Origin: *`. It serves only saved readings, which are public data about public blockchain addresses, and never starts a check. No other route allows cross-origin reads.
- Saved readings are addressed by a hash of the wallet address, the check time, the rules version and the question asked. The identifier is derived, not secret: anyone who knows an address and the exact millisecond of a check can compute it. Readings are public by design and hold only a public wallet address and numbers already public on chain, but a shared link does show that someone looked that address up. There are no accounts, so there is no per-user data to impersonate or enumerate, and the only listing, `/api/gallery`, is a curated set.
- The main page's content security policy admits one outside origin, Cloudflare Web Analytics, because the zone injects its beacon into every page. Everything else is same-origin and inline scripts are forbidden.
- The browser keeps saved positions in local storage, on that device only. Clearing site data removes them.
- No web application firewall rule is applied at the edge yet; the exact rule is prepared in `docs/cloudflare-edge-protection.md`.
- Blockscout's terms for its PRO API on displaying, storing or redistributing data were not on display when the explorer was adopted (2026-11-09); the owner reads the terms shown at sign-up. The keyless public Ethereum host is deprecated by Blockscout in favour of the keyed API and sits behind bot protection, so it can start refusing at any time; a chain that cannot be read is reported as not read; where that read decides the verdict (the funder search for a short) the verdict is withheld, never loosened, and a context read (the PnL, a long's funding history) withholds nothing. The terms and limits of PublicNode and of Hyperliquid's EVM RPC were read on 2026-11-09 and are quoted in the design spec.
- The Workers free plan counts Durable Object rows read and KV writes per account, not per Worker. Another Worker on the same account used up the day's row allowance on 11 and 12 October; the build of that date, which kept its Nansen credit meter in a Durable Object, then answered from Hyperliquid alone and said why. The meter is gone, a check reads no Durable Object storage (the rate limiter counts in memory), and the monitoring pilot's state and KV writes are still shared per account; `docs/architecture.md` describes it.

## What was checked

Secret scan over the whole git history and the shipped bundle, full `npm audit`, response headers and error bodies of the live site (no cookies, generic error messages, no stack traces, CORS only on the publisher API), the check, picture, monitoring and operator endpoints for same-site and rate-limit behaviour in code and in automated tests (717, plus 12 that run the built Worker inside workerd, on 12 October; 1,402 plus 8 now, after the move off Nansen), and the links in the submission. Not checked: behaviour on a physical phone, a penetration test by a third party, and the Cloudflare account's own access settings.
