import { describe, expect, it } from 'vitest';
import clearinghouseFixture from '../fixtures/hyperliquid/clearinghouse-many-positions.json';
import openOrdersFixture from '../fixtures/hyperliquid/open-orders.json';
import spotBalancesFixture from '../fixtures/hyperliquid/spot-balances.json';
import spotMetaFixture from '../fixtures/hyperliquid/spot-meta.json';
import {
  normalizePositions,
  normalizeOrders,
  buildSpotPriceIndex,
  normalizeSpotHoldings,
} from '../../src/sources/normalize';
import type {
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotBalance,
  HlSpotMeta,
  HlSpotAssetCtx,
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
