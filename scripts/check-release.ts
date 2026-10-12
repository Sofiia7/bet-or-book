// Read-only production preflight. Never invokes /api/check, creates a watch,
// writes KV or needs operator credentials. Availability is not demand validation.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CLASSIFIER_VERSION } from '../src/engine/verdict';
import type { CheckResponse } from '../src/api/check';
import type { PublisherReading } from '../src/publisher';

const target = new URL(process.argv[2] ?? 'https://bet-or-book.trade');
if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) throw new Error('Use HTTPS or local HTTP');
const origin = target.origin;
const manifest = JSON.parse(readFileSync('data/og-featured.json', 'utf8')) as { readings: Record<string, string> };
const featured = JSON.parse(readFileSync('data/featured.json', 'utf8')) as { entries: CheckResponse[] };
const expected = featured.entries.filter(r => !r.superseded && !r.historical);
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const dates: Array<{ id: string; checkedAt: string; ageHours: number }> = [];
const verify = (ok: boolean, detail: string) => { if (!ok) throw new Error(detail); };
async function check(name: string, run: () => Promise<string>) {
  try { checks.push({ name, ok: true, detail: await run() }); }
  catch (error) { checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
}
async function get(path: string) {
  const res = await fetch(origin + path, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
  verify(res.status === 200, `${path}: HTTP ${res.status}`);
  return res;
}
await check('Application and browser bundle', async () => {
  const res = await get('/'); const html = await res.text();
  verify(html.includes("Don't Get Rekt") && /src="\/app\.js(?:\?[^"\s]*)?"/.test(html), 'Expected application markup missing');
  verify((res.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"), 'Main application framing protection missing');
  const js = await (await get('/app.js')).text();
  verify(js.includes('Copy reading') || js.includes('copy-reading'), 'Expected browser bundle missing');
  return 'Root and browser script available; main application framing protected';
});
for (const entry of expected) {
  const id = entry.snapshotId;
  if (!id) throw new Error('Current featured reading lacks a snapshot ID');
  await check(`Reading ${id}`, async () => {
    const r = await (await get('/api/snapshot?id=' + id)).json() as CheckResponse;
    verify(r.snapshotId === id && r.checkedAt === entry.checkedAt, 'Saved identity/date differs from bundled reading');
    verify(r.classifierVersion === CLASSIFIER_VERSION && !r.historical && !r.degraded, 'Reading is historical, incomplete or uses different rules');
    verify(r.positions.headlineCoin === entry.positions.headlineCoin && r.positions.headlineSide === entry.positions.headlineSide, 'Different selected question');
    const time = Date.parse(r.checkedAt); verify(Number.isFinite(time) && time <= Date.now() + 60_000, 'Invalid saved timestamp');
    dates.push({ id, checkedAt: r.checkedAt, ageHours: Math.round((Date.now() - time) / 3_600_000 * 10) / 10 });
    return `${r.positions.headlineCoin} ${r.positions.headlineSide}; dated ${r.checkedAt}`;
  });
  await check(`Publisher ${id}`, async () => {
    const r = await (await get('/api/v1/readings/' + id + '?claim=ownership')).json() as PublisherReading;
    verify(r.schema === 'bet-or-book.reading.v1' && r.id === id && r.checkedAt === entry.checkedAt, 'Publisher schema/identity/date mismatch');
    verify(r.claim !== null && r.limits.length > 0 && !!r.attribution, 'Claim, limits or attribution missing');
    const embed = await (await get('/embed?s=' + id + '&claim=ownership')).text();
    verify(embed.includes(entry.checkedAt) && embed.includes('This tool never trades.'), 'Widget date or scope missing');
    return 'API and widget retain the dated evidence and limits';
  });
  await check(`Preview ${id}`, async () => {
    verify(!!manifest.readings[id], 'Featured PNG absent from checked-in manifest');
    const res = await get('/api/og?id=' + id);
    verify(res.headers.get('content-type')?.includes('image/png') ?? false, 'Preview is not PNG');
    const bytes = Buffer.from(await res.arrayBuffer());
    const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
    verify(hash(bytes) === hash(Buffer.from(manifest.readings[id], 'base64')), 'Preview differs from checked-in PNG');
    return `${bytes.length} bytes; exact manifest match`;
  });
}
const report = { checkedAt: new Date().toISOString(), origin, rules: CLASSIFIER_VERSION,
  ok: checks.every(c => c.ok) && expected.length > 0, checks, datedReadings: dates,
  unverified: ['New live snapshot persistence and KV write allowance', 'Provider balance and paid-check availability', 'WAF zone configuration', 'Real user comprehension and independent Book labels', 'Founder declarations, video links and submission confirmation'] };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
