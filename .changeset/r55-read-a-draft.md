---
"@olympus-ai/api": minor
"olympus-ai": minor
---

R55 (#175): `olympus-ai draft <run id> <station>` prints the draft a person is
asked to approve: its hash, whether it is waiting and the `approve` command
for it, every file, and the questions part. It reads the new
`GET /runs/:id/draft?station=<station>`, never the store. The service returns
a draft only while its stored bytes still hash to the hash an approval names,
and the command prints a model's text with control characters and direction
overrides as escapes, each file line behind a margin.
