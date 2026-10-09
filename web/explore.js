export function createExplore({$, el, verdictOf, badgeText, positionText, shortAddr, plural, fmtUsd, fmtPct, fmtTime, recordUsage, openSnapshot, getCurrent, publishGallery, timedFetch, VERDICTS, PAGE_SIZE, MATERIAL_GAP_SHARE}) {
let gallery=null; let galleryFilter="all"; let galleryShown=PAGE_SIZE;
function playerList() {
  return (gallery && gallery.featured) || [];
}

function renderPlayer() {
  const list = playerList();
  if (list.length === 0) return;
  const descriptions = {
    looks_like_a_bet: 'A concentrated directional position, with no visible offset found.',
    hedged: 'Matching holdings at this address cover the short.',
    unknown: 'The available evidence leaves an open question.',
    book: 'Orders on both sides of the market point to trading inventory.',
  };

  // Verdict and position are enough to scan an example. The full diagram
  // belongs to the opened reading, where its labels and evidence fit.
  const rows = list.map((e) => {
    const row = el('button', 'queue-row');
    row.append(
      el('strong', 'example-question', e.question || 'What does this position reveal?'),
      el('span', 'badge ' + verdictOf(e).cls, badgeText(e)),
      el('span', 'queue-pos', positionText(e)),
      el('span', 'example-note', e.description || descriptions[e.verdict.verdict]),
      el('span', 'example-date', 'Read ' + fmtTime(e.checkedAt)),
      el('span', 'example-open', 'Open the reading →'),
    );
    row.addEventListener('click', async () => {
      recordUsage('example_open');
      await openSnapshot(e.snapshotId);
      if (getCurrent() && getCurrent().snapshotId === e.snapshotId) {
        $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('card').focus({ preventScroll: true });
      }
    });
    return row;
  });
  const extra = el('details', 'fold deeper-example');
  extra.append(el('summary', null, 'More evidence cases'), ...rows.slice(3));
  $('player-queue').replaceChildren(...rows.slice(0, 3), ...(rows.length > 3 ? [extra] : []));
}

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
    await openSnapshot(e.snapshotId, 'push');
    if (getCurrent() && getCurrent().snapshotId === e.snapshotId) {
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
    title: 'Shorts with matching spot',
    note: 'Matching spot at the same address, ranked by closeness to the short’s size.',
    filter: (e) => e.verdict.verdict === 'hedged' && e.positions.headlineSide === 'short',
    sort: (a, b) => Math.abs(1 - a.hedgeRatio) - Math.abs(1 - b.hedgeRatio),
    stat: (e) => (e.hedgeRatio > 0 && e.hedgeRatio < 0.001 ? '<0.1%' : fmtPct(e.hedgeRatio)) + ' covered',
  },
  {
    title: 'Least covered shorts',
    note: 'Under 10% covered by this address, on a hedge search that ran to completion - the rest is still open.',
    // A ratio measured under a partial or missing read is a floor, not a
    // finding: it belongs nowhere near "least covered", which claims the
    // number is the whole story (25.09 audit, A01).
    filter: (e) => e.positions.headlineSide === 'short' && e.hedgeCoverage === 'complete' && e.hedgeDataQuality === 'measured' && e.hedgeRatio < MATERIAL_GAP_SHARE,
    sort: (a, b) => a.hedgeRatio - b.hedgeRatio,
    stat: (e) => (e.hedgeRatio > 0 && e.hedgeRatio < 0.001 ? '<0.1%' : fmtPct(e.hedgeRatio)) + ' covered',
  },
  {
    title: 'Market makers',
    note: "Book: the account quotes the position's own market on both sides.",
    filter: (e) => e.verdict.verdict === 'book' && !e.historical && Number.isFinite(e.headlineTwoSidedNotionalUsd),
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
    el('span', 'badge ' + verdictOf(e).cls + (e.historical ? ' historical' : ''), badgeText(e)),
    el('span', 'row-meta', board.stat(e) + ' · ' + shortAddr(e.address) + ' · ' + fmtTime(e.checkedAt) +
      (e.historical ? ' · earlier rules ' + (e.classifierVersion || 'v1') : ' · ' + e.classifierVersion)),
  );
  b.addEventListener('click', async () => {
    await openSnapshot(e.snapshotId, 'push');
    if (getCurrent() && getCurrent().snapshotId === e.snapshotId) {
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('card').focus({ preventScroll: true });
    }
  });
  li.append(b);
  return li;
}

