import {createConstellation} from "./constellation.js";
import {createShareCard} from "./share-card.js";
import {createExplore} from "./explore.js";
import { savedReadingLink, readingCopyText, readingPostText } from '../src/engine/shareText.ts';
import { advanceSavedReading } from '../src/engine/savedReading.ts';
import { CLAIMS, checkClaim, isClaim } from '../src/engine/claims.ts';
import { createMonitoring } from './monitor.js';
import { formatUsd as usd } from '../src/engine/evidence.ts';
import { timedFetch } from './transport.js';
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const usageEntry = new URLSearchParams(window.location.search).has('s') ? 'shared_link' : 'home';
const usageReadings = new Set();
let returningReader = false;
try { returningReader = localStorage.getItem('betOrBook:hasRead') === '1'; } catch {}
let repeatRecorded = false;
let usageSent = 0;
function recordUsage(action, d) {
  // Test traffic and the operator's own checks are not product engagement.
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)
    || window.location.hash === '#operator' || operatorKey() || usageSent >= 25) return;
  usageSent++;
  timedFetch('/api/events', { method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, kind: d && d.__kind || 'none', entry: usageEntry, incomplete: !!(d && d.degraded) }),
  }).catch(() => {});
}
const EXPLORERS = {
  arbitrum: 'https://arbiscan.io/address/',
  ethereum: 'https://etherscan.io/address/',
  hyperevm: 'https://hyperevmscan.io/address/',
  solana: 'https://solscan.io/account/',
};
const VERDICTS = {
  book: { label: 'Book', cls: 'book', headline: 'Market-making evidence in this position’s market.', accent: '#7fa2ff' },
  hedged: { label: 'Spot-covered short', cls: 'hedged', headline: 'The offsetting asset is in this same account.', accent: '#4fe0b0' },
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
const PAGE_SIZE = 25;

const $ = (id) => document.getElementById(id);
let current = null;
let pendingGuess = null;
let guessRevealTimer = null;
let gallery = null;



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
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}
/** The day alone, "07 Oct" or "26 Sept" (UTC), as an example card's footer
 * gives it. The months are spelled out here rather than left to the
 * browser's Intl data, whose short months differ between versions ("Sep",
 * "Sept"): src/landing.ts draws the server's card with the same table, and
 * the two cards must read the same. */
function fmtDay(iso) {
  const d = new Date(iso);
  return String(d.getUTCDate()).padStart(2, '0') + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}
