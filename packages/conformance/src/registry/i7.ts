import { castFixture, compileError, lintFixture, runtime } from '../kit/assert.js';
import { inlineSuppressions, resolvedRuleSeverity, workspaceEslint } from '../kit/eslint.js';
import { castsFrom, packageProgram } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { walkFiles, workspacePackages, workspaceRelative } from '../kit/workspace.js';
import { R20_I7 } from './roles.js';
import { R22_I7 } from './triggers.js';
import { R19_ASSERTIONS } from './drafting.js';
import { TELEMETRY_EXPORTS_NO_TEXT } from './telemetry.js';

/**
 * The typed lint rules I7 depends on. The type system stops UntrustedText
 * from reaching a string-typed slot; the first three stop the coercions the
 * type system allows (`+`, template interpolation, String()), and the
 * workspace's own sink rule stops JSON.stringify and widening to unknown, any,
 * or object (R22, D-R22-09).
 */
export const I7_LINT_RULES: readonly string[] = [
  '@typescript-eslint/restrict-plus-operands',
  '@typescript-eslint/restrict-template-expressions',
  '@typescript-eslint/no-base-to-string',
  'i7/no-untrusted-sink',
];

const UNTRUSTED_TYPES: ReadonlySet<string> = new Set(['UntrustedText', 'UntrustedPayload']);

/**
 * Files permitted to cast UntrustedText or UntrustedPayload, as
 * workspace-relative POSIX paths. The trigger extractor is the only
 * legitimate reader (R22).
 */
const CAST_ALLOWLIST: readonly string[] = ['packages/triggers/src/github.ts'];

/** I7: Event payloads are data, never instructions. */
export const I7: InvariantEntry = {
  title: INVARIANTS.I7,
  assertions: [
    // R22: the trigger framework, which registers the three entries M2 owed.
    ...R22_I7,
    // R20: the role compiler.
    // R19: drafting at spec and test-design.
    ...R19_ASSERTIONS.I7,
    ...R20_I7,
    // R12: only allowlisted typed fields leave in telemetry, and nothing reads it back.
    TELEMETRY_EXPORTS_NO_TEXT,
    compileError({
      id: 'I7.untrusted-text-is-not-a-string',
      title: 'UntrustedPayload.raw cannot reach a string-typed slot, a steer message, or a string method without a cast',
      fixture: 'i7/untrusted-text-is-not-a-string.ts',
    }),
    runtime({
      id: 'I7.no-cast-outside-extractor',
      title: 'no package source casts a value typed UntrustedText or UntrustedPayload',
      run: () => {
        const hits: string[] = [];
        for (const pkg of workspacePackages()) {
          const { files, checker } = packageProgram(pkg);
          for (const sf of files) {
            for (const cast of castsFrom(sf, checker, UNTRUSTED_TYPES)) {
              if (CAST_ALLOWLIST.includes(cast.file)) continue;
              hits.push(`${cast.file}:${String(cast.line)} casts ${cast.from}: ${cast.text}`);
            }
          }
        }
        if (hits.length > 0) {
          throw new Error(`I7: untrusted text is cast outside the trigger extractor\n  ${hits.join('\n  ')}`);
        }
      },
    }),
    castFixture({
      id: 'I7.cast-scan-sees-through-unknown',
      title: 'the cast scan reports the double cast `raw as unknown as string`, its angle-bracket form, and `as never`: the inner cast is from UntrustedText, and a plain string field is not reported',
      fixture: 'i7/untrusted-text-double-cast.ts',
      names: UNTRUSTED_TYPES,
    }),
    runtime({
      id: 'I7.lint-rules-active',
      title: 'the resolved ESLint configuration keeps restrict-plus-operands, restrict-template-expressions, no-base-to-string, and i7/no-untrusted-sink at error for every TypeScript file in every package',
      run: async () => {
        const files = workspacePackages()
          .flatMap((pkg) => walkFiles(pkg.dir))
          .filter((file) => !workspaceRelative(file).includes('/fixtures/types/'));
        if (files.length === 0) throw new Error('I7: no TypeScript files found under packages/');
        const eslint = workspaceEslint();
        const failures: string[] = [];
        for (const file of files) {
          for (const rule of I7_LINT_RULES) {
            const severity = await resolvedRuleSeverity(eslint, file, rule);
            if (severity !== 'error') failures.push(`${workspaceRelative(file)}: ${rule} is ${severity}`);
          }
        }
        if (failures.length > 0) {
          throw new Error(`I7: a lint rule the invariant depends on is not active\n  ${failures.join('\n  ')}`);
        }
      },
    }),
    lintFixture({
      id: 'I7.lint-rules-fire',
      title: 'the three rules report concatenation, interpolation, and String() of UntrustedText',
      fixture: 'i7/untrusted-text-coercion.ts',
    }),
    runtime({
      id: 'I7.lint-rules-not-suppressed-inline',
      title:
        'no package source outside fixtures/ carries an eslint-disable or inline eslint configuration comment that names one of the four rules, or a bare disable that silences every rule',
      run: () => {
        // The ordinary lint run honours inline configuration, so a disable
        // comment in a package source would silence a rule while the resolved
        // configuration still reports it at error and the fixture still fires.
        const hits = inlineSuppressions(I7_LINT_RULES, workspacePackages());
        if (hits.length > 0) {
          const detail = hits.map((h) => `${h.file}:${String(h.line)}: ${h.text}`).join('\n  ');
          throw new Error(`I7: a lint rule the invariant depends on is suppressed inline\n  ${detail}`);
        }
      },
    }),
  ],
  pending: [],
};
