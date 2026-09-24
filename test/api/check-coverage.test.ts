// A04, audit of 21.09: a source that failed, answered about part of the
// account, or was never asked has to reach the classifier as such. A caveat
// at the foot of the card is not a dependency.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import type { NansenClient, NansenPerpPositions, NansenBalance, NansenRelatedWallet, NansenPnlSummary } from '../../src/sources/nansen';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const EMPTY_HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: {
    assetPositions: [
      {
        position: {
          coin: 'ETH',
          szi: '1',
          positionValue: '1000000',
          entryPx: '100',
          leverage: { value: 5 },
          liquidationPx: null,
          unrealizedPnl: '0',
          cumFunding: { sinceOpen: '0' },
        },
      },
    ],
    time: Date.now(),
  },
};

/** Routes Hyperliquid to empty answers; `failHip3Orders` makes the per-dex
 * order read answer 503 the way a real HIP-3 outage would. */
function route(opts: { failHip3Orders?: boolean } = {}) {
  global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (body.type === 'frontendOpenOrders' && body.dex && opts.failHip3Orders) {
      return new Response('{}', { status: 503 });
    }
    if (!(body.type in EMPTY_HL)) throw new Error(`unrouted ${body.type}`);
    return new Response(JSON.stringify(EMPTY_HL[body.type]), { status: 200 });
  }) as unknown as typeof fetch;
}

function nansenWith(coin: string, side: 'long' | 'short', opts: { measuredAt?: number } = {}): NansenClient {
  return {
    perpPositions: async () =>
      ({
        asset_positions: [
          {
            position: {
              token_symbol: coin,
              size: side === 'long' ? '1' : '-1',
              position_value_usd: '1000000',
              entry_price_usd: '100',
              liquidation_price_usd: null,
              leverage_value: 5,
              unrealized_pnl_usd: '0',
              cumulative_funding_since_open_usd: '0',
            },
          },
        ],
        timestamp: opts.measuredAt ?? Date.now(),
      }) as unknown as NansenPerpPositions,
    perpPnlSummary: async () => ({ realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 }) as NansenPnlSummary,
    currentBalance: async () => ({ rows: [] as NansenBalance[], complete: true }),
    relatedWallets: async () => ({ rows: [] as NansenRelatedWallet[], complete: true }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('a failed HIP-3 order read reaches the rule that needs it', () => {
  it('does not call a HIP-3 long a clean bet when its dex would not answer', async () => {
    route({ failHip3Orders: true });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('xyz:ETH', 'long') });
    expect(result.ordersCoverage).toBe('partial');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('quotes_not_checked');
    expect(result.degraded).toBe(true);
  });

  it('answers as usual when that dex did answer', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('xyz:ETH', 'long') });
    expect(result.ordersCoverage).toBe('complete');
    expect(result.verdict.verdict).toBe('looks_like_a_bet');
  });

  it('says quiet venues were the ones checked, not every venue there is (23.09 audit, L06)', async () => {
    // A dex the account only quotes on, with no position there, is never
    // asked: "complete" is about the venues read, and the card has to say
    // so exactly when that silence is about to count as "quotes nothing".
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long') });
    expect(result.ordersCoverage).toBe('complete');
    expect(result.coverage.join(' ')).toContain('No two-sided quoting found on the venues checked');
    expect(result.coverage.join(' ')).toContain('A dex it only quotes, with no position of its own, would not appear here');
  });

  it('says nothing about quiet venues when one of them would not answer, since then nothing is claimed', async () => {
    route({ failHip3Orders: true });
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('xyz:ETH', 'long') });
    expect(result.coverage.join(' ')).not.toContain('No two-sided quoting found on the venues checked');
  });
});

describe('a reading that is old, or was never taken, says so', () => {
  it('marks an hour-old position reading as degraded', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long', { measuredAt: Date.now() - 3_600_000 }) });
    expect(result.degraded).toBe(true);
    expect(result.coverage.join(' ')).toContain('before this check');
  });

  it('marks a check that never reached Nansen as degraded', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: null, nansenOffReason: 'budget exhausted' });
    expect(result.degraded).toBe(true);
  });

  it('will not call a Hyperliquid-only reading a whole portfolio', async () => {
    route();
    // clearinghouseState answers for the main perp dex only, so a HIP-3 leg
    // of the same account is invisible and concentration cannot be claimed.
    const result = await checkAddress(ADDRESS, { nansen: null, nansenOffReason: 'no API key configured' });
    expect(result.positionsCoverage).toBe('partial');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('positions_not_complete');
  });
});

