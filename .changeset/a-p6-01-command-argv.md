---
"@olympus-ai/integrity": minor
"@olympus-ai/api": minor
---

A-P6-01: `CheckSpec.command` becomes an argument vector, `readonly [string,
...string[]]`, run exactly as pinned with no shell. A check that needs one
names it, `['sh', '-c', '…']`. A manifest whose command is a string, an empty
vector, a blank program, or holds a non-string argument is refused at
admission naming the field (`not-argv` or `empty`). Pays
`I5.check-command-has-a-grammar`.
