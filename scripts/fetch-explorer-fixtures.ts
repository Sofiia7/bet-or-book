// Captures what the Blockscout explorer really answers, so the explorer reader
// is built and tested against it, trimmed to the fields the reader uses
// (scripts/explorer-fixture-trim.ts). Read-only, never retried: a refusal, an
// HTML page or any answer that is not what was asked for stops the capture.
//
//   node --import tsx scripts/fetch-explorer-fixtures.ts
//     Keyed (BLOCKSCOUT_API_KEY from the shell or .dev.vars, read through
//     scripts/local-vars.ts, sent only in the Authorization header, never
//     printed). Three GET requests to api.blockscout.com:
//       - the Arbitrum Etherscan-style `txlist` of the Abraxas wallet, the
//         shape the reader uses for Arbitrum (the keyed REST answers 500 for
//         `sort=block_number` there), eight rows;
//       - the same request for an address that has no transactions, to see
//         the answer that means "nothing came in";
//       - the Ethereum transaction list of the Arbitrum funder, which is where
//         its label lives: Blockscout puts metadata tags on the parties of
//         transactions, and the address-info endpoint answers `metadata: null`
//         for the same address (and the Arbitrum REST answers 500).
//   node --import tsx scripts/fetch-explorer-fixtures.ts --keyless-ethereum
//     The older capture: the keyless eth.blockscout.com answer for the Abraxas
//     wallet and its two funders (no key; a 403 "Just a moment..." page stops
//     it). Not part of the default run: it would rewrite the committed files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localVar } from './local-vars';
import {
  trimAnswer,
  trimLabelPage,
  trimmedLabelNote,
  trimmedNote,
  trimmedTxlistNote,
  trimTxlist,
} from './explorer-fixture-trim';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const ARBITRUM_FUNDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
/** An address nobody is known to have used, for the answer that means "nothing came in". */
const UNUSED = '0x5b1c8e47d2a9f06b3e7c1d48a05f9e2b6c3d7a14';
const KEYED_HOST = 'https://api.blockscout.com';
const KEYLESS_HOST = 'https://eth.blockscout.com';
const KEYLESS_WALLETS = [ABRAXAS, ARBITRUM_FUNDER, '0xed0c6079229e2d407672a117c22b62064f4a4312'];

const dir = join(import.meta.dirname, '..', 'test', 'fixtures', 'explorer');
mkdirSync(dir, { recursive: true });

const key = localVar('BLOCKSCOUT_API_KEY');
const redact = (text: string): string => (key ? text.split(key).join('[key]') : text);

function stop(label: string, detail: string): never {
  console.error(`${label}: ${redact(detail)}`);
  console.error('stopping: not retrying a refused or unexpected answer');
  process.exit(1);
}

/** One GET; the answer as parsed JSON, or the capture stops. */
async function get(url: string, label: string, authorization: string | null): Promise<{ status: number; body: unknown; headers: Headers }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authorization !== null) headers.Authorization = authorization;
  const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: handled below
  }
  if (!res.ok || body === null || typeof body !== 'object') {
    stop(label, `${res.status} ${res.headers.get('content-type') ?? ''} - ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  return { status: res.status, body, headers: res.headers };
}

function write(name: string, fixture: Record<string, unknown>): void {
  const text = JSON.stringify(fixture, null, 2) + '\n';
  writeFileSync(join(dir, name), text);
  console.log(`${name}: ${text.length} bytes`);
}

if (process.argv.includes('--keyless-ethereum')) {
  for (const wallet of KEYLESS_WALLETS) {
    const url = `${KEYLESS_HOST}/api/v2/addresses/${wallet}/transactions?filter=to&sort=block_number&order=asc`;
    const { status, body } = await get(url, wallet, null);
    const answer = body as { items?: unknown };
    if (!Array.isArray(answer.items)) stop(wallet, `${status}: no items list`);
    // Trimmed on the way to disk: only what the reader uses is kept, not the raw page.
    const capturedAt = new Date().toISOString();
    write(`ethereum-${wallet}.json`, { note: trimmedNote(capturedAt), capturedAt, chain: 'ethereum', url, answer: trimAnswer(answer) });
  }
} else {
  console.log(`key configured: ${key ? 'yes' : 'no'}`);
  if (!key) {
    console.error('stopping: the keyed capture needs BLOCKSCOUT_API_KEY in the shell or .dev.vars');
    process.exit(1);
  }
  const authorization = `Bearer ${key}`;
  const txlistUrl = (address: string): string =>
    `${KEYED_HOST}/v2/api?chain_id=42161&module=account&action=txlist&address=${address}&sort=asc&page=1&offset=8`;

  // 1. Arbitrum, the Abraxas wallet.
  {
    const url = txlistUrl(ABRAXAS);
    const { status, body, headers } = await get(url, 'arbitrum txlist', authorization);
    const answer = body as { status?: unknown; message?: unknown; result?: unknown };
    if (answer.status !== '1' || answer.message !== 'OK' || !Array.isArray(answer.result)) {
      stop('arbitrum txlist', `${status}: status ${JSON.stringify(answer.status)} message ${JSON.stringify(answer.message)}`);
    }
    const capturedAt = new Date().toISOString();
    write(`arbitrum-txlist-${ABRAXAS}.json`, {
      note: trimmedTxlistNote(capturedAt),
      capturedAt,
      chain: 'arbitrum',
      url,
      answer: trimTxlist(answer),
    });
    console.log(`  ${answer.result.length} rows; credits remaining ${headers.get('x-credits-remaining') ?? '?'}`);
  }

  // 2. Arbitrum, an address with no transactions: what "nothing came in" looks like.
  {
    const url = txlistUrl(UNUSED);
    const { status, body } = await get(url, 'arbitrum txlist (unused address)', authorization);
    const answer = body as { status?: unknown; message?: unknown; result?: unknown };
    console.log(
      `  unused address: ${status}, status ${JSON.stringify(answer.status)}, message ${JSON.stringify(answer.message)}, result ${JSON.stringify(answer.result)}`,
    );
    const capturedAt = new Date().toISOString();
    write(`arbitrum-txlist-none-${UNUSED}.json`, {
      note: trimmedTxlistNote(capturedAt),
      capturedAt,
      chain: 'arbitrum',
      url,
      answer: trimTxlist(answer),
    });
  }

  // 3. Ethereum transaction list of the Arbitrum funder: where its label lives.
  {
    const url = `${KEYED_HOST}/1/api/v2/addresses/${ARBITRUM_FUNDER}/transactions?filter=to&sort=block_number&order=asc`;
    const { body } = await get(url, 'ethereum transaction list of the sender', authorization);
    const page = trimLabelPage(body);
    const capturedAt = new Date().toISOString();
    write(`ethereum-label-${ARBITRUM_FUNDER}.json`, {
      note: trimmedLabelNote(capturedAt),
      capturedAt,
      chain: 'ethereum',
      url,
      answer: page,
    });
    const tags = page.items[0]?.to.metadata?.tags.length ?? 0;
    console.log(`  ${page.items.length} items kept; tags on the recipient party of the first: ${tags}`);
  }
}
