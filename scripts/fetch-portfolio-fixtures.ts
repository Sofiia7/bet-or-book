// Captures Hyperliquid's `portfolio` answer for two wallets, so the 30-day
// PnL tile is built and tested against recorded data. Public info API,
// read-only, no key. Each fixture is the raw answer plus the address and the
// time it was read; the answer is a list of [period, history] pairs.
import { writeFileSync, mkdirSync } from 'node:fs';

const HL_API = 'https://api.hyperliquid.xyz/info';
const OUT_DIR = 'test/fixtures/hyperliquid';

const WALLETS: Array<{ name: string; address: string }> = [
  { name: 'portfolio-abraxas', address: '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36' },
  { name: 'portfolio-hype-long', address: '0x082e843a431aef031264dc232693dd710aedca88' },
];

const PERIODS = ['day', 'week', 'month', 'allTime', 'perpDay', 'perpWeek', 'perpMonth', 'perpAllTime'];

async function portfolio(user: string): Promise<unknown> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'portfolio', user }),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid portfolio failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { name, address } of WALLETS) {
    const raw = await portfolio(address);
    const got = Array.isArray(raw) ? raw.map((e) => (Array.isArray(e) ? e[0] : null)) : [];
    const missing = PERIODS.filter((p) => !got.includes(p));
    if (missing.length > 0) {
      throw new Error(`${name}: portfolio is missing ${missing.join(', ')}`);
    }
    const body = { capturedAt: new Date().toISOString(), address, portfolio: raw };
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(body, null, 2) + '\n');
    console.log(`saved ${name}.json (${got.length} periods: ${got.join(', ')})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
