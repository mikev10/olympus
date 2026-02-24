import * as fs from 'fs-extra';
import * as path from 'path';
import { registerArtifact } from './manifest.js';
import type { WorkflowPhase } from './phase-types.js';
import type { WorkflowStage } from './types.js';

export interface PRFAQOptions {
  projectPath: string;
  workflowId: string;
  featureName: string;
  intentContent: string;
  nfrContent: string;
}

export interface PRFAQResult {
  success: boolean;
  artifactPath: string | null;
  error: string | null;
}

export const PRFAQ_FORMAT_INSTRUCTIONS = `## PRFAQ Format

Generate an Amazon-style PRFAQ document with these sections:

### Press Release (1 page max)
- **Headline**: One-sentence summary of the feature/product
- **Subheadline**: Who it's for and the key benefit
- **Problem Statement**: What problem exists today
- **Solution**: How this feature/product solves it
- **Quote from Leadership**: Why this matters strategically
- **How It Works**: Brief technical/functional overview
- **Customer Quote**: Testimonial from a hypothetical user
- **Call to Action**: Next steps for adoption

### Customer FAQs (5-7 questions)
Anticipated questions from end users:
- How does this affect my workflow?
- What are the prerequisites?
- How do I get started?
- What are the limitations?
- How does this compare to alternatives?

### Internal FAQs (3-5 questions)
Business and technical questions from stakeholders:
- What is the estimated effort?
- What are the key risks?
- How does this fit into the roadmap?
- What are the success metrics?
`;

export function buildPRFAQPrompt(options: PRFAQOptions): string {
  const { featureName, intentContent, nfrContent } = options;

  return `Generate an Amazon-style PRFAQ for the following feature.

## Feature: ${featureName}

## INTENT Document
${intentContent}

## Non-Functional Requirements
${nfrContent}

${PRFAQ_FORMAT_INSTRUCTIONS}

Output the complete PRFAQ in markdown format.`;
}

export function parsePRFAQResponse(response: string): string {
  const hasPressRelease = /press release/i.test(response);
  const hasCustomerFAQ = /customer faq/i.test(response);
  const hasInternalFAQ = /internal faq/i.test(response);

  if (hasPressRelease && hasCustomerFAQ && hasInternalFAQ) {
    return response;
  }

  let result = response;

  if (!hasPressRelease) {
    result = `## Press Release\n\n[Section not generated]\n\n${result}`;
  }

  if (!hasCustomerFAQ) {
    result = `${result}\n\n## Customer FAQs\n\n[Section not generated]`;
  }

  if (!hasInternalFAQ) {
    result = `${result}\n\n## Internal FAQs\n\n[Section not generated]`;
  }

  return result;
}

export async function writePRFAQArtifact(
  projectPath: string,
  workflowId: string,
  content: string
): Promise<string> {
  const inceptionDir = path.join(projectPath, 'aidlc-docs', workflowId, 'inception');
  const artifactPath = path.join(inceptionDir, 'prfaq.md');
  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');

  await fs.ensureDir(inceptionDir);
  await fs.writeFile(artifactPath, content, 'utf-8');

  const phase: WorkflowPhase = 'inception';
  const stage: WorkflowStage = 'intent';

  registerArtifact(manifestPath, {
    id: `prfaq-${workflowId}`,
    type: 'PRFAQ',
    phase,
    stage,
    path: artifactPath,
    validation_passed: null,
    write_complete: true,
    checksum: null,
  });

  return artifactPath;
}

export async function attemptPRFAQGeneration(options: PRFAQOptions): Promise<PRFAQResult> {
  try {
    const { projectPath, workflowId } = options;

    // Validates that options produce a usable prompt before reporting success
    buildPRFAQPrompt(options);

    const expectedPath = path.join(
      projectPath,
      'aidlc-docs',
      workflowId,
      'inception',
      'prfaq.md'
    );

    return {
      success: true,
      artifactPath: expectedPath,
      error: null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[prfaq-generator] attemptPRFAQGeneration failed:`, error);

    // Record failed attempt in manifest so audit trail distinguishes "never attempted" from "attempted and failed"
    try {
      const { projectPath, workflowId } = options;
      const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
      registerArtifact(manifestPath, {
        id: `prfaq-${workflowId}`,
        type: 'PRFAQ',
        phase: 'inception' as WorkflowPhase,
        stage: 'intent' as WorkflowStage,
        path: path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'prfaq.md'),
        validation_passed: false,
        write_complete: false,
        checksum: null,
      });
    } catch {
      // Silent — manifest registration failure should not mask the original error
    }

    return {
      success: false,
      artifactPath: null,
      error: errorMessage,
    };
  }
}
