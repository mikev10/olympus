---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
---

A model relay can reach a local endpoint on the Docker host (R21).

- `RelaySpec.upstream` takes `{ local: 'docker-host', port }`, forwarded over
  `http` to `model-host:<port>`, a name given to the relay container alone
  (A-R21-01). An `http` URL is still refused, whatever host it names.
- `RelaySpec.credential` takes `null` with the new `'none'` scheme, for a local
  upstream only (A-R21-02). The relay writes no credential and deletes the
  client's value in its header.
- `LocalDockerOptions.dockerHostPorts` names the ports a relay may reach; a
  local upstream on any other is refused (A-R21-03).
- Every network a sandbox joins, the relay's and the egress proxy's, is created
  with the isolated gateway mode, so the host holds no address on it. A network
  that comes back with a gateway or IPv6 is refused, which needs Docker Engine
  28.0 or later (D-R21-09).

Two assertions hold it: `I4.model-relay-reaches-the-docker-host-only-as-declared`
and `I5.model-relay-refuses-an-undeclared-local-endpoint`.
