/**
 * The constellation diagram's math and its SVG rendering, as pure functions
 * with no DOM, no Canvas2D and no satori/resvg dependency - this file has to
 * run identically in a browser-less Workers isolate (the live OG endpoint)
 * and in plain Node (the offline pre-render script and this file's own
 * tests), the same two environments src/engine/ogRender.ts already spans.
 *
 * Everything below this comment down to constellationSvg is a faithful port
 * of web/app.js's own rng/seedFromAddress/buildConstellationModel/
 * drawConstellation/constellationInputsFor (Task 2 of the 26.09 redesign
 * plan) - the picture a shared link's OG image shows has to be the SAME
 * picture the live page shows for the same reading, not a second, similar-
 * looking implementation that can drift from it. Where Canvas2D drawing
 * calls have no SVG equivalent (globalCompositeOperation: 'lighter' layering
 * overlapping glows, for one), this trades exactness for "clearly the same
 * visual family" - see constellationSvg's own comment.
 */
import type { PositionFeatures, OrderFeatures, HedgeFeatures } from './features';
import type { VerdictResult } from './verdict';
import type { ExposureBreakdown } from './breakdown';

/** A small, fast, deterministic PRNG (mulberry32) so the same reading always
 * draws the same constellation - ported from web/app.js's rng() unchanged. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable small integer from an address, so a given address always draws
 * the same constellation on the page and in its own OG picture - ported
 * from web/app.js's seedFromAddress() unchanged. Not a security hash, just a
 * display seed. */
export function seedFromAddress(address: string): number {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (Math.imul(h, 31) + address.charCodeAt(i)) | 0;
  return h >>> 0;
}

export interface ConstellationModel {
  env: number[];
  jitter: number[];
  mids: number[];
  bokeh: Array<{ x: number; y: number; r: number; side: number }>;
}

/** Ported from web/app.js's buildConstellationModel() unchanged. */
export function buildConstellationModel(seed: number, N: number): ConstellationModel {
  const R = rng(seed);
  const bumps: Array<{ c: number; w: number; h: number }> = [];
  const nb = 3 + Math.floor(R() * 3);
  for (let i = 0; i < nb; i++) bumps.push({ c: 0.08 + R() * 0.84, w: 0.025 + R() * 0.09, h: 0.3 + R() * 0.6 });
  bumps[0]!.h = 1;
  const env: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    let v = 0.05;
    for (const b of bumps) v = Math.max(v, b.h * Math.exp(-((x - b.c) ** 2) / (2 * b.w * b.w)));
    env.push(Math.min(1, v * (0.5 + 0.5 * R())));
  }
  const jitter: number[] = [];
  const mids: number[] = [];
  for (let i = 0; i < N; i++) {
    jitter.push(0.85 + R() * 0.3);
    mids.push(R() < 0.5 ? 0.15 + R() * 0.7 : -1);
  }
  const bokeh: ConstellationModel['bokeh'] = [];
  for (let i = 0; i < 9; i++) bokeh.push({ x: R(), y: 0.2 + R() * 0.7, r: 14 + R() * 46, side: R() < 0.5 ? 0 : 1 });
  return { env, jitter, mids, bokeh };
}

export interface ConstellationInputs {
  seed: number;
  /** 0-1: what stands against the headline position, as a fraction of it -
   * never concentration, the same one thing for every verdict (see
   * constellationInputsForOg's own doc comment). */
  coverage: number;
  /** True exactly when a funder's holdings exist but do not count - drawn as
   * a dashed, hollow mirror of the LEFT (full-height) side. */
  ghost: boolean;
  /** True only for the book verdict: a denser point count, the same visual
   * cue web/app.js's drawConstellation uses. */
  bookDensity: boolean;
}

/**
 * What constellationSvg (and the client's own drawConstellation) needs,
 * derived from a real reading. A faithful port of web/app.js's
 * constellationInputsFor (Task 2, as corrected by 710ba3b) - kept in sync by
 * hand, not by sharing code across the browser/Workers boundary, so
 * test/engine/constellation.test.ts cross-checks the two against the same
 * real readings (data/featured.json) rather than trusting them to agree.
 *
 * The right side of the constellation means exactly one thing for every
 * verdict: coverage - what genuinely offsets or matches the position, never
 * concentration (a different question src/engine/features.ts's
 * headlineShare already answers elsewhere on the card).
 *  - Book: `coverage` is matched-both-sides notional over the headline
 *    notional - the same fraction the old bar filled.
 *  - Long/bet (isLong, i.e. `!breakdown || !breakdown.applies`): `coverage`
 *    is a flat 0 - spot cannot offset a long (computeHedgeFeatures in
 *    src/engine/features.ts hard-wires hedgeRatio to 0 whenever the headline
 *    side is not 'short'), so a long's coverage is 0 by construction.
 *  - Hedged / Unknown ("funders") / any other reading whose breakdown
 *    applies: `coverage` is `hedge.hedgeRatio`, clamped to [0,1]. `ghost` is
 *    true exactly when `breakdown.elsewhere` exists (the funders case).
 *
 * Whether to call this function at all - whether a reading has a position to
 * draw a constellation for in the first place - is NOT this function's own
 * job, the same way it is not web/app.js's constellationInputsFor's job:
 * that gate (isBook, or breakdown.applies with segments, or a long position)
 * lives in the caller, mirroring web/app.js's renderBreakdown/drawCard.
 */
