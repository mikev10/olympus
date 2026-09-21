# Automating the external review

**Status:** design approved 2026-09-20. Not yet built.
**Branch:** `tooling/review-automation`, off `v2` at `c49adf3`.

## The problem

Step 5 of the unit loop is manual. `review-request` writes a prompt and a
bundle; the maintainer opens a third-party chat, attaches the bundle, pastes the
prompt, waits, copies the reply back, and runs `triage-review`. P5 went through
this twice in one day, once per family.

The cost is not the typing. It is that the loop's slowest step is gated on a
human being awake, and that the reviewer family is chosen by whatever the
maintainer has patience for rather than by what the unit needs.

## What changes, and what does not

`review-request` does not change. It still derives the range, writes the bundle,
writes the prompt, commits both, and pushes — **before any reviewer sees them.**
That ordering is the property that lets a later reader check the reviewer was
not steered, and automation does not touch it.

A new `run-review` invokes two third-party CLIs against those committed
artifacts and writes their replies untouched. `triage-review` reads the replies
from disk instead of from a paste.

```
  4. /review-request <id>      unchanged: range, bundle, prompt, commit, push
                               |
  5. /run-review <id>          NEW. one committed script, twice, in parallel:
        +----------------+     +----------------+
        |  codex exec    |     |  gemini        |   each in its own scratch
        |  scratch CODEX |     |  scratch cfg   |   cwd + scratch config home
        |  _HOME, ro     |     |  -e none, ro   |   holding only a cred file
        +-------+--------+     +-------+--------+
                |                      |
                v                      v
         -review-codex.md       -review-gemini.md        raw reply, untouched
         -review-codex.run.json -review-gemini.run.json  manifest
                               |
  6. /triage-review <id>       reads both from disk; a fresh-context subagent
                               verifies each finding against the cited code;
                               cross-family agreement becomes a triage input
                               |
  7. merge + git tag reviewed/<id>     unchanged, still the maintainer's
```

## Decisions taken

**The automated run is the review, corroborated by artifacts — not a screening
pass.** The manual loop had a property this one loses: the maintainer was a
witness, and nothing in the chain was authored by the system that built the
unit. Automation replaces that with self-attestation plus corroboration. See
*What this does not prove*.

**Both families, every unit, in parallel.** Rotation existed because reviews
were rationed by human patience. They no longer are. Running Codex and Gemini
on every unit gives two independent passes and makes disagreement between them
a signal in its own right. The family-rotation bookkeeping is retired: there is
no repeat to record when both run every time.

**Codex by subscription sign-in; Gemini by paid API key** (amended 2026-09-21). The original decision was subscription sign-in for both. Google has since retired the OAuth path for individual accounts in the Gemini CLI — it now fails with "This client is no longer supported for Gemini Code Assist for individuals." The remaining options were a Gemini API key or Vertex AI. A **paid** key was chosen over a free one because Google's API terms say free-tier content is used "to provide, improve, and develop Google products and services" and that "human reviewers may read, annotate, and process your API input and output" — and the bundle is the full source of every changed file, sent on every unit. The paid tier carries no such use. The cost is about $0.20 per review at ~100k input tokens against Gemini 3.1 Pro, which is not a consideration at one unit per session. A side benefit: the key arrives as an environment variable, so Gemini's scratch config home holds nothing at all, which is stricter isolation than a copied credential file.

**Subscription sign-in for Codex.** `codex login` against a ChatGPT
Plus/Pro account and a Google account for Gemini. One interactive browser login
each, cached, headless afterward. A bundle is roughly 100k input tokens; on
metered keys that is a real per-unit cost on both sides, twice over.

**No model is pinned.** Neither CLI's model lineup is canonically documented and
both have churned. The runner records the model the CLI reports rather than
asserting one — the same discipline the runtime uses for status: derive, never
declare.

