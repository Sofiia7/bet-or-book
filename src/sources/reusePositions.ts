import type { NansenClient, NansenPerpPositions } from './nansen';
import type { KVLike } from '../kv';
/** Reuse source positions briefly when a reader changes the selected asset.
 * Keeps the provider timestamp. Never reuses failed/absent responses.
 * Other sources are still read for the newly selected question. */
export function reusePositions(client: NansenClient, kv: KVLike, now = Date.now): NansenClient {
  return { ...client, async perpPositions(address) {
    const key = 'source-positions:v1:' + address;
    try {
      const raw = await kv.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as { at: number; data: NansenPerpPositions };
        if (now() >= entry.at && now() - entry.at <= 60_000 && Array.isArray(entry.data?.asset_positions)) return entry.data;
      }
    } catch { /* cache failures do not prevent a live read */ }
    const data = await client.perpPositions(address);
    if (data && Array.isArray(data.asset_positions)) {
      try { await kv.put(key, JSON.stringify({ at: now(), data }), { expirationTtl: 60 }); } catch { /* optional cache */ }
    }
    return data;
  } };
}
