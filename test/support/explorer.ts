// Test-only stand-in for the Blockscout explorer (src/sources/explorer.ts).
// It answers the three requests a check makes, from pages the test gives:
//   - Ethereum, keyed or keyless: the REST "inbound transactions, oldest
//     first" list of an address;
//   - Arbitrum, keyed: the Etherscan-style `txlist` of an address (both
//     directions, strings, status/message/result);
//   - the label lookup for an Arbitrum sender: the same REST list on the
//     Ethereum chain, asked of the sender, whose own party carries its tags.
//     It is told from the Ethereum read by the address only, so a test that
//     names a label gives the sender's Ethereum page (`labelPage`).
// An address or chain the test says nothing about answers an empty last page:
// nothing came in, read in full, and no label.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type ExplorerChain = 'ethereum' | 'arbitrum';

/** A key for the tests: with it both chains are read through the keyed host. */
export const EXPLORER_KEY = 'test-explorer-key';

/** Ethereum on the universal API: the REST path, chain id 1 only (the Arbitrum REST answers 500 to the oldest-first sort, so the reader never asks it). */
const KEYED = /^https:\/\/api\.blockscout\.com\/1\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/transactions\?filter=to&sort=block_number&order=asc$/;
const KEYLESS = /^https:\/\/eth\.blockscout\.com\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/transactions\?filter=to&sort=block_number&order=asc$/;
/** Arbitrum's Etherscan-style form: no `filterby`, no block range, the oldest 50 rows. */
const TXLIST = /^https:\/\/api\.blockscout\.com\/v2\/api\?chain_id=42161&module=account&action=txlist&address=(0x[0-9a-fA-F]{40})&sort=asc&page=1&offset=50$/;

/** The chain and wallet of an explorer request, or null for any other URL.
 * A label lookup (the Ethereum list of an Arbitrum sender) reads as an
 * Ethereum request for the sender. */
export function explorerRequestOf(url: string): { chain: ExplorerChain; wallet: string } | null {
  const keyed = KEYED.exec(url) ?? KEYLESS.exec(url);
  if (keyed) return { chain: 'ethereum', wallet: keyed[1]!.toLowerCase() };
  const txlist = TXLIST.exec(url);
  return txlist ? { chain: 'arbitrum', wallet: txlist[1]!.toLowerCase() } : null;
}

/** One page's answer: a body, or a factory for a Response (a refusal, a challenge page). */
export type ExplorerPage = unknown | (() => Response);
export type ExplorerPages = Record<string, Partial<Record<ExplorerChain, ExplorerPage>>>;

export const EMPTY_PAGE = { items: [], next_page_params: null };
/** The txlist's one valid empty answer (seen live 2026-11-10). */
export const NO_TRANSACTIONS = { status: '0', message: 'No transactions found', result: [] };

/** Answers explorer requests from `pages`, by wallet and chain; null for any
 * other URL, so a test's own router can go on to the next upstream. */
export function explorerAnswers(pages: ExplorerPages = {}): (url: string) => Response | null {
  return (url) => {
    const asked = explorerRequestOf(url);
    if (!asked) return null;
    const page = pages[asked.wallet]?.[asked.chain];
    if (typeof page === 'function') return (page as () => Response)();
    return new Response(JSON.stringify(page ?? (asked.chain === 'arbitrum' ? NO_TRANSACTIONS : EMPTY_PAGE)), { status: 200 });
  };
}

/** A page whose one inbound transaction funded `wallet` from `sender`.
 * `tags` are Blockscout metadata tag names on the sender (an exchange's hot
 * wallet, say); none by default, so the sender reads as unverified. */
export function funderPage(
  wallet: string,
  sender: string,
  opts: { timestamp?: string; tags?: string[]; complete?: boolean } = {},
): unknown {
  return {
    items: [
      {
        from: {
          hash: sender,
          name: null,
          metadata: opts.tags ? { tags: opts.tags.map((name) => ({ name })) } : null,
        },
        to: { hash: wallet },
        value: '50000000000000000',
        timestamp: opts.timestamp ?? '2026-01-01T00:00:00.000000Z',
        status: 'ok',
        block_number: 100,
      },
    ],
    next_page_params: opts.complete === false ? { block_number: 100, index: 0, order: 'asc', filter: 'to' } : null,
  };
}

