import { describe, expect, it } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import fillsFixture from '../fixtures/hyperliquid/fills-24h.json';
import nansenPositionsFixture from '../fixtures/nansen/perp-positions-wintermute.json';
import funderEthBalancesFixture from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';
import relatedArbFixture from '../fixtures/nansen/related-wallets-abraxas-arbitrum.json';
import pnlFixture from '../fixtures/nansen/perp-pnl-summary-wintermute.json';
import {
  normalizePositions,
  normalizeOrders,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
  normalizeTrades,
  normalizeNansenPositions,
  normalizeNansenBalances,
  normalizeRelatedWallets,
  normalizeNansenPnl,
} from '../../src/sources/normalize';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
  HlFill,
} from '../../src/sources/hyperliquid';
import type {
  NansenPerpPositions,
  NansenBalance,
  NansenRelatedWallet,
  NansenPnlSummary,
} from '../../src/sources/nansen';

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
    const tokenNameByIndex = new Map(meta.tokens.map((t) => [t.index, t.name]));
    const distinctBaseNames = new Set(meta.universe.map((pair) => tokenNameByIndex.get(pair.tokens[0])));
    expect(prices.size).toBe(distinctBaseNames.size);
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
});

describe('normalizeTrades', () => {
  it('converts every raw fill into the domain Trade shape', () => {
    const trades = normalizeTrades(fillsFixture as HlFill[]);
    expect(trades.length).toBe((fillsFixture as HlFill[]).length);
    for (const t of trades) {
      expect(typeof t.crossed).toBe('boolean');
      expect(typeof t.closedPnlUsd).toBe('number');
    }
  });
});

describe('Nansen normalizers', () => {
  it('maps every Nansen position, including HIP-3 dexes, onto Position', () => {
    const positions = normalizeNansenPositions((nansenPositionsFixture as { data: NansenPerpPositions }).data);
    expect(positions.length).toBe(134);
    expect(positions.filter((p) => p.coin.includes(':')).length).toBe(48);
    const eth = positions.find((p) => p.coin === 'ETH');
    expect(eth?.side).toBe('short');
    expect(eth?.sizeUsd).toBeGreaterThan(0);
  });

  it('keeps chain on balances and drops zero-value rows', () => {
    const rows = (funderEthBalancesFixture as { data: NansenBalance[] }).data;
    const holdings = normalizeNansenBalances(rows);
    expect(holdings.every((h) => h.valueUsd > 0)).toBe(true);
    expect(holdings.find((h) => h.coin === 'AETHWETH')?.chain).toBe('ethereum');
  });

  it('flags links to shared services and never returns the label itself', () => {
    const fixtureRows = (relatedArbFixture as { data: NansenRelatedWallet[] }).data;
    const [first] = normalizeRelatedWallets(fixtureRows);
    expect(first.relation).toBe('First Funder');
    expect(first.isSharedService).toBe(false);
    expect(Object.keys(first)).not.toContain('address_label');

    const synthetic = (label: string | null): NansenRelatedWallet => ({
      ...fixtureRows[0],
      address_label: label,
    });
    expect(normalizeRelatedWallets([synthetic('Binance: Hot Wallet')])[0].isSharedService).toBe(true);
    expect(normalizeRelatedWallets([synthetic('Arbitrum Bridge')])[0].isSharedService).toBe(true);
    expect(normalizeRelatedWallets([synthetic('High Activity')])[0].isSharedService).toBe(false);
    expect(normalizeRelatedWallets([synthetic('Token Millionaire')])[0].isSharedService).toBe(false);
  });

  it('maps the PnL summary', () => {
    const pnl = normalizeNansenPnl((pnlFixture as { data: NansenPnlSummary }).data, 30);
    expect(pnl.realizedPnlUsd).toBeCloseTo(-13_625_651.41, 0);
    expect(pnl.winRate).toBeCloseTo(0.4663, 3);
    expect(pnl.closedTrades).toBe(2_423_158);
    expect(pnl.windowDays).toBe(30);
  });
});