**`ship-unit` stops after the artifacts.** It keeps chaining into
`review-request` and then prints `/run-review <id>` and stops. Its documented
justification for chaining (`ship-unit` step 6) is that `review-request` "opens
nothing, sends nothing, merges nothing, and contacts no reviewer… there is
nothing to undo." `run-review` falsifies three of those clauses, and egress is
the one step in this loop that cannot be undone. Deleting a file afterward
recovers nothing. Sending the source of every changed file to two vendors stays
a deliberate act, costing one command per unit.

## Amended after measurement: how the bundle reaches the reviewer

**This section overrides the runner and clean-room sections below wherever they disagree.** They describe a design in which each reviewer reads the bundle from a file. On 2026-09-21 that was measured, and neither did:

- **Gemini CLI, `@bundle.txt`:** 32,893 input tokens against ~126,000 for the whole bundle. It inlined roughly the first 2000 lines, then called `read_file` and `grep_search` to find what it was asked for, and answered correctly without reading the middle. A reviewer that greps for answers reviews only what it chose to look at — and a grep tool can jump straight to the end nonce, so the nonce alone does not catch it.
- **Gemini CLI, bundle on stdin:** hung before sending any request, by file redirect and by pipe.
- **Codex CLI, bundle as a file:** "file access blocked by policy". On Windows, `--sandbox read-only` blocks reading even the working directory. It reported the values as unavailable rather than inventing them, and the echo check would have refused it — the safeguards held; the path did not.

What was measured to work, and what the design now is:

- **The bundle is inlined into the prompt.** Neither reviewer is asked to read a file. The work directory Codex runs in is empty.
- **Codex stays a CLI:** `codex exec -` with the payload on stdin. 127,096 input tokens; reproduced the bundle's final line verbatim. It still needs the scratch `CODEX_HOME`, because the real one holds memory and conversation history.
- **Gemini becomes a direct `generateContent` API call.** 126,072 prompt tokens; reproduced the final line verbatim. The request offers **no tools**, so the model has nothing to navigate with. An API call loads no `GEMINI.md`, no settings, no extensions and no sessions, so **there is no clean room to build for this family at all.** The model must be named in the request, so `gemini-3.1-pro-preview` is pinned — with the reported `modelVersion` recorded separately and **no automatic fallback**, because a silent downgrade to a weaker model is a weaker adversary nobody chose.
- **A second integrity check, stronger than the nonce:** the vendor-reported input token count must reach a floor of the payload's bytes divided by 5. Measured ratios were 3.18 and 3.20 bytes per token, so an honest run clears it easily, while both measured failures (32,893 and 24,181 tokens) fall far beneath it. It is measured by the vendor's API rather than reported by the model, so a reviewer cannot fake it, and it catches navigation as well as truncation. The nonce stays as an independent second check.

The maintainer approved this on 2026-09-21. The Gemini CLI installed in Task 1 is no longer used.

## The runner

`scripts/run-external-review.ts <UNIT> <codex|gemini>`, invoked as
`node scripts/run-external-review.ts P5 codex`. Tracked, not generated: a
generated script proves nothing about what ran.

**TypeScript rather than shell** (amended 2026-09-20, after the design was
approved). The repository has no tracked `.sh` file, so a shell runner would set
a precedent; its testable logic — the clean-room assertion, the integrity echo,
the manifest — is pure functions over inputs, which `bats-core` would have to be
added to exercise; and the fragile part on Windows is exactly the path and
environment handling that shell does worst. TypeScript uses the `vitest ^4.1.11`
already installed at the workspace root, obeys the project's strict/no-`any`
convention, and runs directly on Node 24 via native type stripping with no build
step.

Per invocation:

1. Resolve the committed prompt and bundle for the unit. Refuse if either is
   absent, uncommitted, or modified relative to HEAD.
2. Create two scratch directories — a working directory and a config home.
3. Copy **only** the credential file into the config home: `auth.json` for
   Codex, `oauth_creds.json` for Gemini. Nothing else.
4. Copy the bundle into the working directory under the exact filename the
   committed prompt already names, so the prompt needs no per-mode rewording.
