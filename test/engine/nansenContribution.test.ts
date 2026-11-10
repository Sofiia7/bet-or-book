// The 23.09 audit's "show Nansen's contribution" and "next checkable
// question", held to four real readings made on 24 September - one of each
// kind of answer - rather than to hand-built inputs.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { CLASSIFIER_VERSION } from '../../src/engine/verdict';
import { nansenContribution } from '../../src/engine/nansenContribution';
import { openQuestion } from '../../src/engine/openQuestion';
import featuredData from '../fixtures/featured-september.json';
import galleryData from '../../data/gallery.json';
import type { Gallery } from '../../src/gallery';
import type { CheckResponse } from '../../src/api/check';
import worker from '../../src/index';
import { testEnv, request } from '../support/worker';

const featured = featuredData as unknown as Gallery;
const gallery = galleryData as unknown as Gallery;
// The readings the page shows; one read again is kept at its own id only.
const shown = featured.entries.filter((e) => !e.superseded).map(e => ({ ...e, classifierVersion: CLASSIFIER_VERSION }));
const byReason = (reason: string) => shown.find((e) => e.verdict.reasons[0] === reason)!;
const bet = byReason('directional_concentration');
const hedged = byReason('hedge_leg');
const funded = byReason('linked_exposure_unverified');
const book = shown.find((e) => e.verdict.verdict === 'book')!;

afterEach(() => vi.restoreAllMocks());

describe('what Nansen added to a reading', () => {
  it('names the funding links as what withholds the verdict, by running the same rules without them', () => {
    const c = nansenContribution(funded)!;
    expect(c.lead).toMatch(/^2 funding wallets hold \$395\.8M of ETH; without them this would read as "Looks like a bet"$/);
    expect(c.items.join(' ')).toContain('A funding transfer is not ownership, so none of it is counted.');
    expect(c.calls).toBe(funded.nansenCalls);
  });

  it('says a hedge was only judged once every other chain was read, when the cover itself is Hyperliquid spot', () => {
    const c = nansenContribution(hedged)!;
    expect(c.lead).toBe('every other chain checked, so the Hyperliquid HYPE is the whole cover');
    // On-chain, so it does not read as contradicting the spot HYPE found on
    // Hyperliquid at the same address.
    expect(c.items.join(' ')).toContain('no HYPE on-chain at this address');
  });

  it('says a bet could only be called with every dex read, without claiming Nansen found something else', () => {
    const c = nansenContribution(bet)!;
    expect(c.lead).toBe('every dex read, 1 position in all, which the bet rule needs');
    // A gap closed, not a discovery (the audit's own caution).
    expect(c.items.join(' ')).not.toMatch(/Nansen found|discovered/);
    expect(c.items.join(' ')).toContain('Earliest funding found:');
  });

  it('keeps context as context', () => {
    for (const e of [bet, hedged, funded, book]) {
      const pnl = nansenContribution(e)!.items.find((i) => i.startsWith('Realized PnL'));
      if (pnl) expect(pnl).toContain('no verdict turns on it');
    }
  });

  it('does not invent a counterfactual where the rules have changed since the reading', () => {
    const old = gallery.entries.find((e) => e.historical && e.linkedHedge && e.linkedHedge.linkedHedgeUsd > 0);
    if (old) expect(nansenContribution(old)!.lead).not.toContain('without them');
  });

  it('says plainly when Nansen was not used', () => {
    const fallback = gallery.entries.find((e) => e.source === 'hyperliquid' && e.positions.nPositions > 0)!;
    const c = nansenContribution(fallback)!;
    expect(c.lead).toBe('not used for this reading');
    expect(c.items.join(' ')).toContain('main dex only');
  });

  it('names the exact position-count gap against Hyperliquid\'s own main dex when it is known', () => {
    const withGap = { ...book, mainDexPositionCount: 86 } as CheckResponse;
    const c = nansenContribution(withGap)!;
    const positionsLine = c.items.find((i) => i.startsWith('Positions on every'))!;
    expect(positionsLine).toContain('86 positions on the main dex alone');
  });

  it('falls back to the general sentence when the comparison was never read', () => {
    const noGap = { ...book, mainDexPositionCount: null } as CheckResponse;
    const c = nansenContribution(noGap)!;
    const positionsLine = c.items.find((i) => i.startsWith('Positions on every'))!;
    expect(positionsLine).toContain("Hyperliquid's own free endpoint reads the main dex only.");
  });

  it('A06 (25.09 audit): does not claim the funders hold nothing when the funder read itself failed or was incomplete', () => {
    for (const linkedHedgeCoverage of ['missing', 'partial'] as const) {
      const notComplete = {
        ...book,
        linkedHedge: { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] },
        linkedHedgeCoverage,
      } as CheckResponse;
      const c = nansenContribution(notComplete)!;
      expect(c.items.join(' ')).not.toContain('Funding links: read; the wallets that funded this account hold no');
      expect(c.items.join(' ')).toContain('Funding links: could not be read in full, so whether the funding wallets hold');
    }
  });

  it('A06 (25.09 audit): still says the funders hold nothing when the funder read genuinely completed (regression guard)', () => {
    const complete = {
      ...book,
      linkedHedge: { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] },
      linkedHedgeCoverage: 'complete',
    } as CheckResponse;
    const c = nansenContribution(complete)!;
    expect(c.items.join(' ')).toContain('Funding links: read; the wallets that funded this account hold no');
  });

  it('A06 follow-up (spec review): says nothing about funding links rather than a false claim when linkedHedgeCoverage was never set', () => {
    // A real, reachable shape: a superseded gallery entry frozen before this
    // field existed. The fix must fail safe here the same way the sibling
    // hedgeCoverage block already does - three positive checks, no catch-all
    // else - rather than let an unset value fall through as "complete".
    const { linkedHedgeCoverage: _drop, ...bookWithoutCoverage } = book;
    const unset = {
      ...bookWithoutCoverage,
      linkedHedge: { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] },
    } as unknown as CheckResponse;
    const c = nansenContribution(unset)!;
    expect(c.items.some((i) => i.startsWith('Funding links:'))).toBe(false);
  });

  it('A06 follow-up (spec review): says the funding-links figure is a floor when the search itself was only partly complete', () => {
    const partial = {
      ...book,
      linkedHedge: {
        linkedHedgeUsd: 5_000_000,
        linkedHedgeRatio: 0.5,
        funders: [{ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', relation: 'First Funder', chain: 'ethereum', matchingUsd: 5_000_000 }],
      },
      linkedHedgeCoverage: 'partial',
    } as CheckResponse;
    const c = nansenContribution(partial)!;
    const line = c.items.find((i) => i.startsWith('Funding links:'))!;
    expect(line).toContain('so this is a floor');
  });
});

