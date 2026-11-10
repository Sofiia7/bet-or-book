import type { Position } from '../types';
import type { KVLike } from '../kv';
import type { SourceCoverage } from '../engine/verdict';
import { dexNamesOf, dexOf, getClearinghouseState, getPerpDexRegistry, type HlClearinghouseState } from './hyperliquid';
import { normalizePositions, UpstreamShapeError } from './normalize';

export interface AllDexPositions {
  /** Main dex first, then the named dexes in registry order. */
  positions: Position[];
  /** 'complete' only when every asked dex answered and the registry was read. */
  coverage: SourceCoverage;
  /** The OLDEST `time` among the answers, ms; null when none carried one. */
  measuredAt: number | null;
  /** The main dex counts as one. */
  venues: { asked: number; answered: number; registryRead: boolean };
  /** Named dexes that did not answer, or answered with a wrong shape. */
  failed: string[];
  /** Positions on the main dex alone. */
  mainDexCount: number;
  /** Raw main-dex answer, for the account vitals. */
  mainState: HlClearinghouseState;
  /** The `perpDexs` answer the dex names were taken from this time, fresh or
   * cached; null when it was not read. Market provenance reads the same answer. */
  registry: unknown[] | null;
}

export type PositionsReader = (address: string, signal?: AbortSignal) => Promise<AllDexPositions>;

const REGISTRY_KEY = 'perp-dex-registry:v1';
/** The list of dexes changes when a deployer launches one, which is rare;
 * an hour late to notice a new dex costs one reading with a missing venue. */
const REGISTRY_TTL_SECONDS = 3600;

async function cachedRegistry(kv: KVLike | undefined): Promise<unknown[] | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(REGISTRY_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // A cached value is only as trustworthy as what wrote it, so it must still
    // yield dex names the way a fresh answer does.
    dexNamesOf(parsed);
    return parsed;
  } catch {
    // A cache that cannot be read is a cache that is not there.
    return null;
  }
}

/** The registry, or null when it could not be read. Never rejects: a missing
 * list makes the reading partial, it does not end it. */
async function readRegistry(signal: AbortSignal | undefined, kv: KVLike | undefined): Promise<unknown[] | null> {
  const cached = await cachedRegistry(kv);
  if (cached) return cached;
  let registry: unknown[];
  try {
    const raw = await getPerpDexRegistry(signal);
    dexNamesOf(raw);
    registry = raw as unknown[];
  } catch {
    return null;
  }
  // Written only after a successful read, so a failure is asked again next time.
  if (kv) {
    try {
      await kv.put(REGISTRY_KEY, JSON.stringify(registry), { expirationTtl: REGISTRY_TTL_SECONDS });
    } catch {
      // The cache is an optimisation.
    }
  }
  return registry;
}

/** The answer's own timestamp, if it has a usable one. */
function answeredAt(state: HlClearinghouseState): number | null {
  const time = (state as { time?: unknown } | null)?.time;
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null;
}

/**
 * Every position an account holds on Hyperliquid: the main perp dex plus each
 * named (HIP-3) dex. One `clearinghouseState` answers for one dex only, so
 * reading the main dex alone would report an account with positions on `xyz`
 * as having none there.
 *
 * The main dex is the account; if it cannot be read the call rejects rather
 * than guessing. A named dex that cannot be read is reported in `failed` and
 * the reading is `partial`, so a rule that says "nothing is held there" can
 * tell it was not shown the whole book.
 *
 * Each answer is also checked to be for the dex it was asked of. An endpoint
 * that ignored `dex` would answer every dex with the main one, and every main
 * position would be listed once per dex. A named dex whose answer holds a
 * position that is not its own is failed whole; a main-dex answer that holds
 * a named dex's position rejects the call, since those positions would be
 * counted again under the dex that owns them.
 */
