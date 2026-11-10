import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MULTICALL3,
  SELECTORS,
  decodeAggregate3,
  encodeAggregate3,
  ethCall,
  uint256Of,
  withAddress,
  type Call3,
} from '../../src/sources/evm';
import { UpstreamShapeError } from '../../src/sources/normalize';
import { RequestBudgetExceeded, attachRequestBudget, createRequestBudget } from '../../src/requestBudget';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'onchain');
interface Fixture { chain: string; url: string; calls: Call3[]; calldata: string; result: string }
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, data: JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Fixture }));

// Captured from rpc.hyperliquid.xyz/evm on 2026-11-09 (abraxas-hyperevm.json):
// the native balance through Multicall3, then WHYPE's balanceOf.
const WALLET = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const TWO_CALLS: Call3[] = [
  { target: MULTICALL3, callData: '0x4d2301cc000000000000000000000000b83de012dba672c76a7dbbbf3e459cb59d7d6e36' },
  { target: '0x5555555555555555555555555555555555555555', callData: '0x70a08231000000000000000000000000b83de012dba672c76a7dbbbf3e459cb59d7d6e36' },
];
const TWO_CALLS_CALLDATA =
  '0x82ad56cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000100000000000000000000000000ca11bde05977b3631167028862be2a173976ca110000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000244d2301cc000000000000000000000000b83de012dba672c76a7dbbbf3e459cb59d7d6e3600000000000000000000000000000000000000000000000000000000000000000000000000000000555555555555555555555555555555555555555500000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000002470a08231000000000000000000000000b83de012dba672c76a7dbbbf3e459cb59d7d6e3600000000000000000000000000000000000000000000000000000000';
const TWO_CALLS_RESULT =
  '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000de096758f5afce10000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000';

describe('encodeAggregate3', () => {
  it('matches the calldata of the live check of 2026-11-09', () => {
    expect(encodeAggregate3(TWO_CALLS)).toBe(TWO_CALLS_CALLDATA);
  });

  it('pads call data that is not a whole number of words', () => {
    const encoded = encodeAggregate3([{ target: MULTICALL3, callData: '0x0102' }]);
    // selector, offset word, count word, one head word, then 4 element words and 1 data word
    expect(encoded.length).toBe(2 + 8 + 64 * (3 + 5));
    expect(encoded.endsWith('0102' + '0'.repeat(60))).toBe(true);
  });

  it('encodes an empty list as a zero-length array', () => {
    expect(encodeAggregate3([])).toBe(SELECTORS.aggregate3 + '20'.padStart(64, '0') + '0'.repeat(64));
  });
});

describe('decodeAggregate3', () => {
  it('reads the answer of the live check', () => {
    expect(decodeAggregate3(TWO_CALLS_RESULT, 2)).toEqual([
      { success: true, returnData: '0x' + '0de096758f5afce1'.padStart(64, '0') },
      { success: true, returnData: '0x' + '0'.repeat(64) },
    ]);
  });

  it('round-trips three entries, one of them failed and empty', () => {
    const word = (n: number): string => n.toString(16).padStart(64, '0');
    const a = word(1) + word(0x40) + word(32) + word(7);
    const b = word(0) + word(0x40) + word(0);
    const c = word(1) + word(0x40) + word(3) + '010203'.padEnd(64, '0');
    const head = [0x60, 0x60 + a.length / 2, 0x60 + a.length / 2 + b.length / 2];
    const hex = '0x' + word(0x20) + word(3) + head.map(word).join('') + a + b + c;
    expect(decodeAggregate3(hex, 3)).toEqual([
      { success: true, returnData: '0x' + word(7) },
      { success: false, returnData: '0x' },
      { success: true, returnData: '0x010203' },
    ]);
  });

  it.each(fixtures)('decodes every entry of $name', ({ data }) => {
    const results = decodeAggregate3(data.result, data.calls.length);
    expect(results).toHaveLength(data.calls.length);
    data.calls.forEach((call, i) => {
      if (call.callData.startsWith(SELECTORS.balanceOf) || call.callData.startsWith(SELECTORS.getEthBalance)) {
        expect(results[i].success).toBe(true);
        expect(typeof uint256Of(results[i].returnData)).toBe('bigint');
      }
    });
  });

  it.each(fixtures)('re-encodes the calls of $name to the calldata that was sent', ({ data }) => {
    expect(encodeAggregate3(data.calls)).toBe(data.calldata);
  });

  it('throws UpstreamShapeError for empty, truncated, non-hex and miscounted data', () => {
    expect(() => decodeAggregate3('0x', 1)).toThrow(UpstreamShapeError);
    expect(() => decodeAggregate3(TWO_CALLS_RESULT.slice(0, TWO_CALLS_RESULT.length - 64), 2)).toThrow(UpstreamShapeError);
    expect(() => decodeAggregate3('0xzz', 1)).toThrow(UpstreamShapeError);
    expect(() => decodeAggregate3(TWO_CALLS_RESULT, 3)).toThrow(UpstreamShapeError);
  });

  it('throws when an offset points outside the data', () => {
    const bad = TWO_CALLS_RESULT.replace('0'.repeat(62) + '40' + '0'.repeat(62) + 'c0', '0'.repeat(62) + '40' + 'f'.repeat(64));
    expect(bad).not.toBe(TWO_CALLS_RESULT);
    expect(() => decodeAggregate3(bad, 2)).toThrow(UpstreamShapeError);
  });
});

