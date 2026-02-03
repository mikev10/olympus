/**
 * Token pricing configuration for cost estimation
 * No external dependencies - using Node.js built-ins only
 */

export interface ModelPricing {
  model_pattern: string;        // Regex pattern to match model IDs
  input_per_million: number;    // Cost per million input tokens in USD
  output_per_million: number;   // Cost per million output tokens in USD
  effective_date: string;       // When this pricing became effective (ISO 8601)
}

/**
 * Default pricing for Claude models (as of 2025-01-01)
 * Prices are per million tokens in USD
 */
export const DEFAULT_PRICING: ModelPricing[] = [
  {
    model_pattern: 'claude-opus',
    input_per_million: 15.0,
    output_per_million: 75.0,
    effective_date: '2025-01-01'
  },
  {
    model_pattern: 'claude-sonnet',
    input_per_million: 3.0,
    output_per_million: 15.0,
    effective_date: '2025-01-01'
  },
  {
    model_pattern: 'claude-haiku',
    input_per_million: 0.25,
    output_per_million: 1.25,
    effective_date: '2025-01-01'
  }
];

/**
 * Calculate cost based on token usage and pricing
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  pricing: ModelPricing[] = DEFAULT_PRICING
): { inputCost: number; outputCost: number; totalCost: number; pricingVersion: string } {
  // Find matching pricing entry
  const matchedPricing = pricing.find(p =>
    new RegExp(p.model_pattern, 'i').test(modelId)
  );

  if (!matchedPricing) {
    // Default to Sonnet pricing if model not found
    const defaultPricing = pricing.find(p => p.model_pattern === 'claude-sonnet') || {
      input_per_million: 3.0,
      output_per_million: 15.0,
      effective_date: '2025-01-01'
    };

    const inputCost = (inputTokens / 1_000_000) * defaultPricing.input_per_million;
    const outputCost = (outputTokens / 1_000_000) * defaultPricing.output_per_million;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      pricingVersion: defaultPricing.effective_date
    };
  }

  const inputCost = (inputTokens / 1_000_000) * matchedPricing.input_per_million;
  const outputCost = (outputTokens / 1_000_000) * matchedPricing.output_per_million;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    pricingVersion: matchedPricing.effective_date
  };
}

/**
 * Load custom pricing configuration from file
 * Returns null if file doesn't exist or has errors
 */
export function loadPricingConfig(configPath?: string): ModelPricing[] | null {
  if (!configPath) {
    return null;
  }

  try {
    const { readFileSync, existsSync } = require('fs');

    if (!existsSync(configPath)) {
      return null;
    }

    const content = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate structure
    if (!Array.isArray(parsed)) {
      console.error('[Olympus Pricing] Invalid pricing config: expected array');
      return null;
    }

    // Validate each entry
    const validPricing = parsed.filter((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) {
        return false;
      }

      const p = entry as Record<string, unknown>;
      return (
        typeof p.model_pattern === 'string' &&
        typeof p.input_per_million === 'number' &&
        typeof p.output_per_million === 'number' &&
        typeof p.effective_date === 'string'
      );
    }) as ModelPricing[];

    return validPricing.length > 0 ? validPricing : null;
  } catch (error) {
    console.error('[Olympus Pricing] Failed to load pricing config:', error);
    return null;
  }
}
