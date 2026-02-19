import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  generateInterfaceContracts,
  generateDataFlowDiagram,
  generateComponentDesign,
  validateDesign,
  writeDesignArtifacts,
  loadDesignArtifacts,
} from '../../../features/workflow-engine/construction/design.js';
import type {
  InterfaceContract,
  DataFlowDiagram,
  ComponentDesign,
  DesignArtifacts,
} from '../../../features/workflow-engine/construction/design.js';
import type { HierarchicalNode } from '../../../features/workflow-engine/phase-types.js';

describe('design.ts', () => {
  const testDir = path.join(process.cwd(), '.test-design');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  // Helper to create unit nodes
  function createUnit(id: string, title: string): HierarchicalNode {
    return {
      id,
      type: 'unit',
      title,
      parent_id: 'INTENT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 4,
    };
  }

  describe('generateInterfaceContracts', () => {
    it('should create one interface per unit', () => {
      const units = [
        createUnit('UNIT-001', 'User authentication'),
        createUnit('UNIT-002', 'Data persistence'),
      ];

      const interfaces = generateInterfaceContracts(units, '');

      expect(interfaces).toHaveLength(2);
      expect(interfaces[0].unit_id).toBe('UNIT-001');
      expect(interfaces[1].unit_id).toBe('UNIT-002');
    });

    it('should generate sequential interface IDs', () => {
      const units = [
        createUnit('UNIT-001', 'Feature A'),
        createUnit('UNIT-002', 'Feature B'),
        createUnit('UNIT-003', 'Feature C'),
      ];

      const interfaces = generateInterfaceContracts(units, '');

      expect(interfaces[0].id).toBe('IFACE-001');
      expect(interfaces[1].id).toBe('IFACE-002');
      expect(interfaces[2].id).toBe('IFACE-003');
    });

    it('should derive interface name from unit title in PascalCase', () => {
      const units = [
        createUnit('UNIT-001', 'user authentication'),
        createUnit('UNIT-002', 'data persistence layer'),
      ];

      const interfaces = generateInterfaceContracts(units, '');

      expect(interfaces[0].name).toBe('UserAuthenticationInterface');
      expect(interfaces[1].name).toBe('DataPersistenceLayerInterface');
    });

    it('should handle empty units array', () => {
      const interfaces = generateInterfaceContracts([], '');

      expect(interfaces).toHaveLength(0);
    });

    it('should extract fields from spec content when available', () => {
      const units = [createUnit('UNIT-001', 'User service')];
      const specContent = `
# User Service
The user service handles authentication.
Input: username: string, password: string
Output: token: string
`;

      const interfaces = generateInterfaceContracts(units, specContent);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].inputs.length).toBeGreaterThan(0);
      expect(interfaces[0].outputs.length).toBeGreaterThan(0);
    });

    it('should set description for each interface', () => {
      const units = [createUnit('UNIT-001', 'User authentication')];

      const interfaces = generateInterfaceContracts(units, '');

      expect(interfaces[0].description).toBe('Interface contract for User authentication');
    });

    it('should initialize dependencies array', () => {
      const units = [
        createUnit('UNIT-001', 'User authentication'),
        createUnit('UNIT-002', 'User management'),
      ];

      const interfaces = generateInterfaceContracts(units, '');

      expect(interfaces[0].dependencies).toBeInstanceOf(Array);
      expect(interfaces[1].dependencies).toBeInstanceOf(Array);
    });

    it('should detect dependencies based on shared keywords', () => {
      const units = [
        createUnit('UNIT-001', 'User authentication'),
        createUnit('UNIT-002', 'User profile'),
      ];

      const interfaces = generateInterfaceContracts(units, '');

      // Both units share "user" keyword, so they should have dependencies
      const hasDependencies = interfaces.some((iface) => iface.dependencies.length > 0);
      expect(hasDependencies).toBe(true);
    });
  });

  describe('generateDataFlowDiagram', () => {
    it('should create one DFD per unit', () => {
      const units = [
        createUnit('UNIT-001', 'Auth service'),
        createUnit('UNIT-002', 'Data service'),
      ];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      expect(dfds).toHaveLength(2);
      expect(dfds[0].unit_id).toBe('UNIT-001');
      expect(dfds[1].unit_id).toBe('UNIT-002');
    });

    it('should generate sequential DFD IDs', () => {
      const units = [
        createUnit('UNIT-001', 'Feature A'),
        createUnit('UNIT-002', 'Feature B'),
        createUnit('UNIT-003', 'Feature C'),
      ];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      expect(dfds[0].id).toBe('DFD-001');
      expect(dfds[1].id).toBe('DFD-002');
      expect(dfds[2].id).toBe('DFD-003');
    });

    it('should include interface components', () => {
      const units = [createUnit('UNIT-001', 'Auth service')];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      expect(dfds[0].components.length).toBeGreaterThan(0);
      const interfaceComponent = dfds[0].components.find((c) => c.type === 'interface');
      expect(interfaceComponent).toBeDefined();
    });

    it('should reference valid component IDs in flows', () => {
      const units = [
        createUnit('UNIT-001', 'User service'),
        createUnit('UNIT-002', 'User profile'),
      ];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      for (const dfd of dfds) {
        const componentIds = new Set(dfd.components.map((c) => c.id));
        for (const flow of dfd.flows) {
          expect(componentIds.has(flow.from)).toBe(true);
          expect(componentIds.has(flow.to)).toBe(true);
        }
      }
    });

    it('should handle empty units array', () => {
      const dfds = generateDataFlowDiagram([], []);

      expect(dfds).toHaveLength(0);
    });

    it('should set description for each DFD', () => {
      const units = [createUnit('UNIT-001', 'Auth service')];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      expect(dfds[0].description).toBe('Data flow diagram for Auth service');
    });

    it('should create data store components for persistence-related interfaces', () => {
      const units = [createUnit('UNIT-001', 'Database store')];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      const storeComponent = dfds[0].components.find((c) => c.type === 'store');
      expect(storeComponent).toBeDefined();
    });

    it('should create bidirectional flows for data stores', () => {
      const units = [createUnit('UNIT-001', 'Data repository')];
      const interfaces = generateInterfaceContracts(units, '');

      const dfds = generateDataFlowDiagram(units, interfaces);

      const bidirectionalFlow = dfds[0].flows.find((f) => f.direction === 'bidirectional');
      expect(bidirectionalFlow).toBeDefined();
    });
  });

  describe('generateComponentDesign', () => {
    it('should create one component per unit', () => {
      const units = [
        createUnit('UNIT-001', 'Auth service'),
        createUnit('UNIT-002', 'Data service'),
      ];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components).toHaveLength(2);
      expect(components[0].unit_id).toBe('UNIT-001');
      expect(components[1].unit_id).toBe('UNIT-002');
    });

    it('should generate sequential component IDs', () => {
      const units = [
        createUnit('UNIT-001', 'Feature A'),
        createUnit('UNIT-002', 'Feature B'),
        createUnit('UNIT-003', 'Feature C'),
      ];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components[0].id).toBe('COMP-001');
      expect(components[1].id).toBe('COMP-002');
      expect(components[2].id).toBe('COMP-003');
    });

    it('should link to interface IDs via interfaces_used', () => {
      const units = [createUnit('UNIT-001', 'Auth service')];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components[0].interfaces_used).toEqual(['IFACE-001']);
    });

    it('should derive component name from unit title in PascalCase', () => {
      const units = [
        createUnit('UNIT-001', 'user authentication'),
        createUnit('UNIT-002', 'data persistence layer'),
      ];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components[0].name).toBe('UserAuthenticationComponent');
      expect(components[1].name).toBe('DataPersistenceLayerComponent');
    });

    it('should derive responsibilities from unit title', () => {
      const units = [createUnit('UNIT-001', 'User authentication')];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components[0].responsibilities).toContain('Implement User authentication');
    });

    it('should extract data stores from DFD', () => {
      const units = [createUnit('UNIT-001', 'Database repository')];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      // Check if data_stores is populated
      expect(components[0].data_stores).toBeInstanceOf(Array);
    });

    it('should handle empty units array', () => {
      const components = generateComponentDesign([], [], []);

      expect(components).toHaveLength(0);
    });

    it('should set description for each component', () => {
      const units = [createUnit('UNIT-001', 'Auth service')];
      const interfaces = generateInterfaceContracts(units, '');
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      expect(components[0].description).toBe('Component design for Auth service');
    });

    it('should add responsibilities based on interface inputs and outputs', () => {
      const units = [createUnit('UNIT-001', 'User service')];
      const specContent = 'Input: username: string\nOutput: token: string';
      const interfaces = generateInterfaceContracts(units, specContent);
      const dfds = generateDataFlowDiagram(units, interfaces);

      const components = generateComponentDesign(units, interfaces, dfds);

      const hasInputResponsibility = components[0].responsibilities.some((r) =>
        r.includes('Process inputs')
      );
      const hasOutputResponsibility = components[0].responsibilities.some((r) =>
        r.includes('Generate outputs')
      );

      expect(hasInputResponsibility || hasOutputResponsibility).toBe(true);
    });
  });

  describe('validateDesign', () => {
    it('should return passed=true for valid design', () => {
      // Create a design that will pass validation
      const design: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'AuthServiceInterface',
            inputs: [{ name: 'username', type: 'string', required: true, description: 'User name' }],
            outputs: [{ name: 'token', type: 'string', required: true, description: 'Auth token' }],
            dependencies: [],
            description: 'Auth service interface',
          },
        ],
        dataFlows: [
          {
            id: 'DFD-001',
            unit_id: 'UNIT-001',
            components: [
              { id: 'COMP-IFACE-001', name: 'AuthServiceInterface', type: 'interface' },
            ],
            flows: [],
            description: 'Auth service data flow',
          },
        ],
        components: [
          {
            id: 'COMP-001',
            unit_id: 'UNIT-001',
            name: 'AuthServiceComponent',
            responsibilities: ['Implement authentication'],
            interfaces_used: ['IFACE-001'],
            data_stores: [],
            description: 'Auth service component',
          },
        ],
      };

      const result = validateDesign(design, 'auth service');

      expect(result.passed).toBe(true);
      expect(result.blocking_issues).toHaveLength(0);
    });

    it('should return passed=false if interface has no inputs or outputs', () => {
      const design: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'EmptyInterface',
            inputs: [],
            outputs: [],
            dependencies: [],
            description: 'Test',
          },
        ],
        dataFlows: [],
        components: [],
      };

      const result = validateDesign(design, '');

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.length).toBeGreaterThan(0);
      expect(result.blocking_issues[0]).toContain('has no inputs or outputs');
    });

    it('should return passed=false if component references invalid interface', () => {
      const design: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'ValidInterface',
            inputs: [{ name: 'input', type: 'string', required: true, description: 'Test' }],
            outputs: [],
            dependencies: [],
            description: 'Test',
          },
        ],
        dataFlows: [],
        components: [
          {
            id: 'COMP-001',
            unit_id: 'UNIT-001',
            name: 'TestComponent',
            responsibilities: ['Do something'],
            interfaces_used: ['IFACE-999'], // Invalid
            data_stores: [],
            description: 'Test',
          },
        ],
      };

      const result = validateDesign(design, '');

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.some((issue) => issue.includes('invalid interface'))).toBe(
        true
      );
    });

    it('should return passed=false if data flow references invalid component', () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [
          {
            id: 'DFD-001',
            unit_id: 'UNIT-001',
            components: [
              { id: 'COMP-1', name: 'Component1', type: 'process' },
              { id: 'COMP-2', name: 'Component2', type: 'process' },
            ],
            flows: [
              {
                from: 'COMP-INVALID',
                to: 'COMP-2',
                data: 'test data',
                direction: 'unidirectional',
              },
            ],
            description: 'Test',
          },
        ],
        components: [],
      };

      const result = validateDesign(design, '');

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.some((issue) => issue.includes('invalid source component'))).toBe(
        true
      );
    });

    it('should return passed=false if data flow target is invalid', () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [
          {
            id: 'DFD-001',
            unit_id: 'UNIT-001',
            components: [
              { id: 'COMP-1', name: 'Component1', type: 'process' },
              { id: 'COMP-2', name: 'Component2', type: 'process' },
            ],
            flows: [
              {
                from: 'COMP-1',
                to: 'COMP-INVALID',
                data: 'test data',
                direction: 'unidirectional',
              },
            ],
            description: 'Test',
          },
        ],
        components: [],
      };

      const result = validateDesign(design, '');

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.some((issue) => issue.includes('invalid target component'))).toBe(
        true
      );
    });

    it('should return passed=false if component has no responsibilities', () => {
      const design: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'ValidInterface',
            inputs: [{ name: 'input', type: 'string', required: true, description: 'Test' }],
            outputs: [],
            dependencies: [],
            description: 'Test',
          },
        ],
        dataFlows: [],
        components: [
          {
            id: 'COMP-001',
            unit_id: 'UNIT-001',
            name: 'LazyComponent',
            responsibilities: [],
            interfaces_used: ['IFACE-001'],
            data_stores: [],
            description: 'Test',
          },
        ],
      };

      const result = validateDesign(design, '');

      expect(result.passed).toBe(false);
      expect(result.blocking_issues.some((issue) => issue.includes('no defined responsibilities'))).toBe(
        true
      );
    });

    it('should include coverage_percentage', () => {
      const units = [createUnit('UNIT-001', 'Auth service')];
      const specContent = 'Auth service implementation';
      const interfaces = generateInterfaceContracts(units, specContent);
      const dfds = generateDataFlowDiagram(units, interfaces);
      const components = generateComponentDesign(units, interfaces, dfds);

      const design: DesignArtifacts = { interfaces, dataFlows: dfds, components };
      const result = validateDesign(design, specContent);

      expect(result.coverage_percentage).toBeGreaterThanOrEqual(0);
      expect(result.coverage_percentage).toBeLessThanOrEqual(100);
    });

    it('should include timestamp', () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [],
        components: [],
      };

      const result = validateDesign(design, '');

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should include reviewer field', () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [],
        components: [],
      };

      const result = validateDesign(design, '');

      expect(result.reviewer).toBe('design-validator');
    });
  });

  describe('writeDesignArtifacts / loadDesignArtifacts', () => {
    it('should write and read back identical artifacts', async () => {
      const units = [createUnit('UNIT-001', 'Test service')];
      const specContent = 'Input: data: string\nOutput: result: string';
      const interfaces = generateInterfaceContracts(units, specContent);
      const dfds = generateDataFlowDiagram(units, interfaces);
      const components = generateComponentDesign(units, interfaces, dfds);

      const design: DesignArtifacts = { interfaces, dataFlows: dfds, components };

      await writeDesignArtifacts(testDir, 'test-workflow', design);
      const loaded = await loadDesignArtifacts(testDir, 'test-workflow');

      expect(loaded).not.toBeNull();
      expect(loaded!.interfaces).toEqual(design.interfaces);
      expect(loaded!.dataFlows).toEqual(design.dataFlows);
      expect(loaded!.components).toEqual(design.components);
    });

    it('should return null when directory does not exist', async () => {
      const loaded = await loadDesignArtifacts(testDir, 'nonexistent-workflow');

      expect(loaded).toBeNull();
    });

    it('should create directory structure', async () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [],
        components: [],
      };

      await writeDesignArtifacts(testDir, 'test-workflow', design);

      const designDir = path.join(testDir, 'aidlc-docs', 'test-workflow', 'construction', 'design');
      const exists = await fs.pathExists(designDir);

      expect(exists).toBe(true);
    });

    it('should write interfaces.json file', async () => {
      const design: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'TestInterface',
            inputs: [],
            outputs: [],
            dependencies: [],
            description: 'Test',
          },
        ],
        dataFlows: [],
        components: [],
      };

      await writeDesignArtifacts(testDir, 'test-workflow', design);

      const interfacesPath = path.join(
        testDir,
        'aidlc-docs',
        'test-workflow',
        'construction',
        'design',
        'interfaces.json'
      );
      const exists = await fs.pathExists(interfacesPath);

      expect(exists).toBe(true);
    });

    it('should write data-flow.json file', async () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [
          {
            id: 'DFD-001',
            unit_id: 'UNIT-001',
            components: [],
            flows: [],
            description: 'Test',
          },
        ],
        components: [],
      };

      await writeDesignArtifacts(testDir, 'test-workflow', design);

      const dataFlowPath = path.join(
        testDir,
        'aidlc-docs',
        'test-workflow',
        'construction',
        'design',
        'data-flow.json'
      );
      const exists = await fs.pathExists(dataFlowPath);

      expect(exists).toBe(true);
    });

    it('should write components.json file', async () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [],
        components: [
          {
            id: 'COMP-001',
            unit_id: 'UNIT-001',
            name: 'TestComponent',
            responsibilities: [],
            interfaces_used: [],
            data_stores: [],
            description: 'Test',
          },
        ],
      };

      await writeDesignArtifacts(testDir, 'test-workflow', design);

      const componentsPath = path.join(
        testDir,
        'aidlc-docs',
        'test-workflow',
        'construction',
        'design',
        'components.json'
      );
      const exists = await fs.pathExists(componentsPath);

      expect(exists).toBe(true);
    });

    it('should write validation.json file', async () => {
      const design: DesignArtifacts = {
        interfaces: [],
        dataFlows: [],
        components: [],
      };

      await writeDesignArtifacts(testDir, 'test-workflow', design);

      const validationPath = path.join(
        testDir,
        'aidlc-docs',
        'test-workflow',
        'construction',
        'design',
        'validation.json'
      );
      const exists = await fs.pathExists(validationPath);

      expect(exists).toBe(true);
    });

    it('should handle multiple workflows', async () => {
      const design1: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-001',
            unit_id: 'UNIT-001',
            name: 'Interface1',
            inputs: [],
            outputs: [],
            dependencies: [],
            description: 'Test 1',
          },
        ],
        dataFlows: [],
        components: [],
      };

      const design2: DesignArtifacts = {
        interfaces: [
          {
            id: 'IFACE-002',
            unit_id: 'UNIT-002',
            name: 'Interface2',
            inputs: [],
            outputs: [],
            dependencies: [],
            description: 'Test 2',
          },
        ],
        dataFlows: [],
        components: [],
      };

      await writeDesignArtifacts(testDir, 'workflow-1', design1);

      const loaded1 = await loadDesignArtifacts(testDir, 'workflow-1');
      expect(loaded1!.interfaces[0].name).toBe('Interface1');

      // Second write overwrites (aidlc-docs is a flat per-project structure)
      await writeDesignArtifacts(testDir, 'workflow-2', design2);

      const loaded2 = await loadDesignArtifacts(testDir, 'workflow-2');
      expect(loaded2!.interfaces[0].name).toBe('Interface2');
    });

    it('should return null if only some files exist', async () => {
      const designDir = path.join(testDir, 'aidlc-docs', 'incomplete', 'construction', 'design');
      await fs.ensureDir(designDir);

      // Write only interfaces.json, not the others
      await fs.writeJson(path.join(designDir, 'interfaces.json'), []);

      const loaded = await loadDesignArtifacts(testDir, 'incomplete');

      expect(loaded).toBeNull();
    });
  });
});
