/**
 * Tests for Forge Phase: Hierarchical Decomposition
 *
 * Tests the core decomposition logic that transforms INTENTs into
 * hierarchical execution units (INTENT → UNIT → BOLT).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  parseIntentsFromDisk,
  decomposeIntentToUnits,
  decomposeUnitToBolts,
  buildDecompositionTree,
  getLeafBolts,
  getExecutableOrder,
  type UnitSpec,
  type BoltSpec,
} from '../../../features/workflow-engine/forge/decomposition.js';
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
    expect(units[0].id).toBe('UNIT-001');
    expect(units[1].id).toBe('UNIT-002');
    expect(units[2].id).toBe('UNIT-003');
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

    expect(intent.children_ids).toEqual(['UNIT-001', 'UNIT-002']);
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
      id: 'UNIT-001',
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

    expect(intent.children_ids).toEqual(['EXISTING-UNIT', 'UNIT-001']);
  });
});

describe('decomposeUnitToBolts', () => {
  it('should create BOLT nodes with correct IDs', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const boltSpecs: BoltSpec[] = [
      { title: 'Bolt One', estimated_effort: 2 },
      { title: 'Bolt Two', estimated_effort: 3 },
      { title: 'Bolt Three', estimated_effort: 2 },
      { title: 'Bolt Four', estimated_effort: 3 },
    ];

    const bolts = decomposeUnitToBolts(unit, boltSpecs);

    expect(bolts).toHaveLength(4);
    expect(bolts[0].id).toBe('BOLT-001');
    expect(bolts[1].id).toBe('BOLT-002');
    expect(bolts[2].id).toBe('BOLT-003');
    expect(bolts[3].id).toBe('BOLT-004');
  });

  it('should set parent_id to unit ID', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-042',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const boltSpecs: BoltSpec[] = [
      { title: 'Bolt Alpha', estimated_effort: 2 },
    ];

    const bolts = decomposeUnitToBolts(unit, boltSpecs);

    expect(bolts[0].parent_id).toBe('UNIT-042');
  });

  it('should update unit.children_ids', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const boltSpecs: BoltSpec[] = [
      { title: 'Bolt One', estimated_effort: 2 },
      { title: 'Bolt Two', estimated_effort: 3 },
    ];

    decomposeUnitToBolts(unit, boltSpecs);

    expect(unit.children_ids).toEqual(['BOLT-001', 'BOLT-002']);
  });

  it('should create bolts with correct properties', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const boltSpecs: BoltSpec[] = [
      { title: 'Create table migration', estimated_effort: 2 },
    ];

    const bolts = decomposeUnitToBolts(unit, boltSpecs);

    expect(bolts[0]).toMatchObject({
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Create table migration',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
    });
  });

  it('should handle empty boltSpecs array', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const bolts = decomposeUnitToBolts(unit, []);

    expect(bolts).toEqual([]);
    expect(unit.children_ids).toEqual([]);
  });

  it('should create bolts with empty children_ids (leaf nodes)', () => {
    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Test Unit',
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const boltSpecs: BoltSpec[] = [
      { title: 'Task A', estimated_effort: 1 },
      { title: 'Task B', estimated_effort: 1 },
    ];

    const bolts = decomposeUnitToBolts(unit, boltSpecs);

    expect(bolts[0].children_ids).toEqual([]);
    expect(bolts[1].children_ids).toEqual([]);
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

describe('getLeafBolts', () => {
  it('should return only bolt nodes with no children', () => {
    const bolt1: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Bolt One',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 1,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Bolt Two',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 1,
    };

    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001', 'BOLT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
    };

    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent One',
      parent_id: null,
      children_ids: ['UNIT-001'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit);
    tree.nodes.set('BOLT-001', bolt1);
    tree.nodes.set('BOLT-002', bolt2);

    const leafBolts = getLeafBolts(tree);

    expect(leafBolts).toHaveLength(2);
    expect(leafBolts.map(b => b.id)).toEqual(['BOLT-001', 'BOLT-002']);
  });

  it('should return empty array if no bolts', () => {
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

    const leafBolts = getLeafBolts(tree);

    expect(leafBolts).toEqual([]);
  });

  it('should handle tree with only intents (no decomposition)', () => {
    const intents: HierarchicalNode[] = [
      {
        id: 'INTENT-001',
        type: 'intent',
        title: 'Intent One',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 5,
      },
      {
        id: 'INTENT-002',
        type: 'intent',
        title: 'Intent Two',
        parent_id: null,
        children_ids: [],
        status: 'pending',
        assigned_agent: null,
        estimated_effort: 3,
      },
    ];

    const tree = buildDecompositionTree(intents);

    const leafBolts = getLeafBolts(tree);

    expect(leafBolts).toEqual([]);
  });

  it('should not return units, only bolts', () => {
    const bolt: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Bolt One',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 1,
    };

    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 1,
    };

    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent One',
      parent_id: null,
      children_ids: ['UNIT-001'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 1,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit);
    tree.nodes.set('BOLT-001', bolt);

    const leafBolts = getLeafBolts(tree);

    expect(leafBolts).toHaveLength(1);
    expect(leafBolts[0].type).toBe('bolt');
    expect(leafBolts[0].id).toBe('BOLT-001');
  });

  it('should handle multiple units with bolts', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: ['UNIT-001', 'UNIT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unit1: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001', 'BOLT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit2: HierarchicalNode = {
      id: 'UNIT-002',
      type: 'unit',
      title: 'Unit Two',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-003'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt1: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Bolt One',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Bolt Two',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 3,
    };

    const bolt3: HierarchicalNode = {
      id: 'BOLT-003',
      type: 'bolt',
      title: 'Bolt Three',
      parent_id: 'UNIT-002',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit1);
    tree.nodes.set('UNIT-002', unit2);
    tree.nodes.set('BOLT-001', bolt1);
    tree.nodes.set('BOLT-002', bolt2);
    tree.nodes.set('BOLT-003', bolt3);

    const leafBolts = getLeafBolts(tree);

    expect(leafBolts).toHaveLength(3);
    expect(leafBolts.map(b => b.id).sort()).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-003']);
  });
});

describe('getExecutableOrder', () => {
  it('should place non-blocked bolts before blocked ones', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: ['UNIT-001', 'UNIT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unit1: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit2: HierarchicalNode = {
      id: 'UNIT-002',
      type: 'unit',
      title: 'Unit Two',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-002'],
      status: 'blocked',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt1: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Executable Bolt',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Blocked Bolt',
      parent_id: 'UNIT-002',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit1);
    tree.nodes.set('UNIT-002', unit2);
    tree.nodes.set('BOLT-001', bolt1);
    tree.nodes.set('BOLT-002', bolt2);

    const order = getExecutableOrder(tree);

    expect(order).toHaveLength(2);
    expect(order[0].id).toBe('BOLT-001');
    expect(order[1].id).toBe('BOLT-002');
  });

  it('should sort bolts by ID within same status', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: ['UNIT-001'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unit: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-003', 'BOLT-001', 'BOLT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const bolt1: HierarchicalNode = {
      id: 'BOLT-003',
      type: 'bolt',
      title: 'Bolt Three',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 3,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Bolt One',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 3,
    };

    const bolt3: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Bolt Two',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 4,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit);
    tree.nodes.set('BOLT-001', bolt2);
    tree.nodes.set('BOLT-002', bolt3);
    tree.nodes.set('BOLT-003', bolt1);

    const order = getExecutableOrder(tree);

    expect(order.map(b => b.id)).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-003']);
  });

  it('should handle empty tree', () => {
    const tree = buildDecompositionTree([]);

    const order = getExecutableOrder(tree);

    expect(order).toEqual([]);
  });

  it('should handle tree with no bolts', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);

    const order = getExecutableOrder(tree);

    expect(order).toEqual([]);
  });

  it('should handle all bolts being blocked', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: ['UNIT-001', 'UNIT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 10,
    };

    const unit1: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001'],
      status: 'blocked',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit2: HierarchicalNode = {
      id: 'UNIT-002',
      type: 'unit',
      title: 'Unit Two',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-002'],
      status: 'blocked',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt1: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Blocked Bolt One',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Blocked Bolt Two',
      parent_id: 'UNIT-002',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit1);
    tree.nodes.set('UNIT-002', unit2);
    tree.nodes.set('BOLT-001', bolt1);
    tree.nodes.set('BOLT-002', bolt2);

    const order = getExecutableOrder(tree);

    expect(order).toHaveLength(2);
    expect(order.map(b => b.id)).toEqual(['BOLT-001', 'BOLT-002']);
  });

  it('should handle bolts without parent unit', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    // Orphan bolt with parent_id that doesn't exist in tree
    const orphanBolt: HierarchicalNode = {
      id: 'BOLT-ORPHAN',
      type: 'bolt',
      title: 'Orphan Bolt',
      parent_id: 'UNIT-MISSING',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('BOLT-ORPHAN', orphanBolt);

    const order = getExecutableOrder(tree);

    // Orphan bolt should be treated as blocked
    expect(order).toHaveLength(1);
    expect(order[0].id).toBe('BOLT-ORPHAN');
  });

  it('should maintain sort order for mixed blocked and non-blocked bolts', () => {
    const intent: HierarchicalNode = {
      id: 'INTENT-001',
      type: 'intent',
      title: 'Intent',
      parent_id: null,
      children_ids: ['UNIT-001', 'UNIT-002', 'UNIT-003'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 15,
    };

    const unit1: HierarchicalNode = {
      id: 'UNIT-001',
      type: 'unit',
      title: 'Unit One',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-003'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit2: HierarchicalNode = {
      id: 'UNIT-002',
      type: 'unit',
      title: 'Unit Two',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-001'],
      status: 'blocked',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const unit3: HierarchicalNode = {
      id: 'UNIT-003',
      type: 'unit',
      title: 'Unit Three',
      parent_id: 'INTENT-001',
      children_ids: ['BOLT-002'],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt1: HierarchicalNode = {
      id: 'BOLT-003',
      type: 'bolt',
      title: 'Bolt Three',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt2: HierarchicalNode = {
      id: 'BOLT-001',
      type: 'bolt',
      title: 'Blocked Bolt',
      parent_id: 'UNIT-002',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const bolt3: HierarchicalNode = {
      id: 'BOLT-002',
      type: 'bolt',
      title: 'Bolt Two',
      parent_id: 'UNIT-003',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 5,
    };

    const tree = buildDecompositionTree([intent]);
    tree.nodes.set('UNIT-001', unit1);
    tree.nodes.set('UNIT-002', unit2);
    tree.nodes.set('UNIT-003', unit3);
    tree.nodes.set('BOLT-001', bolt2);
    tree.nodes.set('BOLT-002', bolt3);
    tree.nodes.set('BOLT-003', bolt1);

    const order = getExecutableOrder(tree);

    expect(order).toHaveLength(3);
    // Non-blocked bolts first (sorted by ID)
    expect(order[0].id).toBe('BOLT-002');
    expect(order[1].id).toBe('BOLT-003');
    // Blocked bolt last
    expect(order[2].id).toBe('BOLT-001');
  });
});
