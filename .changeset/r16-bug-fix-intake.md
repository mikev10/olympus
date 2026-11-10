---
"@olympus-ai/core": minor
"@olympus-ai/integrity": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

R16, bug-fix intake. `TemplateId` gains `'bug-fix'`, valid on `issue` alone, which records a candidate as `intake-candidate` does; `TriggerPolicy.runTemplates` lists the templates a person's own run may name, none when absent. `RunRequest.template` names a run's template, a run from a candidate takes the candidate's, and the admission record holds it. `Intent` is a union: free text, or a bug fix's `steps`, `actual`, and `expected`, each required and named when missing; a bug-fix run drafts both its spec and its tests and is refused with either supplied. `SpecPart` gains `defect`, which the runtime writes from the intent record and the draft must hold byte for byte, and `reproduction`, which the drafter writes. A check may declare `reproduces: true` beside `onBase: 'fails'`; a bug fix's drafted tests need a required one, and no supplied check and no other run may declare one. The Vault gains `dismissCandidate`, `IntakeEntry.dismissed`, and the closed `DismissalCause`, spending the same mark an admission does; `POST /intake/:id/dismiss` takes a cause and no text, and a dismissed candidate admits no run. The run report names the template and the candidate's issue.
