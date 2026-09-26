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

/** The base fixture carries no constellation - "nothing open right now" -
 * the same no-diagram baseline the old `segments: null` default was, so
 * size-budget tests calibrated against it (see 'cuts an oversized summary
 * short' below) keep meaning the same thing. Tests about the constellation
 * itself override `constellation`/`constellationStat` explicitly. */
function data(overrides: Partial<OgCardData> = {}): OgCardData {
  return {
    badgeText: 'Book (strong)',
    accent: '#7fa2ff',
    summary: '2,685 resting orders quote both sides of 119 markets.',
    constellation: null,
    constellationStat: null,
    footerLeft: '0xecb6...2b00 · rules v4',
    provenance: 'Positions as of 23 Sep, 14:32 UTC · saved reading, rules v4',
    limitText: null,
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

  it('draws no constellation block when there is none', () => {
    const tree = JSON.stringify(ogTree(data({ constellation: null, constellationStat: null })));
    // No embedded image and no borderRadius/relative-positioned wrapper -
    // both unique to constellationBlockFor's own returned node (the old "no
    // bar" test's 'overflow' proxy no longer works standalone: the summary
    // and provenance boxes now also set overflow:hidden, to reserve a fixed
    // line-clamped height regardless of whether a constellation follows).
    expect(tree).not.toContain('data:image/svg+xml');
    expect(tree).not.toContain('borderRadius');
  });

  it('embeds the constellation as a base64 SVG data URI image, with the big stat number and its label, when there is one', () => {
    const tree = JSON.stringify(
      ogTree(data({ constellation: { seed: 42, coverage: 0.6, ghost: false, bookDensity: false }, constellationStat: { value: '60%', label: 'covered' } })),
    );
    expect(tree).toContain('data:image/svg+xml;base64,');
    expect(tree).toContain('60%');
    // The label is uppercased in the tree the same way the badge text is.
    expect(tree).toContain('COVERED');
    expect(tree).not.toContain('INCOMPLETE DATA');
  });

  it('marks incomplete coverage on the social preview itself', () => {
    const tree = JSON.stringify(ogTree(data({
      dataQuality: 'partial',
      constellation: { seed: 42, coverage: 0, ghost: false, bookDensity: false },
      constellationStat: { value: '0%', label: 'found coverage' },
    })));
    expect(tree).toContain('FOUND COVERAGE');
    expect(tree).toContain('INCOMPLETE DATA');
  });

  it('cuts an oversized summary short rather than overflowing the card', () => {
    const tree = JSON.stringify(ogTree(data({ summary: 'x'.repeat(500) })));
    expect(tree).toContain('…');
    // The cap is on the summary, not the whole tree: the provenance/caveat
    // line added for U02 is a fixed-size addition on top of it. Calibrated
    // against the no-constellation baseline - a constellation block adds a
    // genuinely large base64 SVG string, covered by its own size-unbounded
    // 'embeds the constellation' test above instead.
    expect(tree.length).toBeLessThan(1400);
  });

  it('places an ellipsis within the visible summary for a real partial-read sentence', () => {
    const summary = '27% of the exposure is one $45.6M ETH short, and whether it is hedged could not be established: only its Hyperliquid balances were read, and a hedge on another chain would not show.';
    const tree = JSON.stringify(ogTree(data({ summary })));
    expect(tree).toContain('27% of the exposure');
    expect(tree).toContain('…');
    expect(tree).not.toContain('and a hedge on another chain');
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

describe('the constellation image actually carries what ogCardData computed (wiring, not the diagram\'s own math - that is test/engine/constellation.test.ts\'s job)', () => {
  function decodedSvg(tree: unknown): string {
    const json = JSON.stringify(tree);
    const m = json.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
    if (!m) throw new Error('no data URI found in tree - test itself is broken, not the code under test');
    return Buffer.from(m[1]!, 'base64').toString('utf8');
  }

  it('draws a dashed ghost mirror in the embedded SVG when constellation.ghost is true', () => {
    const svg = decodedSvg(
      ogTree(data({ constellation: { seed: 1, coverage: 0, ghost: true, bookDensity: false }, constellationStat: { value: '<1%', label: 'covered by this address' } })),
    );
    expect(svg).toContain('stroke-dasharray');
  });

  it('draws no dashed ghost mirror when constellation.ghost is false', () => {
    const svg = decodedSvg(
      ogTree(data({ constellation: { seed: 1, coverage: 0.9, ghost: false, bookDensity: false }, constellationStat: { value: '90%', label: 'covered' } })),
    );
    expect(svg).not.toContain('stroke-dasharray');
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

  it('renders a real PNG through the full pipeline WITH a constellation embedded - the genuinely new, higher-risk path this task added, not mocked here or anywhere else in this suite', async () => {
    const font = readFileSync('assets/inter-regular.woff');
    const wasmBytes = readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm');
    const wasmModule = await compileWasm(wasmBytes);
    const fonts: OgFont[] = [{ name: 'Inter', data: font, weight: 400, style: 'normal' }];

    const withConstellation = data({
      constellation: { seed: 918273645, coverage: 0.42, ghost: true, bookDensity: false },
      constellationStat: { value: '42%', label: 'covered' },
    });
    const png = await renderOgPng(withConstellation, fonts, wasmModule);

    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Meaningfully bigger than the no-diagram card above: real evidence the
    // embedded image actually rasterized into the page rather than being
    // silently dropped (a silently-empty <img> would render close to the
    // same size as the plain text-only card).
    expect(png.length).toBeGreaterThan(5000);
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
