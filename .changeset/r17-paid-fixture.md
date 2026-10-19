---
"@olympus-ai/api": patch
---

The paid line suite's `hello-change` fixture pins a `secret-scan` check of the
gitleaks image, which admission requires of every run since R17; without it
the paid suite's run was refused before it started.
