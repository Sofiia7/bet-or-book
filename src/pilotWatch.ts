import { DurableObject } from 'cloudflare:workers';
import type { CheckResponse } from './api/check';
import { meaningfulChanges } from './engine/alertChanges';

const MAX_WATCHES = 4;
const INTERVAL = 4 * 3_600_000;
const LIFETIME = 72 * 3_600_000;
interface Watch {
  id: string; token: string; address: string; focus: CheckResponse['focus'];
  baseline: CheckResponse; createdAt: number; dueAt: number; expiresAt: number;
  status: string; events: Array<{ at: string; snapshotId: string; changes: string[] }>;
  lease?: number;
}
interface WatchState { watches: Watch[]; claimedAt: number }
function sameToken(a: string, b: string | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
/** One global pilot coordinator: atomic capacity and one job per cron hour. */
export class PilotWatch extends DurableObject {
  protected now(): number { return Date.now(); }
  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as { action: string; baseline?: CheckResponse; token?: string; id?: string; result?: CheckResponse; lease?: number; error?: string };
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = this.now();
      const state = await this.ctx.storage.get<WatchState>('pilot') ?? { watches: [], claimedAt: 0 };
      // Pin pre-v10 subscriptions to their original question before another job.
      let migrated = false;
      for (const watch of state.watches) {
        if (!watch.focus && watch.baseline.positions.headlineCoin && watch.baseline.positions.headlineSide) {
          watch.focus = { coin: watch.baseline.positions.headlineCoin, side: watch.baseline.positions.headlineSide };
          watch.baseline = { ...watch.baseline, focus: watch.focus };
          migrated = true;
        }
      }
      if (migrated) await this.ctx.storage.put('pilot', state);
      const active = state.watches.filter(w => w.expiresAt > now);
      if (active.length !== state.watches.length) { state.watches = active; await this.ctx.storage.put('pilot', state); }
      if (body.action === 'subscribe' && body.baseline?.snapshotId) {
        const focus = body.baseline.focus ?? (body.baseline.positions.headlineCoin && body.baseline.positions.headlineSide ? { coin: body.baseline.positions.headlineCoin, side: body.baseline.positions.headlineSide } : null);
        if (!focus) return Response.json({ error: 'Choose an open position to monitor' }, { status: 400 });
        body.baseline = { ...body.baseline, focus };
        if (state.watches.some(w => w.address === body.baseline!.address && JSON.stringify(w.focus) === JSON.stringify(body.baseline!.focus))) return Response.json({ error: 'This position already has a pilot monitor. Save it and refresh manually until that monitor expires.' }, { status: 409 });
        if (state.watches.length >= MAX_WATCHES) return Response.json({ error: 'The four pilot monitoring slots are full. Save this position and refresh manually.' }, { status: 409 });
        const watch: Watch = { id: crypto.randomUUID(), token: crypto.randomUUID() + crypto.randomUUID(),
          address: body.baseline.address, focus: body.baseline.focus, baseline: body.baseline,
          createdAt: now, dueAt: now + INTERVAL, expiresAt: now + LIFETIME, status: 'Scheduled; data budget can pause checks', events: [] };
        state.watches.push(watch);
        await this.ctx.storage.put('pilot', state);
        return Response.json({ token: watch.token, expiresAt: new Date(watch.expiresAt).toISOString(), intervalHours: 4 });
      }
      if (body.action === 'claim') {
        if (state.claimedAt && Math.floor(now / 3_600_000) === Math.floor(state.claimedAt / 3_600_000)) return Response.json(null);
        const watch = state.watches.filter(w => w.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (!watch) return Response.json(null);
        state.claimedAt = now; watch.lease = now; watch.dueAt = now + INTERVAL;
        await this.ctx.storage.put('pilot', state);
        return Response.json({ id: watch.id, address: watch.address, focus: watch.focus, lease: now });
      }
      if (body.action === 'complete') {
        const watch = state.watches.find(w => w.id === body.id);
        if (!watch || watch.lease !== body.lease || body.lease === undefined) return Response.json({ ok: false });
        delete watch.lease;
        if (!body.result?.snapshotId || body.result.snapshotSaved === false || body.result.degraded || body.result.verdict.reasons.includes('positions_stale') || body.result.address !== watch.address || JSON.stringify(body.result.focus ?? null) !== JSON.stringify(watch.focus ?? null)) {
          watch.status = 'Paused for this cycle: complete saved data unavailable. No unchanged-position claim.';
        } else if (body.result.snapshotId === watch.baseline.snapshotId || Date.parse(body.result.checkedAt) <= Date.parse(watch.baseline.checkedAt)) {
          watch.status = 'Paused for this cycle: no newer saved reading available. The previous evidence remains the baseline.';
        } else {
          const changes = meaningfulChanges(watch.baseline, body.result);
          if (changes.length) watch.events = [{ at: body.result.checkedAt, snapshotId: body.result.snapshotId, changes }, ...watch.events].slice(0, 5);
          if (Date.parse(body.result.checkedAt) >= Date.parse(watch.baseline.checkedAt)) watch.baseline = body.result;
          watch.status = 'Checked ' + body.result.checkedAt + (changes.length ? ' · meaningful change found' : ' · no material change detected');
        }
        await this.ctx.storage.put('pilot', state);
        return Response.json({ ok: true });
      }
      // The token is an unguessable browser capability. Never return it in status.
      const watch = state.watches.find(w => sameToken(w.token, body.token));
      if (!watch) return Response.json({ error: 'Monitoring expired or not found' }, { status: 404 });
      if (body.action === 'unsubscribe') {
        state.watches = state.watches.filter(w => w.id !== watch.id);
        await this.ctx.storage.put('pilot', state);
        return Response.json({ ok: true });
      }
      if (body.action !== 'status') return Response.json({ error: 'Unknown action' }, { status: 400 });
      return Response.json({ status: watch.status, expiresAt: new Date(watch.expiresAt).toISOString(), events: watch.events });
    });
  }
}
