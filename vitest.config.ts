import { readFileSync } from 'node:fs';
import { isAbsolute, resolve, dirname } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Wrangler serves `web/index.html` and `web/app.js` to the Worker as text
 * (see the Text rules in wrangler.toml). Vitest needs the same, or nothing
 * that imports src/index.ts can be tested at all - which is how the Worker's
 * own routing went untested until the 21.09 audit.
 */
const textAssets: Plugin = {
  name: 'bet-or-book-text-assets',
  enforce: 'pre',
  load(id) {
    if (!/[\\/]web[\\/](index\.html|app\.js)$/.test(id)) return null;
    return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
  },
};

/**
 * The same problem one asset type further: the two fonts and the fallback
 * picture are a `Data` rule in wrangler.toml (raw ArrayBuffer), and
 * `@resvg/resvg-wasm/index_bg.wasm` is imported the way Wrangler compiles a
 * `.wasm` file - a WebAssembly.Module, not the wasm-bindgen JS glue Vite
 * tries to load it as by default (which fails outright: `Cannot find
 * package 'wbg'`, since nothing here wires up wasm-bindgen's own bundler
 * integration). Reading and compiling directly from disk gets both the
 * right shape and skips 2.4 MB of a real compile on every test run.
 */
// A suffix, not a made-up URL scheme: an id like `C:\...\index_bg.wasm?...`
// or `/…/index_bg.wasm?...` is still a real path with a query string, the
// same shape Vite's own `?raw`/`?url` use, so nothing downstream mistakes
// it for a URL. A colon-based prefix looked the same locally on Windows but
// broke under a clean install on Linux CI - Node's own ESM loader read
// everything before the first `:` as the protocol and rejected it outright
// ("Only URLs with a scheme in: file, data, and node are supported").
const WASM_SUFFIX = '?bet-or-book-wasm';

const workerAssets: Plugin = {
  name: 'bet-or-book-worker-assets',
  enforce: 'pre',
  // `.wasm` needs resolveId, not just load: Node's own loader treats a
  // literal `.wasm` specifier as a wasm-bindgen-style ES module and tries
  // to import the wasm binary's own internal imports as JS packages before
  // any plugin's `load` hook runs (`Cannot find package 'wbg'`). Rewriting
  // the id keeps Node from ever recognizing it as a `.wasm` path at all.
  resolveId(source, importer) {
    if (!/\.wasm$/.test(source)) return null;
    const abs = isAbsolute(source) ? source : resolve(dirname(importer ?? ''), source);
    return abs + WASM_SUFFIX;
  },
  load(id) {
    if (id.endsWith(WASM_SUFFIX)) {
      const abs = id.slice(0, -WASM_SUFFIX.length);
      return `
        import { readFileSync } from 'node:fs';
        const bytes = readFileSync(${JSON.stringify(abs)});
        export default await WebAssembly.compile(bytes);
      `;
    }
    if (/\.woff$/.test(id) || /\.png$/.test(id)) {
      const buf = readFileSync(id);
      const b64 = buf.toString('base64');
      return `const b = Buffer.from(${JSON.stringify(b64)}, 'base64'); export default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);`;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [textAssets, workerAssets],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The workerd scenarios build the Worker with Wrangler and start the real
    // runtime for each one - about fifteen seconds against three for all of
    // the rest - so they run as their own step: `npm run test:runtime`, and
    // in CI after this one (vitest.runtime.config.ts).
    exclude: ['test/runtime/**', '**/node_modules/**'],
    // Anything under node_modules is normally handed straight to Node's own
    // loader rather than through Vite's transform pipeline - a reasonable
    // default for vendored code, but it means resolveId/load above never
    // even see this one `.wasm` import, which needs the same rewrite
    // node_modules or not.
    server: { deps: { inline: [/@resvg\/resvg-wasm/] } },
  },
});
