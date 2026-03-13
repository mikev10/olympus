# Olympus Configuration Guide

Olympus configuration is flexible and works out-of-the-box with sensible defaults. However, you can customize behavior by creating configuration files.

## Configuration Paths

Configuration can be set in two locations:
- **User-level:** `~/.claude/olympus/config.jsonc` (applies to all projects)
- **Project-level:** `.claude/olympus.jsonc` (overrides user-level for this project)

Project-level configuration takes precedence over user-level configuration. Environment variables take the highest precedence.

## Configuration File Format

Configuration files use JSONC format (JSON with comments):

```jsonc
{
  // Comments are allowed
  "setting": "value"
}
```

---

## Feature Toggles

Control which Olympus features are active:

| Option | Default | Description |
|--------|---------|-------------|
| `features.parallelExecution` | `true` | Enable parallel agent execution |
| `features.lspTools` | `true` | Enable LSP integration with language servers |
| `features.astTools` | `true` | Enable AST tools using ast-grep |
| `features.continuationEnforcement` | `true` | Enforce task completion before stopping |
| `features.autoContextInjection` | `true` | Auto-inject learned context at session start |

```jsonc
{
  "features": {
    "parallelExecution": true,
    "continuationEnforcement": false  // Disable persistence enforcement
  }
}
```

---

## Model Routing

Configure how Olympus selects model tiers for agents:

| Option | Default | Description |
|--------|---------|-------------|
| `routing.enabled` | `true` | Enable intelligent model routing |
| `routing.defaultTier` | `"MEDIUM"` | Default tier when no rules match (`LOW`, `MEDIUM`, `HIGH`) |
| `routing.escalationEnabled` | `true` | Auto-escalate to higher tier on failure |
| `routing.maxEscalations` | `2` | Maximum escalation attempts |

You can also override tier models and per-agent tier assignments:

```jsonc
{
  "routing": {
    "enabled": true,
    "defaultTier": "LOW",         // Start cheap, escalate as needed
    "escalationEnabled": true,
    "agentOverrides": {
      "oracle": { "tier": "HIGH", "reason": "Deep reasoning required" },
      "explore": { "tier": "LOW", "reason": "Search-focused tasks" }
    }
  }
}
```

---

## Agent Configuration

Override models or disable specific agents:

```jsonc
{
  "agents": {
    "oracle": { "model": "claude-opus-4-5-20251101", "enabled": true },
    "explore": { "model": "claude-haiku-4-5-20251001" },
    "frontendEngineer": { "enabled": false }
  }
}
```

Available agents: `olympus`, `oracle`, `librarian`, `explore`, `frontendEngineer`, `documentWriter`, `multimodalLooker`, `momus`, `metis`, `prometheus`.

---

## Permissions

| Option | Default | Description |
|--------|---------|-------------|
| `permissions.allowBash` | `true` | Allow bash command execution |
| `permissions.allowEdit` | `true` | Allow file editing |
| `permissions.allowWrite` | `true` | Allow file writing |
| `permissions.maxBackgroundTasks` | `5` | Maximum concurrent background tasks (1-20) |

---

## The Ascent

| Option | Default | Description |
|--------|---------|-------------|
| `ascent.maxIterations` | `100` | Maximum iterations before safety stop (10-1000) |

---

## Hook Configuration

Disable individual hooks or all hooks globally:

```jsonc
{
  "hooks": {
    "enabled": true,              // Set false to disable ALL hooks
    "hookTimeoutMs": 100,         // Per-hook timeout in ms
    "agentUsageReminder": { "enabled": false },
    "preemptiveCompaction": { "enabled": true, "warningThreshold": 0.7 }
  }
}
```

See `src/shared/types.ts` for the full list of configurable hooks.

---

## Magic Keywords

Customize the trigger words for enhanced modes:

```jsonc
{
  "magicKeywords": {
    "ultrawork": ["ultrawork", "ulw", "uw"],
    "search": ["search", "find", "locate"],
    "analyze": ["analyze", "investigate", "examine"],
    "ultrathink": ["ultrathink", "think", "reason", "ponder"]
  }
}
```

