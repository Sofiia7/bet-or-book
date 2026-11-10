/**
 * One JSON line per thing worth counting, for Workers Logs to index.
 *
 * `observability.enabled` already kept every console line, and none of them
 * could be counted: "check failed" and a stack trace say that something
 * broke, not how often, how slowly, from which cache, or why a verdict came
 * out Unknown (23.09 audit, S06). Workers Logs extracts the fields of a JSON
 * line, and its query builder groups by them and takes percentiles over
 * them, so a flat object per event is the whole metrics layer - no binding,
 * no second store, nothing for the reader of a card to see:
 *
 *   latency           P50 / P95 of `ms`, by `event` and `outcome`
 *   cache hits        count of `outcome` = cached, against fresh
 *   degraded answers  share of `degraded` = true among fresh checks
 *   why Unknown       count by `reason` where `verdict` = unknown
 *   failed saves      `saved` = false; `picture` outcomes save_failed, draw_failed
 *   KV trouble        `kvDegraded` = true, on every event
 *
 * Lines written before stage 3 also carry `nansenCalls`, `credits`,
 * `creditsRemaining`, `creditsMeasuredAt` and `nansenOff`, what a check cost
 * on Nansen. A check makes no Nansen call now, so new lines carry none of
 * them; a query over the old ones still finds them there.
 *
 * One field stands in for the credit meter's visibility: `fundingLinksNotes`
 * on a check line. The explorer's free key allows about 5,000 calls a day and
 * nothing bounds them now, so the only place a spent or refused explorer shows
 * is the reading's coverage notes ("Funding links on Arbitrum were not read:
 * ..."). The line carries the text of those notes, a few and short, so the
 * dashboard can count them. A cached repeat carries its reading's notes again:
 * count `outcome` = fresh only. It is not a cost field, and none is added.
 *
 * What never goes in: the explorer key or the demo key, the client's IP, and
 * the wallet address. None of them is needed to count anything, and the
 * platform's own invocation log already carries the request URL for anyone
 * debugging one particular request.
 */
import type { CheckResponse } from './api/check';
import type { UsageEvent } from './usage';

export interface CheckEvent {
  event: 'check';
  /**
   * fresh: a new reading was made for this request.
   * cached: answered from a reading already on record, KV or in flight.
   * not_open: the position asked for is not open; answered from the
   *   address's own reading of its largest one, for free.
   * rate_limited / busy: refused by the per-client or the global limit.
   * cross_site: a POST from another site's page, refused.
   * failed: the check threw; the reader got a generic 502.
   */
  outcome: 'fresh' | 'cached' | 'not_open' | 'rate_limited' | 'busy' | 'cross_site' | 'failed';
  ms: number;
  kvDegraded: boolean;
  /** A particular position was asked about, rather than the largest. */
  focus: boolean;
  /** The request carried the operator key (DEMO_KEY), which skips the public
   * rate limits. */
  demo: boolean;
  verdict?: string;
  /** The first reason code the rules gave, which is the one that decided. */
  reason?: string;
  rules?: string;
  degraded?: boolean;
  /** 'nansen' only when Nansen supplied some of the reading, else 'hyperliquid'.
   * It no longer says how much of the book was seen; `positionsCoverage` does. */
  source?: string;
  /** How completely the positions were read: 'partial' when a Hyperliquid dex
   * did not answer or the list of dexes could not be read. Counting it is how
   * production sees how often a dex goes unread. Absent on a reading stored
   * before it was recorded. */
  positionsCoverage?: string;
  /** Fresh checks only: whether the reading was kept, so its link works. */
  saved?: boolean;
  /** The reading's coverage notes about the explorer's funding links: a chain
   * not read (and why) or read but cut short. At most four, each cut to 200
   * characters; absent when there are none. */
  fundingLinksNotes?: string[];
}

export interface PictureEvent {
  event: 'picture';
  /**
   * served: a crawler got the reading's own picture.
   * stand_in: a crawler got the standing picture - none drawn yet, or no
   *   such reading (yet).
   * drawn / already_drawn: the page asked for a picture to be drawn.
   * no_reading, refused, rate_limited: a draw request with nothing to draw,
   *   from another site, or over the limit.
   * draw_failed: satori or resvg threw. A draw stopped by the runtime for
   *   CPU leaves no line at all - that shows up as a platform-level
   *   exceededCpu outcome on the same request instead.
   * save_failed: drawn, but KV would not keep it.
   */
  outcome:
    | 'served'
    | 'stand_in'
    | 'drawn'
    | 'already_drawn'
    | 'no_reading'
    | 'refused'
    | 'rate_limited'
    | 'draw_failed'
    | 'save_failed';
  ms: number;
  kvDegraded: boolean;
}

export interface SnapshotEvent {
  event: 'snapshot';
  /** bundled: a gallery card or a demonstration reading, shipped with the
   * Worker. stored: a live reading, from KV. missing: expired, never
   * existed, or - for up to a minute after it was saved - not yet visible
   * in this region. */
  outcome: 'bundled' | 'stored' | 'missing';
  ms: number;
  kvDegraded: boolean;
}

export type TelemetryEvent = CheckEvent | PictureEvent | SnapshotEvent | UsageEvent;

const FAILURES = new Set<string>(['failed', 'draw_failed', 'save_failed']);

/** Writes the event as one line. A failure goes out at error level, so the
 * dashboard's own error views pick it up without a query. */
export function emit(e: TelemetryEvent): void {
  const line = JSON.stringify(e);
  if (FAILURES.has(e.outcome) || (e.event === 'check' && e.saved === false)) console.error(line);
  else console.log(line);
}

/** The notes src/api/observe.ts writes about a funding-link chain (`fundingChainNote`)
 * all start like this; no other note does. */
const FUNDING_LINKS_PREFIX = 'Funding links on ';
const FUNDING_LINKS_NOTES_MAX = 4;
const FUNDING_LINKS_NOTE_CHARS = 200;

/** The texts of the funding-link notes among a reading's coverage notes: the
 * first four, each cut to 200 characters. Empty when there are none, and for a
 * reading stored without notes. The texts name a chain and a reason, never a
 * wallet or a key. */
function fundingLinksNotesOf(notes: CheckResponse['coverageNotes'] | undefined): string[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((n) => n?.text)
    .filter((text): text is string => typeof text === 'string' && text.startsWith(FUNDING_LINKS_PREFIX))
    .slice(0, FUNDING_LINKS_NOTES_MAX)
    .map((text) => text.slice(0, FUNDING_LINKS_NOTE_CHARS));
}

/** What a served reading says about itself, for a check event. Reads only
 * fields that are codes and flags, and the funding-link coverage notes (a
 * chain and a reason each), never the address or any other text. */
export function readingFields(
  r: Pick<CheckResponse, 'verdict' | 'classifierVersion' | 'degraded' | 'source'> &
    Partial<Pick<CheckResponse, 'positionsCoverage' | 'coverageNotes'>>,
) {
  const fundingLinksNotes = fundingLinksNotesOf(r.coverageNotes);
  return {
    verdict: r.verdict.verdict,
    ...(r.verdict.reasons?.length ? { reason: r.verdict.reasons[0] } : {}),
    rules: r.classifierVersion,
    degraded: r.degraded,
    source: r.source,
    ...(typeof r.positionsCoverage === 'string' ? { positionsCoverage: r.positionsCoverage } : {}),
    ...(fundingLinksNotes.length > 0 ? { fundingLinksNotes } : {}),
  };
}
