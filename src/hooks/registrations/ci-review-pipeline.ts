import { registerHook } from '../registry.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import { loadManifest } from '../../features/workflow-engine/manifest.js';
import { runAllCIChecks, loadCICheckConfig, formatCIResults } from '../../features/workflow-engine/ci-checks.js';
import { scanFileForSecrets, scanFileForXSS } from '../../features/workflow-engine/security-scanner.js';
import type { HookContext, HookResult } from '../types.js';
import { readFileSync } from 'fs';

/**
 * CI Review Pipeline Hook (PostToolUse, priority 79)
 *
 * Runs automated CI checks after BOLT execution and before Gate 4 review.
 * Fires when construction phase with code-generation stage and active_code_plan_path detected.
 * Injects CI check results into additionalContext for Gate 4 to see.
 * If any check fails, blocks Gate 4 with failure details.
 */
async function ciReviewPipeline(ctx: HookContext): Promise<HookResult> {
  try {
    // Only process Task tool completions
    if (ctx.toolName !== 'Task') {
      return { continue: true };
    }

    if (!ctx.directory || !ctx.sessionId) {
      return { continue: true };
    }

    // Find active workflow
    const workflows = await listWorkflows(ctx.directory);
    if (workflows.length === 0) return { continue: true };

    let checkpoint: any = null;
    let manifestPath = '';

    for (const workflowId of workflows) {
      const cp = await loadCheckpoint(ctx.directory, workflowId);
      if (cp && cp.status !== 'complete') {
        checkpoint = cp;
        manifestPath = cp.manifest_path || '';
        break;
      }
    }

    if (!checkpoint) return { continue: true };

    // Only fire for construction phase, code-generation stage with active code plan
    if (checkpoint.current_phase !== 'construction' ||
        checkpoint.current_stage !== 'code-generation' ||
        !checkpoint.active_code_plan_path) {
      return { continue: true };
    }

    const boltId = checkpoint.active_code_plan_path;

    // Load manifest
    const manifest = loadManifest(manifestPath);
    if (!manifest) return { continue: true };

    // Load CI check config
    const config = loadCICheckConfig(ctx.directory);

    // Run all CI checks
    const summary = runAllCIChecks(ctx.directory, config);

    // Run security scans on BOLT artifact content
    const boltArtifact = manifest.artifacts.find(a => a.id === boltId);
    let securityFindings: string[] = [];
    let riskyPatterns: string[] = [];

    if (boltArtifact) {
      try {
        const boltContent = readFileSync(boltArtifact.path, 'utf-8');
        securityFindings = scanFileForSecrets(boltContent, boltArtifact.path).map(f => f.message);
        riskyPatterns = scanFileForXSS(boltContent, boltArtifact.path).map(f => f.message);
      } catch {}
    }

    // Format results
    const ciResultsText = formatCIResults(summary);

    // Add security findings
    let securityText = '';
    if (securityFindings.length > 0) {
      securityText = `\n\nSECURITY FINDINGS:\n${securityFindings.map(f => `  - ${f}`).join('\n')}`;
      // Mark as failed if secrets found
      summary.allPassed = false;
      summary.failedChecks.push('Secret scanning');
    }

    if (riskyPatterns.length > 0) {
      securityText += `\n\nRISKY PATTERNS:\n${riskyPatterns.map(f => `  - ${f}`).join('\n')}`;
    }

    if (!summary.allPassed) {
      // CI checks failed - inject failure message that will block Gate 4
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[CI Review Pipeline - BLOCKING] CI checks failed for BOLT ${boltId}. Gate 4 review blocked until CI issues are resolved.\n\n${ciResultsText}${securityText}\n\nFix the failing checks and re-run the BOLT execution.`,
        },
      };
    }

    // All passed - inject results as informational context
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[CI Review Pipeline - PASSED] ${ciResultsText}${securityText}`,
      },
    };
  } catch (error) {
    console.error('[Olympus CI Review] Error in ciReviewPipeline:', error);
    return { continue: true }; // Fail open
  }
}

/**
 * Registers CI review pipeline hook.
 */
export function registerCIReviewPipelineHook(): void {
  registerHook({
    name: 'ciReviewPipeline',
    event: 'PostToolUse',
    priority: 79,  // After artifact-gate (78), before quality-gate (80)
    matcher: 'task',
    handler: ciReviewPipeline,
  });
}
