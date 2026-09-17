import { writeFileSync, mkdirSync } from 'node:fs';

const HL_API = 'https://api.hyperliquid.xyz/info';
const OUT_DIR = 'test/fixtures/hyperliquid';

async function post(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid ${String(body.type)} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function save(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(data, null, 2) + '\n');
  console.log(`saved ${name}.json`);
}

async function main(): Promise<void> {
  const [manyPositions, withOrders, withSpot] = process.argv.slice(2);
  if (!manyPositions || !withOrders || !withSpot) {
    console.error(
      'usage: npx tsx scripts/fetch-fixtures.ts <address with >=3 open positions> ' +
        '<address with several resting limit orders> <address with a nonzero spot balance>',
    );
    process.exit(1);
  }

  save('clearinghouse-many-positions', await post({ type: 'clearinghouseState', user: manyPositions }));
  save('open-orders', await post({ type: 'frontendOpenOrders', user: withOrders }));
  save('open-orders-empty', await post({ type: 'frontendOpenOrders', user: '0x0000000000000000000000000000000000000001' }));
  save('spot-balances', await post({ type: 'spotClearinghouseState', user: withSpot }));
  save('spot-meta', await post({ type: 'spotMetaAndAssetCtxs' }));
  save('meta-and-asset-ctxs', await post({ type: 'metaAndAssetCtxs' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
