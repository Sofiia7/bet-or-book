// R01 and R02, audit of 21.09: an answer of the wrong shape has to be
// caught where it arrives, an optional source may not fail the whole check,
// and a link may not be handed out for a reading that was never saved.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeNansenPnl, UpstreamShapeError } from '../src/sources/normalize';
import { snapshotId, isSnapshotId } from '../src/snapshot';
import { safeKv } from '../src/safeKv';
import { checkAddress } from '../src/api/check';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import type { NansenPnlSummary, NansenClient, NansenPerpPositions, NansenBalance, NansenRelatedWallet } from '../src/sources/nansen';
import type { KVLike } from '../src/kv';

describe('R01: a body of the wrong shape is rejected, not rendered', () => {
  it('refuses an empty PnL body instead of putting $NaN on the card', () => {
    expect(() => normalizeNansenPnl({} as unknown as NansenPnlSummary, 30)).toThrow(UpstreamShapeError);
  });

  it('accepts a real one', () => {
    const pnl = normalizeNansenPnl(
      { realized_pnl_usd: -1200.5, win_rate: 0.41, closed_trade_count: 17 } as NansenPnlSummary,
      30,
    );
    expect(pnl).toEqual({ realizedPnlUsd: -1200.5, winRate: 0.41, closedTrades: 17, windowDays: 30 });
  });
});

const ADDRESS = '0x1111111111111111111111111111111111111111';
const FUNDER = '0x2222222222222222222222222222222222222222';

const HL: Record<string, unknown> = {
  frontendOpenOrders: [],
  spotClearinghouseState: { balances: [] },
  spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
  userFillsByTime: [],
  metaAndAssetCtxs: [{ universe: [] }, []],
  clearinghouseState: { assetPositions: [], time: Date.now() },
};

function routeHl() {
  global.fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

function nansen(opts: { funderRows?: unknown; funderComplete?: boolean }): NansenClient {
  return {
    perpPositions: async () =>
      ({
        asset_positions: [
          {
            position: {
              token_symbol: 'ETH', size: '-1', position_value_usd: '1000000', entry_price_usd: '100',
              liquidation_price_usd: null, leverage_value: 5, unrealized_pnl_usd: '0',
              cumulative_funding_since_open_usd: '0',
            },
          },
        ],
        timestamp: Date.now(),
      }) as unknown as NansenPerpPositions,
    perpPnlSummary: async () => ({ realized_pnl_usd: 0, win_rate: 0, closed_trade_count: 0 }) as NansenPnlSummary,
    currentBalance: async (a: string) =>
      a === ADDRESS
        ? { rows: [] as NansenBalance[], complete: true }
        : { rows: opts.funderRows as NansenBalance[], complete: opts.funderComplete ?? true },
    relatedWallets: async (_a: string, chain: string) => ({
      rows: [{ address: FUNDER, relation: 'First Funder', chain, address_label: null }] as NansenRelatedWallet[],
      complete: true,
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('R01: an extra source that answers badly does not lose the answer', () => {
  it('keeps the check when a funder balance comes back malformed', async () => {
    routeHl();
    const result = await checkAddress(ADDRESS, { nansen: nansen({ funderRows: null }) });
    expect(result.verdict).toBeDefined();
    expect(result.coverage.join(' ')).toContain('unexpected shape');
    expect(result.degraded).toBe(true);
  });

  it('says so when a funder balance was only the first page', async () => {
    routeHl();
    const result = await checkAddress(ADDRESS, {
      nansen: nansen({ funderRows: [], funderComplete: false }),
    });
    expect(result.coverage.join(' ')).toMatch(/funding wallet.*first 100|first 100 tokens/i);
    expect(result.degraded).toBe(true);
  });
});

describe('R02: an id identifies one reading', () => {
  it('does not give two addresses sharing eight characters the same id', () => {
    const a = snapshotId('0x12345678' + '1'.repeat(32), '2026-09-21T12:00:00.000Z');
    const b = snapshotId('0x12345678' + '2'.repeat(32), '2026-09-21T12:00:00.000Z');
    expect(a).not.toBe(b);
    expect(isSnapshotId(a)).toBe(true);
    expect(isSnapshotId(b)).toBe(true);
  });

  it('gives the same reading the same id every time', () => {
    const at = '2026-09-21T12:00:00.000Z';
    expect(snapshotId(ADDRESS, at)).toBe(snapshotId(ADDRESS, at));
  });

  it('still recognises the ids already handed out', () => {
    expect(isSnapshotId('12345678-m0abc12')).toBe(true);
    expect(isSnapshotId('../../etc/passwd')).toBe(false);
    expect(isSnapshotId('')).toBe(false);
  });
});

describe('R02: a share link is only offered for a reading that was saved', () => {
  it('reports the write failing rather than handing out a link to nothing', async () => {
    routeHl();
    const failing: KVLike = {
      async get() {
        return null;
      },
      async put() {
        throw new Error('KV quota exceeded');
      },
    };
    const env = testEnv({ KV: failing as never });
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), env);
    const body = (await res.json()) as { snapshotId?: string; snapshotSaved: boolean };
    expect(body.snapshotSaved).toBe(false);
    expect(body.snapshotId).toBeUndefined();
  });

  it('reports a successful write', async () => {
    routeHl();
    const res = await worker.fetch(request(`/api/check?address=${ADDRESS}`, { method: 'POST' }), testEnv());
    const body = (await res.json()) as { snapshotId?: string; snapshotSaved: boolean };
    expect(body.snapshotSaved).toBe(true);
    expect(typeof body.snapshotId).toBe('string');
  });

  it('tells a caller whether a write went through', async () => {
    const kv = safeKv({
      async get() {
        return null;
      },
      async put() {
        throw new Error('nope');
      },
    });
    expect(await kv.put('k', 'v')).toBe(false);
  });
});
