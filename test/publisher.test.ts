import { expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { request, testEnv } from './support/worker';
import { publisherReading, publisherEmbed } from '../src/publisher';
import featuredData from '../data/featured.json';
import type { Gallery } from '../src/gallery';
import type { CheckResponse } from '../src/api/check';
afterEach(() => vi.restoreAllMocks());
it('serves a publisher DTO without any provider call or credentials', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const res = await worker.fetch(request('/api/v1/readings/12pk1a43rv3a1?claim=ownership'), testEnv());
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  const body = await res.json() as Record<string, unknown>;
  expect(body.schema).toBe('bet-or-book.reading.v1');
  expect(body).not.toHaveProperty('nansenCalls');
  expect(body).not.toHaveProperty('address');
  expect(body.claim).toMatchObject({ status: 'Not established' });
  expect(fetch).not.toHaveBeenCalled();
});
it('permits framing only the static widget and keeps the main app unframeable', async () => {
  const embed = await worker.fetch(request('/embed?s=12pk1a43rv3a1'), testEnv());
  expect(embed.headers.get('content-security-policy')).toContain('frame-ancestors *');
  expect(await embed.text()).toContain('Ownership is unverified');
  const main = await worker.fetch(request('/'), testEnv());
  expect(main.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
});
it('cannot start a check through a widget, publisher POST or malformed id', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  expect((await worker.fetch(request('/api/v1/readings/12pk1a43rv3a1', { method: 'POST' }), testEnv())).status).toBe(405);
  expect((await worker.fetch(request('/embed?s=<script>'), testEnv())).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

// A reading's credit follows the sources it used: the old Nansen credit stays
// on a reading made with Nansen, and a reading made since names Hyperliquid,
// the public nodes and the block explorer, never Nansen.
const nansenReading = (featuredData as unknown as Gallery).entries.find((e) => e.snapshotId === '12pk1a43rv3a1') as CheckResponse;
const newReading: CheckResponse = {
  ...nansenReading,
  source: 'hyperliquid',
  hedgeScope: 'known-tokens',
  nansenCalls: 0,
  nansen: null,
  evidence: nansenReading.evidence.map((e) => (e.label === 'Linked wallets' ? { ...e, source: 'Explorer + On-chain' as const } : { ...e, source: 'Hyperliquid' as const })),
  vitals: nansenReading.vitals.map((v) => ({ ...v, source: 'Hyperliquid' as const })),
};
it('credits the sources a new reading used in the publisher DTO, and not Nansen', () => {
  const dto = publisherReading(newReading, '12pk1a43rv3a1', 'https://bet-or-book.trade');
  expect(dto.attribution).toBe('Data: Hyperliquid API, public nodes, Blockscout');
  // The credit and the sources printed beside each row: nothing names Nansen.
  expect(dto.attribution).not.toMatch(/nansen/i);
  expect(dto.evidence.map((e) => e.source).join(' ')).not.toMatch(/nansen/i);
});
it('credits the sources a new reading used in the embed footer, and not Nansen', () => {
  const html = publisherEmbed(newReading, '12pk1a43rv3a1', 'https://bet-or-book.trade');
  expect(html).toContain('Data: Hyperliquid API, public nodes, Blockscout · This tool never trades.');
  expect(html).not.toMatch(/nansen/i);
});
it('keeps the Nansen credit in the DTO and the embed for a reading made with Nansen', () => {
  expect(publisherReading(nansenReading, '12pk1a43rv3a1', 'https://bet-or-book.trade').attribution).toBe('Powered by Nansen API');
  expect(publisherEmbed(nansenReading, '12pk1a43rv3a1', 'https://bet-or-book.trade')).toContain('Powered by Nansen API · This tool never trades.');
});
it('serves a saved Nansen reading through the route with its credit unchanged', async () => {
  const dto = await (await worker.fetch(request('/api/v1/readings/12pk1a43rv3a1'), testEnv())).json() as { attribution: string };
  expect(dto.attribution).toBe('Powered by Nansen API');
});
