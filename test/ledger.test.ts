import { describe, expect, it } from 'vitest';
import { FakeKV } from './support/fakeKv';
import { summarizeLedger, liveCallsInWindow, type LedgerLine } from '../src/ledger';

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

describe('liveCallsInWindow', () => {
  it('sums the Worker day counters from the window start through today', async () => {
    const kv = new FakeKV();
    await kv.put('nansen:day:2026-09-14', JSON.stringify({ calls: 3, credits: 3, lastRemaining: 900 }));
    await kv.put('nansen:day:2026-09-20', JSON.stringify({ calls: 5, credits: 5, lastRemaining: 895 }));
    await kv.put('nansen:day:2026-09-22', JSON.stringify({ calls: 9, credits: 9, lastRemaining: 886 }));
    const live = await liveCallsInWindow(kv, '2026-09-21', WINDOW);
    expect(live).toEqual({ calls: 8, credits: 8, byDay: { '2026-09-14': 3, '2026-09-20': 5 } });
  });

  it('stops at the window end', async () => {
    const kv = new FakeKV();
    await kv.put('nansen:day:2026-09-27', JSON.stringify({ calls: 2, credits: 2, lastRemaining: 10 }));
    await kv.put('nansen:day:2026-09-28', JSON.stringify({ calls: 4, credits: 4, lastRemaining: 6 }));
    const live = await liveCallsInWindow(kv, '2026-10-01', WINDOW);
    expect(live.calls).toBe(2);
  });
});
