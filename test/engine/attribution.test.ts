// Every share, embed and picture credits the sources the reading itself used.
// A reading made with Nansen keeps the Nansen credit it always had; one made
// since the Nansen client was removed names only Hyperliquid, the public
// nodes and the block explorer, and only the ones it actually read.
import { describe, expect, it } from 'vitest';
import { attributionOf } from '../../src/engine/attribution';
import type { CheckResponse } from '../../src/api/check';
import featuredData from '../../data/featured.json';
import galleryData from '../../data/gallery.json';
import type { Gallery } from '../../src/gallery';

type Input = Parameters<typeof attributionOf>[0];

const NANSEN_CREDIT = { publisher: 'Powered by Nansen API', post: 'Powered by @nansen_ai', card: 'Powered by Nansen API' };

const explorerItem = { label: 'Linked wallets', value: '$363.1M ETH in 1 wallet, owner unconfirmed', source: 'Explorer + On-chain' as const };
const hlItem = { label: 'Largest position', value: '$100.0M ETH short', source: 'Hyperliquid' as const };
const VENUES = { asked: 11, answered: 11, registryRead: true };
const FUNDERS = { linkedHedgeUsd: 0, linkedHedgeRatio: 0, funders: [{ address: '0xed0c6079229e2d407672a117c22b62064f4a4312', relation: 'First Funder', chain: 'ethereum', matchingUsd: 0 }] };

function reading(overrides: Partial<Input> = {}): Input {
  return { source: 'hyperliquid', hedgeScope: 'known-tokens', linkedHedge: null, vitals: [], evidence: [hlItem], ...overrides };
}