---

## Learning System

The learning system captures feedback, patterns, and preferences automatically.

| Option | Default | Description |
|--------|---------|-------------|
| `learning.enabled` | `true` | Enable the learning system |
| `learning.contextInjection` | `true` | Inject learned context at session start |
| `learning.maxContextTokens` | `500` | Maximum tokens for injected context |
| `learning.minPatternOccurrences` | `3` | Minimum occurrences to learn a pattern |
| `learning.preferenceDecayDays` | `30` | Days before preferences decay |

### Token Efficiency Tracking

Token efficiency tracking is a subsystem of learning. It is enabled by default and works automatically — no configuration required.

| Option | Default | Description |
|--------|---------|-------------|
| `learning.tokenMetrics.enabled` | `true` | Enable/disable token tracking |
| `learning.tokenMetrics.warningThreshold` | `1.5` | Warn when session exceeds N x baseline (baseline is 10k) |
| `learning.tokenMetrics.minimumSamples` | `5` | Samples needed before recommendations |
| `learning.tokenMetrics.injectionTokenBudget` | `150` | Max tokens for efficiency section (total cap is 500 via MAX_INJECTION_TOKENS) |
| `learning.tokenMetrics.sessionBaseline` | `10000` | Expected baseline tokens per session |

**Note:** The injection token budget (150) is for the efficiency section only. The total injection cap is 500 tokens (MAX_INJECTION_TOKENS in learned-context.ts), which includes learning context + efficiency data.

### How Token Tracking Works

Token efficiency tracking is **completely automatic**:

1. **Data Capture** - Hooks estimate token usage from prompts and tool results throughout the session (requires zero user action)
2. **Aggregation** - Stop hook calculates efficiency scores and writes a session summary
3. **Injection** - SessionStart hook injects efficiency guidance into Claude's context
4. **Application** - Claude reads guidance and considers efficiency when delegating agents

Token counts are **estimated locally** using a tokenizer (not API-reported). Totals are recorded **per session** and attributed to the agents used during that session.

**No CLI commands or manual steps are required.** The system works silently in the background.

### What Gets Tracked

| Metric | Description |
|--------|-------------|
| `input_tokens` | Tokens sent to model (estimated via gpt-tokenizer) |
| `output_tokens` | Tokens received from model (estimated) |
| `efficiency_score` | success_rate * (baseline / avg_tokens) |
| `trend` | improving / stable / declining / insufficient_data |

Session baselines are calculated automatically from historical data. When no historical data exists, the default baseline of 10,000 tokens (10k) is used.

### Example Configuration

#### Adjust Warning Threshold

To warn at 2.0x baseline instead of 1.5x:

```jsonc
// ~/.claude/olympus/config.jsonc
{
  "learning": {
    "tokenMetrics": {
      "enabled": true,
      "warningThreshold": 2.0  // Warn at 20k tokens (2.0 * 10k baseline)
    }
  }
}
```

#### Increase Minimum Samples Before Recommendations

To require 10 samples before efficiency data appears in context:

```jsonc
{
  "learning": {
    "tokenMetrics": {
      "minimumSamples": 10  // Default is 5
    }
  }
}
```

#### Custom Configuration for Specific Project

Create `.claude/olympus.jsonc` in your project root to override user settings:

```jsonc
// .claude/olympus.jsonc (project-level)
{
  "learning": {
    "tokenMetrics": {
      "warningThreshold": 1.2,  // This project is cost-sensitive
      "minimumSamples": 10      // Higher bar before recommendations
    }
  }
}
```

### Disabling Token Tracking

To disable token tracking entirely (both collection and injection):

```jsonc
{
  "learning": {
    "tokenMetrics": {
      "enabled": false
    }
  }
}
```

When disabled:
- Token data is no longer captured during sessions
- No efficiency guidance is injected into context
- Budget warnings are not shown
- Existing token data is preserved (not deleted)

