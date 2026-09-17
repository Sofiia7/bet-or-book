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
