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
 *   cost of a full answer  `credits` and `nansenCalls` on fresh checks
 *   budget refusals   count by `nansenOff`
 *   failed saves      `saved` = false; `picture` outcomes save_failed, draw_failed
 *   KV trouble        `kvDegraded` = true, on every event
 *
 * What never goes in: the Nansen key or the demo key, the client's IP, and
 * the wallet address. None of them is needed to count anything, and the
 * platform's own invocation log already carries the request URL for anyone
 * debugging one particular request.
 */
import type { CheckResponse } from './api/check';

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
  /** The request carried the operator key for the demo reserve. */
  demo: boolean;
  verdict?: string;
  /** The first reason code the rules gave, which is the one that decided. */
  reason?: string;
  rules?: string;
  degraded?: boolean;
  source?: string;
  /** Fresh checks only: what the answer cost. */
  nansenCalls?: number;
  /** Credits the API priced, plus one for each call it did not - the same
   * conservative count the spend cap settles with. */
  credits?: number;
  /** Fresh checks only: why Nansen was not asked at all - no key, the day's
   * cap, the account nearly empty. Absent when it was asked. */
  nansenOff?: string;
  /** Fresh checks only: whether the reading was kept, so its link works. */
  saved?: boolean;
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

export type TelemetryEvent = CheckEvent | PictureEvent | SnapshotEvent;

const FAILURES = new Set<string>(['failed', 'draw_failed', 'save_failed']);

/** Writes the event as one line. A failure goes out at error level, so the
 * dashboard's own error views pick it up without a query. */
export function emit(e: TelemetryEvent): void {
  const line = JSON.stringify(e);
  if (FAILURES.has(e.outcome) || (e.event === 'check' && e.saved === false)) console.error(line);
  else console.log(line);
}

/** What a served reading says about itself, for a check event. Reads only
 * fields that are codes and flags, never the address or the text. */
export function readingFields(r: Pick<CheckResponse, 'verdict' | 'classifierVersion' | 'degraded' | 'source'>) {
  return {
    verdict: r.verdict.verdict,
    ...(r.verdict.reasons?.length ? { reason: r.verdict.reasons[0] } : {}),
    rules: r.classifierVersion,
    degraded: r.degraded,
    source: r.source,
  };
}
