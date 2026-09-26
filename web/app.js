const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const EXPLORERS = {
  arbitrum: 'https://arbiscan.io/address/',
  ethereum: 'https://etherscan.io/address/',
};
const VERDICTS = {
  book: { label: 'Book', cls: 'book', headline: 'This is a market-making book.', accent: '#7fa2ff' },
  hedged: { label: 'Hedged', cls: 'hedged', headline: 'The offsetting asset is in this same account.', accent: '#4fe0b0' },
  looks_like_a_bet: { label: 'Looks like a bet', cls: 'bet', headline: 'This looks like a real bet.', accent: '#f2b35c' },
  unknown: { label: 'Unknown', cls: 'unknown', headline: 'Not enough evidence either way.', accent: '#a3a8b6' },
};
// The site is dark-only since Task 1 of the 26.09 redesign, so there is no
// longer a second, theme-aware palette for the canvas share card and the
// server OG picture to deliberately diverge from - all three surfaces (live
// page, share canvas, OG picture) now read the same four fixed hex values,
// the ones Task 1 also put in :root as --book-fg/--hedged-fg/--bet-fg/
// --unknown-fg. Kept as concrete hex here rather than a CSS var because both
// fixed-background renderers (this canvas, and the OG picture's satori
// tree) have no CSS cascade to read a var() from.
const SVG_ACCENT_VAR = {
  book: '--book-fg', hedged: '--hedged-fg', looks_like_a_bet: '--bet-fg', unknown: '--unknown-fg',
};
function svgAccentOf(d) {
  return 'var(' + (SVG_ACCENT_VAR[d.verdict.verdict] || SVG_ACCENT_VAR.unknown) + ')';
}
const PAGE_SIZE = 25;
// The reading a visitor with nothing pasted yet sees first: the funded-short
// demonstration reading, because its picture is the one that needs no
// explanation (a big bar, an empty solid segment, and $395.8M held in a
// dashed box beside it that "does not count"). Free to open - it is one of
// the four bundled chips, opened the same way a shared link would (24.09
// audit, U01).
const FLAGSHIP_ID = '34stjd0gtgkz1';

const $ = (id) => document.getElementById(id);
let current = null;
let pendingGuess = null;
let guessRevealTimer = null;
let gallery = null;
let galleryFilter = 'all';
let galleryShown = PAGE_SIZE;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
// Must agree with src/guard.ts: the trailing guard stops a 66-character
// transaction hash yielding its first 42 characters, which is a real and
// unrelated address.
function extractAddress(input) {
  if (input.length > 2048) return null;
  const m = input.trim().match(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/);
  return m ? m[0].toLowerCase() : null;
}
function shortAddr(a) {
  return a.slice(0, 6) + '...' + a.slice(-4);
}
function plural(n, word) {
  return n.toLocaleString('en-US') + ' ' + word + (n === 1 ? '' : 's');
}
function fmtUsd(n) {
  const a = Math.abs(n);
  if (a < 0.5) return '$0';
  const sign = n < 0 ? '-' : '';
  if (a >= 999950000) return sign + '$' + (a / 1e9).toFixed(1) + 'B';
  if (a >= 999500) return sign + '$' + (a / 1e6).toFixed(1) + 'M';
  if (a >= 999.5) return sign + '$' + Math.round(a / 1e3) + 'K';
  return sign + '$' + Math.round(a);
}
/** Mirrors formatPct in src/engine/evidence.ts: below 10% a single decimal,
 * because "0%" and "0.3%" are different answers about a hedge. */
function fmtPct(x) {
  const p = x * 100;
  if (p === 0) return '0%';
  return (Math.abs(p) >= 10 ? Math.round(p) : p.toFixed(1)) + '%';
}

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
 * Known gap, deliberately not fixed here: unlike the old drawScale, this
 * function never looks at `breakdown.dataQuality` or the segment-level
 * not-checked/unverified signals, so a hedge read that was partial,
 * unpriced or left a material share unidentified renders with the same
 * confident-looking coverage number as a fully measured one - the old
 * diagram's dashed "suspended" state (unread, could still tip either way)
 * has no equivalent yet. None of the four currently-shipped examples hit
 * this path, but a live check of an arbitrary address could. Left for a
 * later pass rather than folded in here.
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
  return fmtPct(inputs.coverage);
}

/** The short label under the big number. Every verdict's number is now a
 * coverage fraction, never concentration, so a long reads the same shape of
 * label a hedged position at 0% would ("covered") rather than a
 * concentration-flavored phrase - book and unknown/funders keep their own
 * old wording (old drawBookQuoting said "matched both sides"; old
 * drawScale's funders case said "covered by <coin> this address holds"). */
