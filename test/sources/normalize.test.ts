import { describe, expect, it } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
import portfolioAbraxas from '../fixtures/hyperliquid/portfolio-abraxas.json';
import portfolioHypeLong from '../fixtures/hyperliquid/portfolio-hype-long.json';
import {
  normalizePositions,
  normalizeOrders,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
  duplicateSpotTokenNames,
  normalizeTrades,
  normalizePortfolioPnl,
  serviceStatusOf,
  UpstreamShapeError,
} from '../../src/sources/normalize';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
  HlFill,
} from '../../src/sources/hyperliquid';

describe('normalizePositions', () => {
  it('converts every raw position into the domain Position shape', () => {
    const raw = clearinghouseFixture as HlClearinghouseState;
    const positions = normalizePositions(raw);
    expect(positions.length).toBe(raw.assetPositions.length);
    for (const p of positions) {
      expect(['long', 'short']).toContain(p.side);
      expect(p.sizeUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads side from the sign of szi', () => {
    const raw = clearinghouseFixture as HlClearinghouseState;
    const positions = normalizePositions(raw);
    raw.assetPositions.forEach((entry, i) => {
      const expectedSide = Number(entry.position.szi) >= 0 ? 'long' : 'short';
      expect(positions[i].side).toBe(expectedSide);
    });
  });

  it('carries the cross/isolated leverage type, already paid for and previously dropped', () => {
    const raw = clearinghouseFixture as HlClearinghouseState;
    const positions = normalizePositions(raw);
    raw.assetPositions.forEach((entry, i) => {
      expect(positions[i].leverageType).toBe(entry.position.leverage.type);
    });
  });
});

describe('normalizeOrders', () => {
  it('converts every non-trigger raw order into the domain RestingOrder shape', () => {
    const orders = normalizeOrders(openOrdersFixture as HlOpenOrder[]);
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      expect(['bid', 'ask']).toContain(o.side);
      expect(o.sizeUsd).toBeGreaterThan(0);
    }
  });
});

describe('spot price index and holdings', () => {
  it('resolves a price for every distinct base token in the active universe', () => {
    const [meta, ctxs] = spotMetaFixture as unknown as [HlSpotMeta, HlSpotAssetCtx[]];
    const prices = buildSpotPriceIndex(meta, ctxs);
    // The fixture's context array is longer than its universe array (it
    // also carries delisted pairs), so a name-matched index, not a
    // positional one, is required. Separately, some base tokens (HYPE,
    // UBTC, UETH, ...) are quoted against more than one pair in the real
    // fixture - the number of distinct base tokens is therefore smaller
    // than universe.length, and that is the real invariant to check.
    const distinctBaseTokens = new Set(meta.universe.map((pair) => pair.tokens[0]));
    expect(prices.size).toBe(distinctBaseTokens.size);
  });

  it('reads a price only from a pair quoted in dollars', () => {
    const meta: HlSpotMeta = {
      tokens: [
        { name: 'USDC', index: 0 },
        { name: 'UBTC', index: 1 },
        { name: 'UETH', index: 2 },
      ],
      universe: [
        { tokens: [2, 1], name: 'UETH/UBTC', index: 0, isCanonical: false },
        { tokens: [1, 0], name: 'UBTC/USDC', index: 1, isCanonical: true },
      ],
    } as unknown as HlSpotMeta;
    const ctxs = [
      { coin: 'UETH/UBTC', markPx: '0.03' },
      { coin: 'UBTC/USDC', markPx: '100000' },
    ] as unknown as HlSpotAssetCtx[];

    const prices = buildSpotPriceIndex(meta, ctxs);
    // 0.03 BTC is about $3 000, not $0.03. A price is only a dollar price
    // when the other side of the pair is dollars.
    expect(prices.get(2)).toBeUndefined();
    expect(prices.get(1)).toBe(100_000);
  });

  it('prefers the USDC pair when a token trades against several dollar tokens', () => {
    const meta: HlSpotMeta = {
      tokens: [
        { name: 'USDC', index: 0 },
        { name: 'USDH', index: 1 },
        { name: 'HYPE', index: 2 },
      ],
      universe: [
        { tokens: [2, 1], name: 'HYPE/USDH', index: 0, isCanonical: false },
        { tokens: [2, 0], name: 'HYPE/USDC', index: 1, isCanonical: true },
        { tokens: [2, 1], name: 'HYPE/USDH2', index: 2, isCanonical: false },
      ],
    } as unknown as HlSpotMeta;
    const ctxs = [
      { coin: 'HYPE/USDH', markPx: '41' },
      { coin: 'HYPE/USDC', markPx: '40' },
      { coin: 'HYPE/USDH2', markPx: '42' },
    ] as unknown as HlSpotAssetCtx[];
    // The old loop simply let the last pair win, whichever it happened to be.
    expect(buildSpotPriceIndex(meta, ctxs).get(2)).toBe(40);
  });

  it('prices the captured spot balances and drops zero-value dust', () => {
    const [meta, ctxs] = spotMetaFixture as unknown as [HlSpotMeta, HlSpotAssetCtx[]];
    const prices = buildSpotPriceIndex(meta, ctxs);
    const holdings = normalizeSpotHoldings(
      (spotBalancesFixture as { balances: HlSpotBalance[] }).balances,
      prices,
    );
    expect(holdings.length).toBeGreaterThan(0);
    for (const h of holdings) {
      expect(h.valueUsd).toBeGreaterThan(0);
      expect(h.coin).not.toBe('USDC');
    }
  });

  it('finds no duplicate names in a real captured spotMeta (23.09 audit, L08)', () => {
    const [meta] = spotMetaFixture as unknown as [HlSpotMeta, HlSpotAssetCtx[]];
    expect(duplicateSpotTokenNames(meta).size).toBe(0);
  });

  it('flags a holding whose name is not unique in this check\'s own token list', () => {
    // A token deployed under a name already in use: nothing here proves this
    // balance is the well-known HYPE rather than the look-alike at a
    // different index, so it cannot be trusted by name alone.
    const meta: HlSpotMeta = {
      tokens: [
        { name: 'HYPE', index: 150 },
        { name: 'HYPE', index: 987654 },
      ],
      universe: [],
    } as unknown as HlSpotMeta;
    const duplicates = duplicateSpotTokenNames(meta);
    expect(duplicates.has('HYPE')).toBe(true);

    const balances: HlSpotBalance[] = [
      { coin: 'HYPE', token: 987654, total: '1000', hold: '0', entryNtl: '0' },
    ];
    const holdings = normalizeSpotHoldings(balances, new Map([[987654, 40]]), duplicates);
    expect(holdings[0]).toMatchObject({ coin: 'HYPE', identityAmbiguous: true });
  });

  it('does not flag an ordinary name that only one token holds', () => {
    const [meta] = spotMetaFixture as unknown as [HlSpotMeta, HlSpotAssetCtx[]];
    const holdings = normalizeSpotHoldings(
      (spotBalancesFixture as { balances: HlSpotBalance[] }).balances,
      buildSpotPriceIndex(meta, (spotMetaFixture as unknown as [HlSpotMeta, HlSpotAssetCtx[]])[1]),
      duplicateSpotTokenNames(meta),
    );
    expect(holdings.every((h) => !h.identityAmbiguous)).toBe(true);
  });
});

describe('normalizeTrades', () => {
  it('converts every raw fill into the domain Trade shape', () => {
    const trades = normalizeTrades(fillsFixture as HlFill[]);
    expect(trades.length).toBe((fillsFixture as HlFill[]).length);
    for (const t of trades) {
      expect(typeof t.crossed).toBe('boolean');
      expect(typeof t.closedPnlUsd).toBe('number');
    }
    const rawBuys = (fillsFixture as HlFill[]).filter((f) => f.side === 'B').length;
    expect(trades.filter((t) => t.side === 'buy').length).toBe(rawBuys);
    expect(trades.every((t) => t.side === 'buy' || t.side === 'sell')).toBe(true);
  });

  it('carries the fill direction, so a check can tell adding a position from reducing it', () => {
    const raw = fillsFixture as HlFill[];
    const trades = normalizeTrades(raw);
    raw.forEach((f, i) => expect(trades[i].dir).toBe(f.dir));
    expect(trades.some((t) => t.dir.startsWith('Open'))).toBe(true);
    expect(trades.some((t) => t.dir.startsWith('Close'))).toBe(true);
  });
});

describe('serviceStatusOf (whether a funding wallet is a shared service)', () => {
  it('reads no label as unverified, never as a private wallet', () => {
    // No label is the ordinary case. Reading "no label" as "a private wallet"
    // is what let a Binance address and a Gate deposit address into four
    // gallery cards as the checked trader's own hedge.
    expect(serviceStatusOf('0x' + 'a'.repeat(40), null)).toBe('unverified');
    expect(serviceStatusOf('0x' + 'a'.repeat(40), undefined)).toBe('unverified');
    expect(serviceStatusOf('0x' + 'a'.repeat(40), '  ')).toBe('unverified');
  });

  it('grades a label as service or not-service', () => {
    const wallet = '0x' + 'a'.repeat(40);
    expect(serviceStatusOf(wallet, 'Binance: Hot Wallet')).toBe('service');
    expect(serviceStatusOf(wallet, 'Arbitrum Bridge')).toBe('service');
    expect(serviceStatusOf(wallet, 'High Activity')).toBe('not-service');
    expect(serviceStatusOf(wallet, 'Token Millionaire')).toBe('not-service');
  });

  it('knows the exchange addresses behind the wrong gallery cards, label or no label', () => {
    // Binance 15 and a Gate deposit address. Between them they funded four of
    // the accounts the 18.09 gallery called a probable hedge.
    expect(serviceStatusOf('0x21a31ee1afc51d94c2efccaa2092ad1028285549', null)).toBe('service');
    expect(serviceStatusOf('0x0d0707963952f2fba59dd06f2b425ace40b492fe', null)).toBe('service');
    // A checksummed address is the same address; the registry is lower case.
    expect(serviceStatusOf('0x21A31Ee1afC51d94C2EFcCAa2092aD1028285549', null)).toBe('service');
  });
});

describe('normalizePortfolioPnl (Hyperliquid portfolio, 30 days)', () => {
  /** The month's own series, as Hyperliquid sent it, to compute the expected
   * figure from rather than writing a number down. */
  const monthOf = (fixture: { portfolio: unknown }): Array<[number, string]> =>
    (fixture.portfolio as Array<[string, { pnlHistory: Array<[number, string]> }]>).find(([period]) => period === 'perpMonth')![1].pnlHistory;
  const withMonth = (pnlHistory: unknown, period = 'perpMonth') => [
    ['perpDay', { accountValueHistory: [], pnlHistory: [[1, '0.0'], [2, '5.0']], vlm: '0.0' }],
    [period, { accountValueHistory: [], pnlHistory, vlm: '0.0' }],
  ];

  it('reads last minus first of perpMonth.pnlHistory, realized and unrealized', () => {
    const month = monthOf(portfolioAbraxas);
    const expected = Number(month[month.length - 1][1]) - Number(month[0][1]);
    const pnl = normalizePortfolioPnl(portfolioAbraxas.portfolio, 30);
    expect(pnl).toEqual({ basis: 'realized-and-unrealized', pnlUsd: expected, windowDays: 30 });
    // Abraxas made money over the window: the sign comes from the series.
    expect(expected).toBeGreaterThan(0);
  });

  it('reads a loss as a negative number', () => {
    const month = monthOf(portfolioHypeLong);
    const expected = Number(month[month.length - 1][1]) - Number(month[0][1]);
    const pnl = normalizePortfolioPnl(portfolioHypeLong.portfolio, 30);
    expect(pnl).toMatchObject({ basis: 'realized-and-unrealized', pnlUsd: expected, windowDays: 30 });
    expect(expected).toBeLessThan(0);
  });

  it('subtracts the first point, which is not always zero', () => {
    const pnl = normalizePortfolioPnl(withMonth([[1, '100.5'], [2, '250.25']]), 30);
    expect(pnl).toMatchObject({ pnlUsd: 149.75 });
  });

  it.each<[string, unknown]>([
    ['a list with no perpMonth', withMonth([[1, '0.0'], [2, '5.0']], 'month')],
    ['a one-point history', withMonth([[1, '0.0']])],
    ['an empty history', withMonth([])],
    ['a history that is not a list', withMonth('0.0')],
    ['a value that is not a number', withMonth([[1, '0.0'], [2, 'abc']])],
    ['an empty value', withMonth([[1, '0.0'], [2, '']])],
    ['a value that is not a string', withMonth([[1, '0.0'], [2, null]])],
    ['a timestamp that is not a number', withMonth([[1, '0.0'], ['soon', '5.0']])],
    ['a timestamp that is not finite', withMonth([[1, '0.0'], [Number.POSITIVE_INFINITY, '5.0']])],
    ['a point that is not a pair', withMonth([[1, '0.0'], 5])],
    ['a month entry that is not a pair', [['perpMonth']]],
    ['an empty list', []],
    ['an object', { perpMonth: { pnlHistory: [[1, '0.0'], [2, '5.0']] } }],
    ['null', null],
    ['a string', 'portfolio'],
  ])('rejects %s', (_what, raw) => {
    expect(() => normalizePortfolioPnl(raw, 30)).toThrow(UpstreamShapeError);
  });
});
