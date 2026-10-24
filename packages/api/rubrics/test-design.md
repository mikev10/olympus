# Rubric: drafted acceptance tests

A person owns this file and edits it; the runtime reads it at admission and
gives it to the test critic. Change it to hold tests to your own standard.

The tests pass only if every point below holds. Each point that does not is a
finding.

1. Each test checks a statement of the spec, and the statement it checks can
   be named.
2. Each statement of the spec is checked by at least one test.
3. Each test calls only the public interface the run requirements name. A test
   that reaches into internals, private state, or file layout the spec does
   not state is not black-box.
4. Each authorization rule the security part names has a test in which a
   caller the rule refuses is refused, and that check names the rule.
5. Each check's `onBase` is honest: `fails` only where the behavior is absent
   before the change, `passes` only where it already holds.
6. No test passes whatever the code does: no assertion that cannot fail, no
   test that only checks a mock.