// A reading made after positions came from every Hyperliquid dex: it carries
// `positionsVenues`, and `source` is 'nansen' only when Nansen supplied
// something other than the positions. Built from the stored readings above.
const venues = { asked: 6, answered: 6, registryRead: true };
const newStyle = (base: CheckResponse, over: Partial<CheckResponse> = {}): CheckResponse =>
  ({ ...base, positionsVenues: venues, ...over }) as CheckResponse;

describe('what Nansen added to a reading made with positions from every dex', () => {
  it('new reading, Nansen not used: says positions need no Nansen and claims nothing about the main dex', () => {
    const r = newStyle(book, {
      source: 'hyperliquid',
      nansenCalls: 0,
      coverage: ['Nansen not used (credit cap reached): no balances on other chains, no linked wallets'],
    });
    const c = nansenContribution(r)!;
    expect(c.lead).toBe('not used for this reading');
    expect(c.calls).toBe(0);
    expect(c.items).toEqual([
      'Nansen not used (credit cap reached): no balances on other chains, no linked wallets.',
      'Positions are read from Hyperliquid dex by dex, which needs no Nansen. Balances on other chains and links ' +
        'between wallets were not read, so a hedge held off Hyperliquid is not visible.',
    ]);
    expect(c.items.join(' ')).not.toContain('main dex');
    expect(c.items.join(' ')).not.toContain('free endpoint');
  });

  it('new reading with nothing about Nansen to explain: a reading made now, so no contribution at all', () => {
    // Since the funding links moved to the block explorer, a reading from
    // every dex with no Nansen source and no Nansen note is one Nansen had
    // nothing to do with: "not used" would imply its links were not read.
    expect(nansenContribution(newStyle(book, { source: 'hyperliquid', nansenCalls: 0, coverage: [] }))).toBeNull();
  });

  it('new reading, Nansen stopped partway: the why line is the stopped-partway note', () => {
    const r = newStyle(book, {
      source: 'hyperliquid',
      coverage: ['Nansen stopped partway (credit cap reached): some balances on other chains were not read'],
    });
    const c = nansenContribution(r)!;
    expect(c.lead).toBe('not used for this reading');
    expect(c.items[0]).toBe('Nansen stopped partway (credit cap reached): some balances on other chains were not read.');
  });

  it('new reading, a note that already ends with a period: the why line does not add a second one', () => {
    const note =
      'Nansen did not answer this time. This reading is Hyperliquid-only: balances on other chains, PnL and funding links may be missing. Try again in a minute.';
    const c = nansenContribution(newStyle(book, { source: 'hyperliquid', nansenCalls: 0, coverage: [note] }))!;
    expect(c.items[0]).toBe(note);
    expect(c.items[0]).not.toMatch(/\.\.$/);
  });

  it('new reading with other-chain balances: has no item starting with "Positions on every" and still has the balances item', () => {
    const c = nansenContribution(newStyle(hedged))!;
    expect(c.items.some((i) => i.startsWith('Positions on every'))).toBe(false);
    expect(c.items.join(' ')).not.toContain('main dex');
    expect(c.items.join(' ')).not.toContain('bet rule');
    const balances = c.items.find((i) => i.startsWith('Balances on every chain Nansen covers:'))!;
    expect(balances).toContain('no HYPE on-chain at this address');
    expect(c.lead).toBe('every other chain checked, so the Hyperliquid HYPE is the whole cover');
  });

  it('new reading with funding links: keeps the funding-links item and its counterfactual lead, with no positions item', () => {
    const c = nansenContribution(newStyle(funded))!;
    expect(c.items.some((i) => i.startsWith('Positions on every'))).toBe(false);
    expect(c.items.join(' ')).toContain('A funding transfer is not ownership, so none of it is counted.');
    expect(c.lead).toMatch(/^2 funding wallets hold \$395\.8M of ETH; without them this would read as "Looks like a bet"$/);
  });

  it('new reading with only PnL: lead is the context fallback', () => {
    // The bet fixture, with Nansen's other contributions taken away: only the
    // realized PnL, which sets no lead of its own, is left.
    const onlyPnl = newStyle(bet, {
      vitals: bet.vitals.filter((v) => v.label !== 'Earliest funding found'),
    });
    const c = nansenContribution(onlyPnl)!;
    expect(c.lead).toBe('context from other chains and funding history');
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatch(/^Realized PnL.*Context; no verdict turns on it\.$/);
  });

  it('new reading with no Nansen items returns null', () => {
    const none = newStyle(bet, {
      vitals: bet.vitals.filter((v) => v.label !== 'Earliest funding found'),
      evidence: bet.evidence.filter((e) => !e.label.startsWith('Realized PnL')),
    });
    expect(nansenContribution(none)).toBeNull();
  });

  it('does not credit Nansen with a PnL tile that Hyperliquid supplied', () => {
    // Since the PnL moved to Hyperliquid's portfolio, a reading's PnL tile is
    // Hyperliquid's; only a saved reading still carries the Nansen one.
    const hyperliquidPnl = { label: 'Perp PnL, 30d (realized and unrealized)', value: '$85.2M', source: 'Hyperliquid' as const };
    const swapped = newStyle(bet, {
      vitals: bet.vitals.filter((v) => v.label !== 'Earliest funding found'),
      evidence: [...bet.evidence.filter((e) => !e.label.startsWith('Realized PnL')), hyperliquidPnl],
    });
    expect(nansenContribution(swapped)).toBeNull();
    // The same reading with the old tile still lists it.
    const old = nansenContribution(newStyle(bet, { vitals: bet.vitals.filter((v) => v.label !== 'Earliest funding found') }))!;
    expect(old.items.some((i) => i.startsWith('Realized PnL, 30d'))).toBe(true);
  });

  it('new reading with no positions and no Nansen calls still returns null first', () => {
    const empty = newStyle(book, {
      source: 'hyperliquid',
      nansenCalls: 0,
      positions: { ...book.positions, nPositions: 0 },
    });
    expect(nansenContribution(empty)).toBeNull();
  });

  it('a reading without positionsVenues is unchanged', () => {
    const before = nansenContribution(bet)!;
    expect(before.lead).toBe('every dex read, 1 position in all, which the bet rule needs');
    expect(before.items[0]).toMatch(/^Positions on every Hyperliquid dex, HIP-3 included: 1 open position/);
    // The same reading plus the field is the new style: no positions item.
    const after = nansenContribution(newStyle(bet))!;
    expect(after.items.some((i) => i.startsWith('Positions on every'))).toBe(false);
    expect(after.lead).not.toBe(before.lead);
  });
});

