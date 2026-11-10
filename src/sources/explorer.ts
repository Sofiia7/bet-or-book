// Who first funded an address, read from a Blockscout block explorer. This
// replaces the "First Funder" link Nansen's related-wallets answered on
// Ethereum and Arbitrum: the sender of the earliest inbound native-coin
// transaction with value above zero. Token transfers are not used (a spam
// airdrop would otherwise become the "first funder").
//
// Three ways in, and the difference matters (each was seen live with a real key
// on 2026-11-10 unless it says otherwise):
//   - Ethereum with a key: the universal API's REST path,
//     https://api.blockscout.com/1/api/v2/addresses/{address}/transactions, key
//     in the Authorization header only. The answer has the same v2 shape as the
//     keyless host's, labels included.
//   - Ethereum without a key: the public host eth.blockscout.com, the same
//     request. (arbitrum.blockscout.com serves a "Just a moment..." challenge
//     page, HTTP 403, to a script, so Arbitrum without a key is not attempted.)
//   - Arbitrum with a key: the same REST path answers 500 to the oldest-first
//     sort (Blockscout's Arbitrum instance does not support it), and answers
//     newest first without it. What does work is the Etherscan-style form,
//     https://api.blockscout.com/v2/api?chain_id=42161&module=account&action=txlist,
//     which lists both directions oldest first as strings. `filterby` and a
//     block range made it answer "No transactions found", so neither is sent;
//     the direction is filtered here. That answer carries no labels, so the
//     sender found is looked up once on the Ethereum chain (see senderStatus).
//
// An answer that is not a list of transactions is never an empty one: a
// challenge page, a refusal, a body that is not JSON, an `items` or `result`
// that is not a list, or an unknown status all reject, so the caller counts the
// chain as not read. Only a valid list with nothing in it - or, for the txlist,
// the one answer that says "No transactions found" - means "nothing came in".
import { chargeRequest, isRequestBudgetExceeded, requestBudgetOf } from '../requestBudget';
import { isValidAddress } from '../guard';
import type { LinkedWallet } from '../types';
import { UpstreamShapeError, serviceStatusOf } from './normalize';
import { RETRY_MAX_WAIT_MS, RETRY_STATUSES, pause, retryWaitMs } from './retry';

export type FundingChain = 'ethereum' | 'arbitrum';

export interface ExplorerConfig {
  /** A Blockscout PRO API key. Optional: without one only Ethereum can be read. */
  apiKey?: string;
}

export type ChainRead =
  | { chain: FundingChain; status: 'read'; complete: boolean }
  | { chain: FundingChain; status: 'not-read'; reason: 'error' | 'limit' | 'no-key' };

/** Thrown, before any request, for a chain that cannot be read without a key. */
export class ExplorerUnavailable extends Error {
  readonly reason = 'no-key' as const;
  readonly chain: FundingChain;
  constructor(chain: FundingChain) {
    super(`the ${chain} explorer needs an API key and none is configured`);
    this.name = 'ExplorerUnavailable';
    this.chain = chain;
  }
}

const CHAIN_IDS: Record<FundingChain, number> = { ethereum: 1, arbitrum: 42161 };
/** The per-chain hosts that answer a script without a key. */
const PUBLIC_HOSTS: Partial<Record<FundingChain, string>> = { ethereum: 'https://eth.blockscout.com' };
const KEYED_HOST = 'https://api.blockscout.com';
const QUERY = 'filter=to&sort=block_number&order=asc';
const TIMEOUT_MS = 10_000;
/** Blockscout's page size on the REST endpoint, and the number of rows asked of the txlist. */
const FULL_PAGE = 50;
/** The chains read through the Etherscan-style txlist rather than the REST path (keyed only). */
const READ_AS_TXLIST: ReadonlySet<FundingChain> = new Set(['arbitrum']);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** What a header value may hold here: visible ASCII, no spaces. A key outside
 * this would make `fetch` throw an error that quotes it, so it is not used. */
const KEY_SHAPE = /^[\x21-\x7e]+$/;
const DECIMAL = /^\d+$/;
const ZERO = /^0+$/;

/** Whether this isolate has already said that a configured key is unusable. */
let warnedUnusableKey = false;

/**
 * The key to send, or null for "read keyless". An empty key is no key. A key
 * that is set but cannot be a header value is read as none too - the card then
 * says "no explorer key is configured", which is not what the operator did - so
 * the log says it once per isolate. The line never carries the key or any part
 * of it: a bad secret is exactly the kind that has a stray character in it.
 */
