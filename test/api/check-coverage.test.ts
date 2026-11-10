// A04, audit of 21.09: a source that failed, answered about part of the
// account, or was never asked has to reach the classifier as such. A caveat
// at the foot of the card is not a dependency.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkAddress } from '../../src/api/check';
import type { NansenPerpPositions, NansenBalance } from '../support/nansenFixtures';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import type { PositionsReader } from '../../src/sources/positions';
import { allDexFrom } from '../support/positions';
import { holdingsFromNansen, onchainAnswers, walletOf } from '../support/onchain';
import { EXPLORER_KEY, arbitrumFunderPage, cutShortPage, explorerAnswers, explorerDown, funderPage, type ExplorerPages } from '../support/explorer';

const ADDRESS = '0x1111111111111111111111111111111111111111';

const EMPTY_HL: Record<string, unknown> = {
  // No named dex: the main dex is every venue there is.
  perpDexs: [null],
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

type Nodes = (url: string, body: unknown) => Response | null;

/** Routes Hyperliquid to empty answers; `failHip3Orders` makes the per-dex
 * order read answer 503 the way a real HIP-3 outage would. The public nodes
 * answer `onchain`, by default nothing held anywhere; `marks` lists the main
 * dex's mark prices, none by default; `failMarketData` makes the main dex's
 * market data answer 503, so no mark is known at all. */
function route(
  opts: {
    failHip3Orders?: boolean;
    onchain?: Nodes;
    marks?: Record<string, number>;
    failMarketData?: boolean;
    /** The explorer's funding pages; nothing funded anyone by default. */
    explorer?: ExplorerPages;
  } = {},
) {
  const onchain = opts.onchain ?? onchainAnswers({});
  const explorer = explorerAnswers(opts.explorer ?? {});
  const hl: Record<string, unknown> = opts.marks
    ? {
        ...EMPTY_HL,
        metaAndAssetCtxs: [
          { universe: Object.keys(opts.marks).map((name) => ({ name })) },
          Object.values(opts.marks).map((mark) => ({ markPx: String(mark), openInterest: '0' })),
        ],
      }
    : EMPTY_HL;
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const node = onchain(String(url), body);
    if (node) return node;
    const funding = explorer(String(url));
    if (funding) return funding;
    if (body.type === 'frontendOpenOrders' && body.dex && opts.failHip3Orders) {
      return new Response('{}', { status: 503 });
    }
    if (body.type === 'metaAndAssetCtxs' && opts.failMarketData) return new Response('{}', { status: 503 });
    if (!(body.type in hl)) throw new Error(`unrouted ${body.type}`);
    return new Response(JSON.stringify(hl[body.type]), { status: 200 });
  }) as unknown as typeof fetch;
}

/** One $1M position at ADDRESS, as every dex reports it. */
function holding(coin: string, side: 'long' | 'short', opts: { measuredAt?: number } = {}): PositionsReader {
  return async () =>
    allDexFrom(
      {
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
      } as unknown as NansenPerpPositions,
      EMPTY_HL.clearinghouseState as HlClearinghouseState,
    );
}

/** A keyed explorer: both chains are read. With `route`'s default pages
 * nothing funded anyone, so a funder search reads complete and finds no one. */
const QUIET = { explorer: { apiKey: EXPLORER_KEY } };

afterEach(() => vi.restoreAllMocks());

describe('a failed HIP-3 order read reaches the rule that needs it', () => {
  it('does not call a HIP-3 long a clean bet when its dex would not answer', async () => {
    route({ failHip3Orders: true });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('xyz:ETH', 'long') });
    expect(result.ordersCoverage).toBe('partial');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('underlying_not_verified');
    expect(result.degraded).toBe(true);
  });

  it('records complete orders but still withholds a verdict on an unverified underlying', async () => {
    route();
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('xyz:ETH', 'long') });
    expect(result.ordersCoverage).toBe('complete');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('underlying_not_verified');
  });

  it('says quiet venues were the ones checked, not every venue there is (23.09 audit, L06)', async () => {
    // A dex the account only quotes on, with no position there, is never
    // asked: "complete" is about the venues read, and the card has to say
    // so exactly when that silence is about to count as "quotes nothing".
    route();
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('ETH', 'long') });
    expect(result.ordersCoverage).toBe('complete');
    expect(result.coverage.join(' ')).toContain('No two-sided quoting found on the venues checked');
    expect(result.coverage.join(' ')).toContain('A dex it only quotes, with no position of its own, would not appear here');
  });

  it('says nothing about quiet venues when one of them would not answer, since then nothing is claimed', async () => {
    route({ failHip3Orders: true });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('xyz:ETH', 'long') });
    expect(result.coverage.join(' ')).not.toContain('No two-sided quoting found on the venues checked');
  });
});

