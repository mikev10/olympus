# Terminal Output Formatting Standards

Claude Code renders markdown via an Ink/React TUI renderer with ANSI escape codes. Plain paragraphs are visually invisible — they blend into the response stream. These rules ensure critical information is scannable.

## The Core Problem

In a terminal, the user sees a continuous stream of white text. Only these elements create visual differentiation:

| Element | Renders As | Use For |
|---------|-----------|---------|
| `# H1` / `## H2` | Colored text (red/orange) | Section breaks, banners |
| `**bold**` | Bold weight | Key terms, labels |
| `` `inline code` `` | Distinct background/color | Commands, file paths, values |
| `> blockquote` | Indented with left border | Callouts, important notes |
| `---` | Horizontal rule | Visual fences/separators |
| Emojis | Colored glyphs | Status indicators, anchors |
| Code blocks | Syntax-highlighted box | Code, structured data |

**Rule: Anything the user must act on or notice MUST use at least two of these elements. Never deliver critical info as a plain paragraph.**

---

## Emoji Vocabulary (Standardized)

Use consistently so users learn the visual language:

| Emoji | Meaning | When to Use |
|-------|---------|-------------|
| 🚀 | Workflow start / launch | Welcome banners, phase kickoffs |
| 📌 | Action required | User needs to do something NOW |
| ✅ | Success / complete | Task done, tests pass, validation pass |
| ⚠️ | Warning / attention | Non-blocking but important |
| ❌ | Error / failure | Something broke, blocking issue |
| 🔍 | Context / analysis | Showing inferred or extracted info |
| 📋 | Summary / recap | Phase summaries, status reports |
| 💡 | Recommendation / tip | AI suggestions, best practices |
| ⏳ | In progress / waiting | Long-running operations |
| 🔄 | Iteration / retry | Re-running, looping back |

**Do NOT use emojis in markdown headers that will be written to files** (breaks TOCs and parsers). Emojis are for terminal display output only.

---

## Output Patterns

### Pattern 1: Welcome / Phase Banner

```markdown
---
## 🚀 Welcome to AI-DLC! Starting a new workflow for Group 1B

**Workflow:** `group-1b-test-quality` — Test Quality & Traceability
**Builds on:** Group 1A test infrastructure (confirmed ✅)
---
```

Why it works: `---` fences create a visual box. `##` renders in color. Emoji grabs the eye. Bold labels + inline code for scannable key-value pairs.

---

### Pattern 2: Action Required (MOST IMPORTANT)

Use this whenever the user needs to do something. This is the pattern that matters most.

```markdown
---
## 📌 Action Required

Fill in the `[Answer]:` tags in the file below, then say **"done"** to continue.

> For multi-select questions, provide comma-separated letters (e.g., `A, B, E`).

**File:** `aidlc-docs/group-1b-test-quality/inception/intent-questions.md`
---
```

Why it works: The `📌 Action Required` header is an unmissable colored+emoji signal. The command uses `inline code` and `**bold**`. The secondary instruction lives in a `> blockquote` so it's visually subordinate but still distinct. File path is in code formatting.

---

### Pattern 3: Status / Progress Update

```markdown
✅ All 3,360 tests pass — Group 1A prerequisite confirmed.

⏳ Generating intent questions file...
```

Why it works: Emoji-first lines create a scannable status log. Each line starts with a visual indicator.

---

### Pattern 4: Validation Summary

```markdown
## 📋 Validation Summary

| Check | Status | Detail |
|-------|--------|--------|
| Tests pass | ✅ | 3,360 / 3,360 |
| Prerequisites met | ✅ | Group 1A complete |
| Manifest valid | ⚠️ | Missing `coverage-config.json` |
```

Why it works: Tables with emoji status create an at-a-glance dashboard. The `##` header separates it from surrounding text.

---

### Pattern 5: Error / Blocking Issue

```markdown
---
## ❌ Blocking Issue

**What failed:** Contract validation for `UserService.create()`
**Why:** Missing required field `email` in test fixture at `tests/fixtures/users.ts:42`

> Fix the fixture and re-run with **"retry"**.
---
```

---

### Pattern 6: Context Extraction / Inference Review

```markdown
## 🔍 Context Extracted from Your Input

- **Problem:** AI-generated tests have documented failure modes...
- **Primary users:** Olympus OSS users running AI-DLC workflows...
- **Scope:** Four capabilities — anti-pattern detection, traceability...
- **Success criteria:** Each capability integrates into the pipeline...

> Please correct anything that is wrong, then say **"confirmed"**.
```

Why it works: The `🔍` signals "I'm showing you what I understood." Bold labels on each bullet make it scannable. The blockquote at the end is the action prompt.

---

## Anti-Patterns (Never Do This)

| Bad | Good | Why |
|-----|------|-----|
| Plain paragraph for action prompts | `## 📌 Action Required` header | Paragraphs are invisible |
| Burying instructions in the middle of text | Action prompt at the END, fenced with `---` | Users scan bottom-first for "what do I do now" |
| Multiple action items in one paragraph | One action per bold line or bullet | Cognitive overload |
| Emoji in file-output headers (`# 🔍 Intent`) | Emoji only in terminal display text | Breaks file parsers/TOCs |
| Wall of unbroken text explaining context | Bullet list with `**bold labels**` | Scannable vs. readable |

---

## Quick Rules (For Skill Authors)

1. **Every phase transition** gets a `---` fenced `##` header with emoji
2. **Every action prompt** uses `## 📌 Action Required` pattern
3. **Every status update** starts with an emoji indicator (✅ ⚠️ ❌ ⏳)
4. **Every user-facing value** (file paths, commands, inputs) uses `inline code`
5. **Every "what to do next"** instruction uses `**bold**` for the key action word
6. **Never deliver critical information as a plain paragraph**
7. **Action prompts go at the END** of the response, not buried in the middle