function usableKey(config: ExplorerConfig): string | null {
  const key = config.apiKey?.trim();
  if (key === undefined || key === '') return null;
  if (KEY_SHAPE.test(key)) return key;
  if (!warnedUnusableKey) {
    warnedUnusableKey = true;
    console.warn(
      'A Blockscout key is configured but is not a usable header value (visible ASCII, no spaces), so explorer reads go keyless.',
    );
  }
  return null;
}

function deadlineFor(signal?: AbortSignal): AbortSignal {
  const own = AbortSignal.timeout(TIMEOUT_MS);
  return signal === undefined ? own : AbortSignal.any([own, signal]);
}

interface ExplorerRequest {
  url: string;
  headers: Record<string, string>;
}

function requestFor(address: string, chain: FundingChain, config: ExplorerConfig): ExplorerRequest {
  const key = usableKey(config);
  if (key !== null) {
    return {
      url: `${KEYED_HOST}/${CHAIN_IDS[chain]}/api/v2/addresses/${address}/transactions?${QUERY}`,
      headers: keyedHeaders(key),
    };
  }
  const host = PUBLIC_HOSTS[chain];
  if (host === undefined) throw new ExplorerUnavailable(chain);
  return { url: `${host}/api/v2/addresses/${address}/transactions?${QUERY}`, headers: { Accept: 'application/json' } };
}

function keyedHeaders(key: string): Record<string, string> {
  return { Accept: 'application/json', Authorization: `Bearer ${key}` };
}

/** The Etherscan-style form: the oldest FULL_PAGE rows of the address in both
 * directions. No `filterby` and no block range - with them the keyed answer was
 * "No transactions found" for an address that has transactions. */
function txlistRequest(address: string, chain: FundingChain, key: string): ExplorerRequest {
  return {
    url:
      `${KEYED_HOST}/v2/api?chain_id=${CHAIN_IDS[chain]}&module=account&action=txlist` +
      `&address=${address}&sort=asc&page=1&offset=${FULL_PAGE}`,
    headers: keyedHeaders(key),
  };
}

/** One GET, charged to the check's budget before it is sent, with one retry
 * when the explorer says "try again in a moment" and the budget affords it. */
