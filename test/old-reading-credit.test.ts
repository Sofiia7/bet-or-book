// Final review of stage 3, I1: an old saved reading keeps the credit for the
// data it carries. Two readings in the bundled archive were made while the
// Nansen positions call failed: their `source` says 'hyperliquid', yet they
// count two Nansen calls and print a Realized PnL tile whose source is Nansen.
// Every surface that prints a credit has to say Nansen for them - the reading
// as the page receives it, the publisher DTO and the embed, the picture - and
// a reading made without Nansen must still not.
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { testEnv, request } from './support/worker';
import galleryData from '../data/gallery.json';
import type { Gallery } from '../src/gallery';
import type { CheckResponse } from '../src/api/check';
import { publisherReading, publisherEmbed } from '../src/publisher';
import { ogCardFor } from '../src/engine/ogCard';
import { attributionOf } from '../src/engine/attribution';

const OLD_IDS = ['9eec98d0-mu7237sy', 'bf732ea0-mu722wzt'];
const NANSEN = { publisher: 'Powered by Nansen API', post: 'Powered by @nansen_ai', card: 'Powered by Nansen API' };
const gallery = galleryData as unknown as Gallery;
const oldReading = (id: string): CheckResponse => {
  const entry = (gallery.entries as unknown as CheckResponse[]).find((e) => e.snapshotId === id);
  if (!entry) throw new Error(`the bundled archive no longer holds ${id}`);
  return entry;
};
const ORIGIN = 'https://bet-or-book.trade';

describe('the two bundled readings that say source hyperliquid but carry Nansen data', () => {
  it('are what the review described', () => {
    for (const id of OLD_IDS) {
      const r = oldReading(id);
      expect(r.source, id).toBe('hyperliquid');
      expect(r.nansenCalls, id).toBe(2);
      expect(r.evidence.find((e) => e.label === 'Realized PnL, 30d')?.source, id).toBe('Nansen');
    }
  });

  it('are credited to Nansen by the rule itself', () => {
    for (const id of OLD_IDS) expect(attributionOf(oldReading(id)), id).toEqual(NANSEN);
  });

  it('print the Nansen credit in the publisher DTO and the embed', () => {
    for (const id of OLD_IDS) {
      expect(publisherReading(oldReading(id), id, ORIGIN).attribution, id).toBe('Powered by Nansen API');
      expect(publisherEmbed(oldReading(id), id, ORIGIN), id).toContain('Powered by Nansen API · This tool never trades.');
    }
  });

  it('print the Nansen credit on the picture, drawn as a gallery card', () => {
    for (const id of OLD_IDS) expect(ogCardFor(oldReading(id), 'gallery').footerRight, id).toBe('Powered by Nansen API');
  });

  // explained() in src/index.ts is not exported: it is what /api/snapshot,
  // /api/gallery's cards and every other served reading go through.
  it('print the Nansen credit in the reading the Worker serves, and in its public routes', async () => {
    const env = testEnv();
    for (const id of OLD_IDS) {
      const served = (await (await worker.fetch(request(`/api/snapshot?id=${id}`), env)).json()) as { attribution: unknown };
      expect(served.attribution, id).toEqual(NANSEN);
      const dto = (await (await worker.fetch(request(`/api/v1/readings/${id}`), env)).json()) as { attribution: string };
      expect(dto.attribution, id).toBe('Powered by Nansen API');
      const embed = await (await worker.fetch(request(`/embed?s=${id}`), env)).text();
      expect(embed, id).toContain('Powered by Nansen API · This tool never trades.');
    }
  });
});

describe('a reading made without Nansen', () => {
  // The first bundled reading to carry nothing of Nansen's, reshaped as a
  // reading made now: venues read, no Nansen call, no Nansen source anywhere.
  const base = oldReading(OLD_IDS[1]);
  const fresh: CheckResponse = {
    ...base,
    source: 'hyperliquid',
    hedgeScope: 'known-tokens',
    positionsVenues: { asked: 11, answered: 11, registryRead: true },
    nansenCalls: 0,
    nansen: null,
    evidence: base.evidence.map((e) => ({ ...e, source: 'Hyperliquid' as const })),
    vitals: (base.vitals ?? []).map((v) => ({ ...v, source: 'Hyperliquid' as const })),
  };

  it('still carries no Nansen credit on any surface', () => {
    const credit = attributionOf(fresh);
    expect(credit).toEqual({
      publisher: 'Data: Hyperliquid API, public nodes',
      post: 'Data: Hyperliquid, public nodes',
      card: 'Data: Hyperliquid API, public nodes',
    });
    expect(publisherReading(fresh, OLD_IDS[1], ORIGIN).attribution).toBe(credit.publisher);
    expect(publisherEmbed(fresh, OLD_IDS[1], ORIGIN)).toContain(`${credit.publisher} · This tool never trades.`);
    expect(ogCardFor(fresh, 'saved').footerRight).toBe(credit.card);
    expect(JSON.stringify(credit)).not.toMatch(/nansen/i);
  });
});
