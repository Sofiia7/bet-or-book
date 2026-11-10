import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { formatUsd } from '../../src/engine/evidence';
import { CLASSIFIER_VERSION } from '../../src/engine/verdict';
import { nansenContribution } from '../../src/engine/nansenContribution';
import { openQuestion } from '../../src/engine/openQuestion';
import type { NansenPerpPositions, NansenBalance } from '../support/nansenFixtures';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import type { PositionsReader } from '../../src/sources/positions';
import { allDexFrom } from '../support/positions';
import { holdingsFromNansen, onchainAnswers, walletOf } from '../support/onchain';
import { HOLDINGS_CHAINS, RPC_URLS, type HoldingsChain } from '../../src/sources/onchain';
import {
  EXPLORER_KEY,
  abraxasPages,
  arbitrumCutShortPage,
  cutShortPage,
  explorerAnswers,
  explorerDown,
  explorerRequestOf,
  type ExplorerPages,
} from '../support/explorer';
import { REQUEST_LIMIT_REASON, attachRequestBudget, createRequestBudget } from '../../src/requestBudget';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxXyz from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxPortfolio from '../fixtures/hyperliquid/portfolio-abraxas.json';
import abxBalances from '../fixtures/nansen/current-balance-abraxas-all.json';
import funderArbBalances from '../fixtures/nansen/current-balance-abraxas-funder-all.json';
import funderEthBalances from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';

const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';
const FUNDER_ARB = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
const FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';

/** The scope a holdings read from public nodes states, word for word. */
const KNOWN_TOKENS_NOTE =
  'Balances on other chains: only the tokens this tool recognises (ETH, WETH, stETH, wstETH, rETH, cbETH, weETH, ' +
  'Aave WETH deposits, WBTC, cbBTC, HYPE, WHYPE) on Ethereum, Arbitrum and HyperEVM were read; look-alike staking ' +
  'tokens (rsETH, ezETH, mETH, ETHx, osETH) were looked for but are never counted as cover; other tokens and ' +
  'other chains were not';

/** What a named dex with nothing on it answers. */
const EMPTY_DEX = {
  assetPositions: [],
  marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
  withdrawable: '0.0',
  time: abxClearinghouse.time,
};

const HL_ROUTES: Record<string, unknown> = {
  perpDexs,
  frontendOpenOrders: abxOrders,
  spotClearinghouseState: abxSpot,
  spotMetaAndAssetCtxs: spotMeta,
  metaAndAssetCtxs: perpMeta,
  userFillsByTime: abxFills,
  portfolio: abxPortfolio.portfolio,
};

/** Two-sided quotes on the xyz dex, which frontendOpenOrders does not return
 * unless it is asked for that dex by name. */
const HIP3_ORDERS: Record<string, unknown[]> = {
  xyz: [
    { coin: 'xyz:SP500', side: 'B', sz: '10', limitPx: '5000', isTrigger: false, oid: 1, timestamp: 0 },
    { coin: 'xyz:SP500', side: 'A', sz: '10', limitPx: '5100', isTrigger: false, oid: 2, timestamp: 0 },
  ],
};

/** What a check sent: holdings reads to the public nodes, by chain and
 * wallet, funding-link reads to the explorer, and anything else, which is
 * unexpected (Nansen among it: a check asks it nothing). */
interface Sent {
  rpc: Array<{ chain: HoldingsChain; wallet: string }>;
  explorer: Array<{ chain: string; wallet: string }>;
  unrouted: string[];
  /** The type of every request sent to Hyperliquid, in order. */
  hl: string[];
}

/** Routes every fetch to a captured fixture. Anything unrouted throws, so a
 * request the code was not expected to make fails the test loudly.
 *
 * The public nodes answer what the Nansen balance fixtures say each wallet
 * holds of the registry tokens; `holdings` replaces the account's own.
 * `marks: false` answers the main dex's market data with no market at all. */
function route(
  opts: {
    holdings?: NansenBalance[];
    /** Whole units the account also holds, by chain and token address: what
     * the Nansen balance shape cannot carry (the look-alike staking tokens). */
    extra?: Partial<Record<HoldingsChain, Record<string, number>>>;
    /** What both funders hold, in place of the funder fixtures: Nansen-shaped
     * registry rows, plus whole units by chain and token address. */
    funders?: { holdings?: NansenBalance[]; extra?: Partial<Record<HoldingsChain, Record<string, number>>> };
    failChains?: HoldingsChain[];
    /** Chains whose node answers an error for one wallet only, by wallet. */
    failWalletChains?: Record<string, HoldingsChain[]>;
    failTokens?: string[];
    marks?: boolean;
    /** What Hyperliquid answers to `portfolio`; Abraxas's capture by default. */
    portfolio?: () => Response;
    /** The explorer's funding pages; nothing funded anyone by default.
     * `abraxasPages()` (test/support/explorer.ts) names Abraxas's two funders. */
    explorer?: ExplorerPages;
  } = {},
): Sent {
  const sent: Sent = { rpc: [], explorer: [], unrouted: [], hl: [] };
  const explorer = explorerAnswers(opts.explorer ?? {});
  const own = holdingsFromNansen(opts.holdings ?? (abxBalances.data as NansenBalance[]));
  for (const chain of HOLDINGS_CHAINS) {
    if (opts.extra?.[chain]) own[chain] = { ...own[chain], ...opts.extra[chain] };
  }
  const funderHoldings = (fixture: NansenBalance[]) => {
    const held = holdingsFromNansen(opts.funders?.holdings ?? fixture);
    for (const chain of HOLDINGS_CHAINS) {
      if (opts.funders?.extra?.[chain]) held[chain] = { ...held[chain], ...opts.funders.extra[chain] };
    }
    return held;
  };
  const onchain = onchainAnswers(
    {
      [ABRAXAS]: own,
      [FUNDER_ARB]: funderHoldings(funderArbBalances.data as NansenBalance[]),
      [FUNDER_ETH]: funderHoldings(funderEthBalances.data as NansenBalance[]),
    },
    { failChains: opts.failChains, failWalletChains: opts.failWalletChains, failTokens: opts.failTokens },
  );
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const chain = HOLDINGS_CHAINS.find((c) => RPC_URLS[c] === u);
    if (chain !== undefined) {
      sent.rpc.push({ chain, wallet: walletOf(body) });
      return onchain(u, body)!;
    }
    const funding = explorerRequestOf(u);
    if (funding !== null) {
      sent.explorer.push(funding);
      return explorer(u)!;
    }
    if (u.includes('api.hyperliquid.xyz')) {
      sent.hl.push(String(body.type));
      if (body.type === 'portfolio' && opts.portfolio) return opts.portfolio();
      // Orders on a named HIP-3 dex are a separate request with its own answer.
      if (body.type === 'frontendOpenOrders' && body.dex) {
        return new Response(JSON.stringify(HIP3_ORDERS[String(body.dex)] ?? []), { status: 200 });
      }
      // Positions are read from every dex: Abraxas's own captures for the
      // main dex and xyz, nothing on the others.
      if (body.type === 'clearinghouseState') {
        const state = body.dex === undefined ? abxClearinghouse : body.dex === 'xyz' ? abxXyz : EMPTY_DEX;
        return new Response(JSON.stringify(state), { status: 200 });
      }
      if (body.type === 'metaAndAssetCtxs' && opts.marks === false) {
        return new Response(JSON.stringify([{ universe: [] }, []]), { status: 200 });
      }
      if (!(body.type in HL_ROUTES)) throw new Error(`unrouted Hyperliquid ${body.type}`);
      return new Response(JSON.stringify(HL_ROUTES[body.type]), { status: 200 });
    }
    // Nothing else is expected: a request to Nansen, or anywhere else, is
    // recorded and fails loudly.
    sent.unrouted.push(u);
    throw new Error(`unrouted request ${u}`);
  }) as unknown as typeof fetch;
  return sent;
}

