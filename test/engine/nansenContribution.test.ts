// The 23.09 audit's "show Nansen's contribution" and "next checkable
// question", held to four real readings made on 24 September - one of each
// kind of answer - rather than to hand-built inputs.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { nansenContribution } from '../../src/engine/nansenContribution';
import { openQuestion } from '../../src/engine/openQuestion';
import featuredData from '../../data/featured.json';
import galleryData from '../../data/gallery.json';
import type { Gallery } from '../../src/gallery';
import type { CheckResponse } from '../../src/api/check';
import worker from '../../src/index';
import { testEnv, request } from '../support/worker';

const featured = featuredData as unknown as Gallery;
const gallery = galleryData as unknown as Gallery;
// The readings the page shows; one read again is kept at its own id only.
const shown = featured.entries.filter((e) => !e.superseded);
const byReason = (reason: string) => shown.find((e) => e.verdict.reasons[0] === reason)!;
const bet = byReason('directional_concentration');
const hedged = byReason('hedge_leg');
const funded = byReason('linked_exposure_unverified');
const book = shown.find((e) => e.verdict.verdict === 'book')!;

afterEach(() => vi.restoreAllMocks());

describe('what Nansen added to a reading', () => {
  it('names the funding links as what withholds the verdict, by running the same rules without them', () => {
    const c = nansenContribution(funded)!;
    expect(c.lead).toMatch(/^2 funding wallets hold \$443\.7M of ETH; without them this would read as "Looks like a bet"$/);
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
    expect(card.nansen.lead).toContain('without them this would read as');
  });

  it('on a live check, counting the calls that check really made', async () => {
    const HL: Record<string, unknown> = {
      frontendOpenOrders: [],
      spotClearinghouseState: { balances: [] },
      spotMetaAndAssetCtxs: [{ tokens: [], universe: [] }, []],
      userFillsByTime: [],
      metaAndAssetCtxs: [{ universe: [] }, []],
      clearinghouseState: { assetPositions: [], time: Date.now() },
    };
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('api.nansen.ai')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'x-nansen-credits-cost': '1', 'x-nansen-credits-remaining': '900' },
        });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify(HL[body.type] ?? []), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await worker.fetch(
      request('/api/check?address=0x1111111111111111111111111111111111111111', { method: 'POST' }),
      testEnv({ NANSEN_API_KEY: 'k' }),
    );
    const body = (await res.json()) as { nansenCalls: number; nansen: { calls: number } };
    expect(body.nansenCalls).toBeGreaterThan(0);
    expect(body.nansen.calls).toBe(body.nansenCalls);
  });
});
