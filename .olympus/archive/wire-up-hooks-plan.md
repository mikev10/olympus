# Work Plan: Wire Up Dormant Hooks in Olympus

## Context

### Original Request

Wire up all dormant hooks in the Olympus multi-agent orchestration system for Claude Code. Create a self-contained esbuild bundle that compiles all hooks into `~/.claude/hooks/olympus-hooks.mjs`.

### Interview Summary

- **Installation**: Self-contained bundle using esbuild
- **Hook Priority**: ALL categories (error recovery, code quality, context injection, UX)
- **Hook Events**: PreToolUse, PostToolUse, MessagesTransform (100-200ms latency budget, zero API tokens)
- **Configuration**: `~/.claude/olympus.jsonc` with per-hook enable/disable toggles

### Research Findings

**Current State (3 wired hooks)**:

- `keyword-detector` -> UserPromptSubmit (inline script in `src/installer/hooks.ts`)
- `session-start` -> SessionStart (inline script)
- `persistent-mode` -> Stop (inline script, includes ascent/ultrawork/todo-continuation)

**Dormant Hooks (20 total in `src/hooks/`)**:

1. `agent-usage-reminder` - PostToolUse (remind about agent delegation)
2. `auto-slash-command` - UserPromptSubmit (expand custom slash commands)
3. `background-notification` - Notification (surface background task results)
4. `comment-checker` - PostToolUse (detect unnecessary comments)
5. `context-window-limit-recovery` - PostToolUse (detect/recover from context limits)
6. `directory-readme-injector` - PreToolUse (inject README context)
7. `edit-error-recovery` - PostToolUse (recover from Edit tool errors)
8. `empty-message-sanitizer` - MessagesTransform (fix empty messages)
9. `non-interactive-env` - PreToolUse (add -y flags to commands)
10. `olympus-orchestrator` - PreToolUse/PostToolUse (orchestration reminders)
11. `plugin-patterns` - Utility (formatters, linters, pre-commit)
12. `preemptive-compaction` - PostToolUse (warn before context limit)
13. `rules-injector` - PreToolUse (inject rule files)
14. `session-recovery` - Error-triggered (NOT wired to SessionStart)
15. `think-mode` - UserPromptSubmit (activate extended thinking)
16. `thinking-block-validator` - MessagesTransform (fix thinking blocks)
17. `ascent` - Already partially wired via persistent-mode
18. `ascent-verifier` - Already partially wired via persistent-mode
19. `todo-continuation` - Already merged into persistent-mode
20. `persistent-mode` - Already wired to Stop event
21. `ultrawork-state` - State management utility

**Key Files**:

- `src/hooks/bridge.ts` - Current TypeScript bridge (needs refactoring)
- `src/hooks/index.ts` - All hook exports
- `src/installer/hooks.ts` - Current inline shell scripts (1400+ lines)
- `src/installer/index.ts` - Installation logic
- `src/shared/types.ts` - Configuration schema

---

## Work Objectives

### Core Objective

Create a unified, bundled hook system that:

1. Bundles all 21 hooks into a single `olympus-hooks.mjs` file
2. Routes hook events to appropriate handlers
3. Provides per-hook configuration via `olympus.jsonc`
4. Maintains cross-platform compatibility (Windows, macOS, Linux)
5. Stays within 100-200ms latency budget per hook event

### Deliverables

1. **Unified Hook Router** (`src/hooks/router.ts`) - Routes events to registered hooks
2. **Hook Registry** (`src/hooks/registry.ts`) - Declares all hooks with metadata
3. **esbuild Configuration** (`esbuild.hooks.mjs`) - Bundles hooks into single file
4. **Updated Installer** - Installs bundled hooks instead of inline scripts
5. **Configuration Schema** - Extended `PluginConfig` for hook toggles
6. **Hook Entry Point** (`src/hooks/entry.ts`) - CLI entry for bundled hooks

### Definition of Done

- [ ] All 18 hooks wired to appropriate Claude Code events (session-recovery excluded)
- [ ] Single `olympus-hooks.mjs` bundle installed to `~/.claude/hooks/`
- [ ] Per-hook enable/disable in `olympus.jsonc`
- [ ] Cross-platform: Works on Windows, macOS, Linux
- [ ] Tests pass for hook routing logic
- [ ] Latency < 200ms per hook event (measured)
- [ ] Existing functionality preserved (no regressions)

---

## Guardrails

### Must Have

