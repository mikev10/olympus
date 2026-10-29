---
"@olympus-ai/driver-openai-compatible": minor
"@olympus-ai/api": minor
---

The OpenAI-compatible driver and the host take a local endpoint on the Docker
host (R21, A-R21-04).

- `EndpointConfig.upstream` takes `{ "local": "docker-host", "port": <port> }`,
  and `scheme` takes `"none"`, for a local upstream only.
- An endpoint file declaring `"scheme": "none"` comes without
  `FACTORY_ENDPOINT_KEY`, and one given with it stops the host. A local
  upstream's port is the one Docker host port the sandbox provider is given.

On a Linux engine the host gateway is the bridge's address, so a model server
bound to `127.0.0.1` alone is not reachable; bind it to an address the bridge
reaches.
