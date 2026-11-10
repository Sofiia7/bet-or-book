const identity = row => row.address + ':' + (row.coin || '') + ':' + (row.side || '');
export function createMonitoring({ read, write, render, status, fetchJson }) {
  let polling = false;
  async function request(body) {
    const res = await fetchJson('/api/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Monitoring unavailable');
    return data;
  }
  const update = (row, fields) => {
    const rows = read(); const saved = rows.find(r => identity(r) === identity(row));
    if (saved) { Object.assign(saved, fields); write(rows); }
  };
  async function poll() {
    if (polling || document.hidden) return;
    polling = true;
    let changed = false;
    try {
      for (const row of read().filter(r => r.monitorToken)) {
        try {
          const result = await request({ action: 'status', token: row.monitorToken });
          changed ||= row.monitorStatus !== result.status || row.monitorExpires !== result.expiresAt || JSON.stringify(row.monitorEvents) !== JSON.stringify(result.events);
          update(row, { monitorStatus: result.status, monitorEvents: result.events, monitorExpires: result.expiresAt });
        } catch (e) { changed ||= row.monitorStatus !== e.message; update(row, { monitorStatus: e.message }); }
      }
      if (changed && !document.activeElement?.closest('#watched input')) render();
    } catch { status('This browser could not keep monitoring state.', true); }
    finally { polling = false; }
  }
  // The Monitor switch on a saved card: a secondary button holding a 30 x 18
  // track, on while the position has a monitor token. A press moves it at
  // once, so its 150 ms slide plays here, before render() draws the list
  // again; if the server refuses, it moves back and the reason is shown.
  // `name` is the card's own name for its controls (savedRowName in
  // web/app.js), so two cards on the same coin are told apart. Focus stays
  // on the switch: render() is asked to put it back on the redrawn one.
  const button = (row, name) => {
    const on = !!row.monitorToken;
    const b = document.createElement('button'); b.className = 'btn-secondary monitor-toggle';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    const track = document.createElement('span'); track.className = 'switch'; track.setAttribute('aria-hidden', 'true');
    const knob = document.createElement('span'); knob.className = 'switch-knob';
    track.append(knob);
    b.append(track, 'Monitor');
    b.disabled = !row.monitorToken && !row.snapshotId;
    b.setAttribute('aria-label', 'Monitor ' + (name || row.label || row.coin || row.address) + ' (pilot)');
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.setAttribute('aria-checked', String(!on));
      try {
        if (row.monitorToken) {
          try { await request({ action: 'unsubscribe', token: row.monitorToken }); }
          catch (e) { if (!e.message.includes('expired')) throw e; }
          update(row, { monitorToken: null, monitorStatus: '', monitorEvents: [], monitorExpires: null });
        } else {
          const result = await request({ action: 'subscribe', snapshotId: row.snapshotId });
          update(row, { monitorToken: result.token, monitorExpires: result.expiresAt, monitorStatus: 'Scheduled · about every 4 hours; shared rate limits can pause checks', monitorEvents: [] });
        }
        render({ identity: identity(row), control: 'monitor' });
      } catch (e) { b.setAttribute('aria-checked', String(on)); status(e.message, true); b.disabled = false; b.focus(); }
    });
    return b;
  };
  function notices(row) {
    const box = document.createElement('div'); box.className = 'monitor-notices';
    if (!row.monitorToken) return box;
    const p = document.createElement('p'); p.className = 'search-help';
    p.textContent = (row.monitorStatus || 'Monitoring scheduled') + (row.monitorExpires ? ' · Ends ' + row.monitorExpires : '');
    box.append(p);
    for (const event of row.monitorEvents || []) {
      const a = document.createElement('a');
      a.href = '/?s=' + encodeURIComponent(event.snapshotId);
      a.textContent = event.at + ' · ' + event.changes.join('; ') + ' · Open reading';
      const item = document.createElement('p'); item.append(a); box.append(item);
    }
    return box;
  }
  setInterval(poll, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  return { button, notices, poll };
}