function verdictOf(d) {
  return VERDICTS[d.verdict.verdict] || VERDICTS.unknown;
}
function badgeText(d) {
  const base = verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
  return d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base;
}
// The warning over a reading whose sources did not all answer, and whether the
// page treats it as the case where live coverage is out altogether. A note the
// server wrote about Nansen is shown as it stands: "stopped partway" is the
// one where some of it was read, so the "unavailable" sentence, which says
// none was, never replaces it.
//
// A reading made after positions were read from every Hyperliquid dex carries
// positionsVenues, and its source is 'hyperliquid' also when Nansen was
// never asked (every check the site starts leaves context off). It says
// nothing then about a Nansen read, so without a Nansen note the warning is
// the first note that says something failed, or the generic line. A reading
// stored before has only source, which then did mean Nansen was asked and
// did not answer, and keeps the old sentence.
function sourceWarning(d) {
  const note = (d.coverage || []).find(line => /Nansen not used|Nansen stopped partway|Nansen did not answer|Nansen could not complete/.test(line));
  let text;
  if (note) {
    text = note;
  } else if (d.positionsVenues) {
    const failed = (Array.isArray(d.coverageNotes) ? d.coverageNotes : []).find(n => n && n.failure);
    text = failed ? failed.text : 'Incomplete reading · some sources could not be read.';
  } else {
    text = d.source === 'hyperliquid'
      ? 'Hyperliquid positions only · balances on other chains and linked wallets could not be read.'
      : 'Incomplete reading · some sources could not be read.';
  }
  const unavailable = /credits|budget|no API key configured/.test(note || '');
  // A known-tokens reading read the balances on other chains from public
  // nodes, with or without Nansen; only the links between wallets are missing.
  if (unavailable && !/Nansen stopped partway/.test(note)) {
    text = d.hedgeScope === 'known-tokens'
      ? 'Full live coverage is temporarily unavailable. Linked wallets were not read, so this reading does not settle the wallet’s exposure.'
      : 'Full live coverage is temporarily unavailable. This reading covers Hyperliquid positions only; balances on other chains and linked wallets were not read, so it does not settle the wallet’s exposure.';
  }
  return { text, unavailable };
}
// Where the positions of a reading came from, for the line under it. A reading
// made after positions were read from every Hyperliquid dex carries how many
// were asked and answered; one stored before has only `source`, which then
// said whether Nansen or Hyperliquid's own endpoint supplied them, and keeps it.
function positionsSource(d) {
  const v = d.positionsVenues;
  // Without the list of dexes only the main one was asked, so "1 of 1" would
  // read as everything.
  if (v && v.registryRead === false) return 'positions from Hyperliquid, main dex only (dex list not read)';
  if (v) return 'positions from Hyperliquid, ' + v.answered + ' of ' + v.asked + (v.asked === 1 ? ' dex' : ' dexes');
  return d.source === 'nansen' ? 'positions from Nansen' : 'positions from Hyperliquid main dex';
}
// The meta line's count of Nansen calls. A reading made now makes none and
// says nothing about Nansen; a reading made with Nansen (or an older one that
// recorded calls) keeps its line exactly.
function nansenCallsNote(d) {
  if (typeof d.nansenCalls !== 'number') return '';
  if (d.nansenCalls === 0 && d.source !== 'nansen') return '';
  return ' · ' + plural(d.nansenCalls, 'Nansen API call');
}
// Whether a reading was made since the funding links moved to the Blockscout
// explorer: its scope is known-tokens, or it carries positionsVenues and a
// source other than Nansen. The same rule the server uses (src/engine/evidence.ts,
// madeWithExplorer), and not `source` alone: the old Worker said 'hyperliquid'
// whenever the Nansen positions call had not succeeded, and such a reading can
// still carry funders, which came from Nansen.
function madeWithExplorer(d) {
  return d.hedgeScope === 'known-tokens' || (d.positionsVenues !== undefined && d.source !== 'nansen');
}
// Who the linked wallets are credited to, under the list of funders. A reading
// made with Nansen keeps its Nansen sentence; one made since took the links
// from the Blockscout explorer and the balances from public nodes.
function fundersCredit(d) {
  const who = madeWithExplorer(d) ? 'Blockscout (funding links) and public nodes (balances)' : 'Powered by Nansen API';
  return 'Linked wallets: ' + who + '. Funding links are observed; common ownership is unverified.';
}
// The source printed on the "Held elsewhere" tile: the same as the server gives
// the "Linked wallets" row (src/engine/evidence.ts, linkedItem).
function elsewhereSource(d) {
  return (madeWithExplorer(d) ? 'Explorer + On-chain' : 'Nansen') + ' · ownership unverified';
}
function headlineFor(d) {
  if ((d.verdict.reasons || []).includes('positions_stale')) return 'The position data is out of date for this check.';
  if (d.headline) return d.headline;
  if (d.positions.nPositions === 0) return d.positionsCoverage === 'complete'
    ? 'No open positions found in this reading.'
    : 'No positions found on the checked venues. Other venues are unverified.';
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
/** A reading's name in two parts: the amount, and the asset with its side
 * ("$122.1M", "HYPE long"). Pure, so test/web-screens.test.ts runs it. */
function readingTitleParts(d) {
  const p = d && d.positions;
  if (!p || !p.nPositions) return { amount: 'No open positions', assetSide: '' };
  return { amount: fmtUsd(p.headlineNotionalUsd), assetSide: p.headlineCoin + ' ' + p.headlineSide };
}
/** The same name on one line, as the breadcrumb shows it. */
function readingTitle(d) {
  const t = readingTitleParts(d);
  return t.assetSide ? t.amount + ' ' + t.assetSide : t.amount;
}

// ---- which screen is showing ----
//
// Four screens: Check, a reading, Explore and Saved. A reading also knows
// the screen it was opened from: that tab stays lit in the header, and the
// breadcrumb leads back to it. The two helpers below decide what the frame
// shows and touch no DOM, so test/web-screens.test.ts runs them on their own;
// setScreen() and renderSavedCount() apply what they say.

/** The active header tab and the breadcrumb for a screen. `from` only
 * matters for a reading; anything that is not Explore or Saved (a link
 * opened cold included) counts as Check. */
function screenState(screen, from, title) {
  const labels = { check: 'Check a wallet', explore: 'Explore', saved: 'Saved' };
  if (screen === 'reading') {
    const origin = from === 'explore' || from === 'saved' ? from : 'check';
    return { activeTab: origin, breadcrumb: { originLabel: labels[origin], originScreen: origin, current: title || '' } };
  }
  if (screen === 'explore' || screen === 'saved') {
    return { activeTab: screen, breadcrumb: { originLabel: labels.check, originScreen: 'check', current: labels[screen] } };
  }
  return { activeTab: 'check', breadcrumb: null };
}
/** The Saved tab's badge text, or null when there is nothing to count. */
function savedCountBadge(n) {
  return n > 0 ? String(n) : null;
}
/**
 * The screen a reading about to show counts as opened from.
 *
 * - `historyFrom`: the origin stored with the reading's own history entry
 *   (the browser's Back and Forward), or one worked out for that move. It
 *   wins: the entry knows where the reading came from, whatever screen is
 *   being left now.
 * - `sameReading` (the reading on show coming back, as with "Back to your
 *   reading") or `showing === 'reading'` (a reading redrawn in place: Check
 *   live, Try again, another of its positions): the kept origin,
 *   `keptFrom`, stays.
 * - Otherwise the screen it was opened on, `showing`. A history move with
 *   nothing stored passes no `showing` and so counts as Check, like a link
 *   opened cold.
 */
function readingOrigin({ showing, keptFrom, sameReading, historyFrom }) {
  const isOrigin = (s) => s === 'check' || s === 'explore' || s === 'saved';
  if (isOrigin(historyFrom)) return historyFrom;
  if ((sameReading || showing === 'reading') && isOrigin(keptFrom)) return keptFrom;
  return showing === 'explore' || showing === 'saved' ? showing : 'check';
}
/** Whether a screen change takes the page to its top and focus to the new
 * heading. Every one does, except the same account's reading redrawn in
 * place, where the reader stays where they were. `prev` and `next` are
 * `{ screen, reading }`, `reading` being the address of the reading shown. */
function movesToTop(prev, next) {
  return !(prev.screen === 'reading' && next.screen === 'reading' && !!next.reading && prev.reading === next.reading);
}
/** The screen the reading on show was opened from: 'check', 'explore' or
 * 'saved'. Also on body[data-from] while a reading is showing, and in the
 * reading's history entry (showLink). */
let readingFrom = 'check';
/** The address of the reading last put on the reading screen. */
let readingOnShow = null;
/**
 * Puts the frame in step with the screen now showing: body[data-screen]
 * (and body[data-from] on a reading), the lit header tab, the breadcrumb.
 * Every screen change ends here and starts at the top with focus on the
 * new screen's heading (on a reading, its title) - except a reading redrawn
 * in place (movesToTop).
 */
function setScreen(screen, from) {
  const state = screenState(screen, screen === 'reading' ? from : readingFrom, screen === 'reading' && current ? readingTitle(current) : '');
  const prev = { screen: document.body.dataset.screen, reading: readingOnShow };
  const next = { screen, reading: screen === 'reading' && current ? current.address : null };
  if (screen === 'reading') readingFrom = state.breadcrumb.originScreen;
  readingOnShow = next.reading;
  document.body.dataset.screen = screen;
  if (screen === 'reading') document.body.dataset.from = readingFrom;
  else delete document.body.dataset.from;
  // On a reading the lit tab is where it came from, not the page showing:
  // "true" marks it as the current item of the set, and the breadcrumb's
  // last item stays the one "page".
  for (const [tab, id] of [['check', 'nav-examples'], ['explore', 'nav-boards'], ['saved', 'nav-saved']]) {
    if (tab === state.activeTab) $(id).setAttribute('aria-current', screen === 'reading' ? 'true' : 'page');
    else $(id).removeAttribute('aria-current');
  }
  const crumb = state.breadcrumb;
  $('breadcrumb').hidden = !crumb;
  if (crumb) {
    $('breadcrumb-origin').dataset.screen = crumb.originScreen;
    $('breadcrumb-origin').setAttribute('href', crumb.originScreen === 'check' ? '/' : '#' + crumb.originScreen);
    $('breadcrumb-origin-label').textContent = crumb.originLabel;
    $('breadcrumb-current').textContent = crumb.current;
  }
  if (!movesToTop(prev, next)) return;
  window.scrollTo(0, 0);
  const heading = screen === 'reading' ? $('reading-title')
    : screen === 'explore' ? $('explore-title')
      : screen === 'saved' ? $('saved-title')
        : $('hero-title');
  heading.focus({ preventScroll: true });
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
  // Explore and Saved hide the Check screen's line with the rest of it, so
  // each repeats it: "Turn Monitor off before removing" is said on Saved.
  for (const mirror of [$('explore-reading-status'), $('saved-status')]) {
    mirror.textContent = text;
    mirror.className = s.className;
    mirror.hidden = !text;
  }
}

/**
 * What moved between this reading and the one it replaced.
 *
 * Nothing is fetched to answer it beyond the comparison itself, which is
 * made out of two readings that already exist. The line that matters is the
 * attribution: "the reading changed" and "the rules changed" are two
 * different pieces of news and a card cannot leave the reader to guess.
 */
const compareCache = new Map();
let pendingClaim = new URLSearchParams(window.location.search).get('claim');
function renderClaim(d) {
  const params = new URLSearchParams(window.location.search);
  const choice = pendingClaim || (params.get('s') === d.snapshotId ? params.get('claim') : null);
  pendingClaim = null;
  $('claim-choice').value = isClaim(choice) ? choice : '';
  $('claim-checker').open = isClaim(choice);
  // The checker sits in Full analysis: a link that asks about an assertion
  // opens both, or the answer it asked for would be two clicks away.
  if (isClaim(choice)) $('full-analysis').open = true;
  $('claim-result').hidden = !isClaim(choice);
  if (isClaim(choice)) {
    const result = checkClaim(d, choice);
    $('claim-result').textContent = result.status + ': ' + result.explanation;
  }
}
$('claim-choice').addEventListener('change', () => {
  if (!current) return;
  const choice = $('claim-choice').value;
  $('claim-result').hidden = !isClaim(choice);
  if (isClaim(choice)) {
    const result = checkClaim(current, choice);
    $('claim-result').textContent = result.status + ': ' + result.explanation;
  }
  if (current.snapshotId) showLink(current.snapshotId);
});
async function renderChanged(d) {
  const box = $('changed');
  box.hidden = true;
  const saved = savedRowFor(d);
  const previousId = previousReadingId(d, saved && saved.previousSnapshotId);
  if (!previousId) return;
  const comparisonKey = previousId + ':' + d.snapshotId;
  $('changed-list').replaceChildren();
  $('changed-title').textContent = saved?.previousSnapshotId ? 'Since your previous saved reading' : 'Since the previous reading';
  $('changed-because').textContent = 'Comparing saved evidence…';
  $('changed-previous').href = '/?s=' + encodeURIComponent(previousId);
  box.hidden = false;
  let c;
  try {
    c = compareCache.get(comparisonKey);
    if (!c) {
      const res = await timedFetch('/api/compare?a=' + encodeURIComponent(previousId) + '&b=' + encodeURIComponent(d.snapshotId));
      if (!res.ok) throw new Error('Comparison unavailable');
      c = await res.json();
      if (compareCache.size >= 20) compareCache.delete(compareCache.keys().next().value);
      compareCache.set(comparisonKey, c);
    }
  } catch {
    if (current === d) $('changed-because').textContent = 'Comparison unavailable. The previous link may have expired; this does not mean the position stayed the same.';
    return;
  }
  // The card may have moved on while this was in the air.
  if (current !== d) return;
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
  box.hidden = false;
  $('changed-title').textContent = 'What changed since ' + fmtTime(c.from.observedAt);
  // A grade is part of the answer: "Book (strong)" to "Book (likely)" is a
  // change, and "did not change" under two different versions of the rules
  // says so rather than reading as the same rules agreeing twice.
  const named = (verdict, strength, qualifier) => (VERDICTS[verdict] || VERDICTS.unknown).label + (strength ? ' (' + strength + ')' : '') + (qualifier ? ' · ' + qualifier : '');
  const vc = c.verdictChange;
  $('changed-because').textContent = vc
    ? named(vc.from, vc.fromStrength, vc.fromQualifier) === named(vc.to, vc.toStrength, vc.toQualifier)
      ? 'The conclusion stayed the same, but its supporting evidence changed because ' + vc.because + '.'
      : 'The answer went from "' + named(vc.from, vc.fromStrength, vc.fromQualifier) + '" to "' + named(vc.to, vc.toStrength, vc.toQualifier) +
        '" because ' + vc.because + '.'
    : c.rulesChanged
      ? 'The answer did not change, though the rules reading it did (' + c.from.classifierVersion + ' to ' +
        c.to.classifierVersion + ').'
      : c.changes.length ? 'The answer did not change.' : 'No material changes detected in the compared evidence. This is not a live monitor.';
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
  const makeChip = (c) => {
      const active = c.coin === d.positions.headlineCoin && c.side === d.positions.headlineSide;
      const b = el('button', 'chip', fmtUsd(c.sizeUsd) + ' ' + c.coin + ' ' + c.side);
      b.setAttribute('aria-pressed', String(active));
      if (!active) b.title = 'Check this position instead - a new reading of this address';
      b.disabled = active;
      b.addEventListener('click', () => checkPosition(d.address, c));
      return b;
    };
  $('picker-chips').replaceChildren(...list.slice(0, 5).map(makeChip));
  if (list.length > 5) {
    const more = el('details', 'fold');
    more.append(el('summary', null, 'All ' + list.length + ' positions · selecting one runs a new check'));
    const search = el('input'); search.type = 'search'; search.placeholder = 'Find an asset';
    search.setAttribute('aria-label', 'Find an open position by asset');
    const choices = el('div', 'picker-chips');
    const show = () => choices.replaceChildren(...list.filter(c => c.coin.toLowerCase().includes(search.value.trim().toLowerCase())).map(makeChip));
    search.addEventListener('input', show); show(); more.append(search, choices); $('picker-chips').append(more);
  }
}

// The least-covered board uses the classifier's material-coverage boundary.
// test/web-app-verdict-sync.test.ts checks this real filter, not dead constants.
const MATERIAL_GAP_SHARE = 0.1;

// ---- the reading screen ----
//
// A reading is a header (the date, the position, Save / Share / Check live)
// and six numbered sections: Verdict, Evidence, Since last read, Blind spots,
// Spot coverage and Full analysis, then the "What next?" panel. A section
// with nothing to show is hidden, and the CSS counter that numbers them
// skips it, so the numbers stay consecutive. The helpers below decide what
// each section has from the reading alone and touch no DOM, so
// test/web-reading.test.ts runs them on stored readings; renderResult and
// the render* functions it calls fill the sections by the same rules.

/** What the Spot coverage illustration draws: a book's matched quotes
 * ('book'), a long, which spot holdings cannot offset ('long'), what covers
 * a short ('cover'), or nothing at all (null). */
function breakdownKind(d) {
  const b = d.breakdown;
  if (d.verdict.verdict === 'book' && d.orders) return Number.isFinite(d.orders.headlineTwoSidedNotionalUsd) ? 'book' : null;
  if ((!b || !b.applies) && d.positions.nPositions > 0 && d.positions.headlineSide === 'long') return 'long';
  return b && b.applies && b.segments.length ? 'cover' : null;
}
/** The earlier reading "Since last read" compares this one with: the one a
 * saved position kept (`savedPreviousId`), else the one this reading
 * replaced. Null when there is none, or when this reading itself was not
 * saved and so cannot be compared. */
function previousReadingId(d, savedPreviousId) {
  const previousId = savedPreviousId || d.supersedes;
  if (!previousId || !d.snapshotId || d.snapshotSaved === false || previousId === d.snapshotId) return null;
  return previousId;
}
/**
 * The Evidence section's tiles: the row the verdict turned on, then one
 * more, at most three in all.
 *
 * The decisive number leads the card on its own (25.09 audit, the "hero
 * numbers" redesign) - it is no longer suppressed just because the diagram
 * repeats the same fact. That is a real tradeoff, not a settled one: in most
 * cases the tile and the diagram do say the same thing twice, and the
 * diagram is kept anyway as the visual backup for that repetition.
 * drawCard() and the OG preview use the diagram or a decisive tile, while
 * the interactive card can show both.
 */
function heroTilesFor(d) {
  const heroTiles = (d.evidence || []).filter((item) => item.decisive).slice(0, 2);
  // A reason of linked_exposure_unverified already put the funders' figure
  // into heroTiles above, as the "Linked wallets" evidence tile (src/engine
  // /evidence.ts's DECISIVE_LABEL_BY_REASON) built from this same linkedHedge
  // data. Pushing the elsewhere tile too would show the identical dollar
  // amount and wallet count twice in a row (confirmed against the stored
  // 34stjd0gtgkz1 reading, $395.8M in 2 wallets, in data/featured.json).
  const alreadyShowsFunderHoldings = (d.verdict.reasons || []).includes('linked_exposure_unverified');
  if (alreadyShowsFunderHoldings && heroTiles.length < 2) {
    const ownSpot = (d.evidence || []).find(item => item.label === 'Hedge found');
    if (ownSpot) heroTiles.push(ownSpot);
  }
  if (d.breakdown && d.breakdown.elsewhere && !alreadyShowsFunderHoldings) {
    heroTiles.push({
      label: 'Held elsewhere',
      value: fmtUsd(d.breakdown.elsewhere.usd) + ' in ' + plural(d.breakdown.elsewhere.wallets, 'wallet') + ' that funded this account',
      source: elsewhereSource(d),
      decisive: true,
    });
  }
  for (const item of (d.evidence || [])) {
    if (heroTiles.length >= 2) break;
    if (['Largest position', 'Position asked about', 'Share of exposure'].includes(item.label)) continue;
    if (!heroTiles.some((shown) => shown.label === item.label)) heroTiles.push(item);
  }
  return heroTiles;
}
/** Leverage and distance to liquidation, the two position figures Blind
 * spots previews. */
function riskItems(d) {
  return (d.vitals || []).filter(item => /leverage|liquidation/i.test(item.label)).slice(0, 2);
}
/** The reading's coverage notes in two lists. A source that failed cost
 * this answer something, so it stays in sight in Blind spots (`failures`);
 * a note that only describes what was found goes one click down, in Full
 * analysis (`remarks`). A reading saved before notes said which kind they
 * were keeps every one of them in sight, the cautious way round. */
function coverageLists(d) {
  const flagged = Array.isArray(d.coverageNotes) ? d.coverageNotes : [];
  const notes = [
    ...flagged,
    ...(d.coverage || [])
      .filter((text) => !flagged.some((n) => n.text === text))
      .map((text) => ({ text, failure: true })),
  ];
  return {
    failures: notes.filter((n) => n.failure).map((n) => n.text),
    remarks: notes.filter((n) => !n.failure).map((n) => n.text),
  };
}
/** Whether the open question already names all three things the standing
 * limit lists: exchanges, OTC deals and unlinked wallets. */
function repeatsStandingLimit(question) {
  const q = (question || '').toLowerCase();
  return /exchange/.test(q) && /over.the.counter|otc/.test(q) && /wallet/.test(q) && /link/.test(q);
}
/**
 * Which parts of Blind spots show. The standing limit ("Not visible to this
 * tool: ...") is true of every reading, so it goes with the reading's own
 * blind spots: beside them, unless the open question already says it, and
 * in Full analysis (#analysis-limit) when the reading has none of its own -
 * a reading with no open position, say. Either way it shows once.
 */
function blindSpotParts(d) {
  const parts = {
    openQuestion: !!d.openQuestion,
    whatChanges: !!d.whatChanges,
    standingLimit: false,
    risks: riskItems(d).length > 0,
    notRead: coverageLists(d).failures.length > 0,
  };
  parts.standingLimit = (parts.openQuestion || parts.whatChanges || parts.risks || parts.notRead) && !repeatsStandingLimit(d.openQuestion);
  return parts;
}
/** Which of the six sections have something to show. `savedPreviousId` is
 * the earlier reading a saved position kept (previousReadingId). The
 * Evidence section's Nansen line (#nansen-preview) is always hidden, so the
 * tiles alone decide it. */
function readingSections(d, savedPreviousId) {
  const blind = blindSpotParts(d);
  return {
    verdict: true,
    evidence: heroTilesFor(d).length > 0,
    changed: previousReadingId(d, savedPreviousId) !== null,
    blindSpots: blind.openQuestion || blind.whatChanges || blind.standingLimit || blind.risks || blind.notRead,
    coverage: breakdownKind(d) !== null,
    analysis: true,
  };
}
/** How many columns the Evidence panel uses for `n` tiles when at most
 * `maxColumns` fit: the most that fill every row, so the last row is never
 * short (4 tiles go 4 or 2 across, never 3 and 1; 3 tiles go 3 across or
 * one under another). */
function statColumns(n, maxColumns) {
  const count = Math.floor(n);
  const max = Math.floor(maxColumns);
  if (!(count >= 1) || !(max >= 1)) return 1;
  for (let columns = Math.min(count, max); columns > 1; columns--) {
    if (count % columns === 0) return columns;
  }
  return 1;
}
/** The "What next?" panel's way back, to the screen the reading was opened
 * from, in the breadcrumb's own words (screenState), so the two always
 * name the same place; anything else counts as Check. */
function backLabel(from) {
  return 'Back to ' + screenState('reading', from, '').breadcrumb.originLabel;
}
/** Whether the "The position asked about ..." line shows under the header:
 * only when a position was asked about and the picker is not already
 * saying which. Otherwise it would only repeat the title and the address. */
function subjectVisible(d, pickerShown) {
  return !pickerShown && !!(d && d.focus);
}
/** What a key press does to the Share menu: Escape closes it while open. */
function shareMenuAction(key, isOpen) {
  return isOpen && (key === 'Escape' || key === 'Esc') ? 'close' : 'none';
}
/**
 * The Share dropdown: a native <details> (`share`) whose <summary>
 * (`toggle`) opens it with a click, Enter or Space. It closes when an item
 * in `menu` is chosen, on Escape, on a click outside it and when focus
 * leaves it for another control. After a choice or Escape, focus goes back
 * to the summary rather than to the page the hidden item would leave it on.
 */
function setUpShareMenu(share, toggle, menu, doc) {
  const close = (focusToggle) => {
    share.open = false;
    if (focusToggle) toggle.focus();
  };
  menu.addEventListener('click', (event) => {
    if (share.open && event.target.closest('button')) close(true);
  });
  doc.addEventListener('click', (event) => {
    if (share.open && !share.contains(event.target)) close(false);
  });
  doc.addEventListener('keydown', (event) => {
    if (shareMenuAction(event.key, share.open) === 'close') close(true);
  });
  share.addEventListener('focusout', (event) => {
    if (share.open && event.relatedTarget && !share.contains(event.relatedTarget)) close(false);
  });
}

function renderBreakdown(d) {
  const box = $('breakdown');
  const kind = breakdownKind(d);
  box.hidden = kind === null;
  if (kind === null) return;
  const isBook = kind === 'book';
  const isLong = kind === 'long';
  const b = d.breakdown;

  // Sourced from `d.positions`, never from `b`, even when not isBook: an
  // ancient stored reading from before `breakdown` existed at all can have
  // `b === undefined` while still being a long position worth a
  // constellation diagram (`isLong` only requires `!b || !b.applies`) -
  // reading `b.coin` there would throw.
  const coin = d.positions.headlineCoin;
  const side = d.positions.headlineSide;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '210px';
  canvas.style.display = 'block';
  const inputs = constellationInputsFor(d);
  const qualityNote = constellationQualityNoteFor(d);
  const statBox = el('div', 'constellation-stat');
  statBox.append(
    el('div', 'constellation-stat-value', constellationStatFor(d, inputs)),
    el('div', 'constellation-stat-label', constellationStatLabelFor(d)),
  );
  if (qualityNote) statBox.append(el('div', 'quality-flag', constellationQualityFlagFor(d)));
  $('breakdown-svg').replaceChildren(canvas, statBox);
  $('breakdown-quality').hidden = !qualityNote;
  $('breakdown-quality').textContent = qualityNote || '';
  drawConstellation(canvas, { ...inputs, mini: false });
  canvas.setAttribute('aria-hidden', 'true');

  $('breakdown-caption').textContent = isBook
    ? `What stands behind the ${coin} ${side}`
    : isLong
      ? `Spot holdings cannot offset this ${coin} ${side}`
      : b && b.elsewhere
        ? `What stands against the ${coin} ${side} - and what only looks like it does`
        : `What stands against the ${coin} ${side}`;
  $('diagram-legend').textContent = isBook
    ? 'Illustration of quoting: matched buy and sell orders in this market. This is evidence of market-making activity, not proof of intent.'
    : isLong
      ? 'Spot coverage does not apply to a long. This illustration is not a transaction network.'
      : 'Illustration of coverage, not a transaction network. Own matching holdings count; funding-wallet holdings do not prove ownership.';
  $('diagram-values').textContent = 'Position: ' + fmtUsd(d.positions.headlineNotionalUsd) +
    (isBook ? ' · Matched quotes: ' + fmtUsd(d.orders.headlineTwoSidedNotionalUsd)
      : isLong ? '' : ' · Own matching holdings: ' + fmtUsd(d.hedge.hedgeUsd) +
        (b && b.elsewhere ? ' · Funders: ' + fmtUsd(b.elsewhere.usd) + ' (ownership unverified)' : ''));
}

/** What this rendering is: a live check, a saved reading or a gallery card. */
function kindOf(opts) {
  return (opts && opts.kind) || 'live';
}

function renderResult(d, opts) {
  // Read before anything below changes the screen or `current`: the reading
  // remembers where it was opened from (readingOrigin has the rules).
  const openedFrom = readingOrigin({
    showing: document.body.dataset.screen,
    keptFrom: readingFrom,
    sameReading: !!current && d === current,
    historyFrom: opts && opts.from,
  });
  document.body.classList.remove('exploring');
  $('gallery').hidden = true;
  $('saved-view').hidden = true;
  current = d;
  current.__kind = kindOf(opts);
  // A new card starts folded, with the Share menu shut: what the last one
  // had open says nothing about what the reader wants from this one. A link
  // that asks about an assertion opens Full analysis again (renderClaim).
  $('full-analysis').open = false;
  $('share').open = false;
  renderClaim(d);
  if (current.__kind === 'live') updateSavedPosition(d);
  const readingKey = d.snapshotId || d.address + ':' + d.checkedAt;
  if (!usageReadings.has(readingKey)) {
    usageReadings.add(readingKey);
    recordUsage('reading_view', d);
    if (returningReader && !repeatRecorded) { repeatRecorded = true; recordUsage('repeat_read', d); }
    try { localStorage.setItem('betOrBook:hasRead', '1'); } catch {}
  }
  // Unhidden first, before anything below measures a box inside it: with
  // `#card` still hidden, `#breakdown`'s own clientWidth reads 0 regardless
  // of its own hidden state, and renderBreakdown fell back to a fixed 640 on
  // every first paint - correct only by coincidence on a desktop-width phone
  // emulation, wrong on a real one (23.09 audit, U01). Every update below
  // runs synchronously in this same task, so there is nothing to flash.
  $('card').hidden = false;
  document.body.classList.add('has-reading');
  $('reading-nav').hidden = false;
  // Which numbered sections have anything to show, settled before any of
  // them is drawn: the coverage illustration measures its own box, which
  // reads 0 inside a section still hidden from the previous reading.
  backfillSavedRow(d);
  const savedRow = savedRowFor(d);
  const sections = readingSections(d, savedRow && savedRow.previousSnapshotId);
  $('section-verdict').hidden = !sections.verdict;
  $('section-evidence').hidden = !sections.evidence;
  $('section-changed').hidden = !sections.changed;
  $('section-blind-spots').hidden = !sections.blindSpots;
  $('section-coverage').hidden = !sections.coverage;
  $('section-analysis').hidden = !sections.analysis;
  $('save-confirmation').hidden = true;
  $('share-status').textContent = '';
  $('copy-embed').hidden = !savedReadingLink(d, window.location.origin);
  $('share-note').textContent = savedReadingLink(d, window.location.origin)
    ? 'Shares this dated reading and its evidence. Opening the link is free.'
    : 'No saved reading link is available. You can copy the evidence or export the card.';
  $('copy-link').textContent = savedReadingLink(d, window.location.origin) ? 'Copy link' : 'Copy wallet link';
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

  // The header: the position as the title ("$122.1M" and, muted, "HYPE
  // long"), the address and the reading's age under it, and the date above
  // it. "Check live" can be answered from the ten-minute cache, and a card
  // that looks new when it is nine minutes old is the wrong thing to hand a
  // reader watching a position move, so the age is always said.
  const title = readingTitleParts(d);
  $('reading-title').replaceChildren(title.amount, ...(title.assetSide ? [' ', el('span', 'reading-asset', title.assetSide)] : []));
  const ageMin = Math.floor((Date.now() - new Date(d.checkedAt).getTime()) / 60000);
  const relativeAge = ageMin < 1 ? 'just now' : ageMin < 60 ? plural(ageMin, 'minute') + ' ago' : ageMin < 1440 ? plural(Math.floor(ageMin / 60), 'hour') + ' ago' : plural(Math.floor(ageMin / 1440), 'day') + ' ago';
  const shownAddress = el('span', 'mono', shortAddr(d.address));
  shownAddress.title = d.address;
  $('reading-meta').replaceChildren(shownAddress, ' · read ' + relativeAge);
  const kind = kindOf(opts);
  $('snapshot-text').textContent = (kind === 'gallery' ? 'Gallery scan snapshot' : kind === 'saved' ? 'Saved reading' : 'Live reading') + ' · ' + fmtTime(d.checkedAt);
  // An entry whose observation predates the current rules keeps the verdict
  // the older rules gave it. Saying which rules read a card is the
  // difference between history and a current answer (audit A06).
  const historical = kind === 'gallery' && d.historical;
  $('snapshot-note').hidden = !historical;
  $('snapshot-note').textContent = historical
    ? 'Read by the rules of the time (' + (d.classifierVersion || 'earlier') + '). ' + d.historical.reason
    : '';

  $('badge').textContent = badgeText(d);
  // Faded and dashed when the rules that gave it are no longer in force, on
  // the card as it already was in the list.
  $('badge').className = 'badge ' + v.cls + (d.historical ? ' historical' : '');
  $('headline').textContent = headlineFor(d);
  $('takeaway').hidden = !d.takeaway;
  $('takeaway').textContent = d.takeaway || '';
  $('summary').textContent = d.summary || '';
  $('source-warning').hidden = !d.degraded;
  const warning = sourceWarning(d);
  $('source-warning-text').textContent = warning.text;
  $('source-free-examples').hidden = !warning.unavailable;
  $('try-again').hidden = warning.unavailable;
  $('watch-address').textContent = watched().some(row => row.address === d.address && row.coin === d.positions.headlineCoin && row.side === d.positions.headlineSide) ? 'Saved' : 'Save';
  // The lead-in is its own element, as "Still open:" is, so Blind spots can
  // set both as labels; the text reads the same.
  if (d.whatChanges) $('what-changes').replaceChildren(el('strong', null, 'What would change this: '), d.whatChanges);
  else $('what-changes').replaceChildren();

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
  // simply has neither. Blind spots sets what is not visible on one side
  // and what would change the answer on the other (blindSpotParts has the
  // rules). The universal limit shows once: beside the reading's own blind
  // spots, or in Full analysis when the open question already says it or
  // there is nothing beside it.
  const blind = blindSpotParts(d);
  $('open-question').hidden = !blind.openQuestion;
  $('open-question').replaceChildren(el('strong', null, 'Still open: '), d.openQuestion || '');
  $('what-changes').hidden = !blind.whatChanges;
  $('standing-limit').hidden = !blind.standingLimit;
  $('analysis-limit').hidden = blind.standingLimit;
  $('blind-spots-open').hidden = !(blind.openQuestion || blind.standingLimit || blind.notRead);
  $('blind-spots-change').hidden = !(blind.whatChanges || blind.risks);
  const nz = d.nansen;
  $('nansen').hidden = !nz;
  // Sources are already beside the facts. Keep the provider breakdown in
  // Full analysis instead of repeating the headline above Share.
  $('nansen-preview').hidden = true;
  if (nz) {
    $('nansen-lead').textContent = nz.lead;
    $('nansen-list').replaceChildren(...nz.items.map((text) => el('li', null, text)));
    $('nansen-calls').textContent = plural(nz.calls, 'Nansen API call') + ' made for this reading.';
  }

  const tile = (item) => {
    // The row the verdict turned on leads, rather than sitting fourth in a
    // line of identical tiles (audit U03).
    const box = el('div', 'stat' + (item.decisive ? ' decisive' : ''));
    const value = item.label === 'Hedge found' && /^0\.0%/.test(item.value) && d.hedge && d.hedge.hedgeRatio > 0
      ? item.value.replace(/^0\.0%/, '<0.1%')
      : item.value;
    // A value that reads as a phrase ("$395.8M ETH in 2 wallets, owner
    // unconfirmed") is set a size down in the Evidence panel, and wraps.
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value' + (value.length > 20 ? ' stat-value-long' : ''), value), el('div', 'stat-source', item.source));
    return box;
  };
  $('stats').replaceChildren(...(d.evidence || []).map(item => tile({ ...item, decisive: false })));
  const diagnostics = [];
  const legs = d.positions.selectedPerpLegs;
  if (legs && (legs.opposingUsd || legs.sameSideOtherUsd)) diagnostics.push('Selected asset contracts: long ' + usd(legs.longUsd) + ', short ' + usd(legs.shortUsd) + ', net ' + usd(legs.netUsd) + '. These legs do not establish spot ownership.');
  const market = d.marketProvenance;
  if (d.marketDefinition) diagnostics.push('Contract definition: ' + d.marketDefinition.status + (d.marketDefinition.underlying ? ' · ' + d.marketDefinition.underlying : '') + '. This documents the referenced asset; it does not audit oracle prices or establish spot equivalence.');
  if (market) diagnostics.push('HIP-3 venue ' + market.venue + ': ' + (market.status === 'missing' ? 'registry unavailable' : market.listed ? 'listed in the venue registry; deployer ' + market.deployer + '; oracle updater ' + (market.oracleUpdater || 'not published') : 'not found in the venue registry') + '. Venue membership does not verify the underlying asset.');
  if (d.quoteGeometry) diagnostics.push('Priced orders: weighted distance ' + d.quoteGeometry.weightedDistanceBps.toFixed(1) + ' bps from the ' + (d.quoteGeometry.reference === 'mid' ? 'order-book midpoint' : 'mark price') + '; nearest ' + d.quoteGeometry.nearestDistanceBps.toFixed(1) + ' bps.' + (d.quoteGeometry.reference === 'mid' ? '' : ' Midpoint unavailable; mark is a fallback.'));
  if (d.quoteSamples) diagnostics.push('Two-sided quotes seen in ' + d.quoteSamples.samples + ' separate observed sample(s), from ' + d.quoteSamples.firstAt + ' to ' + d.quoteSamples.lastAt + '. Best-effort samples do not prove continuous quoting or fill probability.');
  $('market-diagnostics').hidden = !diagnostics.length;
  $('market-diagnostics-list').replaceChildren(...diagnostics.map(text => el('li', null, text)));
  if (d.marketDefinition?.source) {
    const source = el('a', null, 'Publisher contract specification'); source.href = d.marketDefinition.source; source.target = '_blank'; source.rel = 'noopener noreferrer';
    const row = el('li'); row.append(source, ' · reviewed ' + d.marketDefinition.reviewedAt + ' · review expires ' + d.marketDefinition.reviewUntil);
    $('market-diagnostics-list').append(row);
  }

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
  // Which position this answer is about, said before the answer when it is
  // not simply the title: the picker says it when there is a choice to
  // offer, otherwise this line does for a position that was asked about.
  $('subject').hidden = !subjectVisible(d, !$('picker').hidden);
  $('subject').replaceChildren(
    el('span', 'muted', d.focus ? 'The position asked about' : 'The position'),
    ' ',
    el('strong', null, positionText(d)),
    ' ',
    el('span', 'muted', '· ' + shortAddr(d.address)),
  );
  renderChanged(d);
  renderBreakdown(d);

  // The Evidence panel: its rows are always full (statColumns), however
  // many of the columns the width allows the CSS picks.
  const heroTiles = heroTilesFor(d);
  $('decisive').hidden = heroTiles.length === 0;
  $('decisive').replaceChildren(...heroTiles.map(tile));
  for (const most of [2, 3, 4]) $('decisive').style.setProperty('--stat-cols-' + most, String(statColumns(heroTiles.length, most)));

  const funders = d.linkedHedge && Array.isArray(d.linkedHedge.funders) ? d.linkedHedge.funders : [];
  $('funders').hidden = funders.length === 0;
  $('funders-credit').textContent = fundersCredit(d);
  $('funders-list').replaceChildren(...funders.map((f) => {
    const li = el('li');
    li.append(
      explorerLink(f.address, f.chain),
      el('span', 'muted', ' on ' + f.chain + ', holds ' + fmtUsd(f.matchingUsd) + ' of ' + d.positions.headlineCoin + ' or its wrapped forms'),
    );
    return li;
  }));

  // A source that failed stays in sight, in Blind spots; a note that only
  // describes what was found goes one click down (coverageLists).
  const { failures, remarks } = coverageLists(d);
  $('coverage').hidden = failures.length === 0;
  $('coverage-list').replaceChildren(...failures.map((c) => el('li', null, c)));
  $('notes').hidden = remarks.length === 0;
  $('notes-list').replaceChildren(...remarks.map((c) => el('li', null, c)));

  const meta = $('meta');
  meta.replaceChildren();
  const calls = nansenCallsNote(d);
  const src = positionsSource(d);
  // When the source says it measured the positions, that is the time the
  // numbers describe. "Checked" is only when this page asked.
  const measured =
    d.positionsAsOf && fmtTime(d.positionsAsOf) !== fmtTime(d.checkedAt)
      ? ' · positions as of ' + fmtTime(d.positionsAsOf)
      : '';
  const rules = d.classifierVersion ? ' · rules ' + d.classifierVersion : '';
  const age = kind === 'live' && ageMin >= 1 ? ' · cached, ' + plural(ageMin, 'minute') + ' old' : '';
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

  if (d.focus) {
    $('picker-chips').setAttribute('aria-label', 'asked about ' + d.focus.coin + ' ' + d.focus.side);
  }
  const risks = riskItems(d);
  $('risk-preview').hidden = risks.length === 0;
  $('risk-preview').textContent = risks.map(item => item.label + ': ' + item.value).join(' · ');

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
  // The "What next?" panel leads back where the breadcrumb does.
  $('reading-back').textContent = backLabel(openedFrom);
  setScreen('reading', openedFrom);
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
 * check still runs to its end - but its answer will not be painted over the
 * reading the reader has moved to. */
function takeOver() {
  requestSeq++;
  setBusy(false);
  return requestSeq;
}

/** Keeps the address bar pointing at what is on screen. Opening a card used
 * to leave the previous reading's link in the bar, so copying it shared the
 * wrong one. A reading's entry also keeps `{ from }`, the screen it was
 * opened from, so the browser's Back button brings it back with the same
 * origin (routeHistory); nothing else goes into the history state. */
function showLink(id) {
  const claim = current?.snapshotId === id && isClaim($('claim-choice').value) ? '&claim=' + $('claim-choice').value : '';
  const next = id ? '/?s=' + encodeURIComponent(id) + claim : '/';
  const from = id && document.body.dataset.screen === 'reading' ? readingFrom : null;
  const keptFrom = (window.history.state && window.history.state.from) || null;
  if (window.location.pathname + window.location.search + window.location.hash !== next || keptFrom !== from) {
    window.history.replaceState(from ? { from } : null, '', next);
  }
}
/** The history entry of a reading just put on screen. 'push', for every
 * opening the reader makes (a card, a chip, a check's answer): an entry of
 * its own after the screen it was opened from, which keeps its own entry, so
 * Back returns there. 'replace', for a cold link, a move through history and
 * a reading redrawn in place: the entry showing becomes the reading's, and
 * nothing is added. 'preserve': the history is left as it is. */
function linkReading(id, navigation) {
  if (navigation === 'push') window.history.pushState(null, '', window.location.href);
  if (navigation !== 'preserve') showLink(id);
}

function setBusy(on) {
  busy = on;
  if (!on) $('slow-check').hidden = true;
  $('check-progress').hidden = !on;
  $('check').disabled = on;
  $('check').textContent = on ? 'Checking...' : 'Check position';
  $('check-live').disabled = on;
}

// ---- the operator key ----
//
// A check that carries the operator key skips the public rate limits, so a
// busy afternoon cannot stop a demo or a recording. The key goes in a request
// header, never a URL: a query string ends up in history, logs and a screen
// recording's own address bar (23.09 audit, S03).
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
    'Operator key for this browser: it lets its checks bypass the rate limits. It stays in this browser, is sent only as a request header with a ' +
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
      setStatus('Operator key accepted: checks from this browser bypass the rate limits.', false);
    } else {
      window.localStorage.removeItem(OPERATOR_KEY);
      setStatus('The server did not accept that operator key, so it was not kept.', true);
    }
  } catch (e) {
    setStatus('Could not reach the server to check the operator key; it is kept, unverified.', true);
  }
}