export interface ConstellationSource {
  address: string;
  verdict: Pick<VerdictResult, 'verdict'>;
  positions: Pick<PositionFeatures, 'headlineNotionalUsd' | 'headlineShare'>;
  orders: Pick<OrderFeatures, 'headlineTwoSidedNotionalUsd'>;
  hedge: Pick<HedgeFeatures, 'hedgeRatio'>;
  breakdown?: Pick<ExposureBreakdown, 'applies' | 'elsewhere'> | undefined;
}

export function constellationInputsForOg(input: ConstellationSource): ConstellationInputs {
  const seed = seedFromAddress(input.address);
  const b = input.breakdown;
  const isLong = !b || !b.applies;
  if (input.verdict.verdict === 'book') {
    const headlineUsd = input.positions.headlineNotionalUsd || 0;
    const matched = input.orders.headlineTwoSidedNotionalUsd || 0;
    return { seed, coverage: headlineUsd > 0 ? Math.min(1, matched / headlineUsd) : 0, ghost: false, bookDensity: true };
  }
  if (isLong) {
    return { seed, coverage: 0, ghost: false, bookDensity: false };
  }
  const ratio = typeof input.hedge.hedgeRatio === 'number' ? input.hedge.hedgeRatio : 0;
  const hasElsewhere = !!(b && b.elsewhere);
  return { seed, coverage: Math.max(0, Math.min(1, ratio)), ghost: hasElsewhere, bookDensity: false };
}

const CONSTELLATION_DOTS = ['#6fd0ff', '#9a7bff', '#ff4fa8', '#ffc94d'];

/** Ported from web/app.js's constellationHash unchanged - a cheap
 * deterministic pseudo-hash, not a cryptographic one. */
function constellationHash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface ConstPt {
  x: number;
  y: number;
  k: number;
  baseline?: boolean;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** One radial gradient per dot color, matching web/app.js's
 * constellationSprite's own gradient stops (white core, through the dot's
 * hue, to transparent) - referenced by id from every <circle> of that color
 * rather than repeated per dot, so the SVG stays a reasonable size. */
function dotGradientDef(hex: string, id: string): string {
  const [r, g, b] = hexToRgb(hex);
  const mid = `rgb(${Math.round((r + 510) / 3)},${Math.round((g + 510) / 3)},${Math.round((b + 510) / 3)})`;
  const solid = `rgb(${r},${g},${b})`;
  return (
    `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>` +
    `<stop offset="6%" stop-color="${mid}" stop-opacity="1"/>` +
    `<stop offset="14%" stop-color="${solid}" stop-opacity="0.9"/>` +
    `<stop offset="32%" stop-color="${solid}" stop-opacity="0.28"/>` +
    `<stop offset="60%" stop-color="${solid}" stop-opacity="0.07"/>` +
    `<stop offset="100%" stop-color="${solid}" stop-opacity="0"/>` +
    `</radialGradient>`
  );
}

/** Matches web/app.js's bokeh fill, which fades from the hue at ~12%
 * opacity (hex suffix '1f') to fully transparent. */
function bokehGradientDef(hex: string, id: string): string {
  return (
    `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0%" stop-color="${hex}" stop-opacity="0.12"/>` +
    `<stop offset="100%" stop-color="${hex}" stop-opacity="0"/>` +
    `</radialGradient>`
  );
}

/**
 * A complete SVG string for one constellation, at a given pixel size - the
 * server-side equivalent of web/app.js's drawConstellation(cv, inputs), for
 * the same inputs (mini is left out: the OG card and the pre-rendered PNG
 * only ever need the large, non-mini treatment - nothing server-side draws
 * the small queue-row thumbnails, which stay a page-only, Canvas2D-only
 * feature).
 *
 * Not pixel-identical to the canvas version - SVG has no equivalent of
 * canvas's globalCompositeOperation: 'lighter', which is how overlapping
 * glows brighten each other on the page - but the same geometry (seeded
 * left/right peaks, the same link-nearby-points connections, the same ghost
 * mirror, the same four-color dot palette and bokeh backdrop) renders
 * through the same radial-gradient technique, so this is clearly the same
 * picture, not a different one that merely uses the same inputs.
 */