/** A keyed explorer: both chains are read. With `route`'s default pages
 * nothing funded anyone, so a funder search reads complete and finds no one. */
const QUIET = { explorer: { apiKey: EXPLORER_KEY } };

/** The positions every dex reports for Abraxas, given in Nansen's shape. */
const holding = (positions: NansenPerpPositions): PositionsReader => async () =>
  allDexFrom(positions, abxClearinghouse as HlClearinghouseState);

function syntheticPositions(list: Array<{ coin: string; size: number; valueUsd: number }>): NansenPerpPositions {
  return {
    asset_positions: list.map((p) => ({
      position: {
        token_symbol: p.coin,
        size: String(p.size),
        position_value_usd: String(p.valueUsd),
        entry_price_usd: '100',
        liquidation_price_usd: null,
        leverage_value: 5,
        leverage_type: 'cross',
        margin_used_usd: '0',
        unrealized_pnl_usd: '0',
        cumulative_funding_since_open_usd: '0',
        return_on_equity: '0',
      },
      position_type: 'oneWay',
    })),
    margin_summary_account_value_usd: '0',
    withdrawable_usd: '0',
    timestamp: 0,
  };
}

it('core exposure mode skips optional PnL and long funding context without changing the verdict', async () => {
  const sent = route();
  const at = abxClearinghouse.time;
  const positions = syntheticPositions([{ coin: 'ETH', size: 10, valueUsd: 1000000 }]); positions.timestamp = at;
  const reading = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(positions), includeContext: false, now: () => at + 60000 });
  // Context off: no portfolio request, and no funding-history read.
  expect(sent.hl).not.toContain('portfolio');
  expect(sent.explorer).toEqual([]);
  const context = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(positions), now: () => at + 60000 });
  // Context on: the PnL is one Hyperliquid request, the funding history two explorer ones.
  expect(sent.hl.filter((t) => t === 'portfolio')).toHaveLength(1);
  expect(sent.explorer).toHaveLength(2);
  expect(sent.unrouted).toEqual([]);
  expect(reading.verdict).toEqual(context.verdict);
  expect(reading.pnl).toBeNull();
  expect(context.pnl).toMatchObject({ basis: 'realized-and-unrealized', windowDays: 30 });
});

describe('the 30-day PnL, read from the Hyperliquid portfolio', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const at = abxClearinghouse.time;
  const lone = () => syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }]);
  /** Last minus first of Abraxas's month, from the capture itself. */
  const abraxasMonth = (() => {
    const month = (abxPortfolio.portfolio as unknown as Array<[string, { pnlHistory: Array<[number, string]> }]>).find(
      ([period]) => period === 'perpMonth',
    )![1].pnlHistory;
    return Number(month[month.length - 1][1]) - Number(month[0][1]);
  })();
  const run = (opts: Parameters<typeof checkAddress>[1]) =>
    checkAddress(ABRAXAS, { readPositions: holding(lone()), now: () => at + 60_000, ...opts });

  it('sends exactly one portfolio request and carries the new tile', async () => {
    const sent = route({ holdings: [] });
    const result = await run(QUIET);
    expect(sent.hl.filter((t) => t === 'portfolio')).toHaveLength(1);
    expect(result.pnl).toEqual({ basis: 'realized-and-unrealized', pnlUsd: abraxasMonth, windowDays: 30 });
    expect(result.evidence).toContainEqual({
      label: 'Perp PnL, 30d (realized and unrealized)',
      value: formatUsd(abraxasMonth),
      source: 'Hyperliquid',
    });
    expect(result.evidence.some((e) => e.label.startsWith('Realized PnL'))).toBe(false);
    expect(result.coverage.some((c) => /PnL/.test(c))).toBe(false);
  });

  it('needs no Nansen at all, and says nothing about it', async () => {
    const sent = route({ holdings: [] });
    const result = await run({});
    expect(sent.hl.filter((t) => t === 'portfolio')).toHaveLength(1);
    expect(sent.unrouted).toEqual([]);
    expect(result.pnl).toMatchObject({ basis: 'realized-and-unrealized', pnlUsd: abraxasMonth });
    expect(result.coverage.filter((c) => /PnL|Nansen/.test(c))).toEqual([]);
  });

  it('sends none when the context was not asked for', async () => {
    const sent = route({ holdings: [] });
    const result = await run({ ...QUIET, includeContext: false });
    expect(sent.hl).not.toContain('portfolio');
    expect(result.pnl).toBeNull();
    expect(result.evidence.some((e) => /PnL/.test(e.label))).toBe(false);
  });

  it('says only that PnL is unavailable when the portfolio read fails, and the answer is unchanged', async () => {
    route({ holdings: [] });
    const good = await run(QUIET);
    route({ holdings: [], portfolio: () => new Response('down', { status: 503 }) });
    const result = await run(QUIET);
    expect(result.pnl).toBeNull();
    expect(result.coverage).toContain('PnL unavailable');
    expect(result.coverage).not.toContain('Realized PnL unavailable');
    // Context, not a failure: no verdict, quality or degradation follows from it.
    expect(result.coverageNotes).toContainEqual({ text: 'PnL unavailable', failure: false });
    expect(result.degraded).toBe(good.degraded);
    expect(result.verdict).toEqual(good.verdict);
    expect(result.source).toBe(good.source);
    // Nansen's own notes are not where this lands.
    expect(result.coverage.some((c) => c.startsWith('Nansen'))).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a month with one point', [['perpMonth', { accountValueHistory: [], pnlHistory: [[1, '0.0']], vlm: '0.0' }]]],
    ['no month at all', [['perpDay', { accountValueHistory: [], pnlHistory: [[1, '0.0'], [2, '1.0']], vlm: '0.0' }]]],
    ['a value that is not a number', [['perpMonth', { accountValueHistory: [], pnlHistory: [[1, '0.0'], [2, 'abc']], vlm: '0.0' }]]],
    ['an object instead of a list', { perpMonth: {} }],
  ])('says PnL came back in an unexpected shape for %s, never a PnL of zero', async (_what, body) => {
    route({ holdings: [], portfolio: () => new Response(JSON.stringify(body), { status: 200 }) });
    const result = await run(QUIET);
    expect(result.pnl).toBeNull();
    expect(result.coverage).toContain('PnL came back in an unexpected shape');
    expect(result.coverageNotes).toContainEqual({ text: 'PnL came back in an unexpected shape', failure: false });
    expect(result.evidence.some((e) => /PnL/.test(e.label))).toBe(false);
    expect(result.verdict.verdict).toBeDefined();
  });
});

