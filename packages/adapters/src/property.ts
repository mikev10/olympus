/**
 * fast-check 4 as a stack's property framework (R25, D-R25-02, D-R25-03).
 *
 * A property file is a vitest suite that hands each property to
 * `fc.assert`. The suite runs under the base's own vitest, exactly as an
 * acceptance check runs. What runs ahead of it is the runtime's: a preload,
 * mounted read-only and loaded through `NODE_OPTIONS=--import`, into vitest's
 * main process and every worker it starts. The preload imports the tree's
 * own fast-check, the instance the suite imports, and configures it globally
 * with the pinned seed and case count and a reporter. The reporter writes one
 * tagged line per run, located at the `assert` call that made it, and then
 * fails a failed run as fast-check's own reporter would.
 *
 * Registrations are found statically on the host and nothing is executed
 * there. A call through a binding the file did not import from `fast-check`
 * is not a registration: it would report from a site no one locked.
 */
import ts from 'typescript';
import type { PropertyRun } from '@olympus-ai/integrity';
import { readRegularFile, SOURCE_FILE_CAP } from './files.js';
import { refuse } from './refusal.js';
import { parseModule, scopeOf, syntaxErrors, unwrap } from './static.js';
import type { PropertyAdapter, PropertyPin, PropertySite } from './types.js';

/** The module whose `assert` registers a property. */
const FRAMEWORK_MODULE = 'fast-check';

/** The majors whose global configuration and reporter were run under the runtime's preload (D-R25-03). */
export type FastCheckMajor = 4;

export class FastCheckAdapter implements PropertyAdapter {
  readonly framework: string;
  constructor(major: FastCheckMajor) {
    this.framework = `fast-check@${String(major)}`;
  }

  async registrations(file: string, name: string): Promise<PropertySite[]> {
    const sf = parseModule(await readRegularFile(file, SOURCE_FILE_CAP), file);
    const errors = syntaxErrors(sf);
    if (errors.length > 0) refuse('unparseable', `${name} does not parse: ${errors.join('; ')}`);
    const scope = scopeOf(sf, () => undefined);
    const namespaces = new Set<string>();
    const asserts = new Set<string>();
    for (const [local, binding] of scope.imports) {
      if (binding.module !== FRAMEWORK_MODULE) continue;
      if (binding.imported === 'default' || binding.imported === '*') namespaces.add(local);
      else if (binding.imported === 'assert') asserts.add(local);
    }
    // A use of the framework that no report could be located at, or that hides an `assert` from the parse, is
    // refused rather than left out of what must report: it could register a property nothing requires (codex-2).
    for (const local of namespaces) {
      for (const ref of scope.references.get(local) ?? []) {
        const parent = ref.parent;
        if (ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent)) continue;
        if (ts.isElementAccessExpression(parent) && parent.expression === ref) {
          unsupported(sf, name, ref, `a computed access to '${local}', which the parse cannot read`);
        }
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== ref) {
          unsupported(sf, name, ref, `'${local}' used as a value, which can carry its assert where the parse cannot follow`);
        }
        if (parent.name.text === 'assert' && !isCallee(parent)) unsupported(sf, name, ref, `'${local}.assert' not called where it is named`);
      }
    }
    for (const local of asserts) {
      for (const ref of scope.references.get(local) ?? []) if (!isCallee(ref)) unsupported(sf, name, ref, `'${local}', fast-check's assert, not called where it is named`);
    }
    const sites: PropertySite[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        // The engine reports a call at its callee's name: `assert` in `fc.assert(...)`, the identifier in `assert(...)`.
        let at: ts.Node | undefined;
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'assert' && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) at = callee.name;
        else if (ts.isIdentifier(callee) && asserts.has(callee.text)) at = callee;
        if (at !== undefined) sites.push({ file: name, line: sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1 });
      }
      node.forEachChild(visit);
    };
    visit(sf);
    return sites.sort((a, b) => a.line - b.line);
  }

  preload(pin: PropertyPin, tests: readonly string[]): string {
    return preloadSource(pin, tests);
  }

  environment(path: string): Readonly<Record<string, string>> {
    return { NODE_OPTIONS: `--import=${pathToImport(path)}` };
  }

  reports(stdout: string, pin: PropertyPin): PropertyRun[] | null {
    return readReports(stdout, pin.marker);
  }
}

