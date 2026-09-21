import { describe, expect, it, vi } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { withCache } from '../src/cache';

describe('withCache', () => {
  it('calls the producer and stores the result on a miss', async () => {
    const kv = new FakeKV();
    const producer = vi.fn(async () => ({ value: 42 }));
    const result = await withCache(kv, 'k1', 600, producer);
    expect(result).toEqual({ value: 42 });
    expect(producer).toHaveBeenCalledTimes(1);
    expect(kv.size()).toBe(1);
  });

  it('returns the cached value without calling the producer again on a hit', async () => {
    const kv = new FakeKV();
    const producer = vi.fn(async () => ({ value: 42 }));
    await withCache(kv, 'k1', 600, producer);
    const second = await withCache(kv, 'k1', 600, producer);
    expect(second).toEqual({ value: 42 });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('runs one producer for checks of the same key that overlap', async () => {
    const kv = new FakeKV();
    let running = 0;
    let peak = 0;
    const producer = vi.fn(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { value: 42 };
    });
    // Ten visitors asking about one whale at once used to mean ten checks
    // and ten times the credits.
    const all = await Promise.all(Array.from({ length: 10 }, () => withCache(kv, 'k1', 600, producer)));
    expect(all).toEqual(Array.from({ length: 10 }, () => ({ value: 42 })));
    expect(producer).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
  });

  it('lets the next caller try again after a producer throws', async () => {
    const kv = new FakeKV();
    const failing = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(withCache(kv, 'k1', 600, failing)).rejects.toThrow('upstream down');
    const ok = await withCache(kv, 'k1', 600, async () => ({ value: 1 }));
    expect(ok).toEqual({ value: 1 });
  });

  it('keeps separate keys apart while both are in flight', async () => {
    const kv = new FakeKV();
    const slow = (value: number) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { value };
    };
    const [a, b] = await Promise.all([withCache(kv, 'a', 600, slow(1)), withCache(kv, 'b', 600, slow(2))]);
    expect([a, b]).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it('calls the producer again once the entry expires', async () => {
    const kv = new FakeKV();
    let calls = 0;
    const producer = vi.fn(async () => ({ value: ++calls }));
    await withCache(kv, 'k1', 600, producer);
    kv.now = () => Date.now() + 601_000;
    const second = await withCache(kv, 'k1', 600, producer);
    expect(second).toEqual({ value: 2 });
    expect(producer).toHaveBeenCalledTimes(2);
  });
});
