import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { createNansenClient, type NansenCallMeta } from '../../src/sources/nansen';
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

const HL_ROUTES: Record<string, unknown> = {
  clearinghouseState: abxClearinghouse,
  frontendOpenOrders: abxOrders,
  spotClearinghouseState: abxSpot,
  spotMetaAndAssetCtxs: spotMeta,
  metaAndAssetCtxs: perpMeta,
  userFillsByTime: abxFills,
};

const NANSEN_ROUTES: Record<string, unknown> = {
  [`profiler/perp-positions|${ABRAXAS}|`]: abxPositions,
  [`profiler/perp-pnl-summary|${ABRAXAS}|`]: abxPnl,
  [`profiler/address/current-balance|${ABRAXAS}|all`]: abxBalances,
  [`profiler/address/related-wallets|${ABRAXAS}|arbitrum`]: abxRelArb,
  [`profiler/address/related-wallets|${ABRAXAS}|ethereum`]: abxRelEth,
  [`profiler/address/current-balance|${FUNDER_ARB}|all`]: funderArbBalances,
  [`profiler/address/current-balance|${FUNDER_ETH}|all`]: funderEthBalances,
};

/** Routes every fetch to a captured fixture. Nansen keys listed in
 * `failNansen` answer HTTP 500; anything unrouted throws, so a request the
 * code was not expected to make fails the test loudly. */
function route(failNansen: string[] = []) {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (u.includes('api.hyperliquid.xyz')) {
      if (!(body.type in HL_ROUTES)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(HL_ROUTES[body.type]), { status: 200 });
    }
    const key = `${u.split('/api/v1/')[1]}|${String(body.address).toLowerCase()}|${body.chain ?? ''}`;
    if (failNansen.includes(key)) {
      return new Response('{}', { status: 500, headers: { 'x-nansen-credits-cost': '0' } });
    }
    if (!(key in NANSEN_ROUTES)) throw new Error(`unrouted Nansen ${key}`);
    return new Response(JSON.stringify(NANSEN_ROUTES[key]), { status: 200, headers: { 'x-nansen-credits-cost': '1' } });
  }) as unknown as typeof fetch;
}

describe('checkAddress (offline, real fixtures)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('finds the Abraxas hedge through its funders', async () => {
    route();
    const calls: NansenCallMeta[] = [];
    const result = await checkAddress(ABRAXAS, {
      nansen: createNansenClient('k', (m) => {
        calls.push(m);
      }),
    });
    expect(result.source).toBe('nansen');
    expect(result.positions.nPositions).toBe(17);
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.positions.headlineSide).toBe('short');
    expect(result.hedge.hedgeRatio).toBeLessThan(0.01);
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.strength).toBe('probable');
    expect(result.verdict.reasons).toEqual(['linked_wallet_hedge']);
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    expect(result.linkedHedge?.linkedHedgeRatio).toBeGreaterThan(2);
    expect(result.pnl?.realizedPnlUsd).toBeLessThan(0);
    expect(calls.length).toBe(7);
    expect(result.coverage).toEqual([]);
  });

  it('falls back to Hyperliquid positions and says so when Nansen positions fail', async () => {
    route([`profiler/perp-positions|${ABRAXAS}|`]);
    const result = await checkAddress(ABRAXAS, { nansen: createNansenClient('k') });
    expect(result.source).toBe('hyperliquid');
    expect(result.positions.nPositions).toBe(14);
    expect(result.coverage.some((c) => c.includes('main dex'))).toBe(true);
  });

  it('runs Hyperliquid-only when no Nansen client is given', async () => {
    route();
    const result = await checkAddress(ABRAXAS, { nansen: null });
    expect(result.source).toBe('hyperliquid');
    expect(result.linkedHedge).toBeNull();
    expect(result.pnl).toBeNull();
    expect(result.coverage.some((c) => c.startsWith('Nansen not used'))).toBe(true);
  });
});
