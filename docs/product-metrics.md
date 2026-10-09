# Anonymous product events

The browser sends enum-only POSTs to `/api/events`. Worker logs record `event=usage`, `outcome`, `kind`, `entry`, and `incomplete`. No wallet, free text, source URL, snapshot ID, persistent user identifier, IP or key is included in the event body or custom log. Existing platform invocation logs and their access policy still apply.

`landing_view → example_open/check_start → reading_view → share_copy/watch_save → repeat_read` can be counted by event name, saved/live/gallery kind, shared-link/home entry and completeness. Paid-check telemetry separately reports cache hits, failures and spend. Anonymous events cannot be joined into individual user journeys.

`repeat_read` means a page session opened a reading after this browser had previously opened one. A local boolean supplies that signal; it is not a user identifier and does not establish unique people. One repeat event per page, and one reading event per snapshot per page, avoid counting Explore return/redraw as new reads. Local development and browsers with an operator key do not send events.

Collection is best effort: blockers, failed requests, disabled local storage and page limits cause undercounting; scripted clients can still send valid events. No historical traffic is reconstructed. Do not call these unique users, validated retention or real interviews. Logging starts only after deployment.

The endpoint rejects extra fields, unknown values and bodies over 256 bytes; a stalled body is cancelled after three seconds. It uses existing request gates: 60 events/minute/IP and 300/minute globally, separate from paid-check admission, with no provider calls and no KV writes. The browser sends at most 25 events per page and never blocks the UI or retries a failed event.
