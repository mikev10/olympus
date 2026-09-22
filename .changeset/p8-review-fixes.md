---
"@olympus-ai/adapters": minor
"@olympus-ai/integrity": minor
---

P8 review fixes, from two external reviews of the adapters (codex and gemini),
triaged in `docs/reviews/2026-09-21-P8-adapters-triage.md`.

Reading a tree: a directory a config names must now be reached without passing
through a symbolic link, checked component by component below the repository
root — lexical containment read as inside the repository while `roots:
['<rootDir>/linked/tests']` enumerated a tree outside it. A vitest `include`
pattern that climbs out of the repository or names an absolute path is refused,
and the glob's results are checked for containment as well. A file is read in
bounded steps so the cap holds while the bytes arrive rather than after they are
all buffered. A special file where a config is expected is refused instead of
being compared as unchanged.

Coverage: the report may add obligations and never remove one. The denominator
is the union of the report's statement lines and the executable lines read from
the head tree, so an entry with an empty statement map, or one thinned by an
`istanbul ignore` comment, no longer scores 100%. Executable lines follow
istanbul's instrumenter rather than TypeScript's statement list: declarator
initialisers, arrow expression bodies, and class property initialisers.

Assertions: a negation removed is a weakening, not a strengthening, and a
negated pair that is not identical is reported rather than reasoned about. An
existence check turned into an equality is dropped only when the new expected
value provably satisfies the old check. Narrowing the tolerance of a negated
approximate matcher is reported, since it lets more values through. Whitespace
is collapsed between tokens and never inside a literal. A subject's type
arguments are part of the assertion, and a standalone `assertType` is one.

Markers: a declarer is resolved through an import rename, a `.extend(...)`
fixture binding, parentheses, and a string key, and a destructured `skip` is
followed under the name it was given. A declarer that escapes into a value, or
is selected by a computed key, is refused rather than reported as a file with no
markers.

Config reading: a config that imports repository code is refused, since that
code runs when the framework loads the config and no config change is reported
when it changes. A known default read more than once must be copied at every
reference. A module that mentions `module` or `exports` outside its single
export assignment is refused.

Patterns: `testRegex` and the two ignore lists are compiled to a state machine
and matched in one pass, so cost is the pattern's size times the path's length
rather than a power of it. Backreferences and lookaround are refused; the
nested-quantifier shapes that were refused before are matched safely now.

`ExpectationOutcome`'s arms exclude each other's evidence and its tuple is
readonly, so a held outcome carrying mismatches, and a failed one emptied with
`pop`, are compile errors rather than merely unusual.
