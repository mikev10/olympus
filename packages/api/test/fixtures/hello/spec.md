# hello

The fixture run's spec. `spec` locks this file, `test-design` locks the
acceptance test and the verification manifest, and `plan` locks the task
graph: one build task and the review task that covers it. Every transition
after `spec` re-verifies all of them.