// Starting a check does the work and spends the site's request allowance, so
// it is a POST: a GET is something a
// crawler, a link preview or a browser prefetch can trigger on its own, and
// used to run the check when they did.
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
    recordUsage('check_start');
    guessRevealTimer = setTimeout(() => {
      if (seq === requestSeq) $('guess').hidden = false;
    }, 700);
  }
  // A notice about the input - "three addresses here, using the first" - is
  // about to be replaced by the progress line one statement later, which is
  // how it became unreadable. It travels with the request instead.
  // A saved reading is opened, not read again: saying a source is being asked
  // when nothing is would misdescribe a free lookup as a new check.
  const doing = method === 'POST' ? 'Reading positions and orders from Hyperliquid, balances from public nodes, wallet links from Blockscout...' : 'Opening the saved reading...';
  setStatus((notice ? notice + ' ' : '') + doing, false);
  const slowTimer = isLiveCheck ? setTimeout(() => { if (seq === requestSeq && busy) $('slow-check').hidden = false; }, 8000) : null;
  try {
    let res;
    let data;
    // Only a check carries the operator key, and only when one is set.
    const key = method === 'POST' && url.indexOf('/api/check') === 0 ? operatorKey() : '';
    for (let attempt = 0; ; attempt++) {
      res = await timedFetch(url, key ? { method, headers: { 'x-demo-key': key } } : { method: method || 'GET' }, isLiveCheck ? 55000 : 15000);
      data = await res.json().catch(() => ({}));
      if (seq !== requestSeq) return;
      const wait = res.status === 404 && retryDelays ? retryDelays[attempt] : undefined;
      if (wait === undefined) break;
      setStatus(
        'This reading may still be saving. Trying once more...',
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
        (e.name === 'TimeoutError' ? 'The server took too long to answer. A live check may still finish; wait a moment before trying again.' : 'Could not reach the server. Try again shortly.') + (current ? ' The card below is the previous reading.' : ''),
        true,
      );
    }
  } finally {
    clearTimeout(slowTimer);
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

/**
 * A live check's answer: drawn, linked in the address bar and its picture
 * asked for. A live reading is worth linking to, so the address in the bar
 * becomes the link to this reading rather than to the account - but only
 * once the server says it really saved one; leaving the previous reading's
 * id in the bar would be worse than none. Opened from Check or Saved, the
 * reading gets a history entry of its own, so Back returns to that screen.
 * A reading redrawn in place (Check live, Try again, Load context, another
 * position) takes over its own entry, so Back still leads to the screen it
 * was opened from.
 */
function showLiveReading(data) {
  const navigation = document.body.dataset.screen === 'reading' ? 'replace' : 'push';
  renderResult(data, { kind: 'live' });
  linkReading(data.snapshotId && data.snapshotSaved !== false ? data.snapshotId : null, navigation);
  askForPicture(data);
}

function runCheck(selectedAddress) {
  if (busy) return;
  const raw = $('address').value;
  const addr = typeof selectedAddress === 'string' && ADDRESS_RE.test(selectedAddress) ? selectedAddress : extractAddress(raw);
  if (!addr) {
    $('address').setAttribute('aria-invalid', 'true');
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
  const all = [...new Set([...raw.trim().matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)].map(m => m[0].toLowerCase()))];
  $('address').removeAttribute('aria-invalid');
  if (all.length > 1 && typeof selectedAddress !== 'string') {
    $('address-choices').hidden = false;
    $('address-choice-buttons').replaceChildren(...all.map(address => {
      const b = el('button', 'chip', address);
      b.addEventListener('click', () => runCheck(address));
      return b;
    }));
    setStatus('Choose one wallet before starting the check.');
    $('address-choice-buttons').querySelector('button').focus();
    return;
  }
  $('address-choices').hidden = true;
  const notice = 'Checking wallet ' + addr + '.';
  return load(
    '/api/check?context=0&address=' + encodeURIComponent(addr),
    (data) => {
      // load() leaves the notice up on success; once the answer is in it
      // must not still say the wallet is being checked.
      setStatus('Checked wallet ' + addr + '.');
      showLiveReading(data);
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
    '/api/check?context=0&address=' + encodeURIComponent(address) +
    '&coin=' + encodeURIComponent(position.coin) +
    '&side=' + encodeURIComponent(position.side);
  return load(
    query,
    showLiveReading,
    'Something went wrong. Try again shortly.',
    'POST',
  );
}

/** Opens a saved reading. `navigation` is how it enters the browser's
 * history (linkReading): 'push' for an opening the reader makes, 'replace'
 * or 'preserve' only for the cold page load and routeHistory. `historyFrom`
 * is given only by a move through the browser's history (routeHistory): the
 * origin that entry stands for. */
function openSnapshot(id, navigation = 'push', historyFrom) {
  takeOver();
  return load(
    '/api/snapshot?id=' + encodeURIComponent(id),
    (data) => {
      // The reading on show opened again (as "Open a free saved example"
      // while it is showing) is redrawn in place: a second identical entry
      // would make Back need two presses. Read before renderResult changes
      // the screen and `current`.
      const again = navigation === 'push' && document.body.dataset.screen === 'reading' && current?.snapshotId === id;
      // The server says which of the two this is: a gallery card opened by
      // its link is still a gallery card, with the gallery's own wording.
      renderResult(data, { kind: data.kind === 'gallery' ? 'gallery' : 'saved', from: historyFrom });
      linkReading(id, again ? 'replace' : navigation);
    },
    'That link points at a reading that is no longer saved. Check the address again to make a new one.',
    'GET',
    '',
    document.referrer && new URL(document.referrer).origin === window.location.origin ? [2000] : [],
  );
}

$('check').addEventListener('click', runCheck);
$('address').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runCheck();
});
$('address').addEventListener('input', () => $('address').removeAttribute('aria-invalid'));
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
/** How the page scrolls to a part of itself: smoothly, or at once for a
 * reader who asked the system for less motion (the stylesheet's
 * prefers-reduced-motion block covers the rest). */
function scrollMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
/** "Check a wallet" in the closing panel of a reading, Explore and Saved: to
 * Check the way the Check tab goes (goCheck, a history entry of its own, so
 * Back returns to the screen left), with the address field empty and
 * ready. */
function checkAnother(event) {
  goCheck(event);
  $('address').value = '';
  $('address-choices').hidden = true;
  $('address').focus({ preventScroll: true });
  $('address').scrollIntoView({ behavior: scrollMotion(), block: 'center' });
}
$('check-another').addEventListener('click', checkAnother);
$('explore-check').addEventListener('click', checkAnother);
$('saved-check').addEventListener('click', checkAnother);

function showExamples() {
  document.body.classList.remove('exploring');
  $('gallery').hidden = true;
  $('saved-view').hidden = true;
  // Supersede a pending request so it cannot reopen a card after going back.
  requestSeq++;
  clearTimeout(guessRevealTimer);
  $('guess').hidden = true;
  setBusy(false);
  current = null;
  $('card').hidden = true;
  $('reading-nav').hidden = true;
  document.body.classList.remove('has-reading');
  $('address').value = '';
  $('address-choices').hidden = true;
  setStatus('');
  showLink(null);
  renderPlayer();
  setScreen('check');
}
/** The Check screen as a place to go to (header tab, logo, footer,
 * breadcrumb): a history entry of its own, so Back returns to the screen
 * left behind through the popstate routing below. */
function goCheck(event) {
  if (event) event.preventDefault();
  // Already on Check (and not still opening a linked reading): back to the
  // top only. showExamples() would clear the field and drop the answer to
  // a live check still running, which is already under way.
  if (document.body.dataset.screen === 'check' && !new URLSearchParams(window.location.search).has('s')) return setScreen('check');
  if (window.location.pathname + window.location.search + window.location.hash !== '/') window.history.pushState(null, '', '/');
  showExamples();
}
/** Back to a screen by name, through the same handlers as its tab: the
 * breadcrumb's way back from a reading to the screen it was opened from. */
function goToScreen(screen, event) {
  if (screen === 'explore') return openBoards(event);
  if (screen === 'saved') return openSaved(event);
  return goCheck(event);
}
$('back-examples').addEventListener('click', () => {
  showExamples();
  $('examples').scrollIntoView({ behavior: scrollMotion(), block: 'start' });
  $('player-queue').querySelector('button')?.focus({ preventScroll: true });
});
$('nav-examples').addEventListener('click', goCheck);
$('site-logo').addEventListener('click', goCheck);
$('footer-check').addEventListener('click', goCheck);
$('footer-explore').addEventListener('click', openBoards);
$('footer-saved').addEventListener('click', openSaved);
$('breadcrumb-origin').addEventListener('click', (event) => goToScreen($('breadcrumb-origin').dataset.screen, event));
$('reading-back').addEventListener('click', (event) => goToScreen(readingFrom, event));
$('nav-how-it-works').addEventListener('click', (event) => {
  // A native fragment navigation emits popstate, whose page routing resets
  // the address. This section only needs scrolling, with no history change.
  event.preventDefault();
  $('how-it-works').scrollIntoView({ behavior: scrollMotion(), block: 'start' });
});
let galleryPromise = null;
function ensureGallery() {
  if (!galleryPromise) galleryPromise = loadGallery().finally(() => { if (!gallery) galleryPromise = null; });
  return galleryPromise;
}
function openBoards(event) {
  if (event) event.preventDefault();
  takeOver();
  clearTimeout(guessRevealTimer);
  $('guess').hidden = true;
  document.body.classList.add('exploring');
  $('saved-view').hidden = true;
  $('gallery').hidden = false;
  $('explore-return').hidden = !current;
  setStatus('');
  if (window.location.hash !== '#explore') window.history.pushState(null, '', window.location.pathname + window.location.search + '#explore');
  setScreen('explore');
  ensureGallery();
}
$('nav-boards').addEventListener('click', openBoards);
function openSaved(event) {
  if (event) event.preventDefault();
  takeOver();
  clearTimeout(guessRevealTimer);
  $('guess').hidden = true;
  document.body.classList.add('exploring');
  $('gallery').hidden = true;
  $('saved-view').hidden = false;
  $('saved-return').hidden = !current;
  setStatus('');
  renderWatched();
  if (window.location.hash !== '#saved') window.history.pushState(null, '', window.location.pathname + window.location.search + '#saved');
  setScreen('saved');
}
$('nav-saved').addEventListener('click', openSaved);
$('saved-home').addEventListener('click', () => {
  showExamples();
  window.scrollTo(0, 0);
  $('address').focus({ preventScroll: true });
});
$('saved-return').addEventListener('click', () => {
  if (!current) return;
  renderResult(current, { kind: current.__kind });
  showLink(current.snapshotId && current.snapshotSaved !== false ? current.snapshotId : null);
});
$('reading-boards').addEventListener('click', openBoards);
$('explore-link').addEventListener('click', openBoards);
$('search-explore').addEventListener('click', openBoards);
$('explore-home').addEventListener('click', () => {
  showExamples();
  window.scrollTo(0, 0);
  $('address').focus({ preventScroll: true });
});
$('explore-return').addEventListener('click', () => {
  if (!current) return;
  renderResult(current, { kind: current.__kind });
  showLink(current.snapshotId && current.snapshotSaved !== false ? current.snapshotId : null);
});
function selectExploreView(view) {
  for (const [key, panel] of [['cases', 'case-studies'], ['ranked', 'boards-fold'], ['all', 'all-readings'], ['archive', 'archive']]) {
    $(panel).hidden = key !== view;
    $('explore-' + key).setAttribute('aria-pressed', String(key === view));
  }
  if (view === 'archive') $('archive').open = true;
}
for (const view of ['cases', 'ranked', 'all', 'archive']) $('explore-' + view).addEventListener('click', () => selectExploreView(view));
/**
 * The screen for the history entry the browser has just moved to (Back,
 * Forward). A reading comes back with the origin its entry stored (`state`
 * from showLink), else the kept origin when it is the reading still in
 * memory, else Check: the screen being left says nothing about where a
 * reading was opened from.
 */
function routeHistory(state) {
  const id = new URLSearchParams(window.location.search).get('s');
  if (window.location.hash === '#saved') return openSaved();
  const historyFrom = id ? readingOrigin({ showing: null, keptFrom: readingFrom, sameReading: current?.snapshotId === id, historyFrom: state && state.from }) : null;
  if (window.location.hash === '#explore') {
    if (id && current?.snapshotId !== id) return openSnapshot(id, 'preserve', historyFrom).then(() => openBoards());
    return openBoards();
  }
  if (id) return openSnapshot(id, 'replace', historyFrom);
  return showExamples();
}
window.addEventListener('popstate', (event) => routeHistory(event.state));

$('guess-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  pendingGuess = btn.dataset.guess;
  for (const b of $('guess-chips').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
});

// The landing examples open the same saved readings as shared links.

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

// ---- share card ----

// Opening the one Share button is the moment a reader means to share, and
// the best time to have the link's own picture drawn before any crawler
// asks for it.
$('share').addEventListener('toggle', () => {
  if ($('share').open && current) askForPicture(current);
});
setUpShareMenu($('share'), $('share-toggle'), $('share-menu'), document);

/** What a share button says back ("Copied") for a moment: on the button
 * and, since a choice in the Share menu closes it, in the status line under
 * the reading's header, where it is seen and announced. */
function shareFeedback(btn, text, ms, restore) {
  const status = $('share-status');
  btn.textContent = text;
  if ($('share-menu').contains(btn)) status.textContent = text;
  setTimeout(() => {
    btn.textContent = restore();
    if (status.textContent === text) status.textContent = '';
  }, ms);
}

async function copyReadingLink(btn, savedId) {
  if (!current) return;
  if (!savedId || savedId === current.snapshotId) askForPicture(current);
  // The link opens this reading, not a new check of this account. Without a
  // snapshot id there is nothing saved to point at, so it falls back to the
  // address and the button says which one it gave.
  const savedLink = savedReadingLink(savedId ? { snapshotId: savedId } : current, window.location.origin);
  const claim = $('claim-choice').value;
  const link = savedLink ? savedLink + (isClaim(claim) ? '&claim=' + claim : '') : window.location.origin + '/?address=' + encodeURIComponent(current.address);
  try {
    await navigator.clipboard.writeText(link);
    recordUsage('share_copy', current);
    shareFeedback(btn, 'Copied', 1500, () => btn.id === 'save-copy-link' ? 'Copy saved reading link'
      : savedReadingLink(current || {}, window.location.origin) ? 'Copy link' : 'Copy wallet link');
  } catch (e) {
    window.prompt('Copy this link:', link);
  }
}

/** The credit at the end of a share text and a post. The server works it out
 * from the sources the reading used (src/engine/attribution.ts) and sends it
 * as `attribution.post`; a reading saved before that has no such field, and
 * is credited by its `source`, as it always was. */
function postCredit(d) {
  const credit = d.attribution && d.attribution.post;
  if (typeof credit === 'string' && credit !== '') return credit;
  return d.source === 'nansen' ? 'Powered by @nansen_ai' : 'Data: Hyperliquid';
}

/** The card's own summary, plus the link that reopens it, sized for a post
 * on X: any link counts as 23 characters there whatever its real length, so
 * the summary is trimmed against what is actually left, not against 280
 * raw characters. The reader can still edit before posting; this is a
 * draft, not a submission (audit item 10). */
function shareTextData(d, compact) {
  const reasons = d.verdict.reasons || [];
  const limit = reasons.includes('linked_exposure_unverified') ? 'Funding links do not establish ownership.'
    : d.degraded || reasons.includes('positions_stale') ? 'Incomplete data; exposure remains unresolved.'
    : d.verdict.verdict === 'hedged' ? 'Spot coverage is not a safety rating.'
    : d.verdict.verdict === 'book' ? 'Quotes show activity, not trading intent.'
    : 'Off-chain and unlinked hedges are not visible.';
  const claim = $('claim-choice').value;
  const claimReading = isClaim(claim) ? checkClaim(d, claim) : null;
  const link = savedReadingLink(d, window.location.origin);
  return { position: positionText(d), verdict: compact ? verdictOf(d).label : badgeText(d),
    headline: claimReading ? CLAIMS[claim] + ': ' + claimReading.status + '. ' + claimReading.explanation : headlineFor(d),
    readAt: fmtTime(d.checkedAt), limitation: compact ? limit : d.openQuestion ? 'Still open: ' + d.openQuestion : d.takeaway || limit,
    attribution: postCredit(d),
    link: link && isClaim(claim) ? link + '&claim=' + encodeURIComponent(claim) : link };
}
function postText(d) {
  return readingPostText(shareTextData(d, true));
}
$('copy-reading').addEventListener('click', async () => {
  if (!current) return;
  const text = readingCopyText(shareTextData(current, false));
  const btn = $('copy-reading');
  try {
    await navigator.clipboard.writeText(text); recordUsage('share_copy', current);
    shareFeedback(btn, 'Reading copied', 1500, () => 'Copy reading as text');
  } catch { window.prompt('Copy this reading:', text); }
});
$('copy-link').addEventListener('click', () => copyReadingLink($('copy-link')));
$('copy-embed').addEventListener('click', async () => {
  if (!current || !savedReadingLink(current, window.location.origin)) return;
  const claim = $('claim-choice').value;
  const url = window.location.origin + '/embed?s=' + encodeURIComponent(current.snapshotId) + (isClaim(claim) ? '&claim=' + claim : '');
  const code = '<iframe src="' + url + '" title="Bet or Book dated position evidence" width="100%" height="600" loading="lazy" style="border:0;border-radius:12px"></iframe>';
  try { await navigator.clipboard.writeText(code); shareFeedback($('copy-embed'), 'Embed copied', 1500, () => 'Copy embed code'); }
  catch { window.prompt('Copy this embed code:', code); }
});

// A direct hand-off, not one more thing to copy and paste yourself: X's own
// intent endpoint opens composer with the text already in it, in a new tab,
// so most of the way there is one click. X's intent URL has no parameter for
// attaching an image, though - the compose box only shows one once X's own
// crawler has fetched a link's og:image, which does not happen inside the
// compose box itself. So the card's own picture is also put on the
// clipboard, and the button says to
// paste it in - a real image in the post, not a hope that the link unfurls
// before it is read.
$('share-x').addEventListener('click', () => {
  if (!current) return;
  askForPicture(current);
  const text = postText(current);
  // Opened synchronously, inside the click itself - once anything here is
  // awaited first, some browsers no longer count this as the user's own
  // gesture and block it as a popup.
  window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
  drawCard();
  const canvas = $('card-canvas');
  const btn = $('share-x');
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      shareFeedback(btn, 'Opened X - paste the image (Ctrl+V) before posting', 4000, () => 'Share on X');
    } catch (e) {
      // The tab with the text is already open either way; only the image
      // did not make it to the clipboard, so there is nothing to undo here.
      shareFeedback(btn, 'Opened X · use Download PNG to attach the card', 5000, () => 'Share on X');
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
    b.addEventListener('click', () => openSnapshot(r.id, 'push'));
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

const {drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor} = createConstellation({fmtPct});
const {drawCard}=createShareCard({getCurrent:()=>current, $, verdictOf, badgeText, headlineFor, fmtTime, shortAddr, drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor});
const {loadGallery, renderPlayer}=createExplore({$, el, verdictOf, badgeText, positionText, readingTitleParts, shortAddr, plural, fmtUsd, fmtPct, fmtTime, fmtDay, recordUsage, openSnapshot, getCurrent:()=>current, publishGallery:g=>{gallery=g;}, timedFetch, VERDICTS, PAGE_SIZE, MATERIAL_GAP_SHARE});

// Explore loads its list on demand; the bundled example links work immediately.
if (window.location.hash === '#operator') setUpOperator();
const params = new URLSearchParams(window.location.search);
const saved = params.get('s');
const preset = params.get('address');
let opening = null;
if (window.location.hash === '#saved') {
  openSaved();
} else if (window.location.hash === '#explore') {
  if (saved) opening = openSnapshot(saved, 'preserve').then(() => openBoards());
  else openBoards();
} else if (saved) {
  // A saved reading opens as itself. No check runs, so nothing is spent and
  // nothing can have changed between the link being written and read. A
  // shared link has no history state and counts as opened from Check; a
  // reload keeps the origin its entry stored.
  opening = openSnapshot(saved, 'replace', window.history.state && window.history.state.from);
} else if (preset) {
  // Filling the field is not running the check: a `?address=` link used to
  // spend a check the moment it opened in a browser, no click involved, so
  // a same-origin POST was one crafted link away regardless of who opened it
  // (23.09 audit, S01). The address is still ready for the reader's own
  // press of Check or Enter.
  $('address').value = preset;
  setStatus('Address filled in from the link. Press Check to run it.');
  $('check').focus();
}
// The header tabs fade from one screen to the next, but not on the way in:
// the markup starts with Check lit, and a cold /#explore, /#saved or a
// reading opened from them would show the light sliding over. Transitions
// are on (body[data-ready]) once the first screen is set and its style is
// applied (the read of offsetWidth), so nothing is left to animate.
Promise.resolve(opening).catch(() => {}).then(() => {
  void document.body.offsetWidth;
  document.body.dataset.ready = '';
});
renderRecent();
recordUsage('landing_view');

$('try-again').addEventListener('click', () => {
  if (!current || busy) return;
  let url = '/api/check?context=0&address=' + encodeURIComponent(current.address) + '&retry=1';
  if (current.focus) url += '&coin=' + encodeURIComponent(current.focus.coin) + '&side=' + current.focus.side;
  load(url, showLiveReading, 'Could not complete the reading. Try again shortly.', 'POST');
});
$('load-context').addEventListener('click', () => {
  if (!current || busy) return;
  let url = '/api/check?context=1&address=' + encodeURIComponent(current.address);
  if (current.focus) url += '&coin=' + encodeURIComponent(current.focus.coin) + '&side=' + current.focus.side;
  load(url, showLiveReading, 'Optional context could not be loaded.', 'POST');
});
$('source-free-examples').addEventListener('click', () => { showExamples(); $('examples').scrollIntoView({ block: 'start' }); });
$('use-example').addEventListener('click', () => {
  recordUsage('example_open');
  const link = $('player-queue').querySelector('a[href]');
  if (!link && gallery?.featured?.[0]) return openSnapshot(gallery.featured[0].snapshotId, 'push');
  if (link) openSnapshot(new URL(link.href, window.location.origin).searchParams.get('s'), 'push');
});
$('waiting-example').addEventListener('click', () => $('use-example').click());
$('address').addEventListener('input', () => { $('address-choices').hidden = true; });
$('download-image').addEventListener('click', () => {
  if (!current) return;
  drawCard();
  $('card-canvas').toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = 'bet-or-book-' + (current.snapshotId || current.address) + '.png';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }, 'image/png');
});
const WATCH_KEY = 'betOrBook:watch';
function watched() {
  try {
    const rows = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
    return Array.isArray(rows) ? rows.map(row => typeof row === 'string' ? { address: row } : row)
      .filter(row => row && typeof row.address === 'string' && ADDRESS_RE.test(row.address.toLowerCase()))
      .map(row => ({ address: row.address.toLowerCase(), coin: typeof row.coin === 'string' ? row.coin : null,
        side: ['long', 'short'].includes(row.side) ? row.side : null,
        snapshotId: typeof row.snapshotId === 'string' ? row.snapshotId : null,
        previousSnapshotId: typeof row.previousSnapshotId === 'string' ? row.previousSnapshotId : null,
        monitorToken: typeof row.monitorToken === 'string' && /^[0-9a-f-]{72}$/.test(row.monitorToken) ? row.monitorToken : null,
        monitorStatus: typeof row.monitorStatus === 'string' ? row.monitorStatus : '',
        monitorExpires: typeof row.monitorExpires === 'string' ? row.monitorExpires : null,
        monitorEvents: Array.isArray(row.monitorEvents) ? row.monitorEvents.slice(0, 5).filter(e => e && typeof e.snapshotId === 'string' && typeof e.at === 'string' && Array.isArray(e.changes) && e.changes.every(c => typeof c === 'string')) : [],
        checkedAt: typeof row.checkedAt === 'string' ? row.checkedAt : null,
        label: typeof row.label === 'string' ? row.label.trim().slice(0, 80) : '',
        // The row's copy of its saved reading (withReadingSummary), kept
        // only when it is well formed; a row saved before it existed has none.
        // hasOwnProperty, not Object.hasOwn: a browser without it (Safari
        // before 15.4) would throw here, watched() would return [], and the
        // next Save would write that empty list over every saved row.
        verdict: typeof row.verdict === 'string' && Object.prototype.hasOwnProperty.call(VERDICTS, row.verdict) ? row.verdict : null,
        notionalUsd: typeof row.notionalUsd === 'number' && Number.isFinite(row.notionalUsd) ? row.notionalUsd : null,
        summary: typeof row.summary === 'string' && row.summary.length <= 160 ? row.summary : null }))
      .slice(0, 12) : [];
  } catch { return []; }
}
const watchIdentity = row => row.address + ':' + (row.coin || '') + ':' + (row.side || '');
/** The saved position this very reading is, if the reader saved it: it may
 * keep an earlier reading of its own to compare with (previousReadingId). */
function savedRowFor(d) {
  return watched().find(row => row.snapshotId === d.snapshotId && row.address === d.address.toLowerCase());
}
const monitoring = createMonitoring({ read: watched, write: rows => localStorage.setItem(WATCH_KEY, JSON.stringify(rows)), render: renderWatched, status: setStatus, fetchJson: timedFetch });
function updateSavedPosition(d) {
  if (!d.snapshotId || d.snapshotSaved === false) return;
  const identity = watchIdentity({ address: d.address.toLowerCase(), coin: d.positions.headlineCoin, side: d.positions.headlineSide });
  const rows = watched();
  const row = rows.find(r => watchIdentity(r) === identity);
  if (!row || (row.checkedAt && Date.parse(d.checkedAt) < Date.parse(row.checkedAt))) return;
  Object.assign(row, withReadingSummary(advanceSavedReading(row, d), d));
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); renderWatched(); } catch {}
}
/** `text` in at most `max` characters: whole when it fits; otherwise cut
 * after the last whole word that leaves room for an ellipsis, which says it
 * was cut (inside a word only when there is no space to cut at). Pure. */
