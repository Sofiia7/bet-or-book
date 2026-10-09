# Saved-reading publisher pilot

No partner is connected yet. These endpoints read saved evidence only and never start a paid provider check.

`GET /api/v1/readings/{snapshotId}` returns `bet-or-book.reading.v1`: dates, selected position, conclusion, evidence, limitations, attribution and a free saved-reading link. Optional `?claim=directional|spot|ownership|inventory` evaluates that bounded assertion against the same evidence. Unknown/historical/incomplete evidence stays qualified. GET and HEAD are supported; POST cannot check a wallet. CORS allows simple public GET requests.

Use **Copy embed** in Share, or embed the static card:

```html
<iframe src="https://bet-or-book.trade/embed?s=12pk1a43rv3a1"
  title="Bet or Book dated evidence" width="100%" height="600"
  loading="lazy"></iframe>
```

The widget has no script, exposes dates and source limits, and links to the free reading. Its height may need adjustment for the publisher's width. The main application remains unframeable. Transient live snapshots can expire; missing readings return 404 rather than triggering a scan.

Bot message adapter: `node --import tsx scripts/publisher-message.ts <snapshotId>` prints a message with date, limits, attribution and link. It does not send to recipients. A Telegram/email integration needs a chosen channel and credentials; neither is connected.

No commercial licence, redistribution rights, prices, SLA or payment access are promised. Verify data-provider permissions and a real publisher's needs before commercial use.

Core checks skip optional PnL/funding-age context and reserve each paid stage atomically, including retries/pages. Full-context checks retain the original worst-case reservation. Source positions can be reused for up to 60 seconds across asset selections; their source timestamp stays unchanged. Other sources are checked for the selected question. This does not promise a fixed price per reading.

# In-app monitoring pilot

Save a position, then choose **Monitor changes · pilot**. Up to four distinct questions globally, about every four hours, for 72 hours. One job can be leased per UTC hour. The server stores the public address, selected asset/side and baseline; an unguessable browser token controls access. Keep that token private. Stop monitoring removes the server subscription; expiry removes it from active coordination.

Notifications appear when this browser is open. This is not Web Push, email or Telegram. Events are limited to five. Material field changes use the existing 2% comparison threshold; rules-only reinterpretations, older readings and cache hits do not notify. A failed/incomplete/unsaved check pauses a cycle and does not advance the baseline. Each automated check uses the ordinary public budget, with no operator key or demo reserve. Budget limits can delay monitoring.

# Quote diagnostics and calibration

Quote distance uses a fresh L2 midpoint when available, otherwise explicitly labelled mark price. Separate two-sided observations within a 30-minute window are counted using best-effort KV storage, at least a minute apart. They do not establish continuous quoting. These diagnostics do not change the Book thresholds.

`node --import tsx scripts/calibrate-book.ts data/book-labels.json` evaluates independent labels. The checked-in file is empty: there are no independent labels and no measured precision/recall. Supply rows with `reading`, `label` (`book`, `not-book`, `unresolved`), `labelledBy` and independent `basis`. Do not use the classifier's own verdict as ground truth.

HIP-3 provenance comes from the [official venue registry](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals). Registry membership and oracle-updater addresses do not verify underlying identity. Quote reference uses the [official L2 book response](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).
