Prior context: none. Lookups: none; this review uses only the supplied bundle. I did not execute tests.

BASE: ed19c31  
HEAD: cacf9f6  
pnpm-lock.yaml  
b0991afc1f5e0f5f338f0c8fd973e1af

1. **`packages/benchmark/src/line.ts:275–276` — factually wrong — high — Any remaining runtime refusal becomes a successful detection.**

   `classify` distinguishes admission failures from started runs, but then labels every started run’s refusal outside the special integration case as `caught`. It does not require evidence that a detector actually found the seeded defect.

   Concrete construction: a seeded item reaches verification, but a check fails because its execution times out or its infrastructure fails. A `refused` outcome with a `gate-failed` transition reaches this unconditional return and counts as detection. A runtime refusal before the builder lands the change is treated the same way. `rates` counts `caught` independently of `detectorFired`, so even a row explicitly recording `detectorFired: false` can improve detection.

   The direct `ScriptedSeat` rejection test does not establish that its exception survives the surrounding runtime as a benchmark failure: it never runs the exception through `startRun` and `classify`.

   **Resolve:** distinguish substantive detections from execution failures and unmeasured runs. Require evidence that the item was applied, or that the attempted application itself triggered the relevant enforcement control. Add composed tests for failed application, scanner failure, timeout, and refusal before build. The classifier defect is certain; which exceptions the existing runtime translates into these transitions requires checking the omitted runtime implementation.

2. **`packages/benchmark/src/critic.ts:155–158` — factually wrong — high — An unreadable critic answer earns a catch.**

   A critic record with findings and `readable: false` adds `critic:unreadable`. The return then converts any nonempty cause list into `caught`. A `sent-back:critic` cause independently produces the same classification.

   Concrete construction: return malformed critic output that the runtime refuses and sends back. The benchmark credits a detection even though no readable finding identified anything wrong with the draft. The committed model result already contains `critic:unreadable` among causes for controls, while reporting zero unreadable critic outcomes.

   This also makes `detectorFired` misleading: the corpus’s `critic` prefix matches `critic:unreadable`, so an inability to read the detector’s answer is recorded as the detector firing.

   **Resolve:** give `CriticOutcome` an unreadable/error outcome and handle readability before interpreting findings or send-back records. Preserve the runtime’s refusal separately, including its effect on controls, without crediting it as a substantive detection. Test malformed critic output through the real composition. Confidence: high.

3. **`packages/benchmark/src/result.ts:64–67` — factually wrong — high — Model-controlled unreadability can improve both published rates through selective exclusion.**

   The denominator contains only `caught` and `passed`. The model controls whether its answer parses, so it also controls which observations enter that denominator.

   Concrete construction: across ten seeded trials, return a valid refusal for one obvious defect and malformed output for the other nine. The published detection rate is 1/1, or 100%, despite only one demonstrated catch in ten trials. On controls, return valid passes where willing to accept and malformed refusals elsewhere; those refusals disappear from the false-refusal denominator.

   The unreadable counters make this discoverable, but do not make the headline rates rates over all seeded items and controls. The committed alone result demonstrates the distinction: its detection denominator is 24 despite 33 seeded trials, and its false-refusal denominator is 19 despite 24 control trials.

   **Resolve:** publish coverage and clearly label any readable-only rates as conditional. For the advertised full-run measurement, use all attempted trials: unreadable seeded outcomes earn no detection credit; unreadable controls must remain visible as operational refusals or uncertainty in the full-sample false-refusal estimate. Confidence: high.

4. **`packages/benchmark/src/corpus.ts:107`, `packages/benchmark/src/corpus.ts:130`, `packages/benchmark/src/corpus.ts:224–230` — factually wrong — medium — Pinning does not enforce version immutability, and the digest omits policy and detector definitions.**

   The returned corpus digest is computed from file digests that explicitly exclude `corpus.json`. That excluded manifest contains `builderGlobs` and the definitions of expected detectors.

   Concrete construction: change the `calc` builder grants to include `docs/**`. The `outside-globs` item now runs under a different policy, but the corpus version and digest remain identical. Changing detector prefixes likewise changes `detectorFired` without changing either identifier.

   Separately, an editor can change an item, call `pinCorpus` on `v1`, and regenerate the committed result without a version bump. The test at `packages/benchmark/test/corpus.test.ts:72–79` explicitly verifies that this works. CI’s result comparison detects an unrecorded result change; it does not enforce a new corpus version.

   This is a maintenance/configuration bypass, not a capability granted to a sandboxed agent.

   **Resolve:** include the manifest’s semantic content in the corpus digest and enforce an immutable version-to-digest mapping against a previously released reference. Refuse repinning released versions. Confidence: high.

The mechanisms I assess as sound, within the supplied code, are:

- **Answer-key separation:** `ScriptedSeat` receives the change and claim rather than the whole item; `landed` renders only file changes, and run directories use random identifiers. I found no direct transmission of the shipped items’ labels or expected detectors through those paths.
- **Strict verdict shape checking:** `readVerdict` validates parsed values at runtime before its casts. Ordinary prose, extra fields, wrong types, and contradictory verdict/reason combinations become unreadable. Its classification is sound; the downstream denominator policy is the problem.
- **Default deterministic comparison:** with the workflow’s shown environment, the fresh serialized result is compared with the committed bytes. The scanner test also requires a successful execution and an empty parsed report; its `--exit-code 0` does not alone make findings pass.
- **Alone-arm metering refusal:** `aloneCall` rejects a missing relay before provisioning and rejects missing teardown metering. I cannot verify the actual monetary ceiling or Clopper–Pearson implementation because those imported implementations are absent.

I found no demonstrated TypeScript-specific privilege escape under the stated trust boundary. The casts of Vault records rely on trusted runtime-produced data; replacing those components or injecting code into the runtime would exceed that boundary. The statistical test reuses the same rate helpers as production, so it checks aggregation and rounding, not independently the correctness of the confidence-bound mathematics.

The adversarial framing is appropriate. The central distinction needs to be sharper: **a runtime refusing to proceed is not necessarily a detector identifying a defect**. This benchmark currently merges those facts in the line and critic arms, while selectively excluding unreadable answers in the alone arm. Reporting substantive detection, operational refusal, and unmeasured outcomes separately would make the comparison defensible.