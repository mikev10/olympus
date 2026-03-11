/**
 * MCP Process Cleanup Hook
 *
 * Kills orphaned MCP server processes from previous Claude Code sessions.
 * Only kills processes whose parent process no longer exists (safe for
 * multiple simultaneous Claude Code sessions).
 *
 * Windows-only for now — gracefully skips on other platforms.
 */

import { execSync } from 'child_process';
import { registerHook } from '../registry.js';
import type { HookContext, HookResult } from '../types.js';

export const HOOK_NAME = 'mcpProcessCleanup';

// Matches npx invocations or direct node runs of MCP packages
export const MCP_COMMAND_PATTERN = /mcp/i;

export const MCP_SPECIFIC_PATTERNS = [
  /server-filesystem/i,
  /context7/i,
  /playwright.*mcp|mcp.*playwright/i,
  /perplexity/i,
  /shadcn/i,
  /mcp-local-rag/i,
];

export interface ProcessInfo {
  ProcessId: number;
  ParentProcessId: number;
  CommandLine: string | null;
}

export function isMcpProcess(commandLine: string | null): boolean {
  if (!commandLine) return false;
  return MCP_COMMAND_PATTERN.test(commandLine);
}

export function findOrphanedMcpProcesses(
  processes: ProcessInfo[],
  allRunningPids: Set<number>
): ProcessInfo[] {
  return processes.filter(p => {
    if (!isMcpProcess(p.CommandLine)) return false;
    // Parent is dead — this process is orphaned
    return !allRunningPids.has(p.ParentProcessId);
  });
}

export function killOrphanedProcesses(orphaned: ProcessInfo[]): number {
  let killed = 0;
  for (const proc of orphaned) {
    try {
      execSync(`taskkill /T /F /PID ${proc.ProcessId}`, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe'
      });
      killed++;
    } catch {
      // Process may have already exited — not an error
    }
  }
  return killed;
}

export function cleanupOrphanedMcpProcesses(): number {
  if (process.platform !== 'win32') {
    return 0; // Only Windows for now
  }

  try {
    const psScript = `
      $nodeProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Select-Object ProcessId, ParentProcessId, CommandLine;
      $allPids = (Get-Process -ErrorAction SilentlyContinue).Id;
      @{
        nodeProcesses = @($nodeProcs | ForEach-Object { @{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; CommandLine=$_.CommandLine } });
        allPids = @($allPids)
      } | ConvertTo-Json -Depth 3
    `.replace(/\n/g, ' ');

    const output = execSync(
      `powershell -NoProfile -Command "${psScript}"`,
      { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const data = JSON.parse(output);
    const processes: ProcessInfo[] = Array.isArray(data.nodeProcesses)
      ? data.nodeProcesses
      : data.nodeProcesses ? [data.nodeProcesses] : [];
    const allPids = new Set<number>(
      Array.isArray(data.allPids) ? data.allPids : data.allPids ? [data.allPids] : []
    );

    const orphaned = findOrphanedMcpProcesses(processes, allPids);
    if (orphaned.length === 0) return 0;

    return killOrphanedProcesses(orphaned);
  } catch (error) {
    // Never block session start
    console.error('[Olympus MCP Cleanup] Error:', error);
    return 0;
  }
}

export function createMcpCleanupHook(): void {
  registerHook({
    name: HOOK_NAME,
    event: 'SessionStart',
    priority: 1, // Run FIRST — before any other session hooks
    handler: (_ctx: HookContext): HookResult => {
      const killed = cleanupOrphanedMcpProcesses();

      if (killed > 0) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `[MCP Cleanup] Removed ${killed} orphaned MCP server process${killed === 1 ? '' : 'es'} from previous session(s).`
          }
        };
      }

      return { continue: true };
    }
  });
}
