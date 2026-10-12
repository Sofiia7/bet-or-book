// Read-only bot adapter: prints a dated message for a saved reading.
// Never sends to Telegram or any external recipient.
import { isSnapshotId } from '../src/snapshot';
import type { PublisherReading } from '../src/publisher';
const id = process.argv[2];
if (!id || !isSnapshotId(id)) throw new Error('Usage: node --import tsx scripts/publisher-message.ts <saved-reading-id>');
const res = await fetch('https://bet-or-book.trade/api/v1/readings/' + encodeURIComponent(id), { signal: AbortSignal.timeout(15000) });
if (!res.ok) throw new Error('Saved reading unavailable: ' + res.status);
const r = await res.json() as PublisherReading;
console.log([r.headline, 'Read: ' + r.checkedAt, r.takeaway, r.limits.join(' '), r.attribution, r.link].join('\n\n'));
