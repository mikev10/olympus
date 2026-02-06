import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getRoutingRecommendation } from '../../learning/routing.js';
import type { AgentPerformance, TaskPattern } from '../../learning/types.js';

// Test fixtures directory
const TEST_LEARNING_DIR = join(process.cwd(), '.test-learning-routing');

describe('Smart Agent Routing', () => {
  beforeEach(() => {
    // Set test environment variable
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;

    // Clean up and recreate test directory
    if (existsSync(TEST_LEARNING_DIR)) {
      rmSync(TEST_LEARNING_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_LEARNING_DIR)) {
      rmSync(TEST_LEARNING_DIR, { recursive: true, force: true });
    }
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  });

  it('should recommend lower-tier agent with sufficient data', () => {
    // Create agent performance data
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('oracle', 'test task');

    expect(recommendation).not.toBeNull();
    expect(recommendation).toContain('oracle-low');
    expect(recommendation).toContain('15 data points');
    expect(recommendation).toContain('93% success rate');
  });

  it('should not recommend when data insufficient', () => {
    // Create agent performance data with insufficient invocations
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 5, // Below threshold of 10
        success_count: 5,
        revision_count: 0,
        cancellation_count: 0,
        success_rate: 1.0,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('oracle', 'test task');

    expect(recommendation).toBeNull();
  });

  it('should not recommend when success rate too low', () => {
    // Create agent performance data with low success rate
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 9, // 60% success rate
        revision_count: 6,
        cancellation_count: 0,
        success_rate: 0.6,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('oracle', 'test task');

    expect(recommendation).toBeNull();
  });

  it('should not recommend for lowest-tier agent', () => {
    // Create agent performance data
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    // Requesting oracle-low when it's already the lowest tier
    const recommendation = getRoutingRecommendation('oracle-low', 'test task');

    expect(recommendation).toBeNull();
  });

  it('should not recommend for unknown agent', () => {
    // Create agent performance data
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    // Request an agent not in the tier system
    const recommendation = getRoutingRecommendation('custom-agent', 'test task');

    expect(recommendation).toBeNull();
  });

  it('should create default routing-config.json on first run', () => {
    const configPath = join(TEST_LEARNING_DIR, 'routing-config.json');

    // Verify config doesn't exist yet
    expect(existsSync(configPath)).toBe(false);

    // Call routing recommendation (will create config)
    getRoutingRecommendation('oracle', 'test task');

    // Verify config was created
    expect(existsSync(configPath)).toBe(true);

    // Verify config has expected structure
    const config = JSON.parse(require('fs').readFileSync(configPath, 'utf-8'));
    expect(config).toHaveProperty('minDataPoints');
    expect(config).toHaveProperty('minSuccessRate');
    expect(config).toHaveProperty('preferLowerTier');
    expect(config).toHaveProperty('agentTiers');
    expect(config.minDataPoints).toBe(10);
    expect(config.minSuccessRate).toBe(0.80);
    expect(config.preferLowerTier).toBe(true);
  });

  it('should handle missing agent-performance.json', () => {
    // Don't create agent-performance.json
    // Should return null without error
    const recommendation = getRoutingRecommendation('oracle', 'test task');

    expect(recommendation).toBeNull();
  });

  it('should include task pattern information in recommendation', () => {
    // Create agent performance data with task patterns
    const taskPatterns: TaskPattern[] = [
      {
        pattern: 'simple_search',
        successfulAgents: ['oracle-low'],
        unsuccessfulAgents: [],
        confidence: 0.85,
      },
    ];

    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
        task_patterns: taskPatterns,
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('oracle', 'simple search for files');

    expect(recommendation).not.toBeNull();
    expect(recommendation).toContain('oracle-low');
    expect(recommendation).toContain('simple search');
  });

  it('should prefer lowest tier that meets criteria', () => {
    // Create performance data for multiple tiers
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 20,
        success_count: 18,
        revision_count: 2,
        cancellation_count: 0,
        success_rate: 0.90,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
      'oracle-medium': {
        agent_name: 'oracle-medium',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('oracle', 'test task');

    // Should recommend oracle-low (lowest tier) not oracle-medium
    expect(recommendation).not.toBeNull();
    expect(recommendation).toContain('oracle-low');
    expect(recommendation).not.toContain('oracle-medium');
  });

  it('should work with different agent families', () => {
    // Test with olympian family
    const performance: Record<string, AgentPerformance> = {
      'olympian-low': {
        agent_name: 'olympian-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    const recommendation = getRoutingRecommendation('olympian', 'implement feature');

    expect(recommendation).not.toBeNull();
    expect(recommendation).toContain('olympian-low');
  });

  it('should respect preferLowerTier configuration', () => {
    // Create routing config with preferLowerTier disabled
    const routingConfig = {
      minDataPoints: 10,
      minSuccessRate: 0.80,
      preferLowerTier: false,
      agentTiers: {
        oracle: ['oracle-low', 'oracle-medium', 'oracle'],
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'routing-config.json'),
      JSON.stringify(routingConfig, null, 2)
    );

    // Create good performance data
    const performance: Record<string, AgentPerformance> = {
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 15,
        success_count: 14,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.93,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
      },
    };

    writeFileSync(
      join(TEST_LEARNING_DIR, 'agent-performance.json'),
      JSON.stringify(performance, null, 2)
    );

    // Should not recommend because preferLowerTier is false
    const recommendation = getRoutingRecommendation('oracle', 'test task');

    expect(recommendation).toBeNull();
  });
});
