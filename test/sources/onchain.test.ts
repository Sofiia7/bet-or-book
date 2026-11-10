import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeToken, registryTokens, watchlistTokens } from '../../src/engine/assets';
import { MULTICALL3, decodeAggregate3, type Call3 } from '../../src/sources/evm';
import {
  CHAIN_NAMES,
  HOLDINGS_CHAINS,
  RPC_URLS,
  holdingsCalls,
  readOnchainHoldings,
  underlyingPricesFrom,
  type HoldingsChain,
} from '../../src/sources/onchain';
import { attachRequestBudget, createRequestBudget } from '../../src/requestBudget';
import { aggregate3Answer, holdingsFromNansen, onchainAnswers } from '../support/onchain';

const WALLET = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
const ARB_WSTETH = '0x5979d7b546e38e414f7e9822514be443a4800529';
const WHYPE = '0x5555555555555555555555555555555555555555';
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const RSETH = '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7';
const EZETH = '0xbf5495efe5db9ce00f80364c8b423567e58d2110';
const METH = '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa';
const ETHX = '0xa35b1b31ce002fbf2058d22f30f95d405200a15b';
const OSETH = '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38';
const ARB_RSETH = '0x4186bfc76e2e237523cbc30fd220fe055156b41f';
const ARB_EZETH = '0x2416092f143378750bb29b79ed961ab195cceea5';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function stubFetch(answer: (url: string, body: unknown) => Response | null): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const res = answer(url, JSON.parse(String(init?.body)));
    if (res === null) throw new Error(`unexpected request to ${url}`);
    return res;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const PRICES = { ETH: 2500, BTC: 100000, HYPE: 40 };
const BASIC = { [WALLET]: { arbitrum: { native: 2 }, ethereum: { [WSTETH]: 10 }, hyperevm: { native: 1000 } } };

