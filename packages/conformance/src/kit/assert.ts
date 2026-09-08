/**
 * Constructors for registry assertions. Each returns a LocalAssertion whose
 * `run` throws on failure, so the registry runner can hand it to the test
 * runner as one test.
 */
import { join } from 'node:path';
import { assertLintFixture } from './eslint.js';
import { assertFixture, sharedFixtureCompiler } from './fixtures.js';
import type { AssertionId, ClaimId, ExternalAssertion, LocalAssertion, PendingAssertion, UnitId } from './types.js';
import { conformanceRoot } from './workspace.js';

interface FixtureAssertionSpec {
  readonly id: AssertionId | ClaimId;
  readonly title: string;
  /** Path relative to fixtures/types. */
  readonly fixture: string;
}

/** The fixture must produce exactly the diagnostics it annotates. */
export function compileError(spec: FixtureAssertionSpec): LocalAssertion {
  return {
    kind: 'local',
    id: spec.id,
    level: 'compile-error',
    title: spec.title,
    fixture: `fixtures/types/${spec.fixture}`,
    run: () => {
      const outcome = sharedFixtureCompiler().compile({ path: spec.fixture });
      if (outcome.expectations.length === 0) {
        throw new Error(`fixture ${outcome.file} is registered as compile-error but carries no expect-error annotations`);
      }
      assertFixture(outcome);
    },
  };
}

/** The fixture must compile with no diagnostics at all. */
export function compileOk(spec: FixtureAssertionSpec): LocalAssertion {
  return {
    kind: 'local',
    id: spec.id,
    level: 'compile-ok',
    title: spec.title,
    fixture: `fixtures/types/${spec.fixture}`,
    run: () => {
      const outcome = sharedFixtureCompiler().compile({ path: spec.fixture });
      if (outcome.expectations.length > 0) {
        throw new Error(`fixture ${outcome.file} is registered as compile-ok but carries expect-error annotations`);
      }
      assertFixture(outcome);
    },
  };
}

interface LintFixtureSpec {
  readonly id: AssertionId | ClaimId;
  readonly title: string;
  /** Path relative to fixtures/lint. */
  readonly fixture: string;
}

/** Every `expect-lint` annotation in the fixture must fire with inline configuration ignored. */
export function lintFixture(spec: LintFixtureSpec): LocalAssertion {
  return {
    kind: 'local',
    id: spec.id,
    level: 'runtime',
    title: spec.title,
    fixture: `fixtures/lint/${spec.fixture}`,
    run: async () => {
      await assertLintFixture(join(conformanceRoot(), 'fixtures', 'lint', spec.fixture));
    },
  };
}

interface GeneratedSpec {
  readonly id: AssertionId | ClaimId;
  readonly title: string;
  /** Virtual file name under fixtures/types; the file need not exist. */
  readonly name: string;
  /** Produces the source at run time, so it can be derived from the registry itself. */
  readonly source: () => string;
}

/** Generated source that must compile with no diagnostics. */
export function compileOkSource(spec: GeneratedSpec): LocalAssertion {
  return {
    kind: 'local',
    id: spec.id,
    level: 'compile-ok',
    title: spec.title,
    run: () => {
      assertFixture(sharedFixtureCompiler().compile({ path: spec.name, text: spec.source() }));
    },
  };
}

interface RuntimeSpec {
  readonly id: AssertionId | ClaimId;
  readonly title: string;
  readonly run: () => void | Promise<void>;
}

/** An executable check; throw to fail. */
export function runtime(spec: RuntimeSpec): LocalAssertion {
  return { kind: 'local', id: spec.id, level: 'runtime', title: spec.title, run: spec.run };
}

interface ExternalSpec {
  readonly id: AssertionId | ClaimId;
  readonly title: string;
  readonly level: LocalAssertion['level'];
  readonly package: string;
  readonly file: string;
}

/** An assertion another package runs in its own suite with `invariantTest`. */
export function external(spec: ExternalSpec): ExternalAssertion {
  return { kind: 'external', ...spec };
}

interface PendingSpec {
  readonly id: AssertionId | ClaimId;
  readonly owner: UnitId;
  readonly reason: string;
}

/** An assertion that cannot exist yet. The owner is the unit that must add it. */
export function pending(spec: PendingSpec): PendingAssertion {
  return spec;
}
