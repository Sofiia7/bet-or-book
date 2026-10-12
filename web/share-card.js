export function createShareCard({getCurrent, $, verdictOf, badgeText, headlineFor, fmtTime, shortAddr, drawConstellation, constellationInputsFor, constellationStatFor, constellationStatLabelFor, constellationQualityNoteFor, constellationQualityFlagFor}) {
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
  if (constellationQualityNoteFor(d)) {
    ctx.fillStyle = '#f2b35c';
    ctx.font = font(600, 14);
    ctx.fillText(constellationQualityFlagFor(d).toUpperCase(), x + w / 2, y + h / 2 + 43);
  }
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
  const d = getCurrent();
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
  const showConstellation = isBook && !Number.isFinite(d.orders.headlineTwoSidedNotionalUsd)
    ? false : isBook || (b && b.applies && b.segments.length > 0) || isLong;

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


return {drawCard};
}