async function getJson(request: ExplorerRequest, chain: FundingChain, signal?: AbortSignal): Promise<unknown> {
  // `redirect: 'manual'`: the Authorization header must never follow a Location.
  // The obvious `'error'` is refused by workerd (TypeError, probed 2026-11-09),
  // which would fail every read on Cloudflare; `'manual'` returns the 3xx
  // itself, and a 3xx is not `ok`, so it is rejected below like any refusal.
  const send = (): Promise<Response> =>
    fetch(request.url, { method: 'GET', headers: request.headers, redirect: 'manual', signal: deadlineFor(signal) });
  chargeRequest(signal, 'explorer');
  let res = await send();
  // The retry is a request like any other: sent only when the budget affords it, and charged.
  if (!res.ok && RETRY_STATUSES.has(res.status) && !signal?.aborted && (requestBudgetOf(signal)?.affords(1) ?? true)) {
    const wait = retryWaitMs(res);
    if (wait <= RETRY_MAX_WAIT_MS) {
      await res.body?.cancel().catch(() => {});
      await pause(wait, signal);
      if (!signal?.aborted) {
        chargeRequest(signal, 'explorer');
        res = await send();
      }
    }
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    // Status only: the challenge page's body and the request (which carries the key) stay out of the message.
    throw new Error(`explorer ${chain} answered ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamShapeError('explorer answer is not JSON');
  }
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new UpstreamShapeError(`${what} is not an object`);
  return value as Record<string, unknown>;
}

/** What the explorer calls the sender, for one purpose: deciding whether the
 * sender is a shared service. The answer carries a `name` (null for most
 * addresses) and, from Blockscout's metadata service, `metadata.tags[].name`
 * ("Kraken: Hot Wallet", "Exchange", "DEPOSIT ADDRESS", ...). Anything else
 * (an ENS name, a malformed block) is not a label. The text never leaves this
 * file: it is not stored, returned or shown. */
function labelOf(party: Record<string, unknown>): string | null {
  const names: string[] = [];
  if (typeof party.name === 'string') names.push(party.name);
  const metadata = party.metadata;
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const tags = (metadata as Record<string, unknown>).tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (typeof tag === 'object' && tag !== null && typeof (tag as Record<string, unknown>).name === 'string') {
          names.push((tag as Record<string, unknown>).name as string);
        }
      }
    }
  }
  const joined = names.filter((n) => n.trim() !== '').join(' | ');
  return joined === '' ? null : joined;
}

/** Scans one REST page, oldest first, for the first transaction that funded `address`.
 *
 * The page has to show that it is the one that was asked for - inbound to
 * `address`, oldest first - before anything is read from it; a page that does
 * not is a shape error, never a guess (the Arbitrum REST answers newest first
 * when the sort is dropped). The whole page is checked, not just the items up
 * to the first funder: a newest-first answer to a single-page account has a
 * qualifying first item, and stopping there would return the newest sender as
 * the first funder. */
function firstFunder(body: unknown, address: string, chain: FundingChain): { link: LinkedWallet | null; complete: boolean } {
  const page = recordOf(body, 'explorer answer');
  const items = page.items;
  if (!Array.isArray(items)) throw new UpstreamShapeError('explorer items is not a list');
  const next = page.next_page_params;
  if (next !== undefined && next !== null) {
    if (typeof next !== 'object' || Array.isArray(next)) throw new UpstreamShapeError('explorer next_page_params is neither null nor an object');
    // The cursor repeats the query it continues. One that names another order or filter was not made for this one.
    const { order, filter } = next as Record<string, unknown>;
    if (order !== undefined && order !== 'asc') throw new UpstreamShapeError('explorer next_page_params is not oldest first');
    if (filter !== undefined && filter !== 'to') throw new UpstreamShapeError('explorer next_page_params is not inbound only');
  }
  let lastBlock = Number.NEGATIVE_INFINITY;
  const transactions = items.map((raw) => {
    const tx = recordOf(raw, 'explorer transaction');
    const to = recordOf(tx.to, 'transaction recipient');
    if (typeof to.hash !== 'string' || to.hash.toLowerCase() !== address) throw new UpstreamShapeError('transaction is not inbound to the address');
    // A pending transaction has no block yet (null) and rejects the page here.
    const block = tx.block_number;
    if (typeof block !== 'number' || !Number.isFinite(block)) throw new UpstreamShapeError('transaction block_number is not a number');
    if (block < lastBlock) throw new UpstreamShapeError('transactions are not oldest first');
    lastBlock = block;
    return tx;
  });
  for (const tx of transactions) {
    const from = recordOf(tx.from, 'transaction sender');
    if (typeof from.hash !== 'string' || !isValidAddress(from.hash)) throw new UpstreamShapeError('transaction sender is not an address');
    if (typeof tx.value !== 'string' || !DECIMAL.test(tx.value)) throw new UpstreamShapeError('transaction value is not a decimal string');
    // A contract call carries no value; a send to oneself funds nothing; a
    // failed transaction moved no value even when it asked to, and a pending
    // one (status null) has not moved it yet. An absent status or 'ok' counts.
    if (ZERO.test(tx.value) || from.hash.toLowerCase() === address || tx.status === 'error' || tx.status === null) continue;
    const fundedAt = typeof tx.timestamp === 'string' ? Date.parse(tx.timestamp) : NaN;
    if (!Number.isFinite(fundedAt)) throw new UpstreamShapeError('transaction timestamp is not a date');
    return {
      link: {
        address: from.hash.toLowerCase(),
        relation: 'First Funder',
        chain,
        // The label decides this and is dropped: nothing downstream sees it.
        // Only a match makes a sender a service. A label that matches nothing
        // (Multisig, a DEX router, a deployer) vouches for nothing about who
        // is behind the address, so it stays 'unverified' and never becomes
        // 'not-service'.
        serviceStatus: serviceStatusOf(from.hash, labelOf(from)) === 'service' ? 'service' : 'unverified',
        fundedAt,
      },
      complete: true,
    };
  }
  // Nothing on this page funded the address. That means "nothing came in"
  // only on the last page; with more pages behind it (or a full page and no
  // way to tell) the earliest funder may simply not have been reached.
  const complete = next === null || (next === undefined && items.length < FULL_PAGE);
  return { link: null, complete };
}

/** A text field of a txlist row: a string, or the page is not what it claims to be. */
function textOf(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string') throw new UpstreamShapeError(`txlist ${field} is not a string`);
  return value;
}

/** An address field of a txlist row: exactly 20 bytes of hex, no padding. An
 * empty `to` (a contract creation) is not one, and rejects the page like any
 * other value that is not an address. */
function addressOf(row: Record<string, unknown>, field: string): string {
  const value = textOf(row, field);
  if (!ADDRESS.test(value)) throw new UpstreamShapeError(`txlist ${field} is not an address`);
  return value.toLowerCase();
}

/** A field that is decimal digits and nothing else. */
function digitsOf(row: Record<string, unknown>, field: string): string {
  const value = textOf(row, field);
  if (!DECIMAL.test(value)) throw new UpstreamShapeError(`txlist ${field} is not a decimal string`);
  return value;
}

/** Reads one Etherscan-style `txlist` answer, oldest first, for the first
 * transaction that funded `address`.
 *
 * Fail-closed like the REST page. The envelope must be `status "1"`, `message
 * "OK"` and a list of rows; the one answer that means "nothing came in" is
 * `status "0"`, `message "No transactions found"` with an empty list (seen live
 * as `[]`; an empty string is accepted too). Any other status, message or
 * `result` - a rate-limit notice, a timeout, a list where a string should be -
 * is a shape error, never "no funder". The explorer's own text is not put into
 * the error: it could carry anything. Every row is checked, not just those up
 * to the first funder: each field is a string of the right kind, each row
 * involves `address`, and the block numbers never fall, so a newest-first
 * answer, which a first row that qualifies would otherwise pass, is refused. */
function firstFunderFromTxlist(body: unknown, address: string): { funder: { address: string; fundedAt: number } | null; complete: boolean } {
  const answer = recordOf(body, 'explorer answer');
  const { status, message, result } = answer;
  if (status === '0' && message === 'No transactions found') {
    if (Array.isArray(result) ? result.length === 0 : result === '') return { funder: null, complete: true };
    throw new UpstreamShapeError('explorer txlist says there is nothing and lists something');
  }
  if (status !== '1' || message !== 'OK') throw new UpstreamShapeError('explorer txlist status is not OK');
  if (!Array.isArray(result) || result.length === 0) throw new UpstreamShapeError('explorer txlist result is not a list of rows');
  if (result.length > FULL_PAGE) throw new UpstreamShapeError('explorer txlist is longer than the page that was asked for');

  let lastBlock = -1n;
  const rows = result.map((raw) => {
    const row = recordOf(raw, 'txlist row');
    const from = addressOf(row, 'from');
    const to = addressOf(row, 'to');
    if (from !== address && to !== address) throw new UpstreamShapeError('txlist row does not involve the address');
    const block = BigInt(digitsOf(row, 'blockNumber'));
    if (block < lastBlock) throw new UpstreamShapeError('txlist rows are not oldest first');
    lastBlock = block;
    const timeStamp = digitsOf(row, 'timeStamp');
    const value = digitsOf(row, 'value');
    const isError = textOf(row, 'isError');
    if (isError !== '0' && isError !== '1') throw new UpstreamShapeError('txlist isError is neither 0 nor 1');
    // Absent or empty (old blocks) is "no receipt status"; anything but 0 or 1 is not a status.
    const receipt = row.txreceipt_status;
    if (receipt !== undefined && receipt !== '' && receipt !== '0' && receipt !== '1') {
      throw new UpstreamShapeError('txlist txreceipt_status is neither 0 nor 1');
    }
    return { from, to, timeStamp, value, ok: isError === '0' && receipt !== '0' };
  });
  for (const row of rows) {
    // Only an inbound row funds the address: an outbound one (the wallet's own
    // call), a send to itself and a zero value fund nothing, and a reverted
    // transaction moved no value even when it asked to.
    if (row.to !== address || row.from === address || ZERO.test(row.value) || !row.ok) continue;
    const fundedAt = Number(row.timeStamp) * 1000;
    if (!Number.isSafeInteger(fundedAt)) throw new UpstreamShapeError('txlist timeStamp is not a date');
    return { funder: { address: row.from, fundedAt }, complete: true };
  }
  // Nothing in these rows funded the address. A short page is the whole
  // history; a full one may have more behind it, so the earliest funder may
  // not have been reached.
  return { funder: null, complete: rows.length < FULL_PAGE };
}

/** The label of `address` in a Blockscout transaction list on the Ethereum
 * chain, or null for none. Blockscout puts an address's metadata tags on the
 * parties of its transactions (`from` and `to`), not on its address-info
 * answer, which was `metadata: null` for an address the lists tag as a Binance
 * hot wallet (seen live 2026-11-10); so the party that is the address itself
 * is the one read, and a tag on the counterparty is nobody's label here. */
function labelInTransactionList(body: unknown, address: string): string | null {
  const page = recordOf(body, 'explorer answer');
  if (!Array.isArray(page.items)) throw new UpstreamShapeError('explorer items is not a list');
  for (const raw of page.items) {
    const tx = recordOf(raw, 'explorer transaction');
    for (const side of [tx.to, tx.from]) {
      if (typeof side !== 'object' || side === null || Array.isArray(side)) continue;
      const party = side as Record<string, unknown>;
      if (typeof party.hash !== 'string' || party.hash.toLowerCase() !== address) continue;
      const label = labelOf(party);
      if (label !== null) return label;
    }
  }
  return null;
}

/** Whether the sender of an Arbitrum funding link is a shared service. The
 * txlist carries no labels, so the sender is looked up once on the Ethereum
 * chain, where Blockscout tags the exchange hot wallets: an exchange funds from
 * the same address on both chains, and the lookup is used only to skip one.
 *
 * Best effort, and never an error of the chain read: a refusal, a timeout, an
 * answer of the wrong shape or a budget that does not afford the request all
 * leave the sender 'unverified', which fails safe - an unlabelled exchange
 * funder is followed, its holdings matching the short make the reading Unknown,
 * never a Bet. A sender on the local list of known services needs no request. */
async function senderStatus(sender: string, key: string, signal?: AbortSignal): Promise<'service' | 'unverified'> {
  if (serviceStatusOf(sender, null) === 'service') return 'service';
  try {
    const request = { url: `${KEYED_HOST}/${CHAIN_IDS.ethereum}/api/v2/addresses/${sender}/transactions?${QUERY}`, headers: keyedHeaders(key) };
    const label = labelInTransactionList(await getJson(request, 'ethereum', signal), sender);
    return serviceStatusOf(sender, label) === 'service' ? 'service' : 'unverified';
  } catch {
    return 'unverified';
  }
}

async function readViaTxlist(
  wallet: string,
  chain: FundingChain,
  key: string,
  signal?: AbortSignal,
): Promise<{ link: LinkedWallet | null; complete: boolean }> {
  const { funder, complete } = firstFunderFromTxlist(await getJson(txlistRequest(wallet, chain, key), chain, signal), wallet);
  if (funder === null) return { link: null, complete };
  return {
    link: {
      address: funder.address,
      relation: 'First Funder',
      chain,
      serviceStatus: await senderStatus(funder.address, key, signal),
      fundedAt: funder.fundedAt,
    },
    complete: true,
  };
}

/** The first funder of `address` on `chain`. Rejects when the chain could not
 * be read (no key for Arbitrum, a refusal, a shape the explorer was not
 * expected to send, the request budget); a resolved `{ link: null }` is
 * "nothing found", with `complete` saying whether the search ran to the end.
 * An Arbitrum link costs a second request, the sender's label (senderStatus),
 * whose failure never rejects. */
export async function readFirstFunder(
  address: string,
  chain: FundingChain,
  config: ExplorerConfig,
  signal?: AbortSignal,
): Promise<{ link: LinkedWallet | null; complete: boolean }> {
  // The address becomes part of a request path: only 20 bytes of hex go in.
  if (!isValidAddress(address)) throw new Error('explorer: not an address');
  const wallet = address.trim().toLowerCase();
  if (READ_AS_TXLIST.has(chain)) {
    const key = usableKey(config);
    if (key === null) throw new ExplorerUnavailable(chain);
    return readViaTxlist(wallet, chain, key, signal);
  }
  const request = requestFor(wallet, chain, config);
  return firstFunder(await getJson(request, chain, signal), wallet, chain);
}

const FUNDING_CHAINS: FundingChain[] = ['ethereum', 'arbitrum'];

function notReadReason(err: unknown): 'error' | 'limit' | 'no-key' {
  if (isRequestBudgetExceeded(err)) return 'limit';
  if (err instanceof ExplorerUnavailable) return 'no-key';
  return 'error';
}

/** Both chains at once. Ethereum is first, so when the check's budget runs
 * short the refusal falls on the last chain. */
export async function readFundingLinks(
  address: string,
  config: ExplorerConfig,
  signal?: AbortSignal,
): Promise<{ links: LinkedWallet[]; chains: ChainRead[] }> {
  const settled = await Promise.allSettled(FUNDING_CHAINS.map((chain) => readFirstFunder(address, chain, config, signal)));
  const links: LinkedWallet[] = [];
  const chains = settled.map((outcome, i): ChainRead => {
    const chain = FUNDING_CHAINS[i]!;
    if (outcome.status === 'rejected') return { chain, status: 'not-read', reason: notReadReason(outcome.reason) };
    if (outcome.value.link !== null) links.push(outcome.value.link);
    return { chain, status: 'read', complete: outcome.value.complete };
  });
  return { links, chains };
}
