---
"@olympus-ai/sandbox": patch
---

One build of a harness image tag at a time (A-R53-02, #231). `recordedImage` holds a lock per tag around inspect, build, and record, so two hosts started together are handed the same image instead of one of them an ID the engine no longer holds. A lock left behind by a build that was cut short is refused and names the directory to remove; it is never taken over.
