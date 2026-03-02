import fs from 'fs-extra';
import path from 'path';
import { registerArtifact } from '../manifest.js';
import type { WorkflowPhase } from '../phase-types.js';

export interface NFRRequirementsResult {
  artifactPath: string;
  nfrContent: string;
}

/**
 * Execute the NFR Requirements stage for a single unit.
 * Reads inception-level NFRs, filters to unit-relevant subset, writes per-unit artifact.
 */
export async function executeNFRRequirementsStage(
  projectPath: string,
  workflowId: string,
  unitId: string
): Promise<NFRRequirementsResult> {
  const inceptionNfrPath = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'nfr.md');
  const unitSpecPath = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'spec.md');
  const outputPath = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'nfr-requirements.md');

  // Read inception NFRs (optional - may not exist for all workflows)
  let inceptionNfrs = '';
  try {
    if (await fs.pathExists(inceptionNfrPath)) {
      inceptionNfrs = await fs.readFile(inceptionNfrPath, 'utf-8');
    }
  } catch {
    // NFR file is optional
  }

  // Read unit spec for context
  let unitSpec = '';
  try {
    if (await fs.pathExists(unitSpecPath)) {
      unitSpec = await fs.readFile(unitSpecPath, 'utf-8');
    }
  } catch {
    // Best effort
  }

  // Extract unit title/scope from spec for filtering
  const titleMatch = unitSpec.match(/^title:\s*(.+)$/m);
  const unitTitle = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : unitId;

  // Filter NFRs relevant to this unit
  const filteredNfrs = filterNFRsForUnit(inceptionNfrs, unitSpec, unitTitle);

  // Generate per-unit NFR requirements artifact
  const now = new Date().toISOString();
  const content = `---
id: ${unitId}-nfr-requirements
parent_unit: ${unitId}
generated_at: ${now}
---

# NFR Requirements: ${unitTitle}

## Source
Filtered from inception-level NFRs for unit ${unitId}.

## Applicable Non-Functional Requirements

${filteredNfrs || '_No specific NFRs identified for this unit. Inherit project-level defaults._'}

## Unit Context
${unitTitle}
`;

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, content, 'utf-8');

  // Register in manifest
  try {
    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    registerArtifact(manifestPath, {
      id: `${unitId}-nfr-requirements`,
      type: 'NFR_REQUIREMENTS',
      phase: 'construction' as WorkflowPhase,
      stage: 'unit' as any,
      path: outputPath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
  } catch (err) {
    console.error(`[NFRRequirements] Failed to register artifact for ${unitId}:`, err);
  }

  return { artifactPath: outputPath, nfrContent: filteredNfrs };
}

/**
 * Filter inception-level NFRs to those relevant to a specific unit.
 * Uses keyword matching against unit spec content.
 */
export function filterNFRsForUnit(
  inceptionNfrs: string,
  unitSpec: string,
  unitTitle: string
): string {
  if (!inceptionNfrs.trim()) {
    return '';
  }

  // Split NFR content into sections (by ## headings)
  const sections = inceptionNfrs.split(/(?=^## )/m).filter(s => s.trim());

  if (sections.length === 0) {
    return inceptionNfrs; // Return all if can't parse sections
  }

  // Extract keywords from unit spec for relevance matching
  const unitKeywords = extractKeywords(unitSpec + ' ' + unitTitle);

  if (unitKeywords.length === 0) {
    return inceptionNfrs; // Return all if no keywords to filter by
  }

  // Score each section by relevance to the unit
  const scoredSections = sections.map(section => {
    const sectionLower = section.toLowerCase();
    const score = unitKeywords.filter(kw => sectionLower.includes(kw)).length;
    return { section, score };
  });

  // Include sections that have any keyword overlap, or all if none match
  const relevant = scoredSections.filter(s => s.score > 0);

  if (relevant.length === 0) {
    return inceptionNfrs; // Return all NFRs if no specific matches
  }

  return relevant.map(s => s.section).join('\n');
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
    'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from',
    'by', 'on', 'off', 'for', 'in', 'out', 'over', 'to', 'into',
    'with', 'not', 'no', 'nor', 'as', 'of', 'this', 'that', 'these',
    'those', 'it', 'its', 'all', 'each', 'any', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'than', 'too', 'very',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i) // dedupe
    .slice(0, 30); // limit keywords
}
