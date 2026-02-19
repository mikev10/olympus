/**
 * Workflow Status Hook
 *
 * UserPromptSubmit hook (priority 6) that detects /workflow-status invocations
 * and programmatically generates a workflow status report via generateWorkflowReport().
 * The report is injected via additionalContext so the AI doesn't need to parse manifest JSON directly.
 */

import { registerHook } from '../registry.js';
import { generateWorkflowReport } from '../../features/workflow-engine/status-reporter.js';
import { loadManifest } from '../../features/workflow-engine/manifest.js';
import { loadTrustState } from '../../features/workflow-engine/trust.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import * as path from 'path';
import type { HookContext, HookResult } from '../types.js';

export function registerWorkflowStatusHook(): void {
  registerHook({
    name: 'workflowStatusReporter',
    event: 'UserPromptSubmit',
    priority: 6,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        const directory = ctx.directory || process.cwd();

        // Detect /workflow-status invocation
        const prompt = ctx.prompt || '';
        const parts = ctx.parts || [];
        const fullText = parts.map(p => p.text || '').join(' ') || prompt;

        // Check for the skill template markers (expanded by Claude Code)
        const isWorkflowStatus = fullText.includes('Show status of all active structured workflows') ||
          fullText.includes('workflow-status');

        if (!isWorkflowStatus) {
          return { continue: true };
        }

        // Find active workflow
        const workflowIds = await listWorkflows(directory);
        let activeWorkflowId: string | null = null;

        for (const wfId of workflowIds) {
          const cp = await loadCheckpoint(directory, wfId);
          if (cp && cp.status !== 'complete' && cp.status !== 'archived' && cp.status !== 'deferred') {
            activeWorkflowId = wfId;
            break;
          }
        }

        if (!activeWorkflowId) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext: `<workflow-status>\nNo active workflows found. Start one with \`/plan <description>\`\n</workflow-status>`
            }
          };
        }

        // Load manifest
        const manifestPath = path.join(directory, 'aidlc-docs', activeWorkflowId, 'manifest.json');
        const manifest = loadManifest(manifestPath);

        if (!manifest) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext: `<workflow-status>\nNo active workflows found. Start one with \`/plan <description>\`\n</workflow-status>`
            }
          };
        }

        // Load trust state
        const trustState = loadTrustState(directory);

        // Generate programmatic report
        const report = generateWorkflowReport(manifest, trustState);

        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: `<workflow-status>\n${report.fullReport}\n</workflow-status>`
          }
        };
      } catch (error) {
        console.error('[Olympus Workflow Status] Error generating report:', error);
        return { continue: true };
      }
    }
  });
}
