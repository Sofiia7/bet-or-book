// Positions come from every Hyperliquid dex (src/sources/positions.ts), not
// from Nansen. What a check says when one of those dexes, or the list of
// them, could not be read; what `source` says once Nansen supplies nothing;
// and how many requests the heaviest check sends.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { readAllDexPositions } from '../../src/sources/positions';
import { openQuestion } from '../../src/engine/openQuestion';
import { CHECK_REQUEST_LIMIT } from '../../src/requestBudget';
import { HOLDINGS_CHAINS } from '../../src/sources/onchain';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxXyz from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import { ABRAXAS, emptyState, explorerInFull, hlPosition, quote, reply, stub, type Reply } from '../support/upstream';
import { EXPLORER_KEY } from '../support/explorer';

/** A minute after Abraxas's main-dex capture, so the reading is current. */
const NOW = abxClearinghouse.time + 60_000;
const clock = () => NOW;
/** The named dexes in the registry capture, in its order. */
const NAMED_DEXES = (perpDexs as Array<{ name: string } | null>).filter((d) => d !== null).map((d) => d!.name);
const MAIN_COUNT = abxClearinghouse.assetPositions.length;
const XYZ_COUNT = abxXyz.assetPositions.length;

const failures = (r: { coverageNotes: Array<{ text: string; failure: boolean }> }) =>
  r.coverageNotes.filter((n) => n.failure).map((n) => n.text);


/** One holdings read per chain for the account, then for each of its two
 * funders, in the order the explorer named them: Ethereum's, then Arbitrum's. */
const EVERY_HOLDINGS_READ = [ABRAXAS, '0x' + 'e1'.repeat(20), '0x' + 'a1'.repeat(20)].flatMap((wallet) =>
  HOLDINGS_CHAINS.map((chain) => ({ chain, wallet })),
);
/** Both funding-link chains, read with a key. */
const KEYED = { explorer: { apiKey: EXPLORER_KEY } };

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('market data and provenance for a HIP-3 headline', () => {
  const xyzHeadline = () =>
    stub({
      main: reply({ ...emptyState(NOW), assetPositions: [hlPosition('BTC', 1, 1_000)] }),
      dex: { xyz: reply({ ...emptyState(NOW), assetPositions: [hlPosition('xyz:GOLD', -25, 100_000)] }) },
    });

  it('builds the provenance from the registry the positions were read with, not a second read', async () => {
    const sent = xyzHeadline();

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.positions.headlineCoin).toBe('xyz:GOLD');
    expect(result.marketProvenance).toMatchObject({ venue: 'xyz', status: 'complete', listed: true });
    expect(sent.all.filter((r) => r === 'hl:perpDexs')).toHaveLength(1);
    expect(sent.all.filter((r) => r.startsWith('hl:metaAndAssetCtxs:'))).toEqual(['hl:metaAndAssetCtxs:xyz']);
  });

  it('asks the registry once more when the reading did not carry it', async () => {
    const sent = xyzHeadline();
    const readPositions = async (address: string, signal?: AbortSignal) => ({
      ...(await readAllDexPositions(address, { signal })),
      registry: null,
    });

    const result = await checkAddress(ABRAXAS, { now: clock, readPositions });

    expect(result.marketProvenance).toMatchObject({ venue: 'xyz', status: 'complete', listed: true });
    // One from the reader itself, one from the fallback.
    expect(sent.all.filter((r) => r === 'hl:perpDexs')).toHaveLength(2);
  });
});

