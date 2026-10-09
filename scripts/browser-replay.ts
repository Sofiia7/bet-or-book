// Local-only UI fixture server. Start Wrangler on 8788 first, then run:
// node --import tsx scripts/browser-replay.ts
// No POST is forwarded to the real Worker or a paid provider.
import { createServer } from 'node:http';
import featured from '../data/featured.json';
import type { CheckResponse } from '../src/api/check';
import { interpret, present } from '../src/engine/interpret';
import { readingHeadline, evidenceTakeaway } from '../src/engine/presentation';

const sample = featured.entries.find(e => !e.superseded) as unknown as CheckResponse;
const fixture = present(interpret({ ...sample, source: 'hyperliquid', degraded: true,
  positionsCoverage: 'partial', coverage: ['Nansen not used: budget unavailable in this local UI fixture'],
}, sample.checkedAt));
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost:8789');
  if (req.method === 'POST' && url.pathname === '/api/check') {
    // Address ending in 1 exercises the slow path; other addresses return
    // the budget-off fixture immediately. These are fixtures, not checks.
    if (url.searchParams.get('address')?.endsWith('1')) await new Promise(resolve => setTimeout(resolve, 20000));
    const card = { ...fixture, address: url.searchParams.get('address') || sample.address,
      headline: readingHeadline(fixture), takeaway: evidenceTakeaway(fixture), nansen: null,
      nansenCalls: 0, snapshotId: undefined, snapshotSaved: false };
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-browser-replay': '1' });
    res.end(JSON.stringify(card));
    return;
  }
  if (req.method !== 'GET') { res.writeHead(204); res.end(); return; }
  try {
    const upstream = await fetch('http://localhost:8788' + url.pathname + url.search, { signal: AbortSignal.timeout(15000) });
    const headers = Object.fromEntries([...upstream.headers].filter(([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key)));
    res.writeHead(upstream.status, headers);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Start local Wrangler on port 8788 first.');
  }
});
server.listen(8789, '127.0.0.1', () => console.log('Local browser fixture: http://localhost:8789. Paid POST forwarding is disabled.'));
