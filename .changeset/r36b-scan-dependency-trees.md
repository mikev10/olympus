---
'@olympus-ai/api': patch
---

A security check scans the tree without its dependency trees (`node_modules`, `.venv`, `site-packages`, `__pycache__`), which are the runtime's install, never the change's, so a scan no longer runs past its wall clock on an installed Node.js tree.
