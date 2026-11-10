import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorerUnavailable, readFirstFunder, readFundingLinks } from '../../src/sources/explorer';
import { UpstreamShapeError } from '../../src/sources/normalize';
import { RequestBudgetExceeded, attachRequestBudget, createRequestBudget } from '../../src/requestBudget';

const DIR = join(__dirname, '..', 'fixtures', 'explorer');
const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const ARB_FUNDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const ETH_FUNDER = '0xed0c6079229e2d407672a117c22b62064f4a4312';
const KEY = 'test-key-7f3a9c1d55e2';

interface Item {
  from: { hash: string; name: string | null; metadata: unknown };
  to: { hash: string };
  value: string;
  timestamp: string;
  status?: string | null;
  block_number: number;
  [field: string]: unknown;
}
interface Answer {
  items: Item[];
  next_page_params: unknown;
}
interface Fixture {
  note?: string;
  capturedAt?: string;
  chain: string;
  url: string;
  answer: Answer;
}

const load = (name: string): Fixture => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as Fixture;
const abraxas = (): Answer => structuredClone(load(`ethereum-${ABRAXAS}.json`).answer);
const ethFunder = (): Answer => structuredClone(load(`ethereum-${ETH_FUNDER}.json`).answer);

// The keyed captures of 2026-11-10: the Arbitrum Etherscan-style txlist of the
// Abraxas wallet (eight oldest rows), the same request for an address that has
// no transactions, and the Ethereum transaction list of the Arbitrum funder,
// whose parties carry the funder's own tags.
interface RawFixture {
  note?: string;
  capturedAt?: string;
  chain: string;
  url: string;
  answer: unknown;
}
const loadRaw = (name: string): RawFixture => JSON.parse(readFileSync(join(DIR, name), 'utf8')) as RawFixture;
const ARB_FILE = `arbitrum-txlist-${ABRAXAS}.json`;
const NONE_FILE = 'arbitrum-txlist-none-0x5b1c8e47d2a9f06b3e7c1d48a05f9e2b6c3d7a14.json';
const LABEL_FILE = `ethereum-label-${ARB_FUNDER}.json`;
const arbitrum = (): TxlistAnswer => structuredClone(loadRaw(ARB_FILE).answer) as TxlistAnswer;
const binanceLabel = (): unknown => structuredClone(loadRaw(LABEL_FILE).answer);

interface TxlistRow {
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  txreceipt_status?: string;
  [field: string]: unknown;
}
interface TxlistAnswer {
  status: string;
  message: string;
  result: TxlistRow[];
}

const OTHER = '0x1111111111111111111111111111111111111111';

/** A stand-in item: only what the reader looks at matters. Inbound to the
 * Abraxas wallet, at a block early enough to precede the captured ones. */
const item = (from: string, value: string, extra: Partial<Item> = {}): Item => ({
  from: { hash: from, name: null, metadata: null },
  to: { hash: ABRAXAS },
  value,
  timestamp: '2025-03-01T00:00:00.000000Z',
  status: 'ok',
  block_number: 100,
  ...extra,
});

/** A stand-in txlist row, inbound to the Abraxas wallet at a block early
 * enough to precede the captured ones. */
const inbound = (from: string, value: string, extra: Partial<TxlistRow> = {}): TxlistRow => ({
  blockNumber: '100',
  timeStamp: '1740000000',
  from,
  to: ABRAXAS,
  value,
  isError: '0',
  txreceipt_status: '1',
  ...extra,
});
const outbound = (to: string, value: string, extra: Partial<TxlistRow> = {}): TxlistRow => inbound(ABRAXAS, value, { to, ...extra });
const txlist = (rows: unknown[]): TxlistAnswer => ({ status: '1', message: 'OK', result: rows as TxlistRow[] });
const NO_TRANSACTIONS = { status: '0', message: 'No transactions found', result: [] };
/** The Ethereum transaction list of `sender` as the label lookup sees it: the
 * sender is the recipient of each item and carries `tags`; the counterparty
 * carries `otherTags`. */
