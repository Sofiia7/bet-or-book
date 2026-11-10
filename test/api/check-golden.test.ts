// The whole of what a check returns, pinned for a dozen paths through it,
// on recorded real Hyperliquid, explorer and node answers and a fixed clock.
//
// Positions come from Hyperliquid's own dexes. Where a path was recorded with
// Nansen's positions for Abraxas, or with positions made up for the case, the
// reading is handed those same positions (test/support/positions.ts), so the
// path still pins what it pinned. Where no positions are handed in, the check
// reads every dex through the routed answers below, as it does live.
//
// Written before check.ts was split into observation, rules and
// presentation, so the split could be held to exactly what the one long
// function produced: every field, every sentence, every note, in every
// path - the main one, a failed source, no explorer key, a chosen
// position, an expired deadline, and the rest. A change here is a change
// in what a reader sees, and has to be one somebody meant.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress, type CheckOptions } from '../../src/api/check';
import type { NansenPerpPositions, NansenBalance } from '../support/nansenFixtures';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import { allDexFrom } from '../support/positions';
import { holdingsFromNansen, onchainAnswers } from '../support/onchain';
import { EXPLORER_KEY, abraxasPages, explorerAnswers, type ExplorerPages } from '../support/explorer';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxXyz from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxPositions from '../fixtures/nansen/perp-positions-abraxas.json';
import abxPortfolio from '../fixtures/hyperliquid/portfolio-abraxas.json';
import abxBalances from '../fixtures/nansen/current-balance-abraxas-all.json';
import funderArbBalances from '../fixtures/nansen/current-balance-abraxas-funder-all.json';
import funderEthBalances from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const FUNDER_ARB = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';
const NOW = Date.parse('2026-09-18T15:00:00.000Z');
const clock = () => NOW;

/** What a named dex with nothing on it answers. */
const EMPTY_DEX = {
  assetPositions: [],
  marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
  withdrawable: '0.0',
  time: abxClearinghouse.time,
};

const HL: Record<string, unknown> = {
  perpDexs,
  frontendOpenOrders: abxOrders,
  spotClearinghouseState: abxSpot,
  spotMetaAndAssetCtxs: spotMeta,
  metaAndAssetCtxs: perpMeta,
  userFillsByTime: abxFills,
  portfolio: abxPortfolio.portfolio,
};

/** `failDex` names one named dex that will not answer for positions. The
 * public nodes answer what the Nansen balance fixtures say each wallet holds
 * of the registry tokens; `holdings` replaces the account's own. */
function route(
  opts: {
    hip3Orders?: 'fail' | unknown[];
    registry?: 'fail';
    failDex?: string;
    holdings?: NansenBalance[];
    /** The explorer's pages. Abraxas's captures by default, the label lookup
     * included: on the Ethereum chain Blockscout tags the Arbitrum funder
     * 0xb38e...891d as a Binance hot wallet (the keyed capture of 2026-11-10),
     * so the search skips it as an exchange and follows only 0xed0c...4312. */
    explorer?: ExplorerPages;
  } = {},
) {
  const explorer = explorerAnswers(opts.explorer ?? abraxasPages({ labelled: true }));
  const onchain = onchainAnswers({
    [ABRAXAS]: holdingsFromNansen(opts.holdings ?? (abxBalances.data as NansenBalance[])),
    [FUNDER_ARB]: holdingsFromNansen(funderArbBalances.data as NansenBalance[]),
    [FUNDER_ETH]: holdingsFromNansen(funderEthBalances.data as NansenBalance[]),
  });
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const node = onchain(u, body);
    if (node) return node;
    const funding = explorer(u);
    if (funding) return funding;
    if (u.includes('api.hyperliquid.xyz')) {
      if (body.type === 'frontendOpenOrders' && body.dex) {
        if (opts.hip3Orders === 'fail') return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(opts.hip3Orders ?? []), { status: 200 });
      }
      if (body.type === 'perpDexs' && opts.registry === 'fail') return new Response('{}', { status: 500 });
      if (body.type === 'clearinghouseState') {
        if (opts.failDex !== undefined && body.dex === opts.failDex) return new Response('{}', { status: 500 });
        const state = body.dex === undefined ? abxClearinghouse : body.dex === 'xyz' ? abxXyz : EMPTY_DEX;
        return new Response(JSON.stringify(state), { status: 200 });
      }
      if (!(body.type in HL)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(HL[body.type]), { status: 200 });
    }
    throw new Error(`unrouted request ${u}`);
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

