# Workflow diagram

The unit loop from `WORKFLOW.md` drawn as a picture: the order of the skills,
who runs each step, and where one Claude session ends and the next begins.
`WORKFLOW.md` is the authority; if the two ever disagree, it wins.

```
 ONE UNIT, START TO FINISH                            who / where
 ─────────────────────────────────────────────────────────────────────────
 ┌──────────────────────────────┐
 │ /start-unit P5               │  YOU type it; Claude, NEW session
 │  loads spec, checks deps,    │
 │  reads the code it touches,  │
 │  verifies every assumption,  │
 │  records them in decisions   │
 └──────────────┬───────────────┘
                │ only on a rule-6 stop condition, at any step below
                ├──────────────► waits for YOU, then continues
                ▼
 ┌──────────────────────────────┐
 │ work the unit                │  Claude, same session
 │  conformance first,          │
 │  decisions logged            │
 └──────────────┬───────────────┘
                ▼
 ┌──────────────────────────────┐
 │ /ship-unit                   │  Claude, same session
 │  runs all gates, commits,    │  (any gate fails → stops)
 │  opens the PR                │
 └──────────────┬───────────────┘
                │ runs automatically
                ▼
 ┌──────────────────────────────┐
 │ /review-request              │  Claude, same session
 │  writes 2 files, commits,    │
 │  pushes, sends nothing       │
 └──────────────┬───────────────┘
                │   docs/reviews/…-review-prompt.txt  (committed)
                │   docs/reviews/…-review-bundle.txt  (committed)
                │ runs automatically while the repo is PUBLIC
                │ (anything else → stops, YOU type /run-review)
                ▼
 ┌──────────────────────────────┐
 │ /run-review P5               │  Claude, same session
 │  the committed runner, once  │
 │  per family: codex, gemini   │
 │  sends the bundle out of the │
 │  repo — this cannot be undone│
 │  each run: reply, manifest,  │
 │  session record; committed   │
 │  untouched                   │
 └──────────────┬───────────────┘
                │ only a `counted` outcome is a review
                │ a failed family reruns once; fails again → stops
                ▼
 ┌──────────────────────────────┐
 │ /triage-review P5            │  Claude, same session
 │  reads both replies from disk│  on branch unit/p5
 │  checks each finding against │
 │  the code, writes triage,    │
 │  applies accepted fixes test-│
 │  first, reruns gates, stops  │
 └──────────────┬───────────────┘
                ▼
 ╔══════════════════════════════╗
 ║ MERGE AND TAG                ║  YOU
 ║  merge the PR                ║
 ║  git tag reviewed/P5         ║
 ║  git push --tags             ║
 ╚══════════════╤═══════════════╝
                ▼
   land any amendments the unit surfaced  (only if any were raised)
                ▼
   next unit: first one whose dependencies have all shipped
                └──► back to /start-unit
```

## Your two touch points, in order

1. Type `/start-unit <id>`. Everything through triage and its fixes runs from
   there without asking. It stops early only on a stop condition from
   `CLAUDE.md` rule 6, a repository that is not `PUBLIC`, or a family that
   fails to count twice.
2. Read the final report — the triage counts, every decision the unit made on
   its own, and the gate state — then merge the PR and push the tag with the
   commands it prints.

## Session boundaries

- **One session** covers `start-unit`, the work, `ship-unit`,
  `review-request`, `run-review`, and `triage-review`. Each hands off to the
  next without asking.
- **A chain stopped early** resumes in a new session with the skill that
  stopped, or with `/handoff resume` after a disconnect.
- **The next unit starts fresh.**

## The files a review leaves in `docs/reviews/`

| File | Written by | What it is |
|---|---|---|
| `<date>-<UNIT>-<slug>-review-prompt.txt` | `review-request` | The instructions the runner sends, verbatim |
| `<date>-<UNIT>-<slug>-review-bundle.txt` | `review-request` | What goes with them: new files in full, modified files as function-context diffs |
| `<date>-<UNIT>-<slug>-review-codex.md` | `run-review` | Codex's reply, as the runner wrote it and committed untouched. `triage-review` checks it against the manifest's `replySha256`, then prepends a provenance header and changes nothing beneath it |
| `<date>-<UNIT>-<slug>-review-gemini.md` | `run-review` | Gemini's reply, on the same terms |
| `<date>-<UNIT>-<slug>-review-<family>.run.json` | `run-review` | That run's manifest. The prompt-and-bundle pair the run was built from, with how many pairs matched the unit. How the reviewer was reached: for Codex the command, argv and redacted environment; for Gemini the method, the keyless URL, the model requested and header names only. The pre-run clean-room listing, `null` for Gemini, which loads no local configuration. Exit code and whether it timed out, timestamps and wall-clock, the CLI version (for Gemini, the API version), the model the vendor reported, token usage and the ingestion verdict against the payload's size and SHA-256 — a count produced by the vendor's service or the local CLI rather than by the model, and a lower bound on what was taken in, the post-run file count and recorded approval policy (Codex only, `null` for Gemini), the bundle's SHA-256, the echo verdict, the reply's SHA-256, and the derived outcome |
| `<date>-<UNIT>-<slug>-review-<family>.session.jsonl` | `run-review` | For Codex, its rollout log stripped to the `session_meta`, `turn_context`, `world_state` and `token_usage_record` records, message bodies dropped. For Gemini, which has no session, one line: the response's `modelVersion`, `responseId` and a validated subset of its `usageMetadata` — every numeric field plus `serviceTier`, nothing else — and the HTTP status of a failed call |
| `<date>-<UNIT>-<slug>-triage.md` | `triage-review` | What each finding turned out to be, and what was done |

Only the first two leave the repository, and the runner is what sends them. The
rest are records.