function cutAtWord(text, max) {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const end = text[max - 1] === ' ' ? room.length : room.lastIndexOf(' ');
  return (end > 0 ? room.slice(0, end) : room).trimEnd() + '…';
}
/**
 * A saved row's copy of what its saved reading says, for its card on Saved:
 * the verdict, the headline position's amount and the headline the reading
 * screen shows (cut to the 160 characters watched() keeps, at a word,
 * cutAtWord). Written only when the row is saved at this very reading, so
 * the copy always describes `row.snapshotId`: a saved reading never changes
 * under its id. Pure.
 */
function withReadingSummary(row, d) {
  if (!row.snapshotId || row.snapshotId !== d.snapshotId || d.snapshotSaved === false) return row;
  return { ...row, verdict: d.verdict.verdict, notionalUsd: d.positions.headlineNotionalUsd, summary: cutAtWord(headlineFor(d), 160) };
}
/** A row saved before it kept a copy of its reading gets one the first time
 * that reading is opened (renderResult): nothing is fetched for it. */
function backfillSavedRow(d) {
  const rows = watched();
  const row = rows.find(r => r.snapshotId === d.snapshotId && r.address === d.address.toLowerCase());
  if (!row || row.verdict || d.snapshotSaved === false) return;
  Object.assign(row, withReadingSummary(row, d));
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); renderWatched(); } catch {}
}
/** The number of saved positions on the Saved tab, hidden at zero. */
function renderSavedCount() {
  const badge = savedCountBadge(watched().length);
  $('saved-count').textContent = badge || '';
  $('saved-count').hidden = badge === null;
}
/**
 * What a saved position's card says, from the row kept in this browser
 * (watched()): the position, the address, the saved reading and its time,
 * the reader's name for it, the monitor state and, when the row keeps one
 * (withReadingSummary), a copy of what the saved reading says. With the
 * copy, the card is the other screens' position card: the verdict with its
 * dot (`verdictClass`), the amount (`title`) and the position (`asset`),
 * the reader's name under them (`name`), the headline (`summary`). Its
 * verdict label is the plain one from VERDICTS ("Unknown", "Book"): unlike
 * the other screens' cards it carries no strength suffix and no Unknown
 * qualifier, because the row keeps only the verdict key. Without
 * it - a row saved before the copy existed - the card claims no verdict:
 * its label says what opening it gives, the title is the name or the
 * position. `monitoring` is whether the position is being monitored (it has
 * a monitor token). Pure, so test/web-explore.test.ts runs it on its own.
 */
