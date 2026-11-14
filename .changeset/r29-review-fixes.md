---
"@olympus-ai/adapters": minor
"@olympus-ai/api": patch
"@olympus-ai/readiness": patch
"@olympus-ai/conformance": patch
---

R29 review fixes: pytest and every Python install step start isolated (`-I`), so no file in the tree stands in for the runner; a conftest may hold fixtures and markers and no hook; a parametrize table the parse cannot count is refused; a rebound or redefined test, a skip by any alias or in any module, and every assertion argument that changes what passes are reported. `TestFrameworkAdapter` gains `skipSources(dir)`, the files whose skip markers tamper analysis reads.
