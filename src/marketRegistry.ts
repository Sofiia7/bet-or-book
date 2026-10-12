export interface PerpVenue { name: string; fullName: string; deployer: string; oracleUpdater: string | null }
/** Registry membership is provenance, not proof of a ticker's underlying. */
export function parsePerpVenues(raw: unknown): PerpVenue[] {
  if (!Array.isArray(raw)) throw new Error('Invalid perp registry');
  const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v);
  const result: PerpVenue[] = [];
  for (const item of raw) {
    if (item === null) continue; // main dex
    if (!item || typeof item !== 'object') throw new Error('Invalid perp venue');
    const row = item as Record<string, unknown>;
    if (typeof row.name !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(row.name) || !address(row.deployer)) throw new Error('Invalid perp venue');
    if (row.oracleUpdater !== null && !address(row.oracleUpdater)) throw new Error('Invalid oracle updater');
    result.push({ name: row.name, fullName: typeof row.fullName === 'string' ? row.fullName.slice(0, 120) : row.name,
      deployer: row.deployer, oracleUpdater: row.oracleUpdater });
  }
  if (new Set(result.map(v => v.name)).size !== result.length) throw new Error('Duplicate perp venue');
  return result;
}
