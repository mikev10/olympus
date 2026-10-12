# hello: acceptance

The black-box oracle the run is judged by. `test-design` locks it before
`build`, beside the verification manifest, and runs its declared check over
the base before any driver is invoked: there it must fail, because nothing
has written `hello.txt` yet.

- running the compile check exits zero
- `hello.txt` exists and says `hello` (the `hello-written` check)
