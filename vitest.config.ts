import { readFileSync } from 'node:fs';
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

export default defineConfig({
  plugins: [textAssets],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
