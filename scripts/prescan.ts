// Pre-scans the biggest open positions on Hyperliquid through the very same
// checkAddress the Worker runs, and writes data/gallery.json for the page.
// A check reads only free public sources (Hyperliquid, public nodes and the
// block explorer), so nothing here is metered; what the script guards is the
// time a long run takes and the rate limits of those sources:
//
// - candidates come free: Hyperliquid's public leaderboard gives the accounts,
//   its public clearinghouseState ranks them by their largest open position;
// - the gallery file is rewritten after every check, and --resume skips what
//   is already in it, so an interrupted run loses nothing;
// - it stops after five checks in a row that failed;
// - Hyperliquid 429s and 5xx are retried with backoff.
//
// The optional explorer key BLOCKSCOUT_API_KEY is read from the environment or
// .dev.vars and never printed. Without it Arbitrum funding links are not read.
//
// Usage:
//   npx tsx scripts/prescan.ts [--pool=1000] [--gap-ms=7000]
//                              [--limit=N] [--addresses=0x..,0x..]
//                              [--source=prescan] [--out=data/gallery.json]
//                              [--universe="what this set is"]
//                              [--supersede-from=data/gallery.json]
//                              [--resume] [--refresh]
//
// The hand-picked demonstration readings at the top of the page
// (data/featured.json, 23.09 audit U05) are this script run over a few
// named addresses into their own file:
//   npx tsx scripts/prescan.ts --addresses=0x..,0x.. --out=data/featured.json
//     --source=featured-YYYY-MM-DD --universe="Readings picked to show each kind of answer"
//     --supersede-from=data/gallery.json --gap-ms=3000
// `--supersede-from` links each new reading to the same address's latest
// reading in that file, so the card can say what changed since then.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { checkAddress, type CheckResult } from '../src/api/check';
import { getClearinghouseState } from '../src/sources/hyperliquid';
import { snapshotId } from '../src/snapshot';
import { previousReadingId, type Gallery } from '../src/gallery';
import { localVar } from './local-vars';

const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const CANDIDATES_FILE = 'data/prescan-candidates.json';
const MAX_FAILED_IN_A_ROW = 5;

interface Candidate {
  address: string;
  accountValueUsd: number;
  largestCoin: string;
  largestUsd: number;
  mainDexPositions: number;
}

interface Args {
  pool: number;
  gapMs: number;
  /** Most checks this run may make - for a small first batch before the rest. */
  limit: number;
  addresses: string[] | null;
  source: string;
  out: string;
  /** What the set is, for the page to say. Defaults to the leaderboard scan's
   * own description, which is wrong for a hand-picked set. */
  universe: string | null;
  /** A file of earlier readings each new one follows, for "what changed". */
  supersedeFrom: string | null;
  resume: boolean;
  /** Re-check the named addresses even though the gallery already holds
   * them, replacing what is there. `--resume` skips anything already
   * scanned, which is right for finishing an interrupted run and wrong for
   * reading an account again after the rules changed. */
  refresh: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const addresses = get('addresses');
  return {
    pool: Number(get('pool') ?? 1000),
    gapMs: Number(get('gap-ms') ?? 7000),
    limit: Number(get('limit') ?? Infinity),
    addresses: addresses ? addresses.split(',').map((a) => a.trim().toLowerCase()) : null,
    source: get('source') ?? 'prescan',
    out: get('out') ?? 'data/gallery.json',
    universe: get('universe') ?? null,
    supersedeFrom: get('supersede-from') ?? null,
    resume: argv.includes('--resume'),
    refresh: argv.includes('--refresh'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries Hyperliquid only; every other request passes through untouched. */
function installHyperliquidRetry(): void {
  const original = globalThis.fetch;
  const backoffMs = [2_000, 5_000, 10_000, 20_000];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!String(input).includes('hyperliquid')) return original(input, init);
    for (let attempt = 0; ; attempt++) {
      const res = await original(input, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= backoffMs.length) return res;
      console.log(`  hyperliquid ${res.status}, retry in ${backoffMs[attempt] / 1000}s`);
      await sleep(backoffMs[attempt]);
    }
  }) as typeof fetch;
}

/** On Windows a rename over a file another process has open (the dev
 * server's watcher reading the gallery, an editor) fails with EPERM or
 * EBUSY; seen live 18.09 on check 41. Retry, then write in place - the data
 * matters more than the atomicity. */
function writeAtomically(path: string, data: unknown): void {
  const text = JSON.stringify(data, null, 1) + '\n';
  writeFileSync(`${path}.tmp`, text);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(`${path}.tmp`, path);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err;
      const until = Date.now() + 200 * (attempt + 1);
      while (Date.now() < until) {
        // brief synchronous wait before the next attempt
      }
    }
  }
  writeFileSync(path, text);
}