describe('withAddress and uint256Of', () => {
  it('left-pads the address to 32 bytes after the selector', () => {
    expect(withAddress(SELECTORS.balanceOf, WALLET.toUpperCase().replace('0X', '0x'))).toBe(
      '0x70a08231000000000000000000000000b83de012dba672c76a7dbbbf3e459cb59d7d6e36',
    );
  });

  it('reads exactly 32 bytes and nothing else', () => {
    expect(uint256Of('0x' + '0'.repeat(63) + '5')).toBe(5n);
    expect(uint256Of('0x')).toBeNull();
    expect(uint256Of('0x05')).toBeNull();
    expect(uint256Of('0x' + '0'.repeat(66))).toBeNull();
    expect(uint256Of('nothex')).toBeNull();
  });
});

describe('ethCall', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });
  const stub = (...responses: Array<Response>): ReturnType<typeof vi.fn> => {
    const fn = vi.fn();
    for (const r of responses) fn.mockResolvedValueOnce(r);
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  };
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
  const URL_ = 'https://node.example/rpc';

  it('posts an eth_call at latest and returns the result', async () => {
    const fn = stub(json({ jsonrpc: '2.0', id: 1, result: '0x01' }));
    await expect(ethCall(URL_, MULTICALL3, '0xabcd')).resolves.toBe('0x01');
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: MULTICALL3, data: '0xabcd' }, 'latest'],
    });
  });

  it('rejects a JSON-RPC error object', async () => {
    stub(json({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'rate limited' } }));
    await expect(ethCall(URL_, MULTICALL3, '0x')).rejects.toThrow(/rate limited/);
  });

  it('rejects an empty result', async () => {
    stub(json({ result: '0x' }));
    await expect(ethCall(URL_, MULTICALL3, '0x')).rejects.toThrow(UpstreamShapeError);
  });

  it('rejects a result that is not hex', async () => {
    stub(json({ result: 'hello' }));
    await expect(ethCall(URL_, MULTICALL3, '0x')).rejects.toThrow(UpstreamShapeError);
  });

  it('rejects a non-retryable HTTP failure without a second send', async () => {
    const fn = stub(json({}, 400));
    await expect(ethCall(URL_, MULTICALL3, '0x')).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 once and charges both sends', async () => {
    const fn = stub(
      new Response('busy', { status: 503, headers: { 'Retry-After': '0' } }),
      json({ result: '0x02' }),
    );
    const controller = new AbortController();
    const budget = createRequestBudget(5);
    attachRequestBudget(controller.signal, budget);
    await expect(ethCall(URL_, MULTICALL3, '0x', controller.signal)).resolves.toBe('0x02');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(budget.used()).toBe(2);
  });

  it('does not retry when the budget cannot afford a second send', async () => {
    const fn = stub(new Response('busy', { status: 503, headers: { 'Retry-After': '0' } }), json({ result: '0x02' }));
    const controller = new AbortController();
    attachRequestBudget(controller.signal, createRequestBudget(1));
    await expect(ethCall(URL_, MULTICALL3, '0x', controller.signal)).rejects.toThrow(/503/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws RequestBudgetExceeded before any fetch when the budget is 0', async () => {
    const fn = stub(json({ result: '0x02' }));
    const controller = new AbortController();
    attachRequestBudget(controller.signal, createRequestBudget(0));
    await expect(ethCall(URL_, MULTICALL3, '0x', controller.signal)).rejects.toBeInstanceOf(RequestBudgetExceeded);
    expect(fn).not.toHaveBeenCalled();
  });
});
