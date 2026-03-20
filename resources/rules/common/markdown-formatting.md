# Markdown Formatting Standards

## MANDATORY: All Generated Markdown Must Pass markdownlint

**CRITICAL**: Every markdown file you create or modify MUST comply with the [markdownlint](https://github.com/DavidAnson/markdownlint) rule set (v0.40.0). The project enforces these rules via `.markdownlint.json` at the workspace root. Violations will cause linter failures on save.

## Project Configuration Overrides

The project `.markdownlint.json` modifies the defaults as follows. **Always respect these overrides:**

| Setting       | Value                                                                | Effect                                                                                        |
|---------------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `default`     | `true`                                                               | All rules enabled unless explicitly disabled                                                  |
| `frontMatter` | `"^---\s*$[\s\S]*?^---\s*$"`                                         | YAML frontmatter blocks are recognized and excluded from rules                                |
| `MD013`       | `false`                                                              | **Line length is NOT enforced** — no maximum line width                                       |
| `MD024`       | `{ "siblings_only": true }`                                          | Duplicate headings allowed if they are NOT siblings (same parent)                             |
| `MD033`       | `{ "allowed_elements": ["br", "details", "summary", "sup", "sub"] }` | Inline HTML forbidden EXCEPT these five elements                                              |
| `MD036`       | `false`                                                              | **Emphasis-as-heading is allowed** — bold text may serve as pseudo-headings                   |
| `MD041`       | `false`                                                              | **First line need not be an H1** — files may start with frontmatter, badges, or other content |

## Editor Integration

The project `.vscode/settings.json` configures:

- **markdownlint runs on save** — violations are flagged immediately
- **Format on save** enabled with `markdown-table-prettify` as the default formatter
- **Word wrap off** — lines are not soft-wrapped in the editor

When generating tables, produce clean pipe-aligned tables since the prettifier will reformat them on save.

---

## Rule Reference

All 54 active markdownlint rules organized by category. Rules disabled by project config are marked with **(DISABLED)**.

### Document Structure

| Rule  | Alias                     | Requirement                                                            |
|-------|---------------------------|------------------------------------------------------------------------|
| MD001 | `heading-increment`       | Heading levels must increment by one (no skipping H2 to H4)            |
| MD025 | `single-h1`               | Only one H1 (`#`) per document. YAML frontmatter `title:` counts as H1 |
| MD041 | `first-line-h1`           | **(DISABLED)** First line need not be a top-level heading              |
| MD043 | `required-headings`       | Required heading structure if configured (default: not configured)     |
| MD047 | `single-trailing-newline` | File MUST end with exactly one newline character                       |

### Headings

| Rule  | Alias                          | Requirement                                                                                    |
|-------|--------------------------------|------------------------------------------------------------------------------------------------|
| MD003 | `heading-style`                | Use consistent heading style — use ATX style (`# Heading`) throughout                          |
| MD018 | `no-missing-space-atx`         | Must have a space after `#` in headings: `# Heading` not `#Heading`                            |
| MD019 | `no-multiple-space-atx`        | Only one space after `#`: `# Heading` not `#  Heading`                                         |
| MD020 | `no-missing-space-closed-atx`  | Closed ATX headings need inner spaces: `# Heading #`                                           |
| MD021 | `no-multiple-space-closed-atx` | Only one space inside closed ATX hashes                                                        |
| MD022 | `blanks-around-headings`       | One blank line BEFORE and AFTER every heading                                                  |
| MD023 | `heading-start-left`           | Headings must start at column 1 (no indentation)                                               |
| MD024 | `no-duplicate-heading`         | No duplicate heading text among **siblings** (same-parent headings may repeat across sections) |
| MD026 | `no-trailing-punctuation`      | Headings must not end with `.` `,` `;` `:` `!` or their CJK equivalents                        |
| MD036 | `no-emphasis-as-heading`       | **(DISABLED)** Bold/italic text may be used as pseudo-headings                                 |

### Lists

| Rule  | Alias                 | Requirement                                                                    |
|-------|-----------------------|--------------------------------------------------------------------------------|
| MD004 | `ul-style`            | Use consistent unordered list markers — use `-` (dash) for all unordered lists |
| MD005 | `list-indent`         | Sibling list items must have consistent indentation                            |
| MD007 | `ul-indent`           | Indent nested unordered list items by **2 spaces**                             |
| MD029 | `ol-prefix`           | Ordered lists: use `1.` for all items OR sequential numbering — be consistent  |
| MD030 | `list-marker-space`   | Exactly one space after list markers (`-`, `1.`)                               |
| MD032 | `blanks-around-lists` | One blank line BEFORE and AFTER every list block                               |

### Code Blocks and Fences

| Rule  | Alias                  | Requirement                                                |
|-------|------------------------|------------------------------------------------------------|
| MD010 | `no-hard-tabs`         | No tab characters — use spaces only                        |
| MD014 | `commands-show-output` | Don't prefix commands with `$` unless showing output below |
| MD031 | `blanks-around-fences` | One blank line BEFORE and AFTER every fenced code block    |
| MD040 | `fenced-code-language` | Fenced code blocks MUST specify a language (e.g., ` ```typescript `)            |
| MD046 | `code-block-style`     | Use consistent code block style — use **fenced** (backtick) style, not indented |
| MD048 | `code-fence-style`     | Use consistent fence delimiters — use **backticks** (`` ` ``), not tildes (`~`) |

### Whitespace and Formatting

| Rule  | Alias                  | Requirement                                                                            |
|-------|------------------------|----------------------------------------------------------------------------------------|
| MD009 | `no-trailing-spaces`   | No trailing whitespace at end of lines. Use `<br>` for intentional line breaks         |
| MD012 | `no-multiple-blanks`   | Maximum one consecutive blank line between elements                                    |
| MD013 | `line-length`          | **(DISABLED)** No maximum line length enforced                                         |
| MD035 | `hr-style`             | Use consistent horizontal rules — use `---`                                            |
| MD037 | `no-space-in-emphasis` | No spaces inside emphasis: `**bold**` not `** bold **`                                 |
| MD038 | `no-space-in-code`     | No leading/trailing spaces inside backtick code spans: `` `code` `` not `` ` code ` `` |
| MD049 | `emphasis-style`       | Use consistent emphasis markers — use `*` (asterisk) for italics                       |
| MD050 | `strong-style`         | Use consistent strong markers — use `**` (double asterisk) for bold                    |

### Links and Images

| Rule  | Alias                              | Requirement                                                               |
|-------|------------------------------------|---------------------------------------------------------------------------|
| MD011 | `no-reversed-links`                | Correct link syntax: `[text](url)` not `(text)[url]`                      |
| MD034 | `no-bare-urls`                     | URLs must be wrapped: `<https://example.com>` or `[text](url)` — not bare |
| MD039 | `no-space-in-links`                | No spaces inside link brackets: `[text](url)` not `[ text ](url)`         |
| MD042 | `no-empty-links`                   | Links must have a non-empty destination                                   |
| MD044 | `proper-names`                     | Proper names must use correct capitalization if configured                |
| MD045 | `no-alt-text`                      | Images MUST have alt text: `![description](image.png)`                    |
| MD051 | `link-fragments`                   | Link fragment anchors (`#section`) must reference valid headings          |
| MD052 | `reference-links-images`           | Reference-style links must use defined labels                             |
| MD053 | `link-image-reference-definitions` | Reference definitions must be used (no orphaned definitions)              |
| MD054 | `link-image-style`                 | Use consistent link style (inline, reference, etc.)                       |
| MD059 | `descriptive-link-text`            | Avoid generic link text like "click here", "here", "link", "more"         |

### Blockquotes

| Rule  | Alias                          | Requirement                                             |
|-------|--------------------------------|---------------------------------------------------------|
| MD027 | `no-multiple-space-blockquote` | Only one space after `>`: `> text` not `>  text`        |
| MD028 | `no-blanks-blockquote`         | No blank lines inside a blockquote (splits it into two) |

### Tables

| Rule  | Alias                  | Requirement                                                    |
|-------|------------------------|----------------------------------------------------------------|
| MD055 | `table-pipe-style`     | Use consistent pipe style — include leading and trailing pipes |
| MD056 | `table-column-count`   | All rows must have the same number of columns                  |
| MD058 | `blanks-around-tables` | One blank line BEFORE and AFTER every table                    |
| MD060 | `table-column-style`   | Use consistent column alignment syntax in delimiter rows       |

### Inline HTML

| Rule  | Alias            | Requirement                                                                             |
|-------|------------------|-----------------------------------------------------------------------------------------|
| MD033 | `no-inline-html` | Inline HTML is **forbidden** except: `<br>`, `<details>`, `<summary>`, `<sup>`, `<sub>` |

---

## Quick Reference: Most Common Violations

When generating markdown, watch for these frequent issues:

1. **Missing blank lines** (MD022, MD031, MD032, MD058) — Always surround headings, code blocks, lists, and tables with blank lines
2. **Trailing whitespace** (MD009) — Strip trailing spaces from every line
3. **No language on code fences** (MD040) — Always specify a language: use `text` or `markdown` when no syntax applies
4. **Multiple H1 headings** (MD025) — Only one `#` per file; use `##` and below for sections
5. **Inconsistent list markers** (MD004) — Always use `-` for unordered lists
6. **Bare URLs** (MD034) — Wrap URLs in angle brackets or make them proper links
7. **Missing final newline** (MD047) — Files must end with exactly one `\n`
8. **Heading level skips** (MD001) — Go `#` then `##` then `###` — never skip levels
9. **Missing image alt text** (MD045) — Every `![](image)` needs descriptive alt text
10. **Spaces inside emphasis/code** (MD037, MD038) — No spaces inside `**`, `*`, or backticks

## Pre-Write Validation Checklist

Before writing ANY markdown file, verify:

- [ ] Single `#` H1 (or none if frontmatter has `title:`)
- [ ] Heading levels increment by one (no skips)
- [ ] Blank lines around all block elements (headings, lists, code blocks, tables, blockquotes)
- [ ] No trailing whitespace on any line
- [ ] No consecutive blank lines
- [ ] All code fences specify a language
- [ ] Code fences use backticks, not tildes
- [ ] Unordered lists use `-` consistently
- [ ] List indentation uses 2 spaces
- [ ] No bare URLs
- [ ] All images have alt text
- [ ] No forbidden inline HTML (only `<br>`, `<details>`, `<summary>`, `<sup>`, `<sub>` allowed)
- [ ] File ends with exactly one newline
- [ ] No tab characters anywhere
- [ ] Tables have consistent column counts and pipe style