5. **Assert the clean room, and refuse to run if any assertion fails.** Record
   a full recursive listing of both scratch directories in the manifest as
   positive proof rather than asserting cleanliness in prose.
6. Invoke the CLI read-only and non-interactive under a hard 900-second
   timeout. A hang fails; it does not wait.
7. Verify bundle integrity from the reply (below). A mismatch marks the run
   `INTEGRITY_FAILED` and the review does not count.
8. Write the raw reply verbatim, the manifest, and the stripped session log.
9. Delete the scratch directories. The manifest's listings are the record.

A non-zero exit, a timeout, a failed clean-room assertion, or a failed
integrity check all mark the run failed and produce no counted review. Nothing
degrades to a partial review.

### The two invocations

Codex reads the bundle itself with its own read-only shell tool, so the
committed prompt goes in unmodified:

```
CODEX_HOME=<scratch-cfg> codex exec \
  --sandbox read-only --ask-for-approval never \
  --ignore-user-config --json -o <final-message-path> -
```

with the prompt on stdin and the working directory holding the bundle.
`codex exec` already defaults to a read-only sandbox with approval hardcoded to
`never`; both flags are passed explicitly anyway so the manifest's argv records
the intent rather than relying on a default that can change.

Gemini must not fetch the bundle through a tool. In non-interactive mode any
tool call needing confirmation blocks forever rather than failing, so the
bundle is injected as prompt content:

```
cat <prompt> | gemini --output-format stream-json -e none -p "@<bundle-name>"
```

stdin carries the committed prompt verbatim; `-p` carries only the transport
directive, which the manifest records as part of the exact argv.
`stream-json` is used rather than `json` because its `init` event is the only
documented place the resolved model id appears.

### The clean room

Neither CLI is isolated by working directory. Codex loads `~/.codex/AGENTS.md`
and `~/.codex/config.toml` regardless of cwd, and `--ignore-user-config` drops
the config but not the global `AGENTS.md`. Gemini loads `~/.gemini/GEMINI.md`
always, plus `~/.gemini/settings.json`, which can itself pull in MCP servers
and extensions.

No documented flag suppresses either global instruction file. So isolation is
achieved by construction — a config home containing nothing but a credential
file — and proved by listing that directory, not by trusting a flag.

Asserted before every run: no global or project `AGENTS.md`/`GEMINI.md`
reachable, no `settings.json` or `config.toml`, no MCP server declarations, no
prior session or checkpoint data, and no context file in the working directory.

### Bundle integrity

This is the design's most dangerous failure mode, and the reason it gets its
own mechanism.

