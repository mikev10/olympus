# Workflow diagram

The unit loop from `WORKFLOW.md` drawn as a picture: the order of the skills,
who runs each step, and where one Claude session ends and the next begins.
`WORKFLOW.md` is the authority; if the two ever disagree, it wins.

```
 ONE UNIT, START TO FINISH                            who / where
 ─────────────────────────────────────────────────────────────────────────
 ┌──────────────────────────────┐
 │ /start-unit P5               │  Claude, NEW session
 │  loads spec, checks deps,    │
 │  states the boundary         │
 └──────────────┬───────────────┘
                │ spec missing parts, or contract change needed?
                ├──────────────► asks YOU, then continues
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
                │ nothing sent yet — YOU type the next command
                ▼
 ╔══════════════════════════════╗
 ║ /run-review P5               ║  YOU type it, Claude runs it
 ║  the committed runner, once  ║
 ║  per family: codex, gemini   ║
 ║  sends the bundle out of the ║
 ║  repo — this cannot be undone║
 ║  each run: reply, manifest,  ║
 ║  session record; committed   ║
 ║  untouched                   ║
 ╚══════════════╤═══════════════╝
                │ only a `counted` outcome is a review
                ▼
 ┌──────────────────────────────┐
 │ /triage-review P5            │  Claude, NEW session
 │  reads both replies from disk│  on branch unit/p5
 │  checks each finding against │
 │  the code, fixes on branch,  │
 │  writes triage, stops        │
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

## Your five touch points, in order

1. Type `/start-unit <id>`, and answer if it asks.
2. When `REVIEW ARTIFACTS READY` prints, type `/run-review <id>`. It is a
   separate command, and not part of the chain, because it is the step that
   sends the bundle to OpenAI and Google, and that cannot be taken back.
3. Read the two outcomes it prints, one per family. Only `counted` is a review.
4. In a new session, type `/triage-review <id>`. It reads both replies from
   disk; there is nothing to hand it.
5. Merge the PR, then push the tag.

## Session boundaries

- **One session** covers `start-unit`, the work, `ship-unit`, and
  `review-request`. Ship hands off to review-request without asking.
- **Triage always starts fresh**, on the unit's branch, because the review may
  come back days later.
- **The next unit also starts fresh.**

## The files a review leaves in `docs/reviews/`

| File | Written by | What it is |
|---|---|---|
| `<date>-<UNIT>-<slug>-review-prompt.txt` | `review-request` | The instructions the runner sends, verbatim |
| `<date>-<UNIT>-<slug>-review-bundle.txt` | `review-request` | What goes with them: every changed file, in full |
| `<date>-<UNIT>-<slug>-review-codex.md` | `run-review` | Codex's reply, as the runner wrote it and committed untouched. `triage-review` checks it against the manifest's `replySha256`, then prepends a provenance header and changes nothing beneath it |
| `<date>-<UNIT>-<slug>-review-gemini.md` | `run-review` | Gemini's reply, on the same terms |
| `<date>-<UNIT>-<slug>-review-<family>.run.json` | `run-review` | That run's manifest. The prompt-and-bundle pair the run was built from, with how many pairs matched the unit. How the reviewer was reached: for Codex the command, argv and redacted environment; for Gemini the method, the keyless URL, the model requested and header names only. The pre-run clean-room listing, `null` for Gemini, which loads no local configuration. Exit code and whether it timed out, timestamps and wall-clock, the CLI version (for Gemini, the API version), the model the vendor reported, token usage and the ingestion verdict against the payload's size and SHA-256 — a count produced by the vendor's service or the local CLI rather than by the model, and a lower bound on what was taken in, the post-run file count and recorded approval policy (Codex only, `null` for Gemini), the bundle's SHA-256, the echo verdict, the reply's SHA-256, and the derived outcome |
| `<date>-<UNIT>-<slug>-review-<family>.session.jsonl` | `run-review` | For Codex, its rollout log stripped to the `session_meta`, `turn_context`, `world_state` and `token_usage_record` records, message bodies dropped. For Gemini, which has no session, one line: the response's `modelVersion`, `responseId` and a validated subset of its `usageMetadata` — every numeric field plus `serviceTier`, nothing else — and the HTTP status of a failed call |
| `<date>-<UNIT>-<slug>-triage.md` | `triage-review` | What each finding turned out to be, and what was done |

Only the first two leave the repository, and the runner is what sends them. The
rest are records.
