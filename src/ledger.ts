/** Nansen Meridian Buildathon: calls count only inside these dates (UTC). */
export const BUILDATHON_WINDOW = { from: '2026-09-14', to: '2026-09-27' };

/** One line of data/nansen-calls.jsonl. */
export interface LedgerLine {
  at: string;
  source: string;
  endpoint: string;
  status: number;
  /** Set on an aggregate line that stands for several calls. */
  count?: number;
  creditsCost: number | null;
  creditsRemaining: number | null;
}

export interface LedgerSummary {
  window: { from: string; to: string };
  calls: number;
  okCalls: number;
  credits: number;
  byEndpoint: Record<string, number>;
  bySource: Record<string, number>;
  byDay: Record<string, number>;
}

function add(map: Record<string, number>, key: string, n: number): void {
  map[key] = (map[key] ?? 0) + n;
}

/** Calls made by the scripts (and dev runs logged by hand), inside the window. */
export function summarizeLedger(lines: LedgerLine[], window = BUILDATHON_WINDOW): LedgerSummary {
  const s: LedgerSummary = {
    window: { ...window },
    calls: 0,
    okCalls: 0,
    credits: 0,
    byEndpoint: {},
    bySource: {},
    byDay: {},
  };
  for (const l of lines) {
    const day = l.at.slice(0, 10);
    if (day < window.from || day > window.to) continue;
    const n = l.count ?? 1;
    s.calls += n;
    if (l.status >= 200 && l.status < 300) s.okCalls += n;
    s.credits += l.creditsCost ?? n;
    add(s.byEndpoint, l.endpoint, n);
    add(s.bySource, l.source, n);
    add(s.byDay, day, n);
  }
  return s;
}
