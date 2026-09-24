const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const EXPLORERS = {
  arbitrum: 'https://arbiscan.io/address/',
  ethereum: 'https://etherscan.io/address/',
};
const VERDICTS = {
  book: { label: 'Book', cls: 'book', headline: 'This is a market-making book.', accent: '#0c447c' },
  hedged: { label: 'Hedged', cls: 'hedged', headline: 'The offsetting asset is in this same account.', accent: '#27500a' },
  looks_like_a_bet: { label: 'Looks like a bet', cls: 'bet', headline: 'This looks like a real bet.', accent: '#633806' },
  unknown: { label: 'Unknown', cls: 'unknown', headline: 'Not enough evidence either way.', accent: '#444441' },
};
const PAGE_SIZE = 25;
// The reading a visitor with nothing pasted yet sees first: the funded-short
// demonstration reading, because its picture is the one that needs no
// explanation (a big bar, an empty solid segment, and $443.7M held in a
// dashed box beside it that "does not count"). Free to open - it is one of
// the four bundled chips, opened the same way a shared link would (24.09
// audit, U01).
const FLAGSHIP_ID = '075ocy85yngsu';

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
function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
function verdictOf(d) {
  return VERDICTS[d.verdict.verdict] || VERDICTS.unknown;
}
function badgeText(d) {
  return verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
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

// ---- the evidence diagram ----
//
// Five identical tiles of numbers made the reader assemble the answer, and
// the thing they had to assemble - that $464M of matching ETH belongs to
// wallets which funded this account rather than to this account - is the
// whole card. So it is drawn: one bar for the position, split into what was
// found against it, and anything held elsewhere on a dashed connection
// beside it, never inside the bar.
//
// The arithmetic is the server's (src/engine/breakdown.ts); this only draws.
const SEGMENT_STYLE = {
  covered: { label: 'covered by this address', fill: 'var(--accent)', opacity: 1 },
  unverified: { label: 'could not identify', fill: 'var(--accent)', opacity: 0.35 },
  residual: { label: 'nothing found against it', fill: 'var(--line)', opacity: 1 },
  // Fainter than "nothing found against it" on purpose: this part of the
  // bar was never looked at, so it cannot say the same thing an empty,
  // complete search says (23.09 audit, L12).
  'not-checked': { label: 'not checked for a hedge', fill: 'var(--line)', opacity: 0.5 },
};

const svgEl = (name, attrs, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Below this real width, the "held elsewhere" block moves under the bar
 * instead of beside it. A fixed 640-unit viewBox scaled down to a 343px
 * phone shrank every label with it - 12px text became 6-7 rendered pixels,
 * the whole reason U01 called it unreadable. Building the SVG at its own
 * real rendered width instead (see `renderBreakdown`) fixes that on its
 * own; the stacked layout below is the second half, because 38% of a phone
 * screen is not enough room for four lines of text whatever their size. */
const NARROW_BREAKDOWN_WIDTH = 520;

/** The side-by-side layout: the position keeps 62% of the width whether or
 * not anything is drawn beside it, so two cards of the same size read as
 * the same size. `W` is the real rendered width, so 1 SVG unit is 1 CSS
 * pixel and the `.seg-label`/`.seg-value` font sizes render at face value. */
function drawBreakdownWide(svg, b, W) {
  const barY = 26;
  const barH = 34;
  const hasElsewhere = !!b.elsewhere;
  const barW = hasElsewhere ? W * 0.62 : W;
  const H = hasElsewhere ? 150 : 120;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `${fmtUsd(b.headlineUsd)} ${b.coin} ${b.side}`));

  let x = 0;
  b.segments.forEach((seg) => {
    const style = SEGMENT_STYLE[seg.kind];
    // A sliver still has to be visible: 0.0003% of a $216M short is $609,
    // and a band of zero pixels says the wrong thing about it.
    const w = Math.max(2, seg.share * barW);
    svg.append(
      svgEl('rect', {
        x, y: barY, width: w, height: barH, rx: 3,
        fill: style.fill, 'fill-opacity': style.opacity,
        stroke: 'var(--line)', 'stroke-width': 1,
      }),
    );
    x += w;
  });

  // The legend stacks under the bar rather than sitting beneath each band:
  // a band two pixels wide has nowhere to put a sentence, and a band at the
  // right-hand end pushes its label off the edge.
  b.segments.forEach((seg, i) => {
    const style = SEGMENT_STYLE[seg.kind];
    const ly = barY + barH + 18 + i * 19;
    svg.append(
      svgEl('rect', {
        x: 0, y: ly - 9, width: 10, height: 10, rx: 2,
        fill: style.fill, 'fill-opacity': style.opacity, stroke: 'var(--line)', 'stroke-width': 1,
      }),
    );
    svg.append(
      svgEl('text', { x: 18, y: ly, class: 'seg-label' },
        `${fmtUsd(seg.usd)} (${fmtPct(seg.share)}) ${style.label}`),
    );
  });

  if (b.excessUsd > 0) {
    const ly = barY + barH + 18 + b.segments.length * 19;
    svg.append(
      svgEl('text', { x: 0, y: ly, class: 'seg-label' },
        `and ${fmtUsd(b.excessUsd)} more of it held beyond the position: net long, not neutral`),
    );
  }

  if (hasElsewhere) {
    const ex = barW + 46;
    const ew = W - ex;
    svg.append(
      svgEl('path', {
        d: `M ${barW + 4} ${barY + barH / 2} L ${ex - 6} ${barY + barH / 2}`,
        stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4', fill: 'none',
      }),
    );
    svg.append(
      svgEl('rect', {
        x: ex, y: barY, width: ew, height: barH, rx: 3,
        fill: 'none', stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
      }),
    );
    svg.append(svgEl('text', { x: ex, y: 14, class: 'seg-label' }, 'held elsewhere'));
    svg.append(
      svgEl('text', { x: ex + 8, y: barY + barH / 2 + 5, class: 'seg-value' }, fmtUsd(b.elsewhere.usd)),
    );
    svg.append(
      svgEl('text', { x: ex, y: barY + barH + 20, class: 'seg-label' },
        `in ${plural(b.elsewhere.wallets, 'wallet')} that funded this account`),
    );
    svg.append(
      svgEl('text', { x: ex, y: barY + barH + 38, class: 'seg-label' }, 'ownership unverified, not counted'),
    );
  }
}