describe('positions from every Hyperliquid dex', () => {
  it('check rejects when the main dex cannot be read', async () => {
    // The main dex is the account. A reading without it is not a partial
    // reading of the account, it is no reading at all.
    stub({ main: reply({ error: 'unavailable' }, 500) });
    await expect(checkAddress(ABRAXAS, { now: clock })).rejects.toThrow(/clearinghouseState failed: 500/);
  });

  it('a failed dex yields partial coverage, a note naming the dex and positions_not_complete', async () => {
    stub({ dex: { flx: reply({ error: 'unavailable' }, 500) } });

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.positionsCoverage).toBe('partial');
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 10, registryRead: true });
    expect(failures(result)).toContain(
      'Positions on the flx dex could not be read, so this reading may be missing positions there',
    );
    expect(result.degraded).toBe(true);
    // The dexes that did answer are all in the reading.
    expect(result.positions.nPositions).toBe(MAIN_COUNT + XYZ_COUNT);
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['positions_not_complete']);
    // The card says how many dexes were read, not that only the main one was.
    // (The reading does not keep which dexes failed; the note above names them.)
    expect(result.summary).toMatch(/^Of what could be read, 41% of the exposure is one .*ETH short - but /);
    expect(result.summary).toContain(
      'positions were read from 10 of 11 Hyperliquid dexes, so a position on a dex that did not answer would not ' +
        'appear here, so this is not the whole portfolio.',
    );
    expect(result.summary).not.toContain('only the main perp dex was read');
    expect(openQuestion(result)).toBe(
      'the positions on the Hyperliquid dexes that did not answer. Checking again may complete them.',
    );
  });

  it('a wrong-shape dex answer is a failed dex', async () => {
    stub({ dex: { xyz: reply({ assetPositions: 'none' }) } });

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.positionsCoverage).toBe('partial');
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 10, registryRead: true });
    expect(failures(result)).toContain(
      'Positions on the xyz dex could not be read, so this reading may be missing positions there',
    );
    expect(result.positions.nPositions).toBe(MAIN_COUNT);
    expect(result.verdict.reasons).toEqual(['positions_not_complete']);
  });

  it('an unreadable dex list yields main-dex positions and the HIP-3 note', async () => {
    const sent = stub({ registry: reply({ error: 'unavailable' }, 500) });

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.positions.nPositions).toBe(MAIN_COUNT);
    expect(result.mainDexPositionCount).toBe(MAIN_COUNT);
    expect(result.positionsCoverage).toBe('partial');
    expect(result.positionsVenues).toEqual({ asked: 1, answered: 1, registryRead: false });
    expect(failures(result)).toContain(
      'The list of Hyperliquid dexes could not be read: positions on named (HIP-3) dexes are not included',
    );
    // No dex name was known, so no named dex was asked.
    expect(sent.hyperliquid.filter((b) => b.type === 'clearinghouseState' && b.dex !== undefined)).toEqual([]);
    expect(result.verdict.reasons).toEqual(['positions_not_complete']);
    expect(result.summary).toContain(
      'but the list of Hyperliquid dexes could not be read, so only the main dex was read, and a position on a ' +
        'named (HIP-3) dex would not appear here, so this is not the whole portfolio.',
    );
    expect(openQuestion(result)).toBe('the list of Hyperliquid dexes, which did not load. Checking again may complete it.');
  });

  it('an address with no positions anywhere is complete and says so', async () => {
    stub({
      main: reply(emptyState()),
      dex: { xyz: reply(emptyState()) },
      hl: { spotClearinghouseState: { balances: [] }, userFillsByTime: [] },
    });

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.positions.nPositions).toBe(0);
    expect(result.positionsCoverage).toBe('complete');
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.coverage.join(' ')).not.toContain('could not be read');
    expect(result.verdict.verdict).toBe('unknown');
    expect(result.verdict.reasons).toEqual(['no open positions found']);
    expect(result.summary).toMatch(/no open positions/i);
  });

  it('a reading carries positionsVenues, and source is hyperliquid whether or not its funding links were read', async () => {
    stub();
    const unkeyed = await checkAddress(ABRAXAS, { now: clock });
    expect(unkeyed.source).toBe('hyperliquid');
    expect(unkeyed.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(unkeyed.positionsCoverage).toBe('complete');
    expect(unkeyed.positions.nPositions).toBe(MAIN_COUNT + XYZ_COUNT);
    expect(unkeyed.mainDexPositionCount).toBe(MAIN_COUNT);

    // The funding links read in full, from the explorer: still Hyperliquid's
    // reading, with the positions and the PnL Hyperliquid's own.
    const sent = stub({ explorer: explorerInFull(ABRAXAS) });
    const linked = await checkAddress(ABRAXAS, { ...KEYED, now: clock });
    // Ethereum, Arbitrum, and the label of the Arbitrum sender.
    expect(sent.explorer).toHaveLength(3);
    expect(linked.source).toBe('hyperliquid');
    expect(linked.pnl).toMatchObject({ basis: 'realized-and-unrealized', windowDays: 30 });
    expect(linked.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(linked.evidence.find((e) => e.label === 'Largest position')?.source).toBe('Hyperliquid');
    expect(linked.vitals.find((v) => v.label === 'Leverage')?.source).toBe('Hyperliquid');
    // The balances on other chains were read by the nodes.
    expect(linked.hedgeScope).toBe('known-tokens');
    expect(linked.coverage.join(' ')).not.toMatch(/Nansen/);
  });

  it('a funding chain not read adds no claim about the main dex only', async () => {
    stub();

    const result = await checkAddress(ABRAXAS, { now: clock });

    expect(result.coverage).toContain('Funding links on Arbitrum were not read: no explorer key is configured');
    // Every dex answered: the positions are the whole of Hyperliquid, and no
    // note may say otherwise just because a funding chain was not read.
    // (The note about resting orders still names the main dex: orders are
    // asked only where a position is. That is about quotes, not positions.)
    expect(result.positionsCoverage).toBe('complete');
    expect(result.coverage.filter((c) => /main[- ]dex (positions )?only/i.test(c))).toEqual([]);
    expect(result.coverage.join(' ')).not.toContain('HIP-3 dex would not appear');
    expect(result.verdict.reasons).not.toContain('positions_not_complete');
  });

  it('a worst-case check stays under 50 outbound requests', async () => {
    // The Workers Free plan allows 50 outgoing requests per invocation, and
    // production runs on it. A heavy check: every dex in the registry
    // answering, positions on three of the named ones (each of which is then
    // asked for its own orders and market data), a two-sided quote on the
    // headline (a book read for its mid), the 30-day PnL from Hyperliquid's
    // portfolio, the funding links on both chains answering in full from the
    // explorer (and the label of the Arbitrum sender), and the holdings of the
    // account and both funders read from the public nodes, one request per
    // chain each. The funding-age read for a long is the
    // other branch of the same choice and is lighter than the funder search.
    // The ceiling is the next case.
    const now = Date.now();
    const main = emptyState(now);
    main.assetPositions = [hlPosition('ETH', -40_000, 100_000_000)];
    const sent = stub({
      main: reply(main),
      dex: {
        xyz: reply({ ...emptyState(now), assetPositions: [hlPosition('xyz:GOLD', -10, 1_000_000)] }),
        flx: reply({ ...emptyState(now), assetPositions: [hlPosition('flx:TSLA', 10, 1_000_000)] }),
        vntl: reply({ ...emptyState(now), assetPositions: [hlPosition('vntl:SPACEX', 10, 1_000_000)] }),
      },
      hl: {
        frontendOpenOrders: [quote('ETH', 'B', '2499', now), quote('ETH', 'A', '2501', now)],
        spotClearinghouseState: { balances: [] },
        userFillsByTime: [],
        l2Book: { coin: 'ETH', time: now, levels: [[{ px: '2499' }], [{ px: '2501' }]] },
      },
      explorer: explorerInFull(ABRAXAS),
    });

    const result = await checkAddress(ABRAXAS, KEYED);

    // It really is the heavy path.
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.positions.nPositions).toBe(4);
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.linkedHedge?.funders).toHaveLength(2);
    expect(sent.explorer.map((e) => e.chain).sort()).toEqual(['arbitrum', 'ethereum', 'ethereum']);
    expect(sent.unrouted).toEqual([]);
    expect(sent.all.filter((r) => r === 'hl:portfolio')).toHaveLength(1);
    expect(result.pnl).toMatchObject({ basis: 'realized-and-unrealized', windowDays: 30 });
    expect(sent.rpc).toEqual(EVERY_HOLDINGS_READ);
    expect(sent.all).toContain('hl:l2Book');
    for (const dex of ['xyz', 'flx', 'vntl']) expect(sent.all).toContain(`hl:frontendOpenOrders:${dex}`);
    // Market data is read for the headline's dex only; this headline is on the main dex.
    expect(sent.all.filter((r) => r.startsWith('hl:metaAndAssetCtxs:'))).toEqual([]);
    expect(sent.all.filter((r) => r === 'hl:perpDexs')).toHaveLength(1);
    for (const dex of NAMED_DEXES) expect(sent.all).toContain(`hl:clearinghouseState:${dex}`);

    expect(sent.all.length, sent.all.join('\n')).toBeLessThan(50);
  });

  it('the heaviest check today - a position on every dex, a HIP-3 headline - stays under 50 outbound requests', async () => {
    // The ceiling of this code against the current registry of ten named
    // dexes: 42 requests before any retry of a 429 or 5xx - 30 to
    // Hyperliquid (29 + the portfolio), 3 to the block explorer and 9 to the
    // public nodes (it was 47 on 21.10, and 37 before the balances moved from
    // Nansen's paged reads to one node request per chain per wallet; the
    // 30-day PnL then moved from Nansen to Hyperliquid's portfolio, and the
    // funding links from Nansen to the explorer, one request swapped for one
    // each time; the third explorer request came with the first live run with
    // a key on 2026-11-10, when Arbitrum turned out to need the Etherscan-style
    // txlist and its sender's label a lookup on the Ethereum chain).
    // Hyperliquid: five free reads, the dex list and eleven position reads,
    // the headline dex's market data, the orders of every named dex (ten), a
    // book for the quoted headline's mid, and the portfolio (the PnL).
    // Explorer, with a key: the funding link on Ethereum (REST), on Arbitrum
    // (txlist), and the label of the Arbitrum sender (the Ethereum chain).
    // Nodes: Ethereum, Arbitrum and HyperEVM for the account and each of its
    // two funders. One more named dex holding a position adds two (positions,
    // orders).
    //
    // Inside xyz's market review window, so the GOLD underlying is documented
    // and a short on it reaches every read a short can.
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    const state = (positions: HlClearinghouseState['assetPositions']) => ({ ...emptyState(now), assetPositions: positions });
    const dex: Record<string, Reply> = Object.fromEntries(
      NAMED_DEXES.map((name) => [
        name,
        reply(state([name === 'xyz' ? hlPosition('xyz:GOLD', -25_000, 100_000_000) : hlPosition(`${name}:X`, 10, 1_000_000)])),
      ]),
    );
    const sent = stub({
      main: reply(state([hlPosition('BTC', 10, 1_000_000)])),
      dex,
      dexOrders: { xyz: [quote('xyz:GOLD', 'B', '3999', now), quote('xyz:GOLD', 'A', '4001', now)] },
      hl: {
        frontendOpenOrders: [],
        spotClearinghouseState: { balances: [] },
        userFillsByTime: [],
        l2Book: { coin: 'xyz:GOLD', time: now, levels: [[{ px: '3999' }], [{ px: '4001' }]] },
      },
      explorer: explorerInFull(ABRAXAS),
    });

    const result = await checkAddress(ABRAXAS, { ...KEYED, now: () => now });

    // It really is the ceiling.
    expect(result.positions.headlineCoin).toBe('xyz:GOLD');
    expect(result.positions.headlineUnderlyingVerified).toBe(true);
    expect(result.positions.nPositions).toBe(1 + NAMED_DEXES.length);
    expect(result.positionsVenues).toEqual({ asked: 11, answered: 11, registryRead: true });
    expect(result.hedgeScope).toBe('known-tokens');
    expect(result.linkedHedge?.funders).toHaveLength(2);
    expect(result.linkedHedgeCoverage).toBe('complete');
    expect(sent.explorer.map((e) => e.chain).sort()).toEqual(['arbitrum', 'ethereum', 'ethereum']);
    expect(sent.rpc).toEqual(EVERY_HOLDINGS_READ);
    expect(sent.all.filter((r) => r === 'hl:perpDexs')).toHaveLength(1);
    expect(sent.all).toContain('hl:l2Book');
    for (const name of NAMED_DEXES) {
      expect(sent.all).toContain(`hl:clearinghouseState:${name}`);
      expect(sent.all).toContain(`hl:frontendOpenOrders:${name}`);
    }
    // Market data only for the headline's dex.
    expect(sent.all.filter((r) => r.startsWith('hl:metaAndAssetCtxs:'))).toEqual(['hl:metaAndAssetCtxs:xyz']);

    // The breakdown, exactly: 29 + 1 to Hyperliquid, 3 to the explorer (the
    // account's links on Ethereum and Arbitrum, the label of the Arbitrum
    // sender), 9 to the nodes, and none to Nansen.
    expect(sent.all.filter((r) => r === 'hl:portfolio')).toHaveLength(1);
    expect(sent.hyperliquid.filter((b) => b.type !== 'portfolio')).toHaveLength(29);
    expect(sent.hyperliquid).toHaveLength(30);
    expect(sent.explorer).toEqual([
      { chain: 'ethereum', wallet: ABRAXAS },
      { chain: 'arbitrum', wallet: ABRAXAS },
      { chain: 'ethereum', wallet: '0x' + 'a1'.repeat(20) },
    ]);
    expect(sent.rpc).toHaveLength(9);
    expect(sent.unrouted).toEqual([]);
    expect(sent.all.filter((r) => r.startsWith('unrouted:'))).toEqual([]);
    expect(sent.all.length, sent.all.join('\n')).toBe(42);
    expect(sent.all.length).toBeLessThanOrEqual(CHECK_REQUEST_LIMIT);
  });
});
