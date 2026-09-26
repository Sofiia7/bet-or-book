# Player Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a new dark, constellation-canvas visual design (handed off as `Bet or Book Player.dc.html` / `screenshots/*.png`, both already deleted from the repo root after being read into this plan) to the live site (`web/index.html`, `web/app.js`) and to the share/OG images (`src/engine/ogCard.ts`, `src/engine/ogRender.ts`, the canvas share card in `web/app.js`), while keeping every piece of existing logic and functionality (verdict computation, evidence, coverage, hedge ratios, gallery, ranked boards, recent checks, sharing) exactly as it is today. This is a visual re-skin plus one new canvas rendering engine, not a rewrite of what the site knows or says.

**Architecture:** The handoff's `draw()`/`buildModel()` canvas functions are already plain Canvas2D JS and port over almost verbatim; only their INPUTS change, from the mock's hardcoded per-reading constants to real computed values already present on every `CheckResponse` (`d.breakdown`, `d.hedge.hedgeRatio`, `d.orders`, `d.positions`). The mock's reactive-template markup (`{{ }}`, `sc-for`, `ref=`) does not port - it is rebuilt as plain DOM manipulation in `web/app.js`, following this file's own existing `el()`/`$()`/`replaceChildren()` idioms.

**Tech Stack:** No new dependencies. Canvas2D (already used for the existing share-card renderer in `web/app.js`). Google Fonts for Inter + JetBrains Mono (CDN link, no bundled `.woff` files - the handoff's `assets/inter-*.woff` are not carried into this repo; Google Fonts serves Inter too, so one font-loading mechanism covers both typefaces instead of two).

**Key decisions already made (do not re-litigate these in any task below):**
1. **The site becomes dark-only.** The current `:root` light palette plus its `@media (prefers-color-scheme: dark)` override block are replaced by ONE dark palette, matching the handoff's tokens exactly. There is no light mode any more.
2. **The "Player" transport (NOW READING / prev / next / segment bar / queue) applies only to the four featured example readings** - it replaces today's `.examples` chip bar. A live check of an arbitrary address reuses the same restyled result card and the same canvas diagram, but never shows "01 / 04" chrome, since an arbitrary address is not one of the four - it doesn't have a position in that sequence.
3. **Every other existing section stays** (the guess-before-it-loads game, recent checks, the ranked boards, the full gallery/archive, share, coverage, changed-since, decided-rule, everything-else-found) - restyled with the new tokens, not removed, even though the handoff mock only shows a "Ranked boards →" link. That link becomes a same-page jump link to the existing boards section (this project has no router or second page).
4. **CORRECTED after Task 3 (user, live, in chat): the OG/share image MUST show the actual constellation, not a re-themed bar.** The literal reason this whole redesign exists is so a shared link stands out - a generic re-colored bar defeats that. Task 6 below is rewritten accordingly: the in-browser "Copy image"/"Download image" canvas card (`drawCard` in `web/app.js`) calls `drawConstellation` directly (same browser runtime, same Canvas2D API Task 2 already built - no new engineering there). The server-rendered OG picture (`ogCard.ts`/`ogRender.ts`, satori+resvg, running in a Workers isolate with no Canvas2D) needs `buildConstellationModel`'s math ported to a pure-JS SVG string generator and embedded into the satori tree as an image - see Task 6's own spike step, which verifies this actually renders before the rest of that task is built on top of it.
5. **Every em dash (U+2014) and en dash used as a dash (U+2013) in the handoff's copy is replaced with a plain hyphen `-` with spaces around it**, per this project's absolute no-em-dash rule. The handoff copy has several (in the intro line, the hedged/funders/book summaries, the bet rule text). Do not carry any of them over verbatim.
6. **Verdict colors** (replacing today's theme-aware `--book-fg`/`--hedged-fg`/`--bet-fg`/`--unknown-fg` tokens with fixed values, since there is only one theme now): bet `#f2b35c`, hedged `#4fe0b0`, unknown (`funders` in the handoff's naming) `#a3a8b6`, book `#7fa2ff`.

---

## Task 1: New color tokens, fonts, and base typography [DONE - commit e069336, self-verified directly against the diff, no review round dispatched (low-risk mechanical CSS token swap). FOLLOW-UP FIX landed later as commit 55a3737: the page's CSP never allowed fonts.googleapis.com/fonts.gstatic.com, so the new fonts were silently blocked in every browser the whole time - found by the coordinator reading the live console during Task 4's verification, fixed directly (widened style-src + added font-src), confirmed via response header, a fresh tab's console, and a screenshot showing real Inter/JetBrains Mono rendering.]

**Files:**
- Modify: `web/index.html` (the `<style>` block's `:root` and base element rules, roughly lines 20-50 - read the current file first, this plan was written against the state as of commit `65a555d` and may have shifted if later tasks in this plan already landed)

- [ ] **Step 1: Read the current `<style>` block in full**

Read `web/index.html` from the `<style>` tag to its closing `</style>` before changing anything - note every CSS custom property currently defined and every selector that references `--book-bg`/`--book-fg`/`--hedged-bg`/`--hedged-fg`/`--bet-bg`/`--bet-fg`/`--unknown-bg`/`--unknown-fg`/`--note-bg`/`--note-fg` (grep the whole file for each name), since Step 3 needs to update every one of them, not just the `:root` declaration.

- [ ] **Step 2: Add font loading**

In the `<head>`, before the `<style>` block, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Replace the `:root` block and remove the dark-mode media query**

Replace the current `:root { ... }` block and the `@media (prefers-color-scheme: dark) { :root { ... } }` block entirely with:

```css
:root {
  --bg: #08090c; --fg: #e6e8ee; --muted: #8b90a0; --faint: #5a5f6d; --line: rgba(255,255,255,.08); --panel: #0c0e13; --hover: rgba(255,255,255,.05);
  --book-bg: rgba(127,162,255,.12); --book-fg: #7fa2ff;
  --hedged-bg: rgba(79,224,176,.12); --hedged-fg: #4fe0b0;
  --bet-bg: rgba(242,179,92,.12); --bet-fg: #f2b35c;
  --unknown-bg: rgba(163,168,182,.12); --unknown-fg: #a3a8b6;
  --note-bg: rgba(242,179,92,.12); --note-fg: #f2b35c;
  --link: #9fb8ff; --error: #ff6b6b;
  --surface-2: #0e1015; --surface-3: #0a0b10;
}
[hidden] { display: none !important; }
* { box-sizing: border-box; }
body {
  font-family: "Inter", -apple-system, system-ui, "Segoe UI", sans-serif;
  background: var(--bg);
  background-image: radial-gradient(1200px 600px at 50% -200px, #11131b 0%, var(--bg) 60%);
  background-attachment: fixed;
  color: var(--fg); max-width: 720px; margin: 40px auto; padding: 0 16px; line-height: 1.5;
}
```

(`--bg`/`--fg`/`--muted`/`--faint`/`--line`/`--panel`/`--hover`/`--link`/`--error` are reused names, kept so every OTHER selector in the file that already references them picks up the new values automatically. `--surface-2`/`--surface-3` are new, for the two darker surfaces the handoff uses beside the panel background - `#0e1015` for the input field, `#0a0b10` for the player's transport-bar strip.)

Do not remove `color-scheme: light dark;` by leaving it in accidentally if it was on the old `:root` - actually remove it; the site no longer adapts to system theme, so this line should not appear on the new `:root` at all.

- [ ] **Step 4: Add monospace-label utility and update existing mono rule**

Find the existing `.mono { font-family: ui-monospace, ... }` rule (used for addresses and similar). Change its font stack to lead with JetBrains Mono:

```css
.mono { font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace; }
```

Also update the `input` rule's font (find `input { ... font-family: ui-monospace, Consolas, monospace; ... }`) the same way, and the `.fold code` rule.

- [ ] **Step 5: Verify nothing else hardcodes the old light-mode colors**

Grep `web/index.html` and `web/app.js` for `#ffffff`, `#141414`, `#5f5f5f`, `#8f8f8f`, `#d9d9d6`, `#f5f5f2`, `#ededea` (the old root light-mode literal values) - if any selector hardcodes one of these instead of using a `var(--...)` token, flag it in your report rather than guessing whether to change it (some hardcoded whites may be intentional, e.g. inside the canvas share-card renderer which draws on a fixed white background for a different, print-style output - do not touch `web/app.js`'s `drawCard`/canvas-share-card function in this task, that is Task 6's job).

- [ ] **Step 6: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green - this task only touches CSS custom properties and a couple of font-family declarations, nothing JS-visible to any test.

- [ ] **Step 7: Commit**

```bash
git add web/index.html
git commit -m "feat: the site takes on the new dark palette and typography"
```

---

## Task 2: The constellation canvas engine, wired to real data [DONE - commit 077f008, one fix round (710ba3b) after self-review correctly caught a semantic bug in this plan's own instructions: a long's coverage must be flat 0, not headlineShare (concentration and coverage are different axes; concentration still lives in the untouched #decisive tiles). Known, documented, deliberately deferred gap: no visual signal yet for degraded dataQuality/incomplete hedge reads (the old drawScale's "suspended" treatment) - none of the 4 shipped examples hit this path today, but a live check of an arbitrary address could. Verified via test/typecheck + hand-trace against real data, not a browser (that's Task 7).]

**Files:**
- Modify: `web/app.js` (adds a new rendering function; removes `drawScale`, `drawBookQuoting`, `drawConcentration`, and their shared geometry helpers `scaleGeometry`/`drawBeamAndPivot`/`drawPan`/`MAX_TILT_DEG`/`HEDGE_BAND_MIN`/`HEDGE_BAND_MAX` once nothing references them any more; updates `renderBreakdown`'s call site)

**Context:** The handoff's `buildModel(seed, N)` and `draw(canvas, reading, options)` functions (reproduced below, lightly adapted) generate a deterministic "constellation" - two peaks of glowing dots joined by lines, growing from the left and right edges of a canvas, meeting in the middle where a big stat number sits. The LEFT side is always full height (the headline position, always 100% by definition). The RIGHT side's height is scaled by a single `right` value in `[0, 1]` - this is the one real number that must come from this project's own computed data, not from a hardcoded mock. A `ghost` flag draws a second, dashed/hollow mirror on the right for the "funds sit with someone else, not counted" case.

- [ ] **Step 1: Read the current code**

Read `web/app.js`'s current `drawScale`, `drawBookQuoting`, `drawConcentration`, `scaleGeometry`, `drawBeamAndPivot`, `drawPan`, and `renderBreakdown` in full (several other tasks earlier in this project's history touched these, so read the real file, not this plan's memory of it). Also read `svgAccentOf`, `SVG_ACCENT_VAR`, and `VERDICTS` (near the top of the file) - Task 1 already changed the CSS custom properties these read from `--book-fg` etc. to the new fixed hex values, so `svgAccentOf(d)` still works unchanged (it returns `var(--book-fg)` etc., which now resolves to the new colors) and needs no edit in this task.

- [ ] **Step 2: Add the seeded RNG and model builder**

Add near the top of `web/app.js`, close to the other small pure-math helpers (`fmtUsd`, `fmtPct`, `plural`):

```js
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
```

(This drops the handoff's unused `phase`/twinkle-over-time machinery - the handoff's own `paint()` always calls `draw()` with `t=0` and never animates in practice, "no playback and no animation" per its own README, so nothing here needs a per-frame time input.)

- [ ] **Step 3: Add the dot-sprite cache and draw function**

Add directly after `buildConstellationModel`:

```js
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
```

- [ ] **Step 4: Add the real-data adapter**

This is the one function that must translate this project's own verdict-specific data into `(seed, coverage, ghost, bookDensity)`. Add it directly after `drawConstellation`:

```js
/**
 * What `drawConstellation` needs, derived from a real reading rather than
 * the design handoff's four hardcoded mock numbers. `coverage` mirrors what
 * each verdict's own rule already measures - it is not a new number, only a
 * new way to draw one that already exists on every reading.
 */
function constellationInputsFor(d) {
  const seed = seedFromAddress(d.address);
  const b = d.breakdown;
  const isBook = b && b.applies === false && d.verdict.verdict === 'book';
  const isLong = !b || !b.applies;
  if (d.verdict.verdict === 'book') {
    const headlineUsd = d.positions.headlineNotionalUsd || 0;
    const matched = (d.orders && d.orders.headlineTwoSidedNotionalUsd) || 0;
    return { seed, coverage: headlineUsd > 0 ? Math.min(1, matched / headlineUsd) : 0, ghost: false, bookDensity: true };
  }
  if (isLong) {
    return { seed, coverage: Math.min(1, d.positions.headlineShare || 0), ghost: false, bookDensity: false };
  }
  const ratio = d.hedge && typeof d.hedge.hedgeRatio === 'number' ? d.hedge.hedgeRatio : 0;
  const hasElsewhere = !!(b && b.elsewhere);
  return { seed, coverage: Math.max(0, Math.min(1, ratio)), ghost: hasElsewhere, bookDensity: false };
}
```

Trace this against every verdict type before moving on (do this by hand, do not skip it - this is the one function in this task that decides what the picture actually shows):
- **Book**: `coverage` = matched-both-sides notional over the headline notional (the same fraction the old `drawBookQuoting` bar filled) - clamped to `[0,1]` since matched can, in principle, meet or exceed the headline.
- **Long / bet** (`isLong`, i.e. `!b || !b.applies`, the same condition `renderBreakdown` already uses elsewhere in this file): `coverage` = `headlineShare` (the same value `drawConcentration` used) - NOT `0` flat, since the handoff's own mock hardcodes `right:0` for its one bet example, but this project's actual bet case is about concentration, not coverage, and flattening every long to `0` would draw an identical empty right peak for every bet regardless of how concentrated it actually is. If you disagree with this reasoning after reading `drawConcentration`'s own history in this file, say so in your report rather than silently picking one - this is the one deliberate deviation from the handoff's literal mock in this task.
- **Hedged / Unknown (funders) / anything else with a real hedge ratio**: `coverage` = `hedge.hedgeRatio`, clamped - matches the handoff's own `right: 0.97` (hedged) and `right: 0.01` (funders, "<1%") examples exactly, since both of those ARE real hedge ratios in this project's own data. `ghost` is true exactly when `breakdown.elsewhere` exists (the funders case) - matches the handoff's `ghost:1` on the funders reading and `ghost:0` everywhere else.

- [ ] **Step 5: Replace the call site in `renderBreakdown`**

Find where `renderBreakdown` currently dispatches to `drawScale`/`drawBookQuoting`/`drawConcentration` (search for `drawScale(`, `drawBookQuoting(`, `drawConcentration(`). Read the full surrounding function first - it currently sets `--accent` on the container, builds an `svg` element, and appends it via `$('breakdown-svg').replaceChildren(svg)`. Replace that whole dispatch with a `<canvas>` element and a call to `drawConstellation`:

```js
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '260px';
  canvas.style.display = 'block';
  $('breakdown-svg').replaceChildren(canvas);
  const inputs = constellationInputsFor(d);
  drawConstellation(canvas, { ...inputs, mini: false });
  if (!canvas.dataset.roAttached) {
    canvas.dataset.roAttached = '1';
    new ResizeObserver(() => drawConstellation(canvas, { ...constellationInputsFor(d), mini: false })).observe(canvas);
  }
```

(Keep whatever existing logic sets `$('breakdown').hidden` and the caption text - that is unrelated to which diagram function draws the picture, do not remove it. `$('breakdown-svg')` keeps its existing id even though it now holds a canvas, not an svg - renaming ids is a bigger, riskier change than this task needs and nothing outside this function reads into that element's children.)

The big centered stat number and label (the handoff's "97% / COVERED" overlay) is a separate, absolutely-positioned element on TOP of the canvas, not something `drawConstellation` draws itself (the handoff's own markup confirms this - the stat is a plain `<div>` positioned over the canvas, not part of the canvas drawing). Add it as a sibling in the same container:

```js
  const statBox = el('div', 'constellation-stat');
  statBox.append(
    el('div', 'constellation-stat-value', constellationStatFor(d, inputs)),
    el('div', 'constellation-stat-label', constellationStatLabelFor(d)),
  );
```

Write `constellationStatFor(d, inputs)` (returns the big number, e.g. `fmtPct(inputs.coverage)` for hedged/unknown, `fmtPct(inputs.coverage)` for long/concentration too, or for book something like `fmtPct(inputs.coverage)` as well - re-derive the exact label text each verdict's OLD diagram used to caption itself, e.g. `drawBookQuoting`'s old caption said "matched both sides"/`drawConcentration`'s said "of the gross exposure is this one position" - decide short stat-label text for each, consistent with the handoff's own four examples: "covered" for hedged, "covered by this address" for unknown/funders, "covered" for a long (or pick wording that fits concentration specifically, e.g. "of exposure" - your call, keep it under ~20 characters since it sits under a 44px number) and "quoted both sides" for book) and `constellationStatLabelFor(d)` similarly. Add the container/stat CSS (`.constellation-stat` absolutely centered, per the handoff's own layout spec in Step 3 of Task 3 below - this task only needs the DOM structure to exist, Task 3 styles it).

- [ ] **Step 6: Remove the now-dead SVG diagram code**

Once Step 5 lands, `drawScale`, `drawBookQuoting`, `drawConcentration`, `scaleGeometry`, `drawBeamAndPivot`, `drawPan`, `MAX_TILT_DEG`, `HEDGE_BAND_MIN`, `HEDGE_BAND_MAX`, `wrapSvgText`, and `svgEl` may all become unused - grep for each name across `web/app.js` after your edit and delete anything with zero remaining references. Do NOT delete `svgAccentOf`/`SVG_ACCENT_VAR`/`VERDICTS` - those are still read elsewhere (the badge, the canvas share-card in Task 6). If `svgEl`/`wrapSvgText` are still referenced by something you haven't touched, leave them.

- [ ] **Step 7: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green - `test/web-app-verdict-sync.test.ts` regex-checks `HEDGE_BAND_MIN`/`HEDGE_BAND_MAX`/`MATERIAL_GAP_SHARE` against this file's source text; if you deleted `HEDGE_BAND_MIN`/`MAX` in Step 6, this test WILL fail - read it before deleting those two constants specifically, and if it turns out they are still required to exist in this file for that test's own sake (even if no drawing code reads them any more), keep them as an unused-but-present pair with a one-line comment saying why, rather than deleting them and breaking that test.

- [ ] **Step 8: Commit**

```bash
git add web/app.js
git commit -m "feat: the breakdown diagram is now a constellation canvas, driven by real coverage data"
```

---

## Task 3: Restyle the result card around the new canvas diagram [DONE - commit 30c78f6, CSS-only as scoped, no JS touched, verified with real screenshots via a throwaway static server (not the paid dev preview) across all 4 badge colors and both narrow/wide widths. One real gap noted: the 2-column decisive-tile legend has no reachable example among the 4 shipped readings to demonstrate it (all four currently produce exactly one hero tile) - verified instead with a synthetic fixture; a live check of an arbitrary address with 2 decisive tiles is the real, reachable path this covers.]

**Files:**
- Modify: `web/index.html` (the `.card`/`.headline`/`.summary`/`.stat`/`.breakdown`/badge CSS rules, and the `#breakdown` figure markup)
- Modify: `web/app.js` (only if the stat-overlay helpers from Task 2 Step 5 need adjusting once styled - coordinate with Task 2's output, do not redo Task 2's work)

**Context:** Task 2 made the diagram itself a constellation canvas with a centered stat overlay. This task makes the CARD AROUND it match the handoff's visual language: the pill-shaped verdict badge with a glowing dot, the "◂ THE POSITION" / "WHAT STANDS AGAINST IT ▸" two-column legend under the diagram (this project already shows this same information as the `#decisive` hero tile(s) above the diagram, per the 25.09 redesign - do not duplicate it a third time; instead RESTYLE the existing `#decisive` tiles to match the handoff's legend look, in the same two-column layout, rather than adding a second copy of the same numbers), and the dark panel/border treatment on `.card`, `.breakdown`, `figure`.

- [ ] **Step 1: Read the current code**

Read `web/index.html`'s current CSS for `.card`, `.badge` and its `.book`/`.hedged`/`.bet`/`.unknown` modifiers, `.headline`, `.summary`, `.stats`/`.stat`/`.stat.decisive`, `.breakdown`/`figure`/`figcaption`, in full. Read `web/app.js`'s `tile()` helper (builds `.stat`/`.stat.decisive` elements) and the `heroTiles` block in `renderResult` (added in the prior redesign cycle) so you know exactly what markup the two-column "position vs. what stands against it" tiles already produce.

- [ ] **Step 2: Restyle the badge**

Update `.badge` and its verdict-color modifier classes so the badge becomes a pill with a glowing dot, matching the handoff (30px tall, `border-radius: 999px`, `border: 1px solid rgba(255,255,255,.1)`, text color = the verdict's accent color, a 6px dot before the text in the same color with `box-shadow: 0 0 8px currentColor`). You will need to add the dot as a pseudo-element (`::before`) or a small inline `<span>` in `web/app.js`'s badge-rendering code - check which is less invasive given the current markup (a `::before` needs no JS change; prefer that if the current badge element is a single `<span>` with only text content, which it should be).

- [ ] **Step 3: Restyle the diagram container and stat overlay**

Give `.breakdown`/`figure` (or whatever wraps the canvas from Task 2) the panel treatment: sits inside the card's own `#0c0e13` surface (already the card's default background under the new tokens from Task 1 - confirm this, don't re-declare it if `.card` already provides it). Style `.constellation-stat` (added in Task 2 Step 5) as: `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none;` with `.constellation-stat-value` at `font-size: 44px; font-weight: 700; letter-spacing: -.03em; color: #f2f4f8; text-shadow: 0 0 24px #08090c, 0 0 40px #08090c;` and `.constellation-stat-label` at `font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); text-shadow: 0 0 12px #08090c;`. The canvas's own parent needs `position: relative` for this absolute centering to work - confirm Task 2's markup gives it one, add it here if not.

- [ ] **Step 4: Restyle the decisive hero tiles as the two-column legend**

The handoff's "◂ THE POSITION" / "WHAT STANDS AGAINST IT ▸" pair sits directly under the diagram as a two-column grid with a top border. This project's `#decisive` tiles already sit in roughly that position (per the prior redesign cycle - confirm exact current position by reading the file). Restyle `.stats`/`.stat.decisive` so that when there are exactly one or two decisive tiles, they lay out as a two-column grid (`display: grid; grid-template-columns: 1fr 1fr; gap: 24px;` on the container, when it holds exactly 2 children - use a CSS `:has()` selector or a class toggle in JS, your call) with small-caps mono labels (`.stat-label` at `font-family: "JetBrains Mono"; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--faint);`), a bold 17px value, and a 13px muted note - matching the handoff's legend typography exactly. Do not change `renderResult`'s or `tile()`'s JS logic (which evidence becomes a decisive tile, when the elsewhere tile is suppressed) - that logic was carefully built and reviewed earlier in this project; this task is CSS-only for this piece.

- [ ] **Step 5: Verify no verdict type's diagram looks broken**

You cannot run a browser in this step (that is Task 7's job) - but re-read `constellationInputsFor` from Task 2 once more against this task's new stat-overlay CSS, and confirm by inspection that the 44px stat number's likely rendered width (e.g. "100%", "<1%", "91%", "0%") will not visually collide with the diagram's own dots at the amplitude Task 2's `amp`/`gapHalf` constants produce at a typical card width (~640-720px, this project's existing `max-width`). If you think it might collide, say so in your report rather than silently shipping it - Task 7's browser check will catch it either way, but flagging a suspicion now saves a review round.

- [ ] **Step 6: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green - this task is CSS plus, at most, a small class-toggle in JS, nothing that touches tested logic.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/app.js
git commit -m "feat: the badge, diagram frame and decisive tiles take the new dark card styling"
```

---

## Task 4: The Player hero for the four example readings [DONE - commits 880cb42 + ff55859 (queue rows became real buttons after self-review). Real gap correctly found and adapted: gallery.featured is GalleryRow-shaped, not CheckResponse-shaped, so constellationInputsFor needed a field-path adapter (constellationInputsForRow), verified executably against all 4 real featured readings, not just by inspection. Independently verified live in the browser by the coordinator: player navigation (prev/next/segments), queue thumbnails, and "Open this reading" all confirmed working end-to-end against the real #card below.]

**Files:**
- Modify: `web/index.html` (replaces the `.examples`/`#examples-chips` block - read current lines ~212-224 first, they may have shifted - with the new player transport markup; adds its CSS)
- Modify: `web/app.js` (new rendering/state logic for the player: current index, prev/next, segment bar, queue rows with mini constellation canvases - wired to `gallery.featured`, the same 4 real entries the current `#examples-chips` buttons already read from)

**Context:** This REPLACES the current row of 4 plain example-chip buttons with the handoff's fuller "player" treatment: a `NOW READING · 0N / 04` label, prev/next circular buttons, a 4-segment progress bar (clicking a segment jumps to that reading), and a queue list below with a mini constellation thumbnail per row. It does not replace how a reading is actually opened (`openSnapshot(id)`, already wired) - it only replaces the trigger UI. Clicking prev/next/a segment/a queue row all do exactly what clicking an example chip does today: open that saved reading via `openSnapshot`.

- [ ] **Step 1: Read the current code**

Read `web/index.html`'s current `.examples`/`#examples-chips` block and the CSS that styles `.examples`/`.chip` (grep for `.examples` and `.chip` across the file). Read `web/app.js` for where `#examples-chips` is populated or where `data-example` buttons get their click handler (grep `examples-chips` and `data-example`) - this is almost certainly a single delegated click listener reading `event.target.dataset.example`, confirm the exact mechanism before replacing its markup, since Step 3 needs to preserve however addresses get from a click to `openSnapshot`.

- [ ] **Step 2: Replace the markup**

Replace the current `<div class="examples">...</div>` block (the one containing `#examples-chips`, NOT the `#recent` one directly below it, which is a separate, untouched block) with:

```html
<!-- Read fresh on 26 September and picked by hand, one of each kind of
     answer, from data/featured.json; test/featured.test.ts holds these
     chips to that file. The scan further down is older and was read before
     the card had the position's own numbers (23.09 audit, U05). -->
<section class="player" id="player" hidden>
  <div class="player-head">
    <div class="player-head-left">
      <div class="player-now-reading" id="player-now-reading"></div>
      <div class="player-title" id="player-title"></div>
      <div class="player-addr mono" id="player-addr"></div>
    </div>
    <div class="player-badge" id="player-badge"></div>
  </div>
  <div class="player-transport">
    <button class="player-nav" id="player-prev" aria-label="Previous reading">&#9664;</button>
    <button class="player-nav" id="player-next" aria-label="Next reading">&#9654;</button>
    <div class="player-segments" id="player-segments"></div>
    <button class="player-open" id="player-open">Open this reading</button>
  </div>
</section>
<section class="queue" id="player-queue"></section>
```

(Kept deliberately smaller than the handoff's full card-with-embedded-diagram: the diagram, legend, summary, open-question, share, and all folds ALREADY exist as the site's normal `#card` - opened the same way an example chip opens it today. Duplicating the whole result card a second time inside the player would mean two copies of the same information with two copies of bugs to fix; instead the player is a picker with a live preview strip, and "Open this reading" scrolls to and populates the real `#card`, exactly like clicking today's example chip does. If, after reading the handoff once more, you believe the intent was genuinely to inline the full result card inside the player section instead - larger surgery, real duplication risk - STOP and report that judgment call rather than silently picking one.)

- [ ] **Step 3: Add the player's JS**

Find wherever `web/app.js` currently populates `#examples-chips` (from Step 1's research) and replace it with logic that:
- Reads the 4 entries from `gallery.featured` (same source as today).
- Tracks a small local `playerIdx` (module-level `let`, starts at 0, or at the index of `FLAGSHIP_ID` if you want the same "which one shows first" behavior this project already has elsewhere - check how `FLAGSHIP_ID` is used today, around line 30 and its call site, and match that behavior rather than silently changing what a fresh visitor sees first).
- Renders `#player-now-reading` (`NOW READING · 0N / 04`), `#player-title` (`positionText(entry)`), `#player-addr` (the full address), `#player-badge` (verdict pill, reusing the badge markup/classes from Task 3 Step 2 - do not build a second, different badge style here), a mini `drawConstellation(canvas, { ...constellationInputsFor(entry), mini: true })` per queue row (four `<canvas>` elements inside `#player-queue`, one per `gallery.featured` entry, ~180×38px per the handoff's own spec).
- Wires `#player-prev`/`#player-next`/segment clicks/queue-row clicks to change `playerIdx` and re-render the strip.
- Wires `#player-open` (and, per the handoff, a queue row click too) to do exactly what today's example-chip click does - almost certainly a call to `openSnapshot(entry.snapshotId)` or equivalent, found in Step 1. Do not reimplement snapshot-opening; call the existing function.
- Shows `#player` (remove `hidden`) exactly when `gallery.featured` has entries, matching today's `#examples-chips`/`.examples` visibility logic.

- [ ] **Step 4: Style it**

Add CSS for `.player`, `.player-head`, `.player-now-reading` (JetBrains Mono, 11px, letter-spacing .12em, uppercase, `var(--faint)`), `.player-title` (26px/700), `.player-addr` (12px, `var(--faint)`), `.player-transport` (flex row, `background: var(--surface-3)`, the segment bar as 4 small rounded bars per the handoff's spec: `height: 3px; border-radius: 2px; background: rgba(255,255,255,.08)`, active segment `background: #4fb8ff; box-shadow: 0 0 8px rgba(140,180,255,.6)`), `.queue` as a bordered list matching the handoff's queue-row grid (`grid-template-columns: 28px 180px minmax(0,1fr) auto`), with the active row background `rgba(140,170,255,.05)`.

- [ ] **Step 5: Verify no id collisions**

Grep `web/app.js` for every `$('...')` reference once more (same discipline as every prior structural task in this project) - confirm every new id you introduced (`player`, `player-now-reading`, `player-title`, `player-addr`, `player-badge`, `player-prev`, `player-next`, `player-segments`, `player-open`, `player-queue`) is unique and every one you reference from JS exists in the HTML you just wrote.

- [ ] **Step 6: Run the whole suite**

Run: `npm test` and `npm run typecheck`. Pay particular attention to `test/featured.test.ts`'s "the chips at the top of the page" describe block (it currently regexes `<button class="chip" data-example="...">...</button>` out of `web/index.html` - since this task removes that exact markup shape, this test WILL need updating to match whatever new markup Step 2 actually produced. Update the test's own regex/expectations to match your new markup's real shape rather than deleting the test's intent - it still needs to assert: the four featured `snapshotId`s appear in the new markup in the right order, and each one's displayed text still starts with its real position text (`$X.XM COIN SIDE`), matching what `test/featured.test.ts` already checks for the old chip markup.)

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/app.js test/featured.test.ts
git commit -m "feat: the four featured readings open through a Player strip, not plain chips"
```

---

## Task 5: Reskin everything else (guess game, recent checks, gallery, boards, footer, folds) [DONE - audit only, no commit needed: every rule outside Tasks 1/3/4/6's scope already used var(--...) tokens with zero hardcoded literals, verified by reading the entire stylesheet, not sampling it. One real leftover found outside Task 5's own CSS-only scope (the favicon's inline SVG data URI still had the old light-theme blue) - fixed directly by the coordinator in commit 14740f7.]

**Files:**
- Modify: `web/index.html` (CSS only - the guess-game chips, `.examples`/`#recent` block that Task 4 did NOT touch, gallery rows, board rows, footer, `<details>` fold styling, `.box`/`.changed`/`.limit` boxes)

**Context:** Every section not already covered by Tasks 1-4 needs to pick up the new dark tokens for visual consistency, without any structural change - this is the lowest-risk, most mechanical task in this plan.

- [ ] **Step 1: Read the current code**

Read the remainder of `web/index.html`'s `<style>` block not already touched by Tasks 1-4 (the `.guess`/`.chip` rules, `#recent`, `.box`, `.changed`, `.limit`, `.fold`, `.list`/`.row`, `.board`, footer) in full.

- [ ] **Step 2: Update remaining hardcoded colors**

Every rule in this remaining CSS should already be using `var(--bg)`/`var(--fg)`/`var(--muted)`/`var(--panel)`/`var(--line)`/`var(--hover)` tokens (Task 1 redefined those tokens' VALUES, not their names) - so most of this section needs NO changes at all. Grep specifically for any remaining hex color literal (`#` followed by 3 or 6 hex digits) in the parts of the stylesheet Tasks 1-4 didn't touch. For each one found: if it is a verdict-specific literal (e.g. a board row's badge background), replace it with the matching new token from Task 1's `:root` (`--book-bg`, `--hedged-fg`, etc.) rather than a fresh hardcoded value. If it is something else entirely (unrelated to the palette - e.g. a debug outline), leave it and note it in your report.

- [ ] **Step 3: Match the new type scale where it's cheap to do so**

Where a mono/label-style element already exists (uppercase small-caps labels like "STILL OPEN", "FROM NANSEN", column headers in the boards), switch its `font-family` to lead with `"JetBrains Mono"` to match the new type language, the same way Task 1 Step 4 did for `.mono`. Do not restructure any layout - this task is fonts and colors only.

- [ ] **Step 4: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat: the rest of the page picks up the new dark tokens and type"
```

---

## Task 6: The share/OG images show the actual constellation, not a re-themed bar [DONE - commit a0c4ebb, one fix round (b5a9888, root-caused a provenance-line truncation bug). Independently verified twice by the coordinator directly against real dev-preview output (POST /api/og + fetch, not just trusting the report) for the bet and funders/ghost cases - constellation, stat number, badge, and now-fixed ellipsis all confirmed correct. Note: OG images are cached forever for bundled/featured readings once drawn (no TTL) - the accumulated Task 6 fixes only reach production once the already-planned final `prerender-og.ts --upload` step runs.]

**REVISED after Task 3 landed** (see this plan's key decision #4, corrected in chat by the user: "обязательно именно звездная карточка должна шерится в соц сетях" - the constellation card, specifically, is what must appear when a link is shared). The original version of this task (re-theme the existing bar's colors) is superseded - do not implement the old version.

**Files:**
- Modify: `web/app.js` (`drawCard` and whatever it currently calls for the breakdown portion of the in-browser share/download canvas - Part A, low risk, reuses Task 2's work directly)
- Modify: `src/engine/ogCard.ts`, `src/engine/ogRender.ts`, and a new small module for the ported model math (Part B, higher risk, needs its own spike first - see Step 4)
- Modify: `web/app.js` (`VERDICTS[...].accent`, the four fixed hex values used by both fixed-background renderers)

**Context:** `drawCard` (the in-browser "Copy image"/"Download image" canvas) runs in the same browser as the live page, so it can call `drawConstellation` directly - no new engineering, just a different caller (Part A). The server-rendered OG picture (`ogCard.ts`/`ogRender.ts`, `satori` + `resvg`, running inside a Workers isolate for the live Worker and inside plain Node for the offline pre-render script) has no Canvas2D at all - satori lays out a flexbox-like element tree into SVG, then `resvg` rasterizes that SVG to PNG. The constellation has to become a piece of pure-JS-generated SVG markup (not canvas drawing calls), built from the same seeded model, and embedded into satori's tree as an `<img>` with a data-URI `src`. This is genuinely new work, not a port - Step 4 verifies the embedding technique actually rasterizes correctly before the rest of this task is built on top of it.

- [ ] **Step 1: Read the current code**

Read `web/app.js`'s `drawCard` and everything it currently calls for the breakdown/bar portion specifically (the rest of `drawCard` - header, summary text, footer - is unrelated and untouched by this task). Read `src/engine/ogCard.ts` and `src/engine/ogRender.ts` in full (both are short - reproduced in large part in this task's context already, but read the REAL current files, they may have shifted). Read `web/app.js`'s `constellationInputsFor`, `buildConstellationModel`, `drawConstellation`, `seedFromAddress` (all from Task 2) once more - Part B ports the math half of this (`seedFromAddress`, `buildConstellationModel`, and the four `coverage`/`ghost`/`bookDensity` derivations `constellationInputsFor` already codifies) into TypeScript, reading from `CheckResult`/`OgCardInput` instead of the client's `CheckResponse`-shaped `d` - the LOGIC must stay identical, only the source object's field paths differ (confirm each field's TypeScript equivalent by reading `src/api/check.ts`, `src/engine/verdict.ts`, `src/engine/breakdown.ts`, `src/engine/features.ts` - `CheckResult` should carry the same underlying data `constellationInputsFor` reads, just via TypeScript's stricter types rather than a plain JS object).

- [ ] **Step 2 (Part A): The in-browser share card reuses the real canvas engine**

In `web/app.js`'s `drawCard`, find wherever it currently draws the breakdown/bar portion (read it first - it very likely has its own bar-drawing helper(s), separate from the page's old SVG diagram, that Task 2 did not touch since Task 2's file list was scoped to `renderBreakdown` only). Replace that bar-drawing call with a call to `drawConstellation` against the SAME canvas `drawCard` already has a 2D context for, passing `constellationInputsFor(d)` (the same function Task 2 built, called against the same reading object `drawCard` already receives). You will likely also want to draw the big stat number/label as text directly on this canvas (this function already draws text with `ctx.fillText`, unlike the page's DOM-based `.constellation-stat` overlay - use the existing text-drawing conventions already present elsewhere in `drawCard` for font/size/position, positioned centered over wherever you draw the constellation, matching Task 3's on-page layout in spirit, not necessarily pixel-for-pixel).

Keep everything else in `drawCard` (header, summary, footer, provenance line) exactly as it is except for color updates - Task 1's new palette should already flow into any code that reads `VERDICTS[...].accent`/similar CSS-adjacent values, but `drawCard` draws on a plain canvas with no CSS custom properties available, so any hardcoded old-light-theme hex literal it uses for background/text needs updating to the new dark values by hand (background `#08090c` or `#0c0e13`, primary text `#e6e8ee`, muted text `#8b90a0`) - the same literal-color sweep the ORIGINAL version of this task already asked for, still needed regardless of the constellation change.

- [ ] **Step 3: Update `VERDICTS[...].accent`**

In `web/app.js`, update the four `VERDICTS[...].accent` hex values (currently `#0c447c`/`#27500a`/`#633806`/`#444441`, the OLD light-theme colors) to the new fixed values: book `#7fa2ff`, hedged `#4fe0b0`, bet `#f2b35c`, unknown `#a3a8b6` - the same four values Task 1 already put in `:root` and Task 2/3 already read via `svgAccentOf`. This map is deliberately still fixed hex (not a CSS var) because both `drawCard` (Part A, fixed-background canvas) and the OG renderer (Part B, fixed-background SVG) need a concrete color with no CSS cascade available - after this change, every surface in the project (live page, share canvas, OG picture) reads from the same four hex values instead of two different palettes.

- [ ] **Step 4 (Part B): Verify the embedding technique BEFORE building the full generator**

Before writing the real constellation-SVG generator, prove the mechanism works with a trivial test case, since this is the one technically uncertain part of this entire plan:

1. Hand-write a minimal SVG string containing one visible shape, e.g. `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>`.
2. Base64-encode it and build a data URI: `data:image/svg+xml;base64,<encoded>`.
3. Add ONE `{ type: 'img', props: { src: dataUri, width: 100, height: 100 } }` node into a throwaway copy of `ogTree`'s output (or a standalone test script that calls `satori(...)` directly with a minimal tree containing just this image node) and run it through the exact same `renderOgPng` pipeline this project already uses (`satori` then `new Resvg(svg, ...).render().asPng()`).
4. Save the resulting PNG to a file and read it (this project's tools can read image files directly) - confirm the red circle actually appears in the output. If it does not (blank, an error, or a broken-image icon), try a `data:image/png;base64,...` PNG data URI instead of SVG (render the tiny test shape to a PNG first via any available means, e.g. a quick offscreen-canvas-less approach, or report back describing exactly what failed rather than guessing further) - report which format actually worked, in your final report, before proceeding to Step 5.

**If NEITHER embedding format renders anything**, STOP (BLOCKED) and report this precisely - do not spend further time building the full generator against a mechanism that does not work. This is exactly the scenario this spike step exists to catch early.

- [ ] **Step 5 (Part B): Port the model math to TypeScript**

Create `src/engine/constellation.ts` with `seedFromAddress`, `rng`(the mulberry32 PRNG), and `buildConstellationModel` - a faithful TypeScript port of the same-named functions in `web/app.js` (Task 2), pure math, no DOM/canvas/browser API references anywhere in this file (it must run in a Workers isolate and in plain Node identically). Export them, plus a new `constellationInputsFor(input: OgCardInput)`-equivalent (name it appropriately for this file, e.g. `constellationInputsForOg`) that reproduces `web/app.js`'s `constellationInputsFor` logic exactly, reading from whatever `OgCardInput`/`CheckResult`-shaped fields correspond to `d.address`/`d.hedge.hedgeRatio`/`d.orders.headlineTwoSidedNotionalUsd`/`d.positions.headlineNotionalUsd`/`d.positions.headlineShare`/`d.breakdown.elsewhere`/`d.verdict.verdict` in the client version - trace each field's real TypeScript path yourself (Step 1 told you where to look), do not guess a field name that merely sounds right.

Add a test file `test/engine/constellation.test.ts` asserting `buildConstellationModel` is deterministic (same seed and N always produce the identical `env`/`jitter`/`mids`/`bokeh` arrays) and that `constellationInputsForOg` produces the same `coverage`/`ghost`/`bookDensity` values the client's `constellationInputsFor` would for each of this project's four real featured readings (`data/featured.json`) - a cross-check that both implementations agree, not just that the server one runs without throwing.

- [ ] **Step 6 (Part B): Build the SVG constellation generator**

Add a function to `src/engine/constellation.ts` (or a sibling file in the same directory, your call) that takes the same inputs `drawConstellation` takes (`seed`, `coverage`, `ghost`, `bookDensity`, plus a `width`/`height`) and returns a complete SVG string: a dark background rect, two peaks of circles (left full-height, right scaled by `coverage`, connected by thin lines to nearby neighbors - the same left/right/link logic `drawConstellation` already implements, translated from canvas draw calls to SVG element strings), each dot as a `<circle>` with a `<radialGradient>` fill (approximating the canvas version's glow sprite - white core fading through the dot's own hue to transparent, the same four-color palette `#6fd0ff`/`#9a7bff`/`#ff4fa8`/`#ffc94d`), and, when `ghost` is true, a dashed-line/hollow-circle mirror on the right in `rgba(170,176,192,.28)`/`.45`, matching `drawConstellation`'s ghost treatment. This does not need to be pixel-identical to the canvas version (SVG has no `globalCompositeOperation: 'lighter'` equivalent for overlapping radial gradients the way canvas does) - it needs to be clearly the same visual family: dark background, glowing dot constellation, two peaks meeting in the middle. Use your judgment on exact gradient stops/line opacity to get a good-looking static result; this is the one place in this whole plan where "close and good-looking" beats "byte-identical," given SVG's real technical limits versus canvas.

Write a small script or test to render this against all four real featured readings and save the output SVGs/PNGs somewhere you can look at them (this project's tools can read image files - actually render and look, do not just confirm the code runs without throwing).

- [ ] **Step 7 (Part B): Wire it into the OG tree**

In `ogCard.ts`, add whatever new field(s) `OgCardData` needs to carry the constellation inputs (or the pre-built SVG string itself - your call which layer computes it, but keep `ogCard.ts` free of satori/rendering concerns per this file's own stated split, so probably carry the inputs, not the rendered string, and build the actual SVG string in `ogRender.ts` where the rendering happens) - compute them via `constellationInputsForOg` inside `ogCardData`, the same place `segments`/`elsewhere` are already computed today.

In `ogRender.ts`, replace the `bar`/`barRow`/`elsewhere` construction in `ogTree` with the constellation `<img>` node (base64 data URI, from Step 4's proven-working format), sized to fit this card's existing layout (the OG card is `1200×630`; give the constellation a sensible chunk of that, e.g. full width minus padding, ~260-300px tall, similar proportions to Task 3's on-page diagram). Keep the big stat number as a separate satori `div` overlaid or positioned near it (satori does support absolute positioning within a flex tree via `position: 'absolute'` - confirm this works in your Step 4 spike if you have time, or verify directly here) - matching the on-page centered-stat treatment in spirit.

- [ ] **Step 8: Check the golden snapshot test**

`test/api/__snapshots__/check-golden.test.ts.snap`, `test/engine/ogRender.test.ts`, `test/engine/ogCard.test.ts` (read them first) very likely assert the old `segments`/`bar`/`elsewhere` shape of `OgCardData` and/or exact rendered SVG output. Update whatever they assert to match the new constellation-based shape - read each failing assertion and understand what changed before updating it, do not blanket-regenerate without reading the diff.

- [ ] **Step 9: Run the whole suite**

Run: `npm test` and `npm run typecheck`.
Expected: all green once Step 8's updates are in.

- [ ] **Step 10: Commit**

```bash
git add web/app.js src/engine/ogCard.ts src/engine/ogRender.ts src/engine/constellation.ts test/
git commit -m "feat: the share image and OG picture show the real constellation, not a bar"
```

(Re-rendering and re-uploading the actual OG images to production (`node --import tsx scripts/prerender-og.ts --upload`) is a separate, later step - once this whole plan's tasks are done and verified (Task 7), not part of this task's own commit. This step needs the user's own terminal per this session's established pattern for that specific command - the Claude Code auto-mode classifier blocks it as a production-deploy action for both the main session and any subagent.)

---

## Task 7: Full verification in a browser, across verdict types, plus OG spot-check [DONE - done directly by the coordinator, not dispatched. npm test/typecheck/test:runtime/audit all green (613 tests), em-dash scan clean across every file this plan touched including the plan doc itself. All 4 verdict types confirmed correct in the live page (constellation shape, stat number, badge, player navigation via prev/next/segments/queue-rows/"Open this reading") and in the OG image (all 4 fetched and screenshotted). One real bug found and fixed during the mobile check: a queue row's badge (a fixed-height pill) doesn't wrap gracefully in a grid column, and its auto-sized column was squeezing the title column down far enough that overflow-wrap:anywhere broke titles mid-character - fixed in commit 7a7904c (break-word + badge moves to its own row under 480px), verified at both 375px and desktop width.]

**Files:** none (verification only)

**Context:** This plan touches nearly every visual surface of the site. Task 7 in the PRIOR plan (`docs/superpowers/plans/2026-09-25-deferred-items.md`) is the template for how thorough this needs to be - do at least that, across all four verdict types, plus specifically the player strip's prev/next/segment/queue interactions this time, since those are entirely new.

- [ ] **Step 1: Full automated suite**

```bash
npm test
npm run typecheck
npm run test:runtime
npm audit --omit=dev
```

- [ ] **Step 2: Em dash grep**

Scoped to every file this plan's tasks touched (`web/index.html`, `web/app.js`, `src/engine/ogCard.ts`, `src/engine/ogRender.ts`, `test/featured.test.ts`, any snapshot files Task 6 touched) - do a programmatic codepoint scan for U+2014 and U+2013, not a visual eyeball check. The handoff copy this plan is based on had several em dashes in its example text (the intro line, three of the four verdict summaries, the bet rule text) - confirm none of them survived into the real copy anywhere.

- [ ] **Step 3: Browser walkthrough**

Start the dev preview. Using ONLY the four example readings in the new player (never submit a fresh address - this project's dev preview spends real Nansen credits on a live check):
1. Confirm the player strip shows `NOW READING · 0N / 04`, the right title/address/badge, and a constellation diagram with a centered stat.
2. Click next/prev/each segment/each queue row - confirm the strip updates and the mini queue canvases render without throwing (check the browser console for errors after each click).
3. Click "Open this reading" (or whatever Task 4 Step 3 wired) for each of the 4 - confirm the real `#card` populates below, with its own (larger) constellation diagram matching that reading's real coverage number, the two-column legend, and the rest of the card in the new dark styling.
4. For the book reading specifically: confirm the diagram uses the denser point count (`bookDensity: true`) and looks visually distinct from the others (more points).
5. For the funders/unknown reading specifically: confirm the ghost/dashed mirror renders on the right side.
6. For the bet/long reading specifically: confirm the right side is near-empty (matches its real, near-zero `headlineShare`-or-whatever-Task-2-decided coverage) and does not crash on a `null`/`0` edge case.
7. Scroll through the rest of the page (guess game, recent checks if any exist in this browser profile, ranked boards, full gallery/archive, footer) - confirm everything reads in the new dark palette with no leftover light-mode-looking element (a stray white box, unreadable dark-on-dark text, etc.).
8. Resize the browser to a narrow (mobile-ish) width and confirm the player transport and the two-column legend don't visually break (stack sensibly or at least stay readable) - this plan did not specify responsive breakpoints explicitly, so use judgment matching the rest of this project's existing responsive behavior, and report anything that looks broken rather than silently accepting it.

- [ ] **Step 4: OG image spot-check**

Read `src/engine/ogCard.ts`'s test coverage output once more (already re-verified green in Task 6) - since a live browser cannot easily preview a server-rendered OG image without a real request, instead: fetch `/api/og?id=<one of the four featured snapshotIds>` (or whatever this project's actual OG endpoint path is - grep `ogRender`/`ogCard`'s call site in `src/index.ts` for the real route) from the dev preview directly and confirm the response is a valid image with no error, then save/view it to confirm the colors visually match Task 6's intent.

- [ ] **Step 5: Report**

Summarize what shipped, flag anything that looked wrong in the walkthrough, and explicitly list what is NOT done yet (the production OG re-render/upload step, which needs the user's own terminal per this session's established pattern for that specific command).
