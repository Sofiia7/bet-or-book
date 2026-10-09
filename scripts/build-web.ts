// Keep the readable source in Git and ship a compact, deterministic browser asset.
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const source = readFileSync('web/app.js', 'utf8');
const prepared = source.replace(/const VERDICTS = \{[\s\S]*?\n\};/, 'const VERDICTS = __VERDICT_STYLES__;');
if (prepared === source) throw new Error('Verdict dictionary injection marker missing');
const result = await build({ stdin: { contents: prepared, sourcefile: 'app.js', resolveDir: resolve('web'), loader: 'js' },
  bundle: true, write: false, minify: true, target: 'es2022', legalComments: 'none' });
const code = result.outputFiles[0].text;
writeFileSync('web/app.min.js', code);
console.log(`Browser script: ${Buffer.byteLength(source)} -> ${Buffer.byteLength(code)} bytes`);
