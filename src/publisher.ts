import type { CheckResponse } from './api/check';
import { readingHeadline, evidenceTakeaway, VERDICT_STYLES } from './engine/presentation';
import { formatUsd } from './engine/evidence';
import { CLAIMS, checkClaim, isClaim } from './engine/claims';
import { PERMANENT_LIMIT } from './engine/share';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Stable read-only pilot DTO. No live requests, account keys or budget metadata. */
export function publisherReading(r: CheckResponse, id: string, origin: string, assertion?: unknown) {
  const claim = isClaim(assertion) ? assertion : null;
  return { schema: 'bet-or-book.reading.v1', id, checkedAt: r.checkedAt, observedAt: r.observedAt,
    position: { coin: r.positions.headlineCoin, side: r.positions.headlineSide, notionalUsd: r.positions.headlineNotionalUsd },
    conclusion: VERDICT_STYLES[r.verdict.verdict].label, headline: readingHeadline(r),
    takeaway: evidenceTakeaway(r), historical: !!r.historical, incomplete: r.degraded,
    evidence: r.evidence, limits: [PERMANENT_LIMIT, ...(r.coverageNotes ?? []).filter(n => n.failure).map(n => n.text)],
    attribution: r.source === 'nansen' ? 'Powered by Nansen API' : 'Hyperliquid API',
    claim: claim ? { assertion: CLAIMS[claim], ...checkClaim(r, claim) } : null,
    link: origin + '/?s=' + encodeURIComponent(id) + (claim ? '&claim=' + claim : '') };
}
export function publisherEmbed(r: CheckResponse, id: string, origin: string, assertion?: unknown): string {
  const data = publisherReading(r, id, origin, assertion);
  const position = data.position.coin ? `${formatUsd(data.position.notionalUsd)} ${data.position.coin} ${data.position.side}` : 'No position found';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bet or Book saved reading</title><style>
  *{box-sizing:border-box}body{margin:0;background:#0b0d10;color:#e8e9ee;font:14px/1.5 system-ui,sans-serif}article{padding:20px;border:1px solid #30343e;border-radius:12px}h1{font-size:20px;margin:8px 0}p{margin:8px 0}.muted{color:#a4abba;font-size:12px}a{color:#a4baff}ul{padding-left:20px}li{margin:5px 0}body{overflow-wrap:anywhere}</style></head><body><article aria-label="Dated position evidence"><p class="muted">Bet or Book · ${escape(data.conclusion)}</p><h1>${escape(position)}</h1><p class="muted">Read ${escape(data.checkedAt)}${data.incomplete ? ' · Incomplete evidence' : ''}${data.historical ? ' · Historical rules' : ''}</p><p>${escape(data.headline)}</p><p>${escape(data.takeaway)}</p>${data.claim ? `<p><strong>${escape(data.claim.assertion)}: ${escape(data.claim.status)}</strong><br>${escape(data.claim.explanation)}</p>` : ''}<ul>${data.evidence.slice(0, 3).map(e => `<li>${escape(e.label)}: ${escape(e.value)} <span class="muted">(${escape(e.source)})</span></li>`).join('')}</ul><p class="muted">${escape(data.limits.join(' '))}</p><p><a href="${escape(data.link)}" target="_blank" rel="noopener noreferrer">Open dated reading · free →</a></p><p class="muted">${escape(data.attribution)} · This tool never trades.</p></article></body></html>`;
}
