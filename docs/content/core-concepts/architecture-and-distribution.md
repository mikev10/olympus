---
title: "Architecture and Distribution Pipeline"
sidebar_label: "Architecture & Distribution"
sidebar_position: 3
---

# Architecture and Distribution Pipeline

Olympus is distributed as an npm package, but it is not a traditional Node module that your application imports. It is an **installer and runtime layer** that configures Claude Code's extension points with agents, skills, rules, and hooks. This guide explains why Olympus uses TypeScript, how the build pipeline works, and what happens when a user installs the package.

---

## Why TypeScript?

Olympus started as a collection of markdown files, but TypeScript became essential as the system grew beyond static content.

### What markdown alone cannot do

- **Cross-platform installation logic** - Detecting the operating system, checking Node.js versions, verifying Claude Code is installed, merging content into existing config files, migrating from legacy formats, and cleaning up stale artifacts. This requires real programming logic with conditionals, file system operations, and error handling.

- **Runtime hooks** - The learning system, keyword detection, persistence enforcement, and agent tracking all run as hooks during Claude Code sessions. These hooks receive JSON on stdin, make decisions, and return JSON on stdout. Markdown cannot execute code.

- **CLI commands** - `olympus-ai install`, `olympus-ai learn --stats`, `olympus-ai learn --cleanup`, and other commands need argument parsing, data aggregation, and formatted output.

- **A test suite** - Over 3,200 tests validate that the installer, hooks, learning system, and CLI behave correctly across platforms. You cannot test markdown files.

- **Type safety across a growing codebase** - The learning system alone includes feedback capture, pattern extraction, preference learning, agent evaluation, prompt patching, discovery management, session state, and cleanup. TypeScript catches integration errors between these modules at compile time.

### What stays as markdown

Content that Claude reads directly remains markdown. Agent definitions, skill prompts, workflow rules, and system instructions are all `.md` files in the `resources/` directory. TypeScript does not generate or template this content; it reads it from disk and copies it to the right location.

The division is simple: **markdown is the content, TypeScript is the machinery**.

---

## The Two Artifact Types

Everything Olympus ships falls into one of two categories:

| Artifact | Format | Purpose | Where it ends up |
|----------|--------|---------|-----------------|
| Content | Markdown (`.md`) | Agent definitions, skill prompts, workflow rules, system instructions | `~/.claude/agents/`, `~/.claude/skills/`, `~/.claude/olympus/rules/`, `~/.claude/CLAUDE.md` |
| Machinery | Compiled JavaScript (`.js`, `.cjs`) | Installer, CLI, runtime hooks | `dist/` in the npm package; hook scripts copied to `~/.claude/hooks/` |

Claude Code reads the markdown files. It never imports or executes the JavaScript directly. The JavaScript exists to get those markdown files into the right place and to power the hooks that run alongside Claude Code during sessions.

---

## The Build Pipeline

```
Source                      Build                     Output
──────                      ─────                     ──────
src/**/*.ts    ──tsc──────► dist/**/*.js              CLI, installer, learning system
src/hooks/     ──esbuild──► dist/hooks/olympus-hooks.cjs   Bundled hook runtime
resources/**   ────────────► (unchanged)               Markdown content, shipped as-is
```

### Steps

1. **`npm run build`** - TypeScript compiler (`tsc`) compiles `src/` to `dist/`. This produces the CLI (`dist/cli/index.js`), installer (`dist/installer/index.js`), learning system, and all supporting modules.

2. **`npm run build:hooks`** - esbuild bundles all hook logic into a single file (`dist/hooks/olympus-hooks.cjs`). This is a CommonJS bundle so it can be invoked directly by shell scripts without import resolution.

3. **`resources/`** - Markdown files are not transformed. They ship as-is inside the npm package and are read at install time by the installer.

### What gets published to npm

The `files` field in `package.json` controls what ends up in the published package:

```json
{
  "files": ["dist", "resources", "scripts", ".claude-plugin", "README.md", "LICENSE", "COPYRIGHT", "NOTICE"]
}
```

No source TypeScript is published. Users receive compiled JavaScript and raw markdown.

---

## The Installation Flow

There are two ways to install Olympus: globally (available across all projects) and locally (scoped to a single project). Both use the same npm package and the same installer logic -- the difference is where npm puts the package and where the installer writes the Claude Code configuration files.