---

## Workflow Engine

| Option | Default | Description |
|--------|---------|-------------|
| `workflow.enabled` | `true` | Enable structured workflow system |
| `workflow.defaultMode` | `"continuous"` | `"manual"` or `"continuous"` |
| `workflow.autoCheckpoint` | `true` | Checkpoint at each stage |
| `workflow.timeouts.agentExecution` | `300000` | Agent execution timeout (ms) |
| `workflow.timeouts.validation` | `60000` | Validation timeout (ms) |
| `workflow.timeouts.resume` | `30000` | Resume operation timeout (ms) |

---

## Pricing

Pricing defaults follow Claude's published pricing. You can add custom overrides:

```jsonc
{
  "pricing": {
    "customPricing": [
      {
        "model_pattern": "claude-sonnet-*",
        "input_per_million": 3.0,
        "output_per_million": 15.0,
        "effective_date": "2025-01-01"
      }
    ]
  }
}
```

---

## Environment Variables

These environment variables override config file settings (highest precedence):

| Variable | Description |
|----------|-------------|
| `OLYMPUS_PARALLEL_EXECUTION` | `"true"` / `"false"` — toggle parallel execution |
| `OLYMPUS_LSP_TOOLS` | `"true"` / `"false"` — toggle LSP tools |
| `OLYMPUS_MAX_BACKGROUND_TASKS` | Integer — max concurrent background tasks |
| `OLYMPUS_ROUTING_ENABLED` | `"true"` / `"false"` — toggle model routing |
| `OLYMPUS_ROUTING_DEFAULT_TIER` | `"LOW"` / `"MEDIUM"` / `"HIGH"` — default routing tier |
| `OLYMPUS_ESCALATION_ENABLED` | `"true"` / `"false"` — toggle auto-escalation |
| `OLYMPUS_MAX_ASCENT_ITERATIONS` | Integer (10-1000) — max ascent iterations |

---

## Optional: Inspecting Token Data (Power Users)

While the system works completely automatically, power users can inspect token data via CLI:

```bash
# Show agent efficiency rankings
olympus-ai learn --efficiency

# Show cost breakdown by model and agent
olympus-ai learn --show-costs

# Show current session budget status
olympus-ai learn --budget-status
```

**These commands are completely optional.** The system works without running any CLI commands.

---

## Reset to Defaults

If you need to reset to default configuration, simply delete your custom config file:

```bash
# Remove user-level config (resets to hardcoded defaults)
rm ~/.claude/olympus/config.jsonc

# Remove project-level config (resets to user-level)
rm .claude/olympus.jsonc
```

---

## FAQ

### Q: Does token tracking slow down my sessions?
**A:** No. Token collection happens automatically via lightweight hooks with negligible overhead (< 1ms per event).

### Q: Where is my token data stored?
**A:** Token data is stored locally in your Olympus learning directory (`~/.claude/olympus/learning/`) as part of feedback entries. Project-specific data is stored in `.olympus/learning/`. No data is sent to external services.

### Q: Can I delete my token history?
**A:** Yes. Token data is stored with other learning data. Deleting your learning directory will remove all historical data, but you can start fresh immediately.

### Q: What if I don't want efficiency guidance in my context?
**A:** Disable token tracking via configuration (see "Disabling Token Tracking" above). The efficiency section will not be injected.

### Q: How is the baseline calculated?
**A:** The baseline starts at 10,000 tokens (10k). As you use Olympus more, the actual baseline is calculated from your historical sessions. Different baselines can be maintained per project and task type.

### Q: Can I override pricing in the cost estimates?
**A:** Yes. Use the `pricing.customPricing` array in your config file (see "Pricing" section above).

---

## Related Documentation

- **[Understanding the Orchestration System](./guide/understanding-orchestration-system.md)** - Detailed explanation of how token efficiency integrates with the learning system
- **[Overview](./guide/overview.md)** - High-level introduction to Olympus
- **[Installation](./guide/installation.md)** - Getting started with Olympus