describe('what a reading leaves open', () => {
  it('asks the question each answer leaves, in this reading\'s own terms', () => {
    expect(openQuestion(hedged)).toMatch(/^whether any of that HYPE is owed to someone/);
    expect(openQuestion(funded)).toMatch(/^who controls the wallets that funded this account/);
    expect(openQuestion(book)).toMatch(/^whether this ETH short is inventory/);
    expect(openQuestion(bet)).toMatch(/exchange, agreed over the counter/);
  });

  it('does not let a reading taken before loans were looked for imply that none were found', () => {
    // The same account, read twice on 24 September: in the morning, before
    // loans on Hyperliquid were looked for, and again once they were. It
    // owes USDC there, and "listed with the reading" would have turned the
    // morning's silence into a "none".
    const morning = featured.entries.find((e) => e.superseded && e.address === hedged.address)!;
    expect(morning.observationSchemaVersion).toBe(4);
    expect(openQuestion(morning)).toContain('Debts are not read here');
    expect(openQuestion(morning)).not.toContain('listed with the reading');
    expect(morning.coverage.join(' ')).not.toContain('Borrowed on Hyperliquid');

    expect(hedged.observationSchemaVersion).toBe(5);
    expect(openQuestion(hedged)).toContain('A loan on Hyperliquid itself is listed with the reading');
    expect(openQuestion(hedged)).toContain('a debt anywhere else is not read');
    expect(hedged.coverage.join(' ')).toMatch(/Borrowed on Hyperliquid under portfolio margin: [\d,]+ USDC/);
  });

  it('has a question for every reason the current rules return', () => {
    const source = readFileSync(new URL('../../src/engine/verdict.ts', import.meta.url), 'utf8');
    const codes = new Set<string>();
    for (const [, list] of source.matchAll(/decided\([^;]*?(\[[^\]]*\])\)/g)) {
      for (const [, code] of list.matchAll(/'([^']+)'/g)) codes.add(code);
    }
    for (const code of codes) {
      if (code === 'no open positions found') continue;
      const reading = { ...bet, verdict: { verdict: 'unknown', strength: null, reasons: [code] } } as CheckResponse;
      expect(openQuestion(reading), code).toEqual(expect.any(String));
    }
  });

  it('asks nothing when nothing is open', () => {
    const empty = { ...bet, verdict: { verdict: 'unknown', strength: null, reasons: ['no open positions found'] } } as CheckResponse;
    expect(openQuestion(empty)).toBeNull();
  });
});

