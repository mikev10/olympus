---
"@olympus-ai/adapters": patch
"@olympus-ai/api": minor
"@olympus-ai/conformance": patch
---

P7 review fixes (D-P7-10, D-P7-12). The adapters refuse a shadowed test
declarer, follow or refuse every route to the test context's `skip`, and
enumerate one case per row of a `.each` or `.for` table, refusing a table that
is not a literal. `analyzeTamper` pairs skip markers within a file, and across
files only for a rename or a move. `TamperOptions` gains `commands`: a changed
file that the pinned argument vector names is a protected-path touch. Two
known limits are registered as pending: `I3.unchanged-assertion-still-judges`
(M3) and `I5.unanalysed-tests-are-not-reported-clean` (I1).
