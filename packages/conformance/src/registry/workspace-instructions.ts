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

/** How every workspace-instruction assertion id ends: the property, after an optional driver prefix. */
const ID_SUFFIX = 'workspace-instructions-not-loaded';

/** Where the workspace keeps its drivers (F1's package list: `drivers/*`). */
const DRIVERS_DIR = 'packages/drivers/';

/** How a driver package is named. One named so anywhere but `DRIVERS_DIR` is refused. */
const DRIVER_NAME_PREFIX = '@olympus-ai/driver-';

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
  for (const [named, id] of Object.entries(table)) {
    if (!drivers.includes(named)) problems.push(`${named} is in the table but is not a package under ${DRIVERS_DIR}`);
    // An id is one driver's obligation and names the property, so a row cannot borrow an unrelated
    // pending entry or another driver's assertion to stand in for its own (codex-2, gemini-1).
    if (!id.endsWith(ID_SUFFIX)) problems.push(`${named}: ${id} does not name the workspace-instruction property (expected an id ending '${ID_SUFFIX}')`);
    const sharing = Object.entries(table).filter(([other, otherId]) => other !== named && otherId === id).map(([other]) => other);
    if (sharing.length > 0) problems.push(`${named}: ${id} is also the row of ${sharing.join(', ')}; each driver owes its own`);
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
      const packages = workspacePackages();
      const drivers = packages.filter((p) => p.relativeDir.startsWith(DRIVERS_DIR)).map((p) => p.name);
      // A package named as a driver and kept anywhere else would be found by nothing above (gemini-3).
      const misplaced = packages
        .filter((p) => p.name.startsWith(DRIVER_NAME_PREFIX) && !p.relativeDir.startsWith(DRIVERS_DIR))
        .map((p) => `${p.name} is named as a driver but lives at ${p.relativeDir}, outside ${DRIVERS_DIR}`);
      const problems = [...misplaced, ...workspaceInstructionProblems(drivers, WORKSPACE_INSTRUCTION_ASSERTIONS, I3)];
      if (problems.length > 0) throw new Error(`I3: a driver is missing its workspace-instruction assertion\n  ${problems.join('\n  ')}`);
      // The check must bite, not merely pass: a driver package with no row is refused.
      const phantom = '@olympus-ai/driver-phantom';
      const refused = workspaceInstructionProblems([...drivers, phantom], WORKSPACE_INSTRUCTION_ASSERTIONS, I3);
      if (!refused.some((p) => p.startsWith(`${phantom} has no workspace-instruction assertion`))) {
        throw new Error('I3: a driver package with no workspace-instruction assertion was not refused');
      }
      // A row cannot borrow another obligation: an unrelated pending id, or another driver's id (codex-2, gemini-1).
      const unrelated = I3.pending.map((p) => p.id).find((id): id is AssertionId => id.startsWith('I3.'));
      if (unrelated === undefined) throw new Error('I3: no pending entry to borrow, so the borrowing check is not exercised');
      const borrowing: Array<[string, Readonly<Record<string, AssertionId>>]> = [
        ['an unrelated pending id', { ...WORKSPACE_INSTRUCTION_ASSERTIONS, [phantom]: unrelated }],
        ["another driver's id", { ...WORKSPACE_INSTRUCTION_ASSERTIONS, [phantom]: WORKSPACE_INSTRUCTION_ASSERTIONS[CLAUDE_CODE] ?? unrelated }],
      ];
      for (const [label, table] of borrowing) {
        if (!workspaceInstructionProblems([...drivers, phantom], table, I3).some((p) => p.startsWith(phantom))) {
          throw new Error(`I3: a driver row naming ${label} was not refused`);
        }
      }
    },
  }),
];