describe('readOnchainHoldings', () => {
  it('prices ETH, wstETH and HYPE with the marks and the wstETH rate', async () => {
    const fetchFn = stubFetch(onchainAnswers(BASIC));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(out.read).toEqual(['ethereum', 'arbitrum', 'hyperevm']);
    expect(out.failed).toEqual([]);
    expect(out.unreadTokens).toBe(0);
    const byCoin = Object.fromEntries(out.holdings.map((h) => [h.coin, h]));
    expect(out.holdings).toHaveLength(3);
    expect(byCoin.ETH).toMatchObject({ chain: 'arbitrum', tokenAddress: NATIVE, source: 'onchain', priced: true, amount: 2 });
    expect(byCoin.ETH.valueUsd).toBeCloseTo(5000, 6);
    expect(byCoin.wstETH).toMatchObject({ chain: 'ethereum', tokenAddress: WSTETH, priced: true, amount: 10 });
    expect(byCoin.wstETH.valueUsd).toBeCloseTo(31220, 6);
    expect(byCoin.HYPE).toMatchObject({ chain: 'hyperevm', priced: true, amount: 1000 });
    expect(byCoin.HYPE.valueUsd).toBeCloseTo(40000, 6);
  });

  it('prices Arbitrum wstETH with the Ethereum rate', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { arbitrum: { [ARB_WSTETH]: 4 } } }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.holdings).toHaveLength(1);
    expect(out.holdings[0]).toMatchObject({ coin: 'wstETH', chain: 'arbitrum', priced: true });
    expect(out.holdings[0].valueUsd).toBeCloseTo(4 * 1.2488 * 2500, 6);
  });

  it('keeps Arbitrum wstETH unpriced when Ethereum failed', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { arbitrum: { [ARB_WSTETH]: 4 } } }, { failChains: ['ethereum'] }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.failed).toEqual([{ chain: 'ethereum', reason: 'error' }]);
    expect(out.read).toEqual(['arbitrum', 'hyperevm']);
    expect(out.holdings).toEqual([
      expect.objectContaining({ coin: 'wstETH', chain: 'arbitrum', priced: false, valueUsd: 0, amount: 4 }),
    ]);
  });

  it('keeps a token unpriced, and not unread, when only its rate sub-call failed', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [WSTETH]: 10 } } }, { failTokens: ['wstETH:rate'] }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(0);
    expect(out.holdings).toEqual([expect.objectContaining({ coin: 'wstETH', priced: false, valueUsd: 0, amount: 10 })]);
  });

  it('leaves every ETH-family holding unpriced, with its amount, when there is no ETH mark', async () => {
    stubFetch(onchainAnswers(BASIC));
    const out = await readOnchainHoldings(WALLET, { HYPE: 40 });
    const eth = out.holdings.filter((h) => h.coin !== 'HYPE');
    expect(eth.map((h) => [h.coin, h.priced, h.valueUsd, h.amount])).toEqual([
      ['wstETH', false, 0, 10],
      ['ETH', false, 0, 2],
    ]);
    expect(out.holdings.find((h) => h.coin === 'HYPE')?.priced).toBe(true);
  });

  it('leaves out a token whose sub-call failed and counts it, the chain staying read', async () => {
    stubFetch(onchainAnswers(BASIC, { failTokens: [WSTETH] }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(1);
    expect(out.read).toContain('ethereum');
    expect(out.holdings.map((h) => h.coin).sort()).toEqual(['ETH', 'HYPE']);
  });

  it('treats a balance sub-call answering fewer than 32 bytes as unread', async () => {
    stubFetch(onchainAnswers(BASIC, { shortTokens: [WSTETH] }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(1);
    expect(out.read).toContain('ethereum');
    expect(out.holdings.map((h) => h.coin).sort()).toEqual(['ETH', 'HYPE']);
  });

  it('keeps a token unpriced, and not unread, when its rate sub-call answers fewer than 32 bytes', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [WSTETH]: 10 } } }, { shortTokens: ['wstETH:rate'] }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(0);
    expect(out.holdings).toEqual([expect.objectContaining({ coin: 'wstETH', priced: false, valueUsd: 0, amount: 10 })]);
  });

  it('prices an 8-decimal WBTC balance with the BTC mark', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [WBTC]: 1.5 } } }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.holdings).toEqual([expect.objectContaining({ coin: 'WBTC', priced: true, amount: 1.5, valueUsd: 150000 })]);
  });

  it('leaves WBTC and cbBTC unpriced, with exact amounts, when there is no BTC mark', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [WBTC]: 1.5, [CBBTC]: 0.25 } } }));
    const out = await readOnchainHoldings(WALLET, { ETH: 2500, HYPE: 40 });
    expect(out.holdings.map((h) => [h.coin, h.priced, h.valueUsd, h.amount])).toEqual([
      ['WBTC', false, 0, 1.5],
      ['cbBTC', false, 0, 0.25],
    ]);
  });

  it('leaves native HYPE and WHYPE unpriced, with their amounts, when there is no HYPE mark', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { hyperevm: { native: 1000, [WHYPE]: 5 } } }));
    const out = await readOnchainHoldings(WALLET, { ETH: 2500, BTC: 100000 });
    expect(out.holdings.map((h) => [h.coin, h.priced, h.valueUsd, h.amount])).toEqual([
      ['HYPE', false, 0, 1000],
      ['WHYPE', false, 0, 5],
    ]);
  });

  it('converts a native balance of millions of tokens without overflow', async () => {
    const wei = 3102301130109341114501880n;
    const calls = holdingsCalls('hyperevm', WALLET);
    const results = calls.map((_, i) => ({
      success: true,
      returnData: '0x' + (i === 0 ? wei : 0n).toString(16).padStart(64, '0'),
    }));
    stubFetch((url) =>
      url === RPC_URLS.hyperevm
        ? Response.json({ jsonrpc: '2.0', id: 1, result: aggregate3Answer(results) })
        : Response.json({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } }),
    );
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.holdings).toHaveLength(1);
    expect(out.holdings[0].amount).toBeCloseTo(3102301.130109, 6);
    expect(out.holdings[0].valueUsd).toBeCloseTo(3102301.130109 * 40, 0);
  });

  it('reports a chain the request budget refused as a limit, not an error', async () => {
    stubFetch(onchainAnswers(BASIC));
    const signal = new AbortController().signal;
    attachRequestBudget(signal, createRequestBudget(2));
    const out = await readOnchainHoldings(WALLET, PRICES, signal);
    expect(out.failed).toEqual([{ chain: 'hyperevm', reason: 'limit' }]);
    expect(out.read).toEqual(['ethereum', 'arbitrum']);
  });

  it('produces no holding for zero balances and sends one fetch per chain', async () => {
    const fetchFn = stubFetch(onchainAnswers({ [WALLET]: {} }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.holdings).toEqual([]);
    expect(out.read).toEqual(['ethereum', 'arbitrum', 'hyperevm']);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe('look-alike staking tokens on the same call', () => {
  const targets = (chain: HoldingsChain) => holdingsCalls(chain, WALLET).map((c) => c.target);

  it('asks for native, registry tokens, watchlist tokens, then the four rates, in that order', () => {
    const ethereum = holdingsCalls('ethereum', WALLET);
    expect(ethereum).toHaveLength(1 + 9 + 5 + 4);
    expect(targets('ethereum').slice(0, 1)).toEqual([MULTICALL3]);
    expect(targets('ethereum').slice(1, 10)).toEqual(registryTokens('ethereum').map((t) => t.tokenAddress));
    expect(targets('ethereum').slice(10, 15)).toEqual([RSETH, EZETH, METH, ETHX, OSETH]);
    expect(targets('ethereum').slice(15)).toEqual([
      WSTETH,
      '0xae78736cd615f374d3085123a210448e74fc6393',
      '0xbe9895146f7af43049ca1c1ae358b0541ea49704',
      '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
    ]);
    // Each is a balanceOf(wallet), the same call the registry tokens get.
    for (const call of ethereum.slice(10, 15)) expect(call.callData).toBe(holdingsCalls('ethereum', WALLET)[1].callData);
    expect(targets('arbitrum').slice(-2)).toEqual([ARB_RSETH, ARB_EZETH]);
    expect(holdingsCalls('arbitrum', WALLET)).toHaveLength(1 + 3 + 2);
    expect(holdingsCalls('hyperevm', WALLET)).toHaveLength(1 + 1);
    expect(watchlistTokens('hyperevm')).toEqual([]);
  });

  it('prices each at the ETH mark one for one, with the rates still read from their own calls', async () => {
    stubFetch(
      onchainAnswers({
        [WALLET]: {
          ethereum: { [RSETH]: 3, [EZETH]: 2, [METH]: 1.5, [ETHX]: 4, [OSETH]: 0.5, [WSTETH]: 10 },
          arbitrum: { [ARB_RSETH]: 7, [ARB_EZETH]: 1 },
        },
      }),
    );
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(0);
    const watch = out.holdings.filter((h) => h.coin !== 'wstETH');
    expect(watch.map((h) => [h.chain, h.coin, h.tokenAddress, h.source, h.priced, h.amount, h.valueUsd])).toEqual([
      ['ethereum', 'rsETH', RSETH, 'onchain', true, 3, 7500],
      ['ethereum', 'ezETH', EZETH, 'onchain', true, 2, 5000],
      ['ethereum', 'mETH', METH, 'onchain', true, 1.5, 3750],
      ['ethereum', 'ETHx', ETHX, 'onchain', true, 4, 10000],
      ['ethereum', 'osETH', OSETH, 'onchain', true, 0.5, 1250],
      ['arbitrum', 'rsETH', ARB_RSETH, 'onchain', true, 7, 17500],
      ['arbitrum', 'ezETH', ARB_EZETH, 'onchain', true, 1, 2500],
    ]);
    // The rate results sit after the watchlist's sub-calls and still price wstETH.
    const wsteth = out.holdings.find((h) => h.coin === 'wstETH')!;
    expect(wsteth.priced).toBe(true);
    expect(wsteth.valueUsd).toBeCloseTo(10 * 1.2488 * 2500, 6);
  });

  it('leaves a watchlist holding unpriced, with its amount, when there is no ETH mark', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [RSETH]: 3 }, arbitrum: { [ARB_EZETH]: 1 } } }));
    const out = await readOnchainHoldings(WALLET, { BTC: 100000, HYPE: 40 });
    expect(out.unreadTokens).toBe(0);
    expect(out.holdings.map((h) => [h.coin, h.chain, h.priced, h.valueUsd, h.amount])).toEqual([
      ['rsETH', 'ethereum', false, 0, 3],
      ['ezETH', 'arbitrum', false, 0, 1],
    ]);
  });

  it('counts a watchlist sub-call that failed, or answered fewer than 32 bytes, as an unread token', async () => {
    stubFetch(onchainAnswers({ [WALLET]: { ethereum: { [RSETH]: 3, [EZETH]: 2 } } }, { failTokens: [RSETH] }));
    const failed = await readOnchainHoldings(WALLET, PRICES);
    expect(failed.unreadTokens).toBe(1);
    expect(failed.read).toEqual(['ethereum', 'arbitrum', 'hyperevm']);
    expect(failed.holdings.map((h) => h.coin)).toEqual(['ezETH']);

    stubFetch(onchainAnswers({ [WALLET]: { arbitrum: { [ARB_RSETH]: 3 } } }, { shortTokens: [ARB_RSETH, OSETH] }));
    const short = await readOnchainHoldings(WALLET, PRICES);
    expect(short.unreadTokens).toBe(2);
    expect(short.holdings).toEqual([]);
  });

  it('answers a watchlist token with no balance as nothing held, not as unread', async () => {
    stubFetch(onchainAnswers({ [WALLET]: {} }));
    const out = await readOnchainHoldings(WALLET, PRICES);
    expect(out.unreadTokens).toBe(0);
    expect(out.holdings).toEqual([]);
  });
});

