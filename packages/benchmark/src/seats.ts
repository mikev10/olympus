/**
 * Scripted seats. A model cannot be relied on to plant a false-done on
 * request, so a seeded item's work is a scripted seat's: it writes the
 * item's change through the sandbox it was handed, as an agent would, and
 * returns the item's claim (D-R7-02). It is the stub driver underneath, so
 * it carries the stub's unsafe declaration and every run on it is held at L1.
 *
 * The seat is handed the change and the claim, never the item: nothing that
 * says what the change seeds reaches it, or the sandbox (I3).
 */
import { StubDriver, type RoleId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { render, type Change } from './corpus.js';

/** Where a drafted item's paths name the run's drafts directory, which only the run's id fixes (R19, D-R19-04). */
export const RUN_PLACEHOLDER = '{run}';

/** The program that lands a change inside the sandbox: its input is data on argv, never code. */
const APPLY = [
  "const fs = require('node:fs'); const path = require('node:path');",
  'const change = JSON.parse(process.argv[1]);',
  'for (const [file, text] of Object.entries(change.write)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }',
  'for (const file of change.remove) fs.rmSync(file, { force: true });',
].join('\n');

/** The change as the sandbox receives it: each file's bytes, joined on the host, at the run's own paths. */
export function landed(change: Change, runId: string | null = null): { write: Record<string, string>; remove: string[] } {
  const at = (file: string): string => {
    if (!file.includes(RUN_PLACEHOLDER)) return file;
    if (runId === null) throw new Error(`benchmark: ${file} names the run's drafts directory, and the seat was given no run`);
    return file.split(RUN_PLACEHOLDER).join(runId);
  };
  const write: Record<string, string> = {};
  for (const [file, content] of Object.entries(change.write)) write[at(file)] = render(content);
  return { write, remove: change.remove.map(at) };
}

/** The argv that lands `change` in a sandbox's working directory. */
export function applyCommand(change: Change, runId: string | null = null): string[] {
  return ['node', '-e', APPLY, JSON.stringify(landed(change, runId))];
}

/**
 * A seat that, for a task under `role`, lands the change in the task's
 * sandbox and claims the files it wrote: the build seat, or a drafter.
 * Every other task, the review task among them, gets the stub's empty claim.
 */
export class ScriptedSeat extends StubDriver {
  /** Every request the seat was handed, so a test can see what reached it. */
  readonly requests: TaskRequest[] = [];

  constructor(
    private readonly sandbox: SandboxProvider,
    private readonly role: RoleId,
    private readonly change: Change,
    private readonly narrative: string,
    private readonly runId: string | null = null,
  ) {
    super();
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    const result = await super.runTask(req);
    if (req.role.role !== this.role) return result;
    const ran = await this.sandbox.exec(req.sandbox, applyCommand(this.change, this.runId));
    if (ran.exitCode !== 0) throw new Error(`benchmark: the scripted seat's change did not land in task ${req.taskId}: ${ran.stderr}`);
    const { write, remove } = landed(this.change, this.runId);
    return { ...result, claim: { narrative: this.narrative, filesChanged: [...Object.keys(write), ...remove].sort() } };
  }
}