describe('served with every reading', () => {
  it('on a saved reading opened by its link', async () => {
    const card = (await (await worker.fetch(request(`/api/snapshot?id=${funded.snapshotId}`), testEnv())).json()) as {
      openQuestion: string;
      nansen: { lead: string; calls: number };
    };
    expect(card.openQuestion).toMatch(/^who controls/);
    expect(card.nansen.lead).toContain('funding wallets hold');
  });

  it('on a live check: no Nansen call, so no Nansen section', async () => {
    // One small long: when the account was first funded is read from the
    // block explorer now, and the 30-day PnL is Hyperliquid's `portfolio`.
    // Nothing asks Nansen; a request to it would be counted here.
    const btcLong = {
      type: 'oneWay',
      position: {
        coin: 'BTC', szi: '500', entryPx: '100000', leverage: { type: 'cross', value: 5 }, liquidationPx: null,
        positionValue: '50000000', unrealizedPnl: '0', cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
        marginUsed: '0', maxLeverage: 20, returnOnEquity: '0',
      },
    };
    const HL: Record<string, unknown> = {
      frontendOpenOrders: [],
      spotClearinghouseState: { balances: [] },
      spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
      userFillsByTime: [],
      metaAndAssetCtxs: [{ universe: [] }, []],
      clearinghouseState: { assetPositions: [btcLong], time: Date.now() },
    };
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('nansen')) return new Response('{}', { status: 500 });
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await worker.fetch(
      request('/api/check?address=0x1111111111111111111111111111111111111111', { method: 'POST' }),
      testEnv(),
    );
    const body = (await res.json()) as { nansenCalls: number; nansen: unknown };
    expect(body.nansenCalls).toBe(0);
    expect(body.nansen).toBeNull();
    expect(vi.mocked(global.fetch).mock.calls.filter(([u]) => String(u).includes('nansen'))).toEqual([]);
  });
});