### Global installation (recommended)

```bash
npm install -g olympus-ai
```

**What npm does:** Places the package in the global `node_modules` directory (e.g., `~/.npm-global/lib/node_modules/olympus-ai/`). The `bin` field in `package.json` creates a symlink so `olympus-ai` is available as a CLI command from anywhere:

```json
{ "bin": { "olympus-ai": "dist/cli/index.js" } }
```

**What the postinstall hook does:** The `package.json` defines a postinstall script that runs automatically after npm finishes downloading:

```json
{ "postinstall": "node dist/cli/index.js postinstall || true" }
```

This calls the CLI's hidden `postinstall` subcommand, which silently runs the Olympus installer. The `|| true` ensures npm does not fail if the installer encounters a non-critical error (e.g., Claude Code is not installed yet). The installer writes all configuration to `~/.claude/` -- the global Claude Code config directory.

A single `npm install -g olympus-ai` both installs the npm package **and** configures `~/.claude/`. Users can also run `olympus-ai install` manually to re-run the installer (for example, after updating or to force-overwrite with `--force`).

Similarly, a `preuninstall` script runs `olympus-ai uninstall` when the package is removed via `npm uninstall -g olympus-ai`, cleaning up the files from `~/.claude/`.

### Local installation (project-scoped)

```bash
npm install --save-dev olympus-ai
npx olympus-ai install --local
```

**What npm does:** Places the package in the project's `node_modules/` directory and adds it to `devDependencies` in `package.json`. This pins Olympus to a specific version for the project. The CLI is not available globally -- it must be run through `npx` or an npm script.

**Why the installer is a separate step:** The postinstall hook that runs after `npm install` always targets the global `~/.claude/` directory. For local installation, the user must explicitly run `npx olympus-ai install --local` to direct the installer to write to `./.claude/` in the project directory instead.

**What the `--local` flag changes:** The installer swaps the target directory:

```typescript
const baseDir = options.local ? join(process.cwd(), '.claude') : CLAUDE_CONFIG_DIR;
```

It writes the same directory structure, but rooted in the project:

```
your-project/
├── .claude/
│   ├── CLAUDE.md
│   ├── agents/*.md
│   ├── skills/*/SKILL.md
│   ├── hooks/
│   ├── olympus/rules/
│   └── settings.json
├── node_modules/
│   └── olympus-ai/          # the npm package lives here
└── package.json              # olympus-ai in devDependencies
```

A `localizeContent()` function also rewrites all `~/.claude/olympus/` references inside the markdown files to `.claude/olympus/` so that rule file paths resolve correctly relative to the project root.

This is useful for teams that want Olympus pinned to a specific version in their repo. Both installations can coexist -- Claude Code gives local `.claude/` files precedence over global `~/.claude/` files.

### What the installer does (both modes)

Regardless of global or local, the installer (`dist/installer/index.js`) performs the same steps:

1. **Checks prerequisites** - Verifies Node.js >= 20 and Claude Code is installed.
2. **Creates directories** - Ensures `agents/`, `skills/`, `hooks/`, and `olympus/rules/` exist under the target directory.
3. **Copies agent definitions** - Reads every `.md` file from `resources/agents/` and writes it to the target `agents/` directory.
4. **Copies skill prompts** - Reads `SKILL.md` from each subdirectory of `resources/skills/` and writes it to `skills/{name}/SKILL.md`.
5. **Copies workflow rules** - Reads rule files from `resources/rules/` and writes them to `olympus/rules/`.
6. **Merges CLAUDE.md** - Reads the Olympus system prompt from resources and merges it into `CLAUDE.md`, preserving any existing user content.
7. **Installs hooks** - Writes hook scripts and configures them in `settings.json`. On Windows, hooks are Node.js scripts (`.mjs`); on Unix, they are Bash scripts (`.sh`) by default.
8. **Cleans up legacy artifacts** - Removes files from older Olympus versions (renamed commands, mega-rule files, etc.).

The content-reading function reads from the `resources/` directory that ships inside the npm package:

```typescript
const CONTENT_DIR = resolve(__dirname, '../../resources');

function readContent(relPath: string): string {
  return readFileSync(join(CONTENT_DIR, relPath), 'utf-8');
}
```

