BASE: reviewed/R58
HEAD: 061f9f3
packages/sandbox/test/upstream.ts
111f3c77d9c6e1eee9b2b75e9cb83561

I have no prior context about this project from earlier conversations or memory, and I performed no external lookups.

The framing of the adversarial question is correct and appropriate for this code. The threat model accurately captures the capabilities of a malicious task attempting to bypass the budget by abusing the model name, service tiers, or container startup constraints.

### 6. Which mechanisms I assess as sound, and why

All provided mechanisms in this unit are robust and thoroughly defend the invariants against the specified threat model.

- **`PER_CALL_MODEL` and provisioning checks**: The strict regex check reliably catches and rejects unmeterable search models at both provisioning (`checkMeter`) and relay initialization. Because an unpriced model is rejected before any upstream request is made, a task model cannot sneak in a search model unless the trusted operator actively configures it. The check effectively mitigates the risk of an operator mistakenly including a default search model ID in the price table.
- **The `openai-responses` service tier check**: By verifying the `response.completed` event in the stream parser (and falling back to the whole body parser for non-streaming requests), the relay enforces that only the `default` service tier is used. If the tier is changed (e.g., to `priority`), `u.offTier` triggers the `exhausted = 'unreadable'` state, stopping the relay from forwarding future requests and fail-closing the budget. If the stream drops early before the `response.completed` event is received, the relay correctly fails closed by charging the ceiling (`maxOutputTokens`).
- **`relayCreateArgs`, `dockerStartWithInput`, and standard input delivery**: Moving the `RELAY_SOURCE` from the command line to `stdin` successfully mitigates the Windows 32,767-character limit without compromising container isolation. `docker start --interactive` forwards the script to `node -`, which reads until EOF and begins execution. `start.release()` safely kills the client (`docker start`), which detaches from the daemon but leaves the actual container running in the background natively. Since the credentials travel exclusively via the Docker daemon's environment mechanisms (and never through the args), the isolation boundaries hold. 
- **`windowsCommandLineLength` and conformance tests**: The parsing logic inside `windowsQuoted` precisely replicates standard `CommandLineToArgvW` quoting semantics, enabling the test suite to safely enforce maximum command-line lengths for each driver’s price table natively, effectively serving as an active guard against regression.