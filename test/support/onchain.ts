// Test-only stand-in for the public JSON-RPC nodes: decodes the Multicall3
// `aggregate3` calldata it is sent and answers every call from whole-unit
// amounts given by the test. The registry tokens and the watchlist's look-alike
// staking tokens are both answered (a balance of 0 unless the test gives one);
// any other token is answered as a failure.
import { MULTICALL3, SELECTORS } from '../../src/sources/evm';
import { NATIVE_PLACEHOLDER, registryTokens, watchlistTokens } from '../../src/engine/assets';
import { HOLDINGS_CHAINS, RPC_URLS, type HoldingsChain } from '../../src/sources/onchain';
import type { NansenBalance } from './nansenFixtures';

const WORD = 64; // hex characters per 32-byte word

export interface DecodedCall {
  target: string;
  callData: string;
}

/** Reads the calls out of `aggregate3` calldata. */
export function parseAggregate3Calldata(calldata: string): DecodedCall[] {
  const body = calldata.slice(2 + 8);
  const word = (at: number): number => Number(BigInt('0x' + body.slice(at * 2, at * 2 + WORD)));
  const arrayAt = word(0);
  const count = word(arrayAt);
  const area = arrayAt + 32;
  const calls: DecodedCall[] = [];
  for (let i = 0; i < count; i++) {
    const element = area + word(area + i * 32);
    const target = '0x' + body.slice(element * 2 + 24, element * 2 + WORD);
    const dataAt = element + word(element + 64);
    const length = word(dataAt);
    calls.push({ target, callData: '0x' + body.slice((dataAt + 32) * 2, (dataAt + 32 + length) * 2) });
  }
  return calls;
}

const pad = (n: bigint | number): string => BigInt(n).toString(16).padStart(WORD, '0');

/** Encodes `(bool success, bytes returnData)[]`, the way Multicall3 answers. */
export function aggregate3Answer(results: Array<{ success: boolean; returnData: string }>): string {
  const elements = results.map(({ success, returnData }) => {
    const data = returnData.slice(2);
    const padded = data.padEnd(Math.ceil(data.length / WORD) * WORD, '0');
    return pad(success ? 1 : 0) + pad(0x40) + pad(data.length / 2) + padded;
  });
  let offset = results.length * 32;
  const head = elements.map((element) => {
    const at = pad(offset);
    offset += element.length / 2;
    return at;
  });
  return '0x' + pad(0x20) + pad(results.length) + head.join('') + elements.join('');
}

const rpcResult = (result: string): Response => Response.json({ jsonrpc: '2.0', id: 1, result });

const DEFAULT_RATES = { wstETH: 1.2488, rETH: 1.1754, cbETH: 1.1437, weETH: 1.1078 };
const RATE_TARGETS: Record<string, keyof typeof DEFAULT_RATES> = {
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'wstETH',
  '0xae78736cd615f374d3085123a210448e74fc6393': 'rETH',
  '0xbe9895146f7af43049ca1c1ae358b0541ea49704': 'cbETH',
  '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee': 'weETH',
};

const units = (amount: number, decimals: number): bigint => BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals - 6);
const uint = (value: bigint): string => '0x' + value.toString(16).padStart(WORD, '0');

/** The wallet a holdings request is about: the address its first sub-call,
 * the native balance, asks for. */
export function walletOf(body: unknown): string {
  const params = (body as { params: [{ to: string; data: string }, string] }).params;
  return '0x' + parseAggregate3Calldata(params[0].data)[0].callData.slice(-40);
}

/** `wallets`: wallet address -> chain -> token address (or `native`) -> whole
 * units, for a registry token or a watchlist token alike. `failTokens` takes a
 * token address, `native`, or `<symbol>:rate` for a rate sub-call. */
