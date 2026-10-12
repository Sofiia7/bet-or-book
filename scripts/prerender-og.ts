// Renders current demonstration previews offline and bundles their PNGs with
// the Worker, so those four shared links require no KV access or runtime render.
// Historical readings reuse unchanged v9 KV images. --all explicitly rebuilds
// the archive; --upload is optional and consumes the namespace write quota.
// No TTL: bundled reading previews are permanent.
// Usage:
//   node --import tsx scripts/prerender-og.ts
//   node --import tsx scripts/prerender-og.ts --upload
//   node --import tsx scripts/prerender-og.ts --all --upload
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ogCardFor, ogCacheKey } from '../src/engine/ogCard';
import { OG_LAYOUT_VERSION } from '../src/engine/ogCard';
import { CLASSIFIER_VERSION } from '../src/engine/verdict';
import { renderOgPng, type OgFont } from '../src/engine/ogRender';
import type { Gallery } from '../src/gallery';

const NAMESPACE_ID = '864e48a08ae343af924217c67a0669b2'; // wrangler.toml [[kv_namespaces]]
const OUT_FILE = 'data/og-prerendered.json';

async function main() {
  const gallery = JSON.parse(readFileSync('data/gallery.json', 'utf-8')) as Gallery;
  // The hand-picked demonstration readings ship with the Worker as well, and
  // are the ones most likely to be shared first (23.09 audit, U05). They are
  // saved readings, and their pictures say so.
  const featured = JSON.parse(readFileSync('data/featured.json', 'utf-8')) as Gallery;
  const fonts: OgFont[] = [
    { name: 'Inter', data: readFileSync('assets/inter-regular.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: readFileSync('assets/inter-bold.woff'), weight: 700, style: 'normal' },
  ];
  const wasmModule = await WebAssembly.compile(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));

  const candidates = [
    ...featured.entries.map((e) => ({ e, kind: 'saved' as const })),
    ...gallery.entries.map((e) => ({ e, kind: 'gallery' as const })),
  ].filter(({ e }) => e.snapshotId && e.positions.nPositions > 0 && (process.argv.includes('--all') || (!e.historical && !e.superseded && e.classifierVersion === CLASSIFIER_VERSION)));
  const seen = new Set<string>();
  // No `base64: true` here: that flag tells `wrangler kv bulk put` to
  // *decode* `value` and store the raw bytes, so a later `kv.get()` (which
  // this Worker's KVLike only ever reads as a string) comes back as a
  // UTF-8 decoding of a PNG - mangled, and a different length than the
  // original. `renderOgPng`'s own writes go through the ordinary string
  // `put()` and were never affected; this bulk path is. The base64 text
  // itself is the value, read back and decoded by ogPngFor at request time,
  // exactly like a render this Worker did for itself.
  const bulk: Array<{ key: string; value: string }> = [];
  let rendered = 0;
  let skipped = 0;

  for (const { e, kind } of candidates) {
    const id = e.snapshotId!;
    if (seen.has(id)) continue; // a re-read and the reading it replaced share no id, but guard anyway
    seen.add(id);
    try {
      // Same words and the same key as the deployed Worker's own draw of a
      // gallery card (src/index.ts): the date and caveat a reader sees on
      // the page (23.09 audit, U02), under the current layout's key, so a
      // picture uploaded from an older layout is never served as this one.
      const png = await renderOgPng(ogCardFor(e, kind), fonts, wasmModule);
      bulk.push({ key: ogCacheKey(id), value: Buffer.from(png).toString('base64') });
      rendered++;
    } catch (err) {
      console.error(`skipped ${id} (${e.address}):`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(bulk, null, 1));
  const featuredIds = new Set(featured.entries.filter(e => !e.superseded && !e.historical).map(e => e.snapshotId));
  writeFileSync('data/og-featured.json', JSON.stringify({ layoutVersion: OG_LAYOUT_VERSION, readings: Object.fromEntries(bulk.filter(row => featuredIds.has(row.key.split(':').at(-1)!)).map(row => [row.key.split(':').at(-1)!, row.value])) }));
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
