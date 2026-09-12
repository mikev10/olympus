---
"@olympus-ai/core": minor
"@olympus-ai/conformance": minor
---

P3: the policy engine. `StrictPolicyEngine` implements `PolicyEngine` from F2:
`resolvePolicy` turns the sparse authored `PolicyDocument` into the total
`Policy` the runtime consumes, filling all forty `station:level` approvals and
giving every key the document omits `human-required` rather than `auto`;
`resolveAutonomy` refuses a request above the tightest of the global cap, the
station cap and the role's ceiling with `exceeds-cap` and never returns a lower
level (I5); `resolveCapabilities` refuses an undefined role with
`capability-missing` and a station outside a role's `stations` with
`station-forbidden`, and otherwise returns a frozen copy of exactly what the
policy grants (I4).

Beside the engine: `validatePolicyDocument` narrows an already-parsed `unknown`
to a `PolicyDocument`, reporting every defect at its path and refusing an
unknown key at any level rather than ignoring it; `validateToolGrants(policy,
inventory)` checks tool grants against a driver inventory that is mandatory, so
an empty inventory refuses every grant instead of reading as allow-all;
`DEFAULT_POLICY_DOCUMENT` ships `globalCap: 2`, human triggers only, the
protected-path list, and no role at all, because a shipped grant is a grant
nobody authored. The union lists the validator needs (`STATION_IDS`,
`AUTONOMY_LEVELS`, `TRIGGER_KINDS`, `APPROVAL_KEYS`) are derived from total
records over the contract types, so a new station cannot drift away from them.

The engine takes a parsed value; no package gains a YAML parser. The loader and
its hardening are owed to P9 as `I5.policy-document-load-is-hardened`.

Registry: `I4.unlisted-capability-refused`,
`I4.omitted-approval-is-human-required` and `I5.over-request-refused` are paid
and live, joined by `I4.tool-grant-requires-an-inventory` and
`I4.empty-inventory-refuses-every-grant`. `I4.driver-tool-inventory-validated`
is a new pending entry owned by P5. The I4 baseline drops from 2 to 1; I5 stays
at 4, one entry swapped for another. Decisions D-P3-01 to D-P3-07.