describe('attributionOf', () => {
  it('keeps the Nansen credit exactly for a reading made with Nansen, whatever else it carries', () => {
    const expected = { publisher: 'Powered by Nansen API', post: 'Powered by @nansen_ai', card: 'Powered by Nansen API' };
    expect(attributionOf(reading({ source: 'nansen', hedgeScope: 'all-chains' }))).toEqual(expected);
    // Even a reading that also carries explorer or public-node sources: the source decides.
    expect(attributionOf(reading({ source: 'nansen', hedgeScope: 'known-tokens', evidence: [explorerItem] }))).toEqual(expected);
    expect(attributionOf(reading({ source: 'nansen', positionsVenues: VENUES, linkedHedge: FUNDERS }))).toEqual(expected);
  });

  it('names only Hyperliquid for a Hyperliquid reading that read no public nodes and no explorer', () => {
    const a = attributionOf(reading({ hedgeScope: 'hyperliquid' }));
    expect(a).toEqual({
      publisher: 'Data: Hyperliquid API',
      post: 'Data: Hyperliquid',
      card: 'Data: Hyperliquid API',
    });
    expect(attributionOf(reading({ hedgeScope: 'none' }))).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/nansen/i);
  });

  it('adds the public nodes and Blockscout for a known-tokens reading with funding links', () => {
    const a = attributionOf(reading({ evidence: [hlItem, explorerItem] }));
    expect(a).toEqual({
      publisher: 'Data: Hyperliquid API, public nodes, Blockscout',
      post: 'Data: Hyperliquid, public nodes, Blockscout',
      card: 'Data: Hyperliquid API, public nodes, Blockscout',
    });
  });

  it('adds Blockscout for an explorer vital as well as for an explorer evidence row', () => {
    const vital = { label: 'Earliest funding found', value: '575 days ago on arbitrum, by an unlabelled wallet', source: 'Explorer' as const };
    expect(attributionOf(reading({ vitals: [vital] })).card).toBe('Data: Hyperliquid API, public nodes, Blockscout');
  });

  it('leaves Blockscout out for a known-tokens reading with no explorer evidence', () => {
    const a = attributionOf(reading());
    expect(a).toEqual({
      publisher: 'Data: Hyperliquid API, public nodes',
      post: 'Data: Hyperliquid, public nodes',
      card: 'Data: Hyperliquid API, public nodes',
    });
  });

  it('credits Blockscout when funders are listed even though the evidence rows (capped at five) do not show them', () => {
    expect(attributionOf(reading({ linkedHedge: FUNDERS })).card).toBe('Data: Hyperliquid API, public nodes, Blockscout');
  });

  // A new reading whose own node reads all failed has scope 'hyperliquid' and still searched its
  // funders: the explorer named them and the nodes read their balances, so both are credited.
  it('names the explorer and the nodes for a new reading with scope hyperliquid whose funders were read', () => {
    const a = attributionOf(reading({ hedgeScope: 'hyperliquid', positionsVenues: VENUES, linkedHedge: FUNDERS, evidence: [explorerItem] }));
    expect(a).toEqual({
      publisher: 'Data: Hyperliquid API, public nodes, Blockscout',
      post: 'Data: Hyperliquid, public nodes, Blockscout',
      card: 'Data: Hyperliquid API, public nodes, Blockscout',
    });
  });

  it('names only Hyperliquid for a new reading with scope hyperliquid that read no funders', () => {
    expect(attributionOf(reading({ hedgeScope: 'hyperliquid', positionsVenues: VENUES })).card).toBe('Data: Hyperliquid API');
  });

  // A reading made by the old Worker can say source 'hyperliquid' (the Nansen positions call did not
  // succeed) and still carry Nansen data: the balances and the funder lookup ran on their own, and
  // both were Nansen's. It has no positionsVenues, and its scope is not known-tokens. The data in it
  // is Nansen's, so it keeps the Nansen credit exactly (final review, I1).
  it('keeps the Nansen credit for an old reading whose funders came from Nansen, even under source hyperliquid', () => {
    for (const hedgeScope of ['all-chains', 'hyperliquid', 'none'] as const) {
      const a = attributionOf(reading({ hedgeScope, linkedHedge: FUNDERS, evidence: [hlItem] }));
      expect(a, hedgeScope).toEqual(NANSEN_CREDIT);
    }
    // With the Nansen-sourced row on the card as well.
    const row = { ...explorerItem, source: 'Nansen + On-chain' as const };
    expect(attributionOf(reading({ hedgeScope: 'hyperliquid', linkedHedge: FUNDERS, evidence: [row] }))).toEqual(NANSEN_CREDIT);
  });

  // The bundled archive has two readings made while the Nansen positions call failed: source
  // 'hyperliquid', two Nansen calls, a Nansen PnL tile. The old rule credited Hyperliquid alone.
  it('keeps the Nansen credit when the reading counts a Nansen call, whatever its source says', () => {
    expect(attributionOf(reading({ hedgeScope: 'none', nansenCalls: 2 }))).toEqual(NANSEN_CREDIT);
    expect(attributionOf(reading({ nansenCalls: 1, positionsVenues: VENUES }))).toEqual(NANSEN_CREDIT);
    // Zero calls and a missing count are not a Nansen call.
    expect(attributionOf(reading({ nansenCalls: 0 })).card).toBe('Data: Hyperliquid API, public nodes');
    expect(attributionOf(reading()).card).toBe('Data: Hyperliquid API, public nodes');
  });

  it('keeps the Nansen credit when any evidence row or vital names Nansen as its source', () => {
    const pnl = { label: 'Realized PnL, 30d', value: '+$1.2M', source: 'Nansen' as const };
    expect(attributionOf(reading({ hedgeScope: 'none', evidence: [hlItem, pnl] }))).toEqual(NANSEN_CREDIT);
    const earliest = { label: 'Earliest funding found', value: '575 days ago on ethereum', source: 'Nansen' as const };
    expect(attributionOf(reading({ hedgeScope: 'none', vitals: [earliest] }))).toEqual(NANSEN_CREDIT);
    // A row read through Nansen's wallet balances.
    expect(attributionOf(reading({ hedgeScope: 'none', evidence: [{ ...hlItem, source: 'Nansen + On-chain' as const }] }))).toEqual(NANSEN_CREDIT);
  });

  it('keeps the Nansen credit for a reading whose scope is all-chains: only Nansen read every chain', () => {
    expect(attributionOf(reading({ hedgeScope: 'all-chains' }))).toEqual(NANSEN_CREDIT);
    expect(attributionOf(reading({ hedgeScope: 'all-chains', positionsVenues: VENUES }))).toEqual(NANSEN_CREDIT);
  });

  it('does not credit Nansen to a new reading that carries no Nansen data anywhere', () => {
    for (const hedgeScope of ['known-tokens', 'hyperliquid', 'none'] as const) {
      const a = attributionOf(reading({ hedgeScope, positionsVenues: VENUES, nansenCalls: 0, linkedHedge: FUNDERS, evidence: [hlItem, explorerItem] }));
      expect(JSON.stringify(a), hedgeScope).not.toMatch(/nansen/i);
    }
  });

  it('uses the one rule that tells a new reading from an old one: known-tokens, or positionsVenues with a source other than Nansen', () => {
    // known-tokens alone is a new reading.
    expect(attributionOf(reading({ hedgeScope: 'known-tokens', linkedHedge: FUNDERS })).card).toBe('Data: Hyperliquid API, public nodes, Blockscout');
    // positionsVenues alone (scope all-chains is impossible for it, but the rule is on the fields) is a new reading.
    expect(attributionOf(reading({ hedgeScope: 'none', positionsVenues: VENUES, linkedHedge: FUNDERS })).card).toBe('Data: Hyperliquid API, public nodes, Blockscout');
    // Neither: an old reading, whose funders came from Nansen.
    expect(attributionOf(reading({ hedgeScope: 'none', linkedHedge: FUNDERS }))).toEqual(NANSEN_CREDIT);
    // Neither, and no funders: nothing Nansen-made on it, so Hyperliquid alone.
    expect(attributionOf(reading({ hedgeScope: 'none' })).card).toBe('Data: Hyperliquid API');
  });

  it('is tolerant of a stored reading that lacks vitals or evidence', () => {
    const old = { source: 'hyperliquid', hedgeScope: 'none', linkedHedge: null } as unknown as Input;
    expect(attributionOf(old).card).toBe('Data: Hyperliquid API');
  });

  it('credits Nansen on every bundled reading that carries Nansen data, and on no other', () => {
    const featured = featuredData as unknown as Gallery;
    const gallery = galleryData as unknown as Gallery;
    for (const entry of [...featured.entries, ...gallery.entries] as unknown as CheckResponse[]) {
      const a = attributionOf(entry);
      const carriesNansen =
        entry.source === 'nansen' ||
        entry.nansenCalls > 0 ||
        [...entry.evidence, ...(entry.vitals ?? [])].some((item) => item.source.includes('Nansen'));
      if (carriesNansen) {
        expect(a, entry.address).toEqual(NANSEN_CREDIT);
      } else {
        expect(JSON.stringify(a), entry.address).not.toMatch(/nansen/i);
      }
    }
  });

  // The two archive readings made while the Nansen positions call failed (source 'hyperliquid',
  // two Nansen calls, a Nansen PnL tile): the credit used to read Hyperliquid alone.
  it('credits Nansen on the two bundled readings that say source hyperliquid and carry Nansen data', () => {
    const gallery = galleryData as unknown as Gallery;
    for (const id of ['9eec98d0-mu7237sy', 'bf732ea0-mu722wzt']) {
      const entry = (gallery.entries as unknown as CheckResponse[]).find((e) => e.snapshotId === id);
      expect(entry, id).toBeDefined();
      expect(entry!.source).toBe('hyperliquid');
      expect(entry!.nansenCalls).toBe(2);
      expect(entry!.evidence.some((e) => e.label === 'Realized PnL, 30d' && e.source === 'Nansen')).toBe(true);
      expect(attributionOf(entry!), id).toEqual(NANSEN_CREDIT);
    }
  });
});
