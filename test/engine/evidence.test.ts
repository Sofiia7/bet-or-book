import { describe, expect, it } from 'vitest';
import { explain, formatUsd, formatPct, type EvidenceInput } from '../../src/engine/evidence';
import type { PositionFeatures } from '../../src/engine/features';

function positions(overrides: Partial<PositionFeatures>): PositionFeatures {
  return {
    nPositions: 1,
    grossUsd: 100_000_000,
    netUsd: 100_000_000,
    netToGross: 1,
    headlineCoin: 'ETH',
    headlineSide: 'short',
    headlineNotionalUsd: 100_000_000,
    headlineShare: 1,
    headlineLiqDistancePct: null,
    ...overrides,
  };
}

function input(overrides: Partial<EvidenceInput>): EvidenceInput {
  return {
    verdict: { verdict: 'unknown', strength: null, reasons: [] },
    positions: positions({}),
    orders: { restingOrders: 0, bidShare: 0.5, coinsBothSides: 0 },
    hedge: { hedgeUsd: 0, hedgeRatio: 0 },
    hedgeScope: 'all-chains',
    linkedHedge: null,
    trades: { tradesPerDay: 0, crossedShare: 0, sampleSize: 0, cappedByApiLimit: false },
    pnl: { realizedPnlUsd: -15_512_000, winRate: 0.41, closedTrades: 120, windowDays: 30 },
    sizeVsOi: 0.032,
    source: 'nansen',
    ...overrides,
  };
}

describe('formatUsd', () => {
  it('scales to K, M and B with a sign', () => {
    expect(formatUsd(179_412_345)).toBe('$179.4M');
    expect(formatUsd(-15_512_000)).toBe('-$15.5M');
    expect(formatUsd(950_000)).toBe('$950K');
    expect(formatUsd(1_234_000_000)).toBe('$1.2B');
    expect(formatUsd(830)).toBe('$830');
    expect(formatUsd(999_600)).toBe('$1.0M');
    expect(formatUsd(-0.2)).toBe('$0');
  });
});

describe('formatPct', () => {
  it('drops decimals at or above 10% and keeps one below', () => {
    expect(formatPct(2.2217)).toBe('222%');
    expect(formatPct(0.8)).toBe('80%');
    expect(formatPct(0.0916)).toBe('9.2%');
    expect(formatPct(0)).toBe('0%');
  });
});

