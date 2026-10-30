BASE: reviewed/R21
HEAD: ed7a140
packages/vault/src/types.ts
f76ca1d77868e92c262cdc0ab5fe852a

I performed no lookups and held no prior context about this project.

### 1. `i7/no-untrusted-sink` can be bypassed using object literals, arrays, and spread syntax
**File**: `packages/conformance/lint/untrusted-sink.js:14` (and line 47)
**Type**: concrete bypass
**Severity**: High

**The concrete bypass:** 
The `isUntrusted` helper determines if a type is untrusted by asserting that its explicit name is `UntrustedText` or `UntrustedPayload`. However, it does not recursively unpack structural types like arrays or objects. An attacker writing agent code can bypass the sink rule entirely by wrapping the payload in an array or an anonymous object literal, which evaluates to `false` in `isUntrusted`:

```typescript
const obj = { raw: payload.raw };
// Bypasses the rule! `obj` is `{ raw: UntrustedText }`, which is not matched by `isUntrusted`.
JSON.stringify(obj); 

const arr = [payload.raw];
// Bypasses the rule! `arr` is `UntrustedText[]`, which is not matched by `isUntrusted`.
JSON.stringify(arr);
```

Additionally, the `checkSlot` function explicitly ignores `SpreadElement` nodes, creating a second trivial bypass:
```typescript
const spreadObj = { ...payload }; // checkSlot explicitly ignores SpreadElement
JSON.stringify(spreadObj); // Bypasses the rule!
```
Because the contextual type of `{ raw: payload.raw }` without an explicit annotation is `undefined`, `checkSlot` in `Property(node)` also bails out early (it only reports when `contextual` is opaque). Together, these blind spots allow untrusted text to be serialized and escape the I7 invariant.

**Resolution:** 
The lint rule should be rewritten to recursively trace generic type arguments, array elements, and object properties for untrusted types, rather than just matching the top-level type name. `checkSlot` must also flag assignments of untrusted fields within spread elements and object literals regardless of whether the broader object has a contextual type.

### 2. `I7.candidate-payload-reaches-no-driver` is a tautological check
**File**: `packages/conformance/src/registry/triggers.ts:173`
**Type**: tautological check
**Severity**: High

**The issue:** 
The conformance assertion claims to prove that "no driver request carries any byte of the delivery body". It tests this property by capturing the `stubDriver` requests and ensuring that `MARKER` (the untrusted body text) does not appear in them. 

However, the assertion sets up the test by running `admitWith`, which utilizes the `hello` line fixture (`rig.request`). The `hello` fixture uses hardcoded, static artifacts that compile a simple hello-world script and *never* reference the trigger candidate's extracted fields. Because the line execution naturally ignores the payload entirely, the driver is never tasked with evaluating it. Thus, the test will trivially pass even if the runtime were to dangerously inject the raw payload everywhere else, because the specific fixture being driven ignores it.

**Resolution:** 
The test must supply a mock task template/fixture that actively attempts to incorporate the candidate's `extracted` fields into the driver's prompt. This would prove that only the safe, bounded schema values can reach the driver, and that the raw body text (`MARKER`) truly remains inaccessible.