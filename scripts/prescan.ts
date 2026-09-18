// Pre-scans the biggest open positions on Hyperliquid through the very same
// checkAddress the Worker runs, and writes data/gallery.json for the page.
// This is where most of the buildathon's 1 000 Nansen calls are made, so it
// is built to never pay twice and to stop before the account runs dry:
//
// - candidates come free: Hyperliquid's public leaderboard gives the accounts,
//   its public clearinghouseState ranks them by their largest open position;
// - every Nansen call is appended to data/nansen-calls.jsonl as it happens;
// - the gallery file is rewritten after every check, and --resume skips what
//   is already in it, so an interrupted run loses nothing;
// - it stops at the credit reserve, on any 401/402/403, or after three checks
//   in a row that could not read Nansen positions;
// - Hyperliquid 429s and 5xx are retried with backoff; Nansen calls never are,
//   since a retry could be charged twice.
//
// The API key is read from .dev.vars and never printed.
//
// Usage:
//   npx tsx scripts/prescan.ts [--pool=1000] [--reserve=30] [--gap-ms=7000]
//                              [--limit=N] [--addresses=0x..,0x..]
//                              [--source=prescan] [--out=data/gallery.json]
//                              [--resume]
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync } from 'node:fs';
import { checkAddress, type CheckResult } from '../src/api/check';
import { createNansenClient, type NansenCallMeta } from '../src/sources/nansen';
import { getClearinghouseState } from '../src/sources/hyperliquid';
import type { Gallery } from '../src/gallery';

const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const LEDGER = 'data/nansen-calls.jsonl';
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
  reserve: number;
  gapMs: number;
  /** Most checks this run may make - for a small first batch before the rest. */
  limit: number;
  addresses: string[] | null;
  source: string;
  out: string;
  resume: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const addresses = get('addresses');
  return {
    pool: Number(get('pool') ?? 1000),
    reserve: Number(get('reserve') ?? 30),
    gapMs: Number(get('gap-ms') ?? 7000),
    limit: Number(get('limit') ?? Infinity),
    addresses: addresses ? addresses.split(',').map((a) => a.trim().toLowerCase()) : null,
    source: get('source') ?? 'prescan',
    out: get('out') ?? 'data/gallery.json',
    resume: argv.includes('--resume'),
  };
}

function readKey(): string {
  const line = readFileSync('.dev.vars', 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('NANSEN_API_KEY='));
  const key = line?.slice('NANSEN_API_KEY='.length).trim();
  if (!key) throw new Error('NANSEN_API_KEY not found in .dev.vars');
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries Hyperliquid only. Nansen requests pass through untouched. */
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

function writeAtomically(path: string, data: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 1) + '\n');
  renameSync(`${path}.tmp`, path);
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

  const ranked: Candidate[] = [];
  let unreadable = 0;
  for (const [i, acct] of top.entries()) {
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
    if ((i + 1) % 100 === 0) console.log(`  ranked ${i + 1}/${top.length}, with positions: ${ranked.length}`);
    await sleep(150);
  }
  ranked.sort((a, b) => b.largestUsd - a.largestUsd);
  console.log(`ranked: ${ranked.length} with open positions, ${unreadable} unreadable`);
  writeAtomically(CANDIDATES_FILE, { pool, rankedAt: new Date().toISOString(), candidates: ranked });
  return ranked;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const key = readKey();
  installHyperliquidRetry();

  const addresses = args.addresses ?? (await rankCandidates(args.pool)).map((c) => c.address);
  const universe = `Largest open positions among the top ${args.pool.toLocaleString('en-US')} Hyperliquid accounts by value`;
  const gallery: Gallery =
    args.resume && existsSync(args.out)
      ? (JSON.parse(readFileSync(args.out, 'utf-8')) as Gallery)
      : { scannedAt: null, finishedAt: null, universe, entries: [] };
  if (!args.addresses) gallery.universe = universe;
  gallery.scannedAt ??= new Date().toISOString();
  const done = new Set(gallery.entries.map((e) => e.address));
  const todo = addresses.filter((a) => !done.has(a)).slice(0, args.limit);
  console.log(`to scan: ${todo.length} (already in ${args.out}: ${done.size}), reserve ${args.reserve} credits`);

  let lastRemaining: number | null = null;
  let lostInARow = 0;
  let failedInARow = 0;
  let totalCalls = 0;
  let stopReason = 'candidates exhausted';

  for (const [i, address] of todo.entries()) {
    if (lastRemaining !== null && lastRemaining <= args.reserve) {
      stopReason = `credit reserve reached (${lastRemaining} left)`;
      break;
    }
    const started = Date.now();
    const calls: NansenCallMeta[] = [];
    const nansen = createNansenClient(key, (m) => {
      calls.push(m);
      appendFileSync(
        LEDGER,
        JSON.stringify({
          at: new Date().toISOString(),
          source: args.source,
          endpoint: m.path,
          status: m.status,
          creditsCost: m.creditsCost,
          creditsRemaining: m.creditsRemaining,
        }) + '\n',
      );
    });

    let result: CheckResult | null = null;
    try {
      result = await checkAddress(address, { nansen });
      failedInARow = 0;
    } catch (err) {
      failedInARow++;
      console.log(`#${i + 1} ${address} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    totalCalls += calls.length;
    const reported = [...calls].reverse().find((c) => c.creditsRemaining !== null);
    if (reported) lastRemaining = reported.creditsRemaining;

    if (result) {
      gallery.entries.push({ ...result, nansenCalls: calls.length });
      gallery.finishedAt = new Date().toISOString();
      writeAtomically(args.out, gallery);
      const v = result.verdict;
      console.log(
        `#${i + 1} ${address} ${v.verdict}${v.strength ? ` (${v.strength})` : ''} | ` +
          `${result.evidence[0]?.value ?? '-'} | calls ${calls.length} | left ${lastRemaining ?? '?'}`,
      );
      lostInARow = result.source === 'nansen' ? 0 : lostInARow + 1;
    }

    if (calls.some((c) => c.status === 401 || c.status === 402 || c.status === 403)) {
      stopReason = `Nansen refused a call (${calls.map((c) => c.status).join(',')})`;
      break;
    }
    if (lostInARow >= 3) {
      stopReason = 'three checks in a row without Nansen positions';
      break;
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
  console.log(`this run: ${totalCalls} Nansen calls, ${lastRemaining ?? '?'} credits left`);
  console.log(`gallery: ${gallery.entries.length} entries ${JSON.stringify(counts)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