describe('explain', () => {
  it('says there is nothing to classify when there are no positions', () => {
    const e = explain(input({ positions: positions({ nPositions: 0, headlineCoin: null, headlineSide: null, headlineNotionalUsd: 0 }), verdict: { verdict: 'unknown', strength: null, reasons: ['no open positions found'] } }));
    expect(e.summary).toBe('No open positions right now, so there is nothing to classify.');
    expect(e.evidence[0]).toEqual({ label: 'Open positions', value: '0', source: 'Nansen' });
  });

  it('names every book signal that fired', () => {
    const e = explain(
      input({
        verdict: { verdict: 'book', strength: 'strong', reasons: ['orders', 'trades'] },
        positions: positions({ nPositions: 134, netToGross: 0.8, headlineShare: 0.3 }),
        orders: { restingOrders: 212, bidShare: 0.5, coinsBothSides: 31 },
        trades: { tradesPerDay: 2000, crossedShare: 0.24, sampleSize: 2000, cappedByApiLimit: true },
      }),
    );
    expect(e.summary).toBe(
      '212 resting orders quote both sides of 31 markets; 2,000+ fills in the last 24 hours, 76% of them as maker. There is nothing to copy.',
    );
    expect(e.evidence.map((i) => i.label)).toEqual([
      'Open positions',
      'Net / gross exposure',
      'Resting orders',
      'Fills, last 24h',
      'Realized PnL, 30d',
    ]);
    expect(e.evidence[2]).toEqual({ label: 'Resting orders', value: '212, two-sided in 31 markets', source: 'Hyperliquid' });
    expect(e.evidence[3].value).toBe('2,000+');
  });

  it('explains a book from position spread', () => {
    const e = explain(
      input({
        verdict: { verdict: 'book', strength: 'likely', reasons: ['positions'] },
        positions: positions({ nPositions: 40, netToGross: 0.09, headlineShare: 0.1 }),
      }),
    );
    expect(e.summary).toBe('40 open positions net out to 9.0% of gross exposure. There is nothing to copy.');
  });

  it('explains a hedge held by the account itself', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { hedgeUsd: 60_000_000, hedgeRatio: 0.6 },
      }),
    );
    expect(e.summary).toBe('The $100.0M ETH short is 60% covered by spot ETH held by the same account across chains.');
    expect(e.evidence).toContainEqual({ label: 'Hedge found', value: '60% (all chains)', source: 'Nansen' });
  });

  it('explains a balanced book', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['balanced_book'] },
        positions: positions({ nPositions: 6, netToGross: 0.2, headlineShare: 0.3 }),
      }),
    );
    expect(e.summary).toBe('6 positions net out to 20% of gross exposure: the longs and shorts offset each other.');
  });

  it('explains a probable hedge through funding wallets and says ownership is inferred', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: 'probable', reasons: ['linked_wallet_hedge'] },
        positions: positions({ nPositions: 17, netToGross: 0.62, headlineShare: 0.7, headlineNotionalUsd: 179_400_000 }),
        linkedHedge: {
          linkedHedgeUsd: 399_000_000,
          linkedHedgeRatio: 2.224,
          funders: [
            { address: '0xb38e', relation: 'First Funder', chain: 'arbitrum', matchingUsd: 31_400_000 },
            { address: '0xed0c', relation: 'First Funder', chain: 'ethereum', matchingUsd: 367_600_000 },
          ],
        },
      }),
    );
    expect(e.summary).toBe(
      'The $179.4M ETH short is 222% covered by ETH held in 2 wallets that funded this account. Ownership is inferred from the funding link, not confirmed.',
    );
    expect(e.evidence).toContainEqual({ label: 'Hedge found', value: '222% via 2 funding wallets', source: 'Nansen' });
  });

  it('explains a long bet', () => {
    const e = explain(
      input({
        verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] },
        positions: positions({ headlineCoin: 'ZEC', headlineSide: 'long', headlineShare: 0.93, headlineNotionalUsd: 42_100_000 }),
        hedgeScope: 'none',
        pnl: { realizedPnlUsd: 7_700_000, winRate: 0.598, closedTrades: 80, windowDays: 30 },
      }),
    );
    expect(e.summary).toBe('93% of the exposure is one $42.1M ZEC long, and nothing in this account offsets it.');
    expect(e.evidence).toContainEqual({ label: 'Realized PnL, 30d', value: '$7.7M', source: 'Nansen' });
    expect(e.evidence.some((i) => i.label === 'Hedge found')).toBe(false);
  });

  it('explains a short bet and names where it looked', () => {
    const e = explain(
      input({
        verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] },
        linkedHedge: { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] },
      }),
    );
    expect(e.summary).toBe(
      '100% of the exposure is one $100.0M ETH short, and no ETH was found in this account or the wallets that funded it.',
    );
  });

  it('lists why an undecided account is not a clean bet', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['signals disagree: not enough evidence for book, hedge, or bet'] },
        positions: positions({ nPositions: 8, netToGross: 0.6, headlineShare: 0.4 }),
        orders: { restingOrders: 4, bidShare: 0.5, coinsBothSides: 2 },
        hedge: { hedgeUsd: 20_000_000, hedgeRatio: 0.2 },
      }),
    );
    expect(e.summary).toBe(
      'Not a book, not hedged, and not a clean bet: 8 positions, net 60% of gross, largest position 40% of exposure, 20% hedged, two-sided quotes in 2 markets.',
    );
  });

  it('labels positions read from Hyperliquid when Nansen was not used', () => {
    const e = explain(input({ source: 'hyperliquid', pnl: null, hedgeScope: 'hyperliquid' }));
    expect(e.evidence[0]).toEqual({ label: 'Largest position', value: '$100.0M ETH short', source: 'Hyperliquid' });
    expect(e.evidence).toContainEqual({ label: 'Hedge found', value: '0% (Hyperliquid spot)', source: 'Hyperliquid' });
    expect(e.evidence.length).toBeLessThanOrEqual(5);
  });
});
