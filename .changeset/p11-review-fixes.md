---
"@olympus-ai/sandbox": patch
"@olympus-ai/adapters": patch
"@olympus-ai/conformance": patch
---

P11 review fixes. The probe's response limit is a deadline from the moment a
request is sent, not a socket-idle timer a trickled body keeps resetting. The
HTTP adapter fails an oversized response whatever the scenario expected of its
body, refuses a scenario array with a hole in it, refuses an expected `json`
that JSON cannot carry, and no longer reads a number past JSON's range as
`null`. The probe's isolation assertion now inspects its PID namespace,
`no-new-privileges`, and user, and checks for the product's file from inside
the probe with a control, so a failed exec cannot pass for absence.
