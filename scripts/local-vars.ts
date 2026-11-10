// Local variables for the scripts, the way `wrangler dev` reads them: the
// shell's environment first, then .dev.vars (git-ignored). A value read here
// is handed to the code that needs it and never printed.
import { existsSync, readFileSync } from 'node:fs';

/** `name` from the environment, else from .dev.vars, else undefined. An
 * empty value counts as unset. */
export function localVar(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync('.dev.vars')) return undefined;
  const line = readFileSync('.dev.vars', 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
  return value ? value : undefined;
}
