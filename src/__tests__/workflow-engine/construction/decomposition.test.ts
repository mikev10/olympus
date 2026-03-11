/**
 * Tests for Construction Phase: Hierarchical Decomposition
 *
 * Tests the core decomposition logic that transforms INTENTs into
 * named construction units (INTENT -> UNIT -> code generation).
 *
 * Includes tests for:
 * - Legacy parseIntentsFromDisk
 * - New parseIntentFromFile
 * - slugifyUnitName
 * - decomposeIntentToUnits with limits
 * - buildDecompositionTree
 * - getUnits
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  parseIntentsFromDisk,
  parseIntentFromFile,
  decomposeIntentToUnits,
  slugifyUnitName,
  buildDecompositionTree,
  getUnits,
  type UnitSpec,
} from '../../../features/workflow-engine/construction/decomposition.js';
import type { HierarchicalNode } from '../../../features/workflow-engine/phase-types.js';

describe('parseIntentsFromDisk', () => {
  const testDir = path.join(process.cwd(), '.test-decomposition-parse');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should parse INTENT files with frontmatter correctly', async () => {
    const intentContent = `---
id: INTENT-001
title: Setup Database Schema
status: pending
estimated_effort: 4
dependencies: []
---

# Task: Setup Database Schema

## Goal
Create database tables
`;

    await fs.writeFile(path.join(testDir, 'INTENT-001.md'), intentContent);

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      id: 'INTENT-001',
      type: 'intent',
      title: 'Setup Database Schema',
      status: 'pending',
      estimated_effort: 4,
      parent_id: null,
      children_ids: [],
      assigned_agent: null,
    });
  });

  it('should parse multiple INTENT files', async () => {
    const intent1 = `---
id: INTENT-001
title: First Intent
status: pending
estimated_effort: 3
dependencies: []
---

Content
`;

    const intent2 = `---
id: INTENT-002
title: Second Intent
status: in_progress
estimated_effort: 5
dependencies: ['INTENT-001']
assigned_agent: olympian
---

Content
`;

    await fs.writeFile(path.join(testDir, 'INTENT-001.md'), intent1);
    await fs.writeFile(path.join(testDir, 'INTENT-002.md'), intent2);

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toHaveLength(2);
    expect(intents.find(i => i.id === 'INTENT-001')).toMatchObject({
      id: 'INTENT-001',
      title: 'First Intent',
      status: 'pending',
      estimated_effort: 3,
    });
    expect(intents.find(i => i.id === 'INTENT-002')).toMatchObject({
      id: 'INTENT-002',
      title: 'Second Intent',
      status: 'in_progress',
      estimated_effort: 5,
      assigned_agent: 'olympian',
    });
  });

  it('should return empty array if directory does not exist', async () => {
    const nonExistentDir = path.join(testDir, 'does-not-exist');
    const intents = await parseIntentsFromDisk(nonExistentDir);

    expect(intents).toEqual([]);
  });

  it('should return empty array if no INTENT files found', async () => {
    await fs.writeFile(path.join(testDir, 'README.md'), '# Not an intent');
    await fs.writeFile(path.join(testDir, 'UNIT-001.md'), 'Also not an intent');

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toEqual([]);
  });

  it('should skip files without frontmatter', async () => {
    const validIntent = `---
id: INTENT-001
title: Valid Intent
status: pending
estimated_effort: 2
dependencies: []
---

Content
`;

    const invalidIntent = `# INTENT-002

No frontmatter here
`;

    await fs.writeFile(path.join(testDir, 'INTENT-001.md'), validIntent);
    await fs.writeFile(path.join(testDir, 'INTENT-002.md'), invalidIntent);

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toHaveLength(1);
    expect(intents[0].id).toBe('INTENT-001');
  });

  it('should handle missing optional fields with defaults', async () => {
    const minimalIntent = `---
id: INTENT-MIN
---

Minimal content
`;

    await fs.writeFile(path.join(testDir, 'INTENT-MIN.md'), minimalIntent);

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      id: 'INTENT-MIN',
      type: 'intent',
      title: 'Untitled Intent',
      status: 'pending',
      estimated_effort: 0,
      assigned_agent: null,
    });
  });

  it('should parse dependencies as array', async () => {
    const intentWithDeps = `---
id: INTENT-003
title: Dependent Intent
status: pending
estimated_effort: 2
dependencies: ['INTENT-001', 'INTENT-002']
---

Content
`;

    await fs.writeFile(path.join(testDir, 'INTENT-003.md'), intentWithDeps);

    const intents = await parseIntentsFromDisk(testDir);

    expect(intents).toHaveLength(1);
    // Note: dependencies are parsed but not currently stored in HierarchicalNode
    // This test verifies the parsing doesn't crash on array values
  });
});

describe('parseIntentFromFile', () => {
  const testDir = path.join(process.cwd(), '.test-decomposition-intent');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should return null if file does not exist', async () => {
    const result = await parseIntentFromFile(path.join(testDir, 'nonexistent.md'));
    expect(result).toBeNull();
  });

  it('should parse intent.md content', async () => {
    const content = `---
id: intent-test
title: "Test Feature"
status: pending
estimated_effort: 8
---

# Intent: Test Feature

## Business Requirements
Build the feature

## Implementation Plan
Follow standards
`;

    await fs.writeFile(path.join(testDir, 'intent.md'), content);

    const result = await parseIntentFromFile(path.join(testDir, 'intent.md'));

    expect(result).not.toBeNull();
    expect(result!.content).toBe(content);
    expect(result!.proposedUnits).toHaveLength(0);
  });

  it('should parse proposed UNITs section with bullet points', async () => {
    const content = `---
id: intent-multi
title: "Multi-Unit Feature"
status: pending
estimated_effort: 16
---

# Intent: Multi-Unit Feature

## Business Requirements
Build multiple components

### Proposed UNITs
- **Database Layer**: Handle data persistence and migrations
- **API Layer**: REST endpoint implementation
- **UI Layer**: Frontend components and pages

## Acceptance Criteria
- [ ] All units complete
`;

    await fs.writeFile(path.join(testDir, 'intent.md'), content);

    const result = await parseIntentFromFile(path.join(testDir, 'intent.md'));

    expect(result).not.toBeNull();
    expect(result!.proposedUnits).toHaveLength(3);
    expect(result!.proposedUnits[0]).toEqual({
      id: 'u-001-database-layer',
      title: 'Database Layer',
      description: 'Handle data persistence and migrations',
    });
    expect(result!.proposedUnits[1]).toEqual({
      id: 'u-002-api-layer',
      title: 'API Layer',
      description: 'REST endpoint implementation',
    });
    expect(result!.proposedUnits[2]).toEqual({
      id: 'u-003-ui-layer',
      title: 'UI Layer',
      description: 'Frontend components and pages',
    });
  });

  it('should handle UNIT-NNN format in proposed units', async () => {
    const content = `---
id: intent-explicit
title: "Explicit IDs"
---

# Intent

### Proposed UNITs
- **UNIT-001**: First unit
- **UNIT-002**: Second unit
`;

    await fs.writeFile(path.join(testDir, 'intent.md'), content);

    const result = await parseIntentFromFile(path.join(testDir, 'intent.md'));

    expect(result!.proposedUnits).toHaveLength(2);
    expect(result!.proposedUnits[0].id).toBe('u-001-unit-001');
    expect(result!.proposedUnits[1].id).toBe('u-002-unit-002');
  });

  it('should handle empty proposed UNITs section', async () => {
    const content = `---
id: intent-empty
title: "No Units"
---

# Intent

### Proposed UNITs

## Acceptance Criteria
- [ ] Done
`;

    await fs.writeFile(path.join(testDir, 'intent.md'), content);

    const result = await parseIntentFromFile(path.join(testDir, 'intent.md'));

    expect(result!.proposedUnits).toHaveLength(0);
  });

  it('should handle file without proposed UNITs section', async () => {
    const content = `---
id: intent-no-units
title: "Simple Intent"
---

# Intent

## Description
A simple intent without units
`;

    await fs.writeFile(path.join(testDir, 'intent.md'), content);

    const result = await parseIntentFromFile(path.join(testDir, 'intent.md'));

    expect(result).not.toBeNull();
    expect(result!.proposedUnits).toHaveLength(0);
  });
});

describe('decomposeIntentToUnits', () => {
  it('should create UNIT nodes with correct IDs', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unitSpecs: UnitSpec[] = [
      { title: 'Unit One', estimated_effort: 3 },
      { title: 'Unit Two', estimated_effort: 4 },
      { title: 'Unit Three', estimated_effort: 3 },
    ];

    const units = decomposeIntentToUnits(intent, unitSpecs);

    expect(units).toHaveLength(3);
    expect(units[0].id).toBe('u-001-unit-one');
    expect(units[1].id).toBe('u-002-unit-two');
    expect(units[2].id).toBe('u-003-unit-three');
  });

  it('should set parent_id to intent ID', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-042',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unitSpecs: UnitSpec[] = [
      { title: 'Unit Alpha', estimated_effort: 5 },
    ];

    const units = decomposeIntentToUnits(intent, unitSpecs);

    expect(units[0].parent_id).toBe('INTENT-042');
  });

  it('should update intent.children_ids', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unitSpecs: UnitSpec[] = [
      { title: 'Unit One', estimated_effort: 3 },
      { title: 'Unit Two', estimated_effort: 4 },
    ];

    decomposeIntentToUnits(intent, unitSpecs);

    expect(intent.children_ids).toEqual(['u-001-unit-one', 'u-002-unit-two']);
  });

  it('should create units with correct properties', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unitSpecs: UnitSpec[] = [
      { title: 'Database Setup', estimated_effort: 6 },
    ];

    const units = decomposeIntentToUnits(intent, unitSpecs);

    expect(units[0]).toMatchObject({
      id: 'u-001-database-setup',
      type: 'unit',
      title: 'Database Setup',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 6,
    });
  });

  it('should handle empty unitSpecs array', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const units = decomposeIntentToUnits(intent, []);

    expect(units).toEqual([]);
    expect(intent.children_ids).toEqual([]);
  });

  it('should preserve existing children_ids when adding new units', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Test Intent',
      parent_id: null,
      children_ids: ['EXISTING-UNIT'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unitSpecs: UnitSpec[] = [
      { title: 'New Unit', estimated_effort: 3 },
    ];

    decomposeIntentToUnits(intent, unitSpecs);

    expect(intent.children_ids).toEqual(['EXISTING-UNIT', 'u-001-new-unit']);
  });

  describe('limit enforcement', () => {
    it('should truncate units when exceeding maxUnits default (10)', () => {
      const intent: HierarchicalNode = {
        id: 'INTENT-001',
        type: 'intent',
        title: 'Big Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 50,
      };

      // 12 specs exceeds default limit of 10
      const unitSpecs: UnitSpec[] = Array.from({ length: 12 }, (_, i) => ({
        title: `Unit ${i + 1}`,
        estimated_effort: 4,
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const units = decomposeIntentToUnits(intent, unitSpecs);

      expect(units).toHaveLength(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unit specs (12) exceed maxUnits limit (10)')
      );

      warnSpy.mockRestore();
    });

    it('should respect custom maxUnits', () => {
      const intent: HierarchicalNode = {
        id: 'INTENT-001',
        type: 'intent',
        title: 'Custom Limit',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 20,
      };

      const unitSpecs: UnitSpec[] = Array.from({ length: 5 }, (_, i) => ({
        title: `Unit ${i + 1}`,
        estimated_effort: 4,
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const units = decomposeIntentToUnits(intent, unitSpecs, 3);

      expect(units).toHaveLength(3);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should not truncate when under limit', () => {
      const intent: HierarchicalNode = {
        id: 'INTENT-001',
        type: 'intent',
        title: 'Small Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 10,
      };

      const unitSpecs: UnitSpec[] = [
        { title: 'Unit One', estimated_effort: 5 },
        { title: 'Unit Two', estimated_effort: 5 },
      ];

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const units = decomposeIntentToUnits(intent, unitSpecs);

      expect(units).toHaveLength(2);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});

describe('slugifyUnitName', () => {
  it('should convert titles to lowercase hyphenated slugs with u-XXX- prefix', () => {
    expect(slugifyUnitName('Auth Service', 1)).toBe('u-001-auth-service');
    expect(slugifyUnitName('API Gateway', 2)).toBe('u-002-api-gateway');
    expect(slugifyUnitName('User Onboarding', 3)).toBe('u-003-user-onboarding');
  });

  it('should return fallback for empty titles', () => {
    expect(slugifyUnitName('', 1)).toBe('u-001-untitled');
    expect(slugifyUnitName('  ', 2)).toBe('u-002-untitled');
  });

  it('should strip non-alphanumeric characters', () => {
    expect(slugifyUnitName('Hello World!@#', 1)).toBe('u-001-hello-world');
  });

  it('should truncate slugs longer than 60 characters', () => {
    const longTitle = 'a'.repeat(80);
    const result = slugifyUnitName(longTitle, 1);
    const prefixLength = 'u-001-'.length;
    expect(result.length).toBeLessThanOrEqual(prefixLength + 60);
  });

  it('should use zero-padded 3-digit index', () => {
    expect(slugifyUnitName('Foundation', 1)).toBe('u-001-foundation');
    expect(slugifyUnitName('API Gateway', 2)).toBe('u-002-api-gateway');
    expect(slugifyUnitName('Tenth Unit', 10)).toBe('u-010-tenth-unit');
  });
});


describe('buildDecompositionTree', () => {
  it('should create tree with intents as roots', () => {
    const intents: HierarchicalNode[] = [
      {
        id: 'INTENT-001',
        type: 'intent',
        title: 'First Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 5,
      },
      {
        id: 'INTENT-002',
        type: 'intent',
        title: 'Second Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 3,
      },
    ];

    const tree = buildDecompositionTree(intents);

    expect(tree.roots).toEqual(intents);
    expect(tree.roots).toHaveLength(2);
  });

  it('should include all intents in nodes map', () => {
    const intents: HierarchicalNode[] = [
      {
        id: 'INTENT-001',
        type: 'intent',
        title: 'First Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 5,
      },
      {
        id: 'INTENT-002',
        type: 'intent',
        title: 'Second Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 3,
      },
    ];

    const tree = buildDecompositionTree(intents);

    expect(tree.nodes.size).toBe(2);
    expect(tree.nodes.get('INTENT-001')).toEqual(intents[0]);
    expect(tree.nodes.get('INTENT-002')).toEqual(intents[1]);
  });

  it('should return empty tree for empty input', () => {
    const tree = buildDecompositionTree([]);

    expect(tree.roots).toEqual([]);
    expect(tree.nodes.size).toBe(0);
  });

  it('should handle single intent', () => {
    const intents: HierarchicalNode[] = [
      {
        id: 'INTENT-SOLO',
        type: 'intent',
        title: 'Solo Intent',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 2,
      },
    ];

    const tree = buildDecompositionTree(intents);

    expect(tree.roots).toHaveLength(1);
    expect(tree.nodes.size).toBe(1);
    expect(tree.nodes.get('INTENT-SOLO')).toEqual(intents[0]);
  });
});

describe('getUnits', () => {
  it('should return only unit nodes from tree', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent One',
      parent_id: null,
      children_ids: ['unit-alpha'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit: HierarchicalNode = {
      id: 'unit-alpha',
      type: 'unit',
      title: 'Unit Alpha',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('unit-alpha', unit);

    const units = getUnits(tree);

    expect(units).toHaveLength(1);
    expect(units[0].id).toBe('unit-alpha');
    expect(units[0].type).toBe('unit');
  });

  it('should return empty array if no units', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent One',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);

    const units = getUnits(tree);

    expect(units).toEqual([]);
  });

  it('should return empty array for empty tree', () => {
    const tree = buildDecompositionTree([]);
    const units = getUnits(tree);
    expect(units).toEqual([]);
  });
});