function renderBoards(rows) {
  const box = $('boards');
  box.replaceChildren();
  for (const board of BOARDS) {
    const matches = rows.filter((e) => !e.historical && board.filter(e)).sort(board.sort).slice(0, BOARD_SIZE);
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
  const rows = [...gallery.currentRows, ...(gallery.featured || [])]
    .sort((a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd);
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
    const res = await timedFetch('/api/gallery');
    if (!res.ok) throw new Error('Gallery unavailable');
    gallery = await res.json();
    publishGallery(gallery);
  } catch (e) {
    $('examples-status').textContent = 'The full gallery could not load. You can still open these saved examples.';
    $('explore-status').textContent = 'Saved readings could not load. Reload the page to try again.';
    $('explore-return').hidden = !getCurrent();
    if (document.body.classList.contains('exploring')) (getCurrent() ? $('explore-return') : $('explore-home')).focus();
    return;
  }
  renderPlayer();
  $('case-study-list').replaceChildren(...(gallery.featured || []).slice(0, 8).map(e => {
    const article = el('div', 'box');
    const b = el('button', 'chip', positionText(e) + ' · Open saved reading');
    b.addEventListener('click', () => { recordUsage('example_open'); openSnapshot(e.snapshotId, 'push'); });
    article.append(el('h3', null, e.question || 'What does this position reveal?'), el('p', 'example-note', e.description || ''), el('p', 'example-date', 'Read ' + fmtTime(e.checkedAt)), b);
    return article;
  }));

  // An account can close its position between the ranking and its check;
  // with nothing open it is not one of the biggest positions any more.
  const open = (gallery.entries || [])
    .filter((e) => e.positions.nPositions > 0)
    .sort((a, b) => b.positions.headlineNotionalUsd - a.positions.headlineNotionalUsd);
  if (open.length === 0 && !(gallery.featured || []).length) {
    $('explore-status').textContent = 'No saved open positions are available yet.';
    return;
  }
  gallery.currentRows = open.filter((e) => !e.historical);
  gallery.historicalRows = open.filter((e) => e.historical);
  // gallery.featured (the four hand-picked demonstration readings) never
  // overlaps gallery.currentRows by address - the L03 fix already strips a
  // current row wherever a featured reading supersedes it - so this is a
  // plain concatenation, not a merge that needs de-duplicating.
  // Archived readings keep their own rules and explicit labels in every board.
  const boardRows = new Map();
  for (const row of [...gallery.historicalRows, ...gallery.currentRows, ...gallery.featured]) boardRows.set(row.address.toLowerCase(), row);
  const comparableRows = [...boardRows.values()].filter(e => !e.historical);
  renderBoards(comparableRows);

  // Cards are re-checked one at a time as credits allow, so the set can span
  // days. Showing one timestamp for all of them would be wrong.
  const times = comparableRows.map((e) => e.checkedAt).sort();
  const first = fmtTime(times[0]);
  const last = fmtTime(times[times.length - 1]);
  const when = first === last ? 'read ' + first : 'read between ' + first + ' and ' + last;
  $('gallery-sub').textContent =
    'Saved readings, ' + when + '. Opening one costs nothing and checks nothing again. ' +
    'Boards use comparable readings under current rules. Earlier readings are in the archive. These are dated readings, not a current market ranking.';

  const rows = gallery.currentRows;
  const counts = galleryCounts(rows);
  const betShare = rows.length ? Math.round((counts.looks_like_a_bet / rows.length) * 100) : 0;
  // "Of the N read", not "of the market": counts from one dated scan of a
  // set chosen a particular way, which is not a statistic about the market.
  $('gallery-stats').textContent =
    rows.length === 0
    ? 'The scan predates the current rules. Its readings remain in the archive below; the four examples were reinterpreted from newer observations.'
    : gallery.universe + '. Of the ' + rows.length + ' read by the current rules, ' +
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
  $('explore-status').hidden = true;
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


return {loadGallery, renderPlayer};
}
