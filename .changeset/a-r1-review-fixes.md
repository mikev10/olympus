---
"@olympus-ai/readiness": patch
"@olympus-ai/conformance": patch
---

R1 review fixes. The tree copy refuses names that are not UTF-8, symlinks
whose target could resolve outside the copy, and writes through a path the
copy already holds, so the scan can no longer write outside its copy or read
host files through a committed link. `testing.green-at-base` now requires at
least one passed test and none failed, read from the runner's JSON report.
`testing.coverage` requires an Istanbul report that measures at least one
file, written to an output directory created empty for that run. The I2
readiness fixture's title now says it checks shape, not provenance.