/** Whether `node` is the callee of a call, through any wrapper that does not change its value. */
function isCallee(node: ts.Node): boolean {
  let at = node;
  while (ts.isParenthesizedExpression(at.parent) || ts.isNonNullExpression(at.parent) || ts.isAsExpression(at.parent)) at = at.parent;
  return ts.isCallExpression(at.parent) && at.parent.expression === at;
}

function unsupported(sf: ts.SourceFile, name: string, node: ts.Node, what: string): never {
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  return refuse('unsupported-feature', `${name}:${String(line)}: ${what}; a property is registered only by calling fast-check's assert directly`);
}

/** A POSIX path inside the sandbox as `--import` takes it: a `file:` URL, so no character of it is read as a specifier. */
function pathToImport(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The tag that begins every report line: the framework, then the per-check marker. */
export function reportTag(marker: string): string {
  return `PROPERTY-RUN ${marker} `;
}

/**
 * The reports in `stdout`, in order. A report line names a locked file and
 * line, a seed, a count, whether it failed, and its counterexample. A tagged
 * line that cannot be read makes the whole set unreadable rather than
 * shorter, because a dropped report would read as a property that never ran
 * rather than one that did. A report located in no locked file is kept with
 * an empty file name, for the comparison to refuse.
 *
 * Nothing is readable unless the preload said it configured the framework.
 * Only then does an empty set mean the file never reached a property, rather
 * than that the pin was never set (gemini-3).
 */
export function readReports(stdout: string, marker: string): PropertyRun[] | null {
  const tag = reportTag(marker);
  const runs: PropertyRun[] = [];
  let ready = false;
  for (const raw of stdout.split('\n')) {
    const at = raw.indexOf(tag);
    if (at === -1) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw.slice(at + tag.length));
    } catch {
      return null;
    }
    if (typeof value !== 'object' || value === null) return null;
    const r = value as Record<string, unknown>;
    if (Object.keys(r).length === 1 && r.ready === true) {
      ready = true;
      continue;
    }
    const file = r.file === null ? '' : r.file;
    const line = r.line === null ? 0 : r.line;
    if (typeof file !== 'string' || !isCount(line) || !Number.isInteger(r.seed) || !isCount(r.casesRun) || typeof r.failed !== 'boolean') return null;
    const counterexample = r.counterexample;
    if (counterexample !== null && typeof counterexample !== 'string') return null;
    runs.push({ file, line, seed: r.seed as number, casesRun: r.casesRun, failed: r.failed, counterexample });
  }
  return ready ? runs : null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * The preload. Everything it is given is a JSON literal, so no pinned value
 * is spliced into code as anything but data. It locates a run at the
 * innermost stack frame in a locked file, which source maps give as the
 * `assert` call's own line.
 */
function preloadSource(pin: PropertyPin, tests: readonly string[]): string {
  const config = JSON.stringify({ seed: pin.seed, numRuns: pin.numRuns, tag: reportTag(pin.marker), files: [...tests] });
  return `// Written by the runtime for one property check (R25). Not part of the tree under test.
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const config = ${config};
const root = process.cwd();
const dir = join(root, 'node_modules', 'fast-check');
const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const entry = manifest.exports?.['.']?.import?.default;
if (typeof entry !== 'string') throw new Error('the installed fast-check declares no ESM entry, so its runs cannot be pinned');
const fc = await import(pathToFileURL(join(dir, entry)).href);
const files = new Set(config.files);
const frame = /(?:\\(|\\s)((?:file:\\/\\/)?[^\\s()]+):(\\d+):(\\d+)\\)?$/;
function site() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 200;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  for (const text of stack.split('\\n')) {
    const m = frame.exec(text.trim());
    if (m === null) continue;
    const path = m[1].startsWith('file://') ? fileURLToPath(m[1]) : m[1];
    const name = relative(root, path).split(sep).join('/');
    if (files.has(name)) return { file: name, line: Number(m[2]) };
  }
  return { file: null, line: null };
}
fc.configureGlobal({
  seed: config.seed,
  numRuns: config.numRuns,
  reporter(details) {
    const where = site();
    const counterexample = details.failed && details.counterexample !== null ? fc.stringify(details.counterexample) : null;
    process.stdout.write(config.tag + JSON.stringify({ file: where.file, line: where.line, seed: details.seed, casesRun: details.numRuns, failed: details.failed, counterexample }) + '\\n');
    const message = fc.defaultReportMessage(details);
    if (message !== undefined) throw new Error(message);
  },
});
process.stdout.write(config.tag + JSON.stringify({ ready: true }) + '\\n');
`;
}
