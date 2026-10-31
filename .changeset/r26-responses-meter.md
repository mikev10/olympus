---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
---

The relay meters OpenAI's Responses API (A-R26-01). `RelayDialect` gains `openai-responses`: a `POST` to a granted path ending `/responses` is metered, its usage read from the body or from a stream's `response.completed` event, cached input counted as cache reads. `ModelPrice` gains `maxOutputTokens`, which every model under that dialect must name, and which an unreadable answer is charged as output. The registry asserts the budget and the fail-closed rules under the new dialect.