async function rankCandidates(pool: number): Promise<Candidate[]> {
  if (existsSync(CANDIDATES_FILE)) {
    const saved = JSON.parse(readFileSync(CANDIDATES_FILE, 'utf-8')) as { pool: number; candidates: Candidate[] };
    if (saved.pool === pool) {
      console.log(`candidates: reusing ${CANDIDATES_FILE} (${saved.candidates.length})`);
      return saved.candidates;
    }
  }
  const res = await fetch(LEADERBOARD_URL);
  if (!res.ok) throw new Error(`leaderboard failed: ${res.status}`);
  const board = (await res.json()) as { leaderboardRows: Array<{ ethAddress: string; accountValue: string }> };
  const top = board.leaderboardRows
    .map((r) => ({ address: r.ethAddress.toLowerCase(), accountValueUsd: Number(r.accountValue) }))
    .sort((a, b) => b.accountValueUsd - a.accountValueUsd)
    .slice(0, pool);
  console.log(`leaderboard: ${board.leaderboardRows.length} accounts, ranking the top ${top.length} by largest position`);

  // clearinghouseState weighs 2 against Hyperliquid's 1 200 per minute; four
  // readers with a 100 ms pause stay near half of that.
  const ranked: Candidate[] = [];
  let unreadable = 0;
  let next = 0;
  let finished = 0;
  const reader = async () => {
    while (next < top.length) {
      const acct = top[next++];
      try {
        const state = await getClearinghouseState(acct.address);
        const sizes = state.assetPositions.map(({ position }) => ({
          coin: position.coin,
          usd: Math.abs(Number(position.positionValue)),
        }));
        if (sizes.length > 0) {
          const largest = sizes.reduce((m, s) => (s.usd > m.usd ? s : m), sizes[0]);
          ranked.push({ ...acct, largestCoin: largest.coin, largestUsd: largest.usd, mainDexPositions: sizes.length });
        }
      } catch {
        unreadable++;
      }
      if (++finished % 250 === 0) console.log(`  ranked ${finished}/${top.length}, with positions: ${ranked.length}`);
      await sleep(100);
    }
  };
  await Promise.all(Array.from({ length: 4 }, reader));
  ranked.sort((a, b) => b.largestUsd - a.largestUsd);
  console.log(`ranked: ${ranked.length} with open positions, ${unreadable} unreadable`);
  writeAtomically(CANDIDATES_FILE, { pool, rankedAt: new Date().toISOString(), candidates: ranked });
  return ranked;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  installHyperliquidRetry();

  const addresses = args.addresses ?? (await rankCandidates(args.pool)).map((c) => c.address);
  const universe =
    args.universe ?? `Largest open positions among the top ${args.pool.toLocaleString('en-US')} Hyperliquid accounts by value`;
  const gallery: Gallery =
    args.resume && existsSync(args.out)
      ? (JSON.parse(readFileSync(args.out, 'utf-8')) as Gallery)
      : { scannedAt: null, finishedAt: null, universe, entries: [] };
  if (!args.addresses || args.universe) gallery.universe = universe;
  gallery.scannedAt ??= new Date().toISOString();

  // A refresh replaces the named entries rather than skipping them. The old
  // reading is not merged into the new one: re-reading an account is a new
  // observation, and mixing the two is what the 21.09 audit found the
  // re-explain script doing.
  const refreshing = args.refresh && args.addresses ? new Set(args.addresses) : new Set<string>();
  if (refreshing.size > 0) {
    const before = gallery.entries.length;
    gallery.entries = gallery.entries.filter((e) => !refreshing.has(e.address));
    console.log(`refresh: ${before - gallery.entries.length} existing entries set aside to be read again`);
  }

  const earlier = args.supersedeFrom
    ? (JSON.parse(readFileSync(args.supersedeFrom, 'utf-8')) as Gallery).entries
    : [];
  const idOf = (e: Gallery['entries'][number]) => e.snapshotId ?? snapshotId(e.address, e.checkedAt);

  const done = new Set(gallery.entries.map((e) => e.address));
  const todo = addresses.filter((a) => !done.has(a)).slice(0, args.limit);
  console.log(`to scan: ${todo.length} (already in ${args.out}: ${done.size})`);
  const explorer = { apiKey: localVar('BLOCKSCOUT_API_KEY') };
  if (!explorer.apiKey) console.log('no BLOCKSCOUT_API_KEY: Arbitrum funding links will not be read');

  let failedInARow = 0;
  let stopReason = 'candidates exhausted';

  for (const [i, address] of todo.entries()) {
    const started = Date.now();

    let result: CheckResult | null = null;
    try {
      result = await checkAddress(address, { explorer });
      failedInARow = 0;
    } catch (err) {
      failedInARow++;
      console.log(`#${i + 1} ${address} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (result) {
      // Its own id, from the same function a live check uses, so a link to
      // it is a link to exactly this reading (23.09 audit, L03) rather than
      // one the Worker has to work out from the address and the time.
      const previous = previousReadingId(earlier, address, idOf);
      gallery.entries.push({
        ...result,
        // The field old readings carry; a reading made now made no Nansen call.
        nansenCalls: 0,
        snapshotId: snapshotId(address, result.checkedAt, result.classifierVersion, result.focus),
        ...(previous ? { supersedes: previous } : {}),
      });
      gallery.finishedAt = new Date().toISOString();
      writeAtomically(args.out, gallery);
      const v = result.verdict;
      console.log(
        `#${i + 1} ${address} ${v.verdict}${v.strength ? ` (${v.strength})` : ''} | ` +
          `${result.evidence[0]?.value ?? '-'}`,
      );
    }

    if (failedInARow >= MAX_FAILED_IN_A_ROW) {
      stopReason = `${MAX_FAILED_IN_A_ROW} checks in a row failed`;
      break;
    }
    const wait = args.gapMs - (Date.now() - started);
    if (wait > 0 && i < todo.length - 1) await sleep(wait);
  }

  const counts: Record<string, number> = {};
  for (const e of gallery.entries) counts[e.verdict.verdict] = (counts[e.verdict.verdict] ?? 0) + 1;
  console.log(`stopped: ${stopReason}`);
  console.log(`gallery: ${gallery.entries.length} entries ${JSON.stringify(counts)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
