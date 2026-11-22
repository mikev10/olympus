---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": patch
---

R39: `LocalDockerOptions` gains `labels`, Docker labels the local provider
puts on every container and network it creates: the sandbox, its egress
proxy, its relay, and their networks. A key outside Docker's lower-case
reverse-DNS form, under a prefix Docker reserves, or a value with a control
character is refused at `create` with the new `labels` refusal layer (#19,
D-R39-05).

The conformance registry's `I1.vault-implementation-exposes-only-named-operations`
now reads a constructed `LocalVault` and its whole prototype chain, and
requires every named operation to be a plain method (#65). The I4 merge-token
check's file reader refuses a file it cannot read instead of counting it as
empty (#93).
