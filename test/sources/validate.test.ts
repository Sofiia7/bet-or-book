// 23.09 audit, "structure and range checks": what an upstream answer has to
// look like before any of it is used - held to the real answers it was
// calibrated on, and to the ways a broken one can be broken.
import { describe, expect, it } from 'vitest';
import {
  checkFills,
  checkNansenBalances,
  checkOrders,
  checkPerpMeta,
  checkRelatedWallets,
  checkSpotBalances,
  checkSpotMeta,
} from '../../src/sources/validate';
import { UpstreamShapeError } from '../../src/sources/normalize';
import orders from '../fixtures/hyperliquid/open-orders.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import spot from '../fixtures/hyperliquid/spot-balances.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import marginSpot from '../fixtures/hyperliquid/spot-balances-portfolio-margin.json';
import fills from '../fixtures/hyperliquid/fills-24h.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxBalances from '../fixtures/nansen/current-balance-abraxas-all.json';
import funderBalances from '../fixtures/nansen/current-balance-abraxas-funder-all.json';
import funderEthBalances from '../fixtures/nansen/current-balance-abraxas-funder-eth-all.json';
import relArb from '../fixtures/nansen/related-wallets-abraxas-arbitrum.json';
import relEth from '../fixtures/nansen/related-wallets-abraxas-ethereum.json';

describe('real answers', () => {
  it('pass whole: not one recorded row is refused', () => {
    for (const raw of [orders, abxOrders]) expect(checkOrders(raw).malformed).toBe(0);
    for (const raw of [spot, abxSpot, marginSpot]) expect(checkSpotBalances(raw).malformed).toBe(0);
    for (const raw of [fills, abxFills]) expect(checkFills(raw).malformed).toBe(0);
    for (const raw of [abxBalances, funderBalances, funderEthBalances]) {
      expect(checkNansenBalances(raw.data).malformed).toBe(0);
    }
    for (const raw of [relArb, relEth]) expect(checkRelatedWallets(raw.data).malformed).toBe(0);
    expect(checkSpotMeta(spotMeta).malformed).toBe(0);
    expect(() => checkPerpMeta(perpMeta)).not.toThrow();
  });

  it('keep every row they had', () => {
    expect(checkOrders(orders).rows).toHaveLength(orders.length);
    expect(checkFills(fills).rows).toHaveLength(fills.length);
    const meta = checkSpotMeta(spotMeta).meta;
    expect(meta[0].tokens).toHaveLength((spotMeta[0] as { tokens: unknown[] }).tokens.length);
    expect(meta[1]).toHaveLength((spotMeta[1] as unknown[]).length);
  });

  it('take a loan for what it is: portfolio margin, recorded live on 24.09', () => {
    // A negative total with a borrowed amount, a negative hold, supplied
    // collateral with its loan-to-value: all real, none of it broken.
    const read = checkSpotBalances(marginSpot);
    expect(read.malformed).toBe(0);
    expect(read.rows.find((b) => b.coin === 'USDC')).toMatchObject({ total: '-9573815.1387989298', borrowed: '17967395.4998109415' });
    expect(read.rows.find((b) => b.coin === 'HYPE')).toMatchObject({ supplied: '443316.24181068', ltv: '0.65' });
  });
});

describe('a broken row', () => {
  const order = { coin: 'ETH', side: 'B', limitPx: '2500.5', sz: '1.2', oid: 1, timestamp: 1, isTrigger: false };
  const fill = { coin: 'ETH', side: 'A', px: '2500', sz: '0.5', time: 1_758_000_000_000, crossed: true, dir: 'Open Short', closedPnl: '0' };

  it('is left out and counted, and the rest are kept', () => {
    const read = checkOrders([
      order,
      { ...order, sz: 'abc' },
      { ...order, side: 'X' },
      { ...order, limitPx: '0' },
      { ...order, coin: '' },
      null,
      'order',
    ]);
    expect(read.rows).toEqual([order]);
    expect(read.malformed).toBe(6);
  });

  it('does not include a trigger order resting at no price yet', () => {
    const trigger = { coin: 'ETH', isTrigger: true, triggerPx: '2000', limitPx: '0', sz: '0', side: 'A' };
    expect(checkOrders([trigger]).malformed).toBe(0);
  });

  it('is any fill missing what the trading figures are made of', () => {
    const read = checkFills([
      fill,
      { ...fill, crossed: 'yes' },
      { ...fill, px: '-1' },
      { ...fill, time: 'soon' },
      { ...fill, closedPnl: '' },
      { ...fill, dir: undefined },
    ]);
    expect(read.rows).toEqual([fill]);
    expect(read.malformed).toBe(5);
  });

  it('is a spot balance with no number in it, or a loan-to-value above one', () => {
    const ok = { coin: 'HYPE', token: 150, total: '10', hold: '0' };
    const read = checkSpotBalances({
      balances: [
        ok,
        { ...ok, total: 'NaN' },
        { ...ok, token: -1 },
        { ...ok, borrowed: '-5' },
        { ...ok, ltv: '1.5' },
        { ...ok, coin: 7 },
      ],
    });
    expect(read.rows).toEqual([ok]);
    expect(read.malformed).toBe(5);
  });

  it('is a Nansen balance below zero, or with no chain', () => {
    const ok = { chain: 'ethereum', token_symbol: 'WETH', token_amount: 1, value_usd: 2500 };
    const unpriced = { ...ok, value_usd: null };
    const read = checkNansenBalances([ok, unpriced, { ...ok, token_amount: -1 }, { ...ok, value_usd: -3 }, { ...ok, chain: '' }]);
    expect(read.rows).toEqual([ok, unpriced]);
    expect(read.malformed).toBe(3);
  });

  it('is a funding link to something that is not an address, or at a time that is not one', () => {
    const ok = { address: '0xb38e8c17e38363af6ebdcb3dae12e0243582891d', relation: 'First Funder', chain: 'arbitrum', block_timestamp: '2024-01-01T00:00:00' };
    const read = checkRelatedWallets([ok, { ...ok, address: '0x123' }, { ...ok, block_timestamp: 'yesterday' }, { ...ok, relation: '' }]);
    expect(read.rows).toEqual([ok]);
    expect(read.malformed).toBe(3);
  });

  it('in spot metadata leaves that token unpriced rather than priced as another', () => {
    const [meta, contexts] = spotMeta as [{ tokens: unknown[]; universe: unknown[] }, unknown[]];
    const read = checkSpotMeta([{ ...meta, tokens: [...meta.tokens, { name: 'BAD', index: 'x' }], universe: [...meta.universe, { name: '@x', tokens: [1] }] }, contexts]);
    expect(read.malformed).toBe(2);
    expect(read.meta[0].tokens).toHaveLength(meta.tokens.length);
  });
});

describe('a broken envelope', () => {
  it('is not read at all: it fails the way a failed request does', () => {
    const shape = (fn: () => unknown) => expect(fn).toThrow(UpstreamShapeError);
    shape(() => checkOrders({ orders: [] }));
    shape(() => checkFills('rate limited'));
    shape(() => checkSpotBalances(null));
    shape(() => checkSpotBalances({ balances: {} }));
    shape(() => checkSpotMeta([{ tokens: [], universe: [] }]));
    shape(() => checkPerpMeta([{}, []]));
    shape(() => checkNansenBalances(undefined));
    shape(() => checkRelatedWallets({}));
  });
});