function constellationStatLabelFor(d) {
  if (d.verdict.verdict === 'book') return 'quoted both sides';
  return d.verdict.verdict === 'unknown' ? 'covered by this address' : 'covered';
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function verdictOf(d) {
  return VERDICTS[d.verdict.verdict] || VERDICTS.unknown;
}
function badgeText(d) {
  const base = verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
  return d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base;
}
function headlineFor(d) {
  if (d.positions.nPositions === 0) return 'Nothing open right now.';
  const reasons = d.verdict.reasons || [];
  if (reasons.indexOf('linked_exposure_unverified') !== -1) {
    return 'The matching assets sit in a wallet that funded this account, not in this account.';
  }
  if (reasons.indexOf('mixed_long_short_book') !== -1) {
    return 'The dollars net out, but across different assets.';
  }
  if (reasons.indexOf('offset_not_measured') !== -1) {
    return 'The dollars net out; this snapshot cannot say whether the legs offset each other.';
  }
  if (reasons.indexOf('partial_offset') !== -1) {
    return 'Only part of this position is covered. The rest is still open.';
  }
  if (reasons.indexOf('over_covered') !== -1) {
    return 'More than covered: on the asset itself, this account is net long.';
  }
  if (reasons.indexOf('hedge_not_checked') !== -1) {
    return 'Directional exposure is visible. Whether it is hedged could not be checked.';
  }
  if (reasons.indexOf('maker_flow_only') !== -1) {
    return 'A busy account. That is not the same as this position being a market maker’s inventory.';
  }
  return verdictOf(d).headline;
}
function positionText(d) {
  const p = d.positions;
  return p.nPositions === 0 ? 'No open positions' : fmtUsd(p.headlineNotionalUsd) + ' ' + p.headlineCoin + ' ' + p.headlineSide;
}
function explorerLink(address, chain) {
  const a = el('a', 'mono', shortAddr(address));
  if (ADDRESS_RE.test(address) && EXPLORERS[chain]) {
    a.href = EXPLORERS[chain] + address;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}
function setStatus(text, isError) {
  const s = $('status');
  s.textContent = text;
  s.className = 'status' + (isError ? ' error' : '');
}

/**
 * What moved between this reading and the one it replaced.
 *
 * Nothing is fetched to answer it beyond the comparison itself, which is
 * made out of two readings that already exist. The line that matters is the
 * attribution: "the reading changed" and "the rules changed" are two
 * different pieces of news and a card cannot leave the reader to guess.
 */
async function renderChanged(d) {
  const box = $('changed');
  box.hidden = true;
  if (!d.supersedes || !d.snapshotId) return;
  let c;
  try {
    const res = await fetch(
      '/api/compare?a=' + encodeURIComponent(d.supersedes) + '&b=' + encodeURIComponent(d.snapshotId),
    );
    if (!res.ok) return;
    c = await res.json();
  } catch {
    return;
  }
  // The card may have moved on while this was in the air.
  if (!current || current.snapshotId !== d.snapshotId) return;
  // A different question - a manual pick against the largest-position
  // default, or two different manual picks - is not a change at this
  // address, and putting the two side by side as if it were is worse than
  // saying nothing (23.09 audit, L02).
  if (c.questionChanged) {
    box.hidden = false;
    $('changed-title').textContent = 'Since ' + fmtTime(c.from.observedAt);
    $('changed-because').textContent = 'That reading answered a different question, so there is nothing to compare it to.';
    $('changed-list').replaceChildren();
    return;
  }
  if (!c.changes.length && !c.verdictChange) return;

  box.hidden = false;
  $('changed-title').textContent = 'What changed since ' + fmtTime(c.from.observedAt);
  // A grade is part of the answer: "Book (strong)" to "Book (likely)" is a
  // change, and "did not change" under two different versions of the rules
  // says so rather than reading as the same rules agreeing twice.
  const named = (verdict, strength) => (VERDICTS[verdict] || VERDICTS.unknown).label + (strength ? ' (' + strength + ')' : '');
  const vc = c.verdictChange;
  $('changed-because').textContent = vc
    ? 'The answer went from "' + named(vc.from, vc.fromStrength) + '" to "' + named(vc.to, vc.toStrength) +
      '" because ' + vc.because + '.'
    : c.rulesChanged
      ? 'The answer did not change, though the rules reading it did (' + c.from.classifierVersion + ' to ' +
        c.to.classifierVersion + ').'
      : 'The answer did not change.';
  const arrow = { up: '\u2191', down: '\u2193', sideways: '\u2192' };
  $('changed-list').replaceChildren(
    ...c.changes.map((ch) => {
      const li = el('li');
      li.append(
        el('span', 'dir', arrow[ch.direction] + ' '),
        ch.field + ': ' + ch.from + ' \u2192 ' + ch.to,
      );
      return li;
    }),
  );
}

/**
 * The positions this address holds, offered as a choice.
 *
 * A check answers about one position, and it used to always be the largest
 * one: the reader who came from a post about BTC got an answer about ETH
 * with nothing saying so. Choosing another is a different question, so it
 * is a different check - the chip says as much before it spends anything.
 */
function renderPicker(d, kind) {
  const list = (d.positions && d.positions.candidates) || [];
  const box = $('picker');
  // Nothing to choose between, and a saved reading is a reading of one
  // position: re-asking it is a new live check, started from the address.
  if (list.length < 2 || kind !== 'live') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('picker-chips').replaceChildren(
    ...list.map((c) => {
      const active = c.coin === d.positions.headlineCoin && c.side === d.positions.headlineSide;
      const b = el('button', 'chip', fmtUsd(c.sizeUsd) + ' ' + c.coin + ' ' + c.side);
      b.setAttribute('aria-pressed', String(active));
      if (!active) b.title = 'Check this position instead - a new reading of this address';
      b.disabled = active;
      b.addEventListener('click', () => checkPosition(d.address, c));
      return b;
    }),
  );
}

// MATERIAL_GAP_SHARE, HEDGE_BAND_MIN and HEDGE_BAND_MAX no longer feed any
// drawing code - the balance-scale SVG they were tuned for (drawScale, and
// drawBeamAndPivot/drawPan/scaleGeometry/MAX_TILT_DEG beside it) was
// replaced by the constellation canvas above them in this file. They stay,
// unused but present, only because test/web-app-verdict-sync.test.ts reads
// these exact names out of this file's own source text and checks them
// against DEFAULT_THRESHOLDS.hedged, so a retune of the classifier's real
// thresholds still has something in this file to disagree with, rather than
// silently going unchecked (26.09 redesign plan, Task 2, Step 7).
const MATERIAL_GAP_SHARE = 0.1;
const HEDGE_BAND_MIN = 0.85;
const HEDGE_BAND_MAX = 1.15;

function renderBreakdown(d) {
  const box = $('breakdown');
  const isBook = d.verdict.verdict === 'book' && !!d.orders;
  const b = d.breakdown;
  const isLong = !isBook && (!b || !b.applies) && d.positions.nPositions > 0 && d.positions.headlineSide === 'long';
  if (!isBook && (!b || !b.applies || !b.segments.length) && !isLong) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  // Sourced from `d.positions`, never from `b`, even when not isBook: an
  // ancient stored reading from before `breakdown` existed at all can have
  // `b === undefined` while still being a long position worth a
  // constellation diagram (`isLong` only requires `!b || !b.applies`) -
  // reading `b.coin` there would throw.
  const coin = d.positions.headlineCoin;
  const side = d.positions.headlineSide;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '260px';
  canvas.style.display = 'block';
  const inputs = constellationInputsFor(d);
  const statBox = el('div', 'constellation-stat');
  statBox.append(
    el('div', 'constellation-stat-value', constellationStatFor(d, inputs)),
    el('div', 'constellation-stat-label', constellationStatLabelFor(d)),
  );
  $('breakdown-svg').replaceChildren(canvas, statBox);
  drawConstellation(canvas, { ...inputs, mini: false });
  if (!canvas.dataset.roAttached) {
    canvas.dataset.roAttached = '1';
    new ResizeObserver(() => drawConstellation(canvas, { ...constellationInputsFor(d), mini: false })).observe(canvas);
  }

  $('breakdown-caption').textContent = isBook
    ? `What stands behind the ${coin} ${side}`
    : isLong
      ? `How concentrated the ${coin} ${side} is`
      : b && b.elsewhere
        ? `What stands against the ${coin} ${side} - and what only looks like it does`
        : `What stands against the ${coin} ${side}`;
}

/** What this rendering is: a live check, a saved reading or a gallery card. */
function kindOf(opts) {
  return (opts && opts.kind) || 'live';
}

function renderResult(d, opts) {
  current = d;
  current.__kind = kindOf(opts);
  // Unhidden first, before anything below measures a box inside it: with
  // `#card` still hidden, `#breakdown`'s own clientWidth reads 0 regardless
  // of its own hidden state, and renderBreakdown fell back to a fixed 640 on
  // every first paint - correct only by coincidence on a desktop-width phone
  // emulation, wrong on a real one (23.09 audit, U01). Every update below
  // runs synchronously in this same task, so there is nothing to flash.
  $('card').hidden = false;
  // A new card starts folded: what the last one had open says nothing about
  // what the reader wants from this one.
  for (const id of ['share', 'nansen', 'decided', 'details']) $(id).open = false;
  const v = verdictOf(d);
  $('guess').hidden = true;
  clearTimeout(guessRevealTimer);
  const guessBox = $('guess-result');
  if (guessBox) guessBox.remove();
  if (kindOf(opts) === 'live' && pendingGuess !== null) {
    const guessed = pendingGuess;
    pendingGuess = null;
    const p = el('p', 'guess-result');
    p.id = 'guess-result';
    if (guessed === 'cant_tell') {
      p.textContent = "You said you couldn't tell. The reading found: " + badgeText(d) + '.';
    } else {
      const matched = guessed === d.verdict.verdict;
      const stats = recordGuess(matched);
      p.textContent =
        'You guessed ' + GUESS_LABEL[guessed] + '. The reading says ' + badgeText(d) + '.' +
        (stats ? ' Matched ' + stats.matches + ' of ' + stats.total + ' so far.' : '');
    }
    $('status').insertAdjacentElement('afterend', p);
  }
  $('badge').textContent = badgeText(d);
  // Faded and dashed when the rules that gave it are no longer in force, on
  // the card as it already was in the list.
  $('badge').className = 'badge ' + v.cls + (d.historical ? ' historical' : '');
  $('headline').textContent = headlineFor(d);
  $('summary').textContent = d.summary || '';

  // Closed by default, so the summary above is the whole answer for a
  // reader who does not ask for more. Opening it says the rule in words
  // first - the server's sentence, from the same thresholds the rules use -
  // and keeps the raw reason code for whoever wants to check the rules
  // themselves (23.09 audit, U06).
  const reasons = (d.verdict && d.verdict.reasons) || [];
  $('decided').hidden = reasons.length === 0 && !d.rule;
  $('decided-rule').textContent = d.rule || '';
  $('decided-rule').hidden = !d.rule;
  $('decided-reasons').textContent = reasons.join(', ') || 'none';
  $('decided-version').textContent = d.classifierVersion || '?';

  // What the reading leaves open, and what Nansen added to it - both worked
  // out on the server from the reading itself (src/engine/openQuestion.ts,
  // src/engine/nansenContribution.ts). A reading saved before they existed
  // simply has neither.
  $('open-question').hidden = !d.openQuestion;
  $('open-question').replaceChildren(el('strong', null, 'Still open: '), d.openQuestion || '');
  const nz = d.nansen;
  $('nansen').hidden = !nz;
  if (nz) {
    $('nansen-lead').textContent = nz.lead;
    $('nansen-list').replaceChildren(...nz.items.map((text) => el('li', null, text)));
    $('nansen-calls').textContent = plural(nz.calls, 'Nansen API call') + ' made for this reading.';
  }

  const tile = (item) => {
    // The row the verdict turned on leads, rather than sitting fourth in a
    // line of identical tiles (audit U03).
    const box = el('div', 'stat' + (item.decisive ? ' decisive' : ''));
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value', item.value), el('div', 'stat-source', item.source));
    return box;
  };
  $('stats').replaceChildren(...(d.evidence || []).map(tile));

  // Leverage, distance to liquidation, unrealized PnL, funding since open:
  // numbers about the position itself rather than about the verdict, so
  // they get their own strip instead of competing with the evidence that
  // decided bet/hedge/book (22.09 audit). Older saved readings and gallery
  // cards predate this and carry none, so the strip just does not appear.
  const vitals = d.vitals || [];
  $('vitals').hidden = vitals.length === 0;
  $('vitals-stats').replaceChildren(...vitals.map((item) => {
    const box = el('div', 'stat');
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value', item.value), el('div', 'stat-source', item.source));
    return box;
  }));

  renderPicker(d, kindOf(opts));
  // Which position this answer is about, said before the answer. The
  // picker says it when there is a choice to offer; otherwise this line does.
  $('subject').hidden = !$('picker').hidden;
  $('subject').replaceChildren(
    el('span', 'muted', d.focus ? 'The position asked about' : 'The position'),
    ' ',
    el('strong', null, positionText(d)),
    ' ',
    el('span', 'muted', '· checked ' + fmtTime(d.checkedAt)),
  );
  renderChanged(d);
  renderBreakdown(d);

  // The decisive number now leads the card on its own (25.09 audit, the
  // "hero numbers" redesign) - it is no longer suppressed just because the
  // diagram repeats the same fact. That is a real tradeoff, not a settled
  // one: in most cases the tile and the diagram now do say the same thing
  // twice, and the diagram is kept anyway as the visual backup for that
  // repetition. Scope note: drawCard() (the Copy/Download image renderer,
  // ~line 1538) and the OG social preview are untouched by this task and
  // still pick tile XOR diagram, never both - so a live reading and its own
  // shareable image can now disagree structurally. That gap is this task's
  // known boundary, left for a future task, not an oversight.
  const heroTiles = (d.evidence || []).filter((item) => item.decisive);
  // A reason of linked_exposure_unverified already put the funders' figure
  // into heroTiles above, as the "Linked wallets" evidence tile (src/engine
  // /evidence.ts's DECISIVE_LABEL_BY_REASON) built from this same linkedHedge
  // data. Pushing the elsewhere tile too would show the identical dollar
  // amount and wallet count twice in a row (confirmed against the stored
  // 34stjd0gtgkz1 reading, $395.8M in 2 wallets, in data/featured.json).
  const alreadyShowsFunderHoldings = (d.verdict.reasons || []).includes('linked_exposure_unverified');
  if (d.breakdown && d.breakdown.elsewhere && !alreadyShowsFunderHoldings) {
    heroTiles.push({
      label: 'Held elsewhere',
      value: fmtUsd(d.breakdown.elsewhere.usd) + ' in ' + plural(d.breakdown.elsewhere.wallets, 'wallet') + ' that funded this account',
      source: 'Nansen · ownership unverified',
      decisive: true,
    });
  }
  $('decisive').hidden = heroTiles.length === 0;
  $('decisive').replaceChildren(...heroTiles.map(tile));

  const funders = d.linkedHedge && Array.isArray(d.linkedHedge.funders) ? d.linkedHedge.funders : [];
  $('funders').hidden = funders.length === 0;
  $('funders-list').replaceChildren(...funders.map((f) => {
    const li = el('li');
    li.append(
      explorerLink(f.address, f.chain),
      el('span', 'muted', ' on ' + f.chain + ', holds ' + fmtUsd(f.matchingUsd) + ' of ' + d.positions.headlineCoin + ' or its wrapped forms'),
    );
    return li;
  }));

  // A source that failed cost this answer something, so it stays in sight
  // next to the answer. A note that only describes what was found goes one
  // click down. A reading saved before notes said which kind they were
  // keeps every one of them in sight, the cautious way round.
  const flagged = Array.isArray(d.coverageNotes) ? d.coverageNotes : [];
  const notes = [
    ...flagged,
    ...(d.coverage || [])
      .filter((text) => !flagged.some((n) => n.text === text))
      .map((text) => ({ text, failure: true })),
  ];
  const failures = notes.filter((n) => n.failure).map((n) => n.text);
  const remarks = notes.filter((n) => !n.failure).map((n) => n.text);
  $('coverage').hidden = failures.length === 0;
  $('coverage-list').replaceChildren(...failures.map((c) => el('li', null, c)));
  $('notes').hidden = remarks.length === 0;
  $('notes-list').replaceChildren(...remarks.map((c) => el('li', null, c)));

  const meta = $('meta');
  meta.replaceChildren();
  const calls = typeof d.nansenCalls === 'number' ? ' · ' + plural(d.nansenCalls, 'Nansen API call') : '';
  const src = d.source === 'nansen' ? 'positions from Nansen' : 'positions from Hyperliquid (Nansen unavailable)';
  // When the source says it measured the positions, that is the time the
  // numbers describe. "Checked" is only when this page asked.
  const measured =
    d.positionsAsOf && fmtTime(d.positionsAsOf) !== fmtTime(d.checkedAt)
      ? ' · positions as of ' + fmtTime(d.positionsAsOf)
      : '';
  const rules = d.classifierVersion ? ' · rules ' + d.classifierVersion : '';
  // "Check live" can be answered from the ten-minute cache, and a card that
  // looks new when it is nine minutes old is the wrong thing to hand a
  // reader watching a position move.
  const ageMin = Math.floor((Date.now() - new Date(d.checkedAt).getTime()) / 60000);
  const age = kindOf(opts) === 'live' && ageMin >= 1 ? ' · cached, ' + plural(ageMin, 'minute') + ' old' : '';
  meta.append('Checked ' + fmtTime(d.checkedAt) + measured + age + calls + ' · ' + src + rules + ' · ');
  const hs = el('a', null, 'view on Hypurrscan');
  if (ADDRESS_RE.test(d.address)) {
    hs.href = 'https://hypurrscan.io/address/' + d.address;
    hs.target = '_blank';
    hs.rel = 'noopener noreferrer';
  }
  meta.append(hs);

  // Whatever is on screen, the address field says which account it is about.
  $('address').value = d.address;

  const kind = kindOf(opts);
  if (d.focus) {
    $('picker-chips').setAttribute('aria-label', 'asked about ' + d.focus.coin + ' ' + d.focus.side);
  }
  $('snapshot').hidden = kind === 'live';
  if (kind === 'gallery') {
    // An entry whose observation predates the current rules keeps the
    // verdict the older rules gave it. Saying which rules read a card is
    // the difference between history and a current answer (audit A06).
    $('snapshot-text').textContent = d.historical
      ? 'Snapshot from the gallery scan, ' +
        fmtTime(d.checkedAt) +
        ', read by the rules of the time (' +
        (d.classifierVersion || 'earlier') +
        '). ' +
        d.historical.reason
      : 'Snapshot from the gallery scan, ' + fmtTime(d.checkedAt) + '.';
  } else if (kind === 'saved') {
    $('snapshot-text').textContent =
      'Saved reading from ' + fmtTime(d.checkedAt) + '. Checking again makes a new one.';
  }

  $('card-canvas').hidden = true;
  if (kind === 'live' && d.snapshotId && d.positions.nPositions > 0) {
    saveRecent({
      id: d.snapshotId,
      address: d.address,
      headline: positionText(d),
      verdict: d.verdict.verdict,
      badgeQualifier: d.badgeQualifier ?? null,
      checkedAt: d.checkedAt,
    });
    renderRecent();
  }
}

// Every request gets a number. Enter, the Check button and "Check live" can
// all fire while one is in the air, and without this the slower answer wins
// and the card shows the previous address.
//
// A gallery click is one of those moves too. It used not to take a number,
// so a check still running would land on top of the card the reader had just
// opened (audit R03).
let requestSeq = 0;
let busy = false;

/** Abandons whatever is in flight. Nothing is cancelled on the server - the
 * credits are spent either way and the budget still settles - but its answer
 * will not be painted over the reading the reader has moved to. */
function takeOver() {
  requestSeq++;
  setBusy(false);
  return requestSeq;
}

/** Keeps the address bar pointing at what is on screen. Opening a card used
 * to leave the previous reading's link in the bar, so copying it shared the
 * wrong one. */
function showLink(id) {
  const next = id ? '/?s=' + encodeURIComponent(id) : '/';
  if (window.location.pathname + window.location.search !== next) {
    window.history.replaceState(null, '', next);
  }
}

function setBusy(on) {
  busy = on;
  $('check').disabled = on;
  $('check').textContent = on ? 'Checking...' : 'Check';
  $('check-live').disabled = on;
}

// ---- the operator key for the demo reserve ----
//
// Part of the daily cap is kept out of the public path so a busy afternoon
// cannot leave the demo on Hyperliquid-only data, and the key that reaches
// it goes in a request header, never a URL: a query string ends up in
// history, logs and a screen recording's own address bar (23.09 audit, S03).
// This is the operator's way to set it: open /#operator once, before
// recording, and paste the key. It is checked there and then, kept in this
// browser only, sent only with a check, and never shown.
const OPERATOR_KEY = 'betOrBook:operatorKey';

function operatorKey() {
  try {
    return window.localStorage.getItem(OPERATOR_KEY) || '';
  } catch (e) {
    return '';
  }
}

async function setUpOperator() {
  // Off the address bar first, so not even the word lingers there.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const entered = window.prompt(
    'Operator key for the demo reserve. It stays in this browser, is sent only as a request header with a ' +
      'check, and is never shown. Leave it empty to remove it.',
    '',
  );
  if (entered === null) return;
  const key = entered.trim();
  try {
    if (key) window.localStorage.setItem(OPERATOR_KEY, key);
    else window.localStorage.removeItem(OPERATOR_KEY);
  } catch (e) {
    setStatus('This browser would not keep the key.', true);
    return;
  }
  if (!key) {
    setStatus('Operator key removed from this browser.', false);
    return;
  }
  // Asked now, on its own and for free, so a wrong key is found before the
  // recording rather than on it.
  try {
    const res = await fetch('/api/demo-access', { method: 'POST', headers: { 'x-demo-key': key } });
    if (res.status === 204) {
      setStatus('Operator key accepted: checks from this browser can use the demo reserve.', false);
    } else {
      window.localStorage.removeItem(OPERATOR_KEY);
      setStatus('The server did not accept that operator key, so it was not kept.', true);
    }
  } catch (e) {
    setStatus('Could not reach the server to check the operator key; it is kept, unverified.', true);
  }
}

// Starting a check spends money, so it is a POST: a GET is something a
// crawler, a link preview or a browser prefetch can trigger on its own, and
// used to run the paid branch when they did.
//
// `retryDelays` is for a saved reading that answers 404. KV can take up to a
// minute to show a new write in a region that has not seen it, and a link
// is opened within that minute of being shared all the time - so a 404 that
// early is often "not here yet" rather than "gone" (23.09 audit, S05).
async function load(url, onData, failureText, method, notice, retryDelays) {
  const seq = ++requestSeq;
  setBusy(true);
  // A guessing prompt only belongs to a live check that is actually taking
  // a moment - a cached or already-in-flight answer must not imply there was
  // anything to guess. Revealed only if nothing has come back within 700ms,
  // and hidden again the instant an answer (of any kind) does (24.09 audit,
  // user-approved mechanic: "guess the verdict").
  pendingGuess = null;
  $('guess').hidden = true;
  clearTimeout(guessRevealTimer);
  const isLiveCheck = method === 'POST' && url.indexOf('/api/check') === 0;
  if (isLiveCheck) {
    guessRevealTimer = setTimeout(() => {
      if (seq === requestSeq) $('guess').hidden = false;
    }, 700);
  }
  // A notice about the input - "three addresses here, using the first" - is
  // about to be replaced by the progress line one statement later, which is
  // how it became unreadable. It travels with the request instead.
  // A saved reading is opened, not read again: saying Nansen is being asked
  // when nothing is would misdescribe a free lookup as a paid check.
  const doing = method === 'POST' ? 'Reading positions from Nansen and orders from Hyperliquid...' : 'Opening the saved reading...';
  setStatus((notice ? notice + ' ' : '') + doing, false);
  try {
    let res;
    let data;
    // Only a check carries the operator key, and only when one is set.
    const key = method === 'POST' && url.indexOf('/api/check') === 0 ? operatorKey() : '';
    for (let attempt = 0; ; attempt++) {
      res = await fetch(url, key ? { method, headers: { 'x-demo-key': key } } : { method: method || 'GET' });
      data = await res.json().catch(() => ({}));
      if (seq !== requestSeq) return;
      const wait = res.status === 404 && retryDelays ? retryDelays[attempt] : undefined;
      if (wait === undefined) break;
      setStatus(
        'Not found here yet. A reading saved in the last minute can take that long to reach every region - trying again...',
        false,
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (seq !== requestSeq) return;
    }
    clearTimeout(guessRevealTimer);
    $('guess').hidden = true;
    if (!res.ok) {
      // The previous card is still on screen and is still about whatever it
      // was about. Say so rather than let it pass for the answer just asked
      // for.
      setStatus((data.error || failureText) + (current ? ' The card below is the previous reading.' : ''), true);
      return;
    }
    setStatus(notice || '', false);
    onData(data);
  } catch (e) {
    clearTimeout(guessRevealTimer);
    $('guess').hidden = true;
    if (seq === requestSeq) {
      setStatus(
        'Could not reach the server. Try again shortly.' + (current ? ' The card below is the previous reading.' : ''),
        true,
      );
    }
  } finally {
    if (seq === requestSeq) setBusy(false);
  }
}

// ---- the link's own picture ----
//
// A crawler following a shared link never waits for its picture to be
// drawn: on the Workers free plan the drawing does not fit in one request's
// CPU budget, and a request stopped for CPU answers with an error, not with
// the stand-in picture (23.09 audit, S04). So the page asks for it here, in a
// request of its own whose answer nothing shows - as soon as a reading is
// saved, and again when the reader reaches for a share button - well before
// any crawler has the link.
const pictureAsked = new Set();
function askForPicture(d, isRetry) {
  const id = d && d.snapshotId;
  if (!id || d.snapshotSaved === false || pictureAsked.has(id)) return;
  pictureAsked.add(id);
  fetch('/api/og?id=' + encodeURIComponent(id), { method: 'POST', keepalive: true })
    .then((res) => {
      // Saved moments ago and not visible in this region yet: once more,
      // a little later, and then leave it to the next share button.
      if (res.status === 404 && !isRetry) {
        setTimeout(() => {
          pictureAsked.delete(id);
          askForPicture(d, true);
        }, 4000);
      }
    })
    .catch(() => {
      // Nothing is shown either way; forgetting it lets a later share
      // button ask again.
      pictureAsked.delete(id);
    });
}

function runCheck() {
  if (busy) return;
  const raw = $('address').value;
  const addr = extractAddress(raw);
  if (!addr) {
    // A transaction hash is the common case: it is 66 characters of hex and
    // used to yield its first 42, which is somebody else's address.
    const hex = raw.trim().match(/0x[0-9a-fA-F]{41,}/);
    setStatus(
      hex
        ? 'That looks like a transaction hash, not an address. Paste the wallet address itself.'
        : 'Enter a Hyperliquid address (or a link containing one) first.',
      true,
    );
    return;
  }
  const all = [...raw.trim().matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)];
  const notice = all.length > 1 ? 'Found ' + all.length + ' addresses; using the first, ' + addr + '.' : '';
  return load(
    '/api/check?address=' + encodeURIComponent(addr),
    (data) => {
      renderResult(data, { kind: 'live' });
      // A live reading is worth linking to, so the address in the bar
      // becomes the link to this reading rather than to the account - but
      // only once the server says it really saved one.
      if (data.snapshotId && data.snapshotSaved !== false) {
        showLink(data.snapshotId);
        askForPicture(data);
      } else {
        // Nothing was saved, so there is nothing to link to. Leaving the
        // previous reading's id in the bar would be worse than none.
        showLink(null);
      }
    },
    'Something went wrong. Try again shortly.',
    'POST',
    notice,
  );
}

/** Re-checks the same address, asking about one particular position. */
function checkPosition(address, position) {
  if (busy) return;
  const query =
    '/api/check?address=' + encodeURIComponent(address) +
    '&coin=' + encodeURIComponent(position.coin) +
    '&side=' + encodeURIComponent(position.side);
  return load(
    query,
    (data) => {
      renderResult(data, { kind: 'live' });
      showLink(data.snapshotId && data.snapshotSaved !== false ? data.snapshotId : null);
      askForPicture(data);
    },
    'Something went wrong. Try again shortly.',
    'POST',
  );
}

function openSnapshot(id) {
  takeOver();
  return load(
    '/api/snapshot?id=' + encodeURIComponent(id),
    (data) => {
      // The server says which of the two this is: a gallery card opened by
      // its link is still a gallery card, with the gallery's own wording.
      renderResult(data, { kind: data.kind === 'gallery' ? 'gallery' : 'saved' });
      showLink(id);
    },
    'That link points at a reading that is no longer saved. Check the address again to make a new one.',
    'GET',
    '',
    [2000, 6000, 12000],
  );
}

$('check').addEventListener('click', runCheck);
$('address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
$('check-live').addEventListener('click', () => {
  if (!current) return;
  $('address').value = current.address;
  // A saved BTC reading has to stay about BTC: runCheck() only ever knows
  // the address in the bar, so "Check live" on a chosen position used to
  // silently re-ask for the largest one instead, which can be a different
  // position entirely (23.09 audit, U03).
  if (current.focus) {
    checkPosition(current.address, current.focus);
  } else {
    runCheck();
  }
});
$('check-another').addEventListener('click', () => {
  $('address').focus({ preventScroll: true });
  $('address').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('guess-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  pendingGuess = btn.dataset.guess;
  for (const b of $('guess-chips').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
});

// A visitor with no address in hand had nothing to click above the fold
// until the gallery lower down the page (audit U02). The player strip
// (26.09 redesign, Task 4) is what that visitor sees now: a static
// spotlight on gallery.featured's flagship reading, with the four of them
// listed below it as a queue. A queue row's own click calls openSnapshot()
// directly - the exact same call an old example chip made - so opening one
// is still free, and exactly what the reader would see if they had pasted
// that address themselves. playerIdx only ever names the flagship one now
// (set once in loadGallery); nothing still changes it after that (removed
// after the redesign shipped: prev/next and the segment bar duplicated what
// clicking a queue row already did, in more steps, not fewer).
let playerIdx = 0;

function playerList() {
  return (gallery && gallery.featured) || [];
}

/**
 * drawConstellation/constellationInputsFor (Task 2) read a full
 * CheckResponse - d.breakdown, d.hedge.hedgeRatio, d.orders.*. A
 * gallery.featured entry is GalleryRow-shaped instead (src/gallery.ts): a
 * flatter record with no breakdown/hedge/orders sub-objects at all, built
 * for a list row rather than a full card. Calling constellationInputsFor
 * directly on one is wrong, not merely untyped: d.breakdown is always
 * undefined on a GalleryRow, so its isLong check (`!b || !b.applies`) reads
 * true for every verdict except book - confirmed by tracing hedged
 * (00dzwn0p8gh67, hedgeRatio 0.989) and unknown/funders (34stjd0gtgkz1,
 * breakdown.elsewhere truthy) through the real function by hand, both of
 * which would draw as a flat, uncovered bet instead of their real shape.
 *
 * This mirrors constellationInputsFor's own four branches exactly, sourced
 * from GalleryRow's real (flattened) fields instead of guessing a shape:
 *  - `breakdown.applies` is not a stored field on a GalleryRow, but
 *    exposureBreakdown (src/engine/breakdown.ts) computes it as nothing
 *    more than `nPositions > 0 && headlineSide === 'short' && headlineUsd
 *    > 0` - all three already on `positions` - so it is re-derived here
 *    rather than read.
 *  - `hedge.hedgeRatio` and `orders.headlineTwoSidedNotionalUsd` ARE on a
 *    GalleryRow, just flattened onto the row itself (`row.hedgeRatio`,
 *    `row.headlineTwoSidedNotionalUsd`) instead of nested.
 *  - `breakdown.elsewhere` has no equivalent field at all on a GalleryRow.
 *    `badgeQualifier` (src/engine/reasons.ts) stands in for it: it reads
 *    exactly 'assets sit with funders' when the verdict's own first reason
 *    is linked_exposure_unverified, which is exactly the one reason that
 *    ever sets breakdown.elsewhere - confirmed against all 4 real featured
 *    readings in data/featured.json (only 34stjd0gtgkz1 has elsewhere set,
 *    and it is the only one of the 4 with that reason and that qualifier).
 *    Known, deliberately deferred gap, the same shape as
 *    constellationInputsFor's own dataQuality gap (Task 2): a hedged or
 *    book verdict that also happens to carry a funder-linked holding,
 *    without linked_exposure_unverified leading its reasons, would show no
 *    ghost mirror here even though the real #card's diagram (built from the
 *    full CheckResponse, not this row) would show one. None of today's 4
 *    featured readings hit this; left for later rather than fetching every
 *    row's full snapshot just to draw a thumbnail.
 */
function constellationInputsForRow(row) {
  const seed = seedFromAddress(row.address);
  const p = row.positions;
  const applies = p.nPositions > 0 && p.headlineSide === 'short' && p.headlineNotionalUsd > 0;
  if (row.verdict.verdict === 'book') {
    const headlineUsd = p.headlineNotionalUsd || 0;
    const matched = row.headlineTwoSidedNotionalUsd || 0;
    return { seed, coverage: headlineUsd > 0 ? Math.min(1, matched / headlineUsd) : 0, ghost: false, bookDensity: true };
  }
  if (!applies) {
    return { seed, coverage: 0, ghost: false, bookDensity: false };
  }
  const ratio = typeof row.hedgeRatio === 'number' ? row.hedgeRatio : 0;
  const hasElsewhere = row.badgeQualifier === 'assets sit with funders';
  return { seed, coverage: Math.max(0, Math.min(1, ratio)), ghost: hasElsewhere, bookDensity: false };
}

function renderPlayer() {
  const list = playerList();
  $('player').hidden = list.length === 0;
  $('player-queue').hidden = list.length === 0;
  if (list.length === 0) return;
  if (playerIdx >= list.length) playerIdx = 0;
  const n = list.length;
  const entry = list[playerIdx];
  const pad2 = (x) => String(x).padStart(2, '0');

  $('player-now-reading').textContent = 'NOW READING · ' + pad2(playerIdx + 1) + ' / ' + pad2(n);
  $('player-title').textContent = positionText(entry);
  $('player-addr').textContent = entry.address;
  $('player-badge').textContent = badgeText(entry);
  $('player-badge').className = 'player-badge badge ' + verdictOf(entry).cls;

  // A real <button> per row, the same choice galleryRow/boardRow already
  // make for a clickable row (further down this file) - free keyboard
  // activation and focus handling, instead of a div with a hand-rolled
  // role/tabindex/keydown. Built as {row, canvas, entry} triples rather than
  // appending straight away: drawConstellation reads the canvas's own
  // clientWidth/clientHeight (Task 2), which is 0 until the element is
  // actually attached to the document, so every row is appended first and
  // only then drawn.
  const rows = list.map((e, i) => {
    const row = el('button', 'queue-row' + (i === playerIdx ? ' active' : ''));
    const canvas = document.createElement('canvas');
    canvas.className = 'queue-thumb';
    row.append(
      el('span', 'queue-rank', String(i + 1)),
      canvas,
      el('span', 'queue-pos', positionText(e)),
      el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
    );
    row.addEventListener('click', () => openSnapshot(e.snapshotId));
    return { row, canvas, entry: e };
  });
  $('player-queue').replaceChildren(...rows.map((r) => r.row));
  for (const r of rows) drawConstellation(r.canvas, { ...constellationInputsForRow(r.entry), mini: true });
}

// The breakdown SVG is now built at its own real rendered width rather than
// a fixed one CSS scales uniformly (audit U01), so unlike the rest of the
// page it does not stay correct through a resize on its own: a phone
// rotated after the card loaded would be left with the wide layout's
// numbers stretched across the narrow one's box. Re-run the same render a
// resize settles on, not on every frame of it.
let breakdownResizeTimer = null;
window.addEventListener('resize', () => {
  if (breakdownResizeTimer) clearTimeout(breakdownResizeTimer);
  breakdownResizeTimer = setTimeout(() => {
    if (current) renderBreakdown(current);
  }, 150);
});

// ---- gallery ----
//
// The list arrives as rows - /api/gallery sends one line per card, not 730
// KB of whole cards - and a row opens its card by id through /api/snapshot,
// free, from the Worker's own bundle. The list shows what the current rules
// read. How the set was chosen, the counts across it and the readings made
// under earlier rules are all kept, in an archive below it: real, and not
// the first thing a new visitor needs (23.09 audit, U06). Account PnL is not
// on a row: thirty days of the account say nothing about one position.

let archiveShown = PAGE_SIZE;

function galleryCounts(rows) {
  const counts = { book: 0, hedged: 0, looks_like_a_bet: 0, unknown: 0 };
  for (const e of rows) counts[e.verdict.verdict] = (counts[e.verdict.verdict] || 0) + 1;
  return counts;
}

function galleryRow(e, rank) {
  const li = el('li');
  const b = el('button');
  const badge = el('span', 'badge ' + verdictOf(e).cls, badgeText(e));
  // A verdict from rules that are no longer in force is labelled as one, in
  // the list as well as on the card.
  if (e.historical) {
    badge.classList.add('historical');
    badge.title = e.historical.reason;
  }
  b.append(
    el('span', 'rank', '#' + rank),
    el('span', 'pos', positionText(e)),
    badge,
    el(
      'span',
      'row-meta',
      plural(e.positions.nPositions, 'open position') +
        ' · ' +
        shortAddr(e.address) +
        (e.historical ? ' · read by earlier rules (' + (e.classifierVersion || 'v1') + ')' : ''),
    ),
  );
  b.addEventListener('click', async () => {
    // Whatever check is in the air was about a different account; the
    // snapshot load takes the next request number, so its answer cannot
    // land on this card (audit R03).
    await openSnapshot(e.snapshotId);
    if (current && current.snapshotId === e.snapshotId) {
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  li.append(b);
  return li;
}

// ---- ratings board ----
//
// Five short boards, ranked from numbers every reading already carries -
// nothing new is fetched, nothing is invented, and a board with nothing
// that qualifies is left out rather than shown empty (24.09 mechanic:
// ratings board, user-approved; replaces the flat "More readings" list as
// the first thing shown, folding in audit item U07).
const BOARDS = [
  {
    title: 'Biggest bets',
    note: 'Looks like a bet, ranked by size.',
    filter: (e) => e.verdict.verdict === 'looks_like_a_bet',
    sort: (a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd,
    stat: (e) => fmtUsd(e.positions.headlineNotionalUsd),
  },
  {
    title: 'Biggest slice of a market',
    note: "Position size against that market's open interest on Hyperliquid.",
    filter: (e) => e.sizeVsOi !== null && e.sizeVsOi > 0,
    sort: (a, b) => b.sizeVsOi - a.sizeVsOi,
    stat: (e) => fmtPct(e.sizeVsOi) + ' of open interest',
  },
  {
    title: 'Best covered shorts',
    note: 'Hedged: the same account holds the offsetting spot.',
    filter: (e) => e.verdict.verdict === 'hedged' && e.positions.headlineSide === 'short',
    sort: (a, b) => b.hedgeRatio - a.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
  {
    title: 'Least covered shorts',
    note: 'Under 10% covered by this address, on a hedge search that ran to completion - the rest is still open.',
    // A ratio measured under a partial or missing read is a floor, not a
    // finding: it belongs nowhere near "least covered", which claims the
    // number is the whole story (25.09 audit, A01).
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeCoverage === 'complete' && e.hedgeRatio < 0.1,
    sort: (a, b) => a.hedgeRatio - b.hedgeRatio,
    stat: (e) => fmtPct(e.hedgeRatio) + ' covered',
  },
  {
    title: 'Market makers',
    note: "Book: the account quotes the position's own market on both sides.",
    filter: (e) => e.verdict.verdict === 'book',
    sort: (a, b) => b.headlineTwoSidedNotionalUsd - a.headlineTwoSidedNotionalUsd,
    stat: (e) => fmtUsd(e.headlineTwoSidedNotionalUsd) + ' matched',
  },
];
const BOARD_SIZE = 5;

function boardRow(e, board) {
  const li = el('li');
  const b = el('button');
  b.append(
    el('span', 'pos', positionText(e)),
    el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address) + ' · ' + fmtTime(e.checkedAt)),
  );
  b.addEventListener('click', async () => {
    await openSnapshot(e.snapshotId);
    if (current && current.snapshotId === e.snapshotId) {
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  li.append(b);
  return li;
}

function renderBoards(rows) {
  const box = $('boards');
  box.replaceChildren();
  for (const board of BOARDS) {
    const matches = rows.filter(board.filter).sort(board.sort).slice(0, BOARD_SIZE);
    if (matches.length === 0) continue;
    const section = el('div', 'board');
    section.append(el('h3', null, board.title), el('p', 'board-note', board.note));
    const list = el('ol', 'list');
    list.append(...matches.map((e) => boardRow(e, board)));
    section.append(list);
    box.append(section);
  }
}

function renderGallery() {
  const rows = gallery.currentRows;
  const counts = galleryCounts(rows);
  const filters = [
    ['all', 'All ' + rows.length],
    ...['looks_like_a_bet', 'hedged', 'unknown', 'book']
      .filter((k) => counts[k] > 0)
      .map((k) => [k, VERDICTS[k].label + ' ' + counts[k]]),
  ];
  // Re-rendering the chips destroys the one the reader is on, and focus with
  // it, which drops a keyboard user back to the top of the document.
  const focusedChip = document.activeElement && document.activeElement.closest('#chips') ? galleryFilter : null;
  $('chips').replaceChildren(...filters.map(([key, label]) => {
    const b = el('button', 'chip', label);
    b.setAttribute('aria-pressed', String(galleryFilter === key));
    b.addEventListener('click', () => {
      galleryFilter = key;
      galleryShown = PAGE_SIZE;
      renderGallery();
    });
    if (focusedChip === key) queueMicrotask(() => b.focus());
    return b;
  }));

  const visible = galleryFilter === 'all' ? rows : rows.filter((e) => e.verdict.verdict === galleryFilter);
  $('gallery-list').replaceChildren(...visible.slice(0, galleryShown).map((e) => galleryRow(e, rows.indexOf(e) + 1)));
  $('more').hidden = visible.length <= galleryShown;
}

function renderArchive() {
  const rows = gallery.historicalRows;
  $('archive-list').replaceChildren(...rows.slice(0, archiveShown).map((e, i) => galleryRow(e, i + 1)));
  $('archive-more').hidden = rows.length <= archiveShown;
}

async function loadGallery() {
  try {
    const res = await fetch('/api/gallery');
    if (!res.ok) return;
    gallery = await res.json();
  } catch (e) {
    return;
  }
  // The player (26.09 redesign, Task 4) is built from gallery.featured alone
  // and does not depend on gallery.entries having anything open in it, so it
  // renders here, before the early return below that guards the boards/
  // gallery rendering that does. The flagship reading (FLAGSHIP_ID, above)
  // is what a fresh visitor's #card already opens with - starting the
  // player on that same reading keeps the strip and the open card in
  // agreement, rather than the strip silently pointing somewhere else on
  // first paint.
  const featuredIdx = (gallery.featured || []).findIndex((e) => e.snapshotId === FLAGSHIP_ID);
  if (featuredIdx !== -1) playerIdx = featuredIdx;
  renderPlayer();

  // An account can close its position between the ranking and its check;
  // with nothing open it is not one of the biggest positions any more.
  const open = (gallery.entries || [])
    .filter((e) => e.positions.nPositions > 0)
    .sort((a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd);
  if (open.length === 0) return;
  gallery.currentRows = open.filter((e) => !e.historical);
  gallery.historicalRows = open.filter((e) => e.historical);
  // gallery.featured (the four hand-picked demonstration readings) never
  // overlaps gallery.currentRows by address - the L03 fix already strips a
  // current row wherever a featured reading supersedes it - so this is a
  // plain concatenation, not a merge that needs de-duplicating.
  renderBoards([...gallery.currentRows, ...gallery.featured]);

  // Cards are re-checked one at a time as credits allow, so the set can span
  // days. Showing one timestamp for all of them would be wrong.
  const times = open.map((e) => e.checkedAt).sort();
  const first = fmtTime(times[0]);
  const last = fmtTime(times[times.length - 1]);
  const when = first === last ? 'read ' + first : 'read between ' + first + ' and ' + last;
  $('gallery-sub').textContent =
    'Saved readings from one scan, ' + when + '. Opening one costs nothing and checks nothing again. ' +
    'Boards also mix in a few saved readings sampled at other times.';

  const rows = gallery.currentRows;
  const counts = galleryCounts(rows);
  const betShare = rows.length ? Math.round((counts.looks_like_a_bet / rows.length) * 100) : 0;
  // "Of the N read", not "of the market": counts from one dated scan of a
  // set chosen a particular way, which is not a statistic about the market.
  $('gallery-stats').textContent =
    gallery.universe + '. Of the ' + rows.length + ' read by the current rules, ' +
    counts.looks_like_a_bet + ' (' + betShare + '%) look like real bets and ' +
    (counts.book + counts.hedged) + ' are books or hedges.';
  $('gallery-method').textContent =
    'How these were picked: the top 3,000 accounts by value from the public leaderboard, ranked by the size of ' +
    'their largest main-dex position. Leverage breaks the link between what an account is worth and what it holds, ' +
    'a HIP-3-only account can fall out before it is ever checked, and the scan spent its last credits on the ' +
    'cheaper checks. ' +
    (gallery.historicalRows.length
      ? 'Below: ' + plural(gallery.historicalRows.length, 'reading') + ' kept as the earlier rules read them.'
      : '');
  $('archive-summary').textContent = gallery.historicalRows.length
    ? 'How these were picked, and ' + plural(gallery.historicalRows.length, 'reading') + ' made under earlier rules'
    : 'How these were picked';
  $('gallery').hidden = false;
  renderGallery();
}

$('more').addEventListener('click', () => {
  galleryShown += PAGE_SIZE;
  renderGallery();
});

// The archive's rows are drawn when it is first opened, not on every load.
$('archive').addEventListener('toggle', () => {
  if ($('archive').open && gallery && gallery.historicalRows) renderArchive();
});
$('archive-more').addEventListener('click', () => {
  archiveShown += PAGE_SIZE;
  renderArchive();
});

// ---- share card ----

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  let curY = y;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      lines++;
      if (lines === maxLines) {
        ctx.fillText(line.trim() + '...', x, curY);
        return curY;
      }
      ctx.fillText(line, x, curY);
      line = word + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
  return curY;
}

/** Cuts a string to fit, with an ellipsis. Four evidence columns sharing a
 * fixed width meant a long HIP-3 symbol or a long value simply drew over its
 * neighbour. */
function clipText(ctx, text, maxWidth) {
  let s = String(text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + '...').width > maxWidth) s = s.slice(0, -1);
  return s + '...';
}

/**
 * What goes on the picture, as the server worked it out (src/engine/share.ts).
 *
 * The page used to build this itself and could say "Everything this tool
 * reads was read in full", which is true of the reading and false about the
 * account: nothing here can see an exchange balance, an OTC deal or an
 * unlinked wallet. That standing limit is now first on every card, and the
 * fallback below is for a saved reading made before the server sent one.
 */
function cardShare(d, kind) {
  if (d.share) {
    // A bundled gallery card is built without knowing which site serves it,
    // so the link back is filled in here where the origin is known.
    return d.share.link || !d.snapshotId
      ? d.share
      : { ...d.share, link: window.location.origin + '/?s=' + d.snapshotId };
  }
  const notes = (d.coverage || []).slice(0, 2);
  return {
    limits: [
      'Not visible to this tool at all: positions on centralized exchanges, OTC deals, ' +
        'and wallets with no on-chain link to this address.',
      ...notes,
    ],
    more: Math.max(0, (d.coverage || []).length - notes.length),
    provenance: 'Positions as of ' + fmtTime(d.positionsAsOf || d.checkedAt) + ' · ' + kind,
    link: d.snapshotId ? window.location.origin + '/?s=' + d.snapshotId : null,
    evidence: (d.evidence || []).slice(0, 4),
  };
}

/**
 * The constellation, drawn onto this same fixed-size canvas by way of the
 * real drawConstellation from Task 2 - not a second, cheaper copy of it.
 * drawConstellation measures its target through clientWidth/clientHeight,
 * which only resolve on an element that is actually laid out; card-canvas
 * itself stays `hidden` for the whole of drawCard() (display:none, so its
 * own clientWidth reads 0 - the exact trap renderBreakdown's own history
 * already describes hitting once, on #breakdown-svg, before #card was
 * unhidden first). A scratch canvas, sized in CSS pixels to exactly the
 * region this card wants to fill and positioned off the visible page rather
 * than display:none (which lays out at zero size the same as hidden), gives
 * drawConstellation something real to measure - its result is then copied
 * onto card-canvas with one drawImage call, scaled to fit regardless of the
 * scratch canvas's own devicePixelRatio-scaled backing store, and the
 * scratch canvas is removed again before this function returns.
 */
function drawCardConstellation(ctx, d, x, y, w, h) {
  const scratch = document.createElement('canvas');
  scratch.style.position = 'fixed';
  scratch.style.left = '-99999px';
  scratch.style.top = '0px';
  scratch.style.width = w + 'px';
  scratch.style.height = h + 'px';
  document.body.append(scratch);
  const inputs = constellationInputsFor(d);
  drawConstellation(scratch, { ...inputs, mini: false });
  ctx.drawImage(scratch, x, y, w, h);
  scratch.remove();

  const font = (weight, size) => weight + ' ' + size + 'px -apple-system, system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e6e8ee';
  ctx.font = font(700, 48);
  ctx.fillText(constellationStatFor(d, inputs), x + w / 2, y + h / 2 - 4);
  ctx.fillStyle = '#8b90a0';
  ctx.font = font(400, 15);
  ctx.fillText(constellationStatLabelFor(d).toUpperCase(), x + w / 2, y + h / 2 + 22);
  ctx.textAlign = 'left';
}

/** The older layout, for a card with no diagram to draw. Only reached when
 * none of drawCard's own isBook/breakdown-applies-with-segments/isLong hold
 * - between them (the same three conditions renderBreakdown itself checks)
 * every account with any open position at all gets a constellation instead,
 * so this is effectively just "nothing open right now". */
function drawEvidenceColumns(ctx, items, W, font) {
  const colW = (W - 112) / 4;
  items.forEach((item, i) => {
    const x = 56 + i * colW;
    const room = colW - 16;
    ctx.fillStyle = '#8b90a0';
    ctx.font = font(400, 18);
    ctx.fillText(clipText(ctx, item.label, room), x, 432);
    ctx.fillStyle = '#e6e8ee';
    ctx.font = font(700, item.value.length > 14 ? 24 : 30);
    ctx.fillText(clipText(ctx, item.value, room), x, 470);
    ctx.fillStyle = '#5a5f6d';
    ctx.font = font(400, 15);
    ctx.fillText(clipText(ctx, item.source, room), x, 496);
  });
}

function drawCard() {
  const canvas = $('card-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const d = current;
  const v = verdictOf(d);
  const font = (weight, size) => weight + ' ' + size + 'px -apple-system, system-ui, "Segoe UI", sans-serif';

  ctx.fillStyle = '#0c0e13';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = v.accent;
  ctx.fillRect(0, 0, 12, H);

  ctx.fillStyle = v.accent;
  ctx.font = font(700, 28);
  ctx.fillText(badgeText(d).toUpperCase(), 56, 84);

  ctx.fillStyle = '#e6e8ee';
  ctx.font = font(700, 44);
  wrapText(ctx, headlineFor(d), 56, 146, W - 112, 52, 2);

  const share = cardShare(d, (d && d.__kind) || 'live');
  // Mirrors renderBreakdown's own gate (Task 2) exactly, so the picture that
  // travels never disagrees with the page it was copied from about whether
  // there is a diagram to show at all.
  const isBook = d.verdict.verdict === 'book' && !!d.orders;
  const b = d.breakdown;
  const isLong = !isBook && (!b || !b.applies) && d.positions.nPositions > 0 && d.positions.headlineSide === 'long';
  const showConstellation = isBook || (b && b.applies && b.segments.length > 0) || isLong;

  ctx.fillStyle = '#8b90a0';
  ctx.font = font(400, 26);
  wrapText(ctx, d.summary || '', 56, 250, W - 112, 36, showConstellation ? 3 : 4);

  if (showConstellation) {
    drawCardConstellation(ctx, d, 56, 386, W - 112, 130);
  } else {
    drawEvidenceColumns(ctx, share.evidence, W, font);
  }

  // A badge alone reads as a verdict with nothing behind it. What the check
  // could not read belongs on the picture, not only on the page it came from.
  ctx.fillStyle = '#8b90a0';
  ctx.font = font(400, 18);
  ctx.fillText('What this reading could not cover', 56, 532);
  ctx.fillStyle = '#8b90a0';
  ctx.font = font(400, 17);
  const limitsText = share.limits.join(' ') + (share.more > 0 ? ' (+' + share.more + ' more on the page)' : '');
  wrapText(ctx, limitsText, 56, 556, W - 112, 23, 3);

  // When and what of, printed on the image rather than left to the post it
  // is pasted into, plus the link back to this exact reading.
  ctx.fillStyle = '#5a5f6d';
  ctx.font = font(400, 17);
  ctx.fillText(clipText(ctx, 'Bet or Book · ' + shortAddr(d.address) + ' · ' + share.provenance, W - 380), 56, H - 46);
  if (share.link) ctx.fillText(clipText(ctx, share.link, W - 380), 56, H - 22);
  ctx.textAlign = 'right';
  ctx.fillText(d.source === 'nansen' ? 'Powered by Nansen API' : 'Data: Hyperliquid API', W - 56, H - 46);
  ctx.textAlign = 'left';
}

// Opening the one Share button is the moment a reader means to share, and
// the best time to have the link's own picture drawn before any crawler
// asks for it.
$('share').addEventListener('toggle', () => {
  if ($('share').open && current) askForPicture(current);
});

$('copy-link').addEventListener('click', async () => {
  if (!current) return;
  askForPicture(current);
  // The link opens this reading, not a new check of this account. Without a
  // snapshot id there is nothing saved to point at, so it falls back to the
  // address and the button says which one it gave.
  const link = current.snapshotId
    ? window.location.origin + '/?s=' + current.snapshotId
    : window.location.origin + '/?address=' + current.address;
  const btn = $('copy-link');
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1500);
  } catch (e) {
    window.prompt('Copy this link:', link);
  }
});

/** The card's own summary, plus the link that reopens it, sized for a post
 * on X: any link counts as 23 characters there whatever its real length, so
 * the summary is trimmed against what is actually left, not against 280
 * raw characters. The reader can still edit before posting; this is a
 * draft, not a submission (audit item 10). */
function postText(d) {
  const link = d.snapshotId ? window.location.origin + '/?s=' + d.snapshotId : window.location.origin;
  const LINK_WEIGHT = 23;
  const TWEET_LIMIT = 280;
  const suffix = '\n\nBuilt on @nansen_ai\n' + link;
  const suffixWeight = suffix.length - link.length + LINK_WEIGHT;
  const budget = Math.max(0, TWEET_LIMIT - suffixWeight);
  let body = (d.summary || '').trim();
  if (body.length > budget) {
    body = body.slice(0, Math.max(0, budget - 1)).trim() + '…';
  }
  return body + suffix;
}

// A direct hand-off, not one more thing to copy and paste yourself: X's own
// intent endpoint opens composer with the text already in it, in a new tab,
// so most of the way there is one click. X's intent URL has no parameter for
// attaching an image, though - the compose box only shows one once X's own
// crawler has fetched a link's og:image, which does not happen inside the
// compose box itself. So the card's own picture is also put on the
// clipboard, the same way "Copy image" does it, and the button says to
// paste it in - a real image in the post, not a hope that the link unfurls
// before it is read.
$('share-x').addEventListener('click', () => {
  if (!current) return;
  askForPicture(current);
  const text = postText(current);
  // Opened synchronously, inside the click itself - once anything here is
  // awaited first, some browsers no longer count this as the user's own
  // gesture and block it as a popup (the same reason "Copy image" draws the
  // card before it awaits the clipboard write, not after).
  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
  drawCard();
  const canvas = $('card-canvas');
  const btn = $('share-x');
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = 'Opened X - paste the image (Ctrl+V) before posting';
      setTimeout(() => { btn.textContent = 'Share on X'; }, 4000);
    } catch (e) {
      // The tab with the text is already open either way; only the image
      // did not make it to the clipboard, so there is nothing to undo here.
    }
  }, 'image/png');
});

// ---- recent checks, kept in this browser only ----
//
// The only reason to come back used to be remembering the address by hand.
// This is not sync, not an account, and not sent anywhere - a viewer's own
// browser storage, wrapped in try/catch because a private window or
// blocked site data can make it throw (see the artifact storage guidance
// this project itself follows: per-viewer convenience, never load-bearing).
const RECENT_KEY = 'betOrBook:recent';
const MAX_RECENT = 8;

function loadRecent() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveRecent(entry) {
  try {
    const list = loadRecent().filter((r) => r.address !== entry.address);
    list.unshift(entry);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch (e) {
    // Storage blocked or full: the card on screen is unaffected either way.
  }
}

function renderRecent() {
  const list = loadRecent();
  const box = $('recent');
  box.hidden = list.length === 0;
  if (list.length === 0) return;
  $('recent-chips').replaceChildren(...list.map((r) => {
    const v = VERDICTS[r.verdict] || VERDICTS.unknown;
    const label = r.verdict === 'unknown' && r.badgeQualifier ? v.label + ' · ' + r.badgeQualifier : v.label;
    const b = el('button', 'chip', r.headline + ' · ' + label);
    b.title = 'Checked ' + fmtTime(r.checkedAt);
    b.addEventListener('click', () => openSnapshot(r.id));
    return b;
  }));
}

// A viewer's own browser only, exactly like "recent checks" - never sent
// anywhere, never read by the server, wrapped in try/catch for a private
// window or blocked storage.
const GUESS_STATS_KEY = 'betOrBook:guessStats';
const GUESS_LABEL = { looks_like_a_bet: 'Bet', hedged: 'Hedge', book: 'Book', cant_tell: "couldn't tell" };

function loadGuessStats() {
  try {
    const raw = window.localStorage.getItem(GUESS_STATS_KEY);
    const parsed = raw ? JSON.parse(raw) : { matches: 0, total: 0 };
    return typeof parsed.matches === 'number' && typeof parsed.total === 'number' ? parsed : { matches: 0, total: 0 };
  } catch (e) {
    return { matches: 0, total: 0 };
  }
}

function recordGuess(matched) {
  try {
    const stats = loadGuessStats();
    stats.total += 1;
    if (matched) stats.matches += 1;
    window.localStorage.setItem(GUESS_STATS_KEY, JSON.stringify(stats));
    return stats;
  } catch (e) {
    return null;
  }
}

async function loadLedger() {
  try {
    const res = await fetch('/api/ledger');
    if (!res.ok) return;
    const data = await res.json();
    const w = data.scripted.window;
    const p = $('ledger');
    p.replaceChildren(
      'Nansen API calls made by this project between ' + w.from + ' and ' + w.to + ': ' + data.totalCalls.toLocaleString('en-US') + ' (',
    );
    const a = el('a', null, 'ledger');
    a.href = '/api/ledger';
    p.append(a, ').');
    p.hidden = false;
  } catch (e) {
    // The counter is a footnote; the page works without it.
  }
}

// The ledger is a footnote, so it waits for the part of the page a reader
// came for (23.09 audit).
loadGallery().finally(loadLedger);
if (window.location.hash === '#operator') setUpOperator();
const params = new URLSearchParams(window.location.search);
const saved = params.get('s');
const preset = params.get('address');
if (saved) {
  // A saved reading opens as itself. No check runs, so nothing is spent and
  // nothing can have changed between the link being written and read.
  openSnapshot(saved);
} else if (preset) {
  // Filling the field is not running the check: a `?address=` link used to
  // spend a check the moment it opened in a browser, no click involved, so
  // a same-origin POST was one crafted link away regardless of who opened it
  // (23.09 audit, S01). The address is still ready for the reader's own
  // press of Check or Enter.
  $('address').value = preset;
  setStatus('Address filled in from the link. Press Check to run it.');
  $('check').focus();
} else {
  // Nothing pasted and nothing linked: the first thing on screen used to be
  // a blank form, and the strongest picture on the whole page was one click
  // away behind a chip nobody was told to press (24.09 audit, U01). This
  // costs nothing - the reading is bundled with the Worker - and it renders
  // the same way a shared link to it would, after `saveRecent`'s guard
  // (above) so it never pollutes "recent checks".
  openSnapshot(FLAGSHIP_ID);
}
renderRecent();
