// EVM reads from public JSON-RPC nodes. Multicall3 batches many `eth_call`s
// into one request; the ABI is encoded and decoded by hand here because the
// Worker has only two runtime dependencies and must not gain a third.
import { chargeRequest, requestBudgetOf } from '../requestBudget';
import { UpstreamShapeError } from './normalize';
import { RETRY_MAX_WAIT_MS, RETRY_STATUSES, pause, retryWaitMs } from './retry';

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const SELECTORS = {
  aggregate3: '0x82ad56cb',
  getEthBalance: '0x4d2301cc',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  stEthPerToken: '0x035faf82',
  getExchangeRate: '0xe6aa216c',
  exchangeRate: '0x3ba0b9a9',
  getRate: '0x679aefce',
} as const;

/** Sent to Multicall3 with `allowFailure: true`: one token that reverts must
 * not take the other balances down with it. */
export interface Call3 {
  target: string;
  callData: string;
}

export interface Call3Result {
  success: boolean;
  returnData: string;
}

const TIMEOUT_MS = 10_000;
const WORD = 32;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

const word = (n: number | bigint): string => BigInt(n).toString(16).padStart(WORD * 2, '0');

function bytesHex(hex: string, what: string): string {
  if (!HEX.test(hex)) throw new UpstreamShapeError(`${what} is not hex`);
  return hex.slice(2);
}

/** `aggregate3((address target, bool allowFailure, bytes callData)[])` calldata. */
export function encodeAggregate3(calls: Call3[]): string {
  const elements = calls.map((call) => {
    const data = bytesHex(call.callData, 'call data');
    const target = bytesHex(call.target, 'call target');
    if (target.length !== 40) throw new Error('call target is not an address');
    const padded = data.padEnd(Math.ceil(data.length / (WORD * 2)) * WORD * 2, '0');
    return word(BigInt('0x' + target)) + word(1) + word(0x60) + word(data.length / 2) + padded;
  });
  // Offsets are relative to the start of the element area, which follows the
  // array length word: the head is one offset word per element.
  let offset = calls.length * WORD;
  const head: string[] = [];
  for (const element of elements) {
    head.push(word(offset));
    offset += element.length / 2;
  }
  return SELECTORS.aggregate3 + word(0x20) + word(calls.length) + head.join('') + elements.join('');
}

/** Reads `(bool success, bytes returnData)[]`. Every offset and length is
 * checked against the data, so a short or garbled answer is a shape error,
 * not a silently wrong balance. */
export function decodeAggregate3(hex: string, expected: number): Call3Result[] {
  const body = bytesHex(hex, 'multicall answer');
  const total = body.length / 2;
  const readWord = (at: number): number => {
    if (at < 0 || at + WORD > total) throw new UpstreamShapeError('multicall answer is truncated');
    const value = BigInt('0x' + body.slice(at * 2, (at + WORD) * 2));
    if (value > BigInt(total)) throw new UpstreamShapeError('multicall answer points outside its data');
    return Number(value);
  };
  const arrayAt = readWord(0);
  const count = readWord(arrayAt);
  if (count !== expected) throw new UpstreamShapeError(`multicall answered ${count} calls, expected ${expected}`);
  const area = arrayAt + WORD;
  const results: Call3Result[] = [];
  for (let i = 0; i < count; i++) {
    const element = area + readWord(area + i * WORD);
    const success = readWord(element);
    if (success > 1) throw new UpstreamShapeError('multicall success flag is not a bool');
    const dataAt = element + readWord(element + WORD);
    const length = readWord(dataAt);
    if (dataAt + WORD + length > total) throw new UpstreamShapeError('multicall return data is truncated');
    results.push({ success: success === 1, returnData: '0x' + body.slice((dataAt + WORD) * 2, (dataAt + WORD + length) * 2) });
  }
  return results;
}

/** Calldata for a function that takes one address: selector, then the
 * address left-padded to 32 bytes. */
export function withAddress(selector: string, address: string): string {
  const raw = bytesHex(address, 'address');
  if (raw.length !== 40) throw new Error('not an address');
  return selector + raw.toLowerCase().padStart(WORD * 2, '0');
}

/** The value of a single uint256 return, or null for anything that is not
 * exactly 32 bytes (a token that answers with something else is not read). */
export function uint256Of(returnData: string): bigint | null {
  if (!HEX.test(returnData) || returnData.length !== 2 + WORD * 2) return null;
  return BigInt(returnData);
}

function deadlineFor(signal?: AbortSignal): AbortSignal {
  const own = AbortSignal.timeout(TIMEOUT_MS);
  return signal === undefined ? own : AbortSignal.any([own, signal]);
}

/** One read-only `eth_call` at `latest`. Throws on an HTTP failure, a
 * JSON-RPC error, or a result that is not non-empty hex. */
export async function ethCall(url: string, to: string, data: string, signal?: AbortSignal): Promise<string> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] });
  const send = (): Promise<Response> =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: deadlineFor(signal) });
  chargeRequest(signal, 'evm');
  let res = await send();
  // The retry is a request like any other: sent only when the budget affords it, and charged.
  if (!res.ok && RETRY_STATUSES.has(res.status) && !signal?.aborted && (requestBudgetOf(signal)?.affords(1) ?? true)) {
    const wait = retryWaitMs(res);
    if (wait <= RETRY_MAX_WAIT_MS) {
      await res.body?.cancel().catch(() => {});
      await pause(wait, signal);
      if (!signal?.aborted) {
        chargeRequest(signal, 'evm');
        res = await send();
      }
    }
  }
  if (!res.ok) throw new Error(`evm eth_call failed: ${res.status}`);
  let json: { result?: unknown; error?: { code?: unknown; message?: unknown } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new UpstreamShapeError('eth_call answer is not JSON');
  }
  if (json === null || typeof json !== 'object') throw new UpstreamShapeError('eth_call answer is not an object');
  if (json.error !== undefined && json.error !== null) {
    throw new Error(`evm eth_call error: ${String(json.error.code)} ${String(json.error.message)}`);
  }
  if (typeof json.result !== 'string' || !HEX.test(json.result) || json.result.length <= 2) {
    throw new UpstreamShapeError('eth_call result is not hex data');
  }
  return json.result;
}
