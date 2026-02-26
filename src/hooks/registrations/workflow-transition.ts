/**
 * Workflow Transition Messages Hook
 *
 * PostToolUse hook (priority 82, after quality-gate at 80) that emits brief
 * status messages at each stage transition. Messages are injected via
 * additionalContext (3-5 lines max to minimize token impact).
 *
 * Transition points:
 * 1. After INTENT approved
 * 2. After INTENT locked
 * 3. After UNITs created
 * 4. During BOLT execution (per-BOLT completion)
 * 5. After all BOLTs complete
 *
 * Also handles Risk Tier 3 dev notification as a blocking gate
 * (awaiting_dev_review checkpoint state).
 */

import { registerHook } from '../registry.js';
import { loadManifest, getBoltArtifacts, getUnitArtifacts } from '../../features/workflow-engine/manifest.js';
import { loadTrustState } from '../../features/workflow-engine/trust.js';
import { loadCheckpoint, saveCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import * as path from 'path';
import type { HookContext, HookResult } from '../types.js';
import type { ManifestSchema } from '../../features/workflow-engine/phase-types.js';

export function registerWorkflowTransitionHooks(): void {
  registerHook({
    name: 'workflowTransitionMessages',
    event: 'PostToolUse',
    priority: 82, // After quality-gate at 80
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        const directory = ctx.directory || process.cwd();

        // Only process Write or Task tool calls (these change workflow state)
        if (ctx.toolName !== 'Write' && ctx.toolName !== 'Task') {
          return { continue: true };
        }

        // Find active workflow
        const workflowIds = await listWorkflows(directory);
        let activeWorkflowId: string | null = null;
        let checkpoint = null;

        for (const wfId of workflowIds) {
          const cp = await loadCheckpoint(directory, wfId);
          if (cp && cp.status !== 'complete' && cp.status !== 'archived' && cp.status !== 'deferred') {
            activeWorkflowId = wfId;
            checkpoint = cp;
            break;
          }
        }

        if (!activeWorkflowId || !checkpoint) {
          return { continue: true };
        }

        // Load manifest
        const manifestPath = path.join(directory, 'aidlc-docs', activeWorkflowId, 'manifest.json');
        const manifest = loadManifest(manifestPath);
        if (!manifest) {
          return { continue: true };
        }

        // Load trust state
        const trustState = loadTrustState(directory);

        // Detect the most recent transition in the manifest's gate_audit
        const lastGateEntry = manifest.gate_audit.length > 0
          ? manifest.gate_audit[manifest.gate_audit.length - 1]
          : null;

        // Build transition message based on current state
        let message: string | null = null;

        const boltArtifacts = getBoltArtifacts(manifest);
        const completedBolts = boltArtifacts.filter(a => a.contract_status === 'fulfilled');
        const unitArtifacts = getUnitArtifacts(manifest);
        const intentArtifacts = manifest.artifacts.filter(a => a.stage === 'intent');

        // All BOLTs complete
        if (boltArtifacts.length > 0 && completedBolts.length === boltArtifacts.length &&
            checkpoint.current_stage === 'bolt' && manifest.phases.construction.status === 'complete') {
          message = `✓ All ${boltArtifacts.length} BOLTs executed and reviewed\n→ Next: Operations phase. Generating deployment guide and release notes...`;
        }
        // BOLT just completed (check if last gate was for construction)
        else if (completedBolts.length > 0 && completedBolts.length < boltArtifacts.length &&
                 lastGateEntry?.phase === 'construction' && lastGateEntry?.action === 'approved') {
          const remaining = boltArtifacts.length - completedBolts.length;
          const lastBolt = completedBolts[completedBolts.length - 1];
          message = `✓ BOLT ${completedBolts.length}/${boltArtifacts.length} complete — '${lastBolt.id}'\nGate 4: Dev review of ${lastBolt.id} code\n→ Current: ${remaining} remaining`;
        }
        // UNITs created (construction started, units exist)
        else if (unitArtifacts.length > 0 && manifest.phases.construction.status === 'in_progress' &&
                 checkpoint.current_stage === 'unit' &&
                 lastGateEntry?.phase === 'inception' && lastGateEntry?.action === 'approved') {
          const unitNames = unitArtifacts.map(u => u.id).join(', ');
          message = `✓ ${unitArtifacts.length} UNITs created: ${unitNames}\nGate 3: Dev review required (Trust Level ${trustState.current_level})\n→ Waiting: Developer reviews architectural decomposition`;
        }
        // INTENT locked
        else if (intentArtifacts.some(a => a.contract_status === 'active' || a.contract_status === 'fulfilled') &&
                 checkpoint.current_stage === 'intent' &&
                 lastGateEntry?.phase === 'inception') {
          const riskTier = manifest.risk_tier?.tier ?? 0;

          // Dev notification message
          let devNotice = '';
          if (riskTier === 3) {
            devNotice = '\n⚠ Risk Tier 3: Dev review REQUIRED before Construction';
            // Set awaiting_dev_review state for blocking gate
            if (checkpoint.status !== 'awaiting_dev_review') {
              checkpoint.status = 'awaiting_dev_review';
              await saveCheckpoint(directory, checkpoint);
            }
          }

          const intentPath = intentArtifacts.length > 0
            ? intentArtifacts[0].path
            : `aidlc-docs/${activeWorkflowId}/inception/intent.md`;
          message = `✓ INTENT locked — '${manifest.feature_name}'\nTech spec: ${intentPath} | Risk: Tier ${riskTier}\n${unitArtifacts.length} UNITs decomposed | ${boltArtifacts.length} BOLTs queued\n→ Ready: /ascent, /olympus, or /ultrawork to begin Construction${devNotice}`;
        }

        if (message) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: `<workflow-transition>\n${message}\n</workflow-transition>`
            }
          };
        }
      } catch (error) {
        console.error('[Olympus Workflow Transition] Error:', error);
      }

      return { continue: true };
    }
  });
}
