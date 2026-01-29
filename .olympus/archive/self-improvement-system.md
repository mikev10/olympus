# Olympus Self-Improvement System

## Plan Overview

**Goal**: Create a feedback loop system that enables Olympus to learn from user interactions AND agent discoveries, continuously improving orchestration, agent selection, and response quality.

**Status**: APPROVED - Ready for Implementation
**Created**: 2025-01-23
**Revised**: 2025-01-25 (Added Phase 6: Agent Learning Capture; Fixed all Momus review issues)
**Complexity**: High
**Estimated Phases**: 6
**Confidence Scores**: Clarity 98%, Testability 98%, Completeness 98%, Big Picture 98%
**Dependencies**: None - uses only Node.js built-ins (`fs`, `path`, `os`, `crypto`)

### Momus Review Fixes Applied (2025-01-25)
1. ✅ Removed inaccurate line number references - replaced with descriptive pattern names
2. ✅ Fixed `jaccardSimilarity` import strategy - exported from `pattern-extractor.ts`, imported in `preference-learner.ts`
3. ✅ Fixed Vitest mock patterns - using `vi.hoisted()` with mutable variables at module level
4. ✅ Added Task 1.0 scaffolding step for `src/learning/` directory structure
5. ✅ Clarified CLI command insertion point (before `program.parse()` at line 573)
6. ✅ Completed `markDiscoveryUseful` implementation (full JSONL read/update/write logic)
7. ✅ Replaced `uuid` dependency with Node.js built-in `crypto.randomUUID()` - no external deps needed
8. ✅ Verified `src/agents/definitions.ts` exists (confirmed)
9. ✅ Fixed `v4()` call in feedback command to use `randomUUID()`
10. ✅ Fixed property name `last_verified` → `last_useful` to match type definition
11. ✅ Fixed Task 6.4 file reference: `context-injector.ts` → `hooks/learned-context.ts`
12. ✅ Added missing test files to file structure summary (5 files)

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEEDBACK CAPTURE LAYER                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Revision   │  │   Cancel    │  │   Success   │              │
│  │  Detector   │  │  Detector   │  │  Detector   │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  SESSION STATE FILE (.olympus/session-state.json)       │    │
│  │  - Tracks recent prompts/responses                       │    │
│  │  - Maintains rolling context window                      │    │
│  │  - Updated by each hook in chain                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LEARNING STORAGE LAYER                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ~/.claude/olympus/learning/                             │    │
│  │  ├── feedback-log.jsonl      (all feedback events)      │    │
│  │  ├── user-preferences.json   (learned preferences)      │    │
│  │  ├── agent-performance.json  (success/failure rates)    │    │
│  │  ├── prompt-patches.json     (suggested improvements)   │    │
│  │  └── discoveries.jsonl       (agent discoveries) ← NEW  │    │
│  │                                                          │    │
│  │  .olympus/learning/          (project-specific)         │    │
│  │  ├── patterns.json           (codebase patterns)        │    │
│  │  └── discoveries.jsonl       (project discoveries) ← NEW│    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ANALYSIS & LEARNING LAYER                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐   │
│  │ Pattern Extractor│  │Preference Learner│  │Agent Evaluator │   │
│  │ (finds recurring │  │(derives user     │  │(tracks agent   │   │
│  │  corrections)    │  │ preferences)     │  │ performance)   │   │
│  └─────────┬───────┘  └────────┬────────┘  └───────┬────────┘   │
└────────────┼───────────────────┼───────────────────┼────────────┘
             │                   │                   │
             ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTEXT INJECTION LAYER                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  session-start hook injects:                             │    │
│  │  - User preferences                                      │    │
│  │  - Recent corrections                                    │    │
│  │  - Project-specific patterns                             │    │
│  │  - Agent performance notes                               │    │
│  │  - Agent discoveries (technical insights, gotchas) ← NEW │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Design Decisions

### Hook Input Limitations

Claude Code hooks receive LIMITED input via stdin. Based on the existing hook implementations in `src/installer/hooks.ts` (see `extractPrompt()` and `readStdin()` utility functions), hooks receive:

```typescript
// What hooks ACTUALLY receive (from stdin JSON)
interface HookInput {
  prompt?: string;           // Current user prompt (UserPromptSubmit)
  directory?: string;        // Current working directory
  sessionId?: string;        // Session identifier
  // NO conversation history
  // NO previous messages
  // NO response content
}
```

**Solution**: Use a **Session State File** that hooks read/write to maintain context across invocations.

### CLI Command Structure

Based on `src/cli/index.ts` (lines 49-573), all CLI commands are defined inline using `program.command()`. There is NO `src/cli/commands/` directory.

**Solution**: Add new commands directly to `src/cli/index.ts`.

---

## Phase 1: Feedback Capture Infrastructure

**Objective**: Build the hooks and storage system to capture user feedback signals.

### Task 1.0: Scaffolding - Create Directory Structure

**IMPORTANT**: Before implementing any code, create the directory structure first.

**Directories to Create**:
```
src/learning/
├── index.ts                 # Barrel export (create empty, populate as modules are added)
├── types.ts                 # Type definitions (Task 1.1)
├── storage.ts               # Storage utilities (Task 1.1)
├── session-state.ts         # Session state manager (Task 1.2)
├── pattern-extractor.ts     # Pattern analysis (Task 2.1)
├── preference-learner.ts    # Preference inference (Task 2.2)
├── agent-evaluator.ts       # Agent performance tracking (Task 2.3)
├── prompt-patcher.ts        # Prompt improvements (Task 3.2)
├── discovery.ts             # Discovery recording (Task 6.1)
├── discovery-validator.ts   # Discovery validation (Task 6.3)
├── migrate-notepads.ts      # Migration utility (Task 6.5)
└── hooks/
    ├── revision-detector.ts      # UserPromptSubmit hook (Task 1.3)
    ├── cancellation-detector.ts  # Stop hook (Task 1.4)
    ├── success-detector.ts       # Success detection (Task 1.5)
    └── learned-context.ts        # SessionStart injection (Task 3.1)

src/__tests__/learning/
├── storage.test.ts
├── session-state.test.ts
├── revision-detector.test.ts
├── pattern-extractor.test.ts
├── preference-learner.test.ts
├── agent-evaluator.test.ts
├── learned-context.test.ts
├── discovery.test.ts
├── discovery-validator.test.ts
└── fixtures/
    └── mock-feedback.ts
```

**Commands to Run**:
```bash
# Create directories
mkdir -p src/learning/hooks
mkdir -p src/__tests__/learning/fixtures

# Create empty index.ts for barrel exports
touch src/learning/index.ts
```

**Initial `src/learning/index.ts`**:
```typescript
// Olympus Learning System
// Barrel export - add exports as modules are created

// Storage & Types (Task 1.1)
export * from './types.js';
export * from './storage.js';

// Session State (Task 1.2)
export * from './session-state.js';

// Analysis (Phase 2)
export * from './pattern-extractor.js';
export * from './preference-learner.js';
export * from './agent-evaluator.js';

// Prompt Patching (Phase 3)
export * from './prompt-patcher.js';

// Discovery System (Phase 6)
export * from './discovery.js';
export * from './discovery-validator.js';
```

---

### Task 1.1: Create Learning Storage Module

**File**: `src/learning/storage.ts`

**Reference**: Uses path utilities pattern from `src/installer/hooks.ts` (lines 42-48)

```typescript
import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

// ============================================================================
// TYPE DEFINITIONS (add to src/learning/types.ts)
// ============================================================================

/**
 * Input received by hooks via stdin
 * Based on actual Claude Code hook architecture (src/installer/hooks.ts:478-505)
 */
export interface HookInput {
  prompt?: string;           // Current user prompt
  directory?: string;        // Working directory
  sessionId?: string;        // Session ID (may not always be present)
}

/**
 * Session state maintained across hook invocations
 * Stored in .olympus/session-state.json
 */
export interface SessionState {
  session_id: string;
  started_at: string;
  last_updated: string;

  // Rolling window of recent interactions (max 10)
  recent_prompts: Array<{
    prompt: string;
    timestamp: string;
    detected_feedback?: FeedbackCategory;
  }>;

  // Track completion claims for revision detection
  pending_completion: {
    claimed_at?: string;
    task_description?: string;
    agent_used?: string;
  } | null;

  // Track todo state for cancellation detection
  todo_snapshot: {
    total: number;
    completed: number;
    pending: number;
  } | null;
}

export type FeedbackCategory =
  | 'correction'      // "No, that's wrong"
  | 'rejection'       // "Stop", "Cancel"
  | 'clarification'   // "I meant X"
  | 'enhancement'     // "Also add X"
  | 'praise'          // "Perfect", "Thanks"
  | 'explicit_preference';  // "Always do X"

export interface FeedbackEntry {
  id: string;                 // UUID
  timestamp: string;          // ISO 8601
  session_id: string;
  project_path: string;
  event_type: 'revision' | 'cancellation' | 'success' | 'explicit_preference';

  // Context (from session state)
  original_task?: string;
  agent_used?: string;
  completion_claim?: string;

  // Feedback
  user_message: string;
  feedback_category: FeedbackCategory;

  // Extracted learning (populated by analysis)
  extracted_lesson?: string;
  confidence: number;  // 0-1
}

export interface UserPreferences {
  verbosity: 'concise' | 'detailed' | 'unknown';
  autonomy: 'ask_first' | 'just_do_it' | 'balanced' | 'unknown';
  explanation_depth: 'minimal' | 'moderate' | 'thorough' | 'unknown';

  explicit_rules: string[];           // "always use TypeScript"
  inferred_preferences: string[];     // Learned from patterns
  recurring_corrections: Array<{
    pattern: string;
    count: number;
    last_seen: string;
    examples: string[];
  }>;

  last_updated: string;
}

export interface AgentPerformance {
  agent_name: string;
  total_invocations: number;
  success_count: number;
  revision_count: number;
  cancellation_count: number;
  success_rate: number;  // Calculated: success_count / total_invocations

  failure_patterns: Array<{
    pattern: string;
    count: number;
    examples: string[];
  }>;

  strong_areas: string[];
  weak_areas: string[];

  last_updated: string;
}

export interface ProjectPatterns {
  project_hash: string;       // SHA-256 of absolute project path
  project_path: string;

  conventions: string[];      // "uses kebab-case for files"
  tech_stack: string[];       // "React", "TypeScript", "Prisma"
  learned_rules: string[];    // "always run migrations after schema change"
  common_mistakes: string[];  // Things Claude got wrong on this project

  last_updated: string;
}

// ============================================================================
// AGENT DISCOVERY TYPES (NEW - Phase 6)
// ============================================================================

/**
 * Category of agent-discovered learning
 */
export type DiscoveryCategory =
  | 'technical_insight'   // "This API requires X header format"
  | 'workaround'          // "Build fails silently, must check exit code"
  | 'pattern'             // "This codebase uses kebab-case for files"
  | 'gotcha'              // "Migration must run before seeding"
  | 'performance'         // "Query N+1 issue in X, use eager loading"
  | 'dependency'          // "Package X requires peer dependency Y"
  | 'configuration';      // "Environment variable X must be set"

/**
 * An agent-discovered learning entry
 */
export interface AgentDiscovery {
  id: string;                 // UUID
  timestamp: string;          // ISO 8601
  session_id: string;
  project_path: string;

  // What was discovered
  category: DiscoveryCategory;
  summary: string;            // One-line summary (max 100 chars)
  details: string;            // Full explanation

  // Context
  agent_name: string;         // Which agent made the discovery
  task_context?: string;      // What task was being worked on
  files_involved?: string[];  // Related files

  // Validation
  confidence: number;         // 0-1, how confident the agent is
  verified: boolean;          // Has this been validated?
  verification_count: number; // How many times this has been useful

  // Lifecycle
  scope: 'global' | 'project'; // Where to store/apply
  expires_at?: string;        // Optional expiration for time-sensitive learnings
  last_useful: string;        // Last time this was injected
}

/**
 * Aggregated discoveries for context injection
 */
export interface DiscoverySummary {
  project_discoveries: AgentDiscovery[];  // Project-specific
  global_discoveries: AgentDiscovery[];   // Cross-project

  // Statistics
  total_discoveries: number;
  categories: Record<DiscoveryCategory, number>;
  most_useful: AgentDiscovery[];  // Top 5 by verification_count
}

// ============================================================================
// STORAGE UTILITIES (src/learning/storage.ts)
// ============================================================================

/** Get learning storage directory (cross-platform) */
export function getLearningDir(): string {
  // Uses pattern from src/installer/hooks.ts:42-44
  return join(homedir(), '.claude', 'olympus', 'learning');
}

/** Get project-specific learning directory */
export function getProjectLearningDir(projectPath: string): string {
  return join(projectPath, '.olympus', 'learning');
}

/** Generate deterministic hash for project path */
export function getProjectHash(projectPath: string): string {
  const absolutePath = resolve(projectPath);
  return createHash('sha256').update(absolutePath).digest('hex').substring(0, 16);
}

/** Ensure learning directories exist */
export function ensureLearningDirs(projectPath?: string): void {
  const globalDir = getLearningDir();
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  if (projectPath) {
    const projectDir = getProjectLearningDir(projectPath);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
  }
}

/** Append feedback entry to JSONL log */
export function appendFeedback(entry: FeedbackEntry): void {
  ensureLearningDirs();
  const logPath = join(getLearningDir(), 'feedback-log.jsonl');
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read feedback log */
export function readFeedbackLog(): FeedbackEntry[] {
  const logPath = join(getLearningDir(), 'feedback-log.jsonl');
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as FeedbackEntry);
}

/** Read/write JSON files with type safety */
export function readJsonFile<T>(path: string, defaultValue: T): T {
  if (!existsSync(path)) return defaultValue;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return defaultValue;
  }
}

export function writeJsonFile<T>(filePath: string, data: T): void {
  // Use dirname() for cross-platform path handling (Windows uses \, Unix uses /)
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
```

**Deliverables**:
- [ ] Type definitions in `src/learning/types.ts`
- [ ] Storage utilities in `src/learning/storage.ts`
- [ ] JSONL append function for feedback log
- [ ] JSON read/write functions for preferences and performance
- [ ] Project hash generation for project-specific storage
- [ ] Path utilities using existing patterns from `src/installer/hooks.ts`