/** The short most of these cases are about: $100M of ETH. */
const ethShort = () => syntheticPositions([{ coin: 'ETH', size: -25_000, valueUsd: 100_000_000 }]);

/** Canonical WETH on Ethereum: the holdings model judges a balance by its
 * contract, so a placeholder address is now correctly not counted as ETH. */
const WETH_ETHEREUM = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

/** Hyperliquid's ETH mark in the perp metadata capture: what a node-read ETH
 * balance is priced at. */
const ETH_MARK = (() => {
  const [meta, ctxs] = perpMeta as unknown as [{ universe: Array<{ name: string }> }, Array<{ markPx: string }>];
  return Number(ctxs[meta.universe.findIndex((a) => a.name === 'ETH')].markPx);
})();

/** `valueUsd` of an ETH-family token, held as the amount that is worth at
 * Hyperliquid's ETH mark, so Nansen and the nodes say the same. */
function balanceRow(symbol: string, valueUsd: number, tokenAddress = WETH_ETHEREUM): NansenBalance {
  return {
    chain: 'ethereum',
    address: ABRAXAS,
    token_address: tokenAddress,
    token_symbol: symbol,
    token_name: symbol,
    token_amount: valueUsd / ETH_MARK,
    price_usd: ETH_MARK,
    value_usd: valueUsd,
  };
}

