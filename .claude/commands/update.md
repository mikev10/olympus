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

**Automatic (Recommended):**
Run the install script to update:
```bash
curl -fsSL https://raw.githubusercontent.com/mikev10/olympus/main/scripts/install.sh | bash
```

**Manual:**
1. Check your current version in `~/.claude/.olympus-version.json`
2. Visit https://github.com/mikev10/olympus/releases
3. Download and run the install script from the latest release

### Version Info Location

Your version information is stored at: `~/.claude/.olympus-version.json`

---

Let me check for updates now. I'll read your version file and compare against the latest GitHub release.