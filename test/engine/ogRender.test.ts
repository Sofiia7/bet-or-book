/// <reference types="node" />
// This file runs the real render pipeline under Node (vitest), not under
// Workers, so it needs Node's fs and WebAssembly typings rather than the
// narrower ones @cloudflare/workers-types declares for the rest of this
// project - hence the reference above and the casts on WebAssembly.compile
// below, instead of widening the main tsconfig for every other file.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ogTree, renderOgPng, OG_WIDTH, OG_HEIGHT, type OgFont } from '../../src/engine/ogRender';
import type { OgCardData } from '../../src/engine/ogCard';

const compileWasm = (bytes: BufferSource): Promise<WebAssembly.Module> =>
  (WebAssembly as unknown as { compile(b: BufferSource): Promise<WebAssembly.Module> }).compile(bytes);

function data(overrides: Partial<OgCardData> = {}): OgCardData {
  return {
    badgeText: 'Book (strong)',
    accent: '#0c447c',
    summary: '2,685 resting orders quote both sides of 119 markets.',
    segments: null,
    footerLeft: '0xecb6...2b00 · rules v4',
    provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4',
    limitText: null,
    elsewhere: null,
    dataQuality: 'measured',
    ...overrides,
  };
}

describe('ogTree', () => {
  it('carries the badge, summary and footer text into the tree', () => {
    const tree = JSON.stringify(ogTree(data()));
    expect(tree).toContain('BOOK (STRONG)');
    expect(tree).toContain('2,685 resting orders');
    expect(tree).toContain('0xecb6...2b00');
    expect(tree).toContain('Powered by Nansen API');
  });

  it('draws no bar when there are no segments', () => {
    const tree = JSON.stringify(ogTree(data({ segments: null })));
    expect(tree).not.toContain('overflow');
  });

  it('draws one band per segment when there are some', () => {
    const tree = ogTree(
      data({ segments: [{ share: 0.4, color: '#0c447c', opacity: 1 }, { share: 0.6, color: '#e6e6e2', opacity: 1 }] }),
    ) as { props: { children: Array<{ props?: { children?: unknown } }> } };
    const bar = tree.props.children.find((c) => Array.isArray((c.props as { children?: unknown[] })?.children) && (c.props as { children: unknown[] }).children.length === 2);
    expect(bar).toBeDefined();
  });

  it('cuts an oversized summary short rather than overflowing the card', () => {
    const tree = JSON.stringify(ogTree(data({ summary: 'x'.repeat(500) })));
    expect(tree).toContain('…');
    // The cap is on the summary, not the whole tree: the provenance/caveat
    // line added for U02 is a fixed-size addition on top of it.
    expect(tree.length).toBeLessThan(1400);
  });

  it('carries the date and the reading\'s own caveat, not just the badge and summary (23.09 audit, U02)', () => {
    const tree = JSON.stringify(
      ogTree(data({ provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4', limitText: 'Only its Hyperliquid balances were read.' })),
    );
    expect(tree).toContain('23 Sep, 14:32 UTC');
    expect(tree).toContain('Only its Hyperliquid balances were read.');
  });

  it('shows the date alone when the reading carries no caveat beyond the permanent one', () => {
    const tree = JSON.stringify(ogTree(data({ provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4', limitText: null })));
    expect(tree).toContain('23 Sep, 14:32 UTC');
  });
});

describe('renderOgPng (real satori + resvg, no mocks)', () => {
  it('produces a real PNG of the requested size from real font and wasm bytes', async () => {
    const font = readFileSync('assets/inter-regular.woff');
    const wasmBytes = readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm');
    const wasmModule = await compileWasm(wasmBytes);
    const fonts: OgFont[] = [{ name: 'Inter', data: font, weight: 400, style: 'normal' }];

    const png = await renderOgPng(data(), fonts, wasmModule);

    // The PNG signature, not a snapshot of the pixels - what this proves is
    // that satori's SVG and resvg's rasterization actually ran, not that
    // the picture looks a particular way.
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.length).toBeGreaterThan(1000);
  }, 15_000);

  it('does not throw when initWasm is asked to run twice in the same module (a Worker can reuse an isolate)', async () => {
    const font = readFileSync('assets/inter-regular.woff');
    const wasmBytes = readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm');
    const wasmModule = await compileWasm(wasmBytes);
    const fonts: OgFont[] = [{ name: 'Inter', data: font, weight: 400, style: 'normal' }];

    await renderOgPng(data(), fonts, wasmModule);
    const second = await renderOgPng(data({ summary: 'a second, different card' }), fonts, wasmModule);
    expect(second.length).toBeGreaterThan(1000);
  }, 15_000);
});

// Sanity on the constants other modules will size their canvas against.
describe('OG image dimensions', () => {
  it('is the standard social-preview size', () => {
    expect(OG_WIDTH).toBe(1200);
    expect(OG_HEIGHT).toBe(630);
  });
});

describe('the funder box on the link picture', () => {
  it('puts the amount beside the bar on a dashed line, with its caption', () => {
    const tree = JSON.stringify(
      ogTree(
        data({
          segments: [{ share: 1, color: '#e6e6e2', opacity: 1 }],
          elsewhere: { amount: '$443.7M', caption: 'held by 2 wallets that funded it, ownership unverified, not counted' },
        }),
      ),
    );
    expect(tree).toContain('$443.7M');
    expect(tree).toContain('dashed');
    expect(tree).toContain('ownership unverified, not counted');
  });
});

describe('an unfinished read marks the bar itself, not only the text (25.09 audit, A03/A05 follow-up)', () => {
  it('draws the bar with a dashed border when dataQuality is not measured', () => {
    const tree = JSON.stringify(
      ogTree(data({ segments: [{ share: 1, color: '#e6e6e2', opacity: 1 }], dataQuality: 'partial' })),
    );
    expect(tree).toContain('dashed');
  });

  it('draws the bar with a solid border when the read is measured', () => {
    const tree = JSON.stringify(
      ogTree(data({ segments: [{ share: 1, color: '#e6e6e2', opacity: 1 }], dataQuality: 'measured' })),
    );
    expect(tree).not.toContain('dashed');
  });
});
