import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { request, testEnv } from './support/worker';
import { readUsage } from '../src/usage';

const event = { action: 'reading_view', kind: 'saved', entry: 'shared_link', incomplete: false };
const post = (body: unknown = event, origin?: string) => request('/api/events', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...(origin ? { origin } : {}),
});
afterEach(() => vi.restoreAllMocks());

describe('bounded anonymous product events', () => {
  it('cancels a body that stalls instead of holding an invocation open', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const body = new ReadableStream({ cancel });
      const pending = readUsage({ body } as Request);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toBeNull();
      expect(cancel).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('records only allowed enums and flags without upstream calls or KV writes', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not call providers'));
    const env = testEnv(); const put = vi.spyOn(env.KV, 'put');
    expect((await worker.fetch(post(), env)).status).toBe(204);
    expect(JSON.parse(logged.mock.calls[0][0])).toEqual({ event: 'usage', outcome: 'reading_view', kind: 'saved', entry: 'shared_link', incomplete: false });
    expect(fetch).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });
  it('rejects cross-site posts and read methods', async () => {
    expect((await worker.fetch(post(event, 'https://other.test'), testEnv())).status).toBe(403);
    expect((await worker.fetch(request('/api/events'), testEnv())).status).toBe(405);
  });
  it.each([
    { ...event, address: '0x1111111111111111111111111111111111111111' },
    { ...event, action: 'wallet_connected' }, { ...event, entry: 'https://private.test' },
    { ...event, incomplete: 'false' }, { ...event, secret: 'x'.repeat(1000) },
  ])('rejects unrecognized or oversized payloads without logging them', async body => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await worker.fetch(post(body), testEnv())).status).toBe(400);
    expect(logged).not.toHaveBeenCalled();
  });
  it('bounds accepted events separately from paid checks', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = testEnv();
    for (let i = 0; i < 60; i++) expect((await worker.fetch(post(), env)).status).toBe(204);
    expect((await worker.fetch(post(), env)).status).toBe(429);
  });
});