**Verification**: `npx vitest run src/__tests__/learning/storage.test.ts`

---

### Task 1.2: Session State Manager

**File**: `src/learning/session-state.ts`

**Purpose**: Maintain conversation context that hooks can read/write, solving the "no conversation history" limitation.

```typescript
import { join } from 'path';
import { existsSync } from 'fs';
import { SessionState, FeedbackCategory } from './types.js';
import { readJsonFile, writeJsonFile } from './storage.js';
import { randomUUID } from 'crypto';

const MAX_RECENT_PROMPTS = 10;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes

/** Get session state file path */
export function getSessionStatePath(directory: string): string {
  return join(directory, '.olympus', 'session-state.json');
}

/** Create fresh session state */
export function createSessionState(sessionId?: string): SessionState {
  return {
    session_id: sessionId || randomUUID(),
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    recent_prompts: [],
    pending_completion: null,
    todo_snapshot: null,
  };
}

/** Load or create session state */
export function loadSessionState(directory: string, sessionId?: string): SessionState {
  const path = getSessionStatePath(directory);
  const state = readJsonFile<SessionState | null>(path, null);

  if (!state) {
    return createSessionState(sessionId);
  }

  // Check for session timeout
  const lastUpdate = new Date(state.last_updated).getTime();
  const now = Date.now();
  if (now - lastUpdate > SESSION_TIMEOUT_MS) {
    return createSessionState(sessionId);
  }

  return state;
}

/** Save session state */
export function saveSessionState(directory: string, state: SessionState): void {
  const path = getSessionStatePath(directory);
  state.last_updated = new Date().toISOString();
  writeJsonFile(path, state);
}

/** Add prompt to session state */
export function addPromptToSession(
  state: SessionState,
  prompt: string,
  detectedFeedback?: FeedbackCategory
): SessionState {
  const entry = {
    prompt,
    timestamp: new Date().toISOString(),
    detected_feedback: detectedFeedback,
  };

  state.recent_prompts = [entry, ...state.recent_prompts].slice(0, MAX_RECENT_PROMPTS);
  state.last_updated = new Date().toISOString();

  return state;
}

/** Mark a completion claim */
export function markCompletionClaim(
  state: SessionState,
  taskDescription: string,
  agentUsed?: string
): SessionState {
  state.pending_completion = {
    claimed_at: new Date().toISOString(),
    task_description: taskDescription,
    agent_used: agentUsed,
  };
  state.last_updated = new Date().toISOString();
  return state;
}

/** Clear completion claim (on success or explicit reset) */
export function clearCompletionClaim(state: SessionState): SessionState {
  state.pending_completion = null;
  state.last_updated = new Date().toISOString();
  return state;
}

/** Check if there's a pending completion claim */
export function hasPendingCompletion(state: SessionState): boolean {
  if (!state.pending_completion?.claimed_at) return false;

  // Consider completion stale after 5 minutes
  const claimedAt = new Date(state.pending_completion.claimed_at).getTime();
  const now = Date.now();
  return now - claimedAt < 5 * 60 * 1000;
}
```

**Deliverables**:
- [ ] Session state manager with read/write functions
- [ ] Rolling prompt window (max 10 entries)
- [ ] Completion claim tracking
- [ ] Session timeout logic (30 min)

**Verification**: `npx vitest run src/__tests__/learning/session-state.test.ts`

---

### Task 1.3: Revision Detector Hook

**File**: `src/learning/hooks/revision-detector.ts`

**Hook Event**: `UserPromptSubmit`

**Reference**: Pattern from `src/installer/hooks.ts` (lines 392-590)

```typescript
import { HookInput, FeedbackCategory, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState, addPromptToSession, hasPendingCompletion } from '../session-state.js';
import { appendFeedback, getProjectHash } from '../storage.js';
import { randomUUID } from 'crypto';

// Pattern definitions with associated confidence scores
const REVISION_PATTERNS: Record<FeedbackCategory, Array<{ regex: RegExp; confidence: number }>> = {
  correction: [
    { regex: /no[,.]?\s*(that's|thats)?\s*(not|wrong)/i, confidence: 0.9 },
    { regex: /that's\s*(incorrect|not right|not what)/i, confidence: 0.9 },
    { regex: /you\s*(misunderstood|got it wrong)/i, confidence: 0.85 },
    { regex: /actually,?\s*(I|it|the)/i, confidence: 0.6 },
  ],
  rejection: [
    { regex: /\b(stop|cancel|abort|halt)\b/i, confidence: 0.95 },
    { regex: /don't\s*(do|want|need)\s*(that|this)/i, confidence: 0.85 },
    { regex: /never\s*mind/i, confidence: 0.9 },
    { regex: /forget\s*(it|that|about)/i, confidence: 0.8 },
  ],
  clarification: [
    { regex: /I\s*(meant|wanted|asked for)/i, confidence: 0.85 },
    { regex: /what I\s*(mean|want|need)/i, confidence: 0.8 },
    { regex: /to clarify/i, confidence: 0.9 },
    { regex: /let me\s*(rephrase|explain|be clearer)/i, confidence: 0.85 },
  ],
  explicit_preference: [
    { regex: /always\s+(use|do|include|add|prefer)/i, confidence: 0.95 },
    { regex: /never\s+(use|do|include|add)/i, confidence: 0.95 },
    { regex: /I\s*(prefer|like|want)\s*(you to)?/i, confidence: 0.7 },
    { regex: /from now on/i, confidence: 0.9 },
    { regex: /in the future,?\s*(please|always)/i, confidence: 0.85 },
  ],
  praise: [
    { regex: /\bperfect\b/i, confidence: 0.9 },
    { regex: /exactly(\s+what I (wanted|needed))?/i, confidence: 0.85 },
    { regex: /great(\s+job)?/i, confidence: 0.7 },
    { regex: /\bthanks?\b/i, confidence: 0.5 },  // Lower confidence - could be polite rejection
    { regex: /looks?\s+good/i, confidence: 0.75 },
  ],
  enhancement: [
    { regex: /also\s+(add|include|do)/i, confidence: 0.7 },
    { regex: /can you (also|additionally)/i, confidence: 0.7 },
    { regex: /one more thing/i, confidence: 0.75 },
  ],
};

/** Detect feedback category from user message */
export function detectFeedbackCategory(
  prompt: string
): { category: FeedbackCategory; confidence: number } | null {
  // Remove code blocks to prevent false positives
  const cleanPrompt = prompt
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '');

  let bestMatch: { category: FeedbackCategory; confidence: number } | null = null;

  for (const [category, patterns] of Object.entries(REVISION_PATTERNS)) {
    for (const { regex, confidence } of patterns) {
      if (regex.test(cleanPrompt)) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { category: category as FeedbackCategory, confidence };
        }
      }
    }
  }

  return bestMatch;
}

/** Main hook handler */
export async function handleRevisionDetection(input: HookInput): Promise<void> {
  const { prompt, directory, sessionId } = input;

  if (!prompt || !directory) return;

  // Load session state
  const state = loadSessionState(directory, sessionId);

  // Detect feedback category
  const detected = detectFeedbackCategory(prompt);

  // Update session state with this prompt
  const updatedState = addPromptToSession(state, prompt, detected?.category);

  // If feedback detected and there was a pending completion, log it
  if (detected && hasPendingCompletion(state)) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: detected.category === 'explicit_preference' ? 'explicit_preference' : 'revision',
      original_task: state.pending_completion?.task_description,
      agent_used: state.pending_completion?.agent_used,
      user_message: prompt,
      feedback_category: detected.category,
      confidence: detected.confidence,
    };

    appendFeedback(feedbackEntry);
  }

  // Save updated state
  saveSessionState(directory, updatedState);
}
```

**Hook Script Template** (for `src/installer/hooks.ts`):

```typescript
export const REVISION_DETECTOR_SCRIPT_NODE = `#!/usr/bin/env node
// Olympus Revision Detector Hook (Node.js)
// Detects user corrections/feedback and logs them for learning

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// [Include pattern definitions and detection logic inline]
// [See full implementation above]

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    // Run detection (fire-and-forget, don't block)
    await handleRevisionDetection(data);

    // Always continue - this hook is passive
    console.log(JSON.stringify({ continue: true }));
  } catch {
    console.log(JSON.stringify({ continue: true }));
  }
}

main();
`;
```

**Deliverables**:
- [ ] Pattern matching for all feedback categories with confidence scores
- [ ] Integration with session state for context
- [ ] Passive logging (never blocks conversation)
- [ ] Node.js hook script for `src/installer/hooks.ts`

**Verification**: `npx vitest run src/__tests__/learning/revision-detector.test.ts`

---

### Task 1.4: Cancellation Detector Hook

**File**: `src/learning/hooks/cancellation-detector.ts`

**Hook Event**: `Stop`

**Reference**: Pattern from `src/installer/hooks.ts` (lines 597-677)

```typescript
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { HookInput, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState } from '../session-state.js';
import { appendFeedback } from '../storage.js';
import { randomUUID } from 'crypto';

interface StopHookInput extends HookInput {
  // Stop hooks may include additional context
  reason?: string;
}

/** Count incomplete todos from Claude's todo directory */
function countIncompleteTodos(): number {
  const todosDir = join(homedir(), '.claude', 'todos');
  if (!existsSync(todosDir)) return 0;

  let count = 0;
  try {
    const files = readdirSync(todosDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(todosDir, file), 'utf-8');
        const todos = JSON.parse(content);
        if (Array.isArray(todos)) {
          count += todos.filter(t =>
            t.status !== 'completed' && t.status !== 'cancelled'
          ).length;
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Directory read error
  }
  return count;
}

/** Detect if this is a user-initiated cancellation */
export async function handleCancellationDetection(input: StopHookInput): Promise<void> {
  const { directory, sessionId } = input;

  if (!directory) return;

  // Load session state
  const state = loadSessionState(directory, sessionId);

  // Check for incomplete todos
  const incompleteTodos = countIncompleteTodos();

  // If there are incomplete todos and there was a pending completion,
  // this might be a user cancellation
  if (incompleteTodos > 0 && state.pending_completion) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: 'cancellation',
      original_task: state.pending_completion.task_description,
      agent_used: state.pending_completion.agent_used,
      user_message: `[Stopped with ${incompleteTodos} incomplete todos]`,
      feedback_category: 'rejection',
      confidence: 0.7,  // Medium confidence - could be legitimate stop
    };

    appendFeedback(feedbackEntry);
  }

  // Clear session state on stop
  state.pending_completion = null;
  state.todo_snapshot = { total: 0, completed: 0, pending: incompleteTodos };
  saveSessionState(directory, state);
}
```

**Deliverables**:
- [ ] Incomplete task detection using existing todo structure
- [ ] Integration with session state
- [ ] Medium-confidence logging (user stop != always failure)

**Verification**: `npx vitest run src/__tests__/learning/cancellation-detector.test.ts`

---

### Task 1.5: Success Detector Hook

**File**: `src/learning/hooks/success-detector.ts`

**Hook Event**: `UserPromptSubmit`

**Logic**: Detect success by looking for praise patterns followed by topic change or new task.

```typescript
import { HookInput, FeedbackEntry } from '../types.js';
import { loadSessionState, saveSessionState, hasPendingCompletion, clearCompletionClaim } from '../session-state.js';
import { appendFeedback } from '../storage.js';
import { detectFeedbackCategory } from './revision-detector.js';
import { randomUUID } from 'crypto';

/** Detect if this prompt indicates task success */
export async function handleSuccessDetection(input: HookInput): Promise<void> {
  const { prompt, directory, sessionId } = input;

  if (!prompt || !directory) return;

  const state = loadSessionState(directory, sessionId);

  // Only check for success if there's a pending completion
  if (!hasPendingCompletion(state)) return;

  const detected = detectFeedbackCategory(prompt);

  // Success indicators:
  // 1. Explicit praise
  // 2. New, unrelated task (topic change)
  // 3. Simple acknowledgment + moving on

  const isPraise = detected?.category === 'praise' && detected.confidence > 0.7;
  const isNewTask = isTopicChange(prompt, state.pending_completion?.task_description || '');

  if (isPraise || isNewTask) {
    const feedbackEntry: FeedbackEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: state.session_id,
      project_path: directory,
      event_type: 'success',
      original_task: state.pending_completion?.task_description,
      agent_used: state.pending_completion?.agent_used,
      user_message: prompt,
      feedback_category: isPraise ? 'praise' : 'enhancement',
      confidence: isPraise ? detected!.confidence : 0.6,
    };

    appendFeedback(feedbackEntry);

    // Clear the completion claim
    const updatedState = clearCompletionClaim(state);
    saveSessionState(directory, updatedState);
  }
}

/** Simple topic change detection using keyword overlap */
function isTopicChange(newPrompt: string, previousTask: string): boolean {
  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)  // Skip short words
    );
  };

  const newKeywords = extractKeywords(newPrompt);
  const oldKeywords = extractKeywords(previousTask);

  // Calculate Jaccard similarity
  const intersection = new Set([...newKeywords].filter(x => oldKeywords.has(x)));
  const union = new Set([...newKeywords, ...oldKeywords]);

  const similarity = union.size > 0 ? intersection.size / union.size : 0;

  // If similarity is low, it's likely a new topic
  return similarity < 0.2;
}
```

**Deliverables**:
- [ ] Praise detection with confidence threshold
- [ ] Topic change detection using Jaccard similarity
- [ ] Integration with session state

**Verification**: `npx vitest run src/__tests__/learning/success-detector.test.ts`

---

## Phase 2: Learning Analysis Engine

**Objective**: Process captured feedback into actionable learnings.

### Task 2.1: Pattern Extractor

**File**: `src/learning/pattern-extractor.ts`

**Algorithm**: N-gram based text similarity with Jaccard coefficient (no external dependencies).

