// Keep the readable source in Git and ship a compact, deterministic browser asset.
import { readFileSync, writeFileSync } from 'node:fs';
import { transform } from 'esbuild';
const source = readFileSync('web/app.js', 'utf8');
const prepared = source.replace(/const VERDICTS = \{[\s\S]*?\n\};/, 'const VERDICTS = __VERDICT_STYLES__;');
if (prepared === source) throw new Error('Verdict dictionary injection marker missing');
const result = await transform(prepared, { minify: true, target: 'es2022', legalComments: 'none' });
writeFileSync('web/app.min.js', result.code);
console.log(`Browser script: ${Buffer.byteLength(source)} -> ${Buffer.byteLength(result.code)} bytes`);
