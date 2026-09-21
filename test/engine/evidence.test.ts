import { describe, expect, it } from 'vitest';
import { explain, formatUsd, formatPct, type EvidenceInput } from '../../src/engine/evidence';
import { EMPTY_HEDGE, EMPTY_ORDERS, type PositionFeatures } from '../../src/engine/features';

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
    headlineLiqDistanceBasis: null,
    sameAssetOffsetShare: 0,
    candidates: [],
    ...overrides,
  };
}

function input(overrides: Partial<EvidenceInput>): EvidenceInput {
  return {
    verdict: { verdict: 'unknown', strength: null, reasons: [] },
    positions: positions({}),
    orders: { ...EMPTY_ORDERS, restingOrders: 0, bidShare: 0.5, coinsBothSides: 0 },
    hedge: { ...EMPTY_HEDGE, hedgeUsd: 0, hedgeRatio: 0, unverifiedUsd: 0, lendingUsd: 0 },
    hedgeScope: 'all-chains',
    hedgeCoverage: 'complete',
    linkedHedge: null,
    trades: { tradesPerDay: 0, crossedShare: 0, buyShare: 0, sampleSize: 0, cappedByApiLimit: false, notionalUsd: 0, spanHours: 0, headlineFills: 0, headlineShareOfFills: 0 },
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
    expect(e.evidence[0]).toMatchObject({ label: 'Open positions', value: '0', source: 'Nansen' });
  });

  it('names every book signal that fired', () => {
    const e = explain(
      input({
        verdict: { verdict: 'book', strength: 'strong', reasons: ['orders', 'trades'] },
        positions: positions({ nPositions: 134, netToGross: 0.8, headlineShare: 0.3 }),
        orders: { ...EMPTY_ORDERS, restingOrders: 212, bidShare: 0.5, coinsBothSides: 31 },
        trades: {
          tradesPerDay: 2000, crossedShare: 0.24, buyShare: 0.53, sampleSize: 2000, cappedByApiLimit: true,
          notionalUsd: 180_000_000, spanHours: 23.6, headlineFills: 410, headlineShareOfFills: 0.205,
        },
      }),
    );
    expect(e.summary).toBe(
      '212 resting orders quote both sides of 31 markets; 2,000+ fills over 23.6 hours, 53% of them buys, 76% as maker.',
    );
    expect(e.evidence.map((i) => i.label)).toEqual([
      'Open positions',
      'Net / gross exposure',
      'Resting orders',
      'Fills, last 24h',
      'Realized PnL, 30d',
    ]);
    expect(e.evidence[2]).toMatchObject({ label: 'Resting orders', value: '212, two-sided in 31 markets', source: 'Hyperliquid' });
    expect(e.evidence[3].value).toBe('2,000+');
  });

  it('explains a book from position spread', () => {
    const e = explain(
      input({
        verdict: { verdict: 'book', strength: 'likely', reasons: ['positions'] },
        positions: positions({ nPositions: 40, netToGross: 0.09, headlineShare: 0.1 }),
      }),
    );
    expect(e.summary).toBe('40 open positions net out to 9.0% of gross exposure.');
  });

  it('explains a hedge held by the account itself', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['hedge_leg'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 60_000_000, hedgeRatio: 0.6, unverifiedUsd: 0, lendingUsd: 0 },
      }),
    );
    expect(e.summary).toBe('The $100.0M ETH short is 60% covered by $60.0M of spot ETH held by this address on Nansen-supported chains.');
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Hedge found', value: '60% (Nansen-supported chains)', source: 'Nansen' }));
  });

  it('calls busy maker flow what it is, without deciding the position', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['maker_flow_only'] },
        trades: {
          tradesPerDay: 2000, crossedShare: 0.24, buyShare: 0.53, sampleSize: 2000, cappedByApiLimit: false,
          notionalUsd: 180_000_000, spanHours: 23.6, headlineFills: 410, headlineShareOfFills: 0.205,
        },
      }),
    );
    expect(e.summary).toBe(
      '2,000 fills over 23.6 hours, 53% buys and 76% as maker, 21% of them in ETH. ' +
        'That is a busy account, but nothing here shows the $100.0M ETH short is inventory rather than a position.',
    );
  });

  it('explains a balanced book and how much of it really cancels', () => {
    const e = explain(
      input({
        verdict: { verdict: 'hedged', strength: null, reasons: ['balanced_book'] },
        positions: positions({ nPositions: 6, netToGross: 0.2, headlineShare: 0.3, sameAssetOffsetShare: 0.93 }),
      }),
    );
    expect(e.summary).toBe(
      '6 positions net out to 20% of gross exposure, and 93% of it cancels within the same assets.',
    );
  });

  it('says how much of a partly covered short is still short', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['partial_offset'] },
        positions: positions({ headlineCoin: 'HYPE', headlineNotionalUsd: 7_200_000 }),
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 4_270_000, hedgeRatio: 0.593, unverifiedUsd: 0, lendingUsd: 0 },
      }),
    );
    expect(e.summary).toBe(
      'The $7.2M HYPE short is 59% covered by spot HYPE held by this address on Nansen-supported chains, ' +
        'which leaves $2.9M of it short.',
    );
  });

  it('says an over-covered short leaves the account long, not neutral', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['over_covered'] },
        positions: positions({ headlineNotionalUsd: 15_400_000 }),
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 30_000_000, hedgeRatio: 1.948, unverifiedUsd: 0, lendingUsd: 0 },
      }),
    );
    expect(e.summary).toBe(
      'The $15.4M ETH short is more than covered: $30.0M of spot ETH held by this address on Nansen-supported chains ' +
        'leaves it net long $14.6M of ETH.',
    );
    expect(e.summary).not.toContain('neutral');
  });

  it('calls a dollar balance across different assets a portfolio, not a hedge', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['mixed_long_short_book'] },
        positions: positions({ nPositions: 2, netToGross: 0, headlineShare: 0.5, sameAssetOffsetShare: 0 }),
      }),
    );
    expect(e.summary).toBe(
      '2 positions net out to 0% of gross exposure, but the long and short legs are in different assets: ' +
        'a dollar balance across different assets is a portfolio, not a hedge.',
    );
  });

  it('names the part of a balanced book that really cancels', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['mixed_long_short_book'] },
        positions: positions({ nPositions: 5, netToGross: 0.12, headlineShare: 0.4, sameAssetOffsetShare: 0.35 }),
      }),
    );
    expect(e.summary).toBe(
      '5 positions net out to 12% of gross exposure, but only 35% of that exposure cancels within one asset: ' +
        'a dollar balance across different assets is a portfolio, not a hedge.',
    );
  });

  it('does not pass off an unmeasured offset as a measured zero', () => {
    const p = positions({ nPositions: 4, netToGross: 0.1, headlineShare: 0.3 });
    delete (p as { sameAssetOffsetShare?: number }).sameAssetOffsetShare;
    const e = explain(
      input({ verdict: { verdict: 'unknown', strength: null, reasons: ['offset_not_measured'] }, positions: p }),
    );
    expect(e.summary).toBe(
      '4 positions net out to 10% of gross exposure, but this snapshot did not record which assets the legs are in, ' +
        'so whether they offset each other was not established.',
    );
  });

  it('reports funding-wallet holdings as an unconfirmed link, never as a hedge', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['linked_exposure_unverified'] },
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
      'No ETH at this address offsets the $179.4M ETH short. 2 wallets that funded it hold $399.0M of ETH, ' +
        'but funding does not establish ownership, so it is not counted as a hedge.',
    );
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Linked wallets', value: '$399.0M ETH in 2 wallets, owner unconfirmed', source: 'Nansen' }));
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Hedge found', value: '0% (Nansen-supported chains)', source: 'Nansen' }));
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
    expect(e.summary).toBe('93% of the exposure is one $42.1M ZEC long. Spot cannot offset a long, and debts or other derivatives are not read here.');
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Realized PnL, 30d', value: '$7.7M', source: 'Nansen' }));
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
      '100% of the exposure is one $100.0M ETH short, and no ETH was found at this address on Nansen-supported chains. Debts and other derivatives are not read here.',
    );
  });

  it('measures a short bet against what the account holds, not against its funders', () => {
    const e = explain(
      input({
        verdict: { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'] },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 0, hedgeRatio: 0, unverifiedUsd: 0, lendingUsd: 0 },
        linkedHedge: {
          linkedHedgeUsd: 800_000,
          linkedHedgeRatio: 0.008,
          funders: [{ address: '0xaaa', relation: 'First Funder', chain: 'ethereum', matchingUsd: 800_000 }],
        },
      }),
    );
    expect(e.summary).toBe(
      '100% of the exposure is one $100.0M ETH short, and no ETH was found at this address on Nansen-supported chains. Debts and other derivatives are not read here.',
    );
    expect(e.summary).not.toContain('funded');
  });

  it('lists why an undecided account is not a clean bet', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['signals disagree: not enough evidence for book, hedge, or bet'] },
        positions: positions({ nPositions: 8, netToGross: 0.6, headlineShare: 0.4 }),
        orders: { ...EMPTY_ORDERS, restingOrders: 4, bidShare: 0.5, coinsBothSides: 2 },
        hedge: { ...EMPTY_HEDGE, hedgeUsd: 20_000_000, hedgeRatio: 0.2, unverifiedUsd: 0, lendingUsd: 0 },
      }),
    );
    expect(e.summary).toBe(
      'The $100.0M ETH short is not a book, not hedged, and not a clean bet: 8 positions, net 60% of gross, largest position 40% of exposure, 20% hedged, two-sided quotes in 2 markets.',
    );
  });

  it('counts only funding wallets holding at least 1% of the short', () => {
    const e = explain(
      input({
        verdict: { verdict: 'unknown', strength: null, reasons: ['signals disagree: not enough evidence for book, hedge, or bet'] },
        positions: positions({ nPositions: 15, headlineShare: 0.39, headlineNotionalUsd: 264_000_000 }),
        linkedHedge: {
          linkedHedgeUsd: 9_855_747,
          linkedHedgeRatio: 0.0373,
          funders: [
            { address: '0xaaa', relation: 'First Funder', chain: 'arbitrum', matchingUsd: 9_855_746 },
            { address: '0xbbb', relation: 'First Funder', chain: 'ethereum', matchingUsd: 1 },
          ],
        },
      }),
    );
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Linked wallets', value: '$9.9M ETH in 1 wallet, owner unconfirmed', source: 'Nansen' }));
  });

  it('says no trades were closed instead of a zero PnL', () => {
    const e = explain(input({ pnl: { realizedPnlUsd: 0, winRate: 0, closedTrades: 0, windowDays: 30 } }));
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Realized PnL, 30d', value: 'no closed trades', source: 'Nansen' }));
  });

  it('labels positions read from Hyperliquid when Nansen was not used', () => {
    const e = explain(input({ source: 'hyperliquid', pnl: null, hedgeScope: 'hyperliquid' }));
    expect(e.evidence[0]).toMatchObject({ label: 'Largest position', value: '$100.0M ETH short', source: 'Hyperliquid' });
    expect(e.evidence).toContainEqual(expect.objectContaining({ label: 'Hedge found', value: '0% (Hyperliquid spot)', source: 'Hyperliquid' }));
    expect(e.evidence.length).toBeLessThanOrEqual(5);
  });
});
