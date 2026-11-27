# Rubric: a drafted task graph

A person owns this file and edits it; the runtime reads it at admission and
gives it to the plan critic. Change it to hold plans to your own standard.

A plan passes only if every point below holds. Each point that does not is a
finding.

1. The tasks together deliver everything the locked spec asks for. A part of
   the spec no task's objective covers is a finding.
2. No task delivers something the spec did not ask for. Extra features,
   refactors, and clean-ups are findings.
3. Each objective says which part of the spec is that task's and where it
   ends, plainly enough that a builder who reads only the spec, its own
   objective, and the objectives of the tasks it depends on knows what to
   build.
4. Two tasks with no dependency between them never need to change the same
   file. They are built at the same time, and one of them would be sent back.
5. Each task depends on every task whose work it needs in place first, and on
   no task it does not need. A dependency that is not needed makes the run
   slower for nothing.
6. The plan uses no more tasks than the spec needs. One task is the right
   plan for a small change.
7. The plan says nothing about how the work is reviewed. The runtime decides
   that.
