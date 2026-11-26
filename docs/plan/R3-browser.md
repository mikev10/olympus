# R3 — Behavioral breadth (browser)

**Unit:** R3 (M3, maintainer)
**Depends on:** P8 Adapters, P11 Sandbox network probe + HTTP behavioral
**Blocks:** R76 wires behavioral scenarios, this kind among them, into the line.

P8 ships behavioral adapters of kind `cli` and `http`, and every adapter set
names `behavioral:browser` unavailable. This unit implements the browser kind:
a scenario starts the product in the sandbox, a browser the product cannot
reach drives it through steps the locked scenario names, and the runtime
compares what the browser saw against the locked expectation, on the host.

Written by the amendment that settled its open questions (D-A-BR-01 to
D-A-BR-08), checked against the code on `v2` at 3566c06. The DECOMPOSITION
entry said the contract needs no amendment. That holds for
`BehavioralAdapter.kind` and not for the sandbox contract: the amendments the
unit needs are listed below and land in its pull request. Issue
[#238](https://github.com/mikev10/olympus/issues/238) asked four questions of
this spec; "What a sandboxed browser cannot reach" answers them.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| `BehavioralAdapter.kind` admits `'browser'` | `adapters/src/types.ts:80` | no amendment to the adapter contract |
| `BehavioralScenario` is `id`, `input: unknown`, `expected: unknown` | `adapters/src/types.ts:84-88` | each kind reads its own shape and refuses one it does not know, as `readHttpScenario` does (`adapters/src/http.ts:144`) |
| Every set names `behavioral:browser` | `adapters/src/detect.ts:226`, reason `'browser scenarios are R3'` | the one line that changes when a provider can browse |
| The only client outside the product's reach is `probe` | `sandbox/src/types.ts:372` | a browser inside the product's container is one the product can replace, the reason P11 gave for HTTP |
| `ProbeRequest` is a port, a wait, and HTTP exchanges | `sandbox/src/types.ts:293-299` | it cannot carry a browser scenario; its comment promises "a port and never a URL" |
| The probe is `node --eval` in the proxy's image | `sandbox/src/local/probe.ts:221-237`, image `sandbox/src/local/proxy.ts:36` | that image holds no browser; a browser needs an image of its own |
| A probe container's limits | `probe.ts:221-237`: `--network container:<sandbox>`, `--read-only`, `--cap-drop ALL`, `no-new-privileges`, user `65534`, nothing mounted | the limits a browser container starts from |
| Images are pinned by digest and pulled only by digest | `sandbox/src/local/image.ts:26-34`; `adapters/src/security.ts:50,53` | where a browser image's pin goes and how it is fetched |
| `sandbox.computerUse` is asserted by looking for a display in the sandbox's container | `conformance/src/registry/claims.ts:153-170` | a headless browser in its own container gives the sandbox no display; the claim stays `false` |
| No browser exists in the repository | `git grep -il "chromium\|playwright\|puppeteer" -- packages scripts` prints nothing | the unit adds the first |
| The line builds every adapter set with `provider: null` | `api/src/run.ts:767`, `verification.ts:62,79,93`, `tamper.ts:163`, `property.ts:26`, `init.ts:182` | no real run builds a behavioral adapter of any kind |
| A `behavioral` check in the manifest is a pinned command | `integrity/src/types.ts:138-141,163-176` | the manifest has nowhere to put a scenario, so no real run can hand one to an adapter. That is R76, not this unit |
| `HttpBehavioralAdapter` is constructed by the conformance suite alone | `git grep -n "HttpBehavioralAdapter" -- packages/api packages/core packages/cli` prints nothing | this unit is proved the same way, in isolation |

---

## Deliverables

- **The provider can browse.** `LocalDockerProvider.browse(h, request)` starts one container for the call, from an image that carries a headless browser and is pinned by digest, joined to the sandbox's network namespace and to nothing else of it, and removed when the call returns or the sandbox ends, as a probe is. It runs the request's steps against the sandbox's loopback and prints what it saw. It observes and decides nothing.
- **A `BehavioralAdapter` of kind `browser`** in `packages/adapters`. A scenario owns its server, as an HTTP scenario does (D-P11-03). `input` is `serve` (an argument vector), `port`, an optional `readyWithinMs`, `steps`, and an optional `mayBlock`. `expected` holds one entry for each `observe` step, in order. The adapter starts `serve` detached, calls `browse`, and compares on the host. A second browser scenario on a handle the adapter already served is refused, as the HTTP adapter refuses it.
- **Steps are data.** `goto` (a path beginning with `/`), `click`, `fill`, `press`, and `observe`. A step names its element by what a person sees: a role and accessible name, a label, or visible text. No step carries a selector over markup, script text, or a URL. A step that names no element, or more than one, is reported as that and never resolved by picking one.
- **An observation is what was on the page.** For the element an `observe` step names: how many matched, whether it is visible, its text, and its value. With it, the page's path and title. The expectation names the fields it holds the page to, and only those are compared.
- **Nothing leaves the loopback.** The browser refuses every request to a host other than the sandbox's loopback before it is sent and reports the host. A scenario's `mayBlock` lists the hosts the locked scenario expects the page to ask for and do without. A refused host that is not listed fails the scenario, naming the scenario and the host. A document navigation that leaves the loopback always fails it.
- **The browser is in the evidence.** The result names the image's content ID and the browser's own name and version, read from the running browser.
- **Stack detection carries it.** A set built on a provider with `browse` carries the browser adapter and stops naming `behavioral:browser`. A set built on a provider without it names the control with that provider as the reason.

## Contract amendments, landed in this unit's pull request

- **A-R3-01:** `SandboxProvider` gains an optional `browse(h, request: BrowseRequest): Promise<BrowseResult>`. Optional for the reason `probe` is (D-P11-04): a provider that cannot put the browser out of the product's reach omits it. `StubSandboxProvider` does not implement it. An implementation MUST drive the sandbox's own loopback and refuse every request to another host, MUST charge the call to the sandbox's wall-clock budget as `exec` does, and MUST refuse a call on an ended sandbox.
- **A-R3-02:** the types `browse` speaks, in `packages/sandbox/src/types.ts`:
  - `BrowseTarget`: `{ role: string; name: string }`, `{ label: string }`, or `{ text: string }`.
  - `BrowseStep`: `{ do: 'goto'; path: string }`, `{ do: 'click'; target: BrowseTarget }`, `{ do: 'fill'; target: BrowseTarget; value: string }`, `{ do: 'press'; key: string }`, or `{ do: 'observe'; target: BrowseTarget }`.
  - `BrowseRequest`: `port`, `readyWithinMs`, and a non-empty `steps`. A port and never a URL, as `ProbeRequest` is.
  - `BrowseObservation`: `{ kind: 'observed'; matched: number; visible: boolean; text: string; value: string | null; path: string; title: string }`, or `{ kind: 'not-reached'; reason: string }` for an observation a failed earlier step kept from being made.
  - `BrowseResult`: `ready`, `observations` (one for each `observe` step when `ready`), `failedStep` (the index and reason of the first step that could not be done, or `null`), `blocked` (each refused host with its request count and whether a document navigation asked for it), `browser` (`{ name, version, image }`), and `durationMs`.

Nothing else in a contract file changes. `BehavioralAdapter`, `BehavioralScenario`, `CheckResult`, and `SandboxCapabilities` stay as they are.

## What a sandboxed browser cannot reach

The browser runs beside the sandbox and reaches its loopback alone. It carries no person's session, cookies, or extensions, and it starts each scenario with an empty profile.

- **A signed-in user.** A scenario signs in the way a person would: it fills the product's own sign-in form with credentials the locked scenario carries, against whatever identity the scenario's `serve` starts. This unit seeds no session and injects no cookie. Whether the identity `serve` starts is one the agent could have written is decided where locked files reach the sandbox, which is R76's, and R76 owes that assertion.
- **A real external service.** A third-party sign-in, a hosted payment page, a live staging or production site: none is reachable. A scenario that needs one fails, naming the scenario and the host. It is never passed unexercised and never skipped.
- **A policy grant of a host.** Not available to a browser scenario. `BrowseRequest` has no field that names a host, so there is nothing for a grant to fill and nothing for the enforcement record to say. A grant, if one is ever wanted, is a contract amendment with its own unit (R30 names preview hosts as a later step).
- **Where the browser comes from.** One image, pinned by digest in `packages/sandbox`, pulled by digest only. Its content ID and the browser's version are in every result.

## Out of scope

- Running a browser scenario, or any behavioral scenario, from a `VerificationManifest` on the real line, and the fresh sandbox each one runs in (R76).
- Mounting locked files into the sandbox for a scenario's `serve` to start (R76).
- A browser outside the sandbox's network, or one that carries a person's signed-in sessions.
- Egress for a browser scenario: a granted host, a preview URL, a proxy route (R30's later step, by amendment).
- Seeded sessions, injected cookies, stored browser state.
- Selectors over markup (CSS, XPath, test ids), scripts evaluated in the page, and a locked test script in place of steps.
- Screenshots, visual comparison, video, and traces.
- More than one browser engine, more than one page or tab, file upload and download, and dialogs.
- A display in the sandbox's container, and computer use by a driver. `computerUse` stays `false` on every provider and driver, and its assertions stay as they are.
- `MutationAdapter` (M3). A set on a provider that can browse still names `mutation`.
- Stopping a scenario's server. It ends with the sandbox.

## Conformance

Each is a registry assertion that fails when the capability it covers is deleted (I8). Those that start a container require a Docker daemon and fail closed without one.

- `I2.browser-verdict-judged-outside-the-product`: a scenario runs against a real server in a real sandbox. A page that shows what the scenario expects after its steps holds. A page that renders with the wrong text does not, naming the observation and the field, and the gate fails it on its expectation.
- `I3.browser-out-of-the-products-reach`: the browser's container runs with a read-only root, every capability dropped, no new privileges, an unprivileged user, and no file the product wrote. A deny-all sandbox it browsed is still `--network none`, and no container outlives the call or the sandbox.
- `I5.browser-never-leaves-loopback`: a page that asks another host for a resource has the request refused and the host reported. Unlisted, it fails the scenario naming the host; listed in `mayBlock`, it does not. A link that navigates off the loopback fails the scenario whether or not its host is listed.
- `I5.browser-step-that-cannot-be-done`: a step whose target matches nothing, or more than one element, fails the scenario naming the step. Every later observation is `not-reached`, and none is compared as if it had been made.
- `I5.browser-unavailable-without-a-provider`: a provider with no `browse` builds a set that names `behavioral:browser` and cannot construct the adapter. A provider with one builds a set that carries it, and `mutation` still keeps that set from L3.
- `I5.browser-scenario-shape`: an `input` or `expected` with an unrecognised key, a `goto` that is not a path, a target that is none of the three forms, an `expected` not as long as the `observe` steps, or a second scenario on a served handle is refused, naming the field.
- `I8.browser-named-in-evidence`: a result names the image's content ID and the browser's version, and the content ID is the one the pin resolves to.
- `adapters.ts`, `http.ts`, and `verification.ts` in the registry assert today that every set names `behavioral:browser`. Each is changed to say which provider it holds for, and none is deleted.

## Acceptance

- every conformance entry above is present and passes: `node scripts/local-check.ts preflight <each id>`, then the full run once
- `git grep -n "browser scenarios are R3" -- packages` prints nothing
- `git grep -n "browse?(" -- packages/sandbox/src/types.ts` prints the method
- the browser container's argument vector adds no capability, no `--privileged`, no mount, and no security option beyond the probe's. If the browser's own process sandbox cannot start inside those limits, the unit records what it ran instead and why in `docs/decisions.md`, verified by running it, and never widens the container to make it start
- every package change has a changeset
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm conformance` pass
- `git ls-files -- .plan/` prints nothing

**Gate paths:** `packages/sandbox/src/types.ts` and `packages/conformance/` are protected, so the pull request carries the `gate-change` label and the squash body carries `Gate-Change: acknowledged`.

**Invariants:** I2 is the subject: a browser verdict is the runtime's comparison of what a browser the product cannot replace saw, never the product's report of itself. I3: the browser and the expectation are both out of the agent's reach, and steps name what a person sees, so a locked scenario does not depend on markup the agent chooses. I4: the browser reaches the loopback and nothing a policy did not grant, and no field lets a scenario ask for more. I5: a provider that cannot browse is named, a host the page could not reach fails the scenario unless the locked scenario expected it, and a step that could not be done is never read as done. I8: the browser kind is a claim with assertions that fail when it is deleted, and the browser that ran is named in the evidence.
