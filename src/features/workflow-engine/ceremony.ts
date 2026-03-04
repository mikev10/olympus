/**
 * Mob Elaboration Ceremony System
 *
 * Provides ceremony mode formatting and configuration for team-based
 * AIDLC workflows. When ceremony_mode is enabled, output includes
 * explicit review markers and section separators for screen-share readability.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { CeremonyConfig } from './phase-types.js';

export function getDefaultCeremonyConfig(): CeremonyConfig {
  return {
    ceremony_mode: false,
    pause_between_steps: false,
    output_format: 'standard',
    review_prompt_style: 'inline',
  };
}

export function loadCeremonyConfig(projectPath: string): CeremonyConfig {
  const defaults = getDefaultCeremonyConfig();
  try {
    const configPath = join(projectPath, '.olympus', 'config.json');
    if (!existsSync(configPath)) {
      return defaults;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.ceremony) {
      return defaults;
    }
    return { ...defaults, ...parsed.ceremony };
  } catch (err) {
    console.error('[ceremony] Failed to load ceremony config:', err);
    return defaults;
  }
}

export function formatForCeremony(content: string, config: CeremonyConfig): string {
  if (!config.ceremony_mode) {
    return content;
  }

  let output = content;

  if (config.output_format === 'presentation') {
    output = `\n========================================\n` + output;
  }

  if (config.review_prompt_style === 'explicit') {
    output += `\n\n**ACTION REQUIRED**: All team members must acknowledge this section before proceeding.\n`;
  } else {
    output += `\n\n---\n\n--- TEAM REVIEW POINT ---\n\nTEAM: Please review the above and provide feedback before we proceed.\n\n---\n`;
  }

  return output;
}

export function getCeremonyArtifactTemplates(): Record<string, string> {
  return {
    prfaq: `# Press Release / FAQ (PRFAQ)

## Press Release

**Headline:** [One-line product/feature headline]

**Subhead:** [Supporting sentence expanding on the headline]

**Problem:** [Describe the customer problem being solved]

**Solution:** [How this product/feature solves the problem]

**Leader Quote:**
> "[Executive quote endorsing the initiative]"
> — [Name, Title]

**How It Works:** [Brief description of the mechanism or workflow]

**Customer Quote:**
> "[Fictional but realistic customer quote reflecting value received]"
> — [Fictional Customer Name, Role, Company]

**Call to Action:** [What the customer does next — sign up, learn more, etc.]

---

## Customer FAQs

1. **Q:** [Anticipated customer question 1]
   **A:** [Answer]

2. **Q:** [Anticipated customer question 2]
   **A:** [Answer]

3. **Q:** [Anticipated customer question 3]
   **A:** [Answer]

4. **Q:** [Anticipated customer question 4]
   **A:** [Answer]

5. **Q:** [Anticipated customer question 5]
   **A:** [Answer]

---

## Internal FAQs

1. **Q:** [Internal/stakeholder question 1]
   **A:** [Answer]

2. **Q:** [Internal/stakeholder question 2]
   **A:** [Answer]

3. **Q:** [Internal/stakeholder question 3]
   **A:** [Answer]
`,

    nfr: `# Non-Functional Requirements (NFR)

| ID | Category | Requirement | Priority | Gate-Blocking | Verification Method |
|----|----------|-------------|----------|---------------|---------------------|
| NFR-001 | Performance | [Requirement description] | High/Med/Low | Yes/No | [How to verify] |
| NFR-002 | Security | [Requirement description] | High/Med/Low | Yes/No | [How to verify] |
| NFR-003 | Reliability | [Requirement description] | High/Med/Low | Yes/No | [How to verify] |
| NFR-004 | Scalability | [Requirement description] | High/Med/Low | Yes/No | [How to verify] |
| NFR-005 | Observability | [Requirement description] | High/Med/Low | Yes/No | [How to verify] |

**Categories:** Performance, Security, Reliability, Scalability, Maintainability, Compliance, Observability, Usability
`,

    risk: `# Risk Register Entry

**ID:** RISK-[NNN]
**Description:** [Clear description of the risk]
**Likelihood:** Low / Medium / High
**Impact:** Low / Medium / High
**Mitigation:** [Specific actions to reduce likelihood or impact]
**Status:** Open / Mitigated / Accepted / Closed
**Owner:** [Name or team responsible]
`,

    unit: `# Unit Suggestion

**Unit ID:** {unit-name}
**Title:** [Short descriptive title]
**Scope:** [What this unit covers — bounded context, capability, or domain slice]

**Acceptance Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

**Code Generation Plan:**

| Step | Title | Estimated Effort |
|------|-------|-----------------|
| 1 | [Implementation step title] | [S / M / L] |
| 2 | [Implementation step title] | [S / M / L] |
| 3 | [Implementation step title] | [S / M / L] |
`,
  };
}
