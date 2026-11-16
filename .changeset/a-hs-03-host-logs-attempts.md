---
"@olympus-ai/api": patch
---

A-HS-03: `factory-host` prints each failed attempt to stderr, one line per
attempt, prefixed `factory-host: `. Before, the service produced the line but
the host passed it no log, so it was only visible in `status` and the event
stream.
