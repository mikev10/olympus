/**
 * Prints the tree hash a package's conformance run report must carry to be
 * accepted: the same `packageTreeHash` the registry recomputes when it
 * reconciles, over the package and every workspace package it depends on.
 *
 * CI keys a cache of the claude-code driver's report on it, so the model is
 * called only when the driver or something it executes has changed. A wrong
 * key costs a model run or a red registry, never a green one: the registry
 * still refuses a report whose hash is not the tree's.
 *
 * usage: node scripts/driver-report-key.ts <package dir>
 */
import { register } from 'node:module';
import { resolve } from 'node:path';

// The kit imports its siblings as `./x.js`, which vitest maps to `./x.ts`.
// Node's type stripping does not, so this makes the same mapping for
// relative specifiers and leaves every other one alone.
const HOOK = `
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    try { return await next(specifier.slice(0, -3) + '.ts', context); } catch {}
  }
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOK)}`);

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write('usage: node scripts/driver-report-key.ts <package dir>\n');
  process.exit(2);
}

// Imported after the hook is registered; a static import would resolve first.
const { packageTreeHash } = await import('../packages/conformance/src/kit/run-report.ts');
process.stdout.write(`${packageTreeHash(resolve(dir))}\n`);
