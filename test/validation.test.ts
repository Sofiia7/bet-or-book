// R01 and R02, audit of 21.09: an answer of the wrong shape has to be
// caught where it arrives, an optional source may not fail the whole check,
// and a link may not be handed out for a reading that was never saved.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizePortfolioPnl, UpstreamShapeError } from '../src/sources/normalize';
import { snapshotId, isSnapshotId } from '../src/snapshot';
import { safeKv } from '../src/safeKv';
import { checkAddress } from '../src/api/check';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import type { NansenPerpPositions } from './support/nansenFixtures';
import type { KVLike } from '../src/kv';
import type { HlClearinghouseState } from '../src/sources/hyperliquid';
import { allDexFrom } from './support/positions';
import { onchainAnswers, walletOf } from './support/onchain';
import { EXPLORER_KEY, arbitrumFunderPage, explorerAnswers, funderPage } from './support/explorer';

describe('R01: a body of the wrong shape is rejected, not rendered', () => {
  it('refuses an empty PnL body instead of putting $NaN on the card', () => {
    // The 30-day PnL is Hyperliquid's `portfolio` now; the rule is the one the
    // Nansen PnL body was held to: no body, no number, and never a zero.
    expect(() => normalizePortfolioPnl({}, 30)).toThrow(UpstreamShapeError);
    expect(() => normalizePortfolioPnl([], 30)).toThrow(UpstreamShapeError);
  });

  it('accepts a real one', () => {
    const pnl = normalizePortfolioPnl(
      [['perpMonth', { pnlHistory: [[1, '0.0'], [2, '-1200.5']] }]],
      30,
    );
    expect(pnl).toEqual({ basis: 'realized-and-unrealized', pnlUsd: -1200.5, windowDays: 30 });
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

/** Hyperliquid's answers; the public nodes answer `nodes`, by default
 * nothing held anywhere; the explorer names one unlabelled funder on each
 * chain, the same wallet on both. */
function routeHl(nodes: (url: string, body: unknown) => Response | null = onchainAnswers({})) {
  const explorer = explorerAnswers({ [ADDRESS]: { ethereum: funderPage(ADDRESS, FUNDER), arbitrum: arbitrumFunderPage(ADDRESS, FUNDER) } });
  global.fetch = vi.fn(async (u: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const node = nodes(String(u), body);
    if (node) return node;
    const funding = explorer(String(u));
    if (funding) return funding;
    return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
}

/** A $1M ETH short, as every dex reports it. */
const readPositions = async () =>
  allDexFrom(
    {
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
    } as unknown as NansenPerpPositions,
    HL.clearinghouseState as HlClearinghouseState,
  );

/** Both funding-link chains, read with a key. */
const KEYED = { explorer: { apiKey: EXPLORER_KEY } };

afterEach(() => vi.restoreAllMocks());

describe('R01: an extra source that answers badly does not lose the answer', () => {
  it('keeps the check when every node answers a funder with something that is not a balance', async () => {
    const nodes = onchainAnswers({});
    routeHl((url, body) => {
      const answer = nodes(url, body);
      return answer && walletOf(body) === FUNDER ? Response.json({ jsonrpc: '2.0', id: 1, result: { not: 'data' } }) : answer;
    });
    const result = await checkAddress(ADDRESS, { ...KEYED, readPositions });
    expect(result.verdict).toBeDefined();
    expect(result.coverage).toContain('One linked wallet could not be read');
    expect(result.linkedHedgeCoverage).toBe('missing');
    expect(result.degraded).toBe(true);
  });

  it('says so when a funder was read on some chains only', async () => {
    routeHl(onchainAnswers({}, { failWalletChains: { [FUNDER]: ['arbitrum'] } }));
    const result = await checkAddress(ADDRESS, { ...KEYED, readPositions });
    expect(result.coverage).toContain(
      "A funding wallet's holdings on some chains or tokens could not be read, so its holdings may be understated",
    );
    expect(result.coverage.join(' ')).not.toMatch(/first 100/);
    expect(result.linkedHedgeCoverage).toBe('partial');
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
