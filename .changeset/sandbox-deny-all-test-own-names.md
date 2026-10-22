---
"@olympus-ai/sandbox": patch
---

The deny-all test checks this sandbox's own proxy names rather than every egress network and proxy on the Docker host, so another suite's allowlisted sandbox running at the same time no longer fails it (#56). Test only.
