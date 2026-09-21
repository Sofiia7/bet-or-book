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

/** What this rendering is: a live check, a saved reading or a gallery card. */
function kindOf(opts) {
  return (opts && opts.kind) || 'live';
}

function renderResult(d, opts) {
  current = d;
  const v = verdictOf(d);
  $('badge').textContent = badgeText(d);
  $('badge').className = 'badge ' + v.cls;
  $('headline').textContent = headlineFor(d);
  $('summary').textContent = d.summary || '';

  $('stats').replaceChildren(...(d.evidence || []).map((item) => {
    const box = el('div', 'stat');
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value', item.value), el('div', 'stat-source', item.source));
    return box;
  }));

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

function galleryCounts(entries) {
  const counts = { book: 0, hedged: 0, looks_like_a_bet: 0, unknown: 0 };
  for (const e of entries) counts[e.verdict.verdict] = (counts[e.verdict.verdict] || 0) + 1;
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
  ];
  $('chips').replaceChildren(...filters.map(([key, label]) => {
    const b = el('button', 'chip', label);
    b.setAttribute('aria-pressed', String(galleryFilter === key));
    b.addEventListener('click', () => {
      galleryFilter = key;
      galleryShown = PAGE_SIZE;
      renderGallery();
    });
    return b;
  }));

  const visible = galleryFilter === 'all' ? all : all.filter((e) => e.verdict.verdict === galleryFilter);
  $('gallery-list').replaceChildren(...visible.slice(0, galleryShown).map((e) => {
    const li = el('li');
    const b = el('button');
    const v = verdictOf(e);
    const badge = el('span', 'badge ' + v.cls, badgeText(e));
    const pnl = !e.pnl
      ? ''
      : e.pnl.closedTrades === 0
        ? 'no closed trades in 30d · '
        : 'PnL 30d ' + fmtUsd(e.pnl.realizedPnlUsd) + ' · ';
    b.append(
      el('span', 'rank', '#' + (all.indexOf(e) + 1)),
      el('span', 'pos', positionText(e)),
      badge,
      el('span', 'row-meta', pnl + plural(e.positions.nPositions, 'open position') + ' · ' + shortAddr(e.address)),
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

/** The caveats that have to survive being turned into an image, because a
 * shared picture travels without the page around it. */
function cardLimits(d) {
  const notes = (d.coverage || []).slice();
  const shown = notes.slice(0, 2).join('; ');
  const more = notes.length > 2 ? ' (+' + (notes.length - 2) + ' more on the page)' : '';
  return notes.length === 0 ? 'Everything this tool reads was read in full.' : shown + more;
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

  ctx.fillStyle = '#444444';
  ctx.font = font(400, 26);
  wrapText(ctx, d.summary || '', 56, 250, W - 112, 36, 4);

  const items = (d.evidence || []).slice(0, 4);
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

  // A badge alone reads as a verdict with nothing behind it. What the check
  // could not read belongs on the picture, not only on the page it came from.
  ctx.fillStyle = '#767676';
  ctx.font = font(400, 19);
  ctx.fillText('What this reading could not cover', 56, 552);
  ctx.fillStyle = '#555555';
  ctx.font = font(400, 19);
  wrapText(ctx, cardLimits(d), 56, 578, W - 112, 26, 2);

  const asOf = d.positionsAsOf && fmtTime(d.positionsAsOf) !== fmtTime(d.checkedAt)
    ? ' · positions as of ' + fmtTime(d.positionsAsOf)
    : '';
  const rules = d.classifierVersion ? ' · rules ' + d.classifierVersion : '';
  ctx.fillStyle = '#999999';
  ctx.font = font(400, 18);
  ctx.fillText(
    clipText(ctx, 'Bet or Book · ' + shortAddr(d.address) + ' · checked ' + fmtTime(d.checkedAt) + asOf + rules, W - 400),
    56,
    H - 40,
  );
  ctx.textAlign = 'right';
  ctx.fillText(d.source === 'nansen' ? 'Powered by Nansen API' : 'Data: Hyperliquid API', W - 56, H - 40);
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