describe('underlyingPricesFrom', () => {
  it('takes the main-dex ETH, BTC and HYPE marks and drops unusable ones', () => {
    const marks = new Map([
      ['ETH', 2500],
      ['BTC', 0],
      ['HYPE', Number.NaN],
      ['xyz:SP500', 5000],
    ]);
    expect(underlyingPricesFrom(marks)).toEqual({ ETH: 2500 });
  });
});

describe('the registry as read from nodes', () => {
  it('lists nine Ethereum tokens, the two BTC wrappers at 8 decimals', () => {
    const tokens = registryTokens('ethereum');
    expect(tokens.map((t) => t.symbol)).toEqual([
      'aEthWETH', 'weETH', 'wstETH', 'WETH', 'stETH', 'rETH', 'cbETH', 'WBTC', 'cbBTC',
    ]);
    expect(tokens.filter((t) => t.decimals === 8).map((t) => t.symbol)).toEqual(['WBTC', 'cbBTC']);
    expect(tokens.find((t) => t.symbol === 'aEthWETH')?.lending).toBe(true);
    expect(tokens.some((t) => t.tokenAddress === NATIVE)).toBe(false);
  });

  it('keeps Solana for the name-match code and reads no native coin there', () => {
    expect(registryTokens('solana')).toEqual([
      { tokenAddress: 'So11111111111111111111111111111111111111112', symbol: 'WSOL', decimals: 9, underlying: 'SOL', lending: false },
    ]);
    expect(nativeToken('solana')).toBeNull();
    expect(nativeToken('ethereum')).toEqual({ symbol: 'ETH', underlying: 'ETH' });
    expect(nativeToken('arbitrum')).toEqual({ symbol: 'ETH', underlying: 'ETH' });
    expect(nativeToken('hyperevm')).toEqual({ symbol: 'HYPE', underlying: 'HYPE' });
    expect(registryTokens('hyperevm').map((t) => t.tokenAddress)).toEqual([WHYPE]);
  });

  it('names the three chains', () => {
    expect(HOLDINGS_CHAINS.map((c) => CHAIN_NAMES[c])).toEqual(['Ethereum', 'Arbitrum', 'HyperEVM']);
  });
});

