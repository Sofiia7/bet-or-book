# Security

Bet or Book reads public data and tells a reader what stands behind a Hyperliquid position. It has no login, no wallet connection, no uploads and no custody. This page says what the project trusts, what the scanners found on 12 October 2026 and what the code does about each finding. It is a dated triage, not a guarantee: nothing exploitable was found within what is listed under "What was checked", and what was not checked is listed too.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the repository's Security tab, "Report a vulnerability". If that button is not available, open an issue titled "Security contact request" without any technical detail and a private channel will be arranged. Please do not publish a vulnerability before it is fixed.

## What the project trusts

| Thing | Where it lives | What it can do | What limits it |
|---|---|---|---|
| Nansen API key | Worker secret, local git-ignored `.dev.vars` | Spends data credits | A daily cap and an account floor held in a Durable Object, reserved before a check and settled after it; a refusal degrades the answer to Hyperliquid-only and says so |
| Operator demo key | Worker secret | Reaches the credits kept in reserve for the demo | Compared as SHA-256 digests; an unset or empty key matches nothing; the endpoint that tests a key is limited to 5 requests per minute |
| Cloudflare account | Owner's login | Deploys the Worker, reads KV and Durable Objects | Owner's own controls |
| Monitoring token | Browser local storage, 72-character random capability | Reads, stops and removes one monitor | Four slots in all, 72 hours, one subscription per connection per day; never returned by the status call |

## What the scanners found

| Finding | What the code does | Verdict |
|---|---|---|
| gitleaks over the whole git history: 614 hits, 612 in tests, fixtures or names of browser storage keys | Fixtures are recorded API responses with label fields set to null; storage key names are not secrets | Noise |
| gitleaks: two hits outside tests, in `docs/audits/2026-10-08-reproduce.ts` and `docs/audits/2026-09-23-reproduce.ts` | Each is the public contract address of WETH on Ethereum inside an audit reproduction script | False positive |
| Real keys in history | `.dev.vars` and `.env` are git-ignored and were never tracked; only `.dev.vars.example` with a placeholder is. The browser bundle and the page contain no key | None found |
| `npm audit` | Zero known vulnerabilities across production and development packages on 12 October | Clean, dated |
| Public links without signing in | The site, a saved reading, the widget, the repository and the project page answer 200 | Clean |

## Known boundaries

- `POST /api/check` refuses requests that other websites make through a visitor's browser, but allows command-line clients, because refusing them would only refuse people using the API on purpose. It is bounded by per-connection and global rate limits and by the credit budget.
- `GET /api/v1/readings/<id>` sends `Access-Control-Allow-Origin: *`. It serves only saved readings, which are public data about public blockchain addresses, and never starts a check. No other route allows cross-origin reads.
- Saved readings are addressed by a hash of the wallet address, the check time, the rules version and the question asked. The identifier is derived, not secret: anyone who knows an address and the exact millisecond of a check can compute it. Readings are public by design and hold only a public wallet address and numbers already public on chain, but a shared link does show that someone looked that address up. There are no accounts, so there is no per-user data to impersonate or enumerate, and the only listing, `/api/gallery`, is a curated set.
- The main page's content security policy admits one outside origin, Cloudflare Web Analytics, because the zone injects its beacon into every page. Everything else is same-origin and inline scripts are forbidden.
- The browser keeps saved positions in local storage, on that device only. Clearing site data removes them.
- No web application firewall rule is applied at the edge yet; the exact rule is prepared in `docs/cloudflare-edge-protection.md`.
- The Workers free plan counts Durable Object rows read and KV writes per account, not per Worker. Another Worker on the same account used up the day's row allowance on 11 and 12 October. The Worker then answers from Hyperliquid alone and says why; `docs/architecture.md` describes it.

## What was checked

Secret scan over the whole git history and the shipped bundle, full `npm audit`, response headers and error bodies of the live site (no cookies, generic error messages, no stack traces, CORS only on the publisher API), the check, picture, monitoring and operator endpoints for same-site and rate-limit behaviour in code and in 717 automated tests plus 12 tests that run the built Worker inside workerd, and the links in the submission. Not checked: behaviour on a physical phone, a penetration test by a third party, and the Cloudflare account's own access settings.
