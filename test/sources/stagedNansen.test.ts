import { afterEach, expect, it, vi } from 'vitest';
import { stagedNansen } from '../../src/sources/stagedNansen';
import type { SpendGuard } from '../../src/coordinator';
afterEach(() => vi.restoreAllMocks());
it('holds retries before a stage and settles only its measured calls', async () => {
  const reserve = vi.fn(async () => ({ ok: true, id: 'hold' })); const settle = vi.fn(async () => {});
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { asset_positions: [] } }), { headers: { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '500' } }));
  const record = vi.fn();
  const client = stagedNansen('test-key', { reserve, settle } as unknown as SpendGuard, '2026-10-09', record, new AbortController().signal);
  await client.perpPositions('0x' + '1'.repeat(40));
  expect(reserve).toHaveBeenCalledWith('2026-10-09', 2);
  expect(settle).toHaveBeenCalledWith('hold', 1, 500, false, expect.any(Number));
  expect(record).toHaveBeenCalledTimes(1);
});
it('does not send a paid request after a stage budget refusal', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const client = stagedNansen('test-key', { reserve: async () => ({ ok: false, reason: 'cap' }) } as unknown as SpendGuard, '2026-10-09', () => {}, new AbortController().signal);
  await expect(client.currentBalance('wallet', 3)).rejects.toThrow('credit budget');
  expect(fetch).not.toHaveBeenCalled();
});