/** A full page with nothing that funded `wallet` on it and more behind it: the
 * search did not reach the end. */
export function cutShortPage(wallet: string): unknown {
  return {
    items: [
      {
        from: { hash: '0x' + '9'.repeat(40), name: null, metadata: null },
        to: { hash: wallet },
        value: '0',
        timestamp: '2026-01-01T00:00:00.000000Z',
        status: 'ok',
        block_number: 100,
      },
    ],
    next_page_params: { block_number: 100, index: 0, order: 'asc', filter: 'to' },
  };
}

/** The Etherscan-style txlist of `wallet` whose one row is an inbound
 * transaction from `sender` (all values strings, as the live answer). */
export function arbitrumFunderPage(wallet: string, sender: string, opts: { timestamp?: string } = {}): unknown {
  const seconds = Math.floor(Date.parse(opts.timestamp ?? '2026-01-01T00:00:00.000000Z') / 1000);
  return {
    status: '1',
    message: 'OK',
    result: [
      {
        blockNumber: '300000000',
        timeStamp: String(seconds),
        from: sender.toLowerCase(),
        to: wallet.toLowerCase(),
        value: '50000000000000000',
        isError: '0',
        txreceipt_status: '1',
      },
    ],
  };
}

/** A full txlist page with nothing that funded `wallet` on it: the search did
 * not reach the end. */
export function arbitrumCutShortPage(wallet: string): unknown {
  return {
    status: '1',
    message: 'OK',
    result: Array.from({ length: 50 }, (_, i) => ({
      blockNumber: String(300000000 + i),
      timeStamp: '1767225600',
      from: wallet.toLowerCase(),
      to: '0x' + '9'.repeat(40),
      value: '0',
      isError: '0',
      txreceipt_status: '1',
    })),
  };
}

/** The Ethereum transaction list of `sender` as the label lookup reads it: the
 * sender is the recipient of its one item and carries `tags` (an exchange's hot
 * wallet, say). Give it as the `ethereum` page of the sender. */
export function labelPage(sender: string, tags: string[]): unknown {
  return {
    items: [
      {
        from: { hash: '0x' + '9'.repeat(40), name: null, metadata: null },
        to: { hash: sender, name: null, metadata: { tags: tags.map((name) => ({ name })) } },
        value: '1',
        timestamp: '2022-01-01T00:00:00.000000Z',
        status: 'ok',
        block_number: 1,
      },
    ],
    next_page_params: null,
  };
}

const DIR = join(__dirname, '..', 'fixtures', 'explorer');
const fixture = (name: string): unknown =>
  (JSON.parse(readFileSync(join(DIR, name), 'utf8')) as { answer: unknown }).answer;

export const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
/** The Arbitrum funder: the first sender of the Abraxas wallet's txlist. */
export const ARBITRUM_FUNDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';

/** Abraxas's funding links as the explorer answers them: the keyless
 * Ethereum capture of 2026-11-09 (first sender 0xed0c...4312) and the keyed
 * Arbitrum txlist capture of 2026-11-10 (first sender 0xb38e...891d).
 *
 * The label lookup for 0xb38e answers nothing by default (an unlabelled
 * funder, so the search follows both). `labelled: true` answers it with the
 * keyed capture of 2026-11-10, in which Blockscout tags 0xb38e as a Binance
 * hot wallet: the search then skips that funder as an exchange. */
export function abraxasPages(opts: { labelled?: boolean } = {}): ExplorerPages {
  return {
    [ABRAXAS]: {
      ethereum: fixture(`ethereum-${ABRAXAS}.json`),
      arbitrum: fixture(`arbitrum-txlist-${ABRAXAS}.json`),
    },
    ...(opts.labelled ? { [ARBITRUM_FUNDER]: { ethereum: fixture(`ethereum-label-${ARBITRUM_FUNDER}.json`) } } : {}),
  };
}

/** A refusal that is not worth a retry: the explorer is down. */
export const explorerDown = (): Response => new Response('unavailable', { status: 500 });
