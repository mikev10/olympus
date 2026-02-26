/**
 * Risk Management
 *
 * Extracts risks from INTENT artifacts and provides CRUD operations for
 * risk-register.json. Risks use RISK-NNN sequential IDs and track
 * likelihood, impact, mitigation strategies, and ownership.
 */

import type { RiskEntry } from './phase-types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface RiskRegister {
  risks: RiskEntry[];
  created_at: string;
  updated_at: string;
}

export interface RiskSummary {
  total: number;
  by_status: Record<RiskEntry['status'], number>;
  by_likelihood: Record<RiskEntry['likelihood'], number>;
  by_impact: Record<RiskEntry['impact'], number>;
  high_priority: RiskEntry[];  // high likelihood AND high impact
}

/**
 * Removes YAML frontmatter from markdown content
 */
function removeFrontmatter(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() === '---') {
    const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (endIndex > 0) {
      return lines.slice(endIndex + 1).join('\n');
    }
  }
  return content;
}

/**
 * Parses markdown into sections keyed by heading
 */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const withoutFrontmatter = removeFrontmatter(content);
  const lines = withoutFrontmatter.split('\n');

  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n').trim());
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n').trim());
  }

  return sections;
}

/**
 * Extracts bullet items from content
 */
function extractBulletItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^[\s-]*-\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Parses Format 1 risk: "Description (likelihood likelihood, impact impact) - Mitigation: details"
 */
function parseFormat1Risk(text: string, index: number): RiskEntry | null {
  // Pattern: {description} ({likelihood} likelihood, {impact} impact) - Mitigation: {mitigation}
  const fullMatch = text.match(/^(.+?)\s*\((low|medium|high)\s+likelihood,\s+(low|medium|high)\s+impact\)\s*-\s*Mitigation:\s*(.+)$/i);

  if (fullMatch) {
    return {
      id: `RISK-${String(index + 1).padStart(3, '0')}`,
      description: fullMatch[1].trim(),
      likelihood: fullMatch[2].toLowerCase() as 'low' | 'medium' | 'high',
      impact: fullMatch[3].toLowerCase() as 'low' | 'medium' | 'high',
      mitigation: fullMatch[4].trim(),
      status: 'open',
      owner: 'Unassigned'
    };
  }

  // Partial match - try to extract what we can
  const partialMatch = text.match(/^(.+?)(?:\s*\((.+?)\))?\s*(?:-\s*Mitigation:\s*(.+))?$/);
  if (partialMatch) {
    return {
      id: `RISK-${String(index + 1).padStart(3, '0')}`,
      description: partialMatch[1].trim(),
      likelihood: 'medium',
      impact: 'medium',
      mitigation: partialMatch[3]?.trim() || 'Not yet defined',
      status: 'open',
      owner: 'Unassigned'
    };
  }

  return null;
}

/**
 * Parses Format 2 risk: structured with heading and fields
 */
function parseFormat2Risks(content: string): RiskEntry[] {
  const risks: RiskEntry[] = [];
  const sections = content.split(/^###\s+/m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split('\n');
    const headerMatch = lines[0]?.match(/^(RISK-\d+):\s*(.+)$/);

    if (!headerMatch) continue;

    const id = headerMatch[1];
    const description = headerMatch[2].trim();

    // Parse fields
    let likelihood: 'low' | 'medium' | 'high' = 'medium';
    let impact: 'low' | 'medium' | 'high' = 'medium';
    let mitigation = 'Not yet defined';
    let owner = 'Unassigned';
    let status: RiskEntry['status'] = 'open';

    for (const line of lines.slice(1)) {
      const fieldMatch = line.match(/^[\s-]*-?\s*(\w+):\s*(.+)$/i);
      if (fieldMatch) {
        const field = fieldMatch[1].toLowerCase();
        const value = fieldMatch[2].trim();

        if (field === 'likelihood' && (value === 'low' || value === 'medium' || value === 'high')) {
          likelihood = value;
        } else if (field === 'impact' && (value === 'low' || value === 'medium' || value === 'high')) {
          impact = value;
        } else if (field === 'mitigation') {
          mitigation = value;
        } else if (field === 'owner') {
          owner = value;
        } else if (field === 'status' && (value === 'open' || value === 'mitigated' || value === 'accepted' || value === 'closed')) {
          status = value;
        }
      }
    }

    risks.push({
      id,
      description,
      likelihood,
      impact,
      mitigation,
      status,
      owner
    });
  }

  return risks;
}