export function constellationSvg(inputs: ConstellationInputs, width: number, height: number): string {
  const { seed, coverage, ghost, bookDensity } = inputs;
  const W = width;
  const H = height;
  const N = Math.round(bookDensity ? 32 * 1.3 : 32);
  const model = buildConstellationModel(seed, N);
  const padX = 24;
  const padY = 22;
  const gapHalf = W * 0.075;
  const amp = W / 2 - gapHalf - padX;
  const step = (H - 2 * padY) / (N - 1);
  const baseL = padX;
  const baseR = W - padX;

  const build = (isRight: boolean, ampK: number, floor: number): ConstPt[] => {
    const sk = (isRight ? 5000 : 0) + seed * 97;
    const dir = isRight ? -1 : 1;
    const base = isRight ? baseR : baseL;
    const pts: ConstPt[] = [];
    for (let i = 0; i < N; i++) {
      const y = padY + i * step;
      const e = Math.max(floor, model.env[i]! * ampK * (isRight ? model.jitter[i]! : 1));
      pts.push({ x: base + dir * e * amp, y, k: sk + i * 2 + 1 });
      if (model.mids[i]! > 0 && e > 0.12) {
        pts.push({ x: base + dir * e * amp * model.mids[i]!, y: y + step * 0.4, k: sk + i * 2 + 2 });
      }
      if (i % 4 === 0) pts.push({ x: base, y, k: -1, baseline: true });
    }
    pts.sort((a, b) => a.y - b.y);
    return pts;
  };

  const left = build(false, 1, 0.02);
  const right = build(true, coverage, coverage > 0.05 ? 0.02 : 0.015);
  const ghostPts = ghost ? build(true, 1, 0.02) : null;

  const link = (pts: ConstPt[], maxK: number, reach: number): Array<[ConstPt, ConstPt]> => {
    const segs: Array<[ConstPt, ConstPt]> = [];
    for (let j = 0; j < pts.length; j++) {
      for (let k = j + 1; k < Math.min(pts.length, j + maxK); k++) {
        const a = pts[j]!;
        const b = pts[k]!;
        if (Math.abs(b.y - a.y) < step * reach) segs.push([a, b]);
      }
    }
    return segs;
  };

  const body: string[] = [];
  body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#0c0e13"/>`);

  for (const bk of model.bokeh) {
    const bx = (bk.side ? 0.55 + bk.y * 0.4 : 0.05 + bk.y * 0.4) * W;
    const by = bk.x * H;
    const cyan = bx < W / 2;
    body.push(`<circle cx="${r2(bx)}" cy="${r2(by)}" r="${r2(bk.r)}" fill="url(#${cyan ? 'bokeh-cyan' : 'bokeh-pink'})"/>`);
  }

  body.push(`<line x1="${r2(baseL)}" y1="${r2(padY)}" x2="${r2(baseL)}" y2="${r2(H - padY)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`);
  body.push(`<line x1="${r2(baseR)}" y1="${r2(padY)}" x2="${r2(baseR)}" y2="${r2(H - padY)}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`);

  if (ghostPts) {
    for (const [a, b] of link(ghostPts, 4, 2.2)) {
      body.push(
        `<line x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}" stroke="rgba(170,176,192,0.28)" stroke-width="0.8" stroke-dasharray="2,4"/>`,
      );
    }
    for (const p of ghostPts) {
      if (p.baseline) continue;
      body.push(`<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="1.8" fill="none" stroke="rgba(170,176,192,0.45)"/>`);
    }
  }

  for (const pts of [left, right]) {
    for (const [a, b] of link(pts, 5, 2.6)) {
      body.push(`<line x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}" stroke="#3f8cff" stroke-width="0.8" stroke-opacity="0.5"/>`);
    }
    for (const p of pts) {
      if (p.baseline) {
        body.push(`<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="1" fill="rgba(255,255,255,0.25)"/>`);
        continue;
      }
      const hueSeed = constellationHash(p.k);
      const colorIdx = Math.min(CONSTELLATION_DOTS.length - 1, Math.floor(hueSeed * CONSTELLATION_DOTS.length));
      const brightness = 0.55 + 0.45 * constellationHash(p.k + 0.2);
      const size = (16 + brightness * 22) * 0.4;
      body.push(
        `<circle cx="${r2(p.x)}" cy="${r2(p.y)}" r="${r2(size / 2)}" fill="url(#dot-${colorIdx})" fill-opacity="${r3(brightness)}"/>`,
      );
    }
  }

  const defs =
    `<defs>${CONSTELLATION_DOTS.map((hex, i) => dotGradientDef(hex, `dot-${i}`)).join('')}` +
    `${bokehGradientDef('#3fe0ff', 'bokeh-cyan')}${bokehGradientDef('#ff4fa3', 'bokeh-pink')}</defs>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${body.join('')}</svg>`;
}