function savedCardModel(row, { monitoring }) {
  const position = row.coin && row.side ? row.coin + ' ' + row.side : '';
  const verdict = row.snapshotId && typeof row.verdict === 'string' && Object.prototype.hasOwnProperty.call(VERDICTS, row.verdict) ? VERDICTS[row.verdict] : null;
  const amount = row.snapshotId && position && Number.isFinite(row.notionalUsd) ? fmtUsd(row.notionalUsd) : '';
  return {
    title: amount || row.label || position || 'Saved wallet',
    asset: amount ? position : '',
    name: amount ? row.label : '',
    summary: verdict && typeof row.summary === 'string' ? row.summary : '',
    meta: [amount || !row.label ? '' : position, shortAddr(row.address), row.checkedAt ? fmtTime(row.checkedAt) : ''].filter(Boolean).join(' · '),
    verdictLabel: verdict ? verdict.label : row.snapshotId ? 'Saved reading' : 'No saved reading',
    verdictClass: verdict ? verdict.cls : '',
    // Monitoring starts from a saved reading (web/monitor.js); one already
    // running can always be stopped.
    actions: [...(row.snapshotId || monitoring ? ['monitor'] : []), 'refresh', 'remove'],
    monitorOn: !!monitoring,
  };
}
/** The panel that closes the Saved screen. With nothing saved it is the
 * whole screen, so it says so; otherwise it invites one more. Pure. */