/**
 * Extracts risks from an INTENT artifact markdown file.
 * Supports two formats:
 * - Format 1: Bullet list with inline fields
 * - Format 2: Structured entries with headings
 *
 * @param intentContent - The markdown content of the INTENT artifact
 * @returns Array of extracted risks
 */
export function extractRisks(intentContent: string): RiskEntry[] {
  const sections = parseSections(intentContent);

  // Look for Risk Assessment or Risks section
  const riskSection = sections.get('Risk Assessment') || sections.get('Risks');

  if (!riskSection) {
    return [];
  }

  // Check if it's Format 2 (structured with ### headings)
  if (riskSection.includes('### RISK-')) {
    return parseFormat2Risks(riskSection);
  }

  // Format 1 - bullet list
  const items = extractBulletItems(riskSection);
  const risks: RiskEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const risk = parseFormat1Risk(items[i], i);
    if (risk) {
      risks.push(risk);
    }
  }

  return risks;
}

/**
 * Creates a new RiskRegister with the given risks and timestamps.
 *
 * @param risks - Array of risk entries
 * @returns New risk register
 */
export function createRiskRegister(risks: RiskEntry[]): RiskRegister {
  const now = new Date().toISOString();
  return {
    risks,
    created_at: now,
    updated_at: now
  };
}

/**
 * Loads a risk register from disk.
 *
 * @param registerPath - Path to the risk-register.json file
 * @returns Loaded risk register or null if file doesn't exist or is invalid
 */
export function loadRiskRegister(registerPath: string): RiskRegister | null {
  try {
    if (!existsSync(registerPath)) {
      return null;
    }

    const content = readFileSync(registerPath, 'utf-8');
    const data = JSON.parse(content);

    // Validate structure
    if (!data || typeof data !== 'object' || !Array.isArray(data.risks)) {
      return null;
    }

    return data as RiskRegister;
  } catch (error) {
    console.error(`Failed to load risk register from ${registerPath}:`, error);
    return null;
  }
}

/**
 * Saves a risk register to disk.
 *
 * @param registerPath - Path to the risk-register.json file
 * @param register - Risk register to save
 */