describe('checkAddress (offline, real fixtures)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not turn the wallets that funded Abraxas into its hedge', async () => {
    const sent = route({ explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    // The explorer supplied the funding links; the positions and the 30-day
    // PnL are Hyperliquid's own (the main dex and xyz, and `portfolio`), and
    // the balances the public nodes'.
    expect(result.source).toBe('hyperliquid');
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.positions.nPositions).toBe(abxClearinghouse.assetPositions.length + abxXyz.assetPositions.length);
    expect(result.positions.headlineCoin).toBe('ETH');
    expect(result.positions.headlineSide).toBe('short');
    expect(result.hedge.hedgeRatio).toBeLessThan(0.01);
    // The explorer tags neither funder, so nothing here says these wallets
    // belong to Abraxas rather than to an exchange.
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['linked_exposure_unverified']);
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    expect(result.linkedHedge?.linkedHedgeRatio).toBeGreaterThan(2);
    // Realized and unrealized, from Hyperliquid: Abraxas is up over the month.
    expect(result.pnl).toMatchObject({ basis: 'realized-and-unrealized', windowDays: 30 });
    expect((result.pnl as { pnlUsd: number }).pnlUsd).toBeGreaterThan(0);
    // Funding links on two chains, from the explorer, and nothing from
    // Nansen: three node reads for the account, three per funder. The
    // explorer is asked three times: Ethereum, Arbitrum, and the Ethereum
    // chain once more for the label of the Arbitrum sender.
    expect(sent.explorer).toEqual([
      { chain: 'ethereum', wallet: ABRAXAS },
      { chain: 'arbitrum', wallet: ABRAXAS },
      { chain: 'ethereum', wallet: FUNDER_ARB },
    ]);
    expect(sent.unrouted).toEqual([]);
    expect(sent.rpc).toHaveLength(9);
    // The oldest of the dexes' own timestamps: the main-dex capture, taken on
    // 18 September.
    expect(result.positionsAsOf).toBe(new Date(abxClearinghouse.time).toISOString());
    expect(result.coverage).toEqual([
      KNOWN_TOKENS_NOTE,
      '2 funding wallets have no exchange label here: whether they are private wallets or exchange addresses is unverified',
    ]);
    expect(result.summary).toMatch(/^Less than 1% of the \$[\d.]+M ETH short is covered by ETH at this address\./);
    expect(result.summary).toContain('funding does not establish ownership');
    expect(result.evidence.find((e) => e.label === 'Hedge found')?.value).toBe('0.0% (Ethereum, Arbitrum, HyperEVM)');
    expect(result.evidence.find((e) => e.label === 'Linked wallets')).toMatchObject({
      value: expect.stringMatching(/owner unconfirmed$/),
      source: 'Explorer + On-chain',
    });
    // Leverage, distance to liquidation, unrealized PnL and funding since
    // open: Hyperliquid returns all four on the headline position, and the
    // card attributes them to where the position record came from.
    expect(result.vitals).toContainEqual({ label: 'Leverage', value: '5x cross', source: 'Hyperliquid' });
    expect(result.vitals).toContainEqual({ label: 'Distance to liquidation', value: '38% (from mark)', source: 'Hyperliquid' });
    expect(result.vitals).toContainEqual({ label: 'Unrealized PnL', value: '-$13.7M', source: 'Hyperliquid' });
    expect(result.vitals).toContainEqual({ label: 'Funding since open', value: '-$1.4M', source: 'Hyperliquid' });
    expect(result.vitals.find((v) => v.label === 'Size vs open interest')?.source).toBe('Hyperliquid');
    // This fixture's 2,000 fills happen to hold none in ETH, the headline
    // coin - a fact about a busy account with a static headline position,
    // not a gap: the field says so rather than being left out.
    expect(result.vitals).toContainEqual(
      expect.objectContaining({ label: 'Position flow', value: expect.stringMatching(/^no fills \(/) }),
    );
  });

  it('does not call complete matching spot a hedge when a dex could not be read for positions', async () => {
    const eth = abxClearinghouse.assetPositions.find(p => p.position.coin === 'ETH')!;
    const balances = [balanceRow('WETH', Math.abs(Number(eth.position.positionValue)))];
    route({ holdings: balances });
    const realFetch = global.fetch;
    // One named dex will not answer for its positions: whatever it holds is
    // a leg nobody has seen.
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'clearinghouseState' && body.dex === 'flx') return new Response('down', { status: 500 });
      return (realFetch as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    const result = await checkAddress(ABRAXAS, { ...QUIET, now: () => abxClearinghouse.time + 60_000 });
    expect(result.positionsCoverage).toBe('partial');
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.hedge.hedgeRatio).toBeCloseTo(1, 2);
    expect(result.verdict.reasons).toEqual(['positions_not_complete']);
    expect(result.breakdown?.dataQuality).toBe('unknown');
  });

  it('describes a wide position spread without calling it a book (audit A03)', async () => {
    const sent = route();
    // Thirty offsetting positions in thirty different assets. That is a
    // portfolio shape, not evidence that the largest of them is inventory:
    // nothing here says the account quotes either side of any market.
    const offsetting = Array.from({ length: 30 }, (_, i) => ({
      coin: `C${i}`,
      size: i % 2 === 0 ? 10 : -10,
      valueUsd: 1_000_000,
    }));
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(syntheticPositions(offsetting)) });
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('diversified_book_no_quotes');
    // The PnL is Hyperliquid's portfolio: one request there, none to Nansen.
    expect(sent.hl.filter((t) => t === 'portfolio')).toHaveLength(1);
    expect(sent.unrouted).toEqual([]);
    // The headline here is a long, which spot cannot offset, so the holdings
    // read is skipped; thirty positions is no small account, so its funding
    // history is not read either.
    expect(sent.rpc).toEqual([]);
    expect(sent.explorer).toEqual([]);
  });

  it('never reads the hedge balance for a long: spot cannot offset one', async () => {
    const sent = route();
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])),
    });
    expect(result.positions.headlineSide).toBe('long');
    expect(result.hedgeScope).toBe('none');
    expect(sent.rpc).toEqual([]);
  });

  it('still reads funding history for a small long, which a hedge search would never reach (audit L02a)', async () => {
    const sent = route();
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])),
    });
    expect(result.positions.headlineSide).toBe('long');
    expect(result.positions.nPositions).toBeLessThanOrEqual(5);
    expect(sent.explorer.map((e) => e.chain).sort()).toEqual(['arbitrum', 'ethereum']);
  });

  it('stops after own balances when they already hedge the short', async () => {
    const balances = [balanceRow('WETH', 95_000_000)];
    const sent = route({ holdings: balances });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.reasons).toEqual(['hedge_leg']);
    expect(result.hedgeScope).toBe('known-tokens');
    // Covered by its own balances: the wallets that funded it are not looked at.
    expect(sent.explorer).toEqual([]);
  });

  it('reports when the positions were measured, not just when they were asked for', async () => {
    route({ holdings: [] });
    const at = Date.parse('2026-09-21T09:00:00.000Z');
    const positions = ethShort();
    positions.timestamp = at;
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(positions), now: () => at + 60_000 });
    expect(result.positionsAsOf).toBe('2026-09-21T09:00:00.000Z');
    expect(result.classifierVersion).toBe(CLASSIFIER_VERSION);
    expect(result.coverage.some((c) => c.includes('measured'))).toBe(false);
  });

  it('says so when the positions it was given are already old', async () => {
    route({ holdings: [] });
    const at = Date.parse('2026-09-21T09:00:00.000Z');
    const positions = ethShort();
    positions.timestamp = at;
    // An hour between the measurement and the check. The old code stamped it
    // with the check time and said nothing.
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(positions), now: () => at + 3_600_000 });
    expect(result.positionsAsOf).toBe('2026-09-21T09:00:00.000Z');
    expect(result.coverage).toContain('Positions were measured 60 minutes before this check, not at the moment of it');
    expect(result.verdict.reasons).toEqual(['positions_stale']);
    expect(result.breakdown?.dataQuality).toBe('unknown');
  });

  it('still answers when open interest cannot be read', async () => {
    const realFetch = global.fetch;
    route();
    const routed = global.fetch;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'metaAndAssetCtxs') return new Response('down', { status: 503 });
      return (routed as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    const result = await checkAddress(ABRAXAS, { ...QUIET });
    global.fetch = realFetch;

    // Open interest decorates the card; it decides nothing, so losing it
    // must not lose the whole check.
    expect(result.positions.nPositions).toBe(abxClearinghouse.assetPositions.length + abxXyz.assetPositions.length);
    expect(result.sizeVsOi).toBeNull();
    expect(result.coverage).toContain('Open interest unavailable, so size versus open interest is not shown');
  });

  it('stops spending once a check has run past its deadline', async () => {
    const balances = [balanceRow('WETH', 95_000_000)];
    const sent = route({ holdings: balances });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()), deadline: Date.now() - 1 });
    // The optional reads, each at its own timeout, can outlast any reader's
    // patience: past the deadline none of them starts.
    expect(sent.hl).not.toContain('portfolio');
    expect(sent.rpc).toEqual([]);
    expect(sent.explorer).toEqual([]);
    expect(result.coverage).toContain('PnL was not read: this check ran out of time');
    expect(result.coverage).toContain('This check ran out of time before it could read holdings on other chains');
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('reads resting orders on every dex the account has a position on', async () => {
    route({ holdings: [] });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      readPositions: holding(syntheticPositions([{ coin: 'xyz:SP500', size: -100, valueUsd: 38_000_000 }])),
    });
    // Without asking the xyz dex by name, this account looks like it quotes
    // nothing at all, which is one of the conditions for calling it a bet.
    expect(result.orders.coinsBothSides).toBe(1);
    expect(result.coverage.some((c) => c.includes('xyz'))).toBe(false);
  });

  it('says so when a HIP-3 dex will not answer for its orders', async () => {
    route({ holdings: [] });
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.type === 'frontendOpenOrders' && body.dex) return new Response('nope', { status: 500 });
      return (realFetch as unknown as typeof fetch)(url, init);
    }) as unknown as typeof fetch;
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      readPositions: holding(syntheticPositions([{ coin: 'xyz:SP500', size: -100, valueUsd: 38_000_000 }])),
    });
    expect(result.coverage).toContain('Resting orders on the xyz dex could not be read');
  });

  it('does not count a token that only calls itself WETH: the nodes are asked for the registry contracts only', async () => {
    const lookalike = 'de'.repeat(20);
    const sent = route({ holdings: [] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(sent.rpc).toHaveLength(3);
    expect(result.hedge.hedgeUsd).toBe(0);
    // A ticker is not asked about at all, so a look-alike never reaches the hedge.
    const bodies = vi.mocked(global.fetch).mock.calls.map(([, init]) => String(init?.body ?? ''));
    expect(bodies.filter((b) => b.includes('eth_call'))).toHaveLength(3);
    expect(bodies.some((b) => b.includes(lookalike))).toBe(false);
    expect(result.verdict.verdict).not.toBe('hedged');
  });

  it('counts an Aave deposit as a hedge but says the loan against it is invisible', async () => {
    // The real aEthWETH contract, seen in the Abraxas funder balances.
    const balances = [balanceRow('AETHWETH', 95_000_000, '0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8')];
    route({ holdings: balances });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.coverage).toContain(
      '$95.0M of the matching assets is a lending-market deposit; anything borrowed against it does not show here',
    );
  });

  it('calls a 60%-covered short partly offset, and still reads nothing about funders', async () => {
    const balances = [balanceRow('WETH', 60_000_000)];
    const sent = route({ holdings: balances });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['partial_offset']);
    // The account's own holdings already explain more than half of it, so
    // the wallets that funded it are not worth a request.
    expect(sent.explorer).toEqual([]);
  });

  it('still calls a short a bet when the hedge was checked in full and found nothing', async () => {
    route({ holdings: [] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.verdict.verdict).toBe('looks_like_a_bet');
  });

  it('does not call a short a bet when the hedge read failed', async () => {
    route({ holdings: [], failChains: ['ethereum', 'arbitrum', 'hyperevm'] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('missing');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
    expect(result.summary).toContain('could not be established');
  });

  it('does not call a short a bet when a token balance came back unreadable', async () => {
    route({ holdings: [], failTokens: [WETH_ETHEREUM] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('partial');
    expect(result.coverageNotes).toContainEqual({
      text: '1 token balance on other chains came back unreadable and was left out, so the cover found there is a floor',
      failure: true,
    });
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
  });

  it('does not call a short a bet from Hyperliquid spot alone', async () => {
    // The nodes do not answer, so all that was read is Hyperliquid's spot.
    route({ failChains: ['ethereum', 'arbitrum', 'hyperevm'] });
    const result = await checkAddress(ABRAXAS, { ...QUIET });
    // Abraxas is short ETH and holds no ETH on Hyperliquid; without the other
    // chains that is a gap in the reading, not an absence of a hedge.
    expect(result.positions.headlineSide).toBe('short');
    expect(result.hedgeScope).toBe('hyperliquid');
    expect(result.hedgeCoverage).toBe('missing');
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('does not call a short a bet with no explorer key: the Arbitrum funders were not looked at', async () => {
    const sent = route();
    const result = await checkAddress(ABRAXAS, {});
    expect(result.positions.headlineSide).toBe('short');
    expect(sent.rpc).toHaveLength(3);
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });
});

const WSTETH_ETHEREUM = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
/** Lido's wstETH rate on 2026-11-09, which the node answers carry. */
const WSTETH_RATE = 1.2488;

describe('holdings on other chains, read from public nodes', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('holdings are read from public nodes, and nothing from Nansen', async () => {
    const sent = route();
    const result = await checkAddress(ABRAXAS, { ...QUIET });
    expect(result.positions.headlineSide).toBe('short');
    // One request per chain, for the account itself (nothing funded it here);
    // nothing from Nansen.
    expect(sent.rpc).toEqual(HOLDINGS_CHAINS.map((chain) => ({ chain, wallet: ABRAXAS })));
    expect(sent.unrouted).toEqual([]);
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.coverageNotes).toContainEqual({ text: KNOWN_TOKENS_NOTE, failure: false });
  });

  it('a short covered by wstETH on Ethereum reads Hedged', async () => {
    // $95M of the $100M short, held as wstETH: the amount worth that at the
    // node's wstETH rate and Hyperliquid's ETH mark.
    const wsteth = { ...balanceRow('wstETH', 95_000_000, WSTETH_ETHEREUM), token_amount: 95_000_000 / (WSTETH_RATE * ETH_MARK) };
    route({ holdings: [wsteth] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.hedge.hedgeUsd).toBeCloseTo(95_000_000, -2);
    expect(result.hedge.hedgeUsdBySource).toEqual({ hyperliquidSpot: 0, onchain: result.hedge.hedgeUsd });
    // The verdict and reason the same cover gave when Nansen read it.
    expect(result.verdict.verdict).toBe('hedged');
    expect(result.verdict.reasons).toEqual(['hedge_leg']);
    expect(result.evidence.find((e) => e.label === 'Hedge found')?.source).toBe('On-chain');
  });

  it('one chain down makes the cover partial and says which', async () => {
    route({ holdings: [], failChains: ['arbitrum'] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.hedgeCoverage).toBe('partial');
    expect(result.coverageNotes).toContainEqual({ text: 'Holdings on Arbitrum could not be read', failure: true });
    expect(result.coverage.filter((c) => c.startsWith('Holdings on '))).toEqual(['Holdings on Arbitrum could not be read']);
    // The scope note names the chains that were read, and only those.
    expect(result.coverageNotes).toContainEqual({
      text:
        'Balances on other chains: only the tokens this tool recognises (ETH, WETH, stETH, wstETH, rETH, cbETH, weETH, ' +
        'Aave WETH deposits, WBTC, cbBTC, HYPE, WHYPE) on Ethereum and HyperEVM were read; look-alike staking tokens ' +
        '(rsETH, ezETH, mETH, ETHx, osETH) were looked for but are never counted as cover; other tokens and other ' +
        'chains were not',
      failure: false,
    });
    expect(result.coverage).not.toContain(KNOWN_TOKENS_NOTE);
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
    expect(result.summary).toContain('its holdings on some of Ethereum, Arbitrum and HyperEVM could not be read');
  });

  it('the scope note lists only the tokens of the chains read', async () => {
    const noteOf = async (failChains: Array<'ethereum' | 'arbitrum' | 'hyperevm'>) => {
      route({ holdings: [], failChains });
      const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
      return result.coverage.find((c) => c.startsWith('Balances on other chains'))!;
    };
    // Ethereum down: its liquid-staking, Aave and cbBTC entries are not claimed.
    const noEthereum = await noteOf(['ethereum']);
    for (const gone of ['stETH', 'rETH', 'cbETH', 'weETH', 'Aave WETH deposits', 'cbBTC']) {
      expect(noEthereum).not.toMatch(new RegExp(`[(, ]${gone}[,)]`));
    }
    // Arbitrum's own wstETH is still read, so it is still named; so are its
    // two look-alike staking tokens, and only those two.
    expect(noEthereum).toBe(
      'Balances on other chains: only the tokens this tool recognises (ETH, WETH, wstETH, WBTC, HYPE, WHYPE) on ' +
        'Arbitrum and HyperEVM were read; look-alike staking tokens (rsETH, ezETH) were looked for but are never ' +
        'counted as cover; other tokens and other chains were not',
    );
    for (const gone of ['mETH', 'ETHx', 'osETH']) expect(noEthereum).not.toContain(gone);
    // Arbitrum down: Ethereum still brings all five.
    expect(await noteOf(['arbitrum'])).toContain('look-alike staking tokens (rsETH, ezETH, mETH, ETHx, osETH) were looked for');
    // Only HyperEVM read: it has no look-alike token, so the clause is left out.
    const onlyHyperEvm = await noteOf(['ethereum', 'arbitrum']);
    expect(onlyHyperEvm).toBe(
      'Balances on other chains: only the tokens this tool recognises (HYPE, WHYPE) on HyperEVM were read; ' +
        'other tokens and other chains were not',
    );
    expect(onlyHyperEvm).not.toContain('look-alike');
  });

  it('every chain down is missing', async () => {
    route({ holdings: [], failChains: ['ethereum', 'arbitrum', 'hyperevm'] });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('missing');
    expect(result.hedgeScope).toBe('hyperliquid');
    for (const name of ['Ethereum', 'Arbitrum', 'HyperEVM']) {
      expect(result.coverageNotes).toContainEqual({ text: `Holdings on ${name} could not be read`, failure: true });
    }
    expect(result.coverage).not.toContain(KNOWN_TOKENS_NOTE);
    expect(result.verdict.reasons).toEqual(['hedge_not_checked']);
    expect(result.summary).toContain(
      'whether it is hedged could not be established: the read of its holdings on other chains failed.',
    );
  });

  it('no Nansen request is sent, for balances or anything else', async () => {
    const sent = route({ explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    expect(result.positions.headlineSide).toBe('short');
    expect(sent.explorer).toHaveLength(3);
    expect(sent.unrouted).toEqual([]);
  });

  it("funders' balances come from public nodes", async () => {
    const sent = route({ explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    for (const wallet of [FUNDER_ARB, FUNDER_ETH]) {
      expect(sent.rpc.filter((r) => r.wallet === wallet).map((r) => r.chain)).toEqual([...HOLDINGS_CHAINS]);
    }
    // The ETH-family registry tokens in the funder fixtures, in units of ETH
    // at the 2026-11-09 rates; everything else in them (rsETH, ETH on Base or
    // Optimism, tokens on other chains) is not read.
    const funderEthUnits =
      49251.08884613739 * 1.1078 + // weETH, Ethereum
      46999.33645823939 + // aEthWETH, Ethereum
      36483.35791934678 * WSTETH_RATE + // wstETH, Ethereum
      3.9990590143585654 + // ETH, Ethereum
      1.0399805725978775 + // WETH, Arbitrum
      1.0001891726388266; // ETH, Arbitrum
    const funderArbUnits =
      12588.098333737673 + // ETH, Arbitrum
      0.1819380496735048 + // ETH, Ethereum
      0.00918812; // WETH, Arbitrum
    const usd = (address: string) => result.linkedHedge!.funders.find((f) => f.address === address)!.matchingUsd;
    expect(usd(FUNDER_ETH) / (funderEthUnits * ETH_MARK)).toBeCloseTo(1, 6);
    expect(usd(FUNDER_ARB) / (funderArbUnits * ETH_MARK)).toBeCloseTo(1, 6);
    expect(result.linkedHedgeCoverage).toBe('complete');
  });

  it("Hyperliquid's market data missing leaves on-chain holdings unpriced, never zero, and says which price", async () => {
    route({ holdings: [balanceRow('WETH', 95_000_000)], marks: false });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.hedge.unpricedMatches).toBe(1);
    expect(result.coverageNotes).toContainEqual({
      text: "Holdings on other chains could not be priced: Hyperliquid's ETH price was not read",
      failure: true,
    });
    expect(result.verdict.reasons).toEqual(['unrecognised_assets']);
  });
});

// A restaking farm - long rsETH or ezETH, short ETH on Hyperliquid - is read
// from the nodes as holdings the registry does not recognise. Without the
// watchlist those balances were never asked about, and the farm read as a bet.
describe('look-alike staking tokens held against an ETH short', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const RSETH = '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7';
  const ARB_EZETH = '0x2416092f143378750bb29b79ed961ab195cceea5';
  const LEFT_OUT = 'were left out: their contract is not one this tool recognises';

  /** Amount of a token worth `share` of the $100M short, at the ETH mark. */
  const worth = (share: number) => (share * 100_000_000) / ETH_MARK;

  it('withholds the reading when 12% of the notional is rsETH on Ethereum', async () => {
    route({ holdings: [], extra: { ethereum: { [RSETH]: worth(0.12) } } });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    // Every chain answered and the funder search ran to the end: the only thing
    // that stands in the way of a Bet is the holding the tool cannot identify.
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.hedge.unverifiedUsd).toBeCloseTo(12_000_000, -2);
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['unrecognised_assets']);
    expect(result.coverage).toContain(`$12.0M of holdings named like ETH ${LEFT_OUT}`);
    expect(result.coverage).toContain(KNOWN_TOKENS_NOTE);
  });

  it('withholds the reading when 12% of the notional is ezETH on Arbitrum', async () => {
    route({ holdings: [], extra: { arbitrum: { [ARB_EZETH]: worth(0.12) } } });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.hedge.unverifiedUsd).toBeCloseTo(12_000_000, -2);
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['unrecognised_assets']);
    expect(result.coverage).toContain(`$12.0M of holdings named like ETH ${LEFT_OUT}`);
  });

  it('does not call a short Hedged because of rsETH, even when it would cover all of it', async () => {
    route({ holdings: [], extra: { ethereum: { [RSETH]: worth(0.95) } } });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.hedge.hedgeRatio).toBe(0);
    expect(result.hedge.unverifiedUsd).toBeCloseTo(95_000_000, -2);
    expect(result.verdict.verdict).not.toBe('hedged');
    expect(result.verdict.reasons).toEqual(['unrecognised_assets']);
  });

  it('leaves the verdict alone below the rule threshold: 5% of the notional changes nothing by itself', async () => {
    route({ holdings: [] });
    const without = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    route({ holdings: [], extra: { ethereum: { [RSETH]: worth(0.05) } } });
    const withFive = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(without.verdict.verdict).toBe('looks_like_a_bet');
    expect(withFive.verdict).toEqual(without.verdict);
    expect(withFive.hedgeCoverage).toBe('complete');
    expect(withFive.hedge.unverifiedUsd).toBeCloseTo(5_000_000, -2);
    // Still said on the card, where it is more than dust.
    expect(withFive.coverage).toContain(`$5.0M of holdings named like ETH ${LEFT_OUT}`);
  });

  it('reads the watchlist from the same three node calls: the request count does not move', async () => {
    const sent = route({ holdings: [], extra: { ethereum: { [RSETH]: worth(0.12) } } });
    await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(sent.rpc).toEqual(HOLDINGS_CHAINS.map((chain) => ({ chain, wallet: ABRAXAS })));
  });

  it("a funder's look-alike tokens are not cover: they add nothing to the linked hedge", async () => {
    // Both funders hold $50M of rsETH and nothing the registry trusts.
    const sent = route({
      holdings: [],
      funders: { holdings: [], extra: { ethereum: { [RSETH]: 50_000_000 / ETH_MARK } } },
      explorer: abraxasPages(),
    });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    for (const wallet of [FUNDER_ARB, FUNDER_ETH]) {
      expect(sent.rpc.filter((r) => r.wallet === wallet).map((r) => r.chain)).toEqual([...HOLDINGS_CHAINS]);
    }
    expect(result.linkedHedge?.funders).toHaveLength(2);
    expect(result.linkedHedge?.funders.map((f) => f.matchingUsd)).toEqual([0, 0]);
    expect(result.linkedHedge?.linkedHedgeUsd).toBe(0);
    // Read in full and priced: nothing partial about a funder for holding them.
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.coverage.some((c) => c.includes('could not be priced'))).toBe(false);
    expect(result.verdict.reasons).not.toContain('linked_exposure_unverified');
  });

  // The unpriced-funder rule is about holdings that could be cover. A look-alike
  // token can never be cover, so a funder that holds only those, unpriced, has
  // nothing the search lost by not pricing it.
  const UNPRICED_FUNDER_NOTE =
    'A funding wallet holds tokens this tool recognises that could not be priced, so its holdings may be understated';

  it('an unpriced look-alike token at a funder does not make the funder search partial or write the unpriced-funder note', async () => {
    route({ holdings: [], marks: false, funders: { holdings: [], extra: { ethereum: { [RSETH]: 20_000 } } }, explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    expect(result.linkedHedge?.funders).toHaveLength(2);
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.linkedHedge?.linkedHedgeUsd).toBe(0);
    expect(result.coverage).not.toContain(UNPRICED_FUNDER_NOTE);
    expect(result.coverage.some((c) => c.startsWith('A funding wallet holds tokens'))).toBe(false);
  });

  it('a funder holding an unpriced registry token and a look-alike token is still partial, with the note', async () => {
    route({
      holdings: [],
      marks: false,
      funders: { holdings: [balanceRow('WETH', 5_000_000)], extra: { ethereum: { [RSETH]: 20_000 } } },
      explorer: abraxasPages(),
    });
    const result = await checkAddress(ABRAXAS, {
      ...QUIET,
      now: () => Date.parse('2026-09-18T13:05:21.479Z'),
    });
    expect(result.coverageNotes).toContainEqual({ text: UNPRICED_FUNDER_NOTE, failure: true });
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge?.linkedHedgeUsd).toBe(0);
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('with no ETH mark, a watchlist holding is unpriced: the note is written and the read is not a Bet', async () => {
    route({ holdings: [], extra: { ethereum: { [RSETH]: 3 } }, marks: false });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    expect(result.coverageNotes).toContainEqual({
      text: "Holdings on other chains could not be priced: Hyperliquid's ETH price was not read",
      failure: true,
    });
    expect(result.degraded).toBe(true);
    expect(result.hedge.hedgeUsd).toBe(0);
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('with no ETH mark, the card and "Still open" say an unpriced look-alike could not be priced - not a matching balance, not $0 of holdings', async () => {
    route({ holdings: [], extra: { ethereum: { [RSETH]: 3 } }, marks: false });
    const result = await checkAddress(ABRAXAS, { ...QUIET, readPositions: holding(ethShort()) });
    // The look-alike has no dollars (no price) and is not a match: it counts only as unpriced.
    expect(result.hedge).toMatchObject({ unverifiedUsd: 0, unpricedMatches: 1, hedgeUsd: 0 });
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.verdict.reasons).toEqual(['unrecognised_assets']);
    expect(result.summary).toContain('1 holding named like ETH could not be priced');
    expect(result.summary).not.toMatch(/matching balance|could not be identified/);
    const open = openQuestion(result);
    expect(open).toContain('in 1 holding named like ETH that could not be priced');
    expect(open).not.toContain('$0');
  });
});

// Stage 3: the funding links and a long's funding history come from a block
// explorer (src/sources/explorer.ts). Nansen is not asked for anything.
describe('funding links from the block explorer', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const keyed = QUIET;
  const urls = () => vi.mocked(global.fetch).mock.calls.map(([url]) => String(url));
  const NOT_FOLLOWED = '1 funding link(s) lead to an exchange or bridge and were not followed';

  it('(a) runs the funder search without any Nansen client: two candidates, read from nodes, complete', async () => {
    const sent = route({ holdings: [], explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    // The links of the account on both chains, then the label of the Arbitrum sender (an unlabelled answer here).
    expect(sent.explorer.map((e) => e.chain).sort()).toEqual(['arbitrum', 'ethereum', 'ethereum']);
    expect(sent.explorer.filter((e) => e.wallet !== ABRAXAS)).toEqual([{ chain: 'ethereum', wallet: FUNDER_ARB }]);
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    for (const wallet of [FUNDER_ARB, FUNDER_ETH]) {
      expect(sent.rpc.filter((r) => r.wallet === wallet).map((r) => r.chain)).toEqual([...HOLDINGS_CHAINS]);
    }
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.verdict.reasons).toEqual(['linked_exposure_unverified']);
    expect(result.evidence.find((e) => e.label === 'Linked wallets')?.source).toBe('Explorer + On-chain');
    expect(result.coverageNotes).toContainEqual({
      text: '2 funding wallets have no exchange label here: whether they are private wallets or exchange addresses is unverified',
      failure: false,
    });
    expect(result.coverage.join(' ')).not.toMatch(/Nansen/);
    expect(result.source).toBe('hyperliquid');
    expect(sent.unrouted).toEqual([]);
  });

  it('(b) with no explorer key, Arbitrum is not read: the search is partial and the verdict is withheld', async () => {
    // Ethereum, read keyless, names nobody: a search that ran on both chains
    // and found nothing would let this lone short read as a bet.
    const sent = route({ holdings: [], explorer: {} });
    const result = await checkAddress(ABRAXAS, { readPositions: holding(ethShort()) });
    expect(sent.explorer).toEqual([{ chain: 'ethereum', wallet: ABRAXAS }]);
    expect(urls().some((u) => u.startsWith('https://eth.blockscout.com/'))).toBe(true);
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.coverageNotes).toContainEqual({
      text: 'Funding links on Arbitrum were not read: no explorer key is configured',
      failure: true,
    });
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
    expect(result.verdict.reasons).toEqual(['linked_holdings_not_checked']);
    // The obsolete Nansen-off path is gone: no note about Nansen at all.
    expect(result.coverage.join(' ')).not.toMatch(/Nansen/);
  });

  it('(c) both chains failing leaves the search missing, and names each chain', async () => {
    route({ holdings: [], explorer: { [ABRAXAS]: { ethereum: explorerDown, arbitrum: explorerDown } } });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    expect(result.linkedHedgeCoverage).toBe('missing');
    expect(result.linkedHedge).toBeNull();
    for (const chain of ['Ethereum', 'Arbitrum']) {
      expect(result.coverageNotes).toContainEqual({ text: `Funding links on ${chain} could not be read`, failure: true });
    }
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('a chain read but cut short makes the search partial, and says the earliest funder may be missing', async () => {
    route({ holdings: [], explorer: { [ABRAXAS]: { ethereum: cutShortPage(ABRAXAS) } } });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.coverageNotes).toContainEqual({
      text:
        'Funding links on Ethereum: the first page held no incoming transaction with a value, so the earliest funder may be missing',
      failure: true,
    });
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('skips an Arbitrum funder the explorer tags as an exchange, and reads the search from the other candidate', async () => {
    // The label lookup is answered with the keyed capture of 2026-11-10: on
    // the Ethereum chain Blockscout tags 0xb38e...891d as a Binance hot wallet.
    const sent = route({ holdings: [], explorer: abraxasPages({ labelled: true }) });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    expect(result.coverage).toContain(NOT_FOLLOWED);
    expect(result.linkedHedge?.funders.map((f) => f.address)).toEqual([FUNDER_ETH]);
    expect(sent.rpc.filter((r) => r.wallet === FUNDER_ARB)).toEqual([]);
    expect(sent.explorer).toContainEqual({ chain: 'ethereum', wallet: FUNDER_ARB });
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.coverageNotes).toContainEqual({
      text: '1 funding wallet has no exchange label here: whether it is a private wallet or an exchange address is unverified',
      failure: false,
    });
  });

  it('follows an Arbitrum funder whose label lookup fails: it stays unverified, the chain still counts as read', async () => {
    // Fail-safe: an unlabelled exchange funder is followed, its matching
    // holdings make the reading Unknown (never a Bet), and nothing about the
    // optional lookup turns the chain read into an error.
    const sent = route({
      holdings: [],
      explorer: { ...abraxasPages(), [FUNDER_ARB]: { ethereum: explorerDown } },
    });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    expect(sent.explorer).toContainEqual({ chain: 'ethereum', wallet: FUNDER_ARB });
    expect(result.linkedHedge?.funders.map((f) => f.address).sort()).toEqual([FUNDER_ARB, FUNDER_ETH].sort());
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.coverage.join(' ')).not.toContain('could not be read');
    expect(result.coverage).not.toContain(NOT_FOLLOWED);
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
    expect(result.verdict.reasons).toEqual(['linked_exposure_unverified']);
  });

  it('names no Nansen anywhere when the own node reads of the account fail but those of its funders succeed', async () => {
    // Scope 'hyperliquid' (no chain of the account answered), yet the funder
    // search ran on the explorer and its funders were read from the nodes.
    route({ holdings: [], explorer: abraxasPages(), failWalletChains: { [ABRAXAS]: ['ethereum', 'arbitrum', 'hyperevm'] } });
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()) });
    expect(result.hedgeScope).toBe('hyperliquid');
    expect(result.linkedHedge?.funders).toHaveLength(2);
    expect(result.evidence.find((e) => e.label === 'Linked wallets')?.source).toBe('Explorer + On-chain');
    expect(result.evidence.filter((e) => /Nansen/.test(e.source) || /Nansen/.test(e.value))).toEqual([]);
    expect(result.vitals.filter((v) => /Nansen/.test(v.source) || /Nansen/.test(v.value))).toEqual([]);
    expect(result.summary).not.toMatch(/Nansen/);
    expect(nansenContribution({ ...result, nansenCalls: 0 })).toBeNull();
  });

  it('(d) a small long gets its earliest funding from the explorer, and says which chain was not read', async () => {
    route({ holdings: [], explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])),
      now: () => Date.parse('2026-11-09T00:00:00Z'),
    });
    expect(result.positions.headlineSide).toBe('long');
    // The Ethereum capture: first funded by 0xed0c...4312 on 2025-07-08.
    expect(result.vitals.find((v) => v.label === 'Earliest funding found')).toEqual({
      label: 'Earliest funding found',
      value: '488 days ago on ethereum, arbitrum not read, by an unlabelled wallet',
      source: 'Explorer',
    });
    expect(result.coverageNotes).toContainEqual({
      text: 'Funding links on Arbitrum were not read: no explorer key is configured',
      failure: false,
    });
  });

  // Final review of stage 3, M2: a chain read but cut short is not a chain that was read to the end. The
  // earliest funding found on the other chain may not be the earliest there is, so the vital says so too.
  it('(d) a chain read but cut short is named as not read in the earliest-funding vital', async () => {
    route({ holdings: [], explorer: { [ABRAXAS]: { ethereum: abraxasPages()[ABRAXAS]!.ethereum, arbitrum: arbitrumCutShortPage(ABRAXAS) } } });
    const result = await checkAddress(ABRAXAS, {
      ...keyed,
      readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])),
      now: () => Date.parse('2026-11-09T00:00:00Z'),
    });
    expect(result.vitals.find((v) => v.label === 'Earliest funding found')).toEqual({
      label: 'Earliest funding found',
      value: '488 days ago on ethereum, arbitrum not read, by an unlabelled wallet',
      source: 'Explorer',
    });
    // The note on the card says why, the same way it does for a short.
    expect(result.coverageNotes).toContainEqual({
      text:
        'Funding links on Arbitrum: the first page held no incoming transaction with a value, so the earliest funder may be missing',
      failure: false,
    });
  });

  it('(d) with a key, the earliest of both chains is the one named', async () => {
    route({ holdings: [], explorer: abraxasPages() });
    const result = await checkAddress(ABRAXAS, {
      ...keyed,
      readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])),
      now: () => Date.parse('2026-11-09T00:00:00Z'),
    });
    // The synthetic Arbitrum page: 2025-02-20, earlier than Ethereum's.
    expect(result.vitals.find((v) => v.label === 'Earliest funding found')).toEqual({
      label: 'Earliest funding found',
      value: '626 days ago on arbitrum, by an unlabelled wallet',
      source: 'Explorer',
    });
  });

  it('(e) sends no request to Nansen on any path', async () => {
    const paths: Array<Parameters<typeof checkAddress>[1]> = [
      { ...keyed, readPositions: holding(ethShort()) },
      { readPositions: holding(ethShort()) },
      { ...keyed },
      { ...keyed, readPositions: holding(syntheticPositions([{ coin: 'BTC', size: 500, valueUsd: 50_000_000 }])) },
      { ...keyed, readPositions: holding(ethShort()), includeContext: false },
      { ...keyed, readPositions: holding(ethShort()), deadline: Date.now() - 1 },
    ];
    for (const opts of paths) {
      const sent = route({ holdings: [], explorer: abraxasPages() });
      const result = await checkAddress(ABRAXAS, opts);
      expect(sent.unrouted).toEqual([]);
      expect(urls().filter((u) => u.includes('nansen'))).toEqual([]);
      expect(result.source).toBe('hyperliquid');
    }
  });

  it('(f) an explorer read the request limit refused is named with the limit as the reason', async () => {
    route({ holdings: [] });
    await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()), includeContext: false });
    const firstExplorer = urls().findIndex((u) => explorerRequestOf(u) !== null);
    expect(firstExplorer).toBeGreaterThan(0);

    // Room for everything before the funding links, and nothing after.
    const sent = route({ holdings: [] });
    const signal = new AbortController().signal;
    attachRequestBudget(signal, createRequestBudget(firstExplorer));
    const result = await checkAddress(ABRAXAS, { ...keyed, readPositions: holding(ethShort()), includeContext: false, signal });
    expect(sent.explorer).toEqual([]);
    for (const chain of ['Ethereum', 'Arbitrum']) {
      expect(result.coverageNotes).toContainEqual({
        text: `Funding links on ${chain} were not read: ${REQUEST_LIMIT_REASON}`,
        failure: true,
      });
    }
    expect(result.coverage.join(' ')).not.toContain('could not be read');
    expect(result.linkedHedgeCoverage).toBe('missing');
  });
});

describe('the 30-day PnL read gives way like the other descriptive reads', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('says so, as context, when the check ran out of time before it', async () => {
    const sent = route({ holdings: [] });
    const result = await checkAddress(ABRAXAS, { readPositions: holding(ethShort()), deadline: Date.now() - 1 });
    expect(sent.hl).not.toContain('portfolio');
    expect(result.coverageNotes).toContainEqual({ text: 'PnL was not read: this check ran out of time', failure: false });
  });
});
