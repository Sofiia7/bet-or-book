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
    provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4',
    limitText: null as string | null,
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

  it('carries the date and reading kind through untouched, from shareCard (23.09 audit, U02)', () => {
    const d = ogCardData(input());
    expect(d.provenance).toBe('Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4');
  });

  it('carries a specific caveat when the reading has one, and none when it does not', () => {
    expect(ogCardData(input()).limitText).toBeNull();
    const d = ogCardData(input({ limitText: 'Snapshot from the gallery scan, read by the rules of the time (v3).' }));
    expect(d.limitText).toBe('Snapshot from the gallery scan, read by the rules of the time (v3).');
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

describe('what a funder holds, on the picture as on the page', () => {
  const breakdown = (elsewhere: { usd: number; wallets: number } | null) =>
    ({
      applies: true,
      coin: 'ETH',
      side: 'short',
      headlineUsd: 209_121_627,
      segments: [{ kind: 'residual', usd: 209_121_627, share: 1 }],
      excessUsd: 0,
      elsewhere: elsewhere ? { ...elsewhere, ownership: 'unverified' } : null,
    }) as unknown as ExposureBreakdown;

  it('carries the amount and says it is not counted, beside a bar and never in it', () => {
    const d = ogCardData(input({ breakdown: breakdown({ usd: 443_676_085, wallets: 2 }) }));
    expect(d.elsewhere).toEqual({
      amount: '$443.7M',
      caption: 'held by 2 wallets that funded it, ownership unverified, not counted',
    });
  });

  it('draws nothing beside the bar when nothing is held elsewhere', () => {
    expect(ogCardData(input({ breakdown: breakdown(null) })).elsewhere).toBeNull();
  });

  it('draws nothing beside a bar that is not there', () => {
    expect(ogCardData(input({ breakdown: undefined })).elsewhere).toBeNull();
  });
});
