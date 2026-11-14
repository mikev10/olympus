---
"@olympus-ai/adapters": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/readiness": minor
"@olympus-ai/conformance": minor
---

R29: a Python adapter set. pytest 8.4+ and 9, selected when `pyproject.toml` or a requirements file declares it and its version pinned by the lockfile, enumerates suites by pytest's own collection rules read statically and reads assertions, skip markers, and cases from a parse on the host; a config, conftest hook, or plugin that changes collection is refused, naming it. coverage.py's JSON report gives changed-line coverage. Python's config files are protected. `AdapterSet` names its dependency trees and its check image (A-R29-01); `DependencyInstaller.invocation` and `InstallRecord.invocation` become `steps` (A-R29-02), and uv (`uv.lock`) and pip (hashed `requirements.txt`) installs make a copied virtualenv and build nothing. Checks of a Python repository run in the image its install ran in, a task's writes to `.venv`, `site-packages`, or `__pycache__` are never carried, and readiness can clear a Python repository past L0.