export async function readAllDexPositions(
  address: string,
  opts: { signal?: AbortSignal; kv?: KVLike } = {},
): Promise<AllDexPositions> {
  const { signal, kv } = opts;

  const [mainState, registry] = await Promise.all([getClearinghouseState(address, signal), readRegistry(signal, kv)]);
  const names = registry === null ? null : dexNamesOf(registry);
  const mainPositions = normalizePositions(mainState);
  const strayOnMain = mainPositions.find((p) => dexOf(p.coin) !== null);
  if (strayOnMain) {
    throw new UpstreamShapeError(
      `the main dex answered with named-dex positions (${strayOnMain.coin}); they would be counted twice`,
    );
  }
  // A name listed twice must not be read twice: its positions would be counted twice.
  const dexes = names === null ? [] : [...new Set(names)];

  // Once the check's deadline has passed, every request below would fail and
  // be reported as an unreadable dex; that is the deadline, not a finding.
  signal?.throwIfAborted();
  const settled = await Promise.allSettled(
    dexes.map(async (dex) => {
      const state = await getClearinghouseState(address, signal, dex);
      return { state, positions: normalizePositions(state) };
    }),
  );
  // A request cut short by the deadline looks like any other failed dex, and
  // a reading made of those must not be passed on as an answer.
  signal?.throwIfAborted();

  const positions = [...mainPositions];
  const failed: string[] = [];
  const times: number[] = [];
  const mainTime = answeredAt(mainState);
  if (mainTime !== null) times.push(mainTime);
  settled.forEach((result, i) => {
    if (result.status === 'rejected') {
      failed.push(dexes[i]);
      return;
    }
    // An empty answer is fine. A position that is not this dex's own means the
    // answer is not this dex's, and none of it is taken.
    if (!result.value.positions.every((p) => dexOf(p.coin) === dexes[i])) {
      failed.push(dexes[i]);
      return;
    }
    positions.push(...result.value.positions);
    const time = answeredAt(result.value.state);
    if (time !== null) times.push(time);
  });

  const registryRead = names !== null;
  return {
    positions,
    coverage: registryRead && failed.length === 0 ? 'complete' : 'partial',
    measuredAt: times.length > 0 ? Math.min(...times) : null,
    venues: { asked: 1 + dexes.length, answered: 1 + dexes.length - failed.length, registryRead },
    failed,
    mainDexCount: mainPositions.length,
    mainState,
    registry,
  };
}

/** How long a complete reading is reused. Also the KV entry's lifetime. */
const REUSE_WINDOW_MS = 60_000;
const REUSE_TTL_SECONDS = 60;

/** Only the parts a reader of the cache depends on; the rest is whatever was written.
 * Only a complete reading is ever written, so an entry that says anything else
 * was not written by this wrapper and is not handed out. */
function isAllDexPositions(data: unknown): data is AllDexPositions {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as { positions?: unknown; coverage?: unknown; registry?: unknown };
  // An entry cached before the registry was part of it has none, and reads as null.
  const registryOk = candidate.registry === undefined || candidate.registry === null || Array.isArray(candidate.registry);
  return Array.isArray(candidate.positions) && candidate.coverage === 'complete' && registryOk;
}

/**
 * Reuse a complete reading for a minute when the same address is asked again,
 * for instance when a reader switches the selected asset. The reading keeps its
 * own `measuredAt`; the cache never makes it look newer.
 *
 * A partial reading is never stored: it says some venue was not seen, and
 * handing it out again would keep that gap past the moment it could be closed.
 * A failed read is not stored either. A cache that cannot be read or written
 * costs a live read, nothing more.
 */
export function reusePositions(read: PositionsReader, kv: KVLike, now: () => number = Date.now): PositionsReader {
  return async (address, signal) => {
    const key = 'source-positions:v2:' + address;
    try {
      const raw = await kv.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as { at?: unknown; data?: unknown } | null;
        const at = entry?.at;
        if (typeof at === 'number' && now() >= at && now() - at <= REUSE_WINDOW_MS && isAllDexPositions(entry?.data)) {
          return entry.data;
        }
      }
    } catch {
      // A cache that fails does not prevent a live read.
    }
    const data = await read(address, signal);
    if (data.coverage === 'complete') {
      try {
        await kv.put(key, JSON.stringify({ at: now(), data }), { expirationTtl: REUSE_TTL_SECONDS });
      } catch {
        // The cache is an optimisation.
      }
    }
    return data;
  };
}
