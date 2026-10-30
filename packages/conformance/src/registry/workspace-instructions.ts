/**
 * Workspace instructions, per driver (R23). A seat runs under its role alone:
 * no instruction file an agent can plant in the tree it hands on reaches the
 * next seat's session. Each driver reads its working tree its own way, so
 * each driver owes its own assertion of that, in its own suite, and the
 * table below names it.
 *
 * `I3.every-driver-has-a-workspace-instruction-assertion` holds the table to
 * the workspace: every package under `packages/drivers/` has a row, and every
 * row names an I3 entry in that package, registered or pending. A driver
 * added without one fails the registry until its unit registers the
 * assertion, or records it pending in the ratcheted baseline (D-A-DD-03).
 */
import { external, runtime } from '../kit/assert.js';
import type { AssertionId, InvariantEntry } from '../kit/types.js';
import { workspacePackages } from '../kit/workspace.js';

const CLAUDE_CODE = '@olympus-ai/driver-claude-code';
const OPENAI_COMPATIBLE = '@olympus-ai/driver-openai-compatible';

/** Each driver package and the id of the assertion it owes. */
export const WORKSPACE_INSTRUCTION_ASSERTIONS: Readonly<Record<string, AssertionId>> = {
  [CLAUDE_CODE]: 'I3.workspace-instructions-not-loaded',
  [OPENAI_COMPATIBLE]: 'I3.openai-compatible-workspace-instructions-not-loaded',
};

/** Where the workspace keeps its drivers (F1's package list: `drivers/*`). */
const DRIVERS_DIR = 'packages/drivers/';

/** Every problem with the table against `drivers` and the I3 entry, or none. */
export function workspaceInstructionProblems(
  drivers: readonly string[],
  table: Readonly<Record<string, AssertionId>>,
  entry: InvariantEntry,
): string[] {
  const problems: string[] = [];
  if (drivers.length === 0) problems.push(`no driver package found under ${DRIVERS_DIR}`);
  for (const driver of drivers) {
    const id = table[driver];
    if (id === undefined) {
      problems.push(`${driver} has no workspace-instruction assertion; register one in its suite, or a pending entry owned by its unit`);
      continue;
    }
    const registered = entry.assertions.some((a) => a.id === id && a.kind === 'external' && a.package === driver);
    const owed = entry.pending.some((p) => p.id === id);
    if (!registered && !owed) problems.push(`${driver}: ${id} is neither an I3 assertion in that package nor pending under I3`);
  }
  for (const named of Object.keys(table)) {
    if (!drivers.includes(named)) problems.push(`${named} is in the table but is not a package under ${DRIVERS_DIR}`);
  }
  return problems;
}

export const R23_I3 = [
  // Paid: a real container on the pinned image and real model calls. Raised by R20's external review (codex-1, D-R20-12); skills added by R23.
  external({
    id: 'I3.workspace-instructions-not-loaded',
    title:
      'a CLAUDE.md, a rules file, an agent definition named for the role, and a skill under .claude/skills and .agents/skills, planted in the workspace, '
      + "reach none of the session's instructions with no tools or with Skill granted, while the same session without --setting-sources '' lists the .claude/skills plant: "
      + 'the task runs under its role alone, so the agent cannot rewrite what instructs the next seat through the tree it hands on',
    level: 'runtime',
    package: CLAUDE_CODE,
    file: 'test/invariants.test.ts',
  }),
  external({
    id: 'I3.openai-compatible-workspace-instructions-not-loaded',
    title:
      'a workspace holding a CLAUDE.md, an AGENTS.md, a rules file, an agent definition named for the role, and a skill in each known location '
      + 'leaves every request the driver sends byte-identical to the same task over an empty workspace: the session runs under its role alone',
    level: 'runtime',
    package: OPENAI_COMPATIBLE,
    file: 'test/invariants.test.ts',
  }),
  runtime({
    id: 'I3.every-driver-has-a-workspace-instruction-assertion',
    title:
      'every package under packages/drivers/ names a workspace-instruction assertion that I3 registers in that package or holds pending, '
      + 'no row names anything else, and a driver package added without one is refused',
    run: async () => {
      const { I3 } = await import('./i3.js');
      const drivers = workspacePackages()
        .filter((p) => p.relativeDir.startsWith(DRIVERS_DIR))
        .map((p) => p.name);
      const problems = workspaceInstructionProblems(drivers, WORKSPACE_INSTRUCTION_ASSERTIONS, I3);
      if (problems.length > 0) throw new Error(`I3: a driver is missing its workspace-instruction assertion\n  ${problems.join('\n  ')}`);
      // The check must bite, not merely pass: a driver package with no row is refused.
      const phantom = '@olympus-ai/driver-phantom';
      const refused = workspaceInstructionProblems([...drivers, phantom], WORKSPACE_INSTRUCTION_ASSERTIONS, I3);
      if (!refused.some((p) => p.startsWith(`${phantom} has no workspace-instruction assertion`))) {
        throw new Error('I3: a driver package with no workspace-instruction assertion was not refused');
      }
    },
  }),
];
