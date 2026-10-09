/** Plain share content; dates and limitations survive short-post trimming. */
export interface ReadingText {
  position: string;
  verdict: string;
  headline: string;
  readAt: string;
  limitation: string;
  attribution: string;
  link: string | null;
}

export function savedReadingLink(reading: { snapshotId?: string; snapshotSaved?: boolean }, origin: string): string | null {
  return reading.snapshotId && reading.snapshotSaved !== false
    ? origin + '/?s=' + encodeURIComponent(reading.snapshotId) : null;
}

export function readingCopyText(reading: ReadingText): string {
  return `${reading.position} · ${reading.verdict}\nRead ${reading.readAt}\n\n${reading.headline}\n${reading.limitation}\n\n${reading.attribution}\n${reading.link || 'This reading has no saved link.'}`;
}

export function readingPostText(reading: ReadingText): string {
  const suffix = `\nRead ${reading.readAt}\n${reading.limitation}\n\n${reading.attribution}` + (reading.link ? '\n' + reading.link : '');
  const suffixWeight = suffix.length - (reading.link?.length || 0) + (reading.link ? 23 : 0);
  const budget = Math.max(0, 280 - suffixWeight);
  let body = `${reading.position} · ${reading.verdict}\n${reading.headline}`;
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 1)).trimEnd() + '…';
  return body + suffix;
}
