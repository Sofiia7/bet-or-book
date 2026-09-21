import { describe, expect, it } from 'vitest';
import { summarizeLedger, type LedgerLine } from '../src/ledger';

const WINDOW = { from: '2026-09-14', to: '2026-09-27' };

function line(overrides: Partial<LedgerLine>): LedgerLine {
  return {
    at: '2026-09-18T12:00:00.000Z',
    source: 'prescan',
    endpoint: 'profiler/perp-positions',
    status: 200,
    creditsCost: 1,
    creditsRemaining: 900,
    ...overrides,
  };
}

describe('summarizeLedger', () => {
  it('counts per-call and aggregate lines inside the window only', () => {
    const s = summarizeLedger(
      [
        line({}),
        line({ endpoint: 'profiler/perp-pnl-summary', status: 500, creditsCost: null }),
        line({ source: 'wrangler-dev', endpoint: 'profiler/address/current-balance', count: 7, creditsCost: 7 }),
        line({ at: '2026-09-13T23:59:59.000Z' }),
        line({ at: '2026-09-28T00:00:00.000Z' }),
      ],
      WINDOW,
    );
    expect(s.calls).toBe(9);
    expect(s.okCalls).toBe(8);
    expect(s.credits).toBe(9);
    expect(s.byEndpoint).toEqual({
      'profiler/perp-positions': 1,
      'profiler/perp-pnl-summary': 1,
      'profiler/address/current-balance': 7,
    });
    expect(s.bySource).toEqual({ prescan: 2, 'wrangler-dev': 7 });
    expect(s.byDay).toEqual({ '2026-09-18': 9 });
  });
});
