import { describe, expect, it } from 'vitest';
import { ogCardData } from '../../src/engine/ogCard';
import type { VerdictResult } from '../../src/engine/verdict';
import type { ExposureBreakdown } from '../../src/engine/breakdown';

function verdict(overrides: Partial<VerdictResult> = {}): VerdictResult {
  return { verdict: 'looks_like_a_bet', strength: null, reasons: ['directional_concentration'], ...overrides };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    address: '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36',
    verdict: verdict(),
    summary: '93% of the exposure is one $42.1M ZEC long.',
    classifierVersion: 'v4',
    breakdown: undefined as ExposureBreakdown | undefined,
    ...overrides,
  };
}

describe('ogCardData', () => {
  it('names the badge with its strength when there is one', () => {
    const d = ogCardData(input({ verdict: verdict({ verdict: 'book', strength: 'strong', reasons: ['orders'] }) }));
    expect(d.badgeText).toBe('Book (strong)');
  });

  it('names the badge with no strength for a hedge', () => {
    const d = ogCardData(input({ verdict: verdict({ verdict: 'hedged', strength: null, reasons: ['hedge_leg'] }) }));
    expect(d.badgeText).toBe('Hedged');
  });

  it('picks the accent colour that matches the page for each verdict', () => {
    expect(ogCardData(input({ verdict: verdict({ verdict: 'book' }) })).accent).toBe('#0c447c');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'hedged' }) })).accent).toBe('#27500a');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'looks_like_a_bet' }) })).accent).toBe('#633806');
    expect(ogCardData(input({ verdict: verdict({ verdict: 'unknown' }) })).accent).toBe('#444441');
  });

  it('carries the summary sentence untouched', () => {
    const d = ogCardData(input());
    expect(d.summary).toBe('93% of the exposure is one $42.1M ZEC long.');
  });

  it('shortens the address for the footer, with the rules version', () => {
    const d = ogCardData(input());
    expect(d.footerLeft).toBe('0xb83d...6e36 · rules v4');
  });

  it('carries no bar when the breakdown does not apply', () => {
    const d = ogCardData(input({ breakdown: { applies: false, coin: null, side: null, headlineUsd: 0, segments: [], excessUsd: 0, elsewhere: null } }));
    expect(d.segments).toBeNull();
  });

  it('turns each segment into a share and a colour, accent for covered, faint for residual', () => {
    const breakdown: ExposureBreakdown = {
      applies: true, coin: 'ETH', side: 'short', headlineUsd: 100,
      segments: [
        { kind: 'covered', usd: 1, share: 0.01 },
        { kind: 'unverified', usd: 9, share: 0.09 },
        { kind: 'residual', usd: 90, share: 0.9 },
      ],
      excessUsd: 0, elsewhere: null,
    };
    const d = ogCardData(input({ breakdown, verdict: verdict({ verdict: 'unknown', reasons: ['linked_exposure_unverified'] }) }));
    expect(d.segments).toEqual([
      { share: 0.01, color: '#444441', opacity: 1 },
      { share: 0.09, color: '#444441', opacity: 0.35 },
      { share: 0.9, color: '#e6e6e2', opacity: 1 },
    ]);
  });
});
