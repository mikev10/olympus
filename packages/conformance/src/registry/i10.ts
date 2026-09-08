import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { runtime } from '../kit/assert.js';
import { GREEK_NAMES, packageProgram, splitWords, words } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { workspacePackages, workspaceRelative } from '../kit/workspace.js';

/**
 * The one exemption: the npm scope every package publishes under, and the
 * CLI package name that shares it. Both are distribution names, not code.
 * The scan removes exactly these before looking for Greek words, so
 * `@olympus-ai/core` passes and `olympusRunState` does not.
 */
const SCOPE = /@olympus-ai\//g;
const CLI_PACKAGE = /^olympus-ai$/;
function stripScope(text: string): string {
  return text.replace(SCOPE, '').replace(CLI_PACKAGE, '');
}

/**
 * The two places the words must appear: the file that holds the word list,
 * and the unit test that proves the scanner finds them.
 */
const WORD_LIST_FILES: ReadonlySet<string> = new Set([
  'packages/conformance/src/kit/scan.ts',
  'packages/conformance/test/kit/scan.test.ts',
]);

/** Config files whose keys and values are code-adjacent: package names, script names, path maps. */
const CONFIG_FILES = ['package.json', 'tsconfig.json'];

/** Prose fields in package.json that the scan leaves alone. */
const PROSE_KEYS: ReadonlySet<string> = new Set(['description']);

/** Every key and string value in a JSON document, with a dotted path to each. */
function jsonStrings(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === 'string') {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      jsonStrings(item, `${path}[${String(index)}]`, out);
    });
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const next = path === '' ? key : `${path}.${key}`;
      out.push({ path: next, text: key });
      if (!PROSE_KEYS.has(key)) jsonStrings(item, next, out);
    }
  }
}

/** I10: Greek names never appear in code. */
export const I10: InvariantEntry = {
  title: INVARIANTS.I10,
  assertions: [
    runtime({
      id: 'I10.no-greek-names-in-code',
      title: 'no identifier, string literal, file path, or config key in any package contains a Greek name; the npm scope is the one exemption',
      run: () => {
        const greek = new Set(GREEK_NAMES);
        const hits: string[] = [];
        const packages = workspacePackages();
        if (packages.length === 0) throw new Error('I10: no packages found');
        for (const pkg of packages) {
          const { files } = packageProgram(pkg);
          for (const sf of files) {
            const file = workspaceRelative(sf.fileName);
            if (WORD_LIST_FILES.has(file)) continue;
            for (const word of splitWords(file.slice('packages/'.length))) {
              if (greek.has(word)) hits.push(`${file}: path contains '${word}'`);
            }
            for (const site of words(sf, stripScope)) {
              if (greek.has(site.word)) hits.push(`${site.file}:${String(site.line)}: ${site.source} '${site.text}' contains '${site.word}'`);
            }
          }
          for (const name of CONFIG_FILES) {
            const file = join(pkg.dir, name);
            if (!existsSync(file)) continue;
            const strings: Array<{ path: string; text: string }> = [];
            jsonStrings(ts.readConfigFile(file, (path) => ts.sys.readFile(path)).config, '', strings);
            for (const { path, text } of strings) {
              for (const word of splitWords(stripScope(text))) {
                if (greek.has(word)) hits.push(`${pkg.relativeDir}/${name}: ${path} contains '${word}'`);
              }
            }
          }
        }
        if (hits.length > 0) throw new Error(`I10: Greek names in code\n  ${hits.join('\n  ')}`);
      },
    }),
  ],
  pending: [],
};
