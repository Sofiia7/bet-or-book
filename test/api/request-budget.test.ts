// A check stays within the request limit of the Workers Free plan, and says
// which reads the limit stopped. The descriptive reads give way first so the
// ones that decide the verdict keep their allowance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAddress } from '../../src/api/check';
import { CHECK_REQUEST_LIMIT, REQUEST_LIMIT_REASON, attachRequestBudget, createRequestBudget } from '../../src/requestBudget';
import { ABRAXAS, emptyState, explorerInFull, hlPosition, quote, reply, stub, type Reply } from '../support/upstream';
import { EXPLORER_KEY } from '../support/explorer';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const budgeted = (limit?: number) => {
  const signal = new AbortController().signal;
  attachRequestBudget(signal, createRequestBudget(limit));
  return signal;
};

/** A registry of n named dexes, each with a valid deployer, plus the main dex. */
const registryOf = (n: number) => [
  null,
  ...Array.from({ length: n }, (_, i) => ({
    name: `d${i}`, fullName: `Dex ${i}`, deployer: '0x' + '1'.repeat(40), oracleUpdater: null,
  })),
];

/** One position on each of the given named dexes. */
const onDexes = (names: string[], now: number): Record<string, Reply> =>
  Object.fromEntries(
    names.map((n) => [n, reply({ ...emptyState(now), assetPositions: [hlPosition(`${n}:X`, 10, 1_000_000)] })]),
  );

