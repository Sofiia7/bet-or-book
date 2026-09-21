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

const $ = (id) => document.getElementById(id);
let current = null;
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
};

const svgEl = (name, attrs, text) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
};

function renderBreakdown(d) {
  const b = d.breakdown;
  const box = $('breakdown');
  if (!b || !b.applies || !b.segments.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.style.setProperty('--accent', verdictOf(d).accent);

  const W = 640;
  const barY = 26;
  const barH = 34;
  const hasElsewhere = !!b.elsewhere;
  // The position keeps two thirds of the width whether or not anything is
  // drawn beside it, so two cards of the same size read as the same size.
  const barW = hasElsewhere ? W * 0.62 : W;
  const H = hasElsewhere ? 150 : 120;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.append(
    svgEl('title', {}, `${fmtUsd(b.headlineUsd)} ${b.coin} ${b.side}, and what was found against it`),
  );
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

  $('breakdown-svg').replaceChildren(svg);
  $('breakdown-caption').textContent = hasElsewhere
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
  const v = verdictOf(d);
  $('badge').textContent = badgeText(d);
  $('badge').className = 'badge ' + v.cls;
  $('headline').textContent = headlineFor(d);
  $('summary').textContent = d.summary || '';

  $('stats').replaceChildren(...(d.evidence || []).map((item) => {
    // The row the verdict turned on leads, rather than sitting fourth in a
    // line of identical tiles (audit U03).
    const box = el('div', 'stat' + (item.decisive ? ' decisive' : ''));
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value', item.value), el('div', 'stat-source', item.source));
    return box;
  }));

  renderPicker(d, kindOf(opts));
  renderBreakdown(d);

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

  const coverage = d.coverage || [];
  $('coverage').hidden = coverage.length === 0;
  $('coverage-list').replaceChildren(...coverage.map((c) => el('li', null, c)));

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
  $('copy-card').textContent = 'Copy card';
  $('card').hidden = false;
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

// Starting a check spends money, so it is a POST: a GET is something a
// crawler, a link preview or a browser prefetch can trigger on its own, and
// used to run the paid branch when they did.
async function load(url, onData, failureText, method, notice) {
  const seq = ++requestSeq;
  setBusy(true);
  // A notice about the input - "three addresses here, using the first" - is
  // about to be replaced by the progress line one statement later, which is
  // how it became unreadable. It travels with the request instead.
  setStatus((notice ? notice + ' ' : '') + 'Reading positions from Nansen and orders from Hyperliquid...', false);
  try {
    const res = await fetch(url, { method: method || 'GET' });
    const data = await res.json().catch(() => ({}));
    if (seq !== requestSeq) return;
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
      renderResult(data, { kind: 'saved' });
      showLink(id);
    },
    'That link points at a reading that is no longer saved. Check the address again to make a new one.',
  );
}

$('check').addEventListener('click', runCheck);
$('address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
$('check-live').addEventListener('click', () => {
  if (!current) return;
  $('address').value = current.address;
  runCheck();
});

// ---- gallery ----

/** Counts only cards the current rules actually read. A verdict from rules
 * that no longer exist is history, and adding it to today's tally is how the
 * page came to advertise seven hedged accounts that the current rules have
 * never judged (audit A06). */
function galleryCounts(entries) {
  const counts = { book: 0, hedged: 0, looks_like_a_bet: 0, unknown: 0, historical: 0 };
  for (const e of entries) {
    if (e.historical) counts.historical++;
    else counts[e.verdict.verdict] = (counts[e.verdict.verdict] || 0) + 1;
  }
  return counts;
}

function renderGallery() {
  const all = gallery.sorted;
  const counts = galleryCounts(all);
  const filters = [
    ['all', 'All ' + all.length],
    ['book', 'Book ' + counts.book],
    ['hedged', 'Hedged ' + counts.hedged],
    ['looks_like_a_bet', 'Looks like a bet ' + counts.looks_like_a_bet],
    ['unknown', 'Unknown ' + counts.unknown],
    ['historical', 'Earlier rules ' + counts.historical],
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

  const visible =
    galleryFilter === 'all'
      ? all
      : galleryFilter === 'historical'
        ? all.filter((e) => e.historical)
        : all.filter((e) => !e.historical && e.verdict.verdict === galleryFilter);
  $('gallery-list').replaceChildren(...visible.slice(0, galleryShown).map((e) => {
    const li = el('li');
    const b = el('button');
    const v = verdictOf(e);
    const badge = el('span', 'badge ' + v.cls, badgeText(e));
    // A verdict from rules that are no longer in force is labelled as one,
    // in the list as well as on the card.
    if (e.historical) {
      badge.classList.add('historical');
      badge.title = e.historical.reason;
    }
    const pnl = !e.pnl
      ? ''
      : e.pnl.closedTrades === 0
        ? 'no closed trades in 30d · '
        : 'PnL 30d ' + fmtUsd(e.pnl.realizedPnlUsd) + ' · ';
    b.append(
      el('span', 'rank', '#' + (all.indexOf(e) + 1)),
      el('span', 'pos', positionText(e)),
      badge,
      el(
        'span',
        'row-meta',
        pnl +
          plural(e.positions.nPositions, 'open position') +
          ' · ' +
          shortAddr(e.address) +
          (e.historical ? ' · read by earlier rules (' + (e.classifierVersion || 'v1') + ')' : ''),
      ),
    );
    b.addEventListener('click', () => {
      // Whatever check is in the air was about a different account. Let it
      // finish on the server - the credits are spent - and stop it from
      // landing on the card the reader just chose.
      takeOver();
      renderResult(e, { kind: 'gallery' });
      setStatus('', false);
      showLink(e.snapshotId);
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.append(b);
    return li;
  }));
  $('more').hidden = visible.length <= galleryShown;
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
  const entries = (gallery.entries || [])
    .filter((e) => e.positions.nPositions > 0)
    .sort((a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd);
  if (entries.length === 0) return;
  gallery.sorted = entries;
  const counts = galleryCounts(entries);
  const betShare = Math.round((counts.looks_like_a_bet / entries.length) * 100);
  // Cards are re-checked one at a time as credits allow, so the set can span
  // days. Showing one timestamp for all of them would be wrong.
  const times = entries.map((e) => e.checkedAt).sort();
  const first = fmtTime(times[0]);
  const last = fmtTime(times[times.length - 1]);
  const when = first === last ? 'checked ' + first : 'checked between ' + first + ' and ' + last;
  // "Of the N read", not "of the market". These are counts from one dated
  // scan of a set of accounts that was chosen a particular way, and saying
  // otherwise turns a sample into a statistic it cannot support.
  $('gallery-sub').textContent =
    gallery.universe + ', ' + when + '. Of the ' + entries.length + ' read, ' +
    counts.looks_like_a_bet + ' (' + betShare + '%) look like real bets and ' +
    (counts.book + counts.hedged) + ' are books or hedges. Pick one to see why.';
  $('gallery-method').textContent =
    'How these were picked: the top 3,000 accounts by value from the public leaderboard, ranked by the size of ' +
    'their largest main-dex position. Leverage breaks the link between what an account is worth and what it holds, ' +
    'a HIP-3-only account can fall out before it is ever checked, and the scan spent its last credits on the ' +
    'cheaper checks. These cards are saved readings, not live ones: opening one costs nothing and changes nothing.';
  $('gallery').hidden = false;
  renderGallery();
}

$('more').addEventListener('click', () => {
  galleryShown += PAGE_SIZE;
  renderGallery();
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

$('copy-card').addEventListener('click', () => {
  if (!current) return;
  drawCard();
  const canvas = $('card-canvas');
  const btn = $('copy-card');
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy card'; }, 1500);
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

loadGallery();
loadLedger();
const params = new URLSearchParams(window.location.search);
const saved = params.get('s');
const preset = params.get('address');
if (saved) {
  // A saved reading opens as itself. No check runs, so nothing is spent and
  // nothing can have changed between the link being written and read.
  openSnapshot(saved);
} else if (preset) {
  $('address').value = preset;
  runCheck();
}
