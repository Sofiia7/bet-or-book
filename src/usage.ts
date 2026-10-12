/** Anonymous, bounded product events; no wallet, input, URL or identity fields. */
export const USAGE_ACTIONS = ['landing_view', 'example_open', 'check_start', 'reading_view', 'share_copy', 'watch_save', 'repeat_read'] as const;
export interface UsageEvent {
  event: 'usage';
  outcome: (typeof USAGE_ACTIONS)[number];
  kind: 'none' | 'live' | 'saved' | 'gallery';
  entry: 'home' | 'shared_link';
  incomplete: boolean;
}

export async function readUsage(request: Request): Promise<UsageEvent | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let text = '';
  let bytes = 0;
  const decoder = new TextDecoder();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('event body timeout')), 3000);
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), expired]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256) { await reader.cancel(); return null; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const raw = JSON.parse(text + decoder.decode());
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (Object.keys(raw).some(key => !['action', 'kind', 'entry', 'incomplete'].includes(key))) return null;
    if (!USAGE_ACTIONS.includes(raw.action) || !['none', 'live', 'saved', 'gallery'].includes(raw.kind)
      || !['home', 'shared_link'].includes(raw.entry) || typeof raw.incomplete !== 'boolean') return null;
    return { event: 'usage', outcome: raw.action, kind: raw.kind, entry: raw.entry, incomplete: raw.incomplete };
  } catch { return null; }
  finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