function savedEmptyState(n) {
  const empty = !(n > 0);
  return {
    empty,
    ctaTitle: empty ? 'Nothing saved yet' : 'Track another position',
    ctaText: 'Check a wallet, then press Save on the reading.',
  };
}
/** How the controls of a saved position name it for a screen reader, as
 * they always have: the reader's name, the position, the address. */
function savedRowName(row) {
  return (row.label ? row.label + ' · ' : '') + (row.coin ? row.coin + ' ' + row.side + ' · ' : '') + shortAddr(row.address);
}
/** The accessible name of a saved card's open area, which stands in for
 * what the area shows: the card's name (savedRowName), the amount and the
 * verdict when the row keeps them, "No saved reading" when there is none,
 * the summary sentence the card shows, the time of the reading, and what
 * opening does. One helper, so drawing and renaming name the card the same
 * way. */
function savedOpenLabel(row, model) {
  return [
    savedRowName(row),
    ...(model.asset ? [model.title] : []),
    ...(model.verdictClass || !row.snapshotId ? [model.verdictLabel] : []),
    ...(model.summary ? [model.summary] : []),
    ...(row.checkedAt ? ['read ' + fmtTime(row.checkedAt)] : []),
    row.snapshotId ? 'Open saved reading' : 'Check address',
  ].join(' · ');
}
/** Draws a saved card's open area from its row, and names it (savedOpenLabel):
 * on the first draw and again after a rename. */