Since the compiled installer lives at `dist/installer/index.js`, the `../../resources` path resolves back to the package root's `resources/` directory -- whether that is in the global npm prefix or in the project's `node_modules/olympus-ai/`.

### Claude Code reads the installed files

When the user starts a Claude Code session, Claude Code automatically discovers:

- `CLAUDE.md` - Loaded as system instructions (the orchestrator prompt)
- `agents/*.md` - Available as subagent definitions for the Agent tool
- `skills/*/SKILL.md` - Available as slash commands
- `settings.json` - Hook configurations that trigger on session events

These paths are resolved from `~/.claude/` (global) or `.claude/` (project-local), with project-local taking precedence. No further involvement from the npm package is needed. Claude Code treats these as its own native configuration.

---

## Runtime Hooks: Where TypeScript Runs During Sessions

Hooks are the one place where compiled TypeScript executes during a Claude Code session. Claude Code's hook system fires shell commands on events like `PreToolUse`, `PostToolUse`, `Stop`, and `Notification`. Olympus registers handlers for these events.

### How hooks execute

1. Claude Code triggers an event (e.g., the user submits a prompt).
2. Claude Code runs the configured shell command from `settings.json`.
3. The shell command invokes the bundled hook file (`olympus-hooks.cjs`), passing event data as JSON on stdin.
4. The hook processes the event (e.g., captures feedback, detects keywords, checks for incomplete todos).
5. The hook returns JSON on stdout, which can inject context into the session or modify behavior.

### What the hooks do

| Hook | Event | Purpose |
|------|-------|---------|
| Session start | `Notification` | Loads learned preferences and discoveries, injects context into the session |
| Keyword detector | `UserPromptSubmit` | Detects keywords like "ultrawork" and activates enhanced modes |
| Feedback capture | `PostToolUse` | Passively records corrections, preferences, and discoveries |
| Agent tracking | `PreToolUse` | Tracks agent spawns for the learning system |
| Persistence | `Stop` | Blocks session exit when incomplete todos remain |
| Discovery capture | `PostToolUse` | Records technical insights agents discover about the codebase |

### Platform differences

On Unix (macOS, Linux), hooks default to Bash scripts that call into the bundled JavaScript:

```bash
#!/bin/bash
node "$HOME/.claude/hooks/olympus-hooks.cjs" session-start
```

On Windows, hooks use Node.js scripts (`.mjs`) directly:

```javascript
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const hooks = require('./olympus-hooks.cjs');
hooks.sessionStart();
```

---

## The Full Picture

```
npm package (olympus-ai)
├── dist/                          Compiled TypeScript
│   ├── cli/index.js               CLI entry point ("olympus-ai" command)
│   ├── installer/index.js         Copies resources → ~/.claude/
│   ├── hooks/olympus-hooks.cjs    Bundled hook runtime
│   └── ...                        Learning system, config, features
├── resources/                     Raw markdown content
│   ├── agents/*.md                Agent definitions
│   ├── skills/*/SKILL.md          Slash command prompts
│   └── rules/**/*.md              AI-DLC workflow rules
└── .claude-plugin/                Claude Code plugin manifest

                    ┌──────────────────┐
                    │ olympus-ai install│
                    └────────┬─────────┘
                             │ reads resources/, writes to ~/.claude/
                             ▼
~/.claude/                                    ◄── Claude Code config directory
├── CLAUDE.md              System instructions (Claude reads this)
├── agents/*.md            Subagent definitions (Claude reads these)
├── skills/*/SKILL.md      Slash commands (Claude reads these)
├── hooks/                 Runtime scripts (Claude Code executes these)
│   └── olympus-hooks.cjs  Bundled hook logic
├── olympus/
│   ├── rules/**/*.md      AI-DLC workflow rules (Claude reads these)
│   └── learning/          Accumulated learning data
└── settings.json          Hook registrations (Claude Code reads this)
```

### Summary

- **Markdown** is what Claude reads. It defines who the agents are, what the skills do, and how workflows proceed.
- **TypeScript** is the machinery that gets the markdown into the right place, powers the CLI, and runs hooks during sessions.
- **The npm package** is a delivery vehicle. After installation, the package itself is not imported or required by anyone. Claude Code reads from `~/.claude/` and the hooks run as standalone scripts.
- **Users never interact with TypeScript directly.** They run `olympus-ai install`, use slash commands in Claude Code, and the rest is invisible.