describe('R04: the deadline covers the whole check, not some of its stages', () => {
  it('starts no paid stage at all once the time is gone', async () => {
    route();
    const nansen = nansenWith('ETH', 'short');
    const spy = { positions: 0, pnl: 0 };
    const counted: NansenClient = {
      perpPositions: async (a) => {
        spy.positions++;
        return nansen.perpPositions(a);
      },
      perpPnlSummary: async (...args) => {
        spy.pnl++;
        return nansen.perpPnlSummary(...args);
      },
      currentBalance: nansen.currentBalance,
      relatedWallets: nansen.relatedWallets,
    };
    const result = await checkAddress(ADDRESS, { nansen: counted, deadline: Date.now() - 1 });
    expect(spy).toEqual({ positions: 0, pnl: 0 });
    expect(result.coverage.join(' ')).toContain('ran out of time');
    expect(result.degraded).toBe(true);
  });

  it('measures the deadline on the clock it was given', async () => {
    route();
    // An injected clock and a direct Date.now() used to be mixed, which made
    // any test of the time budget depend on how long the test itself took.
    const frozen = Date.parse('2026-09-21T12:00:00Z');
    const result = await checkAddress(ADDRESS, { nansen: nansenWith('ETH', 'long'), now: () => frozen });
    expect(result.checkedAt).toBe(new Date(frozen).toISOString());
  });
});

describe('L02a (22.09 audit): a long\'s own funding history is context a hedge search cannot reach', () => {
  const funderRow = (over: Partial<NansenRelatedWallet> = {}): NansenRelatedWallet => ({
    address: '0xfffffffffffffffffffffffffffffffffffffff1',
    address_label: null,
    relation: 'First Funder',
    transaction_hash: '0xabc',
    block_timestamp: '2026-09-13T12:00:00Z', // 8 days before the frozen clock below
    order: 1,
    chain: 'ethereum',
    ...over,
  });
  const frozen = Date.parse('2026-09-21T12:00:00Z');
  const withFunder = (rows: NansenRelatedWallet[]): NansenClient => ({
    ...nansenWith('HYPE', 'long'),
    relatedWallets: async (_addr, chain) => ({ rows: chain === 'ethereum' ? rows : [], complete: true }),
  });

  it('names when a lone long position was first funded, and by what kind of wallet', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: withFunder([funderRow()]), now: () => frozen });
    expect(result.vitals).toContainEqual(
      expect.objectContaining({
        label: 'Earliest funding found',
        source: 'Nansen',
        value: expect.stringContaining('8 days ago on ethereum'),
      }),
    );
  });

  it('names an exchange or bridge funder as what it is', async () => {
    route();
    const result = await checkAddress(ADDRESS, {
      nansen: withFunder([funderRow({ address_label: 'Binance: Hot Wallet' })]),
      now: () => frozen,
    });
    expect(result.vitals.find((v) => v.label === 'Earliest funding found')?.value).toContain('an exchange or bridge');
  });

  it('says which chain could not be read, rather than staying silent about the gap (23.09 audit, L09)', async () => {
    route();
    // Ethereum answers with a record; Arbitrum fails outright. The old label
    // "First funded" would have read as the account's age regardless.
    const partial: NansenClient = {
      ...nansenWith('HYPE', 'long'),
      relatedWallets: async (_addr, chain) => {
        if (chain === 'ethereum') return { rows: [funderRow()], complete: true };
        throw new Error('arbitrum unavailable');
      },
    };
    const result = await checkAddress(ADDRESS, { nansen: partial, now: () => frozen });
    const item = result.vitals.find((v) => v.label === 'Earliest funding found');
    expect(item?.value).toBe('8 days ago on ethereum, arbitrum not read, by an unlabelled wallet');
  });

  it('does not read funding history for a short: the hedge search already covers that ground', async () => {
    route();
    const shortWithFunder: NansenClient = {
      ...nansenWith('HYPE', 'short'),
      relatedWallets: async (_addr, chain) => ({ rows: chain === 'ethereum' ? [funderRow()] : [], complete: true }),
    };
    const result = await checkAddress(ADDRESS, { nansen: shortWithFunder, now: () => frozen });
    expect(result.vitals.some((v) => v.label === 'Earliest funding found')).toBe(false);
  });

  it('says nothing when there is no funding link to read', async () => {
    route();
    const result = await checkAddress(ADDRESS, { nansen: withFunder([]), now: () => frozen });
    expect(result.vitals.some((v) => v.label === 'Earliest funding found')).toBe(false);
  });
});
