// A01, audit of 21.09: the asset behind a holding has to be established the
// same way at every step, and where it cannot be, that has to be a state of
// its own rather than a silent zero.
import { describe, expect, it } from 'vitest';
import { spotHedgesPerp, classifyHolding } from '../../src/engine/assets';
import { computeHedgeFeatures } from '../../src/engine/features';
import { normalizeNansenBalances, normalizeSpotHoldings, buildSpotPriceIndex } from '../../src/sources/normalize';
import type { NansenBalance } from '../../src/sources/nansen';
import type { HlSpotMeta, HlSpotAssetCtx, HlSpotBalance } from '../../src/sources/hyperliquid';
import type { SpotHolding } from '../../src/types';

const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

const onchain = (o: Partial<SpotHolding> & { coin: string; valueUsd: number }): SpotHolding => ({
  source: 'onchain',
  priced: true,
  chain: 'ethereum',
  ...o,
});

describe('the native-asset placeholder', () => {
  it('is read as ETH on Ethereum, not only on Arbitrum', () => {
    expect(spotHedgesPerp('ETH', 'ETH', { source: 'onchain', chain: 'ethereum', tokenAddress: NATIVE })).toBe(true);
    expect(spotHedgesPerp('ETH', 'ETH', { source: 'onchain', chain: 'arbitrum', tokenAddress: NATIVE })).toBe(true);
  });

  it('covers a short held against native ETH on Ethereum', () => {
    const hedge = computeHedgeFeatures('ETH', 'short', 1_000_000, [
      onchain({ coin: 'ETH', valueUsd: 1_000_000, tokenAddress: NATIVE }),
    ]);
    expect(hedge.hedgeUsd).toBe(1_000_000);
    expect(hedge.unverifiedUsd).toBe(0);
  });
});

describe('where a holding came from is stated, not guessed', () => {
  it('does not accept an on-chain row with no contract as a Hyperliquid ticker', () => {
    // The old rule was "no address, so this must be Hyperliquid spot", and a
    // malformed Nansen row took that branch and was counted by name.
    expect(spotHedgesPerp('WETH', 'ETH', { source: 'onchain', chain: 'ethereum' })).toBe(false);
    const hedge = computeHedgeFeatures('ETH', 'short', 1_000_000, [
      onchain({ coin: 'WETH', valueUsd: 1_000_000, tokenAddress: undefined }),
    ]);
    expect(hedge.hedgeRatio).toBe(0);
    expect(hedge.unverifiedUsd).toBe(1_000_000);
  });

  it('tags every normalized Nansen balance as on-chain, contract or not', () => {
    const rows = [
      { chain: 'ethereum', token_address: WETH, token_symbol: 'WETH', value_usd: 10 },
      { chain: 'ethereum', token_symbol: 'WETH', value_usd: 20 },
    ] as NansenBalance[];
    const holdings = normalizeNansenBalances(rows);
    expect(holdings.map((h) => h.source)).toEqual(['onchain', 'onchain']);
    expect(holdings[1].tokenAddress).toBeUndefined();
  });

  it('tags Hyperliquid spot balances as its own namespace', () => {
    const meta: HlSpotMeta = { tokens: [{ name: 'USDC', index: 0 }, { name: 'UBTC', index: 1 }], universe: [{ name: '@1', tokens: [1, 0] }] };
    const ctxs = [{ coin: '@1', markPx: '100000' }] as HlSpotAssetCtx[];
    const balances = [{ coin: 'UBTC', token: 1, total: '1', hold: '0', entryNtl: '0' }] as HlSpotBalance[];
    const [h] = normalizeSpotHoldings(balances, buildSpotPriceIndex(meta, ctxs));
    expect(h.source).toBe('hyperliquid-spot');
    expect(h.valueUsd).toBe(100_000);
  });
});