describe('holdingsFromNansen', () => {
  it('keeps registry contracts and the native coin on the three chains', () => {
    const row = (chain: string, token_address: string, token_amount: number) => ({
      chain, address: WALLET, token_address, token_symbol: '', token_name: '', token_amount, price_usd: 0, value_usd: 0,
    });
    expect(
      holdingsFromNansen([
        row('ethereum', NATIVE, 1),
        row('ethereum', WSTETH, 2),
        row('ethereum', '0x' + 'ab'.repeat(20), 3),
        row('solana', NATIVE, 4),
      ]),
    ).toEqual({ ethereum: { native: 1, [WSTETH]: 2 } });
  });
});

describe('the captured answers and the call lists', () => {
  const dir = join(__dirname, '..', 'fixtures', 'onchain');
  interface Fixture { chain: HoldingsChain; calls: Call3[]; result: string }
  const fixtures = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, data: JSON.parse(readFileSync(join(dir, name), 'utf8')) as Fixture }));

  it.each(fixtures.map((f) => [f.name, f.data] as const))('%s: holdingsCalls rebuilds the captured call list', (_name, data) => {
    const wallet = '0x' + data.calls[0].callData.slice(-40);
    expect(holdingsCalls(data.chain, wallet)).toEqual(data.calls);
    expect(data.calls[0].target).toBe(MULTICALL3);
  });

  it('every captured watchlist balance call succeeded with exactly 32 bytes', () => {
    const watchlist = new Set(
      (['ethereum', 'arbitrum'] as const).flatMap((chain) => watchlistTokens(chain).map((t) => t.tokenAddress)),
    );
    let seen = 0;
    for (const { data } of fixtures) {
      const results = decodeAggregate3(data.result, data.calls.length);
      data.calls.forEach((call, i) => {
        if (!watchlist.has(call.target.toLowerCase())) return;
        seen++;
        expect(results[i].success).toBe(true);
        expect(results[i].returnData).toHaveLength(2 + 64);
      });
    }
    // Five Ethereum and two Arbitrum tokens, for each of the three wallets.
    expect(seen).toBe(3 * (5 + 2));
  });

  it('every captured rate call succeeded with 32 bytes and a rate between 1.0 and 1.5', () => {
    const ethereum = fixtures.filter((f) => f.data.chain === 'ethereum');
    expect(ethereum).toHaveLength(3);
    for (const { data } of ethereum) {
      const rates = decodeAggregate3(data.result, data.calls.length).slice(-4);
      expect(rates).toHaveLength(4);
      // The rate calls are the last four, after every balance call.
      expect(data.calls.slice(-4).map((c) => c.callData.length)).toEqual([10, 10, 10, 10]);
      for (const rate of rates) {
        expect(rate.success).toBe(true);
        expect(rate.returnData).toHaveLength(2 + 64);
        const value = Number(BigInt(rate.returnData) / 10n ** 12n) / 1e6;
        expect(value).toBeGreaterThanOrEqual(1.0);
        expect(value).toBeLessThanOrEqual(1.5);
      }
    }
  });
});