describe('a reading that is old, or was never taken, says so', () => {
  it('marks an hour-old position reading as degraded', async () => {
    route();
    const result = await checkAddress(ADDRESS, {
      ...QUIET,
      readPositions: holding('ETH', 'long', { measuredAt: Date.now() - 3_600_000 }),
    });
    expect(result.degraded).toBe(true);
    expect(result.coverage.join(' ')).toContain('before this check');
  });

  it('marks a check whose funder search could not read a chain as degraded', async () => {
    // No explorer key: Arbitrum's funding links are not read, so a short's
    // funder search is partial, and the answer is worth less than a whole one.
    route();
    const result = await checkAddress(ADDRESS, { readPositions: holding('ETH', 'short') });
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.degraded).toBe(true);
  });
});

describe('R04: the deadline covers the whole check, not some of its stages', () => {
  it('starts no optional read at all once the time is gone', async () => {
    route();
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('ETH', 'short'), deadline: Date.now() - 1 });
    const calls = vi.mocked(global.fetch).mock.calls;
    // Not the PnL, not the funding links, and not the holdings read on the
    // public nodes either: each is a request all the same.
    expect(calls.filter(([, init]) => String(init?.body).includes('"portfolio"'))).toEqual([]);
    expect(calls.filter(([url]) => String(url).includes('blockscout'))).toEqual([]);
    expect(calls.filter(([, init]) => String(init?.body).includes('eth_call'))).toEqual([]);
    expect(result.coverage.join(' ')).toContain('ran out of time');
    expect(result.degraded).toBe(true);
  });

  it('measures the deadline on the clock it was given', async () => {
    route();
    // An injected clock and a direct Date.now() used to be mixed, which made
    // any test of the time budget depend on how long the test itself took.
    const frozen = Date.parse('2026-09-21T12:00:00Z');
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('ETH', 'long'), now: () => frozen });
    expect(result.checkedAt).toBe(new Date(frozen).toISOString());
  });
});

describe('L02a (22.09 audit): a long\'s own funding history is context a hedge search cannot reach', () => {
  const FUNDER = '0xfffffffffffffffffffffffffffffffffffffff1';
  /** 8 days before the frozen clock below. */
  const EIGHT_DAYS_BEFORE = '2026-09-13T12:00:00.000000Z';
  const frozen = Date.parse('2026-09-21T12:00:00Z');
  const hypeLong = holding('HYPE', 'long');
  const fundedOnEthereum = (tags?: string[]): ExplorerPages => ({
    [ADDRESS]: { ethereum: funderPage(ADDRESS, FUNDER, { timestamp: EIGHT_DAYS_BEFORE, tags }) },
  });

  it('names when a lone long position was first funded, and by what kind of wallet', async () => {
    route({ explorer: fundedOnEthereum() });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: hypeLong, now: () => frozen });
    expect(result.vitals).toContainEqual(
      expect.objectContaining({
        label: 'Earliest funding found',
        source: 'Explorer',
        value: expect.stringContaining('8 days ago on ethereum'),
      }),
    );
  });

  it('names an exchange or bridge funder as what it is', async () => {
    route({ explorer: fundedOnEthereum(['Binance: Hot Wallet']) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: hypeLong, now: () => frozen });
    expect(result.vitals.find((v) => v.label === 'Earliest funding found')?.value).toContain('an exchange or bridge');
  });

  it('says which chain could not be read, rather than staying silent about the gap (23.09 audit, L09)', async () => {
    // Ethereum answers with a record; Arbitrum fails outright. The old label
    // "First funded" would have read as the account's age regardless.
    route({ explorer: { [ADDRESS]: { ...fundedOnEthereum()[ADDRESS], arbitrum: explorerDown } } });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: hypeLong, now: () => frozen });
    const item = result.vitals.find((v) => v.label === 'Earliest funding found');
    expect(item?.value).toBe('8 days ago on ethereum, arbitrum not read, by an unlabelled wallet');
    // Context: said, and nothing about the answer is lowered for it.
    expect(result.coverageNotes).toContainEqual({ text: 'Funding links on Arbitrum could not be read', failure: false });
  });

  it('does not read funding history for a short: the hedge search already covers that ground', async () => {
    route({ explorer: fundedOnEthereum() });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short'), now: () => frozen });
    expect(result.vitals.some((v) => v.label === 'Earliest funding found')).toBe(false);
  });

  it('says nothing when there is no funding link to read', async () => {
    route();
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: hypeLong, now: () => frozen });
    expect(result.vitals.some((v) => v.label === 'Earliest funding found')).toBe(false);
  });
});