Gemini's `@`-injection has no documented truncation, but the underlying read
path carries a roughly 2,000-line default cutoff (upstream issues #19344,
#10644, absent from official docs). Bundles run to ~10,000 lines. A truncated
bundle yields a reviewer that honestly read two-thirds of the code and reported
findings on it — a confident clean review of code nobody looked at, with
nothing downstream able to tell.

The prompt already makes the reviewer confirm the bundle is *present*. It will
now also make it confirm the bundle is *whole*, by stating:

- the `BASE:` and `HEAD:` values from the bundle's first two lines
- the file path in the bundle's final `===== <path> =====` section header

The runner knows all three independently, so a mismatch is caught mechanically
rather than trusted. Applied to both families, not just Gemini: an undetected
truncation on either side is the same defect.

### The manifest

`<date>-<UNIT>-<slug>-review-<family>.run.json` records the exact argv and
environment overrides; recursive listings of both scratch directories; the
clean-room assertion results; exit code; start and end timestamps and
wall-clock duration; CLI version; the model id the CLI reported; token usage;
the bundle's SHA-256; and the integrity-echo comparison.

The CLI's own session log is committed as `-review-<family>.session.jsonl` with
**metadata records only** — `session_meta`, `turn_context`,
`token_usage_record` — message bodies stripped. The full rollout log restates
the entire 400 KB bundle; committing that per family per unit would multiply
the repository for no evidentiary gain.

## Where subagents go

**Not on the review runs.** The argument for this whole design is that Claude
Code never touches the review text. A subagent invoking the CLI and reporting
back re-inserts a Claude-authored link into the chain being kept clean, and
buys nothing: the script writes the files directly, so the orchestrating
session never loads a bundle or a reply either way. Two background invocations
give the parallelism without the tamper surface.

**On triage verification instead.** `triage-review` states its own purpose as
preventing agreement — "a plausible finding from a strong reviewer is easy to
fix without first checking whether it describes the code." The session most
likely to agree is the one that wrote the code. Each finding therefore goes to
a subagent that receives the finding and the cited file, does not know the code
is Claude-authored, and returns confirmed / not-in-the-code / partly-right.
That is fresh context aimed at the step where it changes outcomes.

## Skill and document changes

- **`review-request`**: steps 1–5 unchanged. Step 4's prompt template gains the
  integrity-echo items. Steps 6–8 (clipboard, rotation recommendation, paste
  instructions) are replaced by a hand-off printing `/run-review <id>`.
- **`ship-unit`**: step 6's chaining rationale is restated to end at the
  artifacts, naming `/run-review` as the maintainer's next explicit act.
- **`triage-review`**: takes two review files by path instead of pasted text.
  `Reviewer:` is derived from the manifest rather than asked for. `Family
  rotation:` is removed. A cross-family agreement field is added. Finding
  verification dispatches to fresh-context subagents.
- **`WORKFLOW.md`**: step 5 currently reads "External review — temporary chat,
  different model family than last unit. Rotate." It becomes the `run-review`
  step with both families.
- **`docs/decisions.md`**: records that external review is now self-attested
  with artifact corroboration, in the plain terms of the next section.
- **Naming**: replies become `-review-codex.md` and `-review-gemini.md`,
  superseding `-adversarial-review.md`. Adversarial is now the only kind, so
  the word no longer distinguishes anything; the family does.

## What this does not prove

Corroboration is not a witness. A determined author-system could write a
plausible manifest beside a plausible review. What the artifacts make hard is
doing it consistently — matching timestamps, token counts, a CLI version, a
model name, and an integrity echo across two vendors, every unit, without
divergence.

That is a meaningful raise in the cost of fabrication. It is not the same as a
human having watched the review happen, and no PR body, README line, or
capability claim may imply that it is.

One further consequence, stated once so it is not discovered later: this turns
the bundle's egress to OpenAI and Google from a deliberate manual act into a
routine automated one. Same data as today, higher frequency, less deliberation
per occurrence. Keeping `/run-review` a separate explicit command is the
mitigation.

## Probes before the build

Two facts are undocumented and the design must not rest on assumption. Both are
answered by installing the CLIs and doing one throwaway run.

**P1 — Gemini's config-home override.** Whether the config directory can be
redirected without overriding `HOME`, which is awkward on Windows. If no such
mechanism exists, the fallback is a per-run `HOME` override with the credential
file copied in, and if that also fails the clean-room assertion refuses to run
rather than reviewing with a global `GEMINI.md` in context. Failing closed is
the correct outcome, not a blocked build.

**P2 — which Gemini model a personal account actually reaches.** Pro reportedly
moved behind billing on the free tier. If the account yields Flash, the reviewer
is a weaker adversary than the manual loop provided. The manifest will show it
either way; the decision of whether that is acceptable is the maintainer's, made
against a recorded model name rather than an assumption.

## Out of scope

- Any change to Olympus package code. This is maintainer tooling under
  `scripts/` and `.claude/skills/`. The `review` station and its drivers are
  their own units and are not touched here.
- CI execution. The runner is a local command; wiring it into a pipeline needs
  credential handling that subscription OAuth does not provide.
- Reviewer families beyond Codex and Gemini.
- Automating triage decisions. Triage still verifies every finding against the
  cited code, and the merge gate stays with the maintainer.