/** The stacked layout for a narrow screen: the bar keeps the full width,
 * and anything held elsewhere goes underneath it rather than squeezed into
 * a sliver on the right. Height is not fixed - it grows with however many
 * legend lines and whether there is an elsewhere block at all - so the
 * viewBox is sized from where drawing actually stopped. */
function drawBreakdownNarrow(svg, b, W) {
  const barY = 26;
  const barH = 34;
  let y = barY;

  svg.append(svgEl('text', { x: 0, y: 14, class: 'bar-title' }, `${fmtUsd(b.headlineUsd)} ${b.coin} ${b.side}`));

  let x = 0;
  b.segments.forEach((seg) => {
    const style = SEGMENT_STYLE[seg.kind];
    const w = Math.max(2, seg.share * W);
    svg.append(
      svgEl('rect', {
        x, y: barY, width: w, height: barH, rx: 3,
        fill: style.fill, 'fill-opacity': style.opacity,
        stroke: 'var(--line)', 'stroke-width': 1,
      }),
    );
    x += w;
  });

  y = barY + barH + 18;
  b.segments.forEach((seg) => {
    const style = SEGMENT_STYLE[seg.kind];
    svg.append(
      svgEl('rect', {
        x: 0, y: y - 9, width: 10, height: 10, rx: 2,
        fill: style.fill, 'fill-opacity': style.opacity, stroke: 'var(--line)', 'stroke-width': 1,
      }),
    );
    svg.append(svgEl('text', { x: 18, y, class: 'seg-label' }, `${fmtUsd(seg.usd)} (${fmtPct(seg.share)}) ${style.label}`));
    y += 19;
  });

  if (b.excessUsd > 0) {
    svg.append(
      svgEl('text', { x: 0, y, class: 'seg-label' },
        `and ${fmtUsd(b.excessUsd)} more of it held beyond the position: net long, not neutral`),
    );
    y += 19;
  }

  if (b.elsewhere) {
    const midX = W / 2;
    svg.append(
      svgEl('path', {
        d: `M ${midX} ${y + 4} L ${midX} ${y + 22}`,
        stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4', fill: 'none',
      }),
    );
    y += 34;
    svg.append(svgEl('text', { x: 0, y, class: 'seg-label' }, 'held elsewhere'));
    y += 8;
    const boxY = y;
    svg.append(
      svgEl('rect', {
        x: 0, y: boxY, width: W, height: barH, rx: 3,
        fill: 'none', stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
      }),
    );
    svg.append(svgEl('text', { x: 8, y: boxY + barH / 2 + 5, class: 'seg-value' }, fmtUsd(b.elsewhere.usd)));
    y = boxY + barH + 20;
    svg.append(
      svgEl('text', { x: 0, y, class: 'seg-label' }, `in ${plural(b.elsewhere.wallets, 'wallet')} that funded this account`),
    );
    y += 18;
    svg.append(svgEl('text', { x: 0, y, class: 'seg-label' }, 'ownership unverified, not counted'));
    y += 12;
  } else {
    y += 6;
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${y}`);
}

function renderBreakdown(d) {
  const b = d.breakdown;
  const box = $('breakdown');
  if (!b || !b.applies || !b.segments.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.style.setProperty('--accent', verdictOf(d).accent);

  // The SVG is built at its own real rendered width - not a fixed 640 that
  // then gets scaled down - so 1 SVG unit is 1 real CSS pixel and a 12px
  // label renders at 12px whatever the screen (audit U01). `clientWidth` is
  // read after un-hiding the figure, since a hidden element reports 0.
  const W = box.clientWidth || 640;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} 120`, role: 'img' });
  svg.append(svgEl('title', {}, `${fmtUsd(b.headlineUsd)} ${b.coin} ${b.side}, and what was found against it`));

  if (W < NARROW_BREAKDOWN_WIDTH) {
    drawBreakdownNarrow(svg, b, W);
  } else {
    drawBreakdownWide(svg, b, W);
  }

  $('breakdown-svg').replaceChildren(svg);
  $('breakdown-caption').textContent = b.elsewhere
    ? `What stands against the ${b.coin} ${b.side} - and what only looks like it does`
    : `What stands against the ${b.coin} ${b.side}`;
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
  );
  renderChanged(d);
  renderBreakdown(d);

  // The one piece of evidence the verdict turned on, when there is no
  // picture of it: the bar above already is that evidence for a short, and
  // repeating it as a number underneath would say it twice.
  const decisive = $('breakdown').hidden ? (d.evidence || []).filter((item) => item.decisive) : [];
  $('decisive').hidden = decisive.length === 0;
  $('decisive').replaceChildren(...decisive.map(tile));

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
  $('copy-card').textContent = 'Copy image';
  if (kind === 'live' && d.snapshotId && d.positions.nPositions > 0) {
    saveRecent({
      id: d.snapshotId,
      address: d.address,
      headline: positionText(d),
      verdict: d.verdict.verdict,
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

$('guess-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  pendingGuess = btn.dataset.guess;
  for (const b of $('guess-chips').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
});

// A visitor with no address in hand had nothing to click above the fold
// until the gallery lower down the page (audit U02). These three open a
// real saved reading the same way a shared link does - free, and exactly
// what the reader would see if they had pasted that address themselves.
$('examples-chips').addEventListener('click', (e) => {
  const id = e.target.closest('button')?.dataset.example;
  if (id) openSnapshot(id);
});

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
    note: 'Under 10% covered by this address - the rest is still open.',
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeRatio < 0.1,
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
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address)),
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
  // An account can close its position between the ranking and its check;
  // with nothing open it is not one of the biggest positions any more.
  const open = (gallery.entries || [])
    .filter((e) => e.positions.nPositions > 0)
    .sort((a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd);
  if (open.length === 0) return;
  gallery.currentRows = open.filter((e) => !e.historical);
  gallery.historicalRows = open.filter((e) => e.historical);
  renderBoards(gallery.currentRows);

  // Each demonstration chip says, on hover, exactly when it was read.
  for (const row of gallery.featured || []) {
    const chip = document.querySelector('#examples-chips [data-example="' + row.snapshotId + '"]');
    if (chip) chip.title = 'Read ' + fmtTime(row.checkedAt) + ' - a saved reading; opening it costs nothing';
  }

  // Cards are re-checked one at a time as credits allow, so the set can span
  // days. Showing one timestamp for all of them would be wrong.
  const times = open.map((e) => e.checkedAt).sort();
  const first = fmtTime(times[0]);
  const last = fmtTime(times[times.length - 1]);
  const when = first === last ? 'read ' + first : 'read between ' + first + ' and ' + last;
  $('gallery-sub').textContent =
    'Saved readings from one scan, ' + when + '. Opening one costs nothing and checks nothing again.';

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
 * The same shape the page draws, on the image that actually travels.
 *
 * It replaces the four evidence columns rather than joining them: for a
 * short, the bar says everything those columns said about coverage and says
 * the one thing they could not - that the matching assets are somebody
 * else's - so printing both would be printing it twice in a smaller font.
 */
function drawBreakdown(ctx, b, v, W) {
  const font = (weight, size) => weight + ' ' + size + 'px -apple-system, system-ui, "Segoe UI", sans-serif';
  const hasElsewhere = !!b.elsewhere;
  const left = 56;
  const barY = 386;
  const barH = 34;
  const barW = (hasElsewhere ? 0.58 : 1) * (W - 112);

  ctx.fillStyle = '#111111';
  ctx.font = font(700, 20);
  ctx.fillText(fmtUsd(b.headlineUsd) + ' ' + b.coin + ' ' + b.side, left, barY - 14);

  const fills = {
    covered: { fill: v.accent, alpha: 1 },
    unverified: { fill: v.accent, alpha: 0.35 },
    residual: { fill: '#e6e6e2', alpha: 1 },
  };
  const labels = {
    covered: 'covered by this address',
    unverified: 'could not identify',
    residual: 'nothing found against it',
  };

  let x = left;
  for (const seg of b.segments) {
    const w = Math.max(2, seg.share * barW);
    ctx.globalAlpha = fills[seg.kind].alpha;
    ctx.fillStyle = fills[seg.kind].fill;
    ctx.fillRect(x, barY, w, barH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#d9d9d6';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, barY + 0.5, w - 1, barH - 1);
    x += w;
  }

  b.segments.forEach((seg, i) => {
    const ly = barY + barH + 26 + i * 24;
    ctx.globalAlpha = fills[seg.kind].alpha;
    ctx.fillStyle = fills[seg.kind].fill;
    ctx.fillRect(left, ly - 11, 12, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 18);
    ctx.fillText(fmtUsd(seg.usd) + ' (' + fmtPct(seg.share) + ') ' + labels[seg.kind], left + 22, ly);
  });

  if (b.excessUsd > 0) {
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 18);
    ctx.fillText(
      'and ' + fmtUsd(b.excessUsd) + ' more held beyond the position: net long, not neutral',
      left,
      barY + barH + 26 + b.segments.length * 24,
    );
  }

  if (hasElsewhere) {
    const ex = left + barW + 40;
    const ew = W - 56 - ex;
    ctx.strokeStyle = '#8f8f8f';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left + barW + 4, barY + barH / 2);
    ctx.lineTo(ex - 6, barY + barH / 2);
    ctx.stroke();
    ctx.strokeRect(ex, barY, ew, barH);
    ctx.setLineDash([]);

    ctx.fillStyle = '#767676';
    ctx.font = font(400, 16);
    ctx.fillText('held elsewhere', ex, barY - 14);
    ctx.fillStyle = '#111111';
    ctx.font = font(700, 20);
    ctx.fillText(clipText(ctx, fmtUsd(b.elsewhere.usd), ew - 16), ex + 8, barY + barH / 2 + 7);
    ctx.fillStyle = '#555555';
    ctx.font = font(400, 16);
    ctx.fillText(
      clipText(ctx, 'in ' + plural(b.elsewhere.wallets, 'wallet') + ' that funded this account', ew),
      ex,
      barY + barH + 26,
    );
    ctx.fillText(clipText(ctx, 'ownership unverified, not counted', ew), ex, barY + barH + 48);
  }
}

/** The older layout, for a card with no bar to draw: a long, a book, an
 * account with nothing open. */
function drawEvidenceColumns(ctx, items, W, font) {
  const colW = (W - 112) / 4;
  items.forEach((item, i) => {
    const x = 56 + i * colW;
    const room = colW - 16;
    ctx.fillStyle = '#888888';
    ctx.font = font(400, 18);
    ctx.fillText(clipText(ctx, item.label, room), x, 432);
    ctx.fillStyle = '#111111';
    ctx.font = font(700, item.value.length > 14 ? 24 : 30);
    ctx.fillText(clipText(ctx, item.value, room), x, 470);
    ctx.fillStyle = '#aaaaaa';
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

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = v.accent;
  ctx.fillRect(0, 0, 12, H);

  ctx.fillStyle = v.accent;
  ctx.font = font(700, 28);
  ctx.fillText(badgeText(d).toUpperCase(), 56, 84);

  ctx.fillStyle = '#111111';
  ctx.font = font(700, 44);
  wrapText(ctx, headlineFor(d), 56, 146, W - 112, 52, 2);

  const share = cardShare(d, (d && d.__kind) || 'live');
  const b = d.breakdown && d.breakdown.applies && d.breakdown.segments.length ? d.breakdown : null;

  ctx.fillStyle = '#444444';
  ctx.font = font(400, 26);
  wrapText(ctx, d.summary || '', 56, 250, W - 112, 36, b ? 3 : 4);

  if (b) {
    drawBreakdown(ctx, b, v, W);
  } else {
    drawEvidenceColumns(ctx, share.evidence, W, font);
  }

  // A badge alone reads as a verdict with nothing behind it. What the check
  // could not read belongs on the picture, not only on the page it came from.
  ctx.fillStyle = '#767676';
  ctx.font = font(400, 18);
  ctx.fillText('What this reading could not cover', 56, 532);
  ctx.fillStyle = '#555555';
  ctx.font = font(400, 17);
  const limitsText = share.limits.join(' ') + (share.more > 0 ? ' (+' + share.more + ' more on the page)' : '');
  wrapText(ctx, limitsText, 56, 556, W - 112, 23, 3);

  // When and what of, printed on the image rather than left to the post it
  // is pasted into, plus the link back to this exact reading.
  ctx.fillStyle = '#999999';
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

$('copy-card').addEventListener('click', () => {
  if (!current) return;
  askForPicture(current);
  drawCard();
  const canvas = $('card-canvas');
  const btn = $('copy-card');
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy image'; }, 1500);
    } catch (e) {
      // A window opened from an awaited callback is popup-blocked silently, so
      // the fallback shows the image inline, where it cannot be blocked.
      canvas.hidden = false;
      btn.textContent = 'Right-click (or long-press) the image below to save it';
    }
  }, 'image/png');
});

// Copying to the clipboard is refused outright by some browsers and silently
// by others, so saving the file is offered as its own button rather than as
// a fallback nobody finds.
$('download-card').addEventListener('click', () => {
  if (!current) return;
  askForPicture(current);
  drawCard();
  $('card-canvas').toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bet-or-book-' + shortAddr(current.address).replace(/\W/g, '') + '.png';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'image/png');
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

$('copy-post').addEventListener('click', async () => {
  if (!current) return;
  askForPicture(current);
  const text = postText(current);
  const btn = $('copy-post');
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy post text'; }, 1500);
  } catch (e) {
    window.prompt('Copy this text:', text);
  }
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
    const b = el('button', 'chip', r.headline + ' · ' + v.label);
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