```typescript
import { FeedbackEntry } from './types.js';

export interface ExtractedPattern {
  pattern: string;             // "User wants TypeScript strict mode"
  confidence: number;          // 0.85
  evidence_count: number;      // 4
  evidence_examples: string[]; // ["add types", "use strict", ...]
  scope: 'global' | 'project';
  category: 'style' | 'behavior' | 'tooling' | 'communication';
}

/** Extract n-grams from text for similarity comparison */
function extractNgrams(text: string, n: number = 3): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = normalized.split(/\s+/).filter(w => w.length > 0);

  if (words.length < n) {
    return new Set([normalized]);
  }

  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

/** Calculate Jaccard similarity between two texts (exported for reuse) */
export function jaccardSimilarity(text1: string, text2: string): number {
  const ngrams1 = extractNgrams(text1);
  const ngrams2 = extractNgrams(text2);

  const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
  const union = new Set([...ngrams1, ...ngrams2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/** Group similar feedback entries */
function clusterFeedback(
  entries: FeedbackEntry[],
  similarityThreshold: number = 0.3
): FeedbackEntry[][] {
  const clusters: FeedbackEntry[][] = [];
  const assigned = new Set<string>();

  for (const entry of entries) {
    if (assigned.has(entry.id)) continue;

    const cluster = [entry];
    assigned.add(entry.id);

    for (const other of entries) {
      if (assigned.has(other.id)) continue;

      const similarity = jaccardSimilarity(entry.user_message, other.user_message);
      if (similarity >= similarityThreshold) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/** Extract patterns from feedback log */
export function extractPatterns(
  feedbackLog: FeedbackEntry[],
  minOccurrences: number = 3
): ExtractedPattern[] {
  // Only analyze corrections and clarifications
  const relevantFeedback = feedbackLog.filter(
    e => e.feedback_category === 'correction' ||
         e.feedback_category === 'clarification' ||
         e.feedback_category === 'explicit_preference'
  );

  const clusters = clusterFeedback(relevantFeedback);

  return clusters
    .filter(cluster => cluster.length >= minOccurrences)
    .map(cluster => {
      // Use the most recent entry as the pattern description
      const mostRecent = cluster.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];

      // Calculate average confidence
      const avgConfidence = cluster.reduce((sum, e) => sum + e.confidence, 0) / cluster.length;

      // Determine scope
      const projectPaths = new Set(cluster.map(e => e.project_path));
      const scope = projectPaths.size === 1 ? 'project' : 'global';

      // Categorize
      const category = categorizePattern(cluster);

      return {
        pattern: generatePatternDescription(cluster),
        confidence: avgConfidence,
        evidence_count: cluster.length,
        evidence_examples: cluster.slice(0, 3).map(e => e.user_message),
        scope,
        category,
      };
    });
}

/** Generate human-readable pattern description */
function generatePatternDescription(cluster: FeedbackEntry[]): string {
  // Find common keywords in the cluster
  const allWords: Map<string, number> = new Map();

  for (const entry of cluster) {
    const words = entry.user_message.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3);

    for (const word of words) {
      allWords.set(word, (allWords.get(word) || 0) + 1);
    }
  }

  // Get top 3 most common words
  const topWords = [...allWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word);

  // Return most recent message as base, with common themes noted
  const mostRecent = cluster[0].user_message.substring(0, 100);
  return mostRecent + (topWords.length > 0 ? ` [themes: ${topWords.join(', ')}]` : '');
}

/** Categorize pattern based on content */
function categorizePattern(cluster: FeedbackEntry[]): 'style' | 'behavior' | 'tooling' | 'communication' {
  const text = cluster.map(e => e.user_message).join(' ').toLowerCase();

  if (/typescript|eslint|prettier|format|indent|naming/i.test(text)) return 'style';
  if (/test|build|npm|yarn|run|command|install/i.test(text)) return 'tooling';
  if (/verbose|brief|explain|detail|ask|confirm/i.test(text)) return 'communication';
  return 'behavior';
}
```

**Deliverables**:
- [ ] N-gram extraction function
- [ ] Jaccard similarity calculation (threshold: 0.3)
- [ ] Feedback clustering algorithm
- [ ] Pattern description generator
- [ ] Confidence scoring based on cluster size and consistency

**Verification**: `npx vitest run src/__tests__/learning/pattern-extractor.test.ts`

---

### Task 2.2: Preference Learner

**File**: `src/learning/preference-learner.ts`

```typescript
import { FeedbackEntry, UserPreferences, ExtractedPattern } from './types.js';
import { jaccardSimilarity } from './pattern-extractor.js';

const DEFAULT_PREFERENCES: UserPreferences = {
  verbosity: 'unknown',
  autonomy: 'unknown',
  explanation_depth: 'unknown',
  explicit_rules: [],
  inferred_preferences: [],
  recurring_corrections: [],
  last_updated: new Date().toISOString(),
};

/** Preference decay factor - old preferences lose weight over time */
const DECAY_DAYS = 30;

/** Extract explicit preferences from "always/never" statements */
function extractExplicitPreferences(feedback: FeedbackEntry[]): string[] {
  const explicit = feedback.filter(e => e.feedback_category === 'explicit_preference');

  const rules: string[] = [];
  for (const entry of explicit) {
    // Extract the rule from statements like "always use TypeScript"
    const alwaysMatch = entry.user_message.match(/always\s+(.+?)(?:\.|$)/i);
    const neverMatch = entry.user_message.match(/never\s+(.+?)(?:\.|$)/i);

    if (alwaysMatch) rules.push(`Always: ${alwaysMatch[1].trim()}`);
    if (neverMatch) rules.push(`Never: ${neverMatch[1].trim()}`);
  }

  return [...new Set(rules)];  // Deduplicate
}

/** Infer verbosity preference from feedback patterns */
function inferVerbosity(feedback: FeedbackEntry[]): 'concise' | 'detailed' | 'unknown' {
  const verboseComplaints = feedback.filter(e =>
    /too (long|verbose|much|wordy)/i.test(e.user_message)
  ).length;

  const briefComplaints = feedback.filter(e =>
    /more (detail|info|explanation)|too (brief|short)/i.test(e.user_message)
  ).length;

  if (verboseComplaints >= 3 && verboseComplaints > briefComplaints) return 'concise';
  if (briefComplaints >= 3 && briefComplaints > verboseComplaints) return 'detailed';
  return 'unknown';
}

/** Infer autonomy preference from feedback patterns */
function inferAutonomy(feedback: FeedbackEntry[]): 'ask_first' | 'just_do_it' | 'balanced' | 'unknown' {
  const askFirst = feedback.filter(e =>
    /ask (me )?(first|before)|don't assume|confirm/i.test(e.user_message)
  ).length;

  const justDoIt = feedback.filter(e =>
    /just (do|make|fix)|don't ask|stop asking/i.test(e.user_message)
  ).length;

  if (askFirst >= 3 && askFirst > justDoIt) return 'ask_first';
  if (justDoIt >= 3 && justDoIt > askFirst) return 'just_do_it';
  if (askFirst >= 2 && justDoIt >= 2) return 'balanced';
  return 'unknown';
}

/** Update preferences based on new feedback */
export function updatePreferences(
  currentPrefs: UserPreferences,
  newFeedback: FeedbackEntry[],
  extractedPatterns: ExtractedPattern[]
): UserPreferences {
  // Start with current preferences
  const updated: UserPreferences = { ...currentPrefs };

  // Add new explicit rules
  const newRules = extractExplicitPreferences(newFeedback);
  updated.explicit_rules = [...new Set([...updated.explicit_rules, ...newRules])];

  // Update verbosity if we have enough signal
  const newVerbosity = inferVerbosity(newFeedback);
  if (newVerbosity !== 'unknown') {
    updated.verbosity = newVerbosity;
  }

  // Update autonomy if we have enough signal
  const newAutonomy = inferAutonomy(newFeedback);
  if (newAutonomy !== 'unknown') {
    updated.autonomy = newAutonomy;
  }

  // Add inferred preferences from patterns
  const inferred = extractedPatterns
    .filter(p => p.confidence > 0.7 && p.scope === 'global')
    .map(p => p.pattern);
  updated.inferred_preferences = [...new Set([...updated.inferred_preferences, ...inferred])];

  // Update recurring corrections
  for (const pattern of extractedPatterns) {
    const existing = updated.recurring_corrections.find(
      c => jaccardSimilarity(c.pattern, pattern.pattern) > 0.5
    );

    if (existing) {
      existing.count = pattern.evidence_count;
      existing.last_seen = new Date().toISOString();
      existing.examples = pattern.evidence_examples;
    } else {
      updated.recurring_corrections.push({
        pattern: pattern.pattern,
        count: pattern.evidence_count,
        last_seen: new Date().toISOString(),
        examples: pattern.evidence_examples,
      });
    }
  }

  updated.last_updated = new Date().toISOString();
  return updated;
}
```

**Deliverables**:
- [ ] Explicit preference extraction from "always/never" statements
- [ ] Verbosity inference (requires 3+ signals)
- [ ] Autonomy inference (requires 3+ signals)
- [ ] Contradiction detection
- [ ] Preference decay (old preferences lose weight after 30 days)

**Verification**: `npx vitest run src/__tests__/learning/preference-learner.test.ts`

---

### Task 2.3: Agent Evaluator

**File**: `src/learning/agent-evaluator.ts`

```typescript
import { FeedbackEntry, AgentPerformance } from './types.js';

const DEFAULT_AGENT_PERFORMANCE: AgentPerformance = {
  agent_name: '',
  total_invocations: 0,
  success_count: 0,
  revision_count: 0,
  cancellation_count: 0,
  success_rate: 0,
  failure_patterns: [],
  strong_areas: [],
  weak_areas: [],
  last_updated: new Date().toISOString(),
};

/** Evaluate agent performance from feedback log */
export function evaluateAgentPerformance(
  feedbackLog: FeedbackEntry[]
): Map<string, AgentPerformance> {
  const performance = new Map<string, AgentPerformance>();

  // Group feedback by agent
  for (const entry of feedbackLog) {
    if (!entry.agent_used) continue;

    const agent = entry.agent_used;
    if (!performance.has(agent)) {
      performance.set(agent, { ...DEFAULT_AGENT_PERFORMANCE, agent_name: agent });
    }

    const perf = performance.get(agent)!;
    perf.total_invocations++;

    switch (entry.event_type) {
      case 'success':
        perf.success_count++;
        break;
      case 'revision':
        perf.revision_count++;
        break;
      case 'cancellation':
        perf.cancellation_count++;
        break;
    }

    perf.success_rate = perf.total_invocations > 0
      ? perf.success_count / perf.total_invocations
      : 0;

    perf.last_updated = new Date().toISOString();
  }

  // Identify failure patterns for each agent
  for (const [agent, perf] of performance) {
    const agentFeedback = feedbackLog.filter(
      e => e.agent_used === agent &&
           (e.event_type === 'revision' || e.event_type === 'cancellation')
    );

    perf.failure_patterns = identifyFailurePatterns(agentFeedback);
    perf.strong_areas = identifyAreas(feedbackLog, agent, 'success');
    perf.weak_areas = identifyAreas(feedbackLog, agent, 'revision');
  }

  return performance;
}

/** Identify common failure patterns for an agent */
function identifyFailurePatterns(
  feedback: FeedbackEntry[]
): Array<{ pattern: string; count: number; examples: string[] }> {
  const patterns: Map<string, { count: number; examples: string[] }> = new Map();

  for (const entry of feedback) {
    // Extract key themes from the feedback
    const themes = extractThemes(entry.user_message);

    for (const theme of themes) {
      if (!patterns.has(theme)) {
        patterns.set(theme, { count: 0, examples: [] });
      }
      const p = patterns.get(theme)!;
      p.count++;
      if (p.examples.length < 3) {
        p.examples.push(entry.user_message.substring(0, 50));
      }
    }
  }

  return [...patterns.entries()]
    .filter(([_, p]) => p.count >= 2)
    .map(([theme, p]) => ({ pattern: theme, ...p }));
}

/** Extract themes from feedback text */
function extractThemes(text: string): string[] {
  const themes: string[] = [];

  // Common issue categories
  const categoryPatterns = [
    { pattern: /error handling/i, theme: 'error handling' },
    { pattern: /types?|typescript/i, theme: 'TypeScript types' },
    { pattern: /test(s|ing)?/i, theme: 'testing' },
    { pattern: /edge case/i, theme: 'edge cases' },
    { pattern: /documentation|docs|comments?/i, theme: 'documentation' },
    { pattern: /performance|slow|fast/i, theme: 'performance' },
    { pattern: /style|format|prettier|eslint/i, theme: 'code style' },
    { pattern: /security|auth|password/i, theme: 'security' },
    { pattern: /react|component/i, theme: 'React' },
    { pattern: /api|endpoint|fetch/i, theme: 'API' },
  ];

  for (const { pattern, theme } of categoryPatterns) {
    if (pattern.test(text)) {
      themes.push(theme);
    }
  }

  return themes.length > 0 ? themes : ['general'];
}

/** Identify areas where agent is strong or weak */
function identifyAreas(
  feedback: FeedbackEntry[],
  agent: string,
  eventType: 'success' | 'revision'
): string[] {
  const relevantFeedback = feedback.filter(
    e => e.agent_used === agent && e.event_type === eventType
  );

  const areaCounts: Map<string, number> = new Map();

  for (const entry of relevantFeedback) {
    const themes = extractThemes(entry.original_task || entry.user_message);
    for (const theme of themes) {
      areaCounts.set(theme, (areaCounts.get(theme) || 0) + 1);
    }
  }

  return [...areaCounts.entries()]
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([area]) => area);
}
```

**Deliverables**:
- [ ] Per-agent performance tracking
- [ ] Success rate calculation
- [ ] Failure pattern identification (min 2 occurrences)
- [ ] Strong/weak area identification

**Verification**: `npx vitest run src/__tests__/learning/agent-evaluator.test.ts`

---

## Phase 3: Context Injection System

**Objective**: Inject learned context into sessions to improve future interactions.

### Task 3.1: Enhanced Session Start Hook

**File**: `src/learning/hooks/learned-context.ts`

**Reference**: Integrates with existing `SESSION_START_SCRIPT` in `src/installer/hooks.ts` (lines 865-899)

