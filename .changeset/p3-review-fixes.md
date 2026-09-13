---
"@olympus-ai/core": patch
"@olympus-ai/conformance": patch
---

P3 review fixes. `validateEgress` refused a bare `'*'` but accepted `['*']`, so
a policy could name every host while reading as an explicit allowlist; an entry
carrying a wildcard, a path, a prefix length, or whitespace is now refused
(D-P3-08). `resolvePolicy` trusted its parameter type, so a caller asserting
past the compiler could resolve `globalCap: 99` into a real grant; it now
validates its own input and refuses (D-P3-09).

The engine still answers cap arithmetic only — it reads neither `approvals` nor
`triggers.maxAutonomy` — which is by design and now pinned by tests, with the
obligation on the consuming unit registered as
`I4.approval-outcome-gates-the-station`, owner P4 (D-P3-10).

New live assertions `I4.egress-entry-names-one-host` and
`I5.malformed-document-refused-at-resolve`; I4 baseline rises 1 to 2 for the new
pending entry.
