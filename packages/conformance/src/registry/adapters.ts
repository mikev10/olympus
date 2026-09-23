/**
 * The runtime assertions P8 owns, over `@olympus-ai/adapters`: that an
 * unsupported stack is loud and refused at L3 (I5), that no adapter runs
 * repository code on the host (I1), and that a behavioral check whose
 * expectation did not hold fails the gate whatever its exit code (I2).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { runtime } from '../kit/assert.js';
import { moduleSpecifiers, packageProgram, propertyChains, sourceFilesOutsideProgram, walk } from '../kit/scan.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspacePackages, workspaceRelative } from '../kit/workspace.js';

async function withRepository<T>(files: Readonly<Record<string, string>>, body: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'conformance-adapters-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const manifest = (devDependencies: Readonly<Record<string, string>>): string => JSON.stringify({ name: 'fixture', devDependencies });

export const UNSUPPORTED_STACK_IS_LOUD: LocalAssertion = runtime({
  id: 'I5.unsupported-stack-is-loud',
  title:
    'an adapter set names every control it lacks — each null slot and each behavioral kind it does not carry — and is ' +
    'refused at L3 naming each, derived from its slots even when its own unavailableControls() under-reports; L0-L2 are not refused',
  run: async () => {
    const { adapterAdmission, buildAdapterSet } = await import('@olympus-ai/adapters');
    const options = { provider: null, coverage: null };

    await withRepository({ 'package.json': manifest({ mocha: '10.0.0' }) }, async (root) => {
      const set = await buildAdapterSet(root, options);
      if (set.test !== null) throw new Error(`I5: a repository with no supported framework got a test adapter (${set.test.stack})`);
      const named = set.unavailableControls();
      for (const control of ['test', 'coverage', 'mutation', 'behavioral:cli', 'behavioral:http', 'behavioral:browser']) {
        if (!named.includes(control)) throw new Error(`I5: an unsupported stack did not name ${control} among [${named.join(', ')}]`);
      }
      const l3 = adapterAdmission(set, 3);
      if (l3.ok) throw new Error('I5: an unsupported stack was admitted at L3');
      if (!l3.unavailable.includes('test')) throw new Error(`I5: the L3 refusal did not name the missing test adapter: ${l3.message}`);
      for (const level of [0, 1, 2] as const) {
        const admitted = adapterAdmission(set, level);
        if (!admitted.ok || admitted.level !== level) throw new Error(`I5: L${String(level)} was refused or changed by the adapter set`);
      }
    });

    // A supported stack still lacks mutation (M3) and the HTTP and browser kinds, so L3 stays refused at M1.
    await withRepository({ 'package.json': manifest({ vitest: '^4.1.0' }) }, async (root) => {
      const set = await buildAdapterSet(root, options);
      if (set.test === null) throw new Error(`I5: a vitest repository got no test adapter: ${set.reasons.get('test') ?? ''}`);
      const l3 = adapterAdmission(set, 3);
      if (l3.ok) throw new Error('I5: a set with no mutation adapter was admitted at L3');
      for (const control of ['mutation', 'behavioral:http', 'behavioral:browser']) {
        if (!l3.unavailable.includes(control)) throw new Error(`I5: the L3 refusal did not name ${control}: ${l3.message}`);
      }
    });

    // The refusal reads the slots, not only the set's own report of itself.
    const underReporting = {
      stack: 'custom', test: null, coverage: null, mutation: null, behavioral: [], manifest: null, unavailableControls: (): string[] => [],
    };
    const lied = adapterAdmission(underReporting, 3);
    if (lied.ok || !lied.unavailable.includes('mutation')) {
      throw new Error('I5: a set whose unavailableControls() returned nothing was admitted at L3 despite its null slots');
    }
  },
});

/** Modules whose purpose is to run code: a process, a VM context, a worker, or a loader that evaluates a config. */
const EXECUTING_MODULES: ReadonlySet<string> = new Set([
  'child_process', 'node:child_process', 'worker_threads', 'node:worker_threads', 'vm', 'node:vm', 'cluster', 'node:cluster',
  'module', 'node:module', 'execa', 'cross-spawn', 'shelljs', 'zx', 'jiti', 'tsx', 'ts-node', 'esbuild', 'vite', 'vitest/node',
]);

