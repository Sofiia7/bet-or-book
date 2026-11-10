// Captures real Multicall3 answers from the public nodes for the Abraxas
// wallet and its two funders, so tests decode what the nodes really send.
// Read-only: the only requests are `eth_call`s. No key, no budget signal.
//
//   node --import tsx scripts/fetch-onchain-fixtures.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MULTICALL3, decodeAggregate3, encodeAggregate3, ethCall } from '../src/sources/evm';
import { HOLDINGS_CHAINS, RPC_URLS, holdingsCalls } from '../src/sources/onchain';

const WALLETS: Record<string, string> = {
  abraxas: '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36',
  'funder-arb': '0xb38e8c17e38363af6ebdcb3dae12e0243582891d',
  'funder-eth': '0xed0c6079229e2d407672a117c22b62064f4a4312',
};

// The call list is the one the Worker sends: holdingsCalls() in
// src/sources/onchain.ts, built from the asset registry.

const dir = join(import.meta.dirname, '..', 'test', 'fixtures', 'onchain');
mkdirSync(dir, { recursive: true });

for (const [label, wallet] of Object.entries(WALLETS)) {
  for (const chain of HOLDINGS_CHAINS) {
    const url = RPC_URLS[chain];
    const calls = holdingsCalls(chain, wallet);
    const calldata = encodeAggregate3(calls);
    const result = await ethCall(url, MULTICALL3, calldata);
    const entries = decodeAggregate3(result, calls.length).length;
    const file = join(dir, `${label}-${chain}.json`);
    writeFileSync(file, JSON.stringify({ chain, url, capturedAt: new Date().toISOString(), calls, calldata, result }, null, 2) + '\n');
    console.log(`${label}-${chain}.json: ${calls.length} calls, ${entries} entries`);
  }
}