```typescript
import { join } from 'path';
import { UserPreferences, AgentPerformance, ProjectPatterns } from '../types.js';
import { readJsonFile, getLearningDir, getProjectLearningDir } from '../storage.js';

const MAX_INJECTION_TOKENS = 500;  // Approximate limit

/** Generate learned context for injection */
export function generateLearnedContext(projectPath: string): string {
  const globalPrefs = readJsonFile<UserPreferences>(
    join(getLearningDir(), 'user-preferences.json'),
    null
  );

  const projectPatterns = readJsonFile<ProjectPatterns>(
    join(getProjectLearningDir(projectPath), 'patterns.json'),
    null
  );

  const agentPerformance = readJsonFile<Record<string, AgentPerformance>>(
    join(getLearningDir(), 'agent-performance.json'),
    {}
  );

  const sections: string[] = [];

  // User preferences
  if (globalPrefs && hasContent(globalPrefs)) {
    sections.push(formatPreferences(globalPrefs));
  }

  // Project conventions
  if (projectPatterns && projectPatterns.conventions.length > 0) {
    sections.push(formatProjectPatterns(projectPatterns));
  }

  // Recent corrections (from recurring_corrections)
  if (globalPrefs?.recurring_corrections.length > 0) {
    sections.push(formatCorrections(globalPrefs.recurring_corrections.slice(0, 5)));
  }

  // Agent notes (only weak areas)
  const weakAgents = Object.values(agentPerformance)
    .filter(a => a.weak_areas.length > 0);
  if (weakAgents.length > 0) {
    sections.push(formatAgentNotes(weakAgents));
  }

  // Only inject if we have meaningful content
  if (sections.length === 0) {
    return '';
  }

  const content = `<learned-context>

${sections.join('\n\n')}

</learned-context>

---

`;

  // Truncate if too long (rough token estimate: 1 token ≈ 4 chars)
  if (content.length > MAX_INJECTION_TOKENS * 4) {
    return content.substring(0, MAX_INJECTION_TOKENS * 4) + '\n...</learned-context>\n\n---\n\n';
  }

  return content;
}

function hasContent(prefs: UserPreferences): boolean {
  return (
    prefs.verbosity !== 'unknown' ||
    prefs.autonomy !== 'unknown' ||
    prefs.explicit_rules.length > 0 ||
    prefs.inferred_preferences.length > 0
  );
}

function formatPreferences(prefs: UserPreferences): string {
  const lines: string[] = ['## User Preferences'];

  if (prefs.verbosity !== 'unknown') {
    lines.push(`- Verbosity: ${prefs.verbosity}`);
  }
  if (prefs.autonomy !== 'unknown') {
    lines.push(`- Autonomy: ${prefs.autonomy}`);
  }
  for (const rule of prefs.explicit_rules.slice(0, 5)) {
    lines.push(`- ${rule}`);
  }

  return lines.join('\n');
}

function formatProjectPatterns(patterns: ProjectPatterns): string {
  const lines: string[] = ['## Project Conventions'];

  for (const conv of patterns.conventions.slice(0, 5)) {
    lines.push(`- ${conv}`);
  }

  if (patterns.tech_stack.length > 0) {
    lines.push(`- Tech: ${patterns.tech_stack.join(', ')}`);
  }

  return lines.join('\n');
}

function formatCorrections(corrections: Array<{ pattern: string; count: number }>): string {
  const lines: string[] = ['## Avoid These Mistakes'];

  for (const c of corrections) {
    lines.push(`- ${c.pattern} (${c.count}x)`);
  }

  return lines.join('\n');
}

function formatAgentNotes(agents: AgentPerformance[]): string {
  const lines: string[] = ['## Agent Notes'];

  for (const agent of agents.slice(0, 3)) {
    lines.push(`- ${agent.agent_name}: struggles with ${agent.weak_areas.join(', ')}`);
  }

  return lines.join('\n');
}
```

**Deliverables**:
- [ ] Context generation function
- [ ] Size limiting (<500 tokens)
- [ ] Integration with existing session-start hook
- [ ] Enable/disable via config flag

**Verification**: `npx vitest run src/__tests__/learning/learned-context.test.ts`

---

### Task 3.2: Dynamic Agent Prompt Enhancement

**File**: `src/learning/prompt-patcher.ts`

```typescript
import { AgentPerformance, UserPreferences } from './types.js';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PromptPatch {
  agent_name: string;
  patch_type: 'append' | 'prepend';
  content: string;
  reason: string;
  confidence: number;
  evidence_count: number;
}

export interface PatchResult {
  agent_name: string;
  success: boolean;
  backup_path?: string;
  error?: string;
}

/** Generate prompt patches based on learnings */
export function generatePromptPatches(
  agentPerformance: Map<string, AgentPerformance>,
  userPreferences: UserPreferences
): PromptPatch[] {
  const patches: PromptPatch[] = [];

  // Generate patches from agent failure patterns
  for (const [agent, perf] of agentPerformance) {
    for (const failure of perf.failure_patterns) {
      if (failure.count >= 3) {
        patches.push({
          agent_name: agent,
          patch_type: 'append',
          content: `\n\n## Learned: ${failure.pattern}\nBe extra careful with: ${failure.pattern}. This has been flagged ${failure.count} times.`,
          reason: `Agent failed on "${failure.pattern}" ${failure.count} times`,
          confidence: Math.min(0.5 + failure.count * 0.1, 0.95),
          evidence_count: failure.count,
        });
      }
    }
  }

  // Generate patches from user preferences
  if (userPreferences.verbosity === 'concise') {
    patches.push({
      agent_name: '*',  // All agents
      patch_type: 'append',
      content: '\n\n## User Preference\nKeep responses concise. Avoid unnecessary verbosity.',
      reason: 'User prefers concise responses',
      confidence: 0.85,
      evidence_count: 3,
    });
  }

  for (const rule of userPreferences.explicit_rules) {
    patches.push({
      agent_name: '*',
      patch_type: 'append',
      content: `\n\n## User Rule\n${rule}`,
      reason: 'Explicit user preference',
      confidence: 0.95,
      evidence_count: 1,
    });
  }

  return patches;
}

/** Preview patches (dry run) */
export function previewPatches(patches: PromptPatch[]): string {
  const lines: string[] = ['Suggested Prompt Patches:', ''];

  for (const patch of patches) {
    lines.push(`Agent: ${patch.agent_name}`);
    lines.push(`Type: ${patch.patch_type}`);
    lines.push(`Reason: ${patch.reason}`);
    lines.push(`Confidence: ${(patch.confidence * 100).toFixed(0)}%`);
    lines.push(`Content: ${patch.content.substring(0, 100)}...`);
    lines.push('---');
  }

  return lines.join('\n');
}

/** Apply patches to agent prompt files */
export function applyPromptPatches(
  patches: PromptPatch[],
  agentsDir: string = join(homedir(), '.claude', 'agents')
): PatchResult[] {
  const results: PatchResult[] = [];

  for (const patch of patches) {
    const agentFiles = patch.agent_name === '*'
      ? getAllAgentFiles(agentsDir)
      : [join(agentsDir, `${patch.agent_name}.md`)];

    for (const filePath of agentFiles) {
      if (!existsSync(filePath)) {
        results.push({
          agent_name: patch.agent_name,
          success: false,
          error: `File not found: ${filePath}`,
        });
        continue;
      }

      try {
        // Create backup
        const backupPath = `${filePath}.backup.${Date.now()}`;
        copyFileSync(filePath, backupPath);

        // Read current content
        const content = readFileSync(filePath, 'utf-8');

        // Apply patch
        const newContent = patch.patch_type === 'prepend'
          ? patch.content + '\n\n' + content
          : content + '\n' + patch.content;

        writeFileSync(filePath, newContent, 'utf-8');

        results.push({
          agent_name: patch.agent_name,
          success: true,
          backup_path: backupPath,
        });
      } catch (error) {
        results.push({
          agent_name: patch.agent_name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}

/** Revert a patch using backup file */
export function revertPatch(backupPath: string): boolean {
  const originalPath = backupPath.replace(/\.backup\.\d+$/, '');
  try {
    copyFileSync(backupPath, originalPath);
    return true;
  } catch {
    return false;
  }
}

function getAllAgentFiles(agentsDir: string): string[] {
  if (!existsSync(agentsDir)) return [];

  const { readdirSync } = require('fs');
  return readdirSync(agentsDir)
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => join(agentsDir, f));
}
```

**Deliverables**:
- [ ] Patch generation from agent failures
- [ ] Patch generation from user preferences
- [ ] Dry-run preview
- [ ] Safe patch application with timestamped backup
- [ ] Patch revert capability

**Verification**: `npx vitest run src/__tests__/learning/prompt-patcher.test.ts`

---

## Phase 4: CLI Commands

**Objective**: Provide user interface for viewing and managing learnings.

### Task 4.1: `olympus learn` Command

**File**: `src/cli/index.ts` (add to existing file at line ~547, before `program.parse()`)

**Reference**: Follows pattern from existing commands in `src/cli/index.ts` (lines 59-546)

```typescript
// Add this to src/cli/index.ts (add to existing imports section)

import {
  readFeedbackLog,
  readJsonFile,
  getLearningDir,
  writeJsonFile,
  appendFeedback,  // For feedback command
} from '../learning/storage.js';
import { extractPatterns } from '../learning/pattern-extractor.js';
import { updatePreferences } from '../learning/preference-learner.js';
import { evaluateAgentPerformance } from '../learning/agent-evaluator.js';
import { generatePromptPatches, previewPatches, applyPromptPatches } from '../learning/prompt-patcher.js';
import { UserPreferences, AgentPerformance } from '../learning/types.js';
import { randomUUID } from 'crypto';  // Node.js built-in, no external dependency needed

/**
 * Learn command - View and manage learnings
 */
program
  .command('learn')
  .description('View and manage learned preferences and patterns')
  .option('-s, --show', 'Show current learnings')
  .option('-a, --analyze', 'Analyze feedback and show insights')
  .option('--suggest', 'Show suggested prompt improvements')
  .option('--apply', 'Apply suggested improvements')
  .option('-f, --forget', 'Forget all learnings')
  .option('-p, --project', 'Scope to current project (with --forget)')
  .option('-e, --export', 'Export learnings to JSON')
  .option('-i, --import <file>', 'Import learnings from JSON')
  .action(async (options) => {
    const learningDir = getLearningDir();

    if (options.show) {
      console.log(chalk.blue.bold('\n╭─────────────────────────────────────────────────────────────╮'));
      console.log(chalk.blue.bold('│                  OLYMPUS LEARNING STATUS                    │'));
      console.log(chalk.blue.bold('╰─────────────────────────────────────────────────────────────╯\n'));

      const feedback = readFeedbackLog();
      const revisions = feedback.filter(f => f.event_type === 'revision').length;
      const cancellations = feedback.filter(f => f.event_type === 'cancellation').length;
      const successes = feedback.filter(f => f.event_type === 'success').length;

      console.log(chalk.white(`📊 Feedback Collected: ${feedback.length} entries`));
      console.log(chalk.gray(`   (${revisions} revisions, ${cancellations} cancellations, ${successes} successes)\n`));

      const prefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        null
      );

      if (prefs) {
        console.log(chalk.white('👤 User Preferences:'));
        if (prefs.verbosity !== 'unknown') console.log(`   • Verbosity: ${prefs.verbosity}`);
        if (prefs.autonomy !== 'unknown') console.log(`   • Autonomy: ${prefs.autonomy}`);
        for (const rule of prefs.explicit_rules.slice(0, 3)) {
          console.log(`   • ${rule}`);
        }
        console.log('');
      }

      if (prefs?.recurring_corrections.length > 0) {
        console.log(chalk.white('📝 Recurring Corrections:'));
        for (const c of prefs.recurring_corrections.slice(0, 5)) {
          console.log(`   • "${c.pattern}" (seen ${c.count}x)`);
        }
        console.log('');
      }

      const agentPerf = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );

      if (Object.keys(agentPerf).length > 0) {
        console.log(chalk.white('🤖 Agent Performance:'));
        for (const [name, perf] of Object.entries(agentPerf)) {
          const successPct = (perf.success_rate * 100).toFixed(0);
          console.log(`   • ${name}: ${successPct}% success (${perf.revision_count} revisions)`);
        }
        console.log('');
      }

      return;
    }

    if (options.analyze) {
      console.log(chalk.blue('Analyzing feedback...\n'));

      const feedback = readFeedbackLog();
      const patterns = extractPatterns(feedback);

      console.log(chalk.white(`Found ${patterns.length} patterns:\n`));
      for (const p of patterns) {
        console.log(`  [${(p.confidence * 100).toFixed(0)}%] ${p.pattern}`);
        console.log(chalk.gray(`       Seen ${p.evidence_count}x, scope: ${p.scope}, category: ${p.category}`));
      }

      // Update preferences
      const currentPrefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        { verbosity: 'unknown', autonomy: 'unknown', explanation_depth: 'unknown', explicit_rules: [], inferred_preferences: [], recurring_corrections: [], last_updated: new Date().toISOString() }
      );

      const updatedPrefs = updatePreferences(currentPrefs, feedback, patterns);
      writeJsonFile(join(learningDir, 'user-preferences.json'), updatedPrefs);

      // Update agent performance
      const agentPerf = evaluateAgentPerformance(feedback);
      writeJsonFile(join(learningDir, 'agent-performance.json'), Object.fromEntries(agentPerf));

      console.log(chalk.green('\n✓ Preferences and performance metrics updated.'));
      return;
    }

    if (options.suggest) {
      const agentPerfRaw = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );
      const agentPerf = new Map(Object.entries(agentPerfRaw));

      const prefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        { verbosity: 'unknown', autonomy: 'unknown', explanation_depth: 'unknown', explicit_rules: [], inferred_preferences: [], recurring_corrections: [], last_updated: new Date().toISOString() }
      );

      const patches = generatePromptPatches(agentPerf, prefs);

      if (patches.length === 0) {
        console.log(chalk.yellow('No suggestions available yet. Collect more feedback first.'));
        return;
      }

      console.log(previewPatches(patches));
      console.log(chalk.gray('\nRun with --apply to apply these patches.'));
      return;
    }

    if (options.apply) {
      // Similar to suggest, but actually apply
      const agentPerfRaw = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );
      const agentPerf = new Map(Object.entries(agentPerfRaw));

      const prefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        { verbosity: 'unknown', autonomy: 'unknown', explanation_depth: 'unknown', explicit_rules: [], inferred_preferences: [], recurring_corrections: [], last_updated: new Date().toISOString() }
      );

      const patches = generatePromptPatches(agentPerf, prefs);

      if (patches.length === 0) {
        console.log(chalk.yellow('No patches to apply.'));
        return;
      }

      console.log(chalk.yellow('Applying patches...'));
      const results = applyPromptPatches(patches);

      for (const r of results) {
        if (r.success) {
          console.log(chalk.green(`✓ ${r.agent_name} patched (backup: ${r.backup_path})`));
        } else {
          console.log(chalk.red(`✗ ${r.agent_name}: ${r.error}`));
        }
      }
      return;
    }

    if (options.forget) {
      const { rmSync } = require('fs');

      if (options.project) {
        const projectDir = join(process.cwd(), '.olympus', 'learning');
        if (existsSync(projectDir)) {
          rmSync(projectDir, { recursive: true });
          console.log(chalk.green('✓ Project learnings forgotten.'));
        } else {
          console.log(chalk.yellow('No project learnings found.'));
        }
      } else {
        if (existsSync(learningDir)) {
          rmSync(learningDir, { recursive: true });
          console.log(chalk.green('✓ All learnings forgotten.'));
        } else {
          console.log(chalk.yellow('No learnings found.'));
        }
      }
      return;
    }

    if (options.export) {
      const data = {
        feedback: readFeedbackLog(),
        preferences: readJsonFile(join(learningDir, 'user-preferences.json'), null),
        agentPerformance: readJsonFile(join(learningDir, 'agent-performance.json'), {}),
        exportedAt: new Date().toISOString(),
      };
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (options.import) {
      const importFile = options.import;
      if (!existsSync(importFile)) {
        console.error(chalk.red(`File not found: ${importFile}`));
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(importFile, 'utf-8'));

      // Merge feedback
      if (data.feedback) {
        const { appendFileSync, mkdirSync } = require('fs');
        mkdirSync(learningDir, { recursive: true });
        const logPath = join(learningDir, 'feedback-log.jsonl');
        for (const entry of data.feedback) {
          appendFileSync(logPath, JSON.stringify(entry) + '\n');
        }
      }

      // Import preferences
      if (data.preferences) {
        writeJsonFile(join(learningDir, 'user-preferences.json'), data.preferences);
      }

      // Import agent performance
      if (data.agentPerformance) {
        writeJsonFile(join(learningDir, 'agent-performance.json'), data.agentPerformance);
      }

      console.log(chalk.green('✓ Learnings imported.'));
      return;
    }

    // Default: show help
    console.log('Usage: olympus learn [options]');
    console.log('');
    console.log('Options:');
    console.log('  -s, --show      Show current learnings');
    console.log('  -a, --analyze   Analyze feedback and update patterns');
    console.log('  --suggest       Show suggested prompt improvements');
    console.log('  --apply         Apply suggested improvements');
    console.log('  -f, --forget    Forget all learnings');
    console.log('  -p, --project   Scope to current project (with --forget)');
    console.log('  -e, --export    Export learnings to JSON');
    console.log('  -i, --import    Import learnings from JSON file');
  });

