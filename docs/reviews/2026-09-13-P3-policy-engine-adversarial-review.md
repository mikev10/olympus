# External review of P3, 2026-09-13

The verbatim findings of an external adversarial review of the policy engine
(`packages/core/src/policy/`, its package tests, and the P3 conformance
additions). The request that produced it — the prompt verbatim, with the bundle
pinned by SHA-256 — is `2026-09-11-P3-policy-engine-review-request.md`. The
triage, with what was and was not acted on and why, is the companion file
`2026-09-13-P3-policy-engine-adversarial-triage.md`.

## Source

- **Reviewer:** Grok, as the maintainer named it. Family: **xAI Grok.** The
  exact model version was not recorded at handover; the family is what rotation
  is tracked by. Conditions: the reviewer reported a temporary session with no
  prior context and no lookups; it worked from the uploaded bundle alone.
- **Family rotation:** ChatGPT reviewed F3 and S1; Gemini reviewed P1 and P2,
  the second of those without rotating and saying so in its own header. This is
  the first xAI review, so **rotation was met** — three families across five
  reviewed units, and the correlated-findings problem the P2 header recorded
  does not apply here. Agreement between this review and P1's or P2's would now
  be cross-family evidence rather than one opinion sampled twice.
- **Date:** 2026-09-13.
- **Bundle:** base `f1127eb` (`reviewed/P2`), head `6dd2688` (the tip of
  `unit/p3` at request time). SHA-256
  `df7302c997cf419c479a7f2d0dd756c2ca24f91613fc4a202163a1e954612afe`. It held
  the full contents of the thirteen tracked files changed in that range, with
  `docs/plan/`, `docs/decisions.md`, and `docs/reviews/` excluded; the two
  section-header guards returned `0`.
- **Prior context and lookups:** the reviewer stated at the top that it held no
  prior context about the project, that it set aside anything else, and that it
  performed no lookups and no search for the project or author. **This is a
  self-report and is not independently verifiable.**
- **Coverage, and any gap:** all seven numbered prompt items were answered.
  Items 1 (bypass constructions), 4 (language escape hatches) and 6 (what is
  sound) came back substantive; items 2 and 3 (tautological checks, fail-open
  paths) came back as an explicit "none material in this unit" with the
  reasoning shown rather than left blank; item 5 (configuration that looks like
  a restriction and is not) came back as a four-item inventory. **Item 7, the
  framing check, was answered and carries the review's most consequential
  content** — the reviewer accepted the adversarial question and added a second
  one about which later callers may treat the engine's answer as sufficient.
  No item was left empty.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository, and are treated as hints. Every finding was located by opening
  the construct it names and reading it, and the three with a constructible
  case were executed.

---

Prior context: none about this project, and I set aside anything else. Lookups: none (no search for the project or author).
The adversarial question is the right one for this unit. The code is the sole grant path for roles, stations, tools, egress lists, and autonomy as answered by this engine. Approval evaluation and trigger admission are explicitly later, so “the engine said yes” is not yet “the runtime will act.” That is a boundary, not a dodge.