describe('A06 (25.09 audit): a failed funder read does not claim the funders hold nothing', () => {
  const FUNDER_ADDRESS = '0xfffffffffffffffffffffffffffffffffffffff1';
  const FUNDER_2_ADDRESS = '0xfffffffffffffffffffffffffffffffffffffff2';
  /** The account's funding links: `ethereum` and `arbitrum` name who funded it there. */
  const links = (pages: { ethereum?: unknown; arbitrum?: unknown }): ExplorerPages => ({ [ADDRESS]: pages });
  const fundedBy = (sender: string, tags?: string[]) => funderPage(ADDRESS, sender, { tags });

  it('does not read the funder search as complete when a candidate balance fetch fails', async () => {
    route({
      onchain: onchainAnswers({}, { failWalletChains: { [FUNDER_ADDRESS]: ['ethereum', 'arbitrum', 'hyperevm'] } }),
      explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS) }),
    });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    // The one candidate that exists could not be read at all, so nothing
    // stands in for its holdings - this is a gap in the reading, not a
    // finding that the funders hold nothing.
    expect(result.linkedHedgeCoverage).toBe('missing');
    expect(result.linkedHedge).toEqual({ linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] });
    expect(result.coverage.join(' ')).toContain('One linked wallet could not be read');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toContain('linked_holdings_not_checked');
  });

  it('reads the funder search as partial when only some of several candidates fail', async () => {
    route({
      onchain: onchainAnswers({}, { failWalletChains: { [FUNDER_ADDRESS]: ['ethereum', 'arbitrum', 'hyperevm'] } }),
      explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS), arbitrum: arbitrumFunderPage(ADDRESS, FUNDER_2_ADDRESS) }),
    });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    // One candidate came back, one did not: the search is not complete, but
    // it is not empty-handed either.
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge?.funders).toHaveLength(1);
  });

  it('still reads complete when every candidate answers, even if none holds anything', async () => {
    route({ explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS) }) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    expect(result.linkedHedgeCoverage).toBe('complete');
    // The candidate itself was read in full - it just holds nothing - so it
    // still shows up as a followed funder, at $0, rather than vanishing.
    expect(result.linkedHedge?.linkedHedgeUsd).toBe(0);
    expect(result.linkedHedge?.funders).toEqual([expect.objectContaining({ address: FUNDER_ADDRESS, matchingUsd: 0 })]);
  });

  // The balance-reading step above is not the only place this search can
  // come back incomplete: the earlier step that discovers candidates in the
  // first place (the funding links, on each chain) can itself fail, come back
  // in a shape it was not expected to, or come back cut short - and until
  // now none of that reached the final coverage value (spec review after
  // e9acde1/6ca1958).
  const WETH_ETHEREUM = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const weth = (valueUsd: number): NansenBalance => ({
    chain: 'ethereum',
    address: FUNDER_ADDRESS,
    token_address: WETH_ETHEREUM,
    token_symbol: 'WETH',
    token_name: 'WETH',
    token_amount: valueUsd / 2500,
    price_usd: 2500,
    value_usd: valueUsd,
  });

  it('reads partial, not complete, when one chain could not be enumerated even though the other found a real, valued candidate', async () => {
    // An ETH mark, so the candidate's WETH has a price: the one gap left in
    // this search is the chain that was not enumerated. (A funder holding it
    // could not price is its own gap, the next case.)
    route({
      marks: { ETH: 2500 },
      onchain: onchainAnswers({ [FUNDER_ADDRESS]: holdingsFromNansen([weth(5_000_000)]) }),
      explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS), arbitrum: explorerDown }),
    });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('ETH', 'short') });
    // Arbitrum was never actually looked at - a real, valued candidate
    // turning up on ethereum alone must not read as a complete search.
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge?.linkedHedgeUsd).toBeGreaterThan(0);
  });

  it('reads partial, not complete, when a funder holds a recognised token it could not price', async () => {
    // Hyperliquid's market data does not answer, so there is no ETH mark: the
    // funder's WETH is read from the node but cannot be valued, and leaving
    // it out at $0 is not a finding that the funder holds no ETH.
    route({
      failMarketData: true,
      onchain: onchainAnswers({ [FUNDER_ADDRESS]: holdingsFromNansen([weth(5_000_000)]) }),
      explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS) }),
    });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('ETH', 'short') });
    // The account itself holds none of the registry tokens, so its own read is complete.
    expect(result.hedgeCoverage).toBe('complete');
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge?.funders).toEqual([expect.objectContaining({ address: FUNDER_ADDRESS, matchingUsd: 0 })]);
    expect(result.coverageNotes).toContainEqual({
      text: 'A funding wallet holds tokens this tool recognises that could not be priced, so its holdings may be understated',
      failure: true,
    });
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
    expect(result.verdict.reasons).toEqual(['linked_holdings_not_checked']);
  });

  it('reads missing, not not-applicable, when every chain fails to enumerate at all', async () => {
    route({ explorer: links({ ethereum: explorerDown, arbitrum: explorerDown }) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    expect(result.linkedHedgeCoverage).toBe('missing');
    expect(result.linkedHedge).toBeNull();
  });

  it('reads partial, not complete, when a chain answers only its first page and nothing follows from it', async () => {
    // Nothing rejects and nothing is malformed - the chain simply says its
    // answer did not reach the end, same as `bal.complete === false` elsewhere.
    route({ explorer: links({ ethereum: cutShortPage(ADDRESS) }) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge).toBeNull();
  });

  it('reads complete, not not-applicable, when the search ran cleanly and found only an exchange or bridge', async () => {
    route({ explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS, ['Binance: Hot Wallet']) }) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    // A short funded only by an exchange still had a search that genuinely
    // ran; 'not-applicable' would claim it never tried, and
    // 'missing'/'partial' would claim it came back incomplete.
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(result.linkedHedge).toBeNull();
  });

  // Third review pass: the same bug class, two more doors in this same
  // function. Both share the pattern every prior door shared - a source read
  // that did not fully succeed was passed to note(..., true) for display but
  // never fed the boolean/counter the final coverage actually reads.
  it('reads missing, not complete, when a candidate balance answers 200 with a garbage body shape', async () => {
    // Every node answers 200 for the funder, with a result that is not data.
    const nodes = onchainAnswers({});
    route({
      onchain: (url, body) => {
        const answer = nodes(url, body);
        return answer && walletOf(body) === FUNDER_ADDRESS ? Response.json({ jsonrpc: '2.0', id: 1, result: 'not a list' }) : answer;
      },
      explorer: links({ ethereum: fundedBy(FUNDER_ADDRESS) }),
    });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    expect(result.linkedHedgeCoverage).toBe('missing');
    expect(result.linkedHedge).toEqual({ linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] });
  });

  it('reads partial, not complete, when the only sender on a chain is not an address', async () => {
    // A well-formed page (so it is not a refusal) whose one sender cannot be
    // an address: the explorer reader rejects the page, and that chain reads
    // as not read - never as a chain where nothing came in.
    route({ explorer: links({ ethereum: fundedBy('not-a-real-address') }) });
    const result = await checkAddress(ADDRESS, { ...QUIET, readPositions: holding('HYPE', 'short') });
    expect(result.linkedHedgeCoverage).toBe('partial');
    expect(result.linkedHedge).toBeNull();
    expect(result.coverage).toContain('Funding links on Ethereum could not be read');
  });
});
