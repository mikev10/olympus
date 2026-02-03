# Olympus Configuration Guide

Olympus configuration is flexible and works out-of-the-box with sensible defaults. However, you can customize behavior by creating configuration files.

## Configuration Paths

Configuration can be set in two locations:
- **User-level:** `~/.config/claude-olympus/config.jsonc` (applies to all projects)
- **Project-level:** `.claude/olympus.jsonc` (overrides user-level for this project)

Project-level configuration takes precedence over user-level configuration.

## Configuration File Format

Configuration files use JSONC format (JSON with comments):

```jsonc
{
  // Comments are allowed
  "setting": "value"
}
```

---

## Token Efficiency Configuration

Token efficiency tracking is enabled by default and works automatically. No configuration is required for the system to function.

Configuration can be set in:
- `~/.config/claude-olympus/config.jsonc` (user-level)
- `.claude/olympus.jsonc` (project-level, overrides user config)

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `learning.tokenMetrics.enabled` | `true` | Enable/disable token tracking |
| `learning.tokenMetrics.warningThreshold` | `1.5` | Warn when session exceeds N x baseline (baseline is 10k) |
| `learning.tokenMetrics.minimumSamples` | `5` | Samples needed before recommendations |
| `learning.tokenMetrics.injectionTokenBudget` | `150` | Max tokens for efficiency section (total cap is 500 via MAX_INJECTION_TOKENS) |

**Note:** The injection token budget (150) is for the efficiency section only. The total injection cap is 500 tokens (MAX_INJECTION_TOKENS in learned-context.ts), which includes learning context + efficiency data.

### How Token Tracking Works

Token efficiency tracking is **completely automatic**:

1. **Data Capture** - Hooks automatically record tokens used per agent invocation (requires zero user action)
2. **Aggregation** - Stop hook calculates efficiency scores after each session
3. **Injection** - SessionStart hook injects efficiency guidance into Claude's context
4. **Application** - Claude reads guidance and considers efficiency when delegating agents

**No CLI commands or manual steps are required.** The system works silently in the background.

### What Gets Tracked

| Metric | Description |
|--------|-------------|
| `input_tokens` | Tokens sent to model (estimated via gpt-tokenizer) |
| `output_tokens` | Tokens received from model |
| `efficiency_score` | success_rate * (baseline / avg_tokens) |
| `trend` | improving / stable / declining / insufficient_data |

Session baselines are calculated automatically from historical data. When no historical data exists, a default baseline of 10,000 tokens (10k) is used.

### Example Configuration

#### Adjust Warning Threshold

To warn at 2.0x baseline instead of 1.5x:

```jsonc
// ~/.config/claude-olympus/config.jsonc
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
      "enabled": true,
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
      "enabled": true,
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

### Configuration Defaults Explained

**`enabled: true`** - Token tracking is on by default because:
- Collection has zero overhead (automatic hooks)
- Storage cost is minimal (~1-2KB per session)
- Benefits compound over time as data accumulates
- Can be disabled anytime without side effects

**`warningThreshold: 1.5`** - Sessions warn at 1.5x baseline because:
- 10k tokens is a reasonable baseline for typical development tasks
- 15k tokens (~1.5x) is elevated but not extreme
- This allows complex tasks to complete without nagging
- Configurable for projects with different cost requirements

**`minimumSamples: 5`** - Requires 5 samples before recommendations because:
- Statistical significance: 5 samples provides some confidence
- Early results: Not so high that new agents take forever to appear
- Avoids bad recommendations from sparse data

**`injectionTokenBudget: 150`** - Efficiency section gets up to 150 tokens because:
- Respects 500 token total cap (MAX_INJECTION_TOKENS)
- 150 tokens allows detailed agent rankings and patterns
- Leaves 350 tokens for learning context and other guidance
- Automatically scales down gracefully if less data is available

### Reset to Defaults

If you need to reset to default configuration, simply delete your custom config file:

```bash
# Remove user-level config (resets to hardcoded defaults)
rm ~/.config/claude-olympus/config.jsonc

# Remove project-level config (resets to user-level)
rm .claude/olympus.jsonc
```

---

## Optional: Inspecting Token Data (Power Users)

While the system works completely automatically, power users can inspect token data via CLI:

```bash
# Show agent efficiency rankings
olympus learn --efficiency

# Show cost breakdown by model and agent
olympus learn --show-costs

# Show current session budget status
olympus learn --budget-status
```

**These commands are completely optional.** The system works without running any CLI commands.

---

## FAQ

### Q: Does token tracking slow down my sessions?
**A:** No. Token collection happens automatically via lightweight hooks with negligible overhead (< 1ms per event).

### Q: Where is my token data stored?
**A:** Token data is stored locally in your Olympus learning system directory (`~/.olympus/learning/`) as part of feedback entries. No data is sent to external services.

### Q: Can I delete my token history?
**A:** Yes. Token data is stored with other learning data. Deleting your learning directory will remove all historical data, but you can start fresh immediately.

### Q: What if I don't want efficiency guidance in my context?
**A:** Disable token tracking via configuration (see "Disabling Token Tracking" above). The efficiency section will not be injected.

### Q: How is the baseline calculated?
**A:** The baseline starts at 10,000 tokens (10k). As you use Olympus more, the actual baseline is calculated from your historical sessions. Different baselines can be maintained per project and task type.

### Q: Can I override pricing in the cost estimates?
**A:** Pricing is not currently configurable, but the defaults use Claude's published pricing. If pricing changes, Olympus will be updated accordingly.

---

## Related Documentation

- **[Understanding the Orchestration System](./guide/understanding-orchestration-system.md)** - Detailed explanation of how token efficiency integrates with the learning system
- **[Overview](./guide/overview.md)** - High-level introduction to Olympus
- **[Installation](./guide/installation.md)** - Getting started with Olympus