export const ADAPTERS_EXECUTE_NOTHING_ON_THE_HOST: LocalAssertion = runtime({
  id: 'I1.adapters-execute-nothing-on-the-host',
  title:
    'no file in packages/adapters imports a module that runs code (child_process, vm, workers, config loaders), loads a module ' +
    'by a computed name, or calls eval or Function; every .ts under its src is in the scanned program. A config is parsed, ' +
    'never loaded, and a behavioral scenario runs only through the sandbox provider',
  run: () => {
    const pkg = workspacePackages().find((p) => p.name === '@olympus-ai/adapters');
    if (pkg === undefined) throw new Error('I1: @olympus-ai/adapters is not in the workspace');
    const { files } = packageProgram(pkg);
    if (files.length === 0) throw new Error('I1: @olympus-ai/adapters has no source files');
    const omitted = sourceFilesOutsideProgram(pkg);
    if (omitted.length > 0) {
      throw new Error(`I1: the adapters tsconfig leaves source files out of its program, where this scan cannot see them\n  ${omitted.join('\n  ')}`);
    }
    const hits: string[] = [];
    for (const sf of files) {
      for (const m of moduleSpecifiers(sf)) {
        if (EXECUTING_MODULES.has(m.text)) hits.push(`${m.file}:${String(m.line)} imports ${m.text}`);
      }
      for (const chain of propertyChains(sf)) {
        if (/^process\.(dlopen|binding|_linkedBinding)$/.test(chain.text)) hits.push(`${chain.file}:${String(chain.line)} uses ${chain.text}`);
      }
      walk(sf, (node) => {
        const at = (): string => `${workspaceRelative(sf.fileName)}:${String(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)}`;
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const loads = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
          const first = node.arguments[0];
          if (loads && (first === undefined || !ts.isStringLiteral(first))) hits.push(`${at()} loads a module by a computed name`);
        }
        /*
         * Every mention of `eval` or `Function`, not only a direct call of one. `eval` reached
         * under another name — `globalThis['eval']`, `(0, eval)`, a binding taken from either —
         * runs exactly the same code, so matching the shape of the call is matching a spelling
         * rather than the capability. A reference is enough to report: nothing in these adapters
         * has any use for one.
         */
        if (ts.isIdentifier(node) && (node.text === 'eval' || node.text === 'Function')
          && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
          hits.push(`${at()} refers to ${node.text}`);
        }
        if (ts.isElementAccessExpression(node)) {
          const key = node.argumentExpression;
          if ((ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) && (key.text === 'eval' || key.text === 'Function')) {
            hits.push(`${at()} reaches ${key.text} by name`);
          }
        }
        if (ts.isPropertyAccessExpression(node) && (node.name.text === 'eval' || node.name.text === 'Function')) {
          hits.push(`${at()} reaches ${node.name.text} as a property`);
        }
      });
    }
    if (hits.length > 0) throw new Error(`I1: @olympus-ai/adapters can execute code on the host\n  ${hits.join('\n  ')}`);
  },
});

export const UNMET_EXPECTATION_FAILS_THE_GATE: LocalAssertion = runtime({
  id: 'I2.unmet-expectation-fails-the-gate',
  title:
    "a behavioral result whose process exited 0 with output the runtime's comparison rejects fails a required check's gate; " +
    'one whose expected non-zero exit held passes it; and a check with no expectation is still judged by its exit code',
  run: async () => {
    const [{ compareCli }, { requiredShortfall }] = await Promise.all([import('@olympus-ai/adapters'), import('@olympus-ai/api')]);
    const spec = { id: 'greets', kind: 'behavioral' as const, command: ['greet'] as const, required: true, timeoutMs: 1000 };
    const base = { checkId: 'greets', stderr: '', suiteCount: null, durationMs: 1, startedAt: new Date(0).toISOString() };

    const wrong = compareCli({ exitCode: 0, stdout: 'hello\n' }, { exitCode: 0, stdout: 'goodbye\n', stderr: '' });
    if (wrong.held) throw new Error("I2: the runtime's comparison accepted output that differs from the expectation");
    const failed = requiredShortfall(spec, { ...base, exitCode: 0, stdout: 'goodbye\n', expectation: wrong });
    if (failed?.cause !== 'expectation') {
      throw new Error(`I2: a zero exit with an unmet expectation did not fail the gate on its expectation (${failed?.cause ?? 'passed'})`);
    }

    const expectedFailure = compareCli({ exitCode: 2 }, { exitCode: 2, stdout: '', stderr: 'usage' });
    const passed = requiredShortfall(spec, { ...base, exitCode: 2, stdout: '', expectation: expectedFailure });
    if (passed !== undefined) throw new Error(`I2: an expected non-zero exit was read as a failure (${passed.cause})`);

    const plain = requiredShortfall(spec, { ...base, exitCode: 1, stdout: '', expectation: null });
    if (plain?.cause !== 'exit-code') throw new Error('I2: a check with no expectation was not judged by its exit code');
  },
});