/** Both funding-link chains, read with a key. */
const KEYED: Partial<CheckOptions> = { explorer: { apiKey: EXPLORER_KEY } };
/** No funding page names anyone: the funder search runs and finds no one. */
const NOBODY: ExplorerPages = {};

/** The reading every dex would give for an account holding `list`. */
const holding = (list: NansenPerpPositions) => async () =>
  allDexFrom(list, abxClearinghouse as HlClearinghouseState);

/** Abraxas's positions as Nansen reported them on 18 September. */
const abraxasPositions = holding(abxPositions.data as unknown as NansenPerpPositions);

const run = (options: Partial<CheckOptions>) => checkAddress(ABRAXAS, { now: clock, ...options });

afterEach(() => vi.restoreAllMocks());

describe('a check, whole, on recorded real answers', () => {
  it('abraxas: the full path, the Arbitrum funder is tagged as an exchange and skipped', async () => {
    route();
    expect(await run({ ...KEYED, readPositions: abraxasPositions })).toMatchSnapshot();
  });

  it('abraxas: the full path when the label lookup says nothing, so both funders are followed', async () => {
    // The lookup that finds no label (a refusal, a timeout, an address Blockscout
    // does not tag) leaves the Arbitrum funder unverified, and the search follows
    // it: the fail-safe path, and what the full path read before the label lookup.
    route({ explorer: abraxasPages() });
    expect(await run({ ...KEYED, readPositions: abraxasPositions })).toMatchSnapshot();
  });

  it('abraxas: no explorer key, so the Arbitrum funding links are not read', async () => {
    route();
    expect(await run({})).toMatchSnapshot();
  });

  it('abraxas: one named dex does not answer for its positions', async () => {
    // Every other dex answers, xyz with Abraxas's own positions there. Read a
    // minute after the capture, so the gap, not the age, is what the card
    // turns on.
    route({ failDex: 'flx' });
    expect(
      await run({ ...KEYED, now: () => abxClearinghouse.time + 60_000 }),
    ).toMatchSnapshot();
  });

  it('abraxas: asked about its second-largest position', async () => {
    route();
    const full = await run({ ...KEYED, readPositions: abraxasPositions });
    const second = full.positions.candidates[1];
    route();
    expect(
      await run({ ...KEYED, readPositions: abraxasPositions, focus: { coin: second.coin, side: second.side } }),
    ).toMatchSnapshot();
  });

  it('abraxas: asked about a position that is not open', async () => {
    route();
    expect(
      await run({ ...KEYED, readPositions: abraxasPositions, focus: { coin: 'DOGE', side: 'long' } }),
    ).toMatchSnapshot();
  });

  it('abraxas: the deadline already passed, so no optional read starts', async () => {
    route();
    expect(await run({ ...KEYED, deadline: NOW - 1 })).toMatchSnapshot();
  });

  it('a short covered by its own WETH', async () => {
    route({ holdings: [weth(95_000_000)], explorer: NOBODY });
    expect(
      await run({ ...KEYED, readPositions: holding(positions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }])) }),
    ).toMatchSnapshot();
  });

  it('a short 60% covered', async () => {
    route({ holdings: [weth(60_000_000)], explorer: NOBODY });
    expect(
      await run({ ...KEYED, readPositions: holding(positions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }])) }),
    ).toMatchSnapshot();
  });

  it('a lone long, with its funding history', async () => {
    route();
    expect(
      await run({ ...KEYED, readPositions: holding(positions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])) }),
    ).toMatchSnapshot();
  });

  it('thirty offsetting positions in thirty assets', async () => {
    route({ explorer: NOBODY });
    const thirty = positions(
      Array.from({ length: 30 }, (_, i) => ({ coin: `C${i}`, size: i % 2 === 0 ? 10 : -10, valueUsd: 1_000_000 })),
    );
    expect(await run({ ...KEYED, readPositions: holding(thirty) })).toMatchSnapshot();
  });

  it('a HIP-3 long whose dex will not answer for its orders', async () => {
    // The registry of dexes does not answer either, as when this path was
    // first recorded: the market's deployer and oracle stay unestablished.
    route({ hip3Orders: 'fail', registry: 'fail', explorer: NOBODY });
    expect(
      await run({ ...KEYED, readPositions: holding(positions([{ coin: 'xyz:SP500', size: 100, valueUsd: 20_000_000 }])) }),
    ).toMatchSnapshot();
  });
});
