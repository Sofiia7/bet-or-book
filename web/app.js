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
  // Test traffic and the operator reserve are not product engagement.
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
function verdictOf(d) {
  return VERDICTS[d.verdict.verdict] || VERDICTS.unknown;
}
function badgeText(d) {
  const base = verdictOf(d).label + (d.verdict.strength ? ' (' + d.verdict.strength + ')' : '');
  return d.verdict.verdict === 'unknown' && d.badgeQualifier ? base + ' · ' + d.badgeQualifier : base;
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
  const exploreStatus = $('explore-reading-status');
  exploreStatus.textContent = text;
  exploreStatus.className = s.className;
  exploreStatus.hidden = !text;
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
  const saved = watched().find(row => row.snapshotId === d.snapshotId && row.address === d.address.toLowerCase());
  const previousId = saved?.previousSnapshotId || d.supersedes;
  if (!previousId || !d.snapshotId || d.snapshotSaved === false || previousId === d.snapshotId) return;
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
  const named = (verdict, strength, qualifier) => (VERDICTS[verdict] || VERDICTS.unknown).label + (strength ? ' (' + strength + ')' : '') + (qualifier ? ' — ' + qualifier : '');
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

function renderBreakdown(d) {
  const box = $('breakdown');
  const isBook = d.verdict.verdict === 'book' && !!d.orders;
  if (isBook && !Number.isFinite(d.orders.headlineTwoSidedNotionalUsd)) { box.hidden = true; return; }
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
  document.body.classList.remove('exploring');
  $('gallery').hidden = true;
  current = d;
  current.__kind = kindOf(opts);
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
  // A new card starts folded: what the last one had open says nothing about
  // what the reader wants from this one.
  for (const id of ['full-analysis']) $(id).open = false;
  $('share').open = true;
  $('save-confirmation').hidden = true;
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
  $('badge').textContent = badgeText(d);
  // Faded and dashed when the rules that gave it are no longer in force, on
  // the card as it already was in the list.
  $('badge').className = 'badge ' + v.cls + (d.historical ? ' historical' : '');
  $('headline').textContent = headlineFor(d);
  $('takeaway').hidden = !d.takeaway;
  $('takeaway').textContent = d.takeaway || '';
  $('summary').textContent = d.summary || '';
  $('source-warning').hidden = !d.degraded;
  $('source-warning-text').textContent = d.source === 'hyperliquid'
    ? 'Positions from Hyperliquid main dex · other venues could not be verified.'
    : 'Incomplete reading · some sources could not be read.';
  const sourceNote = (d.coverage || []).find(text => /Nansen not used|Nansen did not answer|Nansen could not complete/.test(text));
  if (sourceNote) $('source-warning-text').textContent = sourceNote;
  const unavailable = /credits|budget|no API key configured/.test(sourceNote || '');
  $('source-free-examples').hidden = !unavailable;
  $('try-again').hidden = unavailable;
  if (unavailable) $('source-warning-text').textContent = 'Full live coverage is temporarily unavailable. This reading covers the main venue only; it does not settle the wallet’s exposure.';
  $('watch-address').textContent = watched().some(row => row.address === d.address && row.coin === d.positions.headlineCoin && row.side === d.positions.headlineSide) ? 'Saved to your watchlist' : 'Save this position';
  $('what-changes').hidden = !d.whatChanges;
  $('what-changes').textContent = d.whatChanges ? 'What would change this: ' + d.whatChanges : '';

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
  // Keep the universal limit visible unless the open question already
  // covers all three blind spots. The full analysis then carries it.
  const question = (d.openQuestion || '').toLowerCase();
  const repeatsLimit = /exchange/.test(question) && /over.the.counter|otc/.test(question) && /wallet/.test(question) && /link/.test(question);
  $('standing-limit').hidden = repeatsLimit;
  $('analysis-limit').hidden = !repeatsLimit;
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
    box.append(el('div', 'stat-label', item.label), el('div', 'stat-value', value), el('div', 'stat-source', item.source));
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
  // Which position this answer is about, said before the answer. The
  // picker says it when there is a choice to offer; otherwise this line does.
  $('subject').hidden = !$('picker').hidden;
  $('subject').replaceChildren(
    el('span', 'muted', d.focus ? 'The position asked about' : 'The position'),
    ' ',
    el('strong', null, positionText(d)),
    ' ',
    el('span', 'muted', '· ' + shortAddr(d.address)),
  );
  renderChanged(d);
  renderBreakdown(d);

  // The decisive number now leads the card on its own (25.09 audit, the
  // "hero numbers" redesign) - it is no longer suppressed just because the
  // diagram repeats the same fact. That is a real tradeoff, not a settled
  // one: in most cases the tile and the diagram now do say the same thing
  // twice, and the diagram is kept anyway as the visual backup for that
  // repetition. drawCard() and the OG preview use the diagram or a decisive
  // tile, while the interactive card can show both.
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
      source: 'Nansen · ownership unverified',
      decisive: true,
    });
  }
  for (const item of (d.evidence || [])) {
    if (heroTiles.length >= 2) break;
    if (['Largest position', 'Position asked about', 'Share of exposure'].includes(item.label)) continue;
    if (!heroTiles.some((shown) => shown.label === item.label)) heroTiles.push(item);
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
  const src = d.source === 'nansen' ? 'positions from Nansen' : 'positions from Hyperliquid main dex';
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
  const relativeAge = ageMin < 1 ? 'just now' : ageMin < 60 ? plural(ageMin, 'minute') + ' ago' : ageMin < 1440 ? plural(Math.floor(ageMin / 60), 'hour') + ' ago' : plural(Math.floor(ageMin / 1440), 'day') + ' ago';
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
  $('snapshot-text').textContent = '';
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
      'Saved · ' + fmtTime(d.checkedAt) + '.';
  }
  $('snapshot').hidden = false;
  $('snapshot-text').textContent += (kind === 'live' ? 'Read ' + fmtTime(d.checkedAt) + '. ' : ' ') + relativeAge + '.';
  const risks = (d.vitals || []).filter(item => /leverage|liquidation/i.test(item.label)).slice(0, 2);
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
  const claim = current?.snapshotId === id && isClaim($('claim-choice').value) ? '&claim=' + $('claim-choice').value : '';
  const next = id ? '/?s=' + encodeURIComponent(id) + claim : '/';
  if (window.location.pathname + window.location.search + window.location.hash !== next) {
    window.history.replaceState(null, '', next);
  }
}

