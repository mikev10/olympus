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
 ║  stripped session log        ║
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
| `<date>-<UNIT>-<slug>-review-codex.md` | `run-review` | Codex's reply, untouched. `triage-review` prepends a provenance header and changes nothing beneath it |
| `<date>-<UNIT>-<slug>-review-gemini.md` | `run-review` | Gemini's reply, on the same terms |
| `<date>-<UNIT>-<slug>-review-<family>.run.json` | `run-review` | That run's manifest: the exact argv, the clean-room listing, exit code, timestamps and wall-clock, CLI version, the model the CLI reported, token usage, the bundle's SHA-256, and the integrity verdict |
| `<date>-<UNIT>-<slug>-review-<family>.session.jsonl` | `run-review` | The CLI's own session log, metadata records only, message bodies stripped |
| `<date>-<UNIT>-<slug>-triage.md` | `triage-review` | What each finding turned out to be, and what was done |

Only the first two leave the repository, and the runner is what sends them. The
rest are records.
