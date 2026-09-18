// Captures one real response per Nansen endpoint Bet or Book uses, so the
// client can be built and tested against recorded data instead of spending a
// credit per test run. Every call is appended to data/nansen-calls.jsonl -
// the buildathon's proof of calls and our own spend counter.
//
// Two things this script never does: print the API key, or write a Nansen
// address label to disk. Labels are prohibited from public redistribution by
// Nansen's rules and these fixtures are committed to a public repo, so any
// field whose name contains "label" is replaced with null before saving.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'https://api.nansen.ai/api/v1';
const OUT_DIR = 'test/fixtures/nansen';
const LEDGER = 'data/nansen-calls.jsonl';

const WINTERMUTE = '0xecb63caa47c7c4e77f60f1ce858cf28dc2b82b00';
const ABRAXAS = '0xB83DE012dbA672c76A7dbbbf3E459CB59D7D6E36';
// Abraxas' "First Funder" on Arbitrum, from related-wallets-abraxas-arbitrum.json.
const ABRAXAS_FUNDER = '0xb38e8c17e38363af6ebdcb3dae12e0243582891d';
// Abraxas' "First Funder" on Ethereum, from related-wallets-abraxas-ethereum.json.
const ABRAXAS_FUNDER_ETH = '0xed0c6079229e2d407672a117c22b62064f4a4312';

function readKey(): string {
  const line = readFileSync('.dev.vars', 'utf-8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('NANSEN_API_KEY='));
  const key = line?.slice('NANSEN_API_KEY='.length).trim();
  if (!key) {
    throw new Error('NANSEN_API_KEY not found in .dev.vars');
  }
  return key;
}

function redactLabels(value: unknown): { value: unknown; redacted: number } {
  let redacted = 0;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        if (/label/i.test(k)) {
          out[k] = null;
          redacted++;
        } else {
          out[k] = walk(inner);
        }
      }
      return out;
    }
    return v;
  };
  return { value: walk(value), redacted };
}

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

interface Call {
  name: string;
  path: string;
  body: Record<string, unknown>;
}

const CALLS: Call[] = [
  { name: 'perp-positions-wintermute', path: 'profiler/perp-positions', body: { address: WINTERMUTE } },
  {
    name: 'perp-trades-wintermute',
    path: 'profiler/perp-trades',
    body: { address: WINTERMUTE, date: { from: isoDate(1), to: isoDate(0) }, pagination: { page: 1, per_page: 1000 } },
  },
  {
    name: 'perp-pnl-summary-wintermute',
    path: 'profiler/perp-pnl-summary',
    body: { address: WINTERMUTE, date: { from: isoDate(30), to: isoDate(0) } },
  },
  {
    name: 'current-balance-abraxas-all',
    path: 'profiler/address/current-balance',
    body: { address: ABRAXAS, chain: 'all', hide_spam_token: true, pagination: { page: 1, per_page: 100 } },
  },
  {
    name: 'related-wallets-abraxas-arbitrum',
    path: 'profiler/address/related-wallets',
    body: { address: ABRAXAS, chain: 'arbitrum', pagination: { page: 1, per_page: 100 } },
  },
  {
    name: 'current-balance-abraxas-funder-all',
    path: 'profiler/address/current-balance',
    body: { address: ABRAXAS_FUNDER, chain: 'all', hide_spam_token: true, pagination: { page: 1, per_page: 100 } },
  },
  { name: 'perp-positions-abraxas-funder', path: 'profiler/perp-positions', body: { address: ABRAXAS_FUNDER } },
  {
    name: 'related-wallets-abraxas-ethereum',
    path: 'profiler/address/related-wallets',
    body: { address: ABRAXAS, chain: 'ethereum', pagination: { page: 1, per_page: 100 } },
  },
  {
    name: 'current-balance-abraxas-funder-eth-all',
    path: 'profiler/address/current-balance',
    body: { address: ABRAXAS_FUNDER_ETH, chain: 'all', hide_spam_token: true, pagination: { page: 1, per_page: 100 } },
  },
  { name: 'perp-positions-abraxas', path: 'profiler/perp-positions', body: { address: ABRAXAS } },
  {
    name: 'perp-pnl-summary-abraxas',
    path: 'profiler/perp-pnl-summary',
    body: { address: ABRAXAS, date: { from: isoDate(30), to: isoDate(0) } },
  },
];

async function main(): Promise<void> {
  const key = readKey();
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync('data', { recursive: true });

  // `--only a,b` re-runs just the named captures, so adding one fixture never
  // re-spends credits on the ones already on disk.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const selected = only ? CALLS.filter((c) => only.has(c.name)) : CALLS;
  if (only && selected.length !== only.size) {
    throw new Error(`unknown capture name in --only: ${[...only].filter((n) => !CALLS.some((c) => c.name === n)).join(', ')}`);
  }

  let totalCost = 0;
  for (const call of selected) {
    const res = await fetch(`${BASE}/${call.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify(call.body),
    });
    const cost = res.headers.get('x-nansen-credits-cost');
    const used = res.headers.get('x-nansen-credits-used');
    const remaining = res.headers.get('x-nansen-credits-remaining');
    const text = await res.text();

    appendFileSync(
      LEDGER,
      JSON.stringify({
        at: new Date().toISOString(),
        source: 'fetch-nansen-fixtures',
        endpoint: call.path,
        status: res.status,
        creditsCost: cost === null ? null : Number(cost),
        creditsRemaining: remaining === null ? null : Number(remaining),
      }) + '\n',
    );

    console.log(`${call.name}: HTTP ${res.status}, cost=${cost}, used=${used}, remaining=${remaining}`);
    if (!res.ok) {
      console.log(`  error body: ${text.slice(0, 300)}`);
      if (res.status === 401 || res.status === 403) {
        console.log('  auth refused - stopping before any further call');
        return;
      }
      continue;
    }

    const parsed = JSON.parse(text);
    // `--show-labels` prints label values to this console only, for internal
    // calibration (e.g. "is this funder an exchange?"). They are still
    // redacted from the file below and never shown in the product.
    if (process.argv.includes('--show-labels') && Array.isArray(parsed?.data)) {
      for (const row of parsed.data as Array<Record<string, unknown>>) {
        if ('address_label' in row) {
          console.log(`  label (console only): ${String(row.address)} -> ${String(row.address_label)} [${String(row.relation)}]`);
        }
      }
    }
    const { value, redacted } = redactLabels(parsed);
    writeFileSync(`${OUT_DIR}/${call.name}.json`, JSON.stringify(value, null, 2) + '\n');
    const data = (value as { data?: unknown }).data;
    const records = Array.isArray(data) ? data.length : data ? 1 : 0;
    console.log(`  saved, records=${records}, labels redacted=${redacted}`);
    if (cost !== null) totalCost += Number(cost);
  }
  console.log(`total credits by header: ${totalCost}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
