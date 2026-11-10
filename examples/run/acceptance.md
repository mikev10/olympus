# Add a greeting file: acceptance

The black-box checks the run is judged by. `test-design` locks this file and
`verify.json` before `build`, and runs the `hello-written` check over the base
commit first: there it must fail, because nothing has written the file yet.

- `hello.txt` exists at the root and says `hello` (the `hello-written` check)
- the repository has no committed secret (the `secret-scan` check)
