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

describe('a historical or superseded reading gets a real dataQuality instead of none at all (technical debt from the 25.09 audit follow-up)', () => {
  // Both tests below take a real entry and strip `dataQuality` off a copy of
  // its breakdown, rather than searching data/gallery.json for one that is
  // still missing it outright: this file's own regeneration step
  // (scripts/reexplain.ts, run over data/gallery.json as part of shipping
  // this very fix) stamps every entry that lacks the field the moment it is
  // built, so after that has run once - which it has, in this repo - no
  // entry missing the field is left to find. Searching for one would make
  // this test pass today and fail permanently from the next regeneration
  // on, which is the opposite of what a regression test is for. Stripping a
  // copy's field keeps the rest of a real, authentic entry (verdict,
  // classifierVersion, coverage notes and all) while still exercising the
  // exact "predates the field" case this task exists to fix.
  it('stamps a historical entry\'s breakdown with dataQuality: unknown, without touching its frozen verdict (technical debt from the 25.09 audit follow-up)', () => {
    const real = gallery.entries.find((e) => e.historical && e.breakdown?.applies);
    if (!real) throw new Error('fixture needs a historical entry with breakdown.applies in data/gallery.json');
    const entry = {
      ...real,
      breakdown: { ...real.breakdown, dataQuality: undefined },
    } as unknown as Gallery['entries'][number];
    const before = JSON.stringify(entry.verdict);
    const singleEntryGallery: Gallery = { scannedAt: null, finishedAt: null, universe: 'test', entries: [entry] };
    const result = reexplainGallery(singleEntryGallery, '2026-09-25T00:00:00.000Z');
    expect(result.gallery.entries[0].breakdown?.dataQuality).toBe('unknown');
    expect(JSON.stringify(result.gallery.entries[0].verdict)).toBe(before);
    expect(result.gallery.entries[0].classifierVersion).toBe(entry.classifierVersion);
    expect(result.stats.historical).toBe(1);
    expect(result.stats.reverdicted).toBe(0);
    expect(result.stats.forked).toBe(0);
  });

  it('stamps a superseded entry\'s frozen breakdown with dataQuality: unknown too, without reviving it into a fresh judgement', () => {
    const real = gallery.entries.find((e) => e.superseded && e.breakdown?.applies);
    if (!real) throw new Error('fixture needs a superseded entry with breakdown.applies in data/gallery.json');
    const entry = {
      ...real,
      breakdown: { ...real.breakdown, dataQuality: undefined },
    } as unknown as Gallery['entries'][number];
    const before = JSON.stringify(entry.verdict);
    const singleEntryGallery: Gallery = { scannedAt: null, finishedAt: null, universe: 'test', entries: [entry] };
    const result = reexplainGallery(singleEntryGallery, '2026-09-25T00:00:00.000Z');
    expect(result.gallery.entries[0].breakdown?.dataQuality).toBe('unknown');
    expect(JSON.stringify(result.gallery.entries[0].verdict)).toBe(before);
    expect(result.stats.alreadySuperseded).toBe(1);
    expect(result.stats.reverdicted).toBe(0);
    expect(result.stats.forked).toBe(0);
  });
});
