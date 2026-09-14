/**
 * The shipped default policy document.
 *
 * It grants nothing (D-P3-05). `roles` is empty, so every
 * `resolveCapabilities` call against it refuses and every `resolveAutonomy`
 * call refuses — which is what default deny means (I4). A shipped policy that
 * granted a role something before any role is defined anywhere in the system
 * would be a grant nobody authored, written by the unit least able to say what
 * a role needs.
 *
 * `globalCap: 2` is therefore a ceiling waiting for roles, not a permission:
 * L3 is out of M1's scope entirely, and the cap says so in the one place a
 * reader looks.
 *
 * The suite validates this document through `validatePolicyDocument` rather
 * than trusting its type, so the default and the validator cannot drift.
 */
import type { PolicyDocument } from './types.js';

/**
 * In-repo paths that escalate rather than hard-fail: a task that touches one
 * is not blocked, but the `integrate` gate stops being automatic
 * (`StationContract.protectedPathPolicy`). These are the files by which a
 * green suite can be manufactured — the checks themselves, what runs them, and
 * what pins their versions.
 */
const PROTECTED_PATHS: readonly string[] = [
  '.github/**',
  '.changeset/**',
  'package.json',
  'packages/*/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'packages/*/tsconfig.json',
  'eslint.config.js',
  'vitest.config.*',
  'packages/*/vitest.config.*',
  'packages/conformance/**',
];

export const DEFAULT_POLICY_DOCUMENT: PolicyDocument = {
  globalCap: 2,
  // No station tightens the global cap by default. An omitted entry is not L0
  // (D-P3-06); it means this document adds no station-specific restriction.
  stationCaps: {},
  // Empty, so all forty resolve to 'human-required'. Every `auto` in a policy
  // is a deliberate line in a diff.
  approvals: {},
  // I4. P4 and P5 add roles when they have them.
  roles: {},
  protectedPaths: [...PROTECTED_PATHS],
  triggers: {
    // M1 is human trigger only.
    enabled: ['human'],
    entryStation: { human: 'intake' },
    // I7: a template is pre-declared here and a payload can never name one.
    // Empty because no template registry exists yet — the compiler is M2, and
    // naming a template nothing declares would be a fiction that reads as
    // wiring.
    taskTemplate: {},
    maxAutonomy: { human: 2 },
    minAuthorTrust: { human: 'owner' },
    maxTriggerDepth: 2,
    budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
  },
  concurrency: { maxParallelTasks: 4, maxConflictRetries: 3 },
};
