# Rubric: a drafted spec

A person owns this file and edits it; the runtime reads it at admission and
gives it to the spec critic. Change it to hold specs to your own standard.

A spec passes only if every point below holds. Each point that does not is a
finding.

1. Every statement can be checked by a test that calls the public interface.
   Words like "fast", "robust", "clean", or "as appropriate" are not checkable.
2. The spec covers what the intent asks for. Each thing the intent asks for is
   stated.
3. The spec asks for nothing the intent did not. Extra features, refactors,
   and clean-ups are findings.
4. The security part names each trust boundary, kind of sensitive data,
   authorization rule, and secret the change touches, or says `none` with a
   reason that is true for this change.
5. Each point the intent left open is either an assumption with what was
   chosen, or an open question. A choice made silently in the spec is a
   finding.
6. The run requirements name a test command, a framework, a test directory
   the framework reads, and a public interface precise enough to call from a
   test without reading the code.