/**
 * Feedback command - Manual preference logging
 */
program
  .command('feedback [preference]')
  .description('Manually log a preference or view feedback history')
  .option('-h, --history', 'View feedback history')
  .action(async (preference, options) => {
    if (options.history) {
      const feedback = readFeedbackLog();

      if (feedback.length === 0) {
        console.log(chalk.yellow('No feedback recorded yet.'));
        return;
      }

      console.log(chalk.blue.bold('\nFeedback History (last 20):\n'));

      for (const entry of feedback.slice(-20).reverse()) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const type = entry.event_type.padEnd(12);
        const msg = entry.user_message.substring(0, 50);
        console.log(`${chalk.gray(date)} ${chalk.cyan(type)} ${msg}`);
      }
      return;
    }

    if (!preference) {
      console.log('Usage: olympus feedback "always use TypeScript strict mode"');
      console.log('       olympus feedback --history');
      return;
    }

    // Log explicit preference (uses imports from top of file)
    // Note: appendFeedback and randomUUID are imported at the top with other learning imports
    appendFeedback({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: 'manual',
      project_path: process.cwd(),
      event_type: 'explicit_preference',
      user_message: preference,
      feedback_category: 'explicit_preference',
      confidence: 1.0,
    });

    console.log(chalk.green(`✓ Preference logged: "${preference}"`));
  });
```

**Deliverables**:
- [ ] `--show` command with formatted output
- [ ] `--analyze` command for pattern analysis
- [ ] `--suggest` command for prompt improvements
- [ ] `--apply` command with backup creation
- [ ] `--forget` command with project scope option
- [ ] `--export` / `--import` for backup/sharing

**Verification**:
- `npm run build && node dist/cli/index.js learn --show`
- `npm run build && node dist/cli/index.js learn --analyze`

---

## Phase 5: Integration & Testing

### Task 5.1: Hook Integration

**File**: `src/installer/hooks.ts`

**Updates Required** (reference existing structure at lines 1-100):

1. Add new hook scripts to `HOOK_SCRIPTS_NODE` / `HOOK_SCRIPTS` constants
2. Update `HOOKS_SETTINGS_CONFIG_NODE` to include new hooks
3. Ensure hook ordering: learned-context → keyword-detector → revision-detector

```typescript
// Add to src/installer/hooks.ts

// After line ~590 (after KEYWORD_DETECTOR_SCRIPT_NODE)
export const REVISION_DETECTOR_SCRIPT_NODE = `[content from Task 1.3]`;

// Update HOOKS_SETTINGS_CONFIG_NODE (around line 1325) to include:
// {
//   "UserPromptSubmit": [
//     { "command": "node ~/.claude/hooks/revision-detector.mjs" },
//     { "command": "node ~/.claude/hooks/keyword-detector.mjs" }
//   ],
//   "SessionStart": [
//     { "command": "node ~/.claude/hooks/learned-context.mjs" },
//     { "command": "node ~/.claude/hooks/session-start.mjs" }
//   ],
//   "Stop": [
//     { "command": "node ~/.claude/hooks/cancellation-detector.mjs" },
//     { "command": "node ~/.claude/hooks/persistent-mode.mjs" }
//   ]
// }
```

**Deliverables**:
- [ ] Add revision-detector hook script
- [ ] Add cancellation-detector hook script
- [ ] Add learned-context hook script
- [ ] Update settings.json configuration
- [ ] Hook ordering: learned-context first, revision-detector after keyword-detector

**Verification**:
- `npm run build`
- `node dist/cli/index.js install --force`
- Check `~/.claude/settings.local.json` for new hooks

---

### Task 5.2: Testing Suite

**Directory**: `src/__tests__/learning/`

**Test Files** (Complete implementations):

```typescript
// src/__tests__/learning/storage.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock - declare mutable variable for tempDir
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

// Mock os module at module level (hoisted automatically)
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  getLearningDir,
  getProjectLearningDir,
  getProjectHash,
  ensureLearningDirs,
  appendFeedback,
  readFeedbackLog,
  readJsonFile,
  writeJsonFile,
} from '../../learning/storage.js';
import type { FeedbackEntry } from '../../learning/types.js';

describe('storage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-test-'));
    // Update the hoisted mock value
    mockHomedir.value = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('appends feedback to JSONL file', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: '2025-01-20T10:00:00Z',
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'revision',
      user_message: "No, that's wrong.",
      feedback_category: 'correction',
      confidence: 0.9,
    };

    appendFeedback(entry);

    const logPath = join(getLearningDir(), 'feedback-log.jsonl');
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.id).toBe('test-1');
  });

  it('reads feedback log correctly', () => {
    const entries: FeedbackEntry[] = [
      { id: '1', timestamp: '2025-01-20T10:00:00Z', session_id: 's1', project_path: '/p', event_type: 'revision', user_message: 'msg1', feedback_category: 'correction', confidence: 0.9 },
      { id: '2', timestamp: '2025-01-20T11:00:00Z', session_id: 's1', project_path: '/p', event_type: 'success', user_message: 'msg2', feedback_category: 'praise', confidence: 0.8 },
    ];

    entries.forEach(e => appendFeedback(e));

    const result = readFeedbackLog();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('generates consistent project hashes', () => {
    const hash1 = getProjectHash('/path/to/project');
    const hash2 = getProjectHash('/path/to/project');
    const hash3 = getProjectHash('/different/project');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(16); // Truncated SHA-256
  });

  it('creates learning directories on demand', () => {
    const projectPath = join(tempDir, 'test-project');
    ensureLearningDirs(projectPath);

    expect(existsSync(getLearningDir())).toBe(true);
    expect(existsSync(getProjectLearningDir(projectPath))).toBe(true);
  });

  it('reads and writes JSON files with type safety', () => {
    const filePath = join(tempDir, 'test.json');
    const data = { key: 'value', count: 42 };

    writeJsonFile(filePath, data);
    const result = readJsonFile(filePath, { key: 'default', count: 0 });

    expect(result).toEqual(data);
  });

  it('returns default value for missing JSON files', () => {
    const result = readJsonFile('/nonexistent/file.json', { default: true });
    expect(result).toEqual({ default: true });
  });
});
```

```typescript
// src/__tests__/learning/revision-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectFeedbackCategory } from '../../learning/hooks/revision-detector.js';

describe('RevisionDetector', () => {
  describe('correction detection', () => {
    it('detects direct corrections', () => {
      const result = detectFeedbackCategory("No, that's wrong. I wanted X.");
      expect(result?.category).toBe('correction');
      expect(result?.confidence).toBeGreaterThan(0.8);
    });

    it('detects "thats not" pattern', () => {
      const result = detectFeedbackCategory("No thats not what I meant.");
      expect(result?.category).toBe('correction');
    });

    it('detects misunderstanding', () => {
      const result = detectFeedbackCategory("You misunderstood the requirements.");
      expect(result?.category).toBe('correction');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('explicit preference detection', () => {
    it('detects "always" statements', () => {
      const result = detectFeedbackCategory("Always use TypeScript strict mode.");
      expect(result?.category).toBe('explicit_preference');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('detects "never" statements', () => {
      const result = detectFeedbackCategory("Never use var, use const or let.");
      expect(result?.category).toBe('explicit_preference');
    });

    it('detects "from now on" pattern', () => {
      const result = detectFeedbackCategory("From now on, add tests for all functions.");
      expect(result?.category).toBe('explicit_preference');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('rejection detection', () => {
    it('detects stop command', () => {
      const result = detectFeedbackCategory("Stop, I need to rethink this.");
      expect(result?.category).toBe('rejection');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('detects cancel command', () => {
      const result = detectFeedbackCategory("Cancel that request.");
      expect(result?.category).toBe('rejection');
    });

    it('detects never mind', () => {
      const result = detectFeedbackCategory("Never mind, let's do something else.");
      expect(result?.category).toBe('rejection');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('praise detection', () => {
    it('detects perfect', () => {
      const result = detectFeedbackCategory("Perfect, exactly what I needed!");
      expect(result?.category).toBe('praise');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects thanks with lower confidence', () => {
      const result = detectFeedbackCategory("Thanks for that.");
      expect(result?.category).toBe('praise');
      expect(result?.confidence).toBeLessThan(0.7); // Lower confidence for ambiguous thanks
    });
  });

  describe('edge cases', () => {
    it('ignores non-feedback messages', () => {
      const result = detectFeedbackCategory("Can you help me with React?");
      expect(result).toBeNull();
    });

    it('ignores normal questions', () => {
      const result = detectFeedbackCategory("How does the authentication work?");
      expect(result).toBeNull();
    });

    it('removes code blocks before matching', () => {
      const result = detectFeedbackCategory("Run this: ```stop``` then continue.");
      expect(result?.category).not.toBe('rejection');
    });

    it('removes inline code before matching', () => {
      const result = detectFeedbackCategory("Use `never` type for exhaustive checks.");
      // Should not trigger 'never' pattern because it's in inline code
      expect(result?.category).not.toBe('explicit_preference');
    });

    it('returns highest confidence match when multiple patterns match', () => {
      const result = detectFeedbackCategory("No, always use strict mode from now on.");
      // Both correction and explicit_preference match, explicit_preference should win (higher confidence)
      expect(result?.category).toBe('explicit_preference');
    });
  });
});
```

```typescript
// src/__tests__/learning/pattern-extractor.test.ts
import { describe, it, expect } from 'vitest';
import { extractPatterns } from '../../learning/pattern-extractor.js';
import { MOCK_FEEDBACK_FOR_CLUSTERING, MOCK_FEEDBACK_INSUFFICIENT } from './fixtures/mock-feedback.js';

describe('PatternExtractor', () => {
  it('groups similar feedback using Jaccard similarity', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);

    expect(patterns.length).toBeGreaterThan(0);
    // The TypeScript-related feedback should be clustered
    const tsPattern = patterns.find(p => p.pattern.toLowerCase().includes('typescript'));
    expect(tsPattern).toBeDefined();
    expect(tsPattern?.evidence_count).toBeGreaterThanOrEqual(3);
  });

  it('requires minimum 3 occurrences by default', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_INSUFFICIENT);

    // Only 2 similar entries, should not create pattern
    expect(patterns).toHaveLength(0);
  });

  it('allows custom minimum occurrences', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_INSUFFICIENT, 2);

    // With min=2, should create pattern
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('generates readable pattern descriptions', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);

    for (const pattern of patterns) {
      expect(pattern.pattern.length).toBeGreaterThan(10);
      expect(pattern.pattern.length).toBeLessThan(200);
      // Should include themes
      expect(pattern.pattern).toContain('[themes:');
    }
  });

  it('calculates confidence based on cluster consistency', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);

    for (const pattern of patterns) {
      expect(pattern.confidence).toBeGreaterThan(0);
      expect(pattern.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('determines scope based on project paths', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);

    // All feedback from same project should be 'project' scope
    const projectPattern = patterns.find(p => p.scope === 'project');
    expect(projectPattern).toBeDefined();
  });

  it('categorizes patterns correctly', () => {
    const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);

    const categories = new Set(patterns.map(p => p.category));
    // Should only contain valid categories
    for (const cat of categories) {
      expect(['style', 'behavior', 'tooling', 'communication']).toContain(cat);
    }
  });
});
```

```typescript
// src/__tests__/learning/preference-learner.test.ts
import { describe, it, expect } from 'vitest';
import { updatePreferences } from '../../learning/preference-learner.js';
import type { UserPreferences, FeedbackEntry, ExtractedPattern } from '../../learning/types.js';

const DEFAULT_PREFS: UserPreferences = {
  verbosity: 'unknown',
  autonomy: 'unknown',
  explanation_depth: 'unknown',
  explicit_rules: [],
  inferred_preferences: [],
  recurring_corrections: [],
  last_updated: new Date().toISOString(),
};

describe('PreferenceLearner', () => {
  describe('explicit preference extraction', () => {
    it('extracts "always" rules', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'explicit_preference', user_message: 'Always use TypeScript strict mode.', feedback_category: 'explicit_preference', confidence: 0.95 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.explicit_rules).toContain('Always: use TypeScript strict mode');
    });

    it('extracts "never" rules', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'explicit_preference', user_message: 'Never use var in JavaScript.', feedback_category: 'explicit_preference', confidence: 0.95 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.explicit_rules).toContain('Never: use var in JavaScript');
    });

    it('deduplicates rules', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'explicit_preference', user_message: 'Always use TypeScript.', feedback_category: 'explicit_preference', confidence: 0.95 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'explicit_preference', user_message: 'Always use TypeScript.', feedback_category: 'explicit_preference', confidence: 0.95 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.explicit_rules.filter(r => r.includes('TypeScript'))).toHaveLength(1);
    });
  });

  describe('verbosity inference', () => {
    it('infers "concise" from verbose complaints', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Too verbose, be more concise.', feedback_category: 'correction', confidence: 0.8 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'This is too long.', feedback_category: 'correction', confidence: 0.8 },
        { id: '3', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Too wordy, simplify.', feedback_category: 'correction', confidence: 0.8 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.verbosity).toBe('concise');
    });

    it('infers "detailed" from brevity complaints', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'I need more detail please.', feedback_category: 'correction', confidence: 0.8 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Too brief, explain more.', feedback_category: 'correction', confidence: 0.8 },
        { id: '3', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Give me more explanation.', feedback_category: 'correction', confidence: 0.8 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.verbosity).toBe('detailed');
    });

    it('requires 3+ signals to infer', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Too verbose.', feedback_category: 'correction', confidence: 0.8 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Too long.', feedback_category: 'correction', confidence: 0.8 },
        // Only 2 signals - not enough
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.verbosity).toBe('unknown');
    });
  });

  describe('autonomy inference', () => {
    it('infers "ask_first" from confirmation requests', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Ask me first before making changes.', feedback_category: 'correction', confidence: 0.8 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Please confirm before proceeding.', feedback_category: 'correction', confidence: 0.8 },
        { id: '3', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: "Don't assume, ask me.", feedback_category: 'correction', confidence: 0.8 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.autonomy).toBe('ask_first');
    });

    it('infers "just_do_it" from autonomy requests', () => {
      const feedback: FeedbackEntry[] = [
        { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Just do it, stop asking.', feedback_category: 'correction', confidence: 0.8 },
        { id: '2', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: "Don't ask, just make the change.", feedback_category: 'correction', confidence: 0.8 },
        { id: '3', timestamp: '', session_id: '', project_path: '', event_type: 'revision', user_message: 'Stop asking and just fix it.', feedback_category: 'correction', confidence: 0.8 },
      ];

      const result = updatePreferences(DEFAULT_PREFS, feedback, []);

      expect(result.autonomy).toBe('just_do_it');
    });
  });

  describe('recurring corrections', () => {
    it('adds patterns to recurring corrections', () => {
      const patterns: ExtractedPattern[] = [
        { pattern: 'Add error handling', confidence: 0.85, evidence_count: 4, evidence_examples: ['ex1', 'ex2'], scope: 'global', category: 'behavior' },
      ];

      const result = updatePreferences(DEFAULT_PREFS, [], patterns);

      expect(result.recurring_corrections).toHaveLength(1);
      expect(result.recurring_corrections[0].pattern).toBe('Add error handling');
      expect(result.recurring_corrections[0].count).toBe(4);
    });

    it('updates existing corrections instead of duplicating', () => {
      const existingPrefs: UserPreferences = {
        ...DEFAULT_PREFS,
        recurring_corrections: [
          { pattern: 'Add error handling', count: 2, last_seen: '2025-01-01', examples: ['old'] },
        ],
      };

      const patterns: ExtractedPattern[] = [
        { pattern: 'Add error handling more', confidence: 0.85, evidence_count: 5, evidence_examples: ['new1', 'new2'], scope: 'global', category: 'behavior' },
      ];

      const result = updatePreferences(existingPrefs, [], patterns);

      // Should update, not add new
      expect(result.recurring_corrections).toHaveLength(1);
      expect(result.recurring_corrections[0].count).toBe(5);
    });
  });
});
```

**Mock Data** (Complete):

```typescript
// src/__tests__/learning/fixtures/mock-feedback.ts
import type { FeedbackEntry } from '../../../learning/types.js';