function fillSavedOpen(open, row) {
  const model = savedCardModel(row, { monitoring: !!row.monitorToken });
  const title = el('span', 'cp-amount', model.title);
  if (model.asset) title.append(' ', el('span', 'cp-asset', model.asset));
  const footer = el('span', 'cp-footer');
  footer.append(el('span', 'cp-meta', model.meta), el('span', 'cp-open', row.snapshotId ? 'Open →' : 'Check address →'));
  open.replaceChildren(
    model.verdictClass ? el('span', 'cp-verdict badge ' + model.verdictClass, model.verdictLabel) : el('span', 'mono-label', model.verdictLabel),
    title,
    ...(model.name ? [el('span', 'saved-name', model.name)] : []),
    ...(model.summary ? [el('span', 'cp-summary', model.summary)] : []),
    footer,
  );
  open.setAttribute('aria-label', savedOpenLabel(row, model));
}
/**
 * The Saved screen's cards, one per saved position, on the position-card
 * pattern: a part that opens the saved reading (fillSavedOpen), and under
 * it, as its sibling rather than inside it, the name field and the Monitor
 * switch, Refresh and Remove.
 *
 * `focus`, after a control redrew the list: `{ identity, control }` puts
 * focus on that card's 'monitor' switch or 'open' area again, `{ heading:
 * true }` on the Saved heading; without it, focus is left alone.
 */
