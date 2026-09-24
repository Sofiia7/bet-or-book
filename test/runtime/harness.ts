// Starts the real Worker - bundled by Wrangler exactly as `wrangler deploy`
// bundles it - inside workerd, through Miniflare, from an ordinary Node test.
//
// Cloudflare's own Vitest integration runs tests inside workerd, but it
// needs Vitest 4 and this project is on 5 (docs/submission-checklist.md
// named that as the reason nothing ran on the real runtime). Miniflare is
// what that integration is built on, it is already here as Wrangler's own
// dependency (pinned to the same version), and driving it from Node needs
// neither. What it buys over the in-process fakes in test/support/worker.ts:
// real Durable Objects with their input and output gates, real SQLite
// storage that survives a restart, real KV, real request cancellation.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

type ModuleType = 'ESModule' | 'Text' | 'Data' | 'CompiledWasm';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The same date the deployed Worker runs under, read rather than copied. */
const COMPATIBILITY_DATE = /compatibility_date\s*=\s*"([^"]+)"/.exec(
  readFileSync(join(ROOT, 'wrangler.toml'), 'utf8'),
)![1];

let bundle: string | null = null;

/** Bundles test/runtime/entry.ts with Wrangler's own build, once per file. */
export function buildWorker(): string {
  if (bundle) return bundle;
  const outdir = mkdtempSync(join(tmpdir(), 'bet-or-book-runtime-'));
  // Wrangler's own script under this Node, rather than `npx` through a
  // shell: the same build on Windows and on CI, and no shell in between.
  const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  execFileSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', outdir, 'test/runtime/entry.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  bundle = outdir;
  return outdir;
}

/** Deletes the build, once the file that made it is done with it. */
export function removeBuild(): void {
  if (bundle) rmSync(bundle, { recursive: true, force: true });
  bundle = null;
}

/** What each file the build left next to the bundle is, by the same rules
 * wrangler.toml gives the deployed Worker. */
function moduleType(file: string): ModuleType {
  if (file.endsWith('.wasm')) return 'CompiledWasm';
  if (file.endsWith('.woff') || file.endsWith('.png')) return 'Data';
  if (file.endsWith('.html') || file.endsWith('app.js')) return 'Text';
  throw new Error(`no module rule for ${file}`);
}

export type Upstream = (request: Request) => Response | Promise<Response>;

export interface WorkerOptions {
  /** Plain-text bindings on top of wrangler.toml's own defaults. */
  vars?: Record<string, string>;
  /** Every fetch() the Worker makes - Hyperliquid and Nansen - lands here. */
  upstream: Upstream;
  /** A directory the Durable Objects' storage lives in, so a second
   * Miniflare over the same one is the same objects after a restart. */
  persist?: string;
  /** Every line the Worker writes to its console. Without this they go to
   * the test's own output, which is noise for any test not looking. */
  onLog?: (line: string) => void;
}

export async function startWorker(opts: WorkerOptions): Promise<Miniflare> {
  const outdir = buildWorker();
  const extra = readdirSync(outdir).filter((f) => f !== 'entry.js' && f !== 'README.md' && !f.endsWith('.map'));
  // Miniflare 5 takes a new options shape; the one its README documents,
  // and the one Wrangler itself still builds, goes through this converter.
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: [
      { type: 'ESModule', path: join(outdir, 'entry.js') },
      ...extra.map((f) => ({ type: moduleType(f), path: join(outdir, f) })),
    ],
    modulesRoot: outdir,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: ['nodejs_compat'],
    kvNamespaces: ['KV'],
    durableObjects: {
      NANSEN_BUDGET: { className: 'NansenBudget', useSQLite: true },
      REQUEST_GATE: { className: 'RequestGate', useSQLite: true },
    },
    bindings: {
      NANSEN_DAILY_CREDIT_CAP: '300',
      NANSEN_CREDIT_FLOOR: '0',
      NANSEN_DEMO_RESERVE: '0',
      ...opts.vars,
    },
    outboundService: (request) => opts.upstream(request as unknown as Request) as never,
    handleStructuredLogs: (log) => opts.onLog?.(log.message),
    ...(opts.persist ? { resourcePersistencePath: opts.persist } : {}),
  }));
  await mf.ready;
  return mf;
}

export function tempDir(): { path: string; remove(): void } {
  const path = mkdtempSync(join(tmpdir(), 'bet-or-book-state-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/** The day the Worker charges to, the way it works it out. */
export const today = () => new Date().toISOString().slice(0, 10);

/** Talks to the budget object the way the Worker does (src/coordinator.ts). */
export async function budgetStub(mf: Miniflare) {
  const ns = await mf.getDurableObjectNamespace('NANSEN_BUDGET');
  const stub = ns.get(ns.idFromName('nansen-budget'));
  const call = async (body: unknown) => {
    const res = await stub.fetch('https://budget.internal/', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    return res.json() as Promise<Record<string, unknown>>;
  };
  return {
    reserve: (worstCase: number, cap: number) =>
      call({ action: 'reserve', day: today(), worstCase, limits: { cap, floor: 0 } }) as Promise<{
        ok: boolean;
        id: string | null;
      }>,
    settle: (id: string, actualCost: number) =>
      call({ action: 'settle', id, actualCost, creditsRemaining: null, refused: false }),
    record: (calls: Array<{ path: string; status: number; creditsCost: number | null }>) =>
      call({ action: 'record', day: today(), calls }),
    report: () =>
      call({ action: 'report', from: today(), to: today() }) as Promise<{ calls: { attempted: number } }>,
    /**
     * How much of `cap` a new check could still reserve - the budget's own
     * answer, found by asking it rather than by reading its state. Every
     * probe that succeeds is settled at zero straight away, which releases
     * it and charges nothing.
     */
    async available(cap: number): Promise<number> {
      let lo = 0;
      let hi = cap;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const r = await this.reserve(mid, cap);
        if (r.ok) {
          await this.settle(r.id!, 0);
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return lo;
    },
  };
}
