/**
 * The tool inventory: every tool this driver can offer a task, and the one
 * setting of the pinned CLI that turns each on or off (D-R26-03).
 *
 * A constant rather than a probe, because `validateToolGrants` runs before
 * any task starts. It is held honest the other way round: before every task
 * the driver reads the tools the session's request actually carries
 * (D-R26-02), and the suite grants every shape and requires the request to
 * hold exactly that set. A CLI upgrade that adds, renames, or regroups a tool
 * fails the inspection rather than widening or narrowing what policy can
 * grant, which is why the version in `image.ts` is exact.
 *
 * A group is the tools one setting governs. The CLI offers all of a group or
 * none of it, so a grant naming part of one is refused: the session would
 * otherwise hold the rest, which nobody granted (I4).
 */

/** How the CLI is told to offer a group: a feature flag, or which of the two catalogs it reads (D-R26-04). */
export type ToolLever = { readonly kind: 'feature'; readonly feature: string } | { readonly kind: 'catalog' };

export interface ToolGroup {
  readonly tools: readonly string[];
  readonly lever: ToolLever;
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  // `exec_command` runs a command and `write_stdin` writes to one it left running. One feature governs both.
  { tools: ['exec_command', 'write_stdin'], lever: { kind: 'feature', feature: 'shell_tool' } },
  // No setting governs it: the catalog's `apply_patch_tool_type` does.
  { tools: ['apply_patch'], lever: { kind: 'catalog' } },
  { tools: ['view_image'], lever: { kind: 'feature', feature: 'view_image' } },
  { tools: ['get_goal', 'create_goal', 'update_goal'], lever: { kind: 'feature', feature: 'goals' } },
];

/**
 * Every tool a grant may name, sorted. Not here, and always off: `web_search`,
 * which OpenAI runs and bills per call outside the usage the relay reads;
 * `request_user_input`, which asks a person nobody provides; `tool_search` and
 * the multi-agent tools, which are out of scope (D-R26-03).
 */
export const DECLARED_TOOLS: readonly string[] = TOOL_GROUPS.flatMap((group) => group.tools).sort((a, b) => a.localeCompare(b));

/** Tools whose use runs a command in the sandbox. */
const COMMAND_TOOLS = new Set(['exec_command', 'write_stdin']);

export function isCommandTool(name: string): boolean {
  return COMMAND_TOOLS.has(name);
}

/** The groups a grant names, or the reason it cannot be honoured exactly. */
export function groupsFor(tools: readonly string[]): { readonly groups: readonly ToolGroup[] } | { readonly refusal: string } {
  const granted = new Set(tools);
  const undeclared = [...granted].filter((tool) => !DECLARED_TOOLS.includes(tool)).sort((a, b) => a.localeCompare(b));
  if (undeclared.length > 0) {
    return { refusal: `the task grants ${undeclared.map((t) => `'${t}'`).join(', ')}, which this driver does not declare` };
  }
  const groups: ToolGroup[] = [];
  for (const group of TOOL_GROUPS) {
    const held = group.tools.filter((tool) => granted.has(tool));
    if (held.length === 0) continue;
    if (held.length < group.tools.length) {
      const rest = group.tools.filter((tool) => !granted.has(tool));
      return {
        refusal:
          `the task grants ${held.map((t) => `'${t}'`).join(', ')} without ${rest.map((t) => `'${t}'`).join(', ')}, ` +
          'and the CLI offers those tools together or not at all',
      };
    }
    groups.push(group);
  }
  return { groups };
}
