/**
 * The tool inventory: every tool this driver can offer a task
 * (`I4.driver-tool-inventory-validated`).
 *
 * A constant rather than a probe, because `validateToolGrants` runs before any
 * task starts and an inventory that needed a container to produce would make
 * the check depend on the thing it is supposed to gate. The constant is held
 * honest the other way round: an assertion starts the CLI with every tool
 * granted and requires the session to report exactly this set, so a CLI
 * upgrade that adds or removes a tool fails the suite instead of silently
 * widening or narrowing what policy can grant. That is why the version in
 * `image.ts` is exact and never a range.
 *
 * MCP tools are deliberately absent. They exist only for the servers a
 * particular request configures, so they are not something the *driver* can
 * offer; naming them here would be claiming an inventory the driver does not
 * have.
 */
export const DECLARED_TOOLS: readonly string[] = [
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterWorktree',
  'ExitWorktree',
  'ListAgents',
  'NotebookEdit',
  'Read',
  'ReportFindings',
  'ScheduleWakeup',
  'SendMessage',
  'Skill',
  'Task',
  'TaskStop',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
];

/** Tools whose use is a write to the workspace, for event classification. */
const WRITE_TOOLS = new Set(['Edit', 'NotebookEdit', 'Write']);

/** Tools whose use leaves the sandbox, for event classification. */
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);

/** Tools whose use starts a child task under the same provenance. */
const SUBAGENT_TOOLS = new Set(['Task']);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function isNetworkTool(name: string): boolean {
  return NETWORK_TOOLS.has(name);
}

export function isSubagentTool(name: string): boolean {
  return SUBAGENT_TOOLS.has(name);
}

export function isCommandTool(name: string): boolean {
  return name === 'Bash';
}

/**
 * The file path a write tool's input names, if it names one.
 *
 * Read from the model's own tool input, so it is a claim about what was
 * written and never evidence of it. `AgentClaim.filesChanged` is the field
 * that says so; the runtime's own diff is what P6 will compare it against.
 */
export function writtenPath(name: string, input: Record<string, unknown>): string | undefined {
  if (!isWriteTool(name)) return undefined;
  const path: unknown = input.file_path ?? input.notebook_path ?? input.path;
  return typeof path === 'string' && path !== '' ? path : undefined;
}
