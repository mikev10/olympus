---
description: Check for and install Olympus updates
---

[UPDATE CHECK]

$ARGUMENTS

## Checking for Updates

I will check for available updates to Olympus.

### What This Does

1. **Check Version**: Compare your installed version against the latest release on GitHub
2. **Show Release Notes**: Display what's new in the latest version
3. **Perform Update**: If an update is available and you confirm, download and install it

### Update Methods

**npm (Recommended):**
```bash
npm update -g olympus-ai
olympus-ai install --force
```

**Alternative (install script):**
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/mikev10/olympus/main/scripts/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/mikev10/olympus/main/scripts/install.ps1 | iex
```

### Version Info Location

Your version information is stored at: `~/.claude/.olympus-version.json`

---

Let me check for updates now. I'll read your version file and compare against the latest GitHub release.