export function saveRiskRegister(registerPath: string, register: RiskRegister): void {
  try {
    const dir = dirname(registerPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const updatedRegister = {
      ...register,
      updated_at: new Date().toISOString()
    };

    writeFileSync(registerPath, JSON.stringify(updatedRegister, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to save risk register to ${registerPath}:`, error);
  }
}

/**
 * Returns the next available RISK-NNN ID.
 *
 * @param register - Current risk register
 * @returns Next sequential risk ID
 */
export function getNextRiskId(register: RiskRegister): string {
  let maxNum = 0;

  for (const risk of register.risks) {
    const match = risk.id.match(/^RISK-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }

  return `RISK-${String(maxNum + 1).padStart(3, '0')}`;
}

/**
 * Adds a new risk to the register with auto-assigned ID.
 *
 * @param register - Current risk register
 * @param risk - Risk entry without ID
 * @returns Updated risk register (immutable)
 */
export function addRisk(register: RiskRegister, risk: Omit<RiskEntry, 'id'>): RiskRegister {
  const id = getNextRiskId(register);
  const newRisk: RiskEntry = { ...risk, id };

  return {
    ...register,
    risks: [...register.risks, newRisk]
  };
}

/**
 * Updates an existing risk by ID.
 *
 * @param register - Current risk register
 * @param riskId - ID of risk to update
 * @param updates - Partial risk entry with fields to update
 * @returns Updated risk register (immutable)
 */
export function updateRisk(
  register: RiskRegister,
  riskId: string,
  updates: Partial<Omit<RiskEntry, 'id'>>
): RiskRegister {
  const riskIndex = register.risks.findIndex(r => r.id === riskId);

  if (riskIndex === -1) {
    return register;
  }

  const updatedRisks = [...register.risks];
  updatedRisks[riskIndex] = { ...updatedRisks[riskIndex], ...updates };

  return {
    ...register,
    risks: updatedRisks
  };
}

/**
 * Removes a risk by ID.
 *
 * @param register - Current risk register
 * @param riskId - ID of risk to remove
 * @returns Updated risk register (immutable)
 */
export function removeRisk(register: RiskRegister, riskId: string): RiskRegister {
  return {
    ...register,
    risks: register.risks.filter(r => r.id !== riskId)
  };
}

/**
 * Returns a numeric priority score for a risk.
 * Higher score = higher priority.
 * Score = likelihood_weight * impact_weight (1=low, 2=medium, 3=high)
 *
 * @param risk - Risk entry
 * @returns Priority score (1-9)
 */
export function getRiskPriorityScore(risk: RiskEntry): number {
  const weights = { low: 1, medium: 2, high: 3 };
  return weights[risk.likelihood] * weights[risk.impact];
}

/**
 * Computes summary statistics from the risk register.
 *
 * @param register - Risk register
 * @returns Summary statistics
 */
export function getRiskSummary(register: RiskRegister): RiskSummary {
  const by_status: Record<RiskEntry['status'], number> = {
    open: 0,
    mitigated: 0,
    accepted: 0,
    closed: 0
  };

  const by_likelihood: Record<RiskEntry['likelihood'], number> = {
    low: 0,
    medium: 0,
    high: 0
  };

  const by_impact: Record<RiskEntry['impact'], number> = {
    low: 0,
    medium: 0,
    high: 0
  };

  const high_priority: RiskEntry[] = [];

  for (const risk of register.risks) {
    by_status[risk.status]++;
    by_likelihood[risk.likelihood]++;
    by_impact[risk.impact]++;

    if (risk.likelihood === 'high' && risk.impact === 'high') {
      high_priority.push(risk);
    }
  }

  return {
    total: register.risks.length,
    by_status,
    by_likelihood,
    by_impact,
    high_priority
  };
}

/**
 * Formats a human-readable risk report.
 *
 * @param register - Risk register
 * @returns Formatted report string
 */
export function formatRiskReport(register: RiskRegister): string {
  const lines: string[] = [];
  lines.push(`Risk Register (${register.risks.length} risks)`);
  lines.push('='.repeat(23 + String(register.risks.length).length));
  lines.push('');

  // Group by status
  const byStatus: Record<RiskEntry['status'], RiskEntry[]> = {
    open: [],
    mitigated: [],
    accepted: [],
    closed: []
  };

  for (const risk of register.risks) {
    byStatus[risk.status].push(risk);
  }

  // Sort each group by priority
  for (const status in byStatus) {
    byStatus[status as RiskEntry['status']].sort((a, b) =>
      getRiskPriorityScore(b) - getRiskPriorityScore(a)
    );
  }

  const statusLabels: Record<RiskEntry['status'], string> = {
    open: 'Open',
    mitigated: 'Mitigated',
    accepted: 'Accepted',
    closed: 'Closed'
  };

  for (const status of ['open', 'mitigated', 'accepted', 'closed'] as const) {
    const risks = byStatus[status];
    if (risks.length === 0) continue;

    lines.push(`${statusLabels[status]} (${risks.length}):`);

    for (const risk of risks) {
      const likelihood = risk.likelihood.toUpperCase();
      const impact = risk.impact.toUpperCase();
      lines.push(`  ${risk.id} [${likelihood}/${impact}] ${risk.description}`);
      lines.push(`    Mitigation: ${risk.mitigation}`);
      lines.push(`    Owner: ${risk.owner}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
