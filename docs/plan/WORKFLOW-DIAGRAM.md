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
 │  writes 2 files, copies      │
 │  prompt, prints REVIEW READY │
 └──────────────┬───────────────┘
                │   docs/reviews/…-review-prompt.txt  (paste)
                │   docs/reviews/…-review-bundle.txt  (attach)
                ▼
 ╔══════════════════════════════╗
 ║ EXTERNAL REVIEW              ║  YOU, outside Claude
 ║  temporary chat, a different ║
 ║  model family from last unit ║
 ║  attach bundle + paste prompt║
 ║  note the model name         ║
 ║  copy the whole reply        ║
 ╚══════════════╤═══════════════╝
                ▼
 ┌──────────────────────────────┐
 │ /triage-review P5            │  Claude, NEW session
 │  + paste reply + model name  │  on branch unit/p5
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
2. When `REVIEW READY` prints, open the two files it names.
3. Run the external review in the other chat: attach the bundle, paste the prompt.
4. In a new session, type `/triage-review <id>` and paste the reply with the
   model name.
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
| `<date>-<UNIT>-<slug>-review-prompt.txt` | `review-request` | The text you paste into the reviewer's chat |
| `<date>-<UNIT>-<slug>-review-bundle.txt` | `review-request` | The file you attach: every changed file, in full |
| `<date>-<UNIT>-<slug>-review.md` | `triage-review` | The reviewer's reply, verbatim, under a provenance header |
| `<date>-<UNIT>-<slug>-triage.md` | `triage-review` | What each finding turned out to be, and what was done |

Only the first two are ever handed to anyone. The last two are records.
