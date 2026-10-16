---
"@olympus-ai/adapters": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

R17 review fixes. A security check's scan copy renames each entry carrying a
scanner's in-tree configuration name with `.scan-set-aside` instead of
removing it, so its bytes are still scanned, and refuses as a provisioning
failure a tree that already holds the renamed name (D-R17-07). The gitleaks
parser replaces each secret the report holds in every finding's path with its
fingerprint (D-R17-08). Admission refuses a check naming `deniesRule` unless it
is required and declares `onBase` (D-R17-09).
