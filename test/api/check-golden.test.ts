// The whole of what a check returns, pinned for a dozen paths through it,
// on recorded real Hyperliquid and Nansen answers and a fixed clock.
//
// Written before check.ts was split into observation, rules and
// presentation, so the split could be held to exactly what the one long
// function produced: every field, every sentence, every note, in every
// path - the main one, a failed source, no Nansen at all, a chosen
// position, an expired deadline, and the rest. A change here is a change
// in what a reader sees, and has to be one somebody meant.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress, type CheckOptions } from '../../src/api/check';
import {
  createNansenClient,
  type NansenClient,
  type NansenPerpPositions,
  type NansenPnlSummary,
  type NansenBalance,
  type NansenRelatedWallet,
} from '../../src/sources/nansen';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxPositions from '../fixtures/nansen/perp-positions-abraxas.json';
import abxPnl from '../fixtures/nansen/perp-pnl-summary-abraxas.json';
import abxBalances from '../fixtures/nansen/current-balance-abraxas-all.json';
import abxRelArb from '../fixtures/nansen/related-wallets-abraxas-arbitrum.json';
import abxRelEth from '../fixtures/nansen/related-wallets-abraxas-ethereum.json';
import funderArbBalances from '../fixtures/nansen/current-balance-abraxas-funder-all.json';
import funderEthBalances from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const FUNDER_ARB = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';
const NOW = Date.parse('2026-09-18T15:00:00.000Z');
const clock = () => NOW;

const HL: Record<string, unknown> = {
  clearinghouseState: abxClearinghouse,
  frontendOpenOrders: abxOrders,
  spotClearinghouseState: abxSpot,
  spotMetaAndAssetCtxs: spotMeta,
  metaAndAssetCtxs: perpMeta,
  userFillsByTime: abxFills,
};

const NANSEN: Record<string, unknown> = {
  [`profiler/perp-positions|${ABRAXAS}|`]: abxPositions,
  [`profiler/perp-pnl-summary|${ABRAXAS}|`]: abxPnl,
  [`profiler/address/current-balance|${ABRAXAS}|all`]: abxBalances,
  [`profiler/address/related-wallets|${ABRAXAS}|arbitrum`]: abxRelArb,
  [`profiler/address/related-wallets|${ABRAXAS}|ethereum`]: abxRelEth,
  [`profiler/address/current-balance|${FUNDER_ARB}|all`]: funderArbBalances,
  [`profiler/address/current-balance|${FUNDER_ETH}|all`]: funderEthBalances,
};

function route(opts: { failNansen?: string[]; hip3Orders?: 'fail' | unknown[] } = {}) {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (u.includes('api.hyperliquid.xyz')) {
      if (body.type === 'frontendOpenOrders' && body.dex) {
        if (opts.hip3Orders === 'fail') return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(opts.hip3Orders ?? []), { status: 200 });
      }
      if (!(body.type in HL)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(HL[body.type]), { status: 200 });
    }
    const key = `${u.split('/api/v1/')[1]}|${String(body.address).toLowerCase()}|${body.chain ?? ''}`;
    if (opts.failNansen?.includes(key)) {
      return new Response('{}', { status: 500, headers: { 'x-nansen-credits-cost': '0' } });
    }
    if (!(key in NANSEN)) throw new Error(`unrouted Nansen ${key}`);
    return new Response(JSON.stringify(NANSEN[key]), { status: 200, headers: { 'x-nansen-credits-cost': '1' } });
  }) as unknown as typeof fetch;
}

function positions(list: Array<{ coin: string; size: number; valueUsd: number }>): NansenPerpPositions {
  return {
    asset_positions: list.map((p) => ({
      position: {
        token_symbol: p.coin,
        size: String(p.size),
        position_value_usd: String(p.valueUsd),
        entry_price_usd: '100',
        liquidation_price_usd: '150',
        leverage_value: 5,
        leverage_type: 'cross',
        margin_used_usd: '0',
        unrealized_pnl_usd: '1000',
        cumulative_funding_since_open_usd: '-250',
        return_on_equity: '0',
      },
      position_type: 'oneWay',
    })),
    margin_summary_account_value_usd: '0',
    withdrawable_usd: '0',
    timestamp: NOW - 60_000,
  };
}

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const weth = (valueUsd: number): NansenBalance => ({
  chain: 'ethereum',
  address: ABRAXAS,
  token_address: WETH,
  token_symbol: 'WETH',
  token_name: 'WETH',
  token_amount: valueUsd / 2500,
  price_usd: 2500,
  value_usd: valueUsd,
});