describe('a Hyperliquid spot price belongs to a token, not to a name', () => {
  // Spot names are not unique - the official SDK says so - and the old index
  // was keyed by name, so a $1 token priced itself off a $100 namesake.
  const meta: HlSpotMeta = {
    tokens: [{ name: 'USDC', index: 0 }, { name: 'HYPE', index: 1 }, { name: 'HYPE', index: 2 }],
    universe: [{ name: '@1', tokens: [1, 0] }, { name: '@2', tokens: [2, 0] }],
  };
  const ctxs = [{ coin: '@1', markPx: '100' }, { coin: '@2', markPx: '1' }] as HlSpotAssetCtx[];

  it('prices each token index from its own pair', () => {
    const prices = buildSpotPriceIndex(meta, ctxs);
    expect(prices.get(1)).toBe(100);
    expect(prices.get(2)).toBe(1);
  });

  it('values a balance of the cheaper namesake at its own price', () => {
    const balances = [{ coin: 'HYPE', token: 2, total: '10000', hold: '0', entryNtl: '0' }] as HlSpotBalance[];
    const [h] = normalizeSpotHoldings(balances, buildSpotPriceIndex(meta, ctxs));
    expect(h.valueUsd).toBe(10_000);
  });
});

describe('a balance with no price is not a zero balance', () => {
  it('keeps the holding and marks it unpriced', () => {
    const meta: HlSpotMeta = { tokens: [{ name: 'UETH', index: 1 }], universe: [] };
    const balances = [{ coin: 'UETH', token: 1, total: '100', hold: '0', entryNtl: '0' }] as HlSpotBalance[];
    const [h] = normalizeSpotHoldings(balances, buildSpotPriceIndex(meta, []));
    expect(h).toBeDefined();
    expect(h.priced).toBe(false);
    expect(h.valueUsd).toBe(0);
  });

  it('counts an unpriced match as a gap in the hedge reading', () => {
    const hedge = computeHedgeFeatures('ETH', 'short', 1_000_000, [
      { coin: 'UETH', valueUsd: 0, priced: false, source: 'hyperliquid-spot' },
    ]);
    expect(hedge.hedgeUsd).toBe(0);
    expect(hedge.unpricedMatches).toBe(1);
  });
});

describe('what the registry does not cover is named, not counted as absent', () => {
  it('separates an unknown contract from a chain the registry does not cover', () => {
    expect(classifyHolding({ coin: 'WETH', priced: true, source: 'onchain', chain: 'ethereum', tokenAddress: '0x' + 'de'.repeat(20) }, 'ETH')).toBe('unknown-contract');
    expect(classifyHolding({ coin: 'WETH', priced: true, source: 'onchain', chain: 'base', tokenAddress: WETH }, 'ETH')).toBe('unsupported-chain');
    expect(classifyHolding({ coin: 'USDC', priced: true, source: 'onchain', chain: 'ethereum', tokenAddress: '0x' + 'ab'.repeat(20) }, 'ETH')).toBe('unrelated');
    // The contract is the asset, whatever the row calls it: a row labelled
    // USDC that carries the WETH contract is WETH.
    expect(classifyHolding({ coin: 'USDC', priced: true, source: 'onchain', chain: 'ethereum', tokenAddress: WETH }, 'ETH')).toBe('match');
    expect(classifyHolding({ coin: 'WETH', priced: true, source: 'onchain', chain: 'ethereum', tokenAddress: WETH }, 'ETH')).toBe('match');
  });

  it('reports both kinds of gap as unverified dollars', () => {
    const hedge = computeHedgeFeatures('ETH', 'short', 1_000_000, [
      onchain({ coin: 'WETH', valueUsd: 300_000, tokenAddress: '0x' + 'de'.repeat(20) }),
      onchain({ coin: 'WETH', valueUsd: 200_000, chain: 'base', tokenAddress: WETH }),
    ]);
    expect(hedge.unverifiedUsd).toBe(500_000);
    expect(hedge.unverifiedOnUnsupportedChainUsd).toBe(200_000);
  });
});
