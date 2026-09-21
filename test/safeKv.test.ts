import { describe, expect, it, vi } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { safeKv } from '../src/safeKv';

class BrokenKV extends FakeKV {
  async get(): Promise<string | null> {
    throw new Error('KV quota exceeded');
  }
  async put(): Promise<void> {
    throw new Error('KV quota exceeded');
  }
}

describe('safeKv', () => {
  it('passes reads and writes through when KV works', async () => {
    const kv = safeKv(new FakeKV());
    await kv.put('k', 'v');
    expect(await kv.get('k')).toBe('v');
  });

  it('turns a failing read into a miss and a failing write into a no-op', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const kv = safeKv(new BrokenKV());
    await expect(kv.get('k')).resolves.toBeNull();
    // The error is swallowed - a lost cache entry is not a lost answer -
    // but the caller is told, because a share link depends on it.
    await expect(kv.put('k', 'v')).resolves.toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it('reports degraded after any failure, so spend guards can fail closed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const healthy = safeKv(new FakeKV());
    await healthy.put('k', 'v');
    await healthy.get('k');
    expect(healthy.degraded).toBe(false);
    const broken = safeKv(new BrokenKV());
    expect(broken.degraded).toBe(false);
    await broken.put('k', 'v');
    expect(broken.degraded).toBe(true);
    log.mockRestore();
  });
});
