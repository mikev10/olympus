/**
 * Anomaly detection for token usage
 * Detects when current session deviates significantly from baseline
 */

/**
 * Anomaly detection result
 */
export interface AnomalyResult {
  is_anomaly: boolean;
  severity: 'info' | 'warning' | 'critical';
  ratio: number;        // current / baseline
  message: string;
}

/**
 * Thresholds for anomaly detection
 */
export interface AnomalyThresholds {
  warning: number;      // e.g., 1.5 = 150% of baseline
  critical: number;     // e.g., 2.5 = 250% of baseline
}

/**
 * Default thresholds
 */
const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  warning: 1.5,
  critical: 2.5
};

/**
 * Detect if current token usage is anomalous
 *
 * @param currentTokens - Tokens used in current session
 * @param baseline - Expected baseline tokens
 * @param thresholds - Optional custom thresholds
 * @returns Anomaly detection result
 */
export function detectAnomaly(
  currentTokens: number,
  baseline: number,
  thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS
): AnomalyResult {
  // Validate inputs
  if (currentTokens < 0 || baseline < 0) {
    throw new Error('Token counts cannot be negative');
  }

  if (thresholds.warning < 0 || thresholds.critical < 0) {
    throw new Error('Thresholds cannot be negative');
  }

  if (thresholds.critical <= thresholds.warning) {
    throw new Error('Critical threshold must be greater than warning threshold');
  }

  // Handle edge case: no baseline (first session)
  if (baseline === 0) {
    return {
      is_anomaly: false,
      severity: 'info',
      ratio: 0,
      message: 'No baseline data available. Establishing baseline.'
    };
  }

  // Calculate ratio
  const ratio = currentTokens / baseline;

  // Check for critical anomaly
  if (ratio >= thresholds.critical) {
    return {
      is_anomaly: true,
      severity: 'critical',
      ratio,
      message: formatAnomalyMessage(currentTokens, baseline, ratio, 'critical')
    };
  }

  // Check for warning anomaly
  if (ratio >= thresholds.warning) {
    return {
      is_anomaly: true,
      severity: 'warning',
      ratio,
      message: formatAnomalyMessage(currentTokens, baseline, ratio, 'warning')
    };
  }

  // Normal usage
  return {
    is_anomaly: false,
    severity: 'info',
    ratio,
    message: `Session at ${formatTokens(currentTokens)} (${formatRatio(ratio)} of baseline)`
  };
}

/**
 * Format anomaly message with clear, actionable information
 */
function formatAnomalyMessage(
  currentTokens: number,
  baseline: number,
  ratio: number,
  severity: 'warning' | 'critical'
): string {
  const tokenStr = formatTokens(currentTokens);
  const baselineStr = formatTokens(baseline);
  const ratioStr = formatRatio(ratio);

  if (severity === 'critical') {
    return `Session at ${tokenStr} (${ratioStr} of ${baselineStr} baseline). ` +
           `This is unusually high. Consider: ` +
           `(1) Is this a complex task requiring more resources? ` +
           `(2) Could work be delegated to subagents? ` +
           `(3) Are there opportunities to break into smaller tasks?`;
  }

  // Warning severity
  return `Session at ${tokenStr} (${ratioStr} of ${baselineStr} baseline). ` +
         `This is above typical usage. ` +
         `Consider delegating remaining work or focusing on task completion.`;
}

/**
 * Format token count with K suffix for readability
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

/**
 * Format ratio as percentage
 */
function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}
