import { compileError, lintFixture, pending, runtime } from '../kit/assert.js';
import { resolvedRuleSeverity, workspaceEslint } from '../kit/eslint.js';
import { castsFrom, packageProgram } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { walkFiles, workspacePackages, workspaceRelative } from '../kit/workspace.js';

/**
 * The typed lint rules I7 depends on. The type system stops UntrustedText
 * from reaching a string-typed slot; these three stop the coercions the type
 * system allows (`+`, template interpolation, String()).
 */
export const I7_LINT_RULES: readonly string[] = [
  '@typescript-eslint/restrict-plus-operands',
  '@typescript-eslint/restrict-template-expressions',
  '@typescript-eslint/no-base-to-string',
];

const UNTRUSTED_TYPES: ReadonlySet<string> = new Set(['UntrustedText', 'UntrustedPayload']);

/**
 * Files permitted to cast UntrustedText or UntrustedPayload, as
 * workspace-relative POSIX paths. The trigger extractor is the only
 * legitimate reader and it does not exist yet (M2), so the list is empty.
 */
const CAST_ALLOWLIST: readonly string[] = [];

/** I7: Event payloads are data, never instructions. */
export const I7: InvariantEntry = {
  title: INVARIANTS.I7,
  assertions: [
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
    runtime({
      id: 'I7.lint-rules-active',
      title: 'the resolved ESLint configuration keeps restrict-plus-operands, restrict-template-expressions, and no-base-to-string at error for every TypeScript file in every package',
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
  ],
  pending: [
    pending({
      id: 'I7.extracted-field-schemas',
      owner: 'M2',
      reason:
        'TriggerEvent.extracted is the only path from a payload into a run and it is an unconstrained ' +
        'Record<string, string>. Per-kind field schemas with length caps and character-class validation ' +
        'must exist, and be asserted, before any non-human trigger is enabled. The trigger framework is M2.',
    }),
  ],
};