function renderWatched(focus) {
  const box = $('watched');
  const rows = watched(); box.replaceChildren();
  renderSavedCount();
  const state = savedEmptyState(rows.length);
  box.hidden = state.empty;
  $('saved-pilot').hidden = state.empty;
  $('saved-next-title').textContent = state.ctaTitle;
  $('saved-next-text').textContent = state.ctaText;
  rows.forEach(row => {
    const label = savedRowName(row);
    const model = savedCardModel(row, { monitoring: !!row.monitorToken });
    const card = el('div', 'card-position saved-card');
    const open = el('button', 'saved-open');
    fillSavedOpen(open, row);
    open.addEventListener('click', () => {
      if (row.snapshotId) openSnapshot(row.snapshotId, 'push');
      else { showExamples(); $('address').value = row.address; $('address').focus(); setStatus('Address filled in. Press Check to run a reading.'); }
    });
    const refresh = el('button', 'btn-secondary', 'Refresh'); refresh.setAttribute('aria-label', 'Refresh ' + label + ' with a new check');
    refresh.addEventListener('click', () => { if (busy) return; if (row.coin && row.side) checkPosition(row.address, row); else { $('address').value = row.address; runCheck(); } });
    const remove = el('button', 'btn-ghost danger', 'Remove'); remove.setAttribute('aria-label', 'Remove ' + label);
    remove.addEventListener('click', () => {
      if (row.monitorToken) { setStatus('Turn Monitor off before removing this saved position.', true); return; }
      const before = watched();
      const at = before.findIndex(a => watchIdentity(a) === watchIdentity(row));
      const after = before.filter(a => watchIdentity(a) !== watchIdentity(row));
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(after)); } catch {}
      // Focus goes to the card that took this one's place, or to the heading.
      const next = at >= 0 ? after[at] : null;
      renderWatched(next ? { identity: watchIdentity(next), control: 'open' } : { heading: true });
    });
    const name = el('input', 'watch-label'); name.type = 'text'; name.maxLength = 80;
    name.value = row.label || ''; name.placeholder = 'Name this position'; name.setAttribute('aria-label', 'Name saved position ' + label);
    // Renamed in place, not drawn again, so the field keeps focus.
    name.addEventListener('input', () => {
      const rows = watched(); const saved = rows.find(r => watchIdentity(r) === watchIdentity(row));
      if (!saved) return;
      saved.label = name.value.trim().slice(0, 80);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); fillSavedOpen(open, saved); }
      catch { setStatus('This browser could not save the position name.', true); }
    });
    const controls = { monitor: model.actions.includes('monitor') ? monitoring.button(row, label) : null, refresh, remove };
    const actions = el('div', 'cp-actions');
    actions.append(name, ...model.actions.map(action => controls[action]));
    card.append(open, actions);
    if (model.monitorOn) card.append(monitoring.notices(row));
    box.append(card);
    if (focus && focus.identity === watchIdentity(row)) (focus.control === 'monitor' && controls.monitor ? controls.monitor : open).focus();
  });
  if (focus && focus.heading) $('saved-title').focus();
}
$('watch-address').addEventListener('click', () => {
  if (!current || !ADDRESS_RE.test(current.address)) return;
  const candidate = { address: current.address.toLowerCase(), coin: current.positions.headlineCoin, side: current.positions.headlineSide,
    snapshotId: current.snapshotSaved !== false ? current.snapshotId : null, checkedAt: current.checkedAt };
  const rows = watched();
  const existing = rows.find(saved => watchIdentity(saved) === watchIdentity(candidate));
  if (!existing && rows.length >= 12) { setStatus('Your 12 saved-position slots are full. Remove one before saving another; existing readings and monitor controls are kept.', true); return; }
  const row = withReadingSummary(advanceSavedReading(existing || { ...candidate, snapshotId: null, label: '', previousSnapshotId: null }, current), current);
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify([row, ...rows.filter(a => watchIdentity(a) !== watchIdentity(row))]));
    recordUsage('watch_save', current); renderWatched(); $('watch-address').textContent = 'Saved';
    $('save-confirmation').hidden = false; $('saved-position-name').value = row.label;
    $('save-confirmation-text').textContent = row.snapshotId
      ? row.snapshotId !== current.snapshotId || current.snapshotSaved === false
        ? 'Kept your previously saved reading from ' + fmtTime(row.checkedAt) + '. This older or unsaved reading did not replace it. The link below opens the retained reading.'
        : 'Saved in this browser. Open the dated reading again free; Refresh runs a new check.'
      : 'Position saved in this browser. This reading has no saved link; reopening fills in the wallet for a new check.';
    $('save-copy-link').hidden = !row.snapshotId;
    $('save-copy-link').dataset.snapshotId = row.snapshotId || '';
  }
  catch { setStatus('This browser cannot save a watchlist.', true); }
});
renderWatched();
monitoring.poll();
$('saved-position-name').addEventListener('input', () => {
  if (!current) return;
  const identity = watchIdentity({ address: current.address.toLowerCase(), coin: current.positions.headlineCoin, side: current.positions.headlineSide });
  const rows = watched(); const row = rows.find(r => watchIdentity(r) === identity);
  if (!row) return;
  row.label = $('saved-position-name').value.trim().slice(0, 80);
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); renderWatched(); }
  catch { setStatus('This browser could not save the position name.', true); }
});
$('save-copy-link').addEventListener('click', () => copyReadingLink($('save-copy-link'), $('save-copy-link').dataset.snapshotId));
$('open-saved-positions').addEventListener('click', openSaved);

$('player-queue').addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; e.preventDefault(); recordUsage('example_open'); openSnapshot(new URL(a.href).searchParams.get('s'), 'push'); });
