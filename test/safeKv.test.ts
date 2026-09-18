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
    await expect(kv.put('k', 'v')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});