const labelPageFor = (sender: string, tags: string[] | null, otherTags: string[] | null = null) => ({
  items: [
    {
      from: { hash: OTHER, name: null, metadata: otherTags ? { tags: otherTags.map((name) => ({ name })) } : null },
      to: { hash: sender, name: null, metadata: tags ? { tags: tags.map((name) => ({ name })) } : null },
    },
  ],
});

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const challenge = (status: number): Response =>
  new Response('<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });

function stubFetch(...responses: Response[]) {
  const queue = [...responses];
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => queue.shift() ?? json({ items: [], next_page_params: null }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const urlOf = (fn: ReturnType<typeof stubFetch>, call = 0): string => String(fn.mock.calls[call]![0]);
const headersOf = (fn: ReturnType<typeof stubFetch>, call = 0): Record<string, string> =>
  ((fn.mock.calls[call]![1] as RequestInit).headers ?? {}) as Record<string, string>;

function budgetedSignal(limit: number) {
  const signal = new AbortController().signal;
  const budget = createRequestBudget(limit);
  attachRequestBudget(signal, budget);
  return { signal, budget };
}

describe('readFirstFunder', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('the first-funder rule', () => {
    it('reads the Abraxas funder from the captured Ethereum answer', async () => {
      const fixture = load(`ethereum-${ABRAXAS}.json`);
      const fn = stubFetch(json(fixture.answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read).toEqual({
        link: {
          address: ETH_FUNDER,
          relation: 'First Funder',
          chain: 'ethereum',
          serviceStatus: 'unverified',
          fundedAt: Date.parse(fixture.answer.items[0]!.timestamp),
        },
        complete: true,
      });
      expect(read.link?.fundedAt).toBe(Date.UTC(2025, 6, 8, 19, 23, 59));
      // Keyless Ethereum goes to the public host, with no credential at all.
      expect(urlOf(fn)).toBe(`https://eth.blockscout.com/api/v2/addresses/${ABRAXAS}/transactions?filter=to&sort=block_number&order=asc`);
      expect(headersOf(fn).Authorization).toBeUndefined();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('asks for the lowercase address even when given a checksummed one', async () => {
      const fn = stubFetch(json(abraxas()));
      await readFirstFunder('0xB83DE012dbA672c76A7dbbbF3E459CB59D7D6E36', 'ethereum', {});
      expect(urlOf(fn)).toContain(`/addresses/${ABRAXAS}/transactions`);
    });

    it('skips a first transaction of value zero for the next one that carries value', async () => {
      const answer = abraxas();
      answer.items.unshift(item(OTHER, '0'));
      stubFetch(json(answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.address).toBe(ETH_FUNDER);
      expect(read.complete).toBe(true);
    });

    it('skips a transaction the address sent to itself, in any letter case', async () => {
      const answer = abraxas();
      answer.items.unshift(item('0xB83DE012dbA672c76A7dbbbF3E459CB59D7D6E36', '5'));
      stubFetch(json(answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.address).toBe(ETH_FUNDER);
    });

    it.each([
      ['failed (it moved no value)', 'error'],
      ['still pending (null)', null],
    ])('skips a transaction that is %s', async (_name, status) => {
      const answer = abraxas();
      answer.items.unshift(item(OTHER, '7', { status }));
      stubFetch(json(answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.address).toBe(ETH_FUNDER);
    });

    it.each([
      ['ok', 'ok'],
      ['absent', undefined],
    ])('counts a transaction whose status is %s', async (_name, status) => {
      stubFetch(json({ items: [item(OTHER, '7', status === undefined ? { status: undefined } : { status })], next_page_params: null }));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.address).toBe(OTHER);
    });

    it('lowercases the sender it returns', async () => {
      stubFetch(json({ items: [item('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01', '1')], next_page_params: null }));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.address).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
    });

    it('reads a first page with only zero-value items and more pages behind it as incomplete, not as no funder', async () => {
      stubFetch(json({ items: [item(OTHER, '0')], next_page_params: { block_number: 1, index: 0 } }));
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: false });
    });

    it('reads a last page with nothing that carries value as complete', async () => {
      stubFetch(json({ items: [item(OTHER, '0')], next_page_params: null }));
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: true });
    });

    it('reads a valid empty list as nothing having come in', async () => {
      stubFetch(json({ items: [], next_page_params: null }));
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: true });
    });

    it('takes a full page with no next-page marker at all as incomplete, and a short one as complete', async () => {
      const zeros = (n: number): Item[] => Array.from({ length: n }, () => item(OTHER, '0'));
      stubFetch(json({ items: zeros(50) }), json({ items: zeros(3) }));
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: false });
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: true });
    });

    it('finds a funder on the first page even when more pages exist: the order is oldest first', async () => {
      const answer = ethFunder();
      expect(answer.next_page_params).not.toBeNull();
      stubFetch(json(answer));
      const read = await readFirstFunder(ETH_FUNDER, 'ethereum', {});
      expect(read.link?.address).toBe('0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0');
      expect(read.complete).toBe(true);
    });
  });

  describe('an answer that is not a list of transactions is not an empty one', () => {
    it('rejects a 200 whose body is the HTML challenge page', async () => {
      stubFetch(new Response('<!DOCTYPE html><title>Just a moment...</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a body that is not JSON', async () => {
      stubFetch(new Response('not json at all', { status: 200 }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([
      ['an object', { items: {} }],
      ['a string', { items: 'none' }],
      ['null', { items: null }],
      ['absent', { next_page_params: null }],
      ['a body that is a list', []],
      ['a body that is null', null],
    ])('rejects `items` that is %s', async (_name, body) => {
      stubFetch(json(body));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a next_page_params that is neither null nor an object', async () => {
      stubFetch(json({ items: [], next_page_params: 'more' }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([
      ['an item that is not an object', 'x'],
      ['a missing sender', { ...item(OTHER, '5'), from: undefined }],
      ['a sender whose hash is not an address', item('0x12', '5')],
      ['a value that is a number', item(OTHER, 5 as unknown as string)],
      ['a value that is not decimal digits', item(OTHER, '0x5')],
      ['a value that is missing', { ...item(OTHER, '5'), value: undefined }],
      ['a funding transaction without a timestamp', { ...item(OTHER, '5'), timestamp: undefined }],
      ['a funding transaction with a timestamp that is not a date', item(OTHER, '5', { timestamp: 'yesterday' })],
    ])('rejects %s', async (_name, bad) => {
      stubFetch(json({ items: [bad], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([402, 403, 404])('rejects an HTTP %i without a retry', async (status) => {
      const fn = stubFetch(challenge(status));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toThrow(`explorer ethereum answered ${status}`);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a 500 once and reads the answer that follows, charging both sends', async () => {
      const fn = stubFetch(challenge(500), json(abraxas()));
      const { signal, budget } = budgetedSignal(5);
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {}, signal);
      expect(read.link?.address).toBe(ETH_FUNDER);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(budget.used()).toBe(2);
    });

    it('rejects a 500 that is still a 500 after its one retry', async () => {
      const fn = stubFetch(challenge(500), challenge(500), json(abraxas()));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toThrow('explorer ethereum answered 500');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('rejects a 429 that is still a 429 after its one retry', async () => {
      const retryAfter = { 'retry-after': '0' };
      const fn = stubFetch(new Response('slow down', { status: 429, headers: retryAfter }), new Response('slow down', { status: 429, headers: retryAfter }), json(abraxas()));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toThrow('explorer ethereum answered 429');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries a 429 once and reads the answer that follows, charging both sends', async () => {
      const fn = stubFetch(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), json(abraxas()));
      const { signal, budget } = budgetedSignal(5);
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {}, signal);
      expect(read.link?.address).toBe(ETH_FUNDER);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(budget.used()).toBe(2);
    });

    it('keeps the 429 when the retry does not fit in the budget', async () => {
      const fn = stubFetch(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), json(abraxas()));
      const { signal, budget } = budgetedSignal(1);
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {}, signal)).rejects.toThrow('explorer ethereum answered 429');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(budget.used()).toBe(1);
    });

    it('does not wait out a Retry-After longer than the check can spare', async () => {
      const fn = stubFetch(new Response('slow down', { status: 429, headers: { 'retry-after': '60' } }), json(abraxas()));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toThrow('explorer ethereum answered 429');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('a page that is not the one that was asked for fails closed', () => {
    // A keyed answer could ignore the filter or the sort. If it did, the
    // first item would be the wrong transaction, so the page has to
    // show that it is inbound and oldest first before anything is read from it.
    it('rejects a page in descending order', async () => {
      stubFetch(json({ items: [item(OTHER, '0', { block_number: 200 }), item(OTHER, '5', { block_number: 100 })], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    // The whole page is in hand before a funder is chosen, so the whole page is
    // checked. Checking only the items up to the first funder would let a
    // newest-first answer through: its first item qualifies, one item is
    // scanned, and the newest sender comes back as the first funder.
    it('rejects a one-page descending answer whose first item qualifies', async () => {
      const page = [item(ETH_FUNDER, '5', { block_number: 300 }), item(OTHER, '5', { block_number: 200 }), item(OTHER, '5', { block_number: 100 })];
      stubFetch(json({ items: page, next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects an ascending page whose last item breaks the order, though a funder came first', async () => {
      const page = [item(ETH_FUNDER, '5', { block_number: 100 }), item(OTHER, '0', { block_number: 200 }), item(OTHER, '0', { block_number: 150 })];
      stubFetch(json({ items: page, next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a page with a foreign recipient further down, though a funder came first', async () => {
      const page = [item(ETH_FUNDER, '5'), item(OTHER, '0'), item(OTHER, '0', { to: { hash: ETH_FUNDER } })];
      stubFetch(json({ items: page, next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a page with a pending item (block_number null) at the end, though a funder came first', async () => {
      const page = [item(ETH_FUNDER, '5'), item(OTHER, '5', { block_number: null as unknown as number, status: null })];
      stubFetch(json({ items: page, next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a page with an item that is not an object further down, though a funder came first', async () => {
      stubFetch(json({ items: [item(ETH_FUNDER, '5'), 'x'], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('accepts a full page that rises to the end, the funder being its first item', async () => {
      const page = Array.from({ length: 50 }, (_, i) => item(i === 0 ? ETH_FUNDER : OTHER, '5', { block_number: 100 + i }));
      stubFetch(json({ items: page, next_page_params: { order: 'asc', filter: 'to', block_number: 150 } }));
      expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.address).toBe(ETH_FUNDER);
    });

    it('accepts blocks that stay equal or rise', async () => {
      stubFetch(json({ items: [item(OTHER, '0', { block_number: 100 }), item(OTHER, '0', { block_number: 100 }), item(ETH_FUNDER, '5', { block_number: 101 })], next_page_params: null }));
      expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.address).toBe(ETH_FUNDER);
    });

    it.each([
      ['absent', undefined],
      ['null', null],
      ['a string', '100'],
    ])('rejects an item whose block_number is %s', async (_name, block) => {
      stubFetch(json({ items: [item(OTHER, '5', { block_number: block as unknown as number })], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([
      ['another address', { hash: OTHER }],
      ['missing', undefined],
      ['null (a contract creation)', null],
      ['a hash that is not a string', { hash: 5 }],
      ['a hash that is missing', {}],
    ])('rejects an item whose recipient is %s', async (_name, to) => {
      stubFetch(json({ items: [item(OTHER, '5', { to: to as unknown as { hash: string } })], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it('rejects a zero-value or self-sent item whose recipient is not the wallet, as well', async () => {
      stubFetch(json({ items: [item(OTHER, '0', { to: { hash: ETH_FUNDER } }), item(OTHER, '5')], next_page_params: null }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([
      ['order is desc', { order: 'desc', filter: 'to', block_number: 9 }],
      ['order is something else', { order: 'asc,desc' }],
      ['filter is from', { order: 'asc', filter: 'from' }],
      ['filter is something else', { filter: 'to | from' }],
    ])('rejects a next_page_params whose %s', async (_name, next) => {
      stubFetch(json({ items: [item(OTHER, '0')], next_page_params: next }), json({ ...abraxas(), next_page_params: next }));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
      // Also when a funder was found on the page: the page is not what was asked for.
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {})).rejects.toBeInstanceOf(UpstreamShapeError);
    });

    it.each([
      ['order asc and filter to', { order: 'asc', filter: 'to', block_number: 9 }],
      ['neither order nor filter', { block_number: 9, index: 0 }],
      ['only order asc', { order: 'asc' }],
      ['only filter to', { filter: 'to' }],
    ])('accepts a next_page_params with %s', async (_name, next) => {
      stubFetch(json({ items: [item(OTHER, '0')], next_page_params: next }));
      expect(await readFirstFunder(ABRAXAS, 'ethereum', {})).toEqual({ link: null, complete: false });
    });
  });

  describe('the request budget', () => {
    it('refuses with RequestBudgetExceeded before any send when the budget is spent', async () => {
      const fn = stubFetch(json(abraxas()));
      const { signal } = budgetedSignal(0);
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {}, signal)).rejects.toBeInstanceOf(RequestBudgetExceeded);
      expect(fn).not.toHaveBeenCalled();
    });

    it('charges one request for one read', async () => {
      stubFetch(json(abraxas()));
      const { signal, budget } = budgetedSignal(3);
      await readFirstFunder(ABRAXAS, 'ethereum', {}, signal);
      expect(budget.used()).toBe(1);
    });

    it('stops at the first send when the check is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
        return json(abraxas());
      }) as unknown as typeof fetch;
      await expect(readFirstFunder(ABRAXAS, 'ethereum', {}, controller.signal)).rejects.toThrow();
    });
  });

  describe('redirects', () => {
    // `redirect: "error"` would be the obvious option, but workerd refuses it
    // outright (probed on 2026-11-09: TypeError "Invalid redirect value, must be
    // one of follow or manual"), which would fail every read on Cloudflare.
    // "manual" hands back the 3xx itself, so the Authorization header never
    // travels to a Location, and the 3xx is read as a refusal.
    const redirectOf = (fn: ReturnType<typeof stubFetch>, call: number): unknown => (fn.mock.calls[call]![1] as RequestInit).redirect;

    it('asks for manual redirect handling on every send, keyed or not, retry included', async () => {
      const fn = stubFetch(json(abraxas()), json(abraxas()), new Response('slow', { status: 429, headers: { 'retry-after': '0' } }), json(abraxas()));
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
      await readFirstFunder(ABRAXAS, 'ethereum', {});
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
      expect(fn).toHaveBeenCalledTimes(4);
      for (let i = 0; i < 4; i++) expect(redirectOf(fn, i)).toBe('manual');
    });

    it('asks for manual redirect handling on the Arbitrum txlist and on the label lookup too', async () => {
      const fn = stubFetch(json(arbitrum()), json(binanceLabel()));
      await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      expect(fn).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) expect(redirectOf(fn, i)).toBe('manual');
    });

    it.each([301, 302, 307, 308])('reads a %i as a refusal: no retry, no second request, no Location followed', async (status) => {
      const fn = stubFetch(new Response(null, { status, headers: { location: 'https://elsewhere.example/steal' } }), json(abraxas()));
      await expect(readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY })).rejects.toThrow(`explorer ethereum answered ${status}`);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('counts a redirect as a chain that was not read, not as no funder', async () => {
      stubFetch(new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }), json(arbitrum()));
      const read = await readFundingLinks(ABRAXAS, { apiKey: KEY });
      expect(read.chains[0]).toEqual({ chain: 'ethereum', status: 'not-read', reason: 'error' });
      expect(read.links.map((l) => l.chain)).toEqual(['arbitrum']);
    });

    it('counts a fetch that throws, as a runtime does for a redirect it refuses, as a chain that was not read', async () => {
      global.fetch = vi.fn(async () => {
        throw new TypeError('redirect refused');
      }) as unknown as typeof fetch;
      const read = await readFundingLinks(ABRAXAS, { apiKey: KEY });
      expect(read.chains).toEqual([
        { chain: 'ethereum', status: 'not-read', reason: 'error' },
        { chain: 'arbitrum', status: 'not-read', reason: 'error' },
      ]);
      expect(read.links).toEqual([]);
    });

    it('says in the log why a chain was not read, with the status and without the key', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubFetch(json(abraxas()), challenge(403));
      await readFundingLinks(ABRAXAS, { apiKey: KEY });
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines).toEqual(['explorer arbitrum not read: Error: explorer arbitrum answered 403']);
      expect(lines.join(' ')).not.toContain(KEY);
      warn.mockRestore();
    });

    it('does not log a chain that was refused for the budget or a missing key', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      stubFetch(json(abraxas()));
      await readFundingLinks(ABRAXAS, {});
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('the key', () => {
    it('goes to the universal API with the key in the Authorization header only, on chain id 1', async () => {
      const fn = stubFetch(json(abraxas()));
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
      expect(urlOf(fn)).toBe(`https://api.blockscout.com/1/api/v2/addresses/${ABRAXAS}/transactions?filter=to&sort=block_number&order=asc`);
      expect(headersOf(fn).Authorization).toBe(`Bearer ${KEY}`);
      expect(urlOf(fn)).not.toContain(KEY);
      expect(urlOf(fn).toLowerCase()).not.toContain('apikey');
    });

    it('uses chain id 42161 for Arbitrum, through the Etherscan-style txlist and not the REST path', async () => {
      const fn = stubFetch(json(arbitrum()));
      await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      expect(urlOf(fn)).toBe(
        `https://api.blockscout.com/v2/api?chain_id=42161&module=account&action=txlist&address=${ABRAXAS}&sort=asc&page=1&offset=50`,
      );
      expect(headersOf(fn).Authorization).toBe(`Bearer ${KEY}`);
      expect(urlOf(fn)).not.toContain(KEY);
    });

    it('puts the key into no error message, even when the explorer refuses it', async () => {
      stubFetch(challenge(403), json({ message: 'unauthorized' }, 401), new Response('{"items": 1}', { status: 200 }), new Response('<html>', { status: 200 }));
      const messages: string[] = [];
      for (let i = 0; i < 4; i++) {
        try {
          await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
        } catch (err) {
          messages.push(String((err as Error).message));
        }
      }
      expect(messages).toHaveLength(4);
      for (const message of messages) expect(message).not.toContain(KEY);
    });

    it('rejects Arbitrum with reason no-key, and sends nothing, when there is no key', async () => {
      const fn = stubFetch(json(abraxas()));
      const { signal, budget } = budgetedSignal(5);
      const err = await readFirstFunder(ABRAXAS, 'arbitrum', {}, signal).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExplorerUnavailable);
      expect((err as ExplorerUnavailable).reason).toBe('no-key');
      expect(fn).not.toHaveBeenCalled();
      expect(budget.used()).toBe(0);
    });

    it('treats an empty key as none', async () => {
      const fn = stubFetch(json(abraxas()));
      await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: '   ' })).rejects.toBeInstanceOf(ExplorerUnavailable);
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: '' });
      expect(urlOf(fn)).toContain('https://eth.blockscout.com/');
      expect(headersOf(fn).Authorization).toBeUndefined();
    });

    it('trims a key that arrived with a line break, as a piped secret does', async () => {
      const fn = stubFetch(json(abraxas()));
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: `${KEY}\n` });
      expect(headersOf(fn).Authorization).toBe(`Bearer ${KEY}`);
    });

    it('treats a key that cannot be a header value as none, without echoing it anywhere', async () => {
      const fn = stubFetch(json(abraxas()));
      const err = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: 'bad key\twith space' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExplorerUnavailable);
      expect(String((err as Error).message)).not.toContain('bad key');
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: 'bad key\twith space' });
      expect(urlOf(fn)).toContain('https://eth.blockscout.com/');
      expect(headersOf(fn).Authorization).toBeUndefined();
    });
  });

  describe('the address', () => {
    it.each(['', '0x12', 'not an address', `${ABRAXAS}/../../x`, `${ABRAXAS}?a=b`])('refuses %j before sending anything', async (bad) => {
      const fn = stubFetch(json(abraxas()));
      await expect(readFirstFunder(bad, 'ethereum', {})).rejects.toThrow();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('what the sender is called', () => {
    it('reads a sender tagged as an exchange hot wallet as a service, and returns no name', async () => {
      // The 0xed0c... answer's first sender is tagged by Blockscout's metadata
      // ("Kraken: Hot Wallet", "Exchange", ...); the `name` field itself is null.
      const answer = ethFunder();
      const tags = JSON.stringify(answer.items[0]!.from.metadata);
      expect(tags).toContain('Kraken');
      stubFetch(json(answer));
      const read = await readFirstFunder(ETH_FUNDER, 'ethereum', {});
      expect(read.link?.serviceStatus).toBe('service');
      const shown = JSON.stringify(read).toLowerCase();
      for (const word of ['kraken', 'exchange', 'hot wallet', 'metadata', 'tag']) expect(shown).not.toContain(word);
      expect(Object.keys(read.link!).sort()).toEqual(['address', 'chain', 'fundedAt', 'relation', 'serviceStatus']);
    });

    it('reads a sender whose own name matches the exchange pattern as a service, and returns no name', async () => {
      const answer = abraxas();
      answer.items[0]!.from.name = 'Coinbase 10';
      answer.items[0]!.from.metadata = null;
      stubFetch(json(answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.serviceStatus).toBe('service');
      expect(JSON.stringify(read).toLowerCase()).not.toContain('coinbase');
    });

    it('reads a Binance hot wallet tag, built inline in the shape of the capture, as a service', async () => {
      const tags = [
        { meta: { main_entity: 'Binance' }, name: 'Binance: Hot Wallet', ordinal: 10, slug: 'binance-hot-wallet', tagType: 'name' },
        { meta: {}, name: 'HOT WALLET', ordinal: 0, slug: 'hot-wallet', tagType: 'generic' },
        { meta: {}, name: 'Binance 54', ordinal: 0, slug: 'binance-54', tagType: 'name' },
      ];
      const sender = item(OTHER, '5', { from: { hash: OTHER, name: null, metadata: { tags } } });
      stubFetch(json({ items: [sender], next_page_params: null }));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.serviceStatus).toBe('service');
      expect(JSON.stringify(read).toLowerCase()).not.toContain('binance');
    });

    // Blockscout labels far more than exchanges. A tag that matches no service
    // pattern (a multisig, a DEX router, a deployer) vouches for nothing about
    // who is behind the address, so the reader never claims a sender is not a
    // service: that is 'unverified', and only a match makes it 'service'.
    it.each([
      ['a plain name', { name: 'Acme Capital Fund', metadata: null }],
      ['a Multisig tag', { name: null, metadata: { tags: [{ name: 'Multisig', tagType: 'generic' }] } }],
      ['a DEX router tag', { name: null, metadata: { tags: [{ name: 'Uniswap V3: Router', tagType: 'name' }, { name: 'DEX Router', tagType: 'generic' }] } }],
      ['a Contract Deployer tag', { name: null, metadata: { tags: [{ name: 'Contract Deployer', tagType: 'generic' }] } }],
    ])('reads a sender labelled only with %s as unverified, never as not-service', async (_name, label) => {
      const answer = abraxas();
      Object.assign(answer.items[0]!.from, label);
      stubFetch(json(answer));
      const read = await readFirstFunder(ABRAXAS, 'ethereum', {});
      expect(read.link?.serviceStatus).toBe('unverified');
      expect(JSON.stringify(read)).not.toMatch(/Acme|Multisig|Router|Deployer/);
    });

    it('keeps a sender with no name and no tags as unverified, not as private', async () => {
      stubFetch(json(abraxas()));
      expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.serviceStatus).toBe('unverified');
    });

    it('does not read an ENS name as a label', async () => {
      const answer = abraxas();
      (answer.items[0]!.from as Record<string, unknown>).ens_domain_name = 'binance.eth';
      stubFetch(json(answer));
      expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.serviceStatus).toBe('unverified');
    });

    it('survives a metadata block of an unexpected shape by leaving the sender unverified', async () => {
      const answer = abraxas();
      for (const metadata of ['tag', 7, [], { tags: 'x' }, { tags: [null, 5, { name: 9 }] }]) {
        answer.items[0]!.from.metadata = metadata;
        stubFetch(json(answer));
        expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.serviceStatus).toBe('unverified');
      }
    });

    it('reads a sender on the local list of known shared services as a service, with no label at all', async () => {
      // Binance 15: the address KNOWN_SERVICE_ADDRESSES records for the 18.09 gallery.
      stubFetch(json({ items: [item('0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', '1')], next_page_params: null }));
      expect((await readFirstFunder(ABRAXAS, 'ethereum', {})).link?.serviceStatus).toBe('service');
    });
  });

  describe('the committed fixtures', () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith('.json'));
    // Three kinds: keyless Ethereum REST pages of a wallet's inbound transactions
    // (ethereum-0x...), keyed Arbitrum txlist answers (arbitrum-txlist-...) and
    // the keyed Ethereum transaction list the label lookup reads (ethereum-label-...).
    const restFiles = files.filter((name) => name.startsWith('ethereum-0x'));
    const txlistFiles = files.filter((name) => name.startsWith('arbitrum-txlist-'));
    const labelFiles = files.filter((name) => name.startsWith('ethereum-label-'));

    it('holds every file under one of the three kinds', () => {
      expect([...restFiles, ...txlistFiles, ...labelFiles].sort()).toEqual([...files].sort());
      expect(restFiles).toHaveLength(3);
      expect(txlistFiles).toHaveLength(2);
      expect(labelFiles).toHaveLength(1);
    });

    it.each(restFiles)('%s keeps only the fields the reader uses', (name) => {
      const fixture = load(name);
      for (const tx of fixture.answer.items) {
        expect(Object.keys(tx).sort()).toEqual(['block_number', 'from', 'status', 'timestamp', 'to', 'value']);
        expect(Object.keys(tx.from).sort()).toEqual(['hash', 'metadata', 'name']);
        expect(Object.keys(tx.to)).toEqual(['hash']);
      }
      expect(Object.keys(fixture.answer).sort()).toEqual(['items', 'next_page_params']);
    });

    it.each(restFiles)("%s keeps of a sender's metadata only the tag names", (name) => {
      for (const tx of load(name).answer.items) {
        const metadata = tx.from.metadata as { tags?: Array<Record<string, unknown>> } | null;
        if (metadata === null) continue;
        expect(Object.keys(metadata)).toEqual(['tags']);
        for (const tag of metadata.tags!) {
          expect(Object.keys(tag)).toEqual(['name']);
          expect(typeof tag.name).toBe('string');
        }
      }
    });

    it('still carries the labels the service tests read: tagged senders in the 0xed0c capture', () => {
      const tagged = load(`ethereum-${ETH_FUNDER}.json`).answer.items.filter((tx) => tx.from.metadata !== null);
      expect(tagged.length).toBeGreaterThan(5);
      expect(JSON.stringify(tagged.map((tx) => tx.from.metadata))).toContain('Binance: Hot Wallet');
    });

    it.each(restFiles)('%s says it is a trimmed capture, with its date', (name) => {
      const fixture = load(name);
      expect(fixture.note).toBe(
        `trimmed to the fields the reader uses (sender metadata cut to its tag names) from a keyless capture of ${fixture.capturedAt!.slice(0, 10)}`,
      );
      expect(fixture.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it.each(txlistFiles)('%s keeps only the txlist fields the reader uses, and says it is a keyed capture with its date', (name) => {
      const fixture = loadRaw(name);
      expect(fixture.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(fixture.note).toBe(
        `trimmed to the fields the reader uses (rows cut to blockNumber, timeStamp, from, to, value, isError, txreceipt_status) from a keyed capture of ${fixture.capturedAt!.slice(0, 10)}`,
      );
      expect(fixture.chain).toBe('arbitrum');
      expect(fixture.url).toMatch(/^https:\/\/api\.blockscout\.com\/v2\/api\?chain_id=42161&module=account&action=txlist&address=0x[0-9a-f]{40}&sort=asc&page=1&offset=\d+$/);
      const answer = fixture.answer as { status: string; message: string; result: Array<Record<string, unknown>> | string };
      expect(Object.keys(answer).sort()).toEqual(['message', 'result', 'status']);
      if (typeof answer.result === 'string') return;
      for (const row of answer.result) {
        const keys = Object.keys(row).sort();
        expect(keys).toEqual(expect.arrayContaining(['blockNumber', 'from', 'isError', 'timeStamp', 'to', 'value']));
        for (const key of keys) expect(['blockNumber', 'timeStamp', 'from', 'to', 'value', 'isError', 'txreceipt_status']).toContain(key);
        for (const value of Object.values(row)) expect(typeof value).toBe('string');
      }
    });

    it.each(labelFiles)('%s keeps only hash, name and tag names of the parties, and says it is a keyed capture with its date', (name) => {
      const fixture = loadRaw(name);
      expect(fixture.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(fixture.note).toBe(
        `trimmed to the parties of the first three transactions, each cut to hash, name and tag names, from a keyed capture of ${fixture.capturedAt!.slice(0, 10)}`,
      );
      const page = fixture.answer as { items: Array<{ from: Record<string, unknown>; to: Record<string, unknown> }> };
      expect(Object.keys(page)).toEqual(['items']);
      expect(page.items.length).toBeLessThanOrEqual(3);
      for (const item of page.items) {
        expect(Object.keys(item).sort()).toEqual(['from', 'to']);
        for (const party of [item.from, item.to]) {
          expect(Object.keys(party).sort()).toEqual(['hash', 'metadata', 'name']);
          const metadata = party.metadata as { tags: Array<Record<string, unknown>> } | null;
          if (metadata === null) continue;
          expect(Object.keys(metadata)).toEqual(['tags']);
          for (const tag of metadata.tags) expect(Object.keys(tag)).toEqual(['name']);
        }
      }
    });

    it('holds no key and no raw upstream field names that were cut', () => {
      for (const name of files) {
        const text = readFileSync(join(DIR, name), 'utf8');
        expect(text.toLowerCase()).not.toMatch(/bearer|authorization|apikey|api_key/);
        expect(text).not.toContain('"confirmations"');
        expect(text).not.toContain('"gasUsed"');
      }
    });

    it('stays small: no raw upstream pages are committed', () => {
      for (const name of files) expect(readFileSync(join(DIR, name), 'utf8').length).toBeLessThan(40_000);
    });
  });

  describe('the Arbitrum capture of 2026-11-10 (a real key)', () => {
    it('says in the file itself that it is a trimmed keyed capture, with its date', () => {
      const fixture = loadRaw(ARB_FILE);
      expect(fixture.capturedAt).toMatch(/^2026-11-10T/);
      expect(fixture.note).toBe(
        'trimmed to the fields the reader uses (rows cut to blockNumber, timeStamp, from, to, value, isError, txreceipt_status) from a keyed capture of 2026-11-10',
      );
      expect(fixture.note).not.toMatch(/synthetic|hand-written/i);
      expect(fixture.url).toBe(
        `https://api.blockscout.com/v2/api?chain_id=42161&module=account&action=txlist&address=${ABRAXAS}&sort=asc&page=1&offset=8`,
      );
    });

    it('names the funder and the time the September Nansen read gave, whatever the label says', async () => {
      const nansen = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'nansen', 'related-wallets-abraxas-arbitrum.json'), 'utf8')) as {
        data: Array<{ address: string; block_timestamp: string }>;
      };
      stubFetch(json(arbitrum()), json(labelPageFor(ARB_FUNDER, null)));
      const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      expect(read).toEqual({
        link: {
          address: ARB_FUNDER,
          relation: 'First Funder',
          chain: 'arbitrum',
          serviceStatus: 'unverified',
          fundedAt: Date.parse(nansen.data[0]!.block_timestamp),
        },
        complete: true,
      });
      expect(read.link?.fundedAt).toBe(Date.UTC(2025, 1, 20, 17, 18, 29));
      expect(nansen.data[0]!.address).toBe(ARB_FUNDER);
    });

    it("decodes the capture: the first row is the funding, the later ones are the wallet's own calls", () => {
      const { result } = arbitrum();
      expect(result).toHaveLength(8);
      expect(result[0]).toMatchObject({ from: ARB_FUNDER, to: ABRAXAS, value: '200000000000000000', isError: '0', txreceipt_status: '1' });
      for (const later of result.slice(1)) expect(later.from).toBe(ABRAXAS);
    });
  });

  describe('the Arbitrum read: an Etherscan-style txlist, whole page checked', () => {
    it('asks for the oldest 50 rows of both directions, with no filter, no block range, the key in the header only', async () => {
      const fn = stubFetch(json(arbitrum()), json(labelPageFor(ARB_FUNDER, null)));
      await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      const url = new URL(urlOf(fn));
      expect(url.origin + url.pathname).toBe('https://api.blockscout.com/v2/api');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        chain_id: '42161',
        module: 'account',
        action: 'txlist',
        address: ABRAXAS,
        sort: 'asc',
        page: '1',
        offset: '50',
      });
      // The live answer to `filterby` / `startblock` / `endblock` was "No transactions found": none is sent.
      for (const forbidden of ['filterby', 'startblock', 'endblock', 'apikey', 'key']) expect(url.searchParams.has(forbidden)).toBe(false);
      expect(urlOf(fn)).not.toContain(KEY);
      expect(headersOf(fn).Authorization).toBe(`Bearer ${KEY}`);
      expect((fn.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
      expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('GET');
    });

    it('asks for the lowercase address even when given a checksummed one', async () => {
      const fn = stubFetch(json(arbitrum()));
      await readFirstFunder('0xB83DE012dbA672c76A7dbbbF3E459CB59D7D6E36', 'arbitrum', { apiKey: KEY });
      expect(new URL(urlOf(fn)).searchParams.get('address')).toBe(ABRAXAS);
    });

    it('charges one request for a txlist that finds no funder, and sends nothing for Ethereum', async () => {
      const fn = stubFetch(json(NO_TRANSACTIONS));
      const { signal, budget } = budgetedSignal(5);
      await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }, signal);
      expect(budget.used()).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('reads the funder from the capture: its timestamp in seconds becomes milliseconds', async () => {
      stubFetch(json(arbitrum()));
      const out = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      expect(out.link?.address).toBe(ARB_FUNDER);
      expect(out.link?.fundedAt).toBe(1_740_071_909_000);
      expect(out.complete).toBe(true);
    });

    it('lowercases the sender it returns', async () => {
      stubFetch(json(txlist([inbound('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01', '1')])));
      const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
      expect(read.link?.address).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
    });

    it('matches the wallet in any letter case, on either side of a row', async () => {
      const upper = '0xB83DE012dbA672c76A7dbbbF3E459CB59D7D6E36';
      stubFetch(json(txlist([outbound(OTHER, '0', { from: upper }), inbound(OTHER, '5', { to: upper })])));
      expect((await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).link?.address).toBe(OTHER);
    });

    describe('what funds the wallet', () => {
      it.each([
        ['a zero value (a contract call)', inbound(OTHER, '0')],
        ['a zero value written with leading zeros', inbound(OTHER, '000')],
        ['a send to itself', inbound(ABRAXAS, '5')],
        ['a send to itself in another letter case', inbound('0xB83DE012dbA672c76A7dbbbF3E459CB59D7D6E36', '5')],
        ['a reverted transaction (isError 1)', inbound(OTHER, '7', { isError: '1' })],
        ['a transaction whose receipt status is 0', inbound(OTHER, '7', { txreceipt_status: '0' })],
        ['an outbound transaction that carries value', outbound(OTHER, '9')],
      ])('skips %s for the next row that carries value', async (_name, skipped) => {
        stubFetch(json(txlist([skipped, inbound(ARB_FUNDER, '5')])), json(labelPageFor(ARB_FUNDER, null)));
        const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
        expect(read.link?.address).toBe(ARB_FUNDER);
        expect(read.complete).toBe(true);
      });

      it.each([
        ['a receipt status of 1', { txreceipt_status: '1' }],
        ['an empty receipt status (old blocks)', { txreceipt_status: '' }],
        ['no receipt status at all', { txreceipt_status: undefined }],
      ])('counts a transaction with %s', async (_name, extra) => {
        stubFetch(json(txlist([inbound(OTHER, '7', extra)])));
        expect((await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).link?.address).toBe(OTHER);
      });

      it('takes the first qualifying row, not the largest or the last', async () => {
        const rows = [inbound(OTHER, '1', { blockNumber: '100' }), inbound(ARB_FUNDER, '99999', { blockNumber: '101' })];
        stubFetch(json(txlist(rows)));
        expect((await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).link?.address).toBe(OTHER);
      });
    });

    describe('what "nothing came in" is, and is not', () => {
      it('reads the one valid empty answer, status 0 "No transactions found" with an empty list, as complete and no funder', async () => {
        stubFetch(json(NO_TRANSACTIONS));
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: true });
      });

      it('reads the captured answer for an address with no transactions the same way', async () => {
        const fixture = loadRaw(NONE_FILE);
        expect(fixture.answer).toEqual({ status: '0', message: 'No transactions found', result: [] });
        stubFetch(json(fixture.answer));
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: true });
      });

      it('reads the same answer with an empty string for the list as well', async () => {
        stubFetch(json({ status: '0', message: 'No transactions found', result: '' }));
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: true });
      });

      it('reads a short list with nothing that funds the wallet as complete', async () => {
        stubFetch(json(txlist([outbound(OTHER, '0'), inbound(OTHER, '0')])));
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: true });
      });

      it('reads a page of exactly 50 rows with nothing that funds the wallet as incomplete, not as no funder', async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => outbound(OTHER, '0', { blockNumber: String(100 + i) }));
        stubFetch(json(txlist(fifty)), json(txlist(fifty.slice(1))));
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: false });
        // One row fewer is the whole history.
        expect(await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).toEqual({ link: null, complete: true });
      });

      it('finds a funder on a full page: the page is oldest first, so the rest cannot be older', async () => {
        const fifty = Array.from({ length: 50 }, (_, i) =>
          i === 3 ? inbound(ARB_FUNDER, '5', { blockNumber: '103' }) : outbound(OTHER, '0', { blockNumber: String(100 + i) }),
        );
        stubFetch(json(txlist(fifty)), json(labelPageFor(ARB_FUNDER, null)));
        const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
        expect(read.link?.address).toBe(ARB_FUNDER);
        expect(read.complete).toBe(true);
      });

      it('sends no label request when there is no funder', async () => {
        const fn = stubFetch(json(NO_TRANSACTIONS), json(txlist([outbound(OTHER, '0')])));
        await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
        await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY });
        expect(fn).toHaveBeenCalledTimes(2);
      });
    });

    describe('an answer that is not a transaction list is never an empty one', () => {
      it('rejects a 200 whose body is the HTML challenge page', async () => {
        stubFetch(new Response('<!DOCTYPE html><title>Just a moment...</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('rejects a body that is not JSON', async () => {
        stubFetch(new Response('not json at all', { status: 200 }));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it.each([
        ['a body that is a list', []],
        ['a body that is null', null],
        ['a body that is a string', 'OK'],
        ['an object with no status', { message: 'OK', result: [] }],
        ['an object with no message', { status: '1', result: [inbound(OTHER, '5')] }],
        ['an object with no result', { status: '1', message: 'OK' }],
        ['a status that is a number', { status: 1, message: 'OK', result: [inbound(OTHER, '5')] }],
        ['an unknown status', { status: '2', message: 'OK', result: [inbound(OTHER, '5')] }],
        ['status 1 with another message', { status: '1', message: 'NOTOK', result: [inbound(OTHER, '5')] }],
        ['status 0 with another message (a rate limit)', { status: '0', message: 'NOTOK', result: 'Max rate limit reached' }],
        ['status 0 with another message and an empty list', { status: '0', message: 'Query Timeout occured. Please select a smaller result dataset', result: [] }],
        ['status 0 "No transactions found" with rows in the list', { status: '0', message: 'No transactions found', result: [inbound(OTHER, '5')] }],
        ['status 0 "No transactions found" with a text for the list', { status: '0', message: 'No transactions found', result: 'none' }],
        ['status 0 "No transactions found" with no list', { status: '0', message: 'No transactions found' }],
        ['status 1 with an empty list (that is not how "nothing" is said)', { status: '1', message: 'OK', result: [] }],
        ['status 1 with a list that is a string', { status: '1', message: 'OK', result: 'rows' }],
        ['status 1 with a list that is an object', { status: '1', message: 'OK', result: {} }],
        ['status 1 with a list that is null', { status: '1', message: 'OK', result: null }],
      ])('rejects %s', async (_name, body) => {
        stubFetch(json(body));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('rejects a page of more rows than the 50 that were asked for', async () => {
        stubFetch(json(txlist(Array.from({ length: 51 }, (_, i) => inbound(ARB_FUNDER, '5', { blockNumber: String(100 + i) })))));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it.each([
        ['a row that is not an object', 'x'],
        ['a blockNumber that is not digits', inbound(OTHER, '5', { blockNumber: 'latest' })],
        ['a blockNumber written in hex', inbound(OTHER, '5', { blockNumber: '0x64' })],
        ['a blockNumber that is a number', inbound(OTHER, '5', { blockNumber: 100 as unknown as string })],
        ['a blockNumber that is missing', inbound(OTHER, '5', { blockNumber: undefined })],
        ['a timeStamp that is not digits', inbound(OTHER, '5', { timeStamp: 'yesterday' })],
        ['a timeStamp that is missing', inbound(OTHER, '5', { timeStamp: undefined })],
        ['a value that is not digits', inbound(OTHER, '5', { value: '0x5' })],
        ['a value with a decimal point', inbound(OTHER, '5', { value: '0.5' })],
        ['a value that is a number', inbound(OTHER, 5 as unknown as string)],
        ['a value that is missing', inbound(OTHER, '5', { value: undefined })],
        ['a sender that is not an address', inbound('0x12', '5')],
        ['a sender that is missing', inbound(OTHER, '5', { from: undefined })],
        ['a sender with a space around it', inbound(` ${OTHER}`, '5')],
        ['a recipient that is empty (a contract creation)', inbound(OTHER, '5', { to: '' })],
        ['a recipient that is not an address', inbound(OTHER, '5', { to: 'not an address' })],
        ['an isError that is not 0 or 1', inbound(OTHER, '5', { isError: 'x' })],
        ['an isError that is a number', inbound(OTHER, '5', { isError: 0 as unknown as string })],
        ['an isError that is missing', inbound(OTHER, '5', { isError: undefined })],
        ['a receipt status that is neither 0, 1 nor empty', inbound(OTHER, '5', { txreceipt_status: 'ok' })],
        ['a receipt status that is a number', inbound(OTHER, '5', { txreceipt_status: 1 as unknown as string })],
      ])('rejects %s', async (_name, bad) => {
        stubFetch(json(txlist([bad])));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it("names no part of the explorer's own text, or the key, in the error it throws", async () => {
        stubFetch(json({ status: '0', message: `Invalid API Key ${KEY}`, result: `Invalid API Key ${KEY}` }));
        const err = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(UpstreamShapeError);
        expect(String((err as Error).message)).not.toContain(KEY);
        expect(String((err as Error).message)).not.toContain('Invalid API Key');
      });

      it.each([402, 403, 404])('rejects an HTTP %i without a retry', async (status) => {
        const fn = stubFetch(challenge(status));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toThrow(`explorer arbitrum answered ${status}`);
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('retries the upstream 500 Blockscout gives now and then, charging both sends, and reads the answer that follows', async () => {
        const upstream = new Response('{"error":"Internal server error","source":"upstream"}', { status: 500, headers: { 'content-type': 'application/json' } });
        const fn = stubFetch(upstream, json(arbitrum()), json(labelPageFor(ARB_FUNDER, null)));
        const { signal, budget } = budgetedSignal(5);
        const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }, signal);
        expect(read.link?.address).toBe(ARB_FUNDER);
        expect(fn).toHaveBeenCalledTimes(3);
        expect(budget.used()).toBe(3);
      });

      it('rejects a 500 that is still a 500 after its one retry, with the status and no key in the message', async () => {
        const fn = stubFetch(challenge(500), challenge(500), json(arbitrum()));
        const err = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }).catch((e: unknown) => e);
        expect(String((err as Error).message)).toBe('explorer arbitrum answered 500');
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('retries a 429 once, charging both sends, and reads the answer that follows', async () => {
        const fn = stubFetch(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), json(arbitrum()), json(labelPageFor(ARB_FUNDER, null)));
        const { signal, budget } = budgetedSignal(5);
        const read = await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }, signal);
        expect(read.link?.address).toBe(ARB_FUNDER);
        expect(fn).toHaveBeenCalledTimes(3);
        expect(budget.used()).toBe(3);
      });

      it.each([301, 302, 307, 308])('reads a %i as a refusal: no second request, no Location followed', async (status) => {
        const fn = stubFetch(new Response(null, { status, headers: { location: 'https://elsewhere.example/steal' } }), json(arbitrum()));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toThrow(`explorer arbitrum answered ${status}`);
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    describe('a page that is not the one that was asked for fails closed', () => {
      it('rejects a newest-first page, even when its first row qualifies', async () => {
        const rows = [inbound(ARB_FUNDER, '5', { blockNumber: '300' }), inbound(OTHER, '5', { blockNumber: '200' }), inbound(OTHER, '5', { blockNumber: '100' })];
        stubFetch(json(txlist(rows)));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('rejects a page whose last row breaks the order, though a funder came first', async () => {
        const rows = [inbound(ARB_FUNDER, '5', { blockNumber: '100' }), outbound(OTHER, '0', { blockNumber: '200' }), outbound(OTHER, '0', { blockNumber: '150' })];
        stubFetch(json(txlist(rows)));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('compares block numbers as numbers, not as text: 99 before 100 is rising', async () => {
        stubFetch(json(txlist([outbound(OTHER, '0', { blockNumber: '99' }), inbound(ARB_FUNDER, '5', { blockNumber: '100' })])), json(labelPageFor(ARB_FUNDER, null)));
        expect((await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).link?.address).toBe(ARB_FUNDER);
      });

      it('accepts block numbers that stay equal or rise', async () => {
        const rows = [inbound(OTHER, '0', { blockNumber: '100' }), inbound(OTHER, '0', { blockNumber: '100' }), inbound(ARB_FUNDER, '5', { blockNumber: '101' })];
        stubFetch(json(txlist(rows)), json(labelPageFor(ARB_FUNDER, null)));
        expect((await readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).link?.address).toBe(ARB_FUNDER);
      });

      it('rejects a row from another wallet, even one further down than the funder', async () => {
        const stranger = inbound(ARB_FUNDER, '5', { from: OTHER, to: ARB_FUNDER });
        stubFetch(json(txlist([inbound(ARB_FUNDER, '5'), stranger])));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('rejects a row from another wallet that carries no value as well', async () => {
        stubFetch(json(txlist([inbound(OTHER, '0', { from: ARB_FUNDER, to: OTHER }), inbound(OTHER, '5')])));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });

      it('rejects a bad field in a row after the funder, so the whole page is checked and not just its head', async () => {
        stubFetch(json(txlist([inbound(ARB_FUNDER, '5'), inbound(OTHER, '0', { value: 'x' })])));
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY })).rejects.toBeInstanceOf(UpstreamShapeError);
      });
    });
  });

  describe('what the Arbitrum sender is called (one best-effort request on the Ethereum chain)', () => {
    const LABEL_URL = `https://api.blockscout.com/1/api/v2/addresses/${ARB_FUNDER}/transactions?filter=to&sort=block_number&order=asc`;
    const read = (signal?: AbortSignal) => readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }, signal);

    it("asks the Ethereum chain for the sender's transactions, the key in the header only, redirects handed back", async () => {
      const fn = stubFetch(json(arbitrum()), json(binanceLabel()));
      await read();
      expect(fn).toHaveBeenCalledTimes(2);
      expect(urlOf(fn, 1)).toBe(LABEL_URL);
      expect(urlOf(fn, 1)).not.toContain(KEY);
      expect(headersOf(fn, 1).Authorization).toBe(`Bearer ${KEY}`);
      expect((fn.mock.calls[1]![1] as RequestInit).redirect).toBe('manual');
      expect((fn.mock.calls[1]![1] as RequestInit).method).toBe('GET');
    });

    it("reads a sender whose own party carries a Binance tag as a service, and returns no label text", async () => {
      stubFetch(json(arbitrum()), json(binanceLabel()));
      const out = await read();
      expect(out.link?.serviceStatus).toBe('service');
      expect(Object.keys(out.link!).sort()).toEqual(['address', 'chain', 'fundedAt', 'relation', 'serviceStatus']);
      const shown = JSON.stringify(out).toLowerCase();
      for (const word of ['binance', 'exchange', 'hot wallet', 'metadata', 'tag']) expect(shown).not.toContain(word);
    });

    it("reads the capture of the funder's transaction list as carrying that tag on its recipient party", () => {
      const page = binanceLabel() as { items: Array<{ to: { hash: string; metadata: { tags: Array<{ name: string }> } } }> };
      expect(page.items[0]!.to.hash.toLowerCase()).toBe(ARB_FUNDER);
      expect(page.items[0]!.to.metadata.tags.map((t) => t.name)).toContain('Binance: Hot Wallet');
    });

    it('reads a sender with no tags as unverified, not as private', async () => {
      stubFetch(json(arbitrum()), json(labelPageFor(ARB_FUNDER, null)));
      expect((await read()).link?.serviceStatus).toBe('unverified');
    });

    it('reads a sender whose own name matches the exchange pattern as a service', async () => {
      const page = labelPageFor(ARB_FUNDER, null);
      (page.items[0]!.to as Record<string, unknown>).name = 'Coinbase 10';
      stubFetch(json(arbitrum()), json(page));
      expect((await read()).link?.serviceStatus).toBe('service');
    });

    it('finds the sender on its sending side of a row as well, in any letter case', async () => {
      const page = {
        items: [
          {
            from: { hash: '0xB38E8C17E38363AF6EBDCB3DAE12E0243582891D', name: null, metadata: { tags: [{ name: 'Kraken: Hot Wallet' }] } },
            to: { hash: OTHER, name: null, metadata: null },
          },
        ],
      };
      stubFetch(json(arbitrum()), json(page));
      expect((await read()).link?.serviceStatus).toBe('service');
    });

    it("does not read the counterparty's tag as the sender's", async () => {
      stubFetch(json(arbitrum()), json(labelPageFor(ARB_FUNDER, null, ['Binance: Hot Wallet', 'Exchange'])));
      expect((await read()).link?.serviceStatus).toBe('unverified');
    });

    it('reads a list about another address as no label at all', async () => {
      stubFetch(json(arbitrum()), json(labelPageFor(OTHER, ['Binance: Hot Wallet'])));
      expect((await read()).link?.serviceStatus).toBe('unverified');
    });

    it.each([
      ['a tag that matches no service pattern', ['Multisig', 'Contract Deployer']],
      ['a DEX router tag', ['Uniswap V3: Router', 'DEX Router']],
    ])('reads %s as unverified, never as not-service', async (_name, tags) => {
      stubFetch(json(arbitrum()), json(labelPageFor(ARB_FUNDER, tags)));
      expect((await read()).link?.serviceStatus).toBe('unverified');
    });

    it("does not read an address-info answer's metadata as a label: that answer carries none for a tagged address", async () => {
      // Seen live 2026-11-10: GET /1/api/v2/addresses/<0xb38e...> answered
      // `metadata: null` although the transaction lists tag it as Binance.
      const info = { hash: ARB_FUNDER, name: null, metadata: null, public_tags: [], is_contract: false };
      stubFetch(json(arbitrum()), json(info));
      expect((await read()).link?.serviceStatus).toBe('unverified');
    });

    it('reads a sender on the local list of known shared services as a service, and sends no label request', async () => {
      const known = '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549';
      const fn = stubFetch(json(txlist([inbound(known, '5')])));
      const out = await read();
      expect(out.link?.serviceStatus).toBe('service');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    describe('a lookup that does not work is not an error of the chain read', () => {
      it.each([
        ['an HTTP 403 challenge page', () => challenge(403)],
        ['an HTTP 402', () => json({ message: 'payment required' }, 402)],
        ['an HTTP 302', () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } })],
        ['a body that is not JSON', () => new Response('not json', { status: 200 })],
        ['an HTML page with a 200', () => new Response('<!DOCTYPE html><title>Just a moment...</title>', { status: 200 })],
        ['a body that is null', () => json(null)],
        ['a list with no items', () => json({ next_page_params: null })],
        ['items that is not a list', () => json({ items: 'none' })],
        ['an item that is not an object', () => json({ items: ['x'] })],
        ['parties of the wrong shape', () => json({ items: [{ from: 'a', to: 7 }] })],
      ])('keeps the link, unverified, on %s', async (_name, answer) => {
        const fn = stubFetch(json(arbitrum()), answer());
        const out = await read();
        expect(out.link).toEqual({ address: ARB_FUNDER, relation: 'First Funder', chain: 'arbitrum', serviceStatus: 'unverified', fundedAt: 1_740_071_909_000 });
        expect(out.complete).toBe(true);
        expect(fn).toHaveBeenCalledTimes(2);
      });

      it('keeps the link, unverified, when the lookup times out or the network fails', async () => {
        let calls = 0;
        global.fetch = vi.fn(async () => {
          calls++;
          if (calls === 1) return json(arbitrum());
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }) as unknown as typeof fetch;
        expect((await read()).link?.serviceStatus).toBe('unverified');
        expect(calls).toBe(2);
      });

      it('gives a failed lookup the one shared retry and no more: a second 500 leaves the link unverified', async () => {
        const fn = stubFetch(json(arbitrum()), json({ error: 'Internal server error' }, 500), json({ error: 'Internal server error' }, 500), json(binanceLabel()));
        expect((await read()).link?.serviceStatus).toBe('unverified');
        expect(fn).toHaveBeenCalledTimes(3);
      });

      it('retries a 500 of the lookup once and reads the answer that follows', async () => {
        const fn = stubFetch(json(arbitrum()), json({ error: 'Internal server error', source: 'upstream' }, 500), json(binanceLabel()));
        expect((await read()).link?.serviceStatus).toBe('service');
        expect(fn).toHaveBeenCalledTimes(3);
      });

      it('retries a 429 of the lookup once, as every explorer send does, and reads the answer that follows', async () => {
        const fn = stubFetch(json(arbitrum()), new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }), json(binanceLabel()));
        const { signal, budget } = budgetedSignal(5);
        expect((await read(signal)).link?.serviceStatus).toBe('service');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(budget.used()).toBe(3);
      });

      it('writes the key into no log line of its own', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        stubFetch(json(arbitrum()), json({ error: KEY }, 500));
        await read();
        for (const call of [...warn.mock.calls, ...error.mock.calls]) expect(JSON.stringify(call)).not.toContain(KEY);
        vi.restoreAllMocks();
      });
    });

    describe('the request budget', () => {
      it('charges the lookup like any explorer send: two charges for the whole Arbitrum read', async () => {
        stubFetch(json(arbitrum()), json(binanceLabel()));
        const { signal, budget } = budgetedSignal(5);
        await read(signal);
        expect(budget.used()).toBe(2);
      });

      it('returns the link, unverified, when the budget refuses only the lookup', async () => {
        const fn = stubFetch(json(arbitrum()), json(binanceLabel()));
        const { signal, budget } = budgetedSignal(1);
        const out = await read(signal);
        expect(out.link?.address).toBe(ARB_FUNDER);
        expect(out.link?.serviceStatus).toBe('unverified');
        expect(out.complete).toBe(true);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(budget.used()).toBe(1);
      });

      it('still reports a refusal of the txlist itself as a limit, through readFundingLinks', async () => {
        stubFetch(json(abraxas()), json(arbitrum()));
        const { signal } = budgetedSignal(1);
        const links = await readFundingLinks(ABRAXAS, { apiKey: KEY }, signal);
        expect(links.chains).toEqual([
          { chain: 'ethereum', status: 'read', complete: true },
          { chain: 'arbitrum', status: 'not-read', reason: 'limit' },
        ]);
      });

      it('keeps both chains read, and the Arbitrum link unverified, when only the lookup is refused', async () => {
        stubFetch(json(abraxas()), json(arbitrum()), json(binanceLabel()));
        const { signal, budget } = budgetedSignal(2);
        const links = await readFundingLinks(ABRAXAS, { apiKey: KEY }, signal);
        expect(links.chains).toEqual([
          { chain: 'ethereum', status: 'read', complete: true },
          { chain: 'arbitrum', status: 'read', complete: true },
        ]);
        expect(links.links.map((l) => [l.chain, l.serviceStatus])).toEqual([
          ['ethereum', 'unverified'],
          ['arbitrum', 'unverified'],
        ]);
        expect(budget.used()).toBe(2);
      });

      it('reads the chain as not read, with nothing sent, when the check is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
          if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          return json(arbitrum());
        }) as unknown as typeof fetch;
        await expect(readFirstFunder(ABRAXAS, 'arbitrum', { apiKey: KEY }, controller.signal)).rejects.toThrow();
      });
    });

    it('is not made for Ethereum, whose own list carries the label', async () => {
      const fn = stubFetch(json(abraxas()));
      await readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is not made without a key: Arbitrum is refused before any request', async () => {
      const fn = stubFetch(json(arbitrum()));
      await expect(readFirstFunder(ABRAXAS, 'arbitrum', {})).rejects.toBeInstanceOf(ExplorerUnavailable);
      expect(fn).not.toHaveBeenCalled();
    });
  });
});

describe('readFundingLinks', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('without a key returns the Ethereum link and says Arbitrum was not read for want of a key', async () => {
    const fn = stubFetch(json(abraxas()));
    const read = await readFundingLinks(ABRAXAS, {});
    expect(read.links).toEqual([
      { address: ETH_FUNDER, relation: 'First Funder', chain: 'ethereum', serviceStatus: 'unverified', fundedAt: Date.UTC(2025, 6, 8, 19, 23, 59) },
    ]);
    expect(read.chains).toEqual([
      { chain: 'ethereum', status: 'read', complete: true },
      { chain: 'arbitrum', status: 'not-read', reason: 'no-key' },
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('with a key reads Ethereum on the REST path and Arbitrum on the txlist, and returns Ethereum first', async () => {
    const fn = stubFetch(json(abraxas()), json(arbitrum()), json(binanceLabel()));
    const read = await readFundingLinks(ABRAXAS, { apiKey: KEY });
    expect(read.links.map((l) => [l.chain, l.address])).toEqual([
      ['ethereum', ETH_FUNDER],
      ['arbitrum', ARB_FUNDER],
    ]);
    expect(read.chains).toEqual([
      { chain: 'ethereum', status: 'read', complete: true },
      { chain: 'arbitrum', status: 'read', complete: true },
    ]);
    // Ethereum on the REST path, Arbitrum on the txlist, then the Arbitrum sender's label.
    expect(fn).toHaveBeenCalledTimes(3);
    expect(urlOf(fn, 0)).toContain('api.blockscout.com/1/api/v2/addresses/');
    expect(urlOf(fn, 1)).toContain('api.blockscout.com/v2/api?chain_id=42161&module=account&action=txlist');
    expect(urlOf(fn, 2)).toBe(`https://api.blockscout.com/1/api/v2/addresses/${ARB_FUNDER}/transactions?filter=to&sort=block_number&order=asc`);
    for (let i = 0; i < 3; i++) expect(headersOf(fn, i).Authorization).toBe(`Bearer ${KEY}`);
    expect(read.links[1]!.serviceStatus).toBe('service');
  });

  it('lets a budget refusal fall on Arbitrum, the last chain, and reports it as a limit', async () => {
    const fn = stubFetch(json(abraxas()), json(arbitrum()));
    const { signal, budget } = budgetedSignal(1);
    const read = await readFundingLinks(ABRAXAS, { apiKey: KEY }, signal);
    expect(read.links.map((l) => l.chain)).toEqual(['ethereum']);
    expect(read.chains).toEqual([
      { chain: 'ethereum', status: 'read', complete: true },
      { chain: 'arbitrum', status: 'not-read', reason: 'limit' },
    ]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(budget.used()).toBe(1);
  });

  it('reports a chain whose answer was refused as not read, with the other chain still read', async () => {
    stubFetch(challenge(403), json(arbitrum()), json(binanceLabel()));
    const read = await readFundingLinks(ABRAXAS, { apiKey: KEY });
    expect(read.links.map((l) => l.chain)).toEqual(['arbitrum']);
    expect(read.chains).toEqual([
      { chain: 'ethereum', status: 'not-read', reason: 'error' },
      { chain: 'arbitrum', status: 'read', complete: true },
    ]);
  });

  it('reports a chain with a wrong-shaped answer as an error, not as no funder', async () => {
    stubFetch(json({ items: 'nothing' }));
    const read = await readFundingLinks(ABRAXAS, {});
    expect(read.links).toEqual([]);
    expect(read.chains[0]).toEqual({ chain: 'ethereum', status: 'not-read', reason: 'error' });
  });

  it('reports a read that found nothing on a first page with more behind it as read but incomplete', async () => {
    stubFetch(json({ items: [item(OTHER, '0')], next_page_params: { block_number: 9 } }));
    const read = await readFundingLinks(ABRAXAS, {});
    expect(read.links).toEqual([]);
    expect(read.chains[0]).toEqual({ chain: 'ethereum', status: 'read', complete: false });
  });

  it('reads an address that is not an address as an error on both chains, sending nothing', async () => {
    const fn = stubFetch(json(abraxas()));
    const read = await readFundingLinks('nope', { apiKey: KEY });
    expect(read.links).toEqual([]);
    expect(read.chains).toEqual([
      { chain: 'ethereum', status: 'not-read', reason: 'error' },
      { chain: 'arbitrum', status: 'not-read', reason: 'error' },
    ]);
    expect(fn).not.toHaveBeenCalled();
  });
});

// A key that is configured but cannot be a header value is read as no key, and the card then says
// "no explorer key is configured", which is not what the operator did. One line in the Worker's log
// says what happened (final review of stage 3, M1); it never carries the key.
describe('a configured key that cannot be a header value', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });
  // The warning is once per isolate, held in the module: each case starts from a fresh copy of it.
  const freshModule = async () => {
    vi.resetModules();
    return import('../../src/sources/explorer');
  };
  const BAD_KEY = 'sekret-7f3a9c1dé-key';

  it('warns once for two reads, says reads go keyless, and never quotes the key', async () => {
    const explorer = await freshModule();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = stubFetch(json(abraxas()), json(abraxas()));
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', { apiKey: BAD_KEY });
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', { apiKey: BAD_KEY });
    // Both reads went keyless, as before.
    expect(urlOf(fn, 0)).toContain('https://eth.blockscout.com/');
    expect(headersOf(fn, 1).Authorization).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    const text = String(warn.mock.calls[0]![0]);
    expect(text).toMatch(/Blockscout key is configured/);
    expect(text).toMatch(/not a usable header value/);
    expect(text).toMatch(/keyless/);
    // Nothing of the key: not the whole of it, and not a piece.
    for (const piece of [BAD_KEY, 'sekret', '7f3a9c1d', 'é']) expect(text).not.toContain(piece);
  });

  it('warns once across both chains of one search', async () => {
    const explorer = await freshModule();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(json(abraxas()), json(abraxas()));
    await explorer.readFundingLinks(ABRAXAS, { apiKey: BAD_KEY });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing for no key, an empty key, or a usable key', async () => {
    const explorer = await freshModule();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(json(abraxas()), json(abraxas()), json(abraxas()), json(abraxas()));
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', {});
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', { apiKey: '' });
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', { apiKey: '   ' });
    await explorer.readFirstFunder(ABRAXAS, 'ethereum', { apiKey: KEY });
    expect(warn).not.toHaveBeenCalled();
  });
});