/** A client answering from memory, so a path can be driven without routing
 * every call through fetch. */
function fake(opts: {
  positions: NansenPerpPositions | Record<string, unknown>;
  balances?: NansenBalance[];
  relatedFromFixtures?: boolean;
}): NansenClient {
  return {
    perpPositions: async () => opts.positions as NansenPerpPositions,
    perpPnlSummary: async () => abxPnl.data as unknown as NansenPnlSummary,
    currentBalance: async () => ({ rows: opts.balances ?? [], complete: true }),
    relatedWallets: async (_address, chain) => ({
      rows: (opts.relatedFromFixtures
        ? ((chain === 'arbitrum' ? abxRelArb : abxRelEth) as { data: NansenRelatedWallet[] }).data
        : []) as NansenRelatedWallet[],
      complete: true,
    }),
  };
}

const run = (options: Partial<CheckOptions> & Pick<CheckOptions, 'nansen'>) =>
  checkAddress(ABRAXAS, { now: clock, ...options });

afterEach(() => vi.restoreAllMocks());

describe('a check, whole, on recorded real answers', () => {
  it('abraxas: the full paid path, own balances and both funders', async () => {
    route();
    expect(await run({ nansen: createNansenClient('k') })).toMatchSnapshot();
  });

  it('abraxas: Nansen positions fail, Hyperliquid main dex instead', async () => {
    route({ failNansen: [`profiler/perp-positions|${ABRAXAS}|`] });
    expect(await run({ nansen: createNansenClient('k') })).toMatchSnapshot();
  });

  it('abraxas: Nansen not used, and why', async () => {
    route();
    expect(await run({ nansen: null, nansenOffReason: "today's Nansen credits are used up" })).toMatchSnapshot();
  });

  it('abraxas: asked about its second-largest position', async () => {
    route();
    const full = await run({ nansen: createNansenClient('k') });
    const second = full.positions.candidates[1];
    route();
    expect(await run({ nansen: createNansenClient('k'), focus: { coin: second.coin, side: second.side } })).toMatchSnapshot();
  });

  it('abraxas: asked about a position that is not open', async () => {
    route();
    expect(await run({ nansen: createNansenClient('k'), focus: { coin: 'DOGE', side: 'long' } })).toMatchSnapshot();
  });

  it('abraxas: the deadline already passed, so no paid stage starts', async () => {
    route();
    expect(await run({ nansen: createNansenClient('k'), deadline: NOW - 1 })).toMatchSnapshot();
  });

  it('abraxas: Nansen answers 200 with the wrong shape', async () => {
    route();
    expect(await run({ nansen: fake({ positions: {} }) })).toMatchSnapshot();
  });

  it('a short covered by its own WETH', async () => {
    route();
    const nansen = fake({
      positions: positions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [weth(95_000_000)],
    });
    expect(await run({ nansen })).toMatchSnapshot();
  });

  it('a short 60% covered', async () => {
    route();
    const nansen = fake({
      positions: positions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]),
      balances: [weth(60_000_000)],
    });
    expect(await run({ nansen })).toMatchSnapshot();
  });

  it('a lone long, with its funding history', async () => {
    route();
    const nansen = fake({
      positions: positions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }]),
      relatedFromFixtures: true,
    });
    expect(await run({ nansen })).toMatchSnapshot();
  });

  it('thirty offsetting positions in thirty assets', async () => {
    route();
    const nansen = fake({
      positions: positions(
        Array.from({ length: 30 }, (_, i) => ({ coin: `C${i}`, size: i % 2 === 0 ? 10 : -10, valueUsd: 1_000_000 })),
      ),
    });
    expect(await run({ nansen })).toMatchSnapshot();
  });

  it('a HIP-3 long whose dex will not answer for its orders', async () => {
    route({ hip3Orders: 'fail' });
    const nansen = fake({ positions: positions([{ coin: 'xyz:SP500', size: 100, valueUsd: 20_000_000 }]) });
    expect(await run({ nansen })).toMatchSnapshot();
  });
});