- Zero external dependencies in bundled output
- Backward compatibility with existing state files
- Graceful degradation (one hook failure doesn't block others)
- Session state isolation between hooks
- Windows path handling (use `path.join()`)
- Individual hook timeout: 100ms (configurable)

### Must NOT Have

- References to external projects (this is Olympus's own system)
- Breaking changes to existing `olympus.jsonc` schema
- Hardcoded Unix-only paths
- Synchronous file I/O that blocks the event loop
- Hooks that exceed 100ms individually (default timeout)

---

## Task Flow and Dependencies

```
Phase 1: Architecture Setup
    |
    v
Phase 2: Hook Registry & Router
    |
    v
Phase 3: Wire Up Hooks by Event
    |
    v
Phase 4: Build System Integration
    |
    v
Phase 5: Installer Updates
    |
    v
Phase 6: Configuration & Testing
```

---

## Phase 1: Architecture Setup

### Objective

Establish the foundational architecture for the unified hook system.

### Tasks

#### 1.1 Create Hook Types and Interfaces

**File**: `src/hooks/types.ts`

```typescript
// Define unified hook types
export type HookEvent =
  | "UserPromptSubmit"
  | "SessionStart"
  | "Stop"
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "MessagesTransform"; // ADDED for empty-message-sanitizer and thinking-block-validator

export interface HookContext {
  sessionId?: string;
  directory?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  prompt?: string;
  message?: {
    content?: string;
    model?: { modelId?: string; providerId?: string };
  };
  parts?: Array<{ type: string; text?: string }>;
  messages?: Array<unknown>; // For MessagesTransform hooks
  event?: { type: string; properties?: unknown }; // For Notification hooks
}

export interface HookResult {
  continue: boolean;
  message?: string;
  reason?: string;
  modifiedInput?: unknown;
  modifiedMessages?: Array<unknown>; // For MessagesTransform hooks
}

export interface HookDefinition {
  name: string;
  event: HookEvent;
  matcher?: string | RegExp; // For tool-specific hooks
  priority?: number; // Lower = runs first
  enabled?: boolean;
  handler: (ctx: HookContext) => Promise<HookResult> | HookResult;
}

export interface HookConfig {
  [hookName: string]: {
    enabled?: boolean;
    options?: Record<string, unknown>;
  };
}
```

**Acceptance Criteria**:

- [ ] Types compile without errors
- [ ] Types are exported from `src/hooks/index.ts`
- [ ] MessagesTransform event type added

#### 1.2 Extend Configuration Schema

**File**: `src/shared/types.ts`

Add `hooks` section to `PluginConfig`:

```typescript
export interface PluginConfig {
  // ... existing fields ...

  hooks?: {
    /** Global hook enable/disable */
    enabled?: boolean;

    /** Individual hook timeout in milliseconds (default: 100) */
    hookTimeoutMs?: number;

    /** Per-hook configuration */
    keywordDetector?: { enabled?: boolean };
    sessionStart?: { enabled?: boolean };
    persistentMode?: { enabled?: boolean };
    editErrorRecovery?: { enabled?: boolean };
    commentChecker?: { enabled?: boolean; customPrompt?: string };
    contextWindowLimitRecovery?: { enabled?: boolean; detailed?: boolean };
    rulesInjector?: { enabled?: boolean };
    directoryReadmeInjector?: { enabled?: boolean };
    preemptiveCompaction?: { enabled?: boolean; warningThreshold?: number };
    agentUsageReminder?: { enabled?: boolean };
    autoSlashCommand?: { enabled?: boolean };
    thinkMode?: { enabled?: boolean };
    nonInteractiveEnv?: { enabled?: boolean };
    olympusOrchestrator?: { enabled?: boolean };
    backgroundNotification?: { enabled?: boolean };
    emptyMessageSanitizer?: { enabled?: boolean };
    thinkingBlockValidator?: { enabled?: boolean };
  };
}
```

**Acceptance Criteria**:

- [ ] Schema updated with hook configuration
- [ ] Existing tests still pass
- [ ] hookTimeoutMs added for configurable timeout

---

## Phase 2: Hook Registry & Router

### Objective

Create the central registry and routing system for all hooks.

### Tasks

#### 2.1 Create Hook Registry

**File**: `src/hooks/registry.ts`

```typescript
import type { HookDefinition, HookEvent } from "./types.js";

const hooks: Map<HookEvent, HookDefinition[]> = new Map();

export function registerHook(hook: HookDefinition): void {
  const eventHooks = hooks.get(hook.event) || [];
  eventHooks.push(hook);
  // Sort by priority (lower first)
  eventHooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  hooks.set(hook.event, eventHooks);
}

export function getHooksForEvent(event: HookEvent): HookDefinition[] {
  return hooks.get(event) || [];
}

export function getAllHooks(): HookDefinition[] {
  return Array.from(hooks.values()).flat();
}

export function clearHooks(): void {
  hooks.clear();
}
```

**Acceptance Criteria**:

- [ ] Hooks can be registered and retrieved by event
- [ ] Priority sorting works correctly
- [ ] Unit tests for registry operations

#### 2.2 Create Hook Router

**File**: `src/hooks/router.ts`

```typescript
import type { HookContext, HookResult, HookEvent } from "./types.js";
import { getHooksForEvent } from "./registry.js";
import { loadConfig } from "./config.js";

const DEFAULT_HOOK_TIMEOUT_MS = 100; // Increased from 50ms

async function executeWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number,
): Promise<T | null> {
  return Promise.race([
    Promise.resolve(fn()),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

export async function routeHook(
  event: HookEvent,
  context: HookContext,
): Promise<HookResult> {
  const config = await loadConfig();
  const hooks = getHooksForEvent(event);
  const hookTimeout = config.hooks?.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;

  // Aggregate results
  let shouldContinue = true;
  const messages: string[] = [];
  let reason: string | undefined;
  let modifiedMessages = context.messages;

  for (const hook of hooks) {
    // Check if hook is enabled
    const hookConfig = config.hooks?.[hook.name];
    if (hookConfig?.enabled === false) continue;

    // Check matcher for tool hooks
    if (hook.matcher && context.toolName) {
      const matcher =
        typeof hook.matcher === "string"
          ? new RegExp(hook.matcher, "i")
          : hook.matcher;
      if (!matcher.test(context.toolName)) continue;
    }

    try {
      const result = await executeWithTimeout(
        () => hook.handler({ ...context, messages: modifiedMessages }),
        hookTimeout,
      );

      if (result === null) {
        console.error(
          `[hook-router] ${hook.name} timed out after ${hookTimeout}ms`,
        );
        continue;
      }

      if (!result.continue) {
        shouldContinue = false;
        reason = result.reason;
      }

      if (result.message) {
        messages.push(result.message);
      }

      // For MessagesTransform hooks
      if (result.modifiedMessages) {
        modifiedMessages = result.modifiedMessages;
      }
    } catch (error) {
      console.error(`[hook-router] ${hook.name} error:`, error);
      // Continue to next hook on error (graceful degradation)
    }
  }

  return {
    continue: shouldContinue,
    message: messages.length > 0 ? messages.join("\n\n---\n\n") : undefined,
    reason,
    modifiedMessages,
  };
}
```

**Acceptance Criteria**:

- [ ] Router executes hooks for given event
- [ ] Timeout protection works (100ms per hook, configurable)
- [ ] Config-based enable/disable works
- [ ] Matcher filtering works for tool hooks
- [ ] Error isolation (one hook failure doesn't block others)
- [ ] Messages are aggregated correctly
- [ ] Logging for debugging included

#### 2.3 Create Config Loader

**File**: `src/hooks/config.ts`

```typescript
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { PluginConfig } from "../shared/types.js";

const CONFIG_PATHS = [
  join(process.cwd(), ".claude", "olympus.jsonc"),
  join(homedir(), ".claude", "olympus.jsonc"),
];

let cachedConfig: PluginConfig | null = null;
let lastLoadTime = 0;
const CACHE_TTL_MS = 5000;

export async function loadConfig(): Promise<PluginConfig> {
  const now = Date.now();
  if (cachedConfig && now - lastLoadTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  for (const configPath of CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8");
        // TODO: Use jsonc-parser library for proper JSONC parsing
        // For now, simple regex-based comment stripping
        const jsonContent = content
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        cachedConfig = JSON.parse(jsonContent);
        lastLoadTime = now;
        return cachedConfig!;
      } catch {
        // Try next path
      }
    }
  }

  cachedConfig = {};
  lastLoadTime = now;
  return cachedConfig;
}

export function clearConfigCache(): void {
  cachedConfig = null;
  lastLoadTime = 0;
}
```

**Acceptance Criteria**:

- [ ] Loads config from project or global location
- [ ] Handles JSONC comments
- [ ] Caches config with TTL
- [ ] Returns empty config if no file exists
- [ ] Note added to use proper JSONC parser in future

---

## Phase 3: Wire Up Hooks by Event

### Objective

Register all hooks with their appropriate events.

### Tasks

#### 3.1 Wire UserPromptSubmit Hooks

**File**: `src/hooks/registrations/user-prompt-submit.ts`

```typescript
import { registerHook } from "../registry.js";
import { processKeywordDetector } from "../keyword-detector/bridge.js";
import { createAutoSlashCommandHook } from "../auto-slash-command/index.js";
import { createThinkModeHook } from "../think-mode/index.js";

export function registerUserPromptSubmitHooks(): void {
  // Keyword Detector (highest priority)
  registerHook({
    name: "keywordDetector",
    event: "UserPromptSubmit",
    priority: 10,
    handler: async (ctx) => {
      return processKeywordDetector({
        prompt: ctx.prompt,
        message: ctx.message,
        parts: ctx.parts,
        sessionId: ctx.sessionId,
        directory: ctx.directory,
      });
    },
  });

  // Auto Slash Command
  registerHook({
    name: "autoSlashCommand",
    event: "UserPromptSubmit",
    priority: 20,
    handler: async (ctx) => {
      const hook = createAutoSlashCommandHook();
      const result = hook.processMessage(
        { sessionId: ctx.sessionId },
        ctx.parts || [],
      );
      if (result.detected && result.injectedMessage) {
        return { continue: true, message: result.injectedMessage };
      }
      return { continue: true };
    },
  });

  // Think Mode
  registerHook({
    name: "thinkMode",
    event: "UserPromptSubmit",
    priority: 30,
    handler: async (ctx) => {
      if (!ctx.message || !ctx.parts) {
        return { continue: true };
      }

      const hook = createThinkModeHook();
      const sessionId = ctx.sessionId || "default";

      // Process chat params to detect think mode
      const state = hook.processChatParams(sessionId, {
        parts: ctx.parts,
        message: ctx.message,
      });

      // If think mode was requested and model was switched, inject message
      if (state.requested && state.modelSwitched) {
        return {
          continue: true,
          message: `[Think Mode Activated] Switched to high-reasoning model variant.`,
        };
      }

      return { continue: true };
    },
  });
}
```

**Hooks to wire**:

- `keyword-detector` (priority: 10)
- `auto-slash-command` (priority: 20)
- `think-mode` (priority: 30)

**Acceptance Criteria**:

- [ ] All 3 hooks registered for UserPromptSubmit
- [ ] Priority order is correct
- [ ] Each hook returns valid HookResult

#### 3.2 Wire SessionStart Hooks

**File**: `src/hooks/registrations/session-start.ts`

```typescript
import { registerHook } from "../registry.js";
import { processSessionStart } from "../bridge.js";

export function registerSessionStartHooks(): void {
  // Session Start (restore persistent modes)
  registerHook({
    name: "sessionStart",
    event: "SessionStart",
    priority: 10,
    handler: async (ctx) => {
      return processSessionStart({
        sessionId: ctx.sessionId,
        directory: ctx.directory,
      });
    },
  });
}
```

**Hooks to wire**:

- `session-start` (priority: 10)

**Note**: `session-recovery` is designed to handle errors during tool execution or message processing, not session initialization. It should be triggered by error events, not SessionStart.

**Acceptance Criteria**:

- [ ] Session start hook registered
- [ ] Persistent mode restoration works

**Note on session-recovery**: The `session-recovery` hook is designed to handle errors during tool execution or message processing (e.g., tool_result_missing, thinking_block_order, empty_content errors). It should be triggered by error events, not SessionStart. It remains available in the codebase for future error-handling integration but is not wired to any event in this plan.

#### 3.3 Wire Stop Hooks

**File**: `src/hooks/registrations/stop.ts`

```typescript
import { registerHook } from "../registry.js";
import { processPersistentMode } from "../bridge.js";

export function registerStopHooks(): void {
  // Persistent Mode (unified handler for ascent, ultrawork, todos)
  registerHook({
    name: "persistentMode",
    event: "Stop",
    priority: 10,
    handler: async (ctx) => {
      return processPersistentMode({
        sessionId: ctx.sessionId,
        directory: ctx.directory,
      });
    },
  });
}
```

**Hooks to wire**:

- `persistent-mode` (includes ascent, ascent-verifier, todo-continuation, ultrawork)

**Acceptance Criteria**:

- [ ] Persistent mode hook blocks stop when work remains
- [ ] Ultrawork, ascent, and todo continuation all work

#### 3.4 Wire PreToolUse Hooks

**File**: `src/hooks/registrations/pre-tool-use.ts`

```typescript
import { registerHook } from "../registry.js";
import { createRulesInjectorHook } from "../rules-injector/index.js";
import { createDirectoryReadmeInjectorHook } from "../directory-readme-injector/index.js";
import { nonInteractiveEnvHook } from "../non-interactive-env/index.js";
import { createOlympusOrchestratorHook } from "../olympus-orchestrator/index.js";

export function registerPreToolUseHooks(): void {
  // Rules Injector (highest priority - context first)
  registerHook({
    name: "rulesInjector",
    event: "PreToolUse",
    priority: 10,
    matcher: /^(read|edit|write|glob|grep)$/i,
    handler: async (ctx) => {
      const hook = createRulesInjectorHook(ctx.directory || process.cwd());
      const filePath = extractFilePath(ctx.toolInput);
      if (!filePath) return { continue: true };

      const message = hook.processToolExecution(
        ctx.toolName!,
        filePath,
        ctx.sessionId || "default",
      );

      return {
        continue: true,
        message: message || undefined,
      };
    },
  });

  // Directory README Injector
  registerHook({
    name: "directoryReadmeInjector",
    event: "PreToolUse",
    priority: 20,
    matcher: /^(read|edit|write|glob|grep|bash)$/i,
    handler: async (ctx) => {
      const hook = createDirectoryReadmeInjectorHook(
        ctx.directory || process.cwd(),
      );
      const filePath = extractFilePath(ctx.toolInput);
      if (!filePath) return { continue: true };

      const message = hook.processToolExecution(
        ctx.toolName!,
        filePath,
        ctx.sessionId || "default",
      );

      return {
        continue: true,
        message: message || undefined,
      };
    },
  });

  // Non-Interactive Environment
  registerHook({
    name: "nonInteractiveEnv",
    event: "PreToolUse",
    priority: 30,
    matcher: /^bash$/i,
    handler: async (ctx) => {
      const commandInput = ctx.toolInput as { command?: string };
      if (!commandInput?.command) return { continue: true };

      try {
        const result = await nonInteractiveEnvHook.beforeCommand(
          commandInput.command,
        );

        return {
          continue: true,
          message: result.warning,
          modifiedInput:
            result.command !== commandInput.command
              ? { ...commandInput, command: result.command }
              : undefined,
        };
      } catch (error) {
        console.error("[nonInteractiveEnv] Error:", error);
        return { continue: true };
      }
    },
  });

  // Olympus Orchestrator (pre-tool checks)
  registerHook({
    name: "olympusOrchestratorPre",
    event: "PreToolUse",
    priority: 40,
    matcher: /^(write|edit|bash|task)$/i,
    handler: async (ctx) => {
      const hook = createOlympusOrchestratorHook(
        ctx.directory || process.cwd(),
      );
      const result = hook.preTool(
        ctx.toolName!,
        ctx.toolInput as Record<string, unknown>,
      );
      return result;
    },
  });
}

function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  return (obj.file_path || obj.filePath || obj.path) as string | null;
}
```

**Hooks to wire**:

- `rules-injector` (priority: 10, matcher: read/edit/write/glob/grep)
- `directory-readme-injector` (priority: 20, matcher: read/edit/write/glob/grep/bash)
- `non-interactive-env` (priority: 30, matcher: bash)
- `olympus-orchestrator` PreToolUse (priority: 40, matcher: write/edit/bash/task)

**Acceptance Criteria**:

- [ ] Rules are injected when accessing files
- [ ] README context is injected
- [ ] Bash commands get environment variables added
- [ ] Orchestrator checks run before tool execution

#### 3.5 Wire PostToolUse Hooks

**File**: `src/hooks/registrations/post-tool-use.ts`

```typescript
import { registerHook } from "../registry.js";
import { createEditErrorRecoveryHook } from "../edit-error-recovery/index.js";
import { createCommentCheckerHook } from "../comment-checker/index.js";
import { createContextLimitRecoveryHook } from "../context-window-limit-recovery/index.js";
import { createPreemptiveCompactionHook } from "../preemptive-compaction/index.js";
import { createAgentUsageReminderHook } from "../agent-usage-reminder/index.js";
import { createOlympusOrchestratorHook } from "../olympus-orchestrator/index.js";

export function registerPostToolUseHooks(): void {
  // Edit Error Recovery (highest priority for immediate feedback)
  registerHook({
    name: "editErrorRecovery",
    event: "PostToolUse",
    priority: 10,
    matcher: /^edit$/i,
    handler: async (ctx) => {
      const hook = createEditErrorRecoveryHook();
      const output = ctx.toolOutput as { output?: string } | undefined;
      if (!output?.output) return { continue: true };

      const result = hook.afterToolExecute(
        { tool: "edit", sessionId: ctx.sessionId || "", callId: "" },
        { title: "", output: output.output },
      );

      if (result.output !== output.output) {
        return { continue: true, message: result.output };
      }
      return { continue: true };
    },
  });

  // Comment Checker
  registerHook({
    name: "commentChecker",
    event: "PostToolUse",
    priority: 20,
    matcher: /^(write|edit|multiedit)$/i,
    handler: async (ctx) => {
      const hook = createCommentCheckerHook();
      const result = hook.postToolUse({
        tool_name: ctx.toolName!,
        session_id: ctx.sessionId || "",
        tool_input: ctx.toolInput as Record<string, unknown>,
        tool_response: (ctx.toolOutput as { output?: string })?.output,
      });

      if (result) {
        return { continue: true, message: result };
      }
      return { continue: true };
    },
  });

  // Context Window Limit Recovery
  registerHook({
    name: "contextWindowLimitRecovery",
    event: "PostToolUse",
    priority: 30,
    handler: async (ctx) => {
      const hook = createContextLimitRecoveryHook();
      const output = (ctx.toolOutput as { output?: string })?.output;

      const result = hook.postToolUse({
        tool_name: ctx.toolName!,
        session_id: ctx.sessionId || "",
        tool_input: ctx.toolInput as Record<string, unknown>,
        tool_response: output,
      });

      if (result) {
        return { continue: true, message: result };
      }
      return { continue: true };
    },
  });

  // Preemptive Compaction
  registerHook({
    name: "preemptiveCompaction",
    event: "PostToolUse",
    priority: 40,
    matcher: /^(read|grep|glob|bash|webfetch)$/i,
    handler: async (ctx) => {
      const hook = createPreemptiveCompactionHook();
      const output = (ctx.toolOutput as { output?: string })?.output;

      const result = hook.postToolUse({
        tool_name: ctx.toolName!,
        session_id: ctx.sessionId || "",
        tool_input: ctx.toolInput as Record<string, unknown>,
        tool_response: output,
      });

      if (result) {
        return { continue: true, message: result };
      }
      return { continue: true };
    },
  });

  // Agent Usage Reminder
  registerHook({
    name: "agentUsageReminder",
    event: "PostToolUse",
    priority: 50,
    matcher: /^(read|grep|glob|edit|write)$/i,
    handler: async (ctx) => {
      const hook = createAgentUsageReminderHook();

      // Track tool usage and potentially append reminder
      const toolInput = {
        tool: ctx.toolName!,
        sessionID: ctx.sessionId || "",
        callID: "",
      };

      const toolOutput = {
        title: "",
        output: (ctx.toolOutput as { output?: string })?.output || "",
        metadata: undefined,
      };

      await hook["tool.execute.after"](toolInput, toolOutput);

      // Output was potentially modified in-place, check if reminder was added
      const originalOutput =
        (ctx.toolOutput as { output?: string })?.output || "";
      if (toolOutput.output !== originalOutput) {
        return {
          continue: true,
          message: toolOutput.output.substring(originalOutput.length),
        };
      }

      return { continue: true };
    },
  });

  // Olympus Orchestrator (post-tool checks)
  registerHook({
    name: "olympusOrchestratorPost",
    event: "PostToolUse",
    priority: 60,
    matcher: /^(write|edit|bash|task)$/i,
    handler: async (ctx) => {
      const hook = createOlympusOrchestratorHook(
        ctx.directory || process.cwd(),
      );
      const output = (ctx.toolOutput as { output?: string })?.output || "";
      const result = hook.postTool(
        ctx.toolName!,
        ctx.toolInput as Record<string, unknown>,
        output,
      );

      if (result.modifiedOutput) {
        return { continue: true, message: result.modifiedOutput };
      }
      return { continue: true };
    },
  });
}
```

**Hooks to wire**:

- `edit-error-recovery` (priority: 10, matcher: edit)
- `comment-checker` (priority: 20, matcher: write/edit/multiedit)
- `context-window-limit-recovery` (priority: 30, all tools)
- `preemptive-compaction` (priority: 40, matcher: read/grep/glob/bash/webfetch)
- `agent-usage-reminder` (priority: 50, matcher: read/grep/glob/edit/write)
- `olympus-orchestrator` PostToolUse (priority: 60, matcher: write/edit/bash/task)

**Acceptance Criteria**:

- [ ] Edit errors trigger recovery message
- [ ] Comments are flagged
- [ ] Context limit errors are recovered
- [ ] Preemptive warnings before context overflow
- [ ] Agent usage reminders appear when appropriate
- [ ] Orchestrator tracks file changes

#### 3.6 Wire Notification Hooks

**File**: `src/hooks/registrations/notification.ts`

```typescript
import { registerHook } from "../registry.js";
import { processBackgroundNotification } from "../background-notification/index.js";

export function registerNotificationHooks(): void {
  registerHook({
    name: "backgroundNotification",
    event: "Notification",
    priority: 10,
    handler: async (ctx) => {
      const input = {
        sessionId: ctx.sessionId,
        event: ctx.event,
      };
      const result = processBackgroundNotification(input);
      return result;
    },
  });
}
```

**Hooks to wire**:

- `background-notification` (priority: 10)

**Acceptance Criteria**:

- [ ] Background task completions surface as notifications

#### 3.7 Wire MessagesTransform Hooks

**File**: `src/hooks/registrations/messages-transform.ts`

```typescript
import { registerHook } from "../registry.js";
import { createEmptyMessageSanitizerHook } from "../empty-message-sanitizer/index.js";
import { createThinkingBlockValidatorHook } from "../thinking-block-validator/index.js";

export function registerMessagesTransformHooks(): void {
  // Empty Message Sanitizer (first - fix empty messages)
  registerHook({
    name: "emptyMessageSanitizer",
    event: "MessagesTransform",
    priority: 10,
    handler: async (ctx) => {
      if (!ctx.messages || ctx.messages.length === 0) {
        return { continue: true };
      }

      const hook = createEmptyMessageSanitizerHook();
      const result = hook.sanitize({ messages: ctx.messages as any });

      if (result.modified) {
        return {
          continue: true,
          modifiedMessages: result.messages,
          message: `[Empty Message Sanitizer] Fixed ${result.sanitizedCount} message(s)`,
        };
      }

      return { continue: true };
    },
  });

  // Thinking Block Validator (second - fix thinking blocks)
  registerHook({
    name: "thinkingBlockValidator",
    event: "MessagesTransform",
    priority: 20,
    handler: async (ctx) => {
      if (!ctx.messages || ctx.messages.length === 0) {
        return { continue: true };
      }

      const hook = createThinkingBlockValidatorHook();

      // Call the hook's transform function
      // Note: This is an async function that modifies messages in-place
      const transformContext = {
        messages: ctx.messages as any,
      };

      await hook["experimental.chat.messages.transform"](
        {} as any, // input (not used by this hook)
        transformContext,
      );

      return {
        continue: true,
        modifiedMessages: transformContext.messages,
      };
    },
  });
}
```

**Hooks to wire**:

- `empty-message-sanitizer` (priority: 10)
- `thinking-block-validator` (priority: 20)

**Acceptance Criteria**:

- [ ] Empty messages are sanitized
- [ ] Thinking blocks are validated and fixed
- [ ] Messages are modified in-place correctly

#### 3.8 Create Master Registration

**File**: `src/hooks/registrations/index.ts`

```typescript
import { registerUserPromptSubmitHooks } from "./user-prompt-submit.js";
import { registerSessionStartHooks } from "./session-start.js";
import { registerStopHooks } from "./stop.js";
import { registerPreToolUseHooks } from "./pre-tool-use.js";
import { registerPostToolUseHooks } from "./post-tool-use.js";
import { registerNotificationHooks } from "./notification.js";
import { registerMessagesTransformHooks } from "./messages-transform.js";

let registered = false;

export function registerAllHooks(): void {
  if (registered) return;

  registerUserPromptSubmitHooks();
  registerSessionStartHooks();
  registerStopHooks();
  registerPreToolUseHooks();
  registerPostToolUseHooks();
  registerNotificationHooks();
  registerMessagesTransformHooks();

  registered = true;
}
```

**Acceptance Criteria**:

- [ ] All hooks registered on first call
- [ ] Idempotent (safe to call multiple times)

---

## Phase 4: Build System Integration

### Objective

Create esbuild configuration to bundle all hooks into a single file.

### Tasks

#### 4.1 Create esbuild Configuration

**File**: `esbuild.hooks.mjs`

```javascript
import * as esbuild from "esbuild";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const outdir = join(__dirname, "dist", "hooks");

// Ensure output directory exists
if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}

await esbuild.build({
  entryPoints: ["src/hooks/entry.ts"],
  bundle: true,
  outfile: join(outdir, "olympus-hooks.mjs"),
  format: "esm",
  platform: "node",
  target: "node18",
  minify: true,
  sourcemap: false,
  external: [], // Bundle everything
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  banner: {
    js: "#!/usr/bin/env node\n// Olympus Hooks Bundle - Generated by esbuild",
  },
});

console.log("Built: dist/hooks/olympus-hooks.mjs");
```

**Acceptance Criteria**:

- [ ] Bundle builds without errors
- [ ] Bundle is self-contained (no external requires)
- [ ] Bundle size is reasonable (< 500KB)

#### 4.2 Create Hook Entry Point

**File**: `src/hooks/entry.ts`

```typescript
#!/usr/bin/env node
/**
 * Olympus Hooks Entry Point
 *
 * This is the main entry point for the bundled hooks.
 * Called by Claude Code via shell command.
 *
 * Usage:
 *   node olympus-hooks.mjs --event=<event-type>
 *
 * Reads JSON from stdin, outputs JSON to stdout.
 */

import { registerAllHooks } from "./registrations/index.js";
import { routeHook } from "./router.js";
import type { HookEvent, HookContext } from "./types.js";

// Register all hooks
registerAllHooks();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const eventArg = args.find((a) => a.startsWith("--event="));

  if (!eventArg) {
    console.error("Usage: node olympus-hooks.mjs --event=<event-type>");
    process.exit(1);
  }

  const event = eventArg.split("=")[1] as HookEvent;

  // Read input from stdin
  const inputStr = await readStdin();

  let context: HookContext;
  try {
    context = JSON.parse(inputStr);
  } catch {
    context = {};
  }

  // Route to appropriate hooks
  const result = await routeHook(event, context);

  // Output result as JSON
  console.log(JSON.stringify(result));
}

// Only run main() when executed directly
// FIX: Proper URL comparison for Windows compatibility
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("entry.ts") ||
    process.argv[1].endsWith("entry.js") ||
    process.argv[1].endsWith("olympus-hooks.mjs"));

if (isMainModule) {
  main().catch((err) => {
    console.error("[olympus-hooks] Fatal error:", err);
    process.exit(1);
  });
}
```

**Acceptance Criteria**:

- [ ] Entry point parses event from args
- [ ] Reads JSON from stdin
- [ ] Routes to appropriate hooks
- [ ] Outputs JSON to stdout
- [ ] Windows path handling fixed

#### 4.3 Update package.json Scripts

**File**: `package.json`

Add build script:

```json
{
  "scripts": {
    "build": "tsc",
    "build:hooks": "node esbuild.hooks.mjs",
    "build:all": "npm run build && npm run build:hooks"
  }
}
```

**Acceptance Criteria**:

- [ ] `npm run build:hooks` produces bundle
- [ ] `npm run build:all` builds everything

---

## Phase 5: Installer Updates

### Objective

Update the installer to install the bundled hooks.

### Tasks

#### 5.1 Update Installer Logic

**File**: `src/installer/index.ts`

Add function to install bundled hooks:

```typescript
import { join } from "path";
import { copyFileSync, existsSync, mkdirSync } from "fs";

export function installBundledHooks(): void {
  const bundlePath = join(
    __dirname,
    "..",
    "..",
    "dist",
    "hooks",
    "olympus-hooks.mjs",
  );
  const targetDir = join(homedir(), ".claude", "hooks");
  const targetPath = join(targetDir, "olympus-hooks.mjs");

  if (!existsSync(bundlePath)) {
    console.warn(
      "Warning: Bundled hooks not found. Run npm run build:hooks first.",
    );
    return;
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  copyFileSync(bundlePath, targetPath);
  console.log(`Installed: ${targetPath}`);
}
```

**Acceptance Criteria**:

- [ ] Bundle is copied to ~/.claude/hooks/
- [ ] Directory is created if needed
- [ ] Warning if bundle not found

#### 5.2 Update Settings Configuration

**File**: `src/installer/hooks.ts`

Create new settings config that uses bundled hooks:

```typescript
export const HOOKS_SETTINGS_CONFIG_BUNDLED = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=UserPromptSubmit'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=UserPromptSubmit',
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=SessionStart'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=SessionStart',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=Stop'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=Stop',
          },
        ],
      },
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=PreToolUse'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=PreToolUse',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=PostToolUse'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=PostToolUse',
          },
        ],
      },
    ],
    Notification: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=Notification'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=Notification',
          },
        ],
      },
    ],
    MessagesTransform: [
      {
        hooks: [
          {
            type: "command" as const,
            command: isWindows()
              ? 'node "%USERPROFILE%\\.claude\\hooks\\olympus-hooks.mjs" --event=MessagesTransform'
              : 'node "$HOME/.claude/hooks/olympus-hooks.mjs" --event=MessagesTransform',
          },
        ],
      },
    ],
  },
};
```

**Acceptance Criteria**:

- [ ] All 7 events configured (including MessagesTransform)
- [ ] Cross-platform paths
- [ ] Single bundle file used for all events

#### 5.3 Migration from Legacy Hooks

**File**: `src/installer/migrate.ts`

```typescript
import { existsSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LEGACY_HOOK_FILES = [
  "keyword-detector.sh",
  "keyword-detector.mjs",
  "stop-continuation.sh",
  "stop-continuation.mjs",
  "persistent-mode.sh",
  "persistent-mode.mjs",
  "session-start.sh",
  "session-start.mjs",
];

export function migrateLegacyHooks(): void {
  const hooksDir = join(homedir(), ".claude", "hooks");

  if (!existsSync(hooksDir)) return;

  for (const file of LEGACY_HOOK_FILES) {
    const filePath = join(hooksDir, file);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
        console.log(`Removed legacy hook: ${file}`);
      } catch (err) {
        console.warn(`Failed to remove ${file}:`, err);
      }
    }
  }
}
```

**Acceptance Criteria**:

- [ ] Legacy .sh and .mjs files are removed
- [ ] No errors if files don't exist
- [ ] Console output shows what was removed

---

## Phase 6: Configuration & Testing

### Objective

Add configuration documentation and comprehensive tests.

### Tasks

#### 6.1 Create Default Configuration

**File**: `src/installer/default-config.ts`

```typescript
export const DEFAULT_HOOKS_CONFIG = {
  hooks: {
    enabled: true,
    hookTimeoutMs: 100,

    // UserPromptSubmit hooks
    keywordDetector: { enabled: true },
    autoSlashCommand: { enabled: true },
    thinkMode: { enabled: true },

    // SessionStart hooks
    sessionStart: { enabled: true },

    // Stop hooks
    persistentMode: { enabled: true },

    // PreToolUse hooks
    rulesInjector: { enabled: true },
    directoryReadmeInjector: { enabled: true },
    nonInteractiveEnv: { enabled: true },
    olympusOrchestrator: { enabled: true },

    // PostToolUse hooks
    editErrorRecovery: { enabled: true },
    commentChecker: { enabled: true },
    contextWindowLimitRecovery: { enabled: true },
    preemptiveCompaction: { enabled: true },
    agentUsageReminder: { enabled: true },

    // Notification hooks
    backgroundNotification: { enabled: true },

    // MessagesTransform hooks
    emptyMessageSanitizer: { enabled: true },
    thinkingBlockValidator: { enabled: true },
  },
};
```

**Acceptance Criteria**:

- [ ] All hooks have default configuration
- [ ] All enabled by default
- [ ] Includes emptyMessageSanitizer and thinkingBlockValidator

#### 6.2 Create Hook Tests

**File**: `src/__tests__/hooks/router.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerHook,
  clearHooks,
  getHooksForEvent,
} from "../../hooks/registry";
import { routeHook } from "../../hooks/router";

describe("Hook Router", () => {
  beforeEach(() => {
    clearHooks();
  });

  it("routes to registered hooks", async () => {
    registerHook({
      name: "test",
      event: "UserPromptSubmit",
      handler: () => ({ continue: true, message: "test message" }),
    });

    const result = await routeHook("UserPromptSubmit", { prompt: "hello" });

    expect(result.continue).toBe(true);
    expect(result.message).toBe("test message");
  });

  it("aggregates messages from multiple hooks", async () => {
    registerHook({
      name: "hook1",
      event: "UserPromptSubmit",
      priority: 10,
      handler: () => ({ continue: true, message: "message 1" }),
    });

    registerHook({
      name: "hook2",
      event: "UserPromptSubmit",
      priority: 20,
      handler: () => ({ continue: true, message: "message 2" }),
    });

    const result = await routeHook("UserPromptSubmit", {});

    expect(result.message).toContain("message 1");
    expect(result.message).toContain("message 2");
  });

  it("stops execution when continue is false", async () => {
    registerHook({
      name: "blocker",
      event: "Stop",
      handler: () => ({ continue: false, reason: "blocked" }),
    });

    const result = await routeHook("Stop", {});

    expect(result.continue).toBe(false);
    expect(result.reason).toBe("blocked");
  });

  it("filters hooks by matcher", async () => {
    registerHook({
      name: "editOnly",
      event: "PostToolUse",
      matcher: /^edit$/i,
      handler: () => ({ continue: true, message: "edit hook" }),
    });

    const editResult = await routeHook("PostToolUse", { toolName: "edit" });
    expect(editResult.message).toBe("edit hook");

    const readResult = await routeHook("PostToolUse", { toolName: "read" });
    expect(readResult.message).toBeUndefined();
  });

  it("handles hook timeout gracefully", async () => {
    registerHook({
      name: "slow",
      event: "UserPromptSubmit",
      handler: async () => {
        await new Promise((r) => setTimeout(r, 200)); // Exceeds 100ms timeout
        return { continue: true, message: "slow" };
      },
    });

    const result = await routeHook("UserPromptSubmit", {});

    // Hook timed out, no message
    expect(result.message).toBeUndefined();
  });

  it("isolates errors between hooks", async () => {
    registerHook({
      name: "failing",
      event: "UserPromptSubmit",
      priority: 10,
      handler: () => {
        throw new Error("fail");
      },
    });

    registerHook({
      name: "working",
      event: "UserPromptSubmit",
      priority: 20,
      handler: () => ({ continue: true, message: "works" }),
    });

    const result = await routeHook("UserPromptSubmit", {});

    expect(result.message).toBe("works");
  });
});
```

**Acceptance Criteria**:

- [ ] Router tests pass
- [ ] Priority ordering tested
- [ ] Matcher filtering tested
- [ ] Timeout handling tested (100ms)
- [ ] Error isolation tested

#### 6.3 Create Integration Tests

**File**: `src/__tests__/hooks/integration.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { registerAllHooks } from "../../hooks/registrations";
import { getAllHooks } from "../../hooks/registry";

describe("Hook Integration", () => {
  beforeAll(() => {
    registerAllHooks();
  });

  it("registers all expected hooks", () => {
    const hooks = getAllHooks();

    const expectedHooks = [
      "keywordDetector",
      "autoSlashCommand",
      "thinkMode",
      "sessionStart",
      "persistentMode",
      "rulesInjector",
      "directoryReadmeInjector",
      "nonInteractiveEnv",
      "olympusOrchestratorPre",
      "editErrorRecovery",
      "commentChecker",
      "contextWindowLimitRecovery",
      "preemptiveCompaction",
      "agentUsageReminder",
      "olympusOrchestratorPost",
      "backgroundNotification",
      "emptyMessageSanitizer",
      "thinkingBlockValidator",
    ];

    const hookNames = hooks.map((h) => h.name);

    for (const expected of expectedHooks) {
      expect(hookNames).toContain(expected);
    }
  });

  it("has correct hook event assignments", () => {
    const hooks = getAllHooks();

    const userPromptHooks = hooks.filter((h) => h.event === "UserPromptSubmit");
    expect(userPromptHooks.length).toBeGreaterThanOrEqual(3);

    const preToolHooks = hooks.filter((h) => h.event === "PreToolUse");
    expect(preToolHooks.length).toBeGreaterThanOrEqual(4);

    const postToolHooks = hooks.filter((h) => h.event === "PostToolUse");
    expect(postToolHooks.length).toBeGreaterThanOrEqual(6);

    const messagesTransformHooks = hooks.filter(
      (h) => h.event === "MessagesTransform",
    );
    expect(messagesTransformHooks.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Acceptance Criteria**:

- [ ] All hooks are registered
- [ ] Hooks are assigned to correct events
- [ ] No duplicate hook names
- [ ] MessagesTransform hooks included

#### 6.4 Create Bundle Integration Test

**File**: `src/__tests__/hooks/bundle.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

describe("Hook Bundle", () => {
  it("bundle file exists after build", () => {
    const bundlePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "dist",
      "hooks",
      "olympus-hooks.mjs",
    );

    // Run build if bundle doesn't exist
    if (!existsSync(bundlePath)) {
      execSync("npm run build:hooks", {
        cwd: join(__dirname, "..", "..", ".."),
      });
    }

    expect(existsSync(bundlePath)).toBe(true);
  });

  it("bundle can be executed without import errors", () => {
    const bundlePath = join(
      __dirname,
      "..",
      "..",
      "..",
      "dist",
      "hooks",
      "olympus-hooks.mjs",
    );

    // Try to execute with --help (should fail gracefully, not throw import errors)
    try {
      execSync(`node "${bundlePath}" --event=UserPromptSubmit`, {
        input: JSON.stringify({}),
        encoding: "utf-8",
        timeout: 5000,
      });
    } catch (error: any) {
      // Should execute without import errors
      expect(error.stderr?.toString() || "").not.toContain(
        "Cannot find module",
      );
      expect(error.stderr?.toString() || "").not.toContain("SyntaxError");
    }
  });
});
```

**Acceptance Criteria**:

- [ ] Bundle file exists after build
- [ ] Bundle can be executed without import errors
- [ ] No runtime failures on execution

#### 6.5 Performance Benchmarks

**File**: `src/__tests__/hooks/performance.test.ts`

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { registerAllHooks } from "../../hooks/registrations";
import { routeHook } from "../../hooks/router";

describe("Hook Performance", () => {
  beforeAll(() => {
    registerAllHooks();
  });

  it("UserPromptSubmit completes within 200ms", async () => {
    const start = performance.now();

    await routeHook("UserPromptSubmit", {
      prompt: "test prompt",
      sessionId: "test-session",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("PreToolUse completes within 200ms", async () => {
    const start = performance.now();

    await routeHook("PreToolUse", {
      toolName: "read",
      toolInput: { file_path: "/test/file.ts" },
      sessionId: "test-session",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("PostToolUse completes within 200ms", async () => {
    const start = performance.now();

    await routeHook("PostToolUse", {
      toolName: "edit",
      toolInput: { file_path: "/test/file.ts" },
      toolOutput: { output: "Success" },
      sessionId: "test-session",
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
```

**Acceptance Criteria**:

- [ ] All hook events complete within 200ms
- [ ] No performance regressions

---

## Commit Strategy

### Commit 1: Architecture Setup

```
feat(hooks): add unified hook types and extend config schema

- Add HookEvent, HookContext, HookResult types
- Add MessagesTransform event type
- Add HookDefinition and HookConfig interfaces
- Extend PluginConfig with per-hook configuration
- Add configurable hookTimeoutMs (default: 100ms)
```

### Commit 2: Registry and Router

```
feat(hooks): implement hook registry and router

- Add hook registration with priority ordering
- Add router with 100ms timeout protection (configurable)
- Add config-based hook enable/disable
- Add matcher filtering for tool-specific hooks
- Add error handling and logging for debugging
```

### Commit 3: UserPromptSubmit and SessionStart Hooks

```
feat(hooks): wire UserPromptSubmit and SessionStart hooks

- Register keyword-detector, auto-slash-command, think-mode
- Register session-start
- Add priority ordering
- Note: session-recovery is error-triggered, not wired to SessionStart
```

### Commit 4: Stop Hooks

```
feat(hooks): wire Stop hooks

- Register persistent-mode (unified handler)
- Includes ascent, ultrawork, todo-continuation
```

### Commit 5: PreToolUse Hooks

```
feat(hooks): wire PreToolUse hooks

- Register rules-injector, directory-readme-injector
- Register non-interactive-env, olympus-orchestrator
- Add tool matchers for targeted execution
- Fix function signatures to match actual implementations
```

### Commit 6: PostToolUse Hooks

```
feat(hooks): wire PostToolUse hooks

- Register edit-error-recovery, comment-checker
- Register context-window-limit-recovery, preemptive-compaction
- Register agent-usage-reminder with full implementation
- Register olympus-orchestrator
- Add tool matchers for targeted execution
- Implement agent usage tracking with reminder injection
```

### Commit 7: Notification and MessagesTransform Hooks

```
feat(hooks): wire Notification and MessagesTransform hooks

- Register background-notification with correct context mapping
- Register empty-message-sanitizer
- Register thinking-block-validator
- Add event property to HookContext for Notification hooks
- Add priority ordering for transform pipeline
```

### Commit 8: Build System

```
build(hooks): add esbuild configuration for bundled hooks

- Add esbuild.hooks.mjs configuration
- Add hook entry point with Windows path fix
- Add build:hooks script to package.json
- Generate self-contained olympus-hooks.mjs bundle
```

### Commit 9: Installer Updates

```
feat(installer): install bundled hooks

- Update installer to copy bundled hooks
- Add settings configuration for all 7 events (including MessagesTransform)
- Add migration from legacy hook files
- Add default hook configuration
```

### Commit 10: Tests

```
test(hooks): add comprehensive hook tests

- Add router unit tests
- Add integration tests with all hook names
- Add bundle integration test
- Add performance benchmarks
- Verify all hooks registered correctly
```

---

## Success Criteria

### Functional

- [ ] All 18 hooks are wired to appropriate events
- [ ] Keyword detection (ultrawork/ultrathink/search/analyze) works
- [ ] Persistent mode (ascent/ultrawork/todos) prevents premature stopping
- [ ] Rule injection works when accessing files
- [ ] Edit error recovery provides helpful guidance
- [ ] Context limit warnings appear before overflow
- [ ] Agent usage reminders appear when appropriate
- [ ] Background task notifications surface correctly
- [ ] Empty messages are sanitized
- [ ] Thinking blocks are validated
- [ ] Session recovery remains available for error handling (not wired to SessionStart)

### Performance

- [ ] Total hook execution < 200ms per event
- [ ] Individual hook execution < 100ms (configurable)
- [ ] Bundle size < 500KB

### Compatibility

- [ ] Works on Windows (Node.js paths)
- [ ] Works on macOS (Unix paths)
- [ ] Works on Linux (Unix paths)
- [ ] Node 18+ compatibility

### Quality

- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] ESLint passes
- [ ] Backward compatible with existing state files

---

## Risk Mitigation

| Risk                         | Probability | Impact | Mitigation                                                 |
| ---------------------------- | ----------- | ------ | ---------------------------------------------------------- |
| Bundle too large             | Medium      | Medium | Tree-shaking, lazy loading                                 |
| Hook timeout                 | Low         | High   | 100ms timeout per hook (configurable)                      |
| State file corruption        | Low         | High   | Atomic writes, backups                                     |
| Windows path issues          | Medium      | Medium | Use path.join(), normalize, fix import.meta.url            |
| Node version incompatibility | Low         | Medium | Document Node 18+ requirement                              |
| Config parsing errors        | Medium      | Low    | Default to enabled, log warnings, note to use jsonc-parser |

---

## Next Steps

After this plan is approved and implemented:

1. **Run implementation** following the commit strategy
2. Follow the commit strategy for incremental progress
3. Run tests after each phase
4. Verify performance benchmarks before final merge
