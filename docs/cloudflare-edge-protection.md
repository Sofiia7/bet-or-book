# Edge quota protection

The Worker already gates paid work and reserves credits atomically. A zone rate-limit rule should additionally reject floods before they consume Worker, KV and Durable Object quotas. Wrangler's current OAuth scopes can deploy Workers but cannot edit WAF rules. This configuration is prepared but not applied.

In the bet-or-book.trade zone, open Security > Security rules and create a rate limiting rule. On a Free zone, use:

```text
http.request.uri.path in {"/api/check" "/api/og" "/api/demo-access"}
```

Count by IP, 30 requests in 10 seconds, Block for 10 seconds. Review any existing rule before replacing it: the Free plan allows one rule. Verify ordinary checks and all four examples, then test the rule with disposable requests that do not start paid checks (GET /api/check without an address).

The original audit suggested matching POST only for free. Current [Cloudflare availability](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability) permits Path and Verified Bot on Free; Method matching requires Business or above. The Free expression therefore covers GET/HEAD too. Avoid challenges for JSON API traffic. Edge counters are not precise spend controls, so keep the Worker budget and request gates.

The HTML response supplies HSTS for 180 days without imposing it on unknown subdomains. Check SSL/TLS > Edge Certificates for zone-wide Always Use HTTPS and HSTS using existing zone settings before expanding coverage. Do not enable preload or includeSubDomains without verifying every affected host.