describe('the request limit', () => {
  it('a registry of 20 named dexes, a position on each, stays within the limit', async () => {
    const now = Date.now();
    const sent = stub({
      registry: reply(registryOf(20)),
      main: reply(emptyState(now)),
      dex: onDexes(Array.from({ length: 20 }, (_, i) => `d${i}`), now),
      hl: { frontendOpenOrders: [], spotClearinghouseState: { balances: [] }, userFillsByTime: [] },
    });

    const result = await checkAddress(ABRAXAS, { signal: budgeted() });

    expect(result.positionsVenues).toEqual({ asked: 21, answered: 21, registryRead: true });
    expect(sent.all.length, sent.all.join('\n')).toBeLessThanOrEqual(CHECK_REQUEST_LIMIT);
    expect(result.coverage.join(' ')).toContain(REQUEST_LIMIT_REASON);
    expect(result.ordersCoverage).toBe('partial');
    expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
  });

  it('every Hyperliquid read answering 429 once stays within the limit', async () => {
    const now = Date.now();
    stub({
      main: reply({ ...emptyState(now), assetPositions: [hlPosition('ETH', 10, 100_000_000)] }),
      dex: onDexes(['xyz', 'flx', 'vntl'], now),
      hl: { frontendOpenOrders: [], spotClearinghouseState: { balances: [] }, userFillsByTime: [] },
    });
    const inner = global.fetch;
    const seen = new Set<string>();
    let calls = 0;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls++;
      const key = `${String(url)} ${String(init?.body)}`;
      if (String(url).includes('api.hyperliquid.xyz') && !seen.has(key)) {
        seen.add(key);
        return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
      }
      return inner(url, init);
    }) as unknown as typeof fetch;

    await checkAddress(ABRAXAS, { signal: budgeted() });

    expect(calls).toBeLessThanOrEqual(CHECK_REQUEST_LIMIT);
    // Every distinct read was answered 429 first, so the retries are what was counted.
    expect(seen.size).toBeGreaterThan(10);
  });

  describe('a short on xyz, quoted on both sides, with orders pending on two dexes', () => {
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    const state = (positions: Array<ReturnType<typeof hlPosition>>) => ({ ...emptyState(now), assetPositions: positions });
    const world = () => ({
      main: reply(state([hlPosition('BTC', 10, 1_000_000)])),
      dex: {
        xyz: reply(state([hlPosition('xyz:GOLD', -25_000, 100_000_000)])),
        flx: reply(state([hlPosition('flx:X', 10, 1_000_000)])),
      },
      dexOrders: { xyz: [quote('xyz:GOLD', 'B', '3999', now), quote('xyz:GOLD', 'A', '4001', now)] },
      hl: {
        frontendOpenOrders: [],
        spotClearinghouseState: { balances: [] },
        userFillsByTime: [],
        l2Book: { coin: 'xyz:GOLD', time: now, levels: [[{ px: '3999' }], [{ px: '4001' }]] },
      },
      explorer: explorerInFull(ABRAXAS),
    });
    const run = (limit: number) =>
      checkAddress(ABRAXAS, { explorer: { apiKey: EXPLORER_KEY }, now: () => now, signal: budgeted(limit) });

    it('descriptive reads give way first', async () => {
      // With room to spare the book is read; this is how many requests precede it.
      const free = stub(world());
      await run(1000);
      const beforeBook = free.all.indexOf('hl:l2Book');
      expect(beforeBook).toBeGreaterThan(0);

      // The holdings (3) and funder (9: the explorer's three reads and the two
      // funders' three each) reads are still ahead of a short, so exactly 12
      // left at the book read leaves nothing to spare for it.
      const sent = stub(world());
      const result = await run(beforeBook + 3 + 9);

      expect(sent.all).not.toContain('hl:l2Book');
      expect(result.coverage).toContain(
        'The order book mid was not read: the check kept its remaining requests for the reads that decide the verdict',
      );
      expect(result.coverageNotes.find((n) => n.text.startsWith('The order book mid was not read'))?.failure).toBe(false);
      expect(sent.all).toContain('hl:metaAndAssetCtxs:xyz');
      expect(sent.all).toContain('hl:frontendOpenOrders:xyz');
      expect(sent.all).toContain('hl:frontendOpenOrders:flx');
      // Every holdings read still went out: the account's three, then two funders' three each.
      expect(sent.rpc.filter((r) => r.wallet === ABRAXAS)).toHaveLength(3);
      expect(sent.rpc).toHaveLength(9);
      // The explorer's three: Ethereum, Arbitrum, and the Arbitrum sender's label.
      expect(sent.explorer).toHaveLength(3);
      expect(sent.unrouted).toEqual([]);
      expect(result.coverage.join(' ')).not.toContain(REQUEST_LIMIT_REASON);
    });

    it('the headline dex market data gives way when the reserve would not fit', async () => {
      const free = stub(world());
      await run(1000);
      const beforeMarket = free.all.indexOf('hl:metaAndAssetCtxs:xyz');
      expect(beforeMarket).toBeGreaterThan(0);

      // Two dexes' orders pending and the short's holdings and funder reads
      // (3 + 9) ahead: 2 + 3 + 9 = 14 kept, so 15 left is enough and 14 is not.
      const enough = stub(world());
      await run(beforeMarket + 15);
      expect(enough.all).toContain('hl:metaAndAssetCtxs:xyz');

      const sent = stub(world());
      const result = await run(beforeMarket + 14);
      expect(sent.all.some((r) => r.startsWith('hl:metaAndAssetCtxs:'))).toBe(false);
      expect(result.coverage).toContain(
        'Market data for the xyz dex was not read: the check kept its remaining requests for the reads that decide the verdict',
      );
      expect(sent.all).toContain('hl:frontendOpenOrders:xyz');
      expect(sent.all).toContain('hl:frontendOpenOrders:flx');
    });
  });

  describe('the 30-day PnL, a descriptive read', () => {
    // The same short on xyz, its funding links read from the explorer.
    const now = Date.parse('2026-10-12T12:00:00.000Z');
    const state = (positions: Array<ReturnType<typeof hlPosition>>) => ({ ...emptyState(now), assetPositions: positions });
    const world = () => ({
      main: reply(state([hlPosition('BTC', 10, 1_000_000)])),
      dex: {
        xyz: reply(state([hlPosition('xyz:GOLD', -25_000, 100_000_000)])),
        flx: reply(state([hlPosition('flx:X', 10, 1_000_000)])),
      },
      dexOrders: { xyz: [quote('xyz:GOLD', 'B', '3999', now), quote('xyz:GOLD', 'A', '4001', now)] },
      hl: {
        frontendOpenOrders: [],
        spotClearinghouseState: { balances: [] },
        userFillsByTime: [],
        l2Book: { coin: 'xyz:GOLD', time: now, levels: [[{ px: '3999' }], [{ px: '4001' }]] },
      },
      explorer: explorerInFull(ABRAXAS),
    });
    const run = (limit: number) =>
      checkAddress(ABRAXAS, { explorer: { apiKey: EXPLORER_KEY }, now: () => now, signal: budgeted(limit) });

    it('gives way when the reserve would not fit, and says so as context', async () => {
      const free = stub(world());
      await run(1000);
      const beforePnl = free.all.indexOf('hl:portfolio');
      expect(beforePnl).toBeGreaterThan(0);

      // Two dexes' orders pending and the short's holdings and funder reads
      // (3 + 9) ahead: 2 + 3 + 9 = 14 kept, so 15 left is enough and 14 is not.
      const enough = stub(world());
      await run(beforePnl + 15);
      expect(enough.all).toContain('hl:portfolio');

      const sent = stub(world());
      const result = await run(beforePnl + 14);
      expect(sent.all).not.toContain('hl:portfolio');
      expect(result.pnl).toBeNull();
      expect(result.coverageNotes).toContainEqual({
        text: 'PnL was not read: the check kept its remaining requests for the reads that decide the verdict',
        failure: false,
      });
      // The reads that decide the verdict all went out.
      expect(sent.all).toContain('hl:frontendOpenOrders:xyz');
      expect(sent.all).toContain('hl:frontendOpenOrders:flx');
      expect(sent.explorer).toHaveLength(3);
      expect(sent.rpc).toHaveLength(9);
    });
  });

  it('orders refused by the limit are named', async () => {
    const now = Date.now();
    const world = () => ({
      main: reply({ ...emptyState(now), assetPositions: [hlPosition('ETH', 10, 100_000_000)] }),
      dex: onDexes(['xyz', 'flx', 'vntl'], now),
      hl: { frontendOpenOrders: [], spotClearinghouseState: { balances: [] }, userFillsByTime: [] },
    });
    // Without the optional context: the PnL is a descriptive read, and would
    // give way to these orders when the budget is this short.
    const free = stub(world());
    await checkAddress(ABRAXAS, { includeContext: false, signal: budgeted(1000) });
    const firstOrders = free.all.findIndex((r) => r.startsWith('hl:frontendOpenOrders:'));
    expect(firstOrders).toBeGreaterThan(0);

    // The budget runs out after the first of the three per-dex order reads.
    const sent = stub(world());
    const result = await checkAddress(ABRAXAS, { includeContext: false, signal: budgeted(firstOrders + 1) });

    expect(sent.all.filter((r) => r.startsWith('hl:frontendOpenOrders:'))).toHaveLength(1);
    const refused = result.coverageNotes.filter((n) => n.text.includes(REQUEST_LIMIT_REASON));
    expect(refused).toHaveLength(2);
    expect(refused.every((n) => n.failure && /^Resting orders on the \w+ dex were not read: /.test(n.text))).toBe(true);
    expect(result.ordersCoverage).toBe('partial');
    expect(result.coverage.join(' ')).not.toContain('No two-sided quoting found');
  });

  describe('holdings reads the limit stopped', () => {
    // An ETH short on the main dex: no named-dex market data, no book, so
    // nothing descriptive can give way and the holdings reads come last but
    // for the funder search. `funders` names one funder on each chain.
    const world = (funders: boolean) => ({
      main: reply({ ...emptyState(Date.now()), assetPositions: [hlPosition('ETH', -40_000, 100_000_000)] }),
      hl: { frontendOpenOrders: [], spotClearinghouseState: { balances: [] }, userFillsByTime: [] },
      ...(funders ? { explorer: explorerInFull(ABRAXAS) } : {}),
    });
    const run = (_funders: boolean, limit: number) =>
      checkAddress(ABRAXAS, { explorer: { apiKey: EXPLORER_KEY }, includeContext: false, signal: budgeted(limit) });

    it('names the chains of the account it did not read, with the limit as the reason', async () => {
      const free = stub(world(false));
      await run(false, 1000);
      const firstRead = free.all.indexOf('rpc:ethereum');
      expect(firstRead).toBeGreaterThan(0);

      // Room for Ethereum and Arbitrum only.
      const sent = stub(world(false));
      const result = await run(false, firstRead + 2);

      expect(sent.rpc.map((r) => r.chain)).toEqual(['ethereum', 'arbitrum']);
      expect(result.coverageNotes).toContainEqual({
        text: `Holdings on HyperEVM were not read: ${REQUEST_LIMIT_REASON}`,
        failure: true,
      });
      expect(result.hedgeScope).toBe('known-tokens');
      expect(result.hedgeCoverage).toBe('partial');
      expect(result.verdict.verdict).not.toBe('looks_like_a_bet');
    });

    it('names a funding wallet the limit stopped, with the limit as the reason, never "could not be read"', async () => {
      const free = stub(world(true));
      await run(true, 1000);
      const all = free.all.length;
      expect(free.rpc).toHaveLength(9);

      // The second funder's three reads are the last three requests.
      const none = stub(world(true));
      const refused = await run(true, all - 3);
      expect(none.rpc).toHaveLength(6);
      expect(refused.coverageNotes).toContainEqual({
        text: `One linked wallet was not read: ${REQUEST_LIMIT_REASON}`,
        failure: true,
      });
      expect(refused.coverage.join(' ')).not.toContain('could not be read');
      expect(refused.linkedHedgeCoverage).toBe('partial');
      expect(refused.linkedHedge?.funders).toHaveLength(1);

      // Room for the second funder's Ethereum read only.
      const some = stub(world(true));
      const partly = await run(true, all - 2);
      expect(some.rpc).toHaveLength(7);
      expect(partly.coverageNotes).toContainEqual({
        text: `A funding wallet's holdings on Arbitrum and HyperEVM were not read: ${REQUEST_LIMIT_REASON}, so its holdings may be understated`,
        failure: true,
      });
      expect(partly.coverage.join(' ')).not.toContain('could not be read');
      expect(partly.linkedHedgeCoverage).toBe('partial');
      expect(partly.linkedHedge?.funders).toHaveLength(2);
    });
  });
});
