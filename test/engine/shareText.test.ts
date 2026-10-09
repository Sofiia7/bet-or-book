import { describe, expect, it } from 'vitest';
import { readingCopyText, readingPostText, savedReadingLink, type ReadingText } from '../../src/engine/shareText';

const reading: ReadingText = {
  position: '$212.1M ETH short', verdict: 'Ownership unresolved',
  headline: 'A funder holds ETH, but ownership is unverified.',
  readAt: '9 Oct, 06:49 UTC', limitation: 'Funding links do not establish ownership.',
  attribution: 'Powered by @nansen_ai', link: 'https://bet-or-book.trade/?s=12pk1a43rv3a1',
};

describe('sharing a dated reading', () => {
  it('offers an exact saved link only when a snapshot is available', () => {
    expect(savedReadingLink({ snapshotId: 'a/b' }, 'https://example.com')).toBe('https://example.com/?s=a%2Fb');
    expect(savedReadingLink({}, 'https://example.com')).toBeNull();
    expect(savedReadingLink({ snapshotId: 'abc', snapshotSaved: false }, 'https://example.com')).toBeNull();
  });

  it('keeps evidence, date, limitation and provenance together when copied', () => {
    const text = readingCopyText(reading);
    for (const value of Object.values(reading)) expect(text).toContain(value);
  });

  it('does not invent a saved link after snapshot storage fails', () => {
    const unsaved = { ...reading, link: null };
    expect(readingCopyText(unsaved)).toContain('This reading has no saved link.');
    expect(readingPostText(unsaved)).not.toContain('https://');
  });

  it('trims a long headline before sacrificing the date or ownership caveat', () => {
    const text = readingPostText({ ...reading, headline: reading.headline.repeat(20) });
    expect(text).toContain('…');
    expect(text).toContain(reading.readAt);
    expect(text).toContain(reading.limitation);
    expect(text).toContain(reading.attribution);
    expect(text.endsWith(reading.link!)).toBe(true);
    expect(text.length - reading.link!.length + 23).toBeLessThanOrEqual(280);
  });
});
