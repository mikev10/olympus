BASE: reviewed/R21
HEAD: d71b5fb
packages/vault/src/types.ts
1898c5917cb053634fc65e6f613d7bbb

I have no prior context about this project and performed no external lookups.

**1. `i7/no-untrusted-sink` can be bypassed by wrapping untrusted text in arrays, objects, or using generic erasure**
- **file:line**: `packages/conformance/lint/untrusted-sink.js:15`
- **type**: escape hatch / tautological check
- **severity**: high
- **the concrete bypass**: The custom ESLint rule `i7/no-untrusted-sink` claims to prevent `UntrustedText` from being widened or serialized, protecting invariant I7. However, its `isUntrusted` function only checks if the exact name of the top-level type is `UntrustedText` or `UntrustedPayload`. An attacker (or a developer unknowingly violating the invariant) can evade detection by wrapping the payload in a structural type—for example, `const arr = [payload.raw]; sink(arr);` or `JSON.stringify({ raw: payload.raw })`. The type name becomes `Array` or an anonymous object, for which `isUntrusted` returns `false`, causing the rule to silently skip the sink validation. Additionally, generic erasure bypasses the check entirely: `function leak<T>(value: T): unknown { return value; }; const widened = leak(payload.raw);`. The contextual type `T` is a `TypeParameter`, which `isOpaque` evaluates as `false`, and `isUntrusted` also misses it because its name is `T`. This allows the text to be serialized or widened to `any`/`unknown` without triggering an ESLint error, completely defeating the check while passing the conformance suite.
- **what would resolve it**: Modify `isUntrusted` to recursively inspect type arguments (for arrays/generics) and properties (for object types) for untrusted types, rather than just checking the top-level type name. Additionally, update `isOpaque` to flag unconstrained generic type parameters as opaque slots.

**2. `discard` does not keep the connection open for oversized payloads, resulting in a connection reset instead of a clean 413 response**
- **file:line**: `packages/api/src/http/server.ts:166` (and `182`)
- **type**: ways the configuration can be satisfied without doing what it appears to do
- **severity**: low
- **the concrete bypass**: The `readCapped` function consumes the request stream using a `for await...of` loop. When the body exceeds the byte cap, it returns `'oversize'`, which exits the loop early. In Node.js, breaking out of an async iterator on a stream automatically destroys the stream. Therefore, by the time `discard(req, MAX_DELIVERY_BYTES)` is called to drain the remaining bytes, the request stream is already destroyed, and the TCP connection has been abruptly cut. The sender receives a connection reset rather than the intended HTTP 413 Payload Too Large response, defeating the explicit purpose of `discard` which claims to let the bytes pass "so the sender reads the answer rather than a reset".
- **what would resolve it**: Stop using a `for await...of` loop if the stream needs to remain open for the HTTP response. Instead, manually attach `data` listeners, or pause the stream, remove the listeners, and then call `discard`. Alternatively, accept the TCP reset behavior as a valid fail-closed mechanism and remove the `discard` function to simplify the code.

**Assessment of Mechanisms:**
The core mechanisms of the trigger framework are overwhelmingly sound:
- **Order of Checks & Fail Closed**: The delivery pipeline correctly validates the subscription, byte cap, constant-time HMAC, replay digest, staleness, and budget in the exact required order. Missing fields, over-cap values, or invalid formats result in strict schema refusals without silent truncation.
- **Budgeting & Expiry**: Concurrency control via the `#serial` queue and Vault's exclusive creates successfully prevents race conditions. The global budget only counts valid, fully-verified candidates, avoiding DoS attacks using junk payloads. Expiration correctly operates entirely on the runtime's clock.
- **Payload Constraints**: The `FIELD_SCHEMAS` and `CHAR_CLASSES` strictly bound what can be extracted. Free-text fields like `title` and `body` are safely excluded from extraction, ensuring untrusted payload data is highly constrained before entering the runtime.