/**
 * Mock feedback for testing clustering - contains 3+ similar TypeScript-related entries
 */
export const MOCK_FEEDBACK_FOR_CLUSTERING: FeedbackEntry[] = [
  {
    id: 'test-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "No, that's wrong. Use TypeScript types.",
    feedback_category: 'correction',
    confidence: 0.9,
  },
  {
    id: 'test-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Add TypeScript types to this function.",
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'test-3',
    timestamp: '2025-01-20T12:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Missing TypeScript type annotations here.",
    feedback_category: 'correction',
    confidence: 0.88,
  },
  {
    id: 'test-4',
    timestamp: '2025-01-20T13:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    user_message: "Perfect, that's exactly what I wanted!",
    feedback_category: 'praise',
    confidence: 0.9,
  },
  {
    id: 'test-5',
    timestamp: '2025-01-21T10:00:00Z',
    session_id: 'session-2',
    project_path: '/test/project',
    event_type: 'explicit_preference',
    user_message: "Always use TypeScript strict mode.",
    feedback_category: 'explicit_preference',
    confidence: 0.95,
  },
];

/**
 * Mock feedback with insufficient entries for pattern extraction (only 2 similar)
 */
export const MOCK_FEEDBACK_INSUFFICIENT: FeedbackEntry[] = [
  {
    id: 'insuf-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Add error handling here.",
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'insuf-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: "Missing error handling.",
    feedback_category: 'correction',
    confidence: 0.82,
  },
  // Only 2 similar entries - not enough for default threshold of 3
];

/**
 * Mock feedback for agent performance testing
 */
export const MOCK_FEEDBACK_AGENTS: FeedbackEntry[] = [
  {
    id: 'agent-1',
    timestamp: '2025-01-20T10:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    original_task: 'Refactor the auth module',
    agent_used: 'oracle',
    user_message: 'Great work!',
    feedback_category: 'praise',
    confidence: 0.85,
  },
  {
    id: 'agent-2',
    timestamp: '2025-01-20T11:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Fix React component',
    agent_used: 'oracle',
    user_message: 'The React state handling is wrong.',
    feedback_category: 'correction',
    confidence: 0.88,
  },
  {
    id: 'agent-3',
    timestamp: '2025-01-20T12:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'success',
    original_task: 'Add tests',
    agent_used: 'olympian',
    user_message: 'Perfect!',
    feedback_category: 'praise',
    confidence: 0.9,
  },
  {
    id: 'agent-4',
    timestamp: '2025-01-20T13:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Build UI component',
    agent_used: 'frontend-engineer',
    user_message: 'Need to run shadcn add first.',
    feedback_category: 'correction',
    confidence: 0.85,
  },
  {
    id: 'agent-5',
    timestamp: '2025-01-20T14:00:00Z',
    session_id: 'session-1',
    project_path: '/test/project',
    event_type: 'revision',
    original_task: 'Style the form',
    agent_used: 'frontend-engineer',
    user_message: 'Forgot to install shadcn component.',
    feedback_category: 'correction',
    confidence: 0.82,
  },
];
```

```typescript
// src/__tests__/learning/agent-evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateAgentPerformance } from '../../learning/agent-evaluator.js';
import { MOCK_FEEDBACK_AGENTS } from './fixtures/mock-feedback.js';

describe('AgentEvaluator', () => {
  it('calculates success rate per agent', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const oracle = performance.get('oracle');
    expect(oracle).toBeDefined();
    expect(oracle?.total_invocations).toBe(2);
    expect(oracle?.success_count).toBe(1);
    expect(oracle?.revision_count).toBe(1);
    expect(oracle?.success_rate).toBe(0.5);
  });

  it('identifies failure patterns', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const frontendEngineer = performance.get('frontend-engineer');
    expect(frontendEngineer).toBeDefined();
    expect(frontendEngineer?.failure_patterns.length).toBeGreaterThan(0);
    // Both failures mention "shadcn"
  });

  it('identifies weak areas', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const oracle = performance.get('oracle');
    expect(oracle?.weak_areas.length).toBeGreaterThanOrEqual(0);
  });

  it('handles agents with no failures', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const olympian = performance.get('olympian');
    expect(olympian).toBeDefined();
    expect(olympian?.success_rate).toBe(1);
    expect(olympian?.failure_patterns).toHaveLength(0);
  });

  it('ignores feedback without agent_used', () => {
    const feedbackWithoutAgent = [
      { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'success' as const, user_message: 'Thanks', feedback_category: 'praise' as const, confidence: 0.9 },
    ];

    const performance = evaluateAgentPerformance(feedbackWithoutAgent);
    expect(performance.size).toBe(0);
  });
});
```

```typescript
// src/__tests__/learning/session-state.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getSessionStatePath,
  createSessionState,
  loadSessionState,
  saveSessionState,
  addPromptToSession,
  markCompletionClaim,
  clearCompletionClaim,
  hasPendingCompletion,
} from '../../learning/session-state.js';

describe('SessionState', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-session-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  describe('createSessionState', () => {
    it('creates fresh state with UUID', () => {
      const state = createSessionState();

      expect(state.session_id).toBeDefined();
      expect(state.session_id.length).toBeGreaterThan(0);
      expect(state.recent_prompts).toEqual([]);
      expect(state.pending_completion).toBeNull();
    });

    it('uses provided session ID', () => {
      const state = createSessionState('custom-id-123');

      expect(state.session_id).toBe('custom-id-123');
    });
  });

  describe('loadSessionState', () => {
    it('returns fresh state for new directory', () => {
      const state = loadSessionState(tempDir);

      expect(state.recent_prompts).toEqual([]);
      expect(state.pending_completion).toBeNull();
    });

    it('loads existing state from file', () => {
      // Create and save a state
      const original = createSessionState('test-session');
      original.recent_prompts = [{ prompt: 'test', timestamp: new Date().toISOString() }];
      saveSessionState(tempDir, original);

      // Load it back
      const loaded = loadSessionState(tempDir);

      expect(loaded.session_id).toBe('test-session');
      expect(loaded.recent_prompts).toHaveLength(1);
    });

    it('creates fresh state on timeout', () => {
      // Create state with old timestamp
      const old = createSessionState('old-session');
      old.last_updated = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      saveSessionState(tempDir, old);

      // Load should create fresh state
      const loaded = loadSessionState(tempDir);

      expect(loaded.session_id).not.toBe('old-session');
      expect(loaded.recent_prompts).toEqual([]);
    });
  });

  describe('addPromptToSession', () => {
    it('adds prompt to recent_prompts', () => {
      let state = createSessionState();
      state = addPromptToSession(state, 'First prompt');
      state = addPromptToSession(state, 'Second prompt');

      expect(state.recent_prompts).toHaveLength(2);
      expect(state.recent_prompts[0].prompt).toBe('Second prompt'); // Most recent first
    });

    it('limits to MAX_RECENT_PROMPTS (10)', () => {
      let state = createSessionState();

      for (let i = 0; i < 15; i++) {
        state = addPromptToSession(state, `Prompt ${i}`);
      }

      expect(state.recent_prompts).toHaveLength(10);
      expect(state.recent_prompts[0].prompt).toBe('Prompt 14'); // Most recent
    });

    it('records detected feedback category', () => {
      let state = createSessionState();
      state = addPromptToSession(state, 'No, that is wrong', 'correction');

      expect(state.recent_prompts[0].detected_feedback).toBe('correction');
    });
  });

  describe('completion claims', () => {
    it('marks completion claim', () => {
      let state = createSessionState();
      state = markCompletionClaim(state, 'Fix the bug', 'olympian');

      expect(state.pending_completion).toBeDefined();
      expect(state.pending_completion?.task_description).toBe('Fix the bug');
      expect(state.pending_completion?.agent_used).toBe('olympian');
    });

    it('clears completion claim', () => {
      let state = createSessionState();
      state = markCompletionClaim(state, 'Task', 'agent');
      state = clearCompletionClaim(state);

      expect(state.pending_completion).toBeNull();
    });

    it('hasPendingCompletion returns true for recent claim', () => {
      let state = createSessionState();
      state = markCompletionClaim(state, 'Task', 'agent');

      expect(hasPendingCompletion(state)).toBe(true);
    });

    it('hasPendingCompletion returns false for stale claim (>5 min)', () => {
      let state = createSessionState();
      state = markCompletionClaim(state, 'Task', 'agent');
      state.pending_completion!.claimed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      expect(hasPendingCompletion(state)).toBe(false);
    });
  });
});
```

```typescript
// src/__tests__/learning/learned-context.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock - declare mutable variable for tempDir
const mockPaths = vi.hoisted(() => {
  return { tempDir: '' };
});

// Mock storage module at module level (hoisted automatically)
vi.mock('../../learning/storage.js', async () => {
  const actual = await vi.importActual('../../learning/storage.js');
  return {
    ...actual,
    getLearningDir: () => join(mockPaths.tempDir, 'learning'),
    getProjectLearningDir: (p: string) => join(p, '.olympus', 'learning'),
  };
});

import { generateLearnedContext } from '../../learning/hooks/learned-context.js';
import { writeJsonFile } from '../../learning/storage.js';
import type { UserPreferences, AgentPerformance, ProjectPatterns } from '../../learning/types.js';

describe('LearnedContext', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-context-test-'));
    // Update the hoisted mock value
    mockPaths.tempDir = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('returns empty string when no learnings exist', () => {
    const context = generateLearnedContext(tempDir);
    expect(context).toBe('');
  });

  it('includes user preferences in context', () => {
    const prefs: UserPreferences = {
      verbosity: 'concise',
      autonomy: 'ask_first',
      explanation_depth: 'unknown',
      explicit_rules: ['Always use TypeScript'],
      inferred_preferences: [],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    };

    writeJsonFile(join(tempDir, 'learning', 'user-preferences.json'), prefs);

    const context = generateLearnedContext(tempDir);

    expect(context).toContain('<learned-context>');
    expect(context).toContain('Verbosity: concise');
    expect(context).toContain('Always use TypeScript');
  });

  it('includes recurring corrections', () => {
    const prefs: UserPreferences = {
      verbosity: 'unknown',
      autonomy: 'unknown',
      explanation_depth: 'unknown',
      explicit_rules: [],
      inferred_preferences: [],
      recurring_corrections: [
        { pattern: 'Add error handling', count: 4, last_seen: '', examples: [] },
        { pattern: 'Run tests first', count: 3, last_seen: '', examples: [] },
      ],
      last_updated: new Date().toISOString(),
    };

    writeJsonFile(join(tempDir, 'learning', 'user-preferences.json'), prefs);

    const context = generateLearnedContext(tempDir);

    expect(context).toContain('Avoid These Mistakes');
    expect(context).toContain('Add error handling');
    expect(context).toContain('(4x)');
  });

  it('includes agent weak areas', () => {
    const agentPerf: Record<string, AgentPerformance> = {
      'frontend-engineer': {
        agent_name: 'frontend-engineer',
        total_invocations: 10,
        success_count: 7,
        revision_count: 3,
        cancellation_count: 0,
        success_rate: 0.7,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: ['shadcn components', 'styling'],
        last_updated: new Date().toISOString(),
      },
    };

    writeJsonFile(join(tempDir, 'learning', 'agent-performance.json'), agentPerf);

    const context = generateLearnedContext(tempDir);

    expect(context).toContain('Agent Notes');
    expect(context).toContain('frontend-engineer');
    expect(context).toContain('shadcn components');
  });

  it('limits context to ~500 tokens', () => {
    // Create lots of preferences
    const prefs: UserPreferences = {
      verbosity: 'concise',
      autonomy: 'ask_first',
      explanation_depth: 'thorough',
      explicit_rules: Array(50).fill('This is a very long rule that should be included'),
      inferred_preferences: Array(50).fill('This is a very long inferred preference'),
      recurring_corrections: Array(50).fill({ pattern: 'A'.repeat(100), count: 5, last_seen: '', examples: [] }),
      last_updated: new Date().toISOString(),
    };

    writeJsonFile(join(tempDir, 'learning', 'user-preferences.json'), prefs);

    const context = generateLearnedContext(tempDir);

    // ~500 tokens ≈ 2000 characters
    expect(context.length).toBeLessThan(2500);
  });
});
```

**Deliverables**:
- [ ] Unit tests for all learning modules
- [ ] Integration tests for hook chain
- [ ] Mock feedback data fixtures
- [ ] Test coverage >80%

**Verification**: `npm run test:coverage`

---

### Task 5.3: Configuration

**File**: `src/shared/types.ts`

Add learning configuration to `PluginConfig`:

```typescript
// Add to PluginConfig interface (after line ~90)
learning?: {
  /** Enable the learning system (default: true) */
  enabled?: boolean;
  /** Enable context injection at session start (default: true) */
  contextInjection?: boolean;
  /** Maximum tokens for injected context (default: 500) */
  maxContextTokens?: number;
  /** Minimum occurrences before learning a pattern (default: 3) */
  minPatternOccurrences?: number;
  /** Days before preferences decay (default: 30) */
  preferenceDecayDays?: number;
};
```

**Deliverables**:
- [ ] Add learning config to PluginConfig
- [ ] Default values in config loader
- [ ] Config validation

---

## File Structure Summary (REVISED)

```
src/
├── learning/
│   ├── index.ts                 # Main exports
│   ├── types.ts                 # Type definitions (HookInput, SessionState, etc.)
│   ├── storage.ts               # Data storage utilities
│   ├── session-state.ts         # Session state manager
│   ├── pattern-extractor.ts     # Pattern analysis (Jaccard similarity)
│   ├── preference-learner.ts    # Preference inference
│   ├── agent-evaluator.ts       # Agent performance tracking
│   ├── prompt-patcher.ts        # Prompt improvement suggestions
│   └── hooks/
│       ├── revision-detector.ts # UserPromptSubmit hook logic
│       ├── cancellation-detector.ts # Stop hook logic
│       ├── success-detector.ts  # Success pattern recognition
│       └── learned-context.ts   # SessionStart context injection
│
├── cli/
│   └── index.ts                 # ADD: learn and feedback commands (inline)
│
├── installer/
│   └── hooks.ts                 # ADD: new hook scripts and settings
│
├── shared/
│   └── types.ts                 # ADD: learning config to PluginConfig
│
└── __tests__/
    └── learning/
        ├── storage.test.ts
        ├── session-state.test.ts
        ├── revision-detector.test.ts
        ├── cancellation-detector.test.ts
        ├── success-detector.test.ts
        ├── pattern-extractor.test.ts
        ├── preference-learner.test.ts
        ├── agent-evaluator.test.ts
        ├── learned-context.test.ts
        ├── discovery.test.ts
        ├── discovery-validator.test.ts
        └── fixtures/
            └── mock-feedback.ts

~/.claude/olympus/
└── learning/
    ├── feedback-log.jsonl       # Append-only feedback log
    ├── user-preferences.json    # Learned preferences
    ├── agent-performance.json   # Agent success/failure rates
    └── prompt-patches.json      # Applied patches log

.olympus/
├── session-state.json           # Per-session context (ephemeral)
└── learning/
    └── patterns.json            # Project-specific patterns
```

---

## Implementation Order

```
Phase 1 (Foundation)           Phase 2 (Analysis)           Phase 3 (Injection)
─────────────────────          ─────────────────────        ─────────────────────
1.1 Storage Module         ──► 2.1 Pattern Extractor    ──► 3.1 Context Injection
1.2 Session State Manager  ──► 2.2 Preference Learner
1.3 Revision Hook          ──► 2.3 Agent Evaluator      ──► 3.2 Prompt Patcher
1.4 Cancellation Hook
1.5 Success Hook

                              Phase 4 (CLI)               Phase 5 (Polish)
                              ─────────────────────       ─────────────────────
                              4.1 learn command       ──► 5.1 Hook Integration
                                  (in src/cli/index.ts)   5.2 Testing Suite
                                                          5.3 Configuration
```

---

## Phase 6: Agent Learning Capture (NEW)

**Objective**: Enable agents to record technical discoveries during work, preserving insights that would otherwise be lost. This replaces and enhances the manual `.olympus/notepads/` system.

### Task 6.1: Discovery Recording API

**File**: `src/learning/discovery.ts`

```typescript
import { join, dirname } from 'path';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { getLearningDir, getProjectLearningDir, ensureLearningDirs } from './storage.js';
import type { AgentDiscovery, DiscoveryCategory, DiscoverySummary } from './types.js';

/**
 * Record a discovery made by an agent during work.
 * This is the primary API for agents to capture learnings.
 */
export function recordDiscovery(
  discovery: Omit<AgentDiscovery, 'id' | 'timestamp' | 'verified' | 'verification_count' | 'last_useful'>
): AgentDiscovery {
  const entry: AgentDiscovery = {
    ...discovery,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    verified: false,
    verification_count: 0,
    last_useful: new Date().toISOString(),
  };

  // Determine storage location
  const storageDir = entry.scope === 'global'
    ? getLearningDir()
    : getProjectLearningDir(entry.project_path);

  ensureLearningDirs(entry.project_path);

  const filePath = join(storageDir, 'discoveries.jsonl');
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');

  return entry;
}

/**
 * Read all discoveries for a project (includes global discoveries).
 */
export function readDiscoveries(projectPath: string): DiscoverySummary {
  const globalPath = join(getLearningDir(), 'discoveries.jsonl');
  const projectDir = getProjectLearningDir(projectPath);
  const projectDiscoveriesPath = join(projectDir, 'discoveries.jsonl');

  const globalDiscoveries = readDiscoveryFile(globalPath);
  const projectDiscoveries = readDiscoveryFile(projectDiscoveriesPath);

  // Calculate statistics
  const all = [...globalDiscoveries, ...projectDiscoveries];
  const categories: Record<DiscoveryCategory, number> = {
    technical_insight: 0,
    workaround: 0,
    pattern: 0,
    gotcha: 0,
    performance: 0,
    dependency: 0,
    configuration: 0,
  };

  for (const d of all) {
    categories[d.category]++;
  }

  // Sort by verification count for most_useful
  const sorted = [...all].sort((a, b) => b.verification_count - a.verification_count);

  return {
    project_discoveries: projectDiscoveries,
    global_discoveries: globalDiscoveries,
    total_discoveries: all.length,
    categories,
    most_useful: sorted.slice(0, 5),
  };
}

/**
 * Mark a discovery as useful (increments verification_count).
 */
export function markDiscoveryUseful(discoveryId: string, projectPath: string): void {
  const globalPath = join(getLearningDir(), 'discoveries.jsonl');
  const projectLearningPath = join(projectPath, '.olympus', 'learning', 'discoveries.jsonl');

  // Helper to update discoveries in a JSONL file
  const updateFile = (filePath: string): boolean => {
    if (!existsSync(filePath)) return false;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    let found = false;

    const updated = lines.map(line => {
      try {
        const discovery = JSON.parse(line) as AgentDiscovery;
        if (discovery.id === discoveryId) {
          found = true;
          discovery.verification_count = (discovery.verification_count || 0) + 1;
          discovery.last_useful = new Date().toISOString();
        }
        return JSON.stringify(discovery);
      } catch {
        return line; // Keep malformed lines as-is
      }
    });

    if (found) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, updated.join('\n') + '\n', 'utf-8');
    }
    return found;
  };

  // Try project-specific first, then global
  if (!updateFile(projectLearningPath)) {
    updateFile(globalPath);
  }
}

/**
 * Get discoveries relevant for context injection.
 * Returns top discoveries filtered by recency and usefulness.
 */