export function onchainAnswers(
  wallets: Record<string, Partial<Record<HoldingsChain, Record<string, number>>>>,
  opts: {
    rates?: Partial<Record<'wstETH' | 'rETH' | 'cbETH' | 'weETH', number>>;
    failChains?: HoldingsChain[];
    /** Chains whose node answers an error for one wallet only, by wallet. */
    failWalletChains?: Record<string, HoldingsChain[]>;
    failTokens?: string[];
    /** Same keys as failTokens, answered `success: true` with fewer than 32 bytes. */
    shortTokens?: string[];
  } = {},
): (url: string, body: unknown) => Response | null {
  const rates = { ...DEFAULT_RATES, ...opts.rates };
  const failTokens = new Set((opts.failTokens ?? []).map((t) => t.toLowerCase()));
  const shortTokens = new Set((opts.shortTokens ?? []).map((t) => t.toLowerCase()));
  const byWallet = new Map(Object.entries(wallets).map(([wallet, chains]) => [wallet.toLowerCase(), chains]));
  const failWalletChains = new Map(
    Object.entries(opts.failWalletChains ?? {}).map(([wallet, chains]) => [wallet.toLowerCase(), chains]),
  );
  return (url, body) => {
    const chain = HOLDINGS_CHAINS.find((c) => RPC_URLS[c] === url);
    if (chain === undefined) return null;
    if (opts.failChains?.includes(chain) || failWalletChains.get(walletOf(body))?.includes(chain)) {
      return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'node unavailable' } });
    }
    const params = (body as { params: [{ to: string; data: string }, string] }).params;
    const calls = parseAggregate3Calldata(params[0].data);
    const decimalsOf = new Map(
      [...registryTokens(chain), ...watchlistTokens(chain)].map((t) => [t.tokenAddress, t.decimals]),
    );
    const results = calls.map(({ target, callData }) => {
      const selector = callData.slice(0, 10);
      const fail = { success: false, returnData: '0x' };
      if (selector === SELECTORS.getEthBalance || selector === SELECTORS.balanceOf) {
        const wallet = '0x' + callData.slice(-40);
        const held = byWallet.get(wallet)?.[chain] ?? {};
        const key = target.toLowerCase() === MULTICALL3.toLowerCase() ? 'native' : target.toLowerCase();
        if (failTokens.has(key)) return fail;
        if (shortTokens.has(key)) return { success: true, returnData: '0x01' };
        const decimals = key === 'native' ? 18 : decimalsOf.get(key);
        if (decimals === undefined) return fail;
        return { success: true, returnData: uint(units(held[key] ?? 0, decimals)) };
      }
      const rateOf = RATE_TARGETS[target.toLowerCase()];
      if (rateOf === undefined || failTokens.has(`${rateOf}:rate`.toLowerCase())) return fail;
      if (shortTokens.has(`${rateOf}:rate`.toLowerCase())) return { success: true, returnData: '0x01' };
      return { success: true, returnData: uint(units(rates[rateOf], 18)) };
    });
    return rpcResult(aggregate3Answer(results));
  };
}

/** What a Nansen balances answer says a wallet holds on the three chains, in
 * the shape `onchainAnswers` takes: registry contracts and the native coin only.
 * The watchlist's look-alike tokens are left out on purpose, so the captured
 * fixtures keep reading what they read before the watchlist existed. */
export function holdingsFromNansen(rows: NansenBalance[]): Partial<Record<HoldingsChain, Record<string, number>>> {
  const out: Partial<Record<HoldingsChain, Record<string, number>>> = {};
  for (const row of rows) {
    const chain = HOLDINGS_CHAINS.find((c) => c === row.chain.toLowerCase());
    if (chain === undefined) continue;
    const address = row.token_address.toLowerCase();
    const native = address === NATIVE_PLACEHOLDER;
    if (!native && !registryTokens(chain).some((t) => t.tokenAddress === address)) continue;
    (out[chain] ??= {})[native ? 'native' : address] = row.token_amount;
  }
  return out;
}