Findings (severity first)
1. packages/core/src/policy/validation.ts:203-228 — tradeoff I would have made differently — medium validateEgress refuses a bare 'all' / '*' / other string, then accepts any non-empty string in an array, including '*', 'all', '*.example.com'. Construction: a document the validator accepts with network: { egress: ['*'] } (or 'all'). The rebuilt document and cloneScope will report that list as the grant. I4 here is “no wildcard token at the type/schema layer.” If any later consumer treats list entries as match patterns (or even as “this string means everything”), the authored form looks like an explicit allowlist while functioning as unrestricted egress. If consumers only do exact hostname equality, this is a useless host, not a bypass — confirm that before treating it as high. Resolve: reject host entries that are *, all, empty-after-normalize, or that contain *; or define and enforce a host grammar (literal hostname only).
2. packages/core/src/policy/engine.ts:199-207 + packages/core/src/policy/validation.ts — tradeoff — medium resolvePolicy / resolveAutonomy / resolveCapabilities never call validatePolicyDocument. The engine trusts a PolicyDocument. Construction: skip the validator (or pass a value asserted as PolicyDocument) with globalCap: 99, autonomyCeiling: 99, stations containing an invented id, network.egress: 'all', extra keys, etc. effectiveCap will treat 99 as a bound; requested > cap can succeed for 0–3; cloneScope will copy whatever shape it finds. This unit’s contract is “already parsed + already typed.” That is consistent with the brief, but it is the easiest path to an ungranted capability: the narrowing is optional at the only runtime entry that matters. Resolve: resolvePolicy should refuse unless it received a document produced by validatePolicyDocument (branded type, or validate internally and fail closed). Do not leave composition to the caller.
3. packages/core/src/policy/engine.ts:213-247 — unclear (boundary) — low resolveAutonomy does not read policy.approvals or triggers.maxAutonomy. A document can set approvals['build:2'] = 'blocked' and triggers.maxAutonomy.human = 0 and still get { ok: true, level: 2 } when global/station/role bounds allow it. Out of scope says approval evaluation and trigger admission are later. That is internally consistent, but it means this engine can report an autonomy level the rest of the document forbids. Callers that treat resolveAutonomy as the whole answer violate I5/I4 in the product sense. Resolve: either document that these two tables are inert here (and conformance-test that later units refuse), or have this function refuse when the station:level cell is blocked / when the applicable trigger cap is tighter.
4. packages/core/src/policy/engine.ts:148-151 — escape hatch — low return frozen(filled as Record). The length check against STATION_IDS.length * AUTONOMY_LEVELS.length makes the assertion honest if APPROVAL_KEYS stays the cross product of the same two records. A future edit that changes one list and not the other throws at resolve time (fail loud, not fail open). Resolve: keep the throw; optionally build the record by assigning every APPROVAL_KEYS entry into a typed object without as.
5. packages/core/src/policy/engine.ts:47-62 (frozen / frozenCopy) — tradeoff — low Object.freeze is shallow; cloneScope freezes the arrays and the network / budget objects. Nested mutation of those copies throws. What freeze does not stop: a caller replacing the resolved Policy object they hold, or mutating a PolicyDocument before resolve if they never validated. Tests cover post-resolve mutation of tools/paths. Not a silent widen of the engine’s own copy.
6. Checks that are tautological / fail-open — none material in this unit
	•	Conformance I4.unlisted-capability-refused, I4.omitted-approval-is-human-required, I4.empty-inventory-refuses-every-grant, I5.over-request-refused import StrictPolicyEngine and use a document that both grants and refuses. They would fail if the engine refused everything or filled auto.
	•	I4.tool-grant-requires-an-inventory is a compile fixture (TS2554 / TS2345), not a runtime proof that callers actually pass a real inventory — that gap is already pending as I4.driver-tool-inventory-validated (P5).
	•	totalApprovals throw is not a test pass-via-exception.
	•	No skipped tests in the attached files.
7. Language escape hatches (inventory)
	•	as Record — above.
	•	value is StationId / AutonomyLevel / … predicates: implemented with Object.hasOwn on total records; 'toString' / prototype keys do not pass. isAutonomyLevel requires typeof === 'number' so '2' is refused. Sound.
	•	RoleId is accepted as any non-empty, non-reserved string (validation.ts:355-379); branding is only at call sites (as RoleId). That does not invent tools or stations.
	•	No declaration merging / module augmentation in this diff.
	•	unknown is the validator input; the success path rebuilds a new object (validation.ts:428-437), so extra keys cannot ride through. Sound for I4 on the validated path.
	•	validateRoles / RESERVED_ROLE_IDS block __proto__, constructor, prototype. Sound against that pollution path.
8. Config that looks like a restriction but isn’t
	•	Empty stationCaps does not mean L0 (engine.ts:166-176, D-P3-06). Correct, and tested.
	•	Empty egress array is accepted and means no hosts (validation.ts:207-220). Same as 'none' for grant-nothing; not a widen.
	•	roles: {} on the default is a real deny (default.ts).
	•	taskTemplate: {} plus free-form template names does not, in this unit, let a payload name a template (admission not implemented here). I7 is only “names live in the document.” Fine for the stated scope.

What looks sound (and why)
	•	Unknown-key refusal + rebuild (validation.ts shape / validatePolicyDocument): extra keys defect; success returns a newly assembled object. That is actual I4 at parse-narrowing time, not a comment.
	•	Omitted approvals → human-required only (engine.ts:134-151): loop is over APPROVAL_KEYS; default is never auto; stated keys survive. Tests distinguish “fill everything human-required” from “preserve the one auto.”
	•	resolveAutonomy does not downgrade (engine.ts:213-247): requested > cap → exceeds-cap with no level property; in-bounds returns requested. Matches I5 as written.
	•	Default deny on lookup (resolveCapabilities / missing role / station not in scope.stations): capability-missing / station-forbidden; granted path is cloneScope.
	•	Deep copy + freeze of grants so a returned scope is not a handle on the policy.
	•	validateToolGrants(policy, inventory) with no default; empty inventory refuses every grant. Type fixture makes the arity real. The remaining hole is producing the inventory (declared pending).
	•	Union lists from total records (constants.ts): a new StationId breaks the record until the validator knows it.
	•	Shipped default grants no roles (default.ts).

Framing
The question is right: this is a grant engine; the interesting attack is a document or resolution that yields more than the author wrote, or a yes where the spec wants a closed no.
What I would add as a second question, because this unit’s API is split: “Which later readers are allowed to treat resolveAutonomy / resolveCapabilities as sufficient, and which must still consult approvals, trigger caps, and the tool inventory?” If the answer is “they must all consult,” the unused tables are fine. If any caller only asks the engine, findings 2 and 3 become the production bypass.