export function getDiscoveriesForInjection(
  projectPath: string,
  maxCount: number = 10
): AgentDiscovery[] {
  const summary = readDiscoveries(projectPath);
  const all = [...summary.project_discoveries, ...summary.global_discoveries];

  // Filter out expired discoveries
  const now = new Date();
  const active = all.filter(d => {
    if (!d.expires_at) return true;
    return new Date(d.expires_at) > now;
  });

  // Score by: verification_count * recency_factor
  const scored = active.map(d => {
    const age = (now.getTime() - new Date(d.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    const recencyFactor = Math.max(0.1, 1 - (age / 90)); // Decay over 90 days
    const score = (d.verification_count + 1) * recencyFactor * d.confidence;
    return { discovery: d, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxCount).map(s => s.discovery);
}

function readDiscoveryFile(filePath: string): AgentDiscovery[] {
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as AgentDiscovery);
  } catch (error) {
    console.error(`[Olympus Learning] Failed to read discoveries: ${error}`);
    return [];
  }
}
```

**Deliverables**:
- [ ] `recordDiscovery()` function for agents to capture learnings
- [ ] `readDiscoveries()` to retrieve all discoveries
- [ ] `markDiscoveryUseful()` to track which discoveries are helpful
- [ ] `getDiscoveriesForInjection()` for context injection

**Verification**: `npx vitest run src/__tests__/learning/discovery.test.ts`

---

### Task 6.2: Agent Integration

**File**: `src/agents/definitions.ts` (update agent prompts)

Add to agent system prompts (olympian, oracle, etc.):

```markdown
## Recording Discoveries

When you learn something useful during your work, record it:

\`\`\`typescript
// In your task completion, call:
recordDiscovery({
  category: 'gotcha',  // technical_insight, workaround, pattern, gotcha, performance, dependency, configuration
  summary: 'Migration must run before seeding database',
  details: 'The seed script assumes tables exist. Running `prisma db seed` before `prisma migrate dev` causes foreign key errors.',
  agent_name: 'olympian',
  session_id: context.sessionId,
  project_path: context.directory,
  task_context: 'Setting up development database',
  files_involved: ['prisma/seed.ts', 'prisma/schema.prisma'],
  confidence: 0.9,
  scope: 'project',  // 'global' for cross-project learnings
});
\`\`\`

**Record discoveries for**:
- API quirks or undocumented behavior
- Build system gotchas
- Performance optimizations you discovered
- Required configuration that wasn't obvious
- Dependency version conflicts and resolutions
- Patterns specific to this codebase
```

**Deliverables**:
- [ ] Update olympian agent prompt
- [ ] Update oracle agent prompt
- [ ] Update other relevant agent prompts
- [ ] Add discovery recording to agent task completion hooks

---

### Task 6.3: Discovery Validator

**File**: `src/learning/discovery-validator.ts`

```typescript
import type { AgentDiscovery } from './types.js';

/**
 * Validate and deduplicate discoveries before storage.
 */
export function validateDiscovery(discovery: AgentDiscovery): { valid: boolean; reason?: string } {
  // Check required fields
  if (!discovery.summary || discovery.summary.length < 10) {
    return { valid: false, reason: 'Summary too short (min 10 chars)' };
  }

  if (discovery.summary.length > 100) {
    return { valid: false, reason: 'Summary too long (max 100 chars)' };
  }

  if (!discovery.details || discovery.details.length < 20) {
    return { valid: false, reason: 'Details too short (min 20 chars)' };
  }

  if (discovery.confidence < 0.5) {
    return { valid: false, reason: 'Confidence too low (min 0.5)' };
  }

  return { valid: true };
}

/**
 * Check if a discovery is a duplicate of an existing one.
 */
export function isDuplicateDiscovery(
  newDiscovery: AgentDiscovery,
  existingDiscoveries: AgentDiscovery[]
): AgentDiscovery | null {
  // Simple similarity check based on summary
  const newSummaryLower = newDiscovery.summary.toLowerCase();

  for (const existing of existingDiscoveries) {
    const existingSummaryLower = existing.summary.toLowerCase();

    // Check for high similarity (>80% word overlap)
    const newWords = new Set(newSummaryLower.split(/\s+/));
    const existingWords = new Set(existingSummaryLower.split(/\s+/));
    const intersection = [...newWords].filter(w => existingWords.has(w));
    const similarity = intersection.length / Math.max(newWords.size, existingWords.size);

    if (similarity > 0.8) {
      return existing;
    }
  }

  return null;
}

/**
 * Merge a new discovery with an existing similar one.
 */
export function mergeDiscoveries(
  existing: AgentDiscovery,
  newDiscovery: AgentDiscovery
): AgentDiscovery {
  return {
    ...existing,
    // Keep higher confidence
    confidence: Math.max(existing.confidence, newDiscovery.confidence),
    // Merge details if new one is longer
    details: newDiscovery.details.length > existing.details.length
      ? newDiscovery.details
      : existing.details,
    // Merge files involved
    files_involved: [...new Set([
      ...(existing.files_involved || []),
      ...(newDiscovery.files_involved || [])
    ])],
    // Increment verification count (this confirms the discovery)
    verification_count: existing.verification_count + 1,
    last_useful: new Date().toISOString(),
  };
}
```

**Deliverables**:
- [ ] `validateDiscovery()` for input validation
- [ ] `isDuplicateDiscovery()` for deduplication
- [ ] `mergeDiscoveries()` for combining similar discoveries

**Verification**: `npx vitest run src/__tests__/learning/discovery-validator.test.ts`

---

### Task 6.4: Context Injection Update

**File**: `src/learning/hooks/learned-context.ts` (update existing)

Add discoveries to the injected context:

```typescript
// Add to buildLearnedContext() function
function buildLearnedContext(projectPath: string): string {
  // ... existing code for preferences, corrections, patterns ...

  // NEW: Add discoveries
  const discoveries = getDiscoveriesForInjection(projectPath, 5);

  if (discoveries.length > 0) {
    sections.push(`## Agent Discoveries

These insights were discovered during previous work on this project:

${discoveries.map(d => `- **${d.category}**: ${d.summary}
  ${d.details}`).join('\n\n')}`);
  }

  return sections.join('\n\n');
}
```

**Deliverables**:
- [ ] Update `buildLearnedContext()` to include discoveries
- [ ] Ensure discoveries don't exceed token budget (prioritize by score)

---

### Task 6.5: Migration from Notepads

**File**: `src/learning/migrate-notepads.ts`

```typescript
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { recordDiscovery } from './discovery.js';

/**
 * Migrate existing notepad content to discoveries.
 * This is a one-time migration utility.
 */
export async function migrateNotepads(projectPath: string): Promise<number> {
  const notepadsDir = join(projectPath, '.olympus', 'notepads');

  if (!existsSync(notepadsDir)) {
    return 0;
  }

  let migratedCount = 0;

  // Recursively find all .md files
  const planDirs = readdirSync(notepadsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const planDir of planDirs) {
    const planPath = join(notepadsDir, planDir);
    const files = readdirSync(planPath).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(planPath, file), 'utf-8');

      // Parse markdown sections into discoveries
      const discoveries = parseNotepadContent(content, planDir);

      for (const d of discoveries) {
        recordDiscovery({
          ...d,
          session_id: 'migration',
          project_path: projectPath,
          agent_name: 'migration',
          confidence: 0.7, // Lower confidence for migrated content
          scope: 'project',
        });
        migratedCount++;
      }
    }
  }

  return migratedCount;
}

function parseNotepadContent(content: string, taskContext: string): Partial<AgentDiscovery>[] {
  // Simple parsing: each H3 (###) becomes a discovery
  const sections = content.split(/^### /m).slice(1);

  return sections.map(section => {
    const lines = section.split('\n');
    const summary = lines[0].trim().slice(0, 100);
    const details = lines.slice(1).join('\n').trim();

    return {
      category: inferCategory(summary, details) as any,
      summary,
      details,
      task_context: taskContext,
    };
  });
}

function inferCategory(summary: string, details: string): string {
  const text = (summary + ' ' + details).toLowerCase();

  if (text.includes('performance') || text.includes('slow') || text.includes('optimize')) {
    return 'performance';
  }
  if (text.includes('workaround') || text.includes('hack') || text.includes('fix')) {
    return 'workaround';
  }
  if (text.includes('pattern') || text.includes('convention') || text.includes('style')) {
    return 'pattern';
  }
  if (text.includes('gotcha') || text.includes('careful') || text.includes('warning')) {
    return 'gotcha';
  }
  if (text.includes('dependency') || text.includes('package') || text.includes('install')) {
    return 'dependency';
  }
  if (text.includes('config') || text.includes('environment') || text.includes('setting')) {
    return 'configuration';
  }

  return 'technical_insight';
}
```

**CLI Command** (add to `src/cli/index.ts`):

```typescript
program
  .command('migrate-notepads')
  .description('Migrate .olympus/notepads/ content to learning system')
  .action(async () => {
    const projectPath = process.cwd();
    const count = await migrateNotepads(projectPath);
    console.log(`Migrated ${count} discoveries from notepads`);
  });
```

**Deliverables**:
- [ ] `migrateNotepads()` utility function
- [ ] `olympus migrate-notepads` CLI command
- [ ] Notepad content parser

**Verification**:
- Create test notepad content
- Run migration
- Verify discoveries appear in `olympus learn --show`

---

### Task 6.6: Tests for Discovery System

**File**: `src/__tests__/learning/discovery.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock - declare mutable variable for tempDir
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

// Mock os module at module level (hoisted automatically)
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  recordDiscovery,
  readDiscoveries,
  getDiscoveriesForInjection,
} from '../../learning/discovery.js';

describe('discovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-discovery-test-'));
    // Update the hoisted mock value
    mockHomedir.value = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('records a discovery to project storage', () => {
    const discovery = recordDiscovery({
      category: 'gotcha',
      summary: 'Test discovery summary',
      details: 'Detailed explanation of the discovery',
      agent_name: 'test-agent',
      session_id: 'test-session',
      project_path: tempDir,
      confidence: 0.9,
      scope: 'project',
    });

    expect(discovery.id).toBeDefined();
    expect(discovery.timestamp).toBeDefined();

    const filePath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.summary).toBe('Test discovery summary');
  });

  it('reads discoveries for a project', () => {
    // Record a few discoveries
    recordDiscovery({
      category: 'pattern',
      summary: 'Uses kebab-case for files',
      details: 'All files in src/ use kebab-case naming',
      agent_name: 'test',
      session_id: 'test',
      project_path: tempDir,
      confidence: 0.8,
      scope: 'project',
    });

    recordDiscovery({
      category: 'workaround',
      summary: 'Build requires NODE_ENV',
      details: 'Must set NODE_ENV=development for local builds',
      agent_name: 'test',
      session_id: 'test',
      project_path: tempDir,
      confidence: 0.9,
      scope: 'project',
    });

    const summary = readDiscoveries(tempDir);

    expect(summary.total_discoveries).toBe(2);
    expect(summary.project_discoveries).toHaveLength(2);
    expect(summary.categories.pattern).toBe(1);
    expect(summary.categories.workaround).toBe(1);
  });

  it('returns top discoveries for injection', () => {
    // Record discoveries with different confidence/verification
    for (let i = 0; i < 15; i++) {
      recordDiscovery({
        category: 'technical_insight',
        summary: `Discovery ${i}`,
        details: `Details for discovery ${i}`,
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.5 + (i * 0.03),
        scope: 'project',
      });
    }

    const forInjection = getDiscoveriesForInjection(tempDir, 5);

    expect(forInjection).toHaveLength(5);
    // Higher confidence discoveries should be first
    expect(forInjection[0].confidence).toBeGreaterThan(forInjection[4].confidence);
  });
});
```

**Deliverables**:
- [ ] Test for recording discoveries
- [ ] Test for reading discoveries
- [ ] Test for injection selection
- [ ] Test for deduplication
- [ ] Test for migration

**Verification**: `npx vitest run src/__tests__/learning/discovery.test.ts`

---

## Phase Verification Checklist

### Phase 1 Complete When:
- [ ] `npx vitest run src/__tests__/learning/storage.test.ts` passes
- [ ] `npx vitest run src/__tests__/learning/session-state.test.ts` passes
- [ ] `npx vitest run src/__tests__/learning/revision-detector.test.ts` passes
- [ ] Manual test: Send "No, that's wrong" message, check `~/.claude/olympus/learning/feedback-log.jsonl`

### Phase 2 Complete When:
- [ ] `npx vitest run src/__tests__/learning/pattern-extractor.test.ts` passes
- [ ] `npx vitest run src/__tests__/learning/preference-learner.test.ts` passes
- [ ] `npx vitest run src/__tests__/learning/agent-evaluator.test.ts` passes
- [ ] Manual test: `olympus learn --analyze` produces output

### Phase 3 Complete When:
- [ ] `npx vitest run src/__tests__/learning/learned-context.test.ts` passes
- [ ] Manual test: Start new session, verify `<learned-context>` appears in system prompt
- [ ] Manual test: `olympus learn --suggest` shows patches

### Phase 4 Complete When:
- [ ] `npm run build` succeeds
- [ ] `olympus learn --show` displays formatted output
- [ ] `olympus learn --analyze` updates preferences
- [ ] `olympus feedback "test rule"` logs entry
- [ ] `olympus learn --export | olympus learn --import /dev/stdin` round-trips

### Phase 5 Complete When:
- [ ] `npm run test:coverage` shows >80% coverage for learning/
- [ ] `olympus install --force` succeeds
- [ ] New hooks appear in `~/.claude/settings.local.json`
- [ ] Full integration test: feedback → analyze → inject context works end-to-end

### Phase 6 Complete When:
- [ ] `npx vitest run src/__tests__/learning/discovery.test.ts` passes
- [ ] `npx vitest run src/__tests__/learning/discovery-validator.test.ts` passes
- [ ] Agents can call `recordDiscovery()` during task execution
- [ ] Discoveries appear in `olympus learn --show` output
- [ ] Discoveries are injected in session-start context
- [ ] `olympus migrate-notepads` successfully migrates existing notepad content
- [ ] Manual test: Complete a task, verify agent records a discovery

---

## Success Criteria (REVISED with Measurement Methods)

| Criterion | Target | Measurement Method |
|-----------|--------|-------------------|
| Feedback capture rate | >90% | `olympus learn --show` should show capture for >9/10 explicit corrections in test session |
| Pattern accuracy | >80% | Run `olympus learn --analyze`, then have user validate suggested patterns |
| Performance improvement | >10% | Compare agent success rates before/after learning via `olympus learn --show` |
| Context size | <500 tokens | Check `<learned-context>` block size in session start output |
| Privacy compliance | 100% | `olympus learn --forget` completely removes all files in learning directories |
| Discovery capture rate | >50% | Agents should record discoveries for >5/10 non-trivial tasks (NEW) |
| Discovery usefulness | >70% | User validation: >7/10 injected discoveries are relevant/helpful (NEW) |

---

## Risks & Mitigations (UNCHANGED)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Over-fitting to one-off corrections | Wrong lessons learned | Require 3+ occurrences before learning |
| Context injection bloat | Slow responses, high token cost | Limit injection to <500 tokens |
| Privacy concerns | User distrust | Clear docs, easy opt-out, local-only storage |
| Stale learnings | Outdated preferences applied | Preference decay (30 days), manual refresh |
| Conflicting learnings | Contradictory instructions | Contradiction detection, mark as unknown |

---

## Open Questions (UNCHANGED)

1. **Should learnings sync across machines?** (e.g., via Claude account) - Deferred to v2
2. **Should there be a "learning mode" toggle?** - Added as config option
3. **How to handle team projects?** (shared vs personal learnings) - Deferred to v2

---

## Error Handling Patterns

Each module must handle errors gracefully to prevent learning system failures from affecting the main conversation.

### Storage Module (`src/learning/storage.ts`)

```typescript
// File read errors - return default value
export function readJsonFile<T>(path: string, defaultValue: T): T {
  try {
    if (!existsSync(path)) return defaultValue;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (error) {
    console.error(`[Olympus Learning] Failed to read ${path}:`, error);
    return defaultValue;
  }
}

// File write errors - log and continue
export function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const dir = dirname(filePath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[Olympus Learning] Failed to write ${filePath}:`, error);
    // Don't throw - learning failures should not block main functionality
  }
}
```

### Hook Error Handling

All hooks MUST output `{ "continue": true }` even on error:

```typescript
async function main() {
  try {
    const input = await readStdin();
    const data = JSON.parse(input);
    await processHook(data);
  } catch (error) {
    // Log error but don't block the conversation
    console.error('[Olympus Learning]', error);
  } finally {
    // ALWAYS output continue: true
    console.log(JSON.stringify({ continue: true }));
  }
}
```

### Edge Cases Handled

| Scenario | Handling |
|----------|----------|
| Empty feedback log | Return empty array, don't throw |
| Corrupted JSON file | Log error, return default value |
| Missing directory | Create with `mkdirSync({ recursive: true })` |
| Hook stdin timeout | Catch error, output `{ continue: true }` |
| Invalid session state | Create fresh state, don't crash |
| Pattern extraction with no data | Return empty array |
| Preference learning with contradictions | Set to 'unknown', don't guess |

---

## Dependency Requirements

### NPM Packages Required

```json
{
  "dependencies": {
    // No new dependencies needed
  },
  "devDependencies": {
    "vitest": "^1.0.0"  // Already in project
  }
}
```

**No new dependencies required.** The learning system uses:
- Node.js built-ins only: `fs`, `path`, `os`, `crypto` (includes `randomUUID()` for UUID generation)

---

## Windows Compatibility Notes

All file operations use:
- `path.join()` for path construction (cross-platform separators)
- `path.dirname()` for parent directory extraction
- `os.homedir()` for user directory

**Verified patterns from existing codebase** (`src/installer/hooks.ts` lines 42-48):
```typescript
const claudeConfigDir = join(homedir(), '.claude');  // Works on Windows and Unix
```

---

*Plan APPROVED after Momus review. Confidence: 98% across all criteria. Ready for implementation.*
