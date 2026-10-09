export function createConstellation({fmtPct}) {
// A small, fast, deterministic PRNG (mulberry32) so the same reading always
// draws the same constellation - the picture must be stable across renders
// of the same data, not merely plausible-looking (handoff: "the waveform is
// static: no playback and no animation").
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stable small integer from an address, so a given address always draws
// the same constellation across visits and across a live check vs. a saved
// reading of the same account - not a security hash, just a display seed.
function seedFromAddress(address) {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (Math.imul(h, 31) + address.charCodeAt(i)) | 0;
  return h >>> 0;
}

function buildConstellationModel(seed, N) {
  const R = rng(seed);
  const bumps = [];
  const nb = 3 + Math.floor(R() * 3);
  for (let i = 0; i < nb; i++) bumps.push({ c: 0.08 + R() * 0.84, w: 0.025 + R() * 0.09, h: 0.3 + R() * 0.6 });
  bumps[0].h = 1;
  const env = [];
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    let v = 0.05;
    for (const b of bumps) v = Math.max(v, b.h * Math.exp(-((x - b.c) ** 2) / (2 * b.w * b.w)));
    env.push(Math.min(1, v * (0.5 + 0.5 * R())));
  }
  const jitter = [], mids = [];
  for (let i = 0; i < N; i++) { jitter.push(0.85 + R() * 0.3); mids.push(R() < 0.5 ? 0.15 + R() * 0.7 : -1); }
  const bokeh = [];
  for (let i = 0; i < 9; i++) bokeh.push({ x: R(), y: 0.2 + R() * 0.7, r: 14 + R() * 46, side: R() < 0.5 ? 0 : 1 });
  return { env, jitter, mids, bokeh };
}
// (This drops the handoff's unused phase/twinkle-over-time machinery - the
// handoff's own paint() always calls draw() with t=0 and never animates in
// practice, "no playback and no animation" per its own README, so nothing
// here needs a per-frame time input.)

const CONSTELLATION_DOTS = ['#6fd0ff', '#9a7bff', '#ff4fa8', '#ffc94d'];
const constellationHash = (n) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };
const CONSTELLATION_SPRITES = {};
function constellationSprite(hex) {
  if (CONSTELLATION_SPRITES[hex]) return CONSTELLATION_SPRITES[hex];
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const R = S / 2;
  const rg = g.createRadialGradient(R, R, 0, R, R, R);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.06, `rgba(${Math.round((r + 510) / 3)},${Math.round((gg + 510) / 3)},${Math.round((b + 510) / 3)},1)`);
  rg.addColorStop(0.14, `rgba(${r},${gg},${b},0.9)`);
  rg.addColorStop(0.32, `rgba(${r},${gg},${b},0.28)`);
  rg.addColorStop(0.6, `rgba(${r},${gg},${b},0.07)`);
  rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  return (CONSTELLATION_SPRITES[hex] = cv);
}

/**
 * Draws one constellation: a left peak (the headline position, always full
 * height) and a right peak scaled by `coverage` (0-1) - what stands against
 * it, as a fraction of the same size. `ghost`, when true, mirrors the LEFT
 * envelope on the right at a fixed dashed/hollow style, for "this exists but
 * is not counted" (funds that sit with a funder, not this account). `mini`
 * draws a small, static, glow-free version for the queue list.
 */
