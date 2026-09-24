import { defineConfig } from 'vitest/config';

/**
 * The scenarios that need the real runtime (test/runtime/): the Worker built
 * by Wrangler and run inside workerd through Miniflare, with real Durable
 * Objects, real SQLite storage and real request cancellation. Nothing here
 * imports the Worker's assets into Node, so none of vitest.config.ts's asset
 * plugins are needed. Each file starts its own runtimes; one file at a time
 * keeps a slower machine from timing out on several workerd processes at
 * once.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/runtime/**/*.test.ts'],
    fileParallelism: false,
  },
});
