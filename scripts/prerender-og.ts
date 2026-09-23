// Renders every gallery card's social-preview picture offline and uploads
// the results to the live KV namespace, so a shared gallery link's image is
// never the first, CPU-bound render (see docs/architecture.md for why that
// render does not reliably fit the Workers free plan's 10ms budget): the
// deployed Worker's /api/og route becomes a cache read for every one of
// these ids from the day this runs.
//
// No TTL: a gallery card's picture is as permanent as the bundled
// data/gallery.json entry it was built from, not a 30-day live snapshot.
//
// Usage:
//   node --import tsx scripts/prerender-og.ts               (write data/og-prerendered.json only)
//   node --import tsx scripts/prerender-og.ts --upload       (also run `wrangler kv bulk put`)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ogCardData } from '../src/engine/ogCard';
import { renderOgPng, type OgFont } from '../src/engine/ogRender';
import type { Gallery } from '../src/gallery';

const NAMESPACE_ID = '864e48a08ae343af924217c67a0669b2'; // wrangler.toml [[kv_namespaces]]
const OUT_FILE = 'data/og-prerendered.json';

async function main() {
  const gallery = JSON.parse(readFileSync('data/gallery.json', 'utf-8')) as Gallery;
  const fonts: OgFont[] = [
    { name: 'Inter', data: readFileSync('assets/inter-regular.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: readFileSync('assets/inter-bold.woff'), weight: 700, style: 'normal' },
  ];
  const wasmModule = await WebAssembly.compile(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));

  const candidates = gallery.entries.filter((e) => e.snapshotId && e.positions.nPositions > 0);
  const seen = new Set<string>();
  const bulk: Array<{ key: string; value: string; base64: true }> = [];
  let rendered = 0;
  let skipped = 0;

  for (const e of candidates) {
    const id = e.snapshotId!;
    if (seen.has(id)) continue; // a re-read and the reading it replaced share no id, but guard anyway
    seen.add(id);
    try {
      const data = ogCardData({
        address: e.address,
        verdict: e.verdict,
        summary: e.summary,
        classifierVersion: e.classifierVersion,
        breakdown: e.breakdown,
      });
      const png = await renderOgPng(data, fonts, wasmModule);
      bulk.push({ key: `og:${id}`, value: Buffer.from(png).toString('base64'), base64: true });
      rendered++;
    } catch (err) {
      console.error(`skipped ${id} (${e.address}):`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(bulk, null, 1));
  console.log(`${rendered} rendered, ${skipped} skipped, ${candidates.length - seen.size} duplicate ids. Wrote ${OUT_FILE}.`);

  if (process.argv.includes('--upload')) {
    console.log(`Uploading ${bulk.length} entries to KV namespace ${NAMESPACE_ID}...`);
    execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', OUT_FILE, '--namespace-id', NAMESPACE_ID, '--remote'], {
      stdio: 'inherit',
      shell: true,
    });
  } else {
    console.log('Not uploaded. Re-run with --upload once you have reviewed the file, or run:');
    console.log(`  npx wrangler kv bulk put ${OUT_FILE} --namespace-id ${NAMESPACE_ID} --remote`);
  }
}

await main();
