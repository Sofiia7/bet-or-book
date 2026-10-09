import { expect, it } from 'vitest';
import { readSmallJson } from '../src/readSmallJson';
it('rejects oversized bodies without a Content-Length and malformed UTF-8', async () => {
  expect(await readSmallJson(new Request('https://test', { method: 'POST', body: 'x'.repeat(513) }), 512)).toEqual({ ok: false, status: 413 });
  expect(await readSmallJson(new Request('https://test', { method: 'POST', body: new Uint8Array([0xff]) }), 512)).toEqual({ ok: false, status: 400 });
});
