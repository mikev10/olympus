---
"@olympus-ai/api": minor
---

R55 (#176): `factory-host` checks `ANTHROPIC_API_KEY` with the provider before
it listens, with one request that spends nothing, and refuses to start, in the
same list as every other start-up problem, when the provider rejects the key
or the check could not be made. Before, a host with an invalid key admitted a
run and failed every attempt until it parked. `checkStartup` takes the check
as a fourth argument, which defaults to the real request.
