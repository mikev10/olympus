# External review of R21, codex, 2026-10-28

The Codex family's review of R21, a local model endpoint on the Docker host reached through the relay. The triage of both reviews is `2026-10-28-R21-local-endpoint-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. 64,996 input tokens ingested against a floor of 40,283; echo verified.
- **Cross-family agreement:** gemini raised both findings too: 1 (the sandbox reaches the host through its own bridge gateway) as gemini-1, and 2 (port 80 refused at relay start) as gemini-4. Codex raised nothing alone.
- **Date:** 2026-10-28
- **Bundle:** `2026-10-28-R21-local-endpoint-review-bundle.txt`, SHA-256 `2bc338f9e19c5a31f04cfd1d4c35a76e0f08a36e42e73ff87c56922e57174df4`, base `f99ea35` (`reviewed/R12`), head `7e52685` (the unit branch after the acceptance run, before review). It held 15 sections: both changesets, every new file in full, and every modified file as a function-context diff. `docs/decisions.md` and `docs/plan/` were excluded. Prompt: `2026-10-28-R21-local-endpoint-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and made no external lookups, and that local command execution was blocked. This is a self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 and 5 are answered through the two findings, item 2 (no tautological assertion found), item 4 (casts, `any`, and declaration merging do not bypass the checks), item 6 (a list of sound mechanisms), and item 7 (the closing paragraph) explicitly. Item 3 (fails open) gets no answer of its own. The reviewer said the bundle did not show the full request handler, header filtering, or metering, so it could not establish them.
- **Citations:** line numbers refer to positions in the bundle, not the repository. They are treated as hints and were located by construct in the triage.

---

BASE: f99ea35  
HEAD: 7e52685  
packages/sandbox/test/relay.test.ts  
441c5309a1463aba5a0511143c5cd253

I have no prior project context and performed no external lookups. I reviewed the bundle embedded in the prompt. Local command execution was blocked, so I did not run tests or independently verify the file’s SHA-256.

1. **packages/sandbox/src/local/relay.ts:1019 — unclear — high — An internal bridge does not establish isolation from the host itself.**

   The relay creates an internal Docker bridge that the sandbox subsequently joins. Giving only the relay the `model-host` name does not establish that the sandbox cannot reach a host address directly.

   The concrete attempt is to discover the sandbox’s connected subnet and its bridge gateway, then connect to a host service listening on that gateway address or on all interfaces. This requires neither DNS nor a default route. On a conventional Linux Docker bridge, traffic addressed to the bridge’s host interface is distinct from traffic forwarded out of the network.

   The new conformance test probes `model-host`, `host.docker.internal`, and the address resolved by the relay’s `host-gateway` mapping. It does **not** probe the sandbox’s own internal bridge gateway. Consequently, those probes can fail while another host address remains reachable.

   **Resolution:** Test an owned listener through the sandbox’s actual bridge gateway, including a port absent from `dockerHostPorts`, and enforce host-input isolation if that connection succeeds. Merely withholding `--add-host` is insufficient.

   **Confidence:** Medium for this deployment; host firewall rules and daemon configuration are not supplied. This is a concrete isolation concern requiring verification, not a demonstrated exploit against the reviewed environment.

2. **packages/sandbox/src/local/relay.ts:159 — factually wrong — medium — A declared, authorized local endpoint on port 80 cannot start.**

   `checkLocalUpstream` accepts integer ports from 1 through 65535 when authorized by `hostPorts`. Thus this declaration passes TypeScript validation:

   ```ts
   upstream: { local: 'docker-host', port: 80 },
   scheme: 'none',
   credential: null
   ```

   With `dockerHostPorts: [80]`, its planned upstream is `http://model-host:80`. However, parsing that URL normalizes away the default port: `upstream.port` becomes `''`. The relay’s own start check rejects precisely that value.

   There is also disagreement in the opposite direction: `http://model-host:0` has a nonempty port and passes the shown local-origin start check, although TypeScript rejects port 0. This is not a sandbox exploit under the stated trust model: the task cannot set the relay’s startup environment.

   **Resolution:** Validate the effective HTTP port, treating an omitted normalized port as 80 and rejecting 0. Add paired validation/startup tests for ports 0, 80, and 65535.

   **Confidence:** High.

The following mechanisms appear sound within the supplied code:

- Local declarations are checked at runtime, including numeric port bounds and membership in the provider’s private operator-granted set. Casts, `any`, or declaration merging alone cannot bypass those checks.
- Keylessness requires both `credential: null` and `scheme: 'none'`, and is restricted to a local upstream. Missing and empty credential names are rejected.
- `send` selects transport and socket destination from the validated upstream, rather than request headers. Redirects are returned without being followed.
- Credential values enter only the relay’s environment through named Docker environment arguments. The shown changes do not place them in sandbox arguments or configuration.
- The host validates endpoint configuration before deriving provider grants; a nonempty key alongside a keyless declaration is refused.

I found no tautological assertion in the added tests. The conformance refusal loop requires a particular refusal class, layer, and message; arbitrary exceptions do not count as success. Its gateway-resolution check also rejects an empty result.

The bundle does **not** show the complete request handler, authentication-header filtering, or metering implementation. Consequently, I cannot establish that every task-supplied authentication header is stripped, that malicious request targets are rejected, or that every local call is bounded. The added local integration assertion checks one successful call’s token accounting; it does not itself demonstrate budget exhaustion.

The adversarial framing is appropriate. The important refinement is to distinguish **name assignment from network isolation**, and **startup-validation disagreements from reachable sandbox exploits**. Forging a provider or executing malicious getters inside the trusted runtime would exceed the stated threat model.