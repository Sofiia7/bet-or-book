import { expect, it, vi, afterEach } from 'vitest';
import worker from '../src/index';
import { request, testEnv } from './support/worker';
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