describe('a reading made after the funding links moved to the block explorer', () => {
  it('a known-tokens reading had nothing from Nansen: no contribution at all', () => {
    const r = {
      ...funded,
      positionsVenues: venues,
      hedgeScope: 'known-tokens' as const,
      source: 'hyperliquid' as const,
      nansenCalls: 0,
      coverage: [],
      evidence: funded.evidence.map((e) => (e.label === 'Linked wallets' ? { ...e, source: 'Explorer + On-chain' as const } : e)),
    } as CheckResponse;
    expect(nansenContribution(r)).toBeNull();
  });

  it('a long read from every dex, its funding history from the explorer: no contribution', () => {
    const r = newStyle(bet, {
      source: 'hyperliquid',
      nansenCalls: 0,
      hedgeScope: 'none',
      coverage: [],
      vitals: bet.vitals.map((v) => (v.label === 'Earliest funding found' ? { ...v, source: 'Explorer' as const } : v)),
      evidence: bet.evidence.filter((e) => !e.label.startsWith('Realized PnL')),
    });
    expect(nansenContribution(r)).toBeNull();
  });

  it('a saved all-chains reading keeps what it said', () => {
    expect(funded.hedgeScope).toBe('all-chains');
    const c = nansenContribution(funded)!;
    expect(c.lead).toMatch(/^2 funding wallets hold \$395\.8M of ETH; without them this would read as "Looks like a bet"$/);
    expect(c.calls).toBe(funded.nansenCalls);
  });
});

describe('a known-tokens reading has nothing from Nansen to list', () => {
  const linked = (over: Partial<CheckResponse>) =>
    ({ ...book, hedgeScope: 'known-tokens', ...over }) as CheckResponse;
  const noFunders = { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [] };

  // Its other-chain balances are the public nodes', its funding links the
  // explorer's (Task 3 of stage 3), so whatever else it carries the section
  // is not shown.
  it('is null whatever its funders hold and however its search went', () => {
    for (const r of [
      { ...hedged, hedgeScope: 'known-tokens' as const },
      { ...funded, hedgeScope: 'known-tokens' as const },
      { ...funded, hedgeScope: 'known-tokens' as const, classifierVersion: 'old', linkedHedgeCoverage: 'partial' as const },
      linked({ linkedHedge: noFunders, linkedHedgeCoverage: 'missing' }),
      linked({ linkedHedge: noFunders, linkedHedgeCoverage: 'partial' }),
      linked({ linkedHedge: noFunders, linkedHedgeCoverage: 'complete' }),
      newStyle(bet, { hedgeScope: 'known-tokens' }),
      newStyle(book, { hedgeScope: 'known-tokens', source: 'hyperliquid', nansenCalls: 0, coverage: [] }),
    ] as CheckResponse[]) {
      expect(nansenContribution(r)).toBeNull();
    }
  });

  it('an all-chains reading keeps the old funding item and lead verbatim', () => {
    const c = nansenContribution({ ...funded, hedgeScope: 'all-chains' as const })!;
    expect(c.lead).toBe('2 funding wallets hold $395.8M of ETH; without them this would read as "Looks like a bet"');
    const item = c.items.find((i) => i.startsWith('Funding links'))!;
    expect(item).toMatch(/^Funding links: 2 wallets that funded this account hold \$395\.8M of ETH, on \w[\w ]*\. A funding transfer is not ownership, so none of it is counted\. Without these links, the same numbers would read as "Looks like a bet"\.$/);
    expect(c.items.join(' ')).not.toContain('public node');
  });
});

describe('what Nansen added to a reading with positions from every dex, by scope', () => {
  const noFunding = (r: CheckResponse) => r.vitals.filter((v) => v.label !== 'Earliest funding found');

  it('keeps the old fallback lead for an all-chains reading', () => {
    const c = nansenContribution(newStyle(bet, { hedgeScope: 'all-chains', vitals: noFunding(bet) }))!;
    expect(c.lead).toBe('context from other chains and funding history');
  });

  it('a hyperliquid-scope reading that says Nansen was not used keeps the old sentence verbatim', () => {
    const note = 'Nansen not used: no linked wallets';
    const c = nansenContribution(newStyle(book, { hedgeScope: 'hyperliquid', source: 'hyperliquid', nansenCalls: 0, coverage: [note] }))!;
    expect(c.items).toEqual([
      `${note}.`,
      'Positions are read from Hyperliquid dex by dex, which needs no Nansen. Balances on other chains and links ' +
        'between wallets were not read, so a hedge held off Hyperliquid is not visible.',
    ]);
  });
});