function setBusy(on) {
  busy = on;
  if (!on) $('slow-check').hidden = true;
  $('check-progress').hidden = !on;
  $('check').disabled = on;
  $('check').textContent = on ? 'Checking...' : 'Check position';
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
    recordUsage('check_start');
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
    '/api/check?context=0&address=' + encodeURIComponent(address) +
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

function openSnapshot(id, navigation = 'replace') {
  takeOver();
  return load(
    '/api/snapshot?id=' + encodeURIComponent(id),
    (data) => {
      // The server says which of the two this is: a gallery card opened by
      // its link is still a gallery card, with the gallery's own wording.
      renderResult(data, { kind: data.kind === 'gallery' ? 'gallery' : 'saved' });
      if (navigation === 'push') window.history.pushState(null, '', window.location.href);
      if (navigation !== 'preserve') showLink(id);
      $('card').scrollIntoView({ block: 'start' });
      $('card').focus({ preventScroll: true });
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
$('check-another').addEventListener('click', () => {
  showExamples();
  $('address').value = '';
  $('address-choices').hidden = true;
  $('address').focus({ preventScroll: true });
  $('address').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

function showExamples() {
  document.body.classList.remove('exploring');
  $('gallery').hidden = true;
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
}
$('back-examples').addEventListener('click', () => {
  showExamples();
  $('examples').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('player-queue').querySelector('button')?.focus({ preventScroll: true });
});
$('nav-examples').addEventListener('click', (event) => {
  event.preventDefault();
  showExamples();
  $('examples').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('nav-how-it-works').addEventListener('click', (event) => {
  // A native fragment navigation emits popstate, whose page routing resets
  // the address. This section only needs scrolling, with no history change.
  event.preventDefault();
  $('how-it-works').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  $('gallery').hidden = false;
  $('explore-return').hidden = !current;
  setStatus('');
  if (window.location.hash !== '#explore') window.history.pushState(null, '', window.location.pathname + window.location.search + '#explore');
  window.scrollTo(0, 0);
  $('explore-title').focus({ preventScroll: true });
  ensureGallery();
}
$('nav-boards').addEventListener('click', openBoards);
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
  $('card').scrollIntoView({ block: 'start' });
  $('card').focus({ preventScroll: true });
});
function selectExploreView(view) {
  for (const [key, panel] of [['cases', 'case-studies'], ['ranked', 'boards-fold'], ['all', 'all-readings'], ['archive', 'archive']]) {
    $(panel).hidden = key !== view;
    $('explore-' + key).setAttribute('aria-pressed', String(key === view));
  }
  if (view === 'archive') $('archive').open = true;
}
for (const view of ['cases', 'ranked', 'all', 'archive']) $('explore-' + view).addEventListener('click', () => selectExploreView(view));
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(window.location.search).get('s');
  if (window.location.hash === '#explore') {
    if (id && current?.snapshotId !== id) return openSnapshot(id, 'preserve').then(() => openBoards());
    return openBoards();
  }
  if (id) openSnapshot(id);
  else showExamples();
});

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

async function copyReadingLink(btn) {
  if (!current) return;
  askForPicture(current);
  // The link opens this reading, not a new check of this account. Without a
  // snapshot id there is nothing saved to point at, so it falls back to the
  // address and the button says which one it gave.
  const savedLink = savedReadingLink(current, window.location.origin);
  const claim = $('claim-choice').value;
  const link = savedLink ? savedLink + (isClaim(claim) ? '&claim=' + claim : '') : window.location.origin + '/?address=' + encodeURIComponent(current.address);
  try {
    await navigator.clipboard.writeText(link);
    recordUsage('share_copy', current);
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = btn.id === 'save-copy-link' ? 'Copy saved reading link'
      : savedReadingLink(current || {}, window.location.origin) ? 'Copy link' : 'Copy wallet link'; }, 1500);
  } catch (e) {
    window.prompt('Copy this link:', link);
  }
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
    attribution: d.source === 'nansen' ? 'Powered by @nansen_ai' : 'Data: Hyperliquid',
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
    btn.textContent = 'Reading copied'; setTimeout(() => { btn.textContent = 'Copy reading'; }, 1500);
  } catch { window.prompt('Copy this reading:', text); }
});
$('copy-link').addEventListener('click', () => copyReadingLink($('copy-link')));
$('copy-embed').addEventListener('click', async () => {
  if (!current || !savedReadingLink(current, window.location.origin)) return;
  const claim = $('claim-choice').value;
  const url = window.location.origin + '/embed?s=' + encodeURIComponent(current.snapshotId) + (isClaim(claim) ? '&claim=' + claim : '');
  const code = '<iframe src="' + url + '" title="Bet or Book dated position evidence" width="100%" height="600" loading="lazy" style="border:0;border-radius:12px"></iframe>';
  try { await navigator.clipboard.writeText(code); $('copy-embed').textContent = 'Embed copied'; setTimeout(() => { $('copy-embed').textContent = 'Copy embed'; }, 1500); }
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
      btn.textContent = 'Opened X - paste the image (Ctrl+V) before posting';
      setTimeout(() => { btn.textContent = 'Share on X'; }, 4000);
    } catch (e) {
      // The tab with the text is already open either way; only the image
      // did not make it to the clipboard, so there is nothing to undo here.
      btn.textContent = 'Opened X · use Download PNG to attach the card';
      setTimeout(() => { btn.textContent = 'Share on X'; }, 5000);
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

const {drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor} = createConstellation({fmtPct});
const {drawCard}=createShareCard({getCurrent:()=>current, $, verdictOf, badgeText, headlineFor, fmtTime, shortAddr, drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor});
const {loadGallery, renderPlayer}=createExplore({$, el, verdictOf, badgeText, positionText, shortAddr, plural, fmtUsd, fmtPct, fmtTime, recordUsage, openSnapshot, getCurrent:()=>current, publishGallery:g=>{gallery=g;}, timedFetch, VERDICTS, PAGE_SIZE, MATERIAL_GAP_SHARE});

// Explore loads its list on demand; the bundled example links work immediately.
if (window.location.hash === '#operator') setUpOperator();
const params = new URLSearchParams(window.location.search);
const saved = params.get('s');
const preset = params.get('address');
if (window.location.hash === '#explore') {
  if (saved) openSnapshot(saved, 'preserve').then(() => openBoards());
  else openBoards();
} else if (saved) {
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
}
renderRecent();
recordUsage('landing_view');

// Put the question, answer, decisive facts and actions before the picture.
// The longer explanation and all account-level risk metrics remain available.
$('subject').insertAdjacentElement('afterend', $('snapshot'));
$('headline').insertAdjacentElement('afterend', $('takeaway'));
$('takeaway').insertAdjacentElement('afterend', document.querySelector('.evidence-preview'));
document.querySelector('.evidence-preview').insertAdjacentElement('afterend', $('reading-actions'));
$('reading-actions').insertAdjacentElement('afterend', $('risk-preview'));
$('risk-preview').insertAdjacentElement('afterend', $('changed'));
$('changed').insertAdjacentElement('afterend', $('open-question'));
$('open-question').insertAdjacentElement('afterend', $('claim-checker'));
$('full-analysis').querySelector('summary').insertAdjacentElement('afterend', $('summary'));
$('try-again').addEventListener('click', () => {
  if (!current || busy) return;
  let url = '/api/check?context=0&address=' + encodeURIComponent(current.address) + '&retry=1';
  if (current.focus) url += '&coin=' + encodeURIComponent(current.focus.coin) + '&side=' + current.focus.side;
  load(url, data => { renderResult(data, { kind: 'live' }); showLink(data.snapshotSaved !== false ? data.snapshotId : null); askForPicture(data); }, 'Could not complete the reading. Try again shortly.', 'POST');
});
$('load-context').addEventListener('click', () => {
  if (!current || busy) return;
  let url = '/api/check?context=1&address=' + encodeURIComponent(current.address);
  if (current.focus) url += '&coin=' + encodeURIComponent(current.focus.coin) + '&side=' + current.focus.side;
  load(url, data => { renderResult(data, { kind: 'live' }); showLink(data.snapshotSaved !== false ? data.snapshotId : null); askForPicture(data); }, 'Optional context could not be loaded.', 'POST');
});
$('source-free-examples').addEventListener('click', () => { showExamples(); $('examples').scrollIntoView({ block: 'start' }); });
$('use-example').addEventListener('click', () => {
  recordUsage('example_open');
  const link = $('player-queue').querySelector('a[href]');
  if (!link && gallery?.featured?.[0]) return openSnapshot(gallery.featured[0].snapshotId);
  if (link) openSnapshot(new URL(link.href, window.location.origin).searchParams.get('s'));
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
        label: typeof row.label === 'string' ? row.label.trim().slice(0, 80) : '' }))
      .slice(0, 12) : [];
  } catch { return []; }
}
const watchIdentity = row => row.address + ':' + (row.coin || '') + ':' + (row.side || '');
const monitoring = createMonitoring({ read: watched, write: rows => localStorage.setItem(WATCH_KEY, JSON.stringify(rows)), render: renderWatched, status: setStatus, fetchJson: timedFetch });
function updateSavedPosition(d) {
  if (!d.snapshotId || d.snapshotSaved === false) return;
  const identity = watchIdentity({ address: d.address.toLowerCase(), coin: d.positions.headlineCoin, side: d.positions.headlineSide });
  const rows = watched();
  const row = rows.find(r => watchIdentity(r) === identity);
  if (!row || (row.checkedAt && Date.parse(d.checkedAt) < Date.parse(row.checkedAt))) return;
  Object.assign(row, advanceSavedReading(row, d));
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); renderWatched(); } catch {}
}
function renderWatched() {
  let box = $('watched');
  if (!box) {
    box = el('div', 'examples'); box.id = 'watched'; box.tabIndex = -1;
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Your saved positions');
    $('recent').insertAdjacentElement('afterend', box);
  }
  const rows = watched(); box.hidden = rows.length === 0; box.replaceChildren();
  if (!rows.length) return;
  box.append(el('p', 'search-help', 'Saved positions · this browser only. Open a saved reading free; Refresh runs a new check.'));
  box.append(el('p', 'search-help', 'Optional monitoring: 4 pilot slots, about every 4 hours for 72 hours. Stores the public wallet and reading question on the server; alerts appear here. The shared budget can pause checks.'));
  rows.forEach(row => {
    const label = (row.label ? row.label + ' · ' : '') + (row.coin ? row.coin + ' ' + row.side + ' · ' : '') + shortAddr(row.address);
    const group = el('div', 'watch-row');
    const b = el('button', 'chip', label + (row.snapshotId ? ' · Open saved' : ' · Check address'));
    b.addEventListener('click', () => {
      if (row.snapshotId) openSnapshot(row.snapshotId, 'push');
      else { showExamples(); $('address').value = row.address; $('address').focus(); setStatus('Address filled in. Press Check to run a reading.'); }
    });
    const refresh = el('button', 'chip', 'Refresh'); refresh.setAttribute('aria-label', 'Refresh ' + label + ' with a new check');
    refresh.addEventListener('click', () => { if (busy) return; if (row.coin && row.side) checkPosition(row.address, row); else { $('address').value = row.address; runCheck(); } });
    const remove = el('button', 'chip', 'Remove'); remove.setAttribute('aria-label', 'Remove ' + label);
    remove.addEventListener('click', () => { if (row.monitorToken) { setStatus('Stop monitoring before removing this saved position.', true); return; } try { localStorage.setItem(WATCH_KEY, JSON.stringify(watched().filter(a => watchIdentity(a) !== watchIdentity(row)))); } catch {} renderWatched(); });
    const name = el('input', 'watch-label'); name.type = 'text'; name.maxLength = 80;
    name.value = row.label || ''; name.placeholder = 'Name this position'; name.setAttribute('aria-label', 'Name saved position ' + label);
    name.addEventListener('input', () => {
      const rows = watched(); const saved = rows.find(r => watchIdentity(r) === watchIdentity(row));
      if (!saved) return;
      saved.label = name.value.trim().slice(0, 80);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(rows)); b.textContent = (saved.label ? saved.label + ' · ' : '') + (row.coin ? row.coin + ' ' + row.side + ' · ' : '') + shortAddr(row.address) + (row.snapshotId ? ' · Open saved' : ' · Check address'); }
      catch { setStatus('This browser could not save the position name.', true); }
    });
    group.append(b, refresh, name, monitoring.button(row), remove, monitoring.notices(row));
    if (row.checkedAt) group.append(el('span', 'search-help', ' Read ' + fmtTime(row.checkedAt)));
    box.append(group);
  });
}
$('watch-address').addEventListener('click', () => {
  if (!current || !ADDRESS_RE.test(current.address)) return;
  const row = { address: current.address.toLowerCase(), coin: current.positions.headlineCoin, side: current.positions.headlineSide,
    snapshotId: current.snapshotSaved !== false ? current.snapshotId : null, checkedAt: current.checkedAt };
  const existing = watched().find(saved => watchIdentity(saved) === watchIdentity(row));
  row.label = existing?.label || '';
  row.previousSnapshotId = existing?.snapshotId === row.snapshotId ? existing.previousSnapshotId : null;
  if (existing?.monitorToken) Object.assign(row, { monitorToken: existing.monitorToken, monitorStatus: existing.monitorStatus, monitorExpires: existing.monitorExpires, monitorEvents: existing.monitorEvents });
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify([row, ...watched().filter(a => watchIdentity(a) !== watchIdentity(row))].slice(0, 12)));
    recordUsage('watch_save', current); renderWatched(); $('watch-address').textContent = 'Saved to your watchlist';
    $('save-confirmation').hidden = false; $('saved-position-name').value = row.label;
    $('save-confirmation-text').textContent = row.snapshotId
      ? 'Saved in this browser. Open the dated reading again free; Refresh runs a new check.'
      : 'Position saved in this browser. This reading has no saved link; reopening fills in the wallet for a new check.';
    $('save-copy-link').hidden = !row.snapshotId;
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
$('save-copy-link').addEventListener('click', () => copyReadingLink($('save-copy-link')));
$('open-saved-positions').addEventListener('click', () => {
  showExamples(); $('watched').scrollIntoView({ block: 'center' }); $('watched').focus({ preventScroll: true });
});

$('player-queue').addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; e.preventDefault(); recordUsage('example_open'); openSnapshot(new URL(a.href).searchParams.get('s')); });
