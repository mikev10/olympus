BASE: 4bf9487
HEAD: cdb4af6
packages/vault/test/local.test.ts
e3d2be1340138c3541ae7a8497a62843

I had no prior context about this project, and I performed no external lookups.

packages/api/src/line.ts:1128 — fails open — high — The line checks the reviewer's independence twice: once before running the task using the model resolved by the driver (`reviewer.resolveModel(...)`), and again after running the task using the model identity the reviewer reported in its result (`ran.result.model`). Because a capable attacker controls what the model returns (including `ran.result.model`), they can spoof the model identity to report a family that is entirely different from the authors' families. When `review` makes its second check (`seated = seatReviewer(..., ran.result.model, ...)`), it sees no conflict with the spoofed family and erroneously assigns `independence: 'independent'`, completely ignoring the actual family conflict detected in the first check. The line then commits this fully independent seat. This fails open, allowing a reviewer sharing the author's family to bypass the downgrade and record false independence. — Resolve this by ensuring the model reported in the result matches the family that was authorized, e.g., `if (ran.result.model.family !== reviewer.resolveModel(tierFor(...)).family) throw new Error(...)`, or by enforcing the most restrictive independence level between the planned and seated checks.

### Soundness of Other Mechanisms

1. **`dockerCli`'s byte cap and `LocalDockerProvider` handling (Sound):** 
   The cap perfectly bounds the memory held by the runtime process. `held` correctly sums chunks across both stdout and stderr streams. If the limit is crossed, it immediately nullifies the internal arrays (`stdout.length = 0; stderr.length = 0`), rejects the promise to stop buffering, and kills the `docker exec` client. `LocalDockerProvider.#overBudget` explicitly catches `CliOutputExceeded`, and importantly, calls `#dismantle` which executes `docker rm --force` to kill the container. This securely prevents the command from continuing to run inside the container and prevents any exhaustion of the host.

2. **`boundTo` relay pricing (Sound):**
   `boundTo` dynamically rebuilds the relay's meter to include *only* the price for the specific model `driver.resolveModel()` returned. Since the relay checks this map before sending requests, an attacker inside the sandbox sending an HTTP request for a different, stronger model (e.g., `claude-opus-5-5` when provisioned for `claude-sonnet-5`) will be strictly denied by the relay. `Object.hasOwn` protects against prototype pollution, and the function safely returns a completely new object, preventing cross-task contamination.

3. **`tierFor` and `escalationAt` (Sound):**
   Escalation is correctly modeled as a pure function of attempt counts and policy grants. The logic strictly uses run state iterations (`spent.iterations`), completely ignoring attacker-controlled model output. The step calculations (`Math.floor`) correctly respect the exact number of failed gates required to climb, and `Math.max`/`Math.min` reliably pin the tier between the starting station tier and the policy ceiling. 

4. **`authorsOf` model collection (Sound):**
   The authors are meticulously compiled from `readUsage()`, which retrieves the true, runtime-resolved models that actually ran the builds, including failed attempts. This ensures that an attacker spoofing their `TaskResult.model` cannot hide the actual model that served the task. While a spoofed model is still added to the `distinct` set, it only acts to add *more* families to the author list, which can only conservatively reduce independence for subsequent reviewers, failing closed.

### Framing

The adversarial framing provided is exceptionally rigorous and accurate for this architecture. By explicitly identifying what the attacker controls (model outputs, sandbox actions) versus what is trusted (runtime code, providers, policy documents), it accurately guided the review toward the exact vulnerability in `review`, where untrusted data (`ran.result.model`) was allowed to override a trusted capability decision (`reviewer.resolveModel`).