// A real bug, caught on a dry run before this fix ever shipped: a second
// pass of scripts/reexplain.ts re-judged an entry it had already frozen as
// a superseded historical record, decided its frozen verdict had "changed"
// (of course it had - the current rules were run over 2026-09-23-era inputs
// a second time), and minted a new id equal to the one already handed to
// the reading that had in fact replaced it. Two different cards, one id.
import { describe, expect, it } from 'vitest';
import galleryData from '../data/gallery.json';
import { reexplainGallery } from '../scripts/reexplain';
import type { Gallery } from '../src/gallery';

const gallery = galleryData as unknown as Gallery;

/** A real, complete entry as the base, so the fixture is a valid
 * CheckResponse without hand-declaring every one of its fields. */
function baseEntry(): Gallery['entries'][number] {
  const found = gallery.entries.find(
    (e) => !e.superseded && !e.historical && e.verdict.verdict === 'looks_like_a_bet' && e.positions.nPositions > 0,
  );
  if (!found) throw new Error('fixture needs a judged looks_like_a_bet entry in data/gallery.json');
  return found;
}

describe('reexplainGallery does not corrupt a gallery it is run over twice (23.09 audit, L03)', () => {
  it('forks a changed verdict into a new id once, and leaves the pair alone on a second pass', () => {
    const entry = {
      ...baseEntry(),
      // A verdict the current rules will not reproduce from these same
      // inputs, so the first pass is guaranteed to see a change and fork.
      verdict: {
        verdict: 'unknown' as const,
        strength: null,
        reasons: ['signals disagree: not enough evidence for book, hedge, or bet'],
      },
      classifierVersion: 'v1',
      snapshotId: 'fixture-original-id',
      superseded: undefined,
      supersedes: undefined,
      supersededBy: undefined,
      previousInterpretation: undefined,
    };
    const gallery1: Gallery = { scannedAt: null, finishedAt: null, universe: 'test', entries: [entry] };

    const pass1 = reexplainGallery(gallery1, '2026-09-24T00:00:00.000Z');
    expect(pass1.stats.reverdicted).toBe(1);
    expect(pass1.stats.forked).toBe(1);
    expect(pass1.gallery.entries).toHaveLength(2);
    const ids1 = pass1.gallery.entries.map((e) => e.snapshotId).sort();
    expect(new Set(ids1).size).toBe(2);
    const old = pass1.gallery.entries.find((e) => e.superseded);
    const current = pass1.gallery.entries.find((e) => !e.superseded);
    expect(old?.snapshotId).toBe('fixture-original-id');
    expect(old?.verdict.verdict).toBe('unknown');
    expect(current?.verdict.verdict).toBe('looks_like_a_bet');
    expect(current?.supersedes).toBe('fixture-original-id');
    expect(old?.supersededBy).toBe(current?.snapshotId);

    const pass2 = reexplainGallery(pass1.gallery, '2026-09-24T01:00:00.000Z');
    // The regression this test exists for: neither entry should move again.
    expect(pass2.stats.alreadySuperseded).toBe(1);
    expect(pass2.stats.reverdicted).toBe(0);
    expect(pass2.stats.forked).toBe(0);
    expect(pass2.gallery.entries).toHaveLength(2);
    const ids2 = pass2.gallery.entries.map((e) => e.snapshotId).sort();
    expect(new Set(ids2).size).toBe(2);
    expect(ids2).toEqual(ids1);
  });

  it('does not fork a wording-only change: the verdict word staying the same updates in place', () => {
    // Same verdict word and reasons, so JSON.stringify(verdict) is identical
    // and nothing here should mint a second id for a summary-text tweak.
    const real = baseEntry();
    const entry = { ...real, snapshotId: 'fixture-wording-id' };
    const gallery1: Gallery = { scannedAt: null, finishedAt: null, universe: 'test', entries: [entry] };

    const pass1 = reexplainGallery(gallery1, '2026-09-24T00:00:00.000Z');
    expect(pass1.stats.reverdicted).toBe(0);
    expect(pass1.stats.forked).toBe(0);
    expect(pass1.gallery.entries).toHaveLength(1);
    expect(pass1.gallery.entries[0].snapshotId).toBe('fixture-wording-id');
  });
});