function drawConstellation(cv, { seed, coverage, ghost, mini, bookDensity }) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const N = mini ? 24 : Math.round((bookDensity ? 32 * 1.3 : 32));
  const model = buildConstellationModel(seed, N);
  const padX = mini ? 2 : 24, padY = mini ? 3 : 22;
  const gapHalf = mini ? W * 0.03 : W * 0.075;
  const amp = W / 2 - gapHalf - padX;
  const step = (H - 2 * padY) / (N - 1);
  const baseL = padX, baseR = W - padX;

  if (!mini) {
    for (const bk of model.bokeh) {
      const bx = (bk.side ? 0.55 + bk.y * 0.4 : 0.05 + bk.y * 0.4) * W, by = bk.x * H;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, bk.r);
      const c = bx < W / 2 ? '#3fe0ff' : '#ff4fa3';
      g.addColorStop(0, c + '1f');
      g.addColorStop(1, c + '00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, bk.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(baseL + 0.5, padY); ctx.lineTo(baseL + 0.5, H - padY);
    ctx.moveTo(baseR - 0.5, padY); ctx.lineTo(baseR - 0.5, H - padY);
    ctx.stroke();
  }

  const build = (isRight, ampK, floor) => {
    const sk = (isRight ? 5000 : 0) + seed * 97;
    const dir = isRight ? -1 : 1, base = isRight ? baseR : baseL;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const y = padY + i * step;
      const e = Math.max(floor, model.env[i] * ampK * (isRight ? model.jitter[i] : 1));
      pts.push({ x: base + dir * e * amp, y, k: sk + i * 2 + 1 });
      if (!mini && model.mids[i] > 0 && e > 0.12) {
        pts.push({ x: base + dir * e * amp * model.mids[i], y: y + step * 0.4, k: sk + i * 2 + 2 });
      }
      if (!mini && i % 4 === 0) pts.push({ x: base, y, baseline: true });
    }
    pts.sort((a, b) => a.y - b.y);
    return pts;
  };
  const left = build(false, 1, 0.02);
  const right = build(true, coverage, coverage > 0.05 ? 0.02 : 0.015);
  const ghostPts = ghost ? build(true, 1, 0.02) : null;

  const link = (pts, maxK, reach) => {
    const segs = [];
    for (let j = 0; j < pts.length; j++) {
      for (let k = j + 1; k < Math.min(pts.length, j + maxK); k++) {
        const a = pts[j], b = pts[k];
        if (Math.abs(b.y - a.y) < step * reach) segs.push([a, b]);
      }
    }
    return segs;
  };

  if (ghostPts) {
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(170,176,192,0.28)';
    ctx.lineWidth = mini ? 0.6 : 0.8;
    ctx.beginPath();
    for (const [a, b] of link(ghostPts, mini ? 2 : 4, 2.2)) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(170,176,192,0.45)';
    for (const p of ghostPts) {
      if (p.baseline) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, mini ? 0.9 : 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const pts of [left, right]) {
    const segs = link(pts, mini ? 2 : 5, mini ? 1.5 : 2.6);
    ctx.lineWidth = mini ? 0.7 : 0.8;
    ctx.globalAlpha = mini ? 0.75 : 0.5;
    ctx.strokeStyle = '#3f8cff';
    ctx.beginPath();
    for (const [a, b] of segs) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (const p of pts) {
      if (p.baseline) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      const hueSeed = constellationHash(p.k);
      const color = CONSTELLATION_DOTS[Math.floor(hueSeed * CONSTELLATION_DOTS.length)];
      const brightness = 0.55 + 0.45 * constellationHash(p.k + 0.2);
      const size = (mini ? 9 : 16 + brightness * 22) * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = brightness;
      ctx.drawImage(constellationSprite(color), p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * What `drawConstellation` needs, derived from a real reading rather than
 * the design handoff's four hardcoded mock numbers. `coverage` mirrors what
 * each verdict's own rule already measures - it is not a new number, only a
 * new way to draw one that already exists on every reading.
 *
 * The right side of the constellation means exactly one thing for every
 * verdict: coverage - what genuinely offsets or matches the position, never
 * concentration (how large this position is relative to the rest of the
 * account, a different question this project already answers elsewhere).
 * Traced by hand against every verdict type in this project (see the 26.09
 * redesign plan, Task 2, Step 4, and its correction after review):
 *  - Book: `coverage` is matched-both-sides notional over the headline
 *    notional - the same fraction the old drawBookQuoting bar filled.
 *  - Long/bet (isLong, i.e. `!b || !b.applies`, the same condition
 *    renderBreakdown already used elsewhere in this file): `coverage` is a
 *    flat 0 - spot cannot offset a long (see computeHedgeFeatures in
 *    src/engine/features.ts, where hedgeRatio is hard-wired to 0 whenever
 *    the headline side is not 'short'), so a long's coverage is 0 by
 *    construction, not a number this function needs to derive. This matches
 *    the design handoff's own mock (`right: 0` for its one bet example)
 *    exactly. An earlier version of this function used `headlineShare`
 *    (concentration) here instead, on the reasoning that a flat 0 would
 *    make every bet look identical regardless of how concentrated it was -
 *    that reasoning conflated two different axes: concentration is real and
 *    specific to this address, but it is not what the right side of this
 *    diagram means, and using it there drew a fully-covered-looking peak
 *    for the one verdict type that is by definition never covered at all.
 *    Concentration itself is not lost - it is exactly what the `#decisive`
 *    hero tiles above this diagram already show ("Largest position: $X
 *    HYPE long"), independent of this canvas.
 *  - Hedged / Unknown ("funders" in the handoff's naming) / any other
 *    reading whose breakdown applies: `coverage` is `hedge.hedgeRatio`,
 *    clamped to [0,1] - algebraically identical to the old drawScale's own
 *    `(covered + excess) / headlineUsd`, since covered+excess always equals
 *    hedge.hedgeUsd whether or not the hedge exceeds the position. `ghost`
 *    is true exactly when `breakdown.elsewhere` exists (the funders case).
 *
 * Data quality is displayed alongside the diagram and in exported images.
 * A confirmed amount found so far is useful even when the search was partial;
 * the label must never suggest that the remaining exposure was fully read.
 */
function constellationInputsFor(d) {
  const seed = seedFromAddress(d.address);
  const b = d.breakdown;
  const isLong = !b || !b.applies;
  if (d.verdict.verdict === 'book') {
    const headlineUsd = d.positions.headlineNotionalUsd || 0;
    const matched = (d.orders && d.orders.headlineTwoSidedNotionalUsd) || 0;
    return { seed, coverage: headlineUsd > 0 ? Math.min(1, matched / headlineUsd) : 0, ghost: false, bookDensity: true };
  }
  if (isLong) {
    return { seed, coverage: 0, ghost: false, bookDensity: false };
  }
  const ratio = d.hedge && typeof d.hedge.hedgeRatio === 'number' ? d.hedge.hedgeRatio : 0;
  const hasElsewhere = !!(b && b.elsewhere);
  return { seed, coverage: Math.max(0, Math.min(1, ratio)), ghost: hasElsewhere, bookDensity: false };
}

/** The big centered number over the diagram: every branch of
 * constellationInputsFor already normalizes `coverage` to a 0-1 fraction,
 * so one formatter covers hedged, unknown, long and book alike - only the
 * label below it (constellationStatLabelFor) changes per verdict. */
function constellationStatFor(d, inputs) {
  if (d.verdict.verdict !== 'book' && d.positions.headlineSide === 'long') return '—';
  return inputs.coverage > 0 && inputs.coverage < 0.001 ? '<0.1%' : fmtPct(inputs.coverage);
}

/** The short label under the big number. Every verdict's number is now a
 * coverage fraction, never concentration, so a long reads the same shape of
 * label a hedged position at 0% would ("covered") rather than a
 * concentration-flavored phrase - book and unknown/funders keep their own
 * old wording (old drawBookQuoting said "matched both sides"; old
 * drawScale's funders case said "covered by <coin> this address holds"). */
function constellationStatLabelFor(d) {
  if (d.verdict.verdict !== 'book' && d.positions.headlineSide === 'long') return 'spot coverage not applicable';
  if (d.verdict.verdict === 'book') return 'quoted both sides';
  if (constellationQualityNoteFor(d)) return 'found coverage';
  return d.verdict.verdict === 'unknown' ? 'covered by this address' : 'covered';
}

function constellationQualityNoteFor(d) {
  // A book's number is how much of its own market it quotes on both sides,
  // read in full from its resting orders. The hedge search that
  // breakdown.dataQuality describes is deliberately never run for a book
  // (hedgeCanChangeVerdict), so its 'partial' says nothing about the number
  // shown - and used to flag every Book short as INCOMPLETE DATA (27.09).
  if (d.verdict.verdict === 'book') return null;
  if ((d.verdict.reasons || []).includes('positions_stale')) return 'Exposure unresolved: positions and the other sources describe different times.';
  if (d.positionsCoverage && d.positionsCoverage !== 'complete') return 'Exposure unresolved: positions on other venues were not verified. This shows found holdings only.';
  const quality = d.breakdown && d.breakdown.applies && d.breakdown.dataQuality;
  if (quality === 'unknown' && d.hedge && d.hedge.hasUnresolvedLiability) return 'Exposure unresolved: the spot ratio does not include the known same-asset debt.';
  const legs = d.positions.selectedPerpLegs;
  if (quality === 'unknown' && (legs ? legs.opposingUsd > 0 || legs.sameSideOtherUsd > 0 : (d.positions.sameAssetOffsetShare || 0) > 0)) return 'Exposure unresolved: the spot ratio does not combine the opposing perpetual legs.';
  if (quality === 'unknown' && (d.positions.headlineCoin || '').includes(':') && d.positions.headlineUnderlyingVerified !== true) return 'Exposure unresolved: the underlying of this HIP-3 contract has not been verified.';
  if (quality === 'partial') return 'Incomplete read: not all holdings were checked. Coverage shown is only what was found.';
  if (quality === 'unpriced') return 'Incomplete read: some matching holdings could not be priced. Coverage shown is only what was found.';
  if (quality === 'unverified') return 'Incomplete read: some holdings could not be identified. Coverage shown is only what was found.';
  if (quality === 'unknown' || quality === undefined && d.breakdown && d.breakdown.applies) return 'Coverage quality was not recorded for this saved reading.';
  return null;
}

function constellationQualityFlagFor(d) {
  if (!constellationQualityNoteFor(d)) return null;
  return d.breakdown && (!d.breakdown.dataQuality || d.breakdown.dataQuality === 'unknown')
    ? 'Coverage unverified'
    : 'Incomplete data';
}


return {drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor};
}
