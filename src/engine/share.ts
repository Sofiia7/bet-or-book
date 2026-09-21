/**
 * What a card says when it leaves the page.
 *
 * A PNG is how one of these readings actually travels: somebody saves it and
 * posts it, and the page it came from - with its standing note about
 * centralized exchanges, OTC deals and wallets with no on-chain link - is
 * not attached to the image. The 21.09 audit found the image carrying at
 * most the first two coverage notes and, when there were none, the sentence
 * "Everything this tool reads was read in full", which is true of the
 * reading and false about the account.
 *
 * So the wording lives here rather than in the canvas code: one place, the
 * same on the page, in the picture and in the API, and testable without a
 * browser.
 */
import type { CheckResult } from '../api/check';
import type { EvidenceItem } from './evidence';

/**
 * True of every reading this tool has ever produced, so it is on every card
 * whatever else happened. Nothing read here can see a hedge held on an
 * exchange, agreed over the counter, or sitting in a wallet with no
 * on-chain link to this address.
 */
export const PERMANENT_LIMIT =
  'Not visible to this tool at all: positions on centralized exchanges, OTC deals, ' +
  'and wallets with no on-chain link to this address.';

/** How many lines of limitation fit on a card before it stops being read. */
const MAX_LIMITS = 3;
/** Columns of evidence the image has room for. */
const CARD_EVIDENCE = 4;

export interface ShareCardOptions {
  /** Where this reading on screen came from. */
  kind: 'live' | 'saved' | 'gallery';
  /** The site the card was made on, for the link printed on it. */
  origin?: string;
  snapshotId?: string;
}

export interface ShareCard {
  /** The standing limit first, then what this particular check could not
   * read, worst first. */
  limits: string[];
  /** Limits that did not fit, counted rather than dropped in silence. */
  more: number;
  /** When the numbers were measured, where the reading came from, and under
   * which rules. */
  provenance: string;
  /** Where this exact reading can be opened, or null when it was not saved. */
  link: string | null;
  /** The columns for the image, decisive row included. */
  evidence: EvidenceItem[];
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'an unknown time';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'an unknown time';
  const day = at.getUTCDate();
  const month = at.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hh}:${mm} UTC`;
}

const ORIGIN_OF: Record<ShareCardOptions['kind'], string> = {
  live: 'checked live',
  saved: 'saved reading',
  gallery: 'from the gallery scan',
};

/**
 * Picks the columns for the image.
 *
 * The old code took the first four, which for the Abraxas card meant
 * leaving out the row the whole verdict turned on - that $405M of ETH sits
 * in wallets which merely funded this one - because it happened to be
 * fifth. The row that decided the answer goes on the card; the rest fill in
 * around it.
 */
function cardEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  const decisive = evidence.filter((e) => e.decisive);
  const rest = evidence.filter((e) => !e.decisive);
  return [...decisive, ...rest].slice(0, CARD_EVIDENCE);
}

export function shareCard(result: CheckResult, opts: ShareCardOptions): ShareCard {
  // A note that cost the answer something outranks one that merely
  // describes what was found. Entries written before notes carried that
  // flag fall back to the order the check wrote them in.
  const notes = result.coverageNotes?.length
    ? [...result.coverageNotes].sort((a, b) => Number(b.failure) - Number(a.failure)).map((n) => n.text)
    : [...(result.coverage ?? [])];
  if (result.historical) notes.unshift(result.historical.reason);

  const limits = [PERMANENT_LIMIT, ...notes].slice(0, MAX_LIMITS);
  const rules = result.classifierVersion ? `, rules ${result.classifierVersion}` : '';
  const observed = shortDate(result.observedAt ?? result.positionsAsOf ?? result.checkedAt);

  return {
    limits,
    more: Math.max(0, 1 + notes.length - limits.length),
    provenance: `Positions as of ${observed} · ${ORIGIN_OF[opts.kind]}${rules}`,
    link: opts.snapshotId && opts.origin ? `${opts.origin}/?s=${opts.snapshotId}` : null,
    evidence: cardEvidence(result.evidence ?? []),
  };
}
