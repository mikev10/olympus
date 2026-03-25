import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  getNextADRNumber,
  generateADR,
  detectSignificantDecisions,
  ADROptions,
} from '../../../features/workflow-engine/construction/adr-generator';

const TEST_DIR = path.join(process.cwd(), '.test-adr-generator');

describe('adr-generator', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('getNextADRNumber', () => {
    it('returns 1 when decisions dir does not exist', () => {
      const decisionsDir = path.join(TEST_DIR, 'nonexistent');
      const next = getNextADRNumber(decisionsDir);
      expect(next).toBe(1);
    });

    it('returns 1 when decisions dir is empty', () => {
      const decisionsDir = path.join(TEST_DIR, 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });
      const next = getNextADRNumber(decisionsDir);
      expect(next).toBe(1);
    });

    it('returns max+1 when ADRs exist', () => {
      const decisionsDir = path.join(TEST_DIR, 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });

      fs.writeFileSync(path.join(decisionsDir, 'ADR-001-test.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'ADR-002-another.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'ADR-005-skip.md'), 'content');

      const next = getNextADRNumber(decisionsDir);
      expect(next).toBe(6);
    });

    it('ignores non-ADR files when calculating next number', () => {
      const decisionsDir = path.join(TEST_DIR, 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });

      fs.writeFileSync(path.join(decisionsDir, 'ADR-003-valid.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'some-other-file.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'README.md'), 'content');

      const next = getNextADRNumber(decisionsDir);
      expect(next).toBe(4);
    });

    it('handles non-sequential ADR numbers correctly', () => {
      const decisionsDir = path.join(TEST_DIR, 'decisions');
      fs.mkdirSync(decisionsDir, { recursive: true });

      fs.writeFileSync(path.join(decisionsDir, 'ADR-001-first.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'ADR-010-tenth.md'), 'content');
      fs.writeFileSync(path.join(decisionsDir, 'ADR-005-fifth.md'), 'content');

      const next = getNextADRNumber(decisionsDir);
      expect(next).toBe(11);
    });
  });

  describe('generateADR', () => {
    it('creates ADR file with correct Nygard/MADR format', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Use TypeScript for type safety',
        context: 'We need a type-safe language for scalability.',
        decision: 'We will use TypeScript to enforce type checking at compile time.',
        consequences: 'All developers must learn TypeScript. Build times increase.',
      };

      const result = generateADR(options);

      expect(result.number).toBe(1);
      expect(result.title).toBe(options.title);
      expect(fs.existsSync(result.path)).toBe(true);

      const content = fs.readFileSync(result.path, 'utf-8');
      expect(content).toContain('# ADR-001: Use TypeScript for type safety');
      expect(content).toContain('**Status:** Accepted');
      expect(content).toContain(`**Unit:** unit-001`);
      expect(content).toContain('## Context');
      expect(content).toContain('We need a type-safe language for scalability.');
      expect(content).toContain('## Decision');
      expect(content).toContain('We will use TypeScript to enforce type checking at compile time.');
      expect(content).toContain('## Consequences');
      expect(content).toContain('All developers must learn TypeScript. Build times increase.');
    });

    it('creates decisions directory if missing', () => {
      const projectPath = TEST_DIR;
      const decisionsDir = path.join(projectPath, 'aidlc-docs', 'test-workflow', 'decisions');
      expect(fs.existsSync(decisionsDir)).toBe(false);

      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Test Decision',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      generateADR(options);

      expect(fs.existsSync(decisionsDir)).toBe(true);
    });

    it('generates correct ADR number (001 format)', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'First decision',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      const result = generateADR(options);

      expect(result.path).toContain('ADR-001-');
      expect(result.number).toBe(1);
    });

    it('generates correct slug from title', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Use TypeScript for Type Safety',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      const result = generateADR(options);

      expect(result.path).toContain('use-typescript-for-type-safety');
    });

    it('handles slug generation with special characters', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Use REST API (v2.0) & GraphQL!!!',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      const result = generateADR(options);

      expect(result.path).toContain('use-rest-api-v2-0-graphql');
    });

    it('includes ISO date in generated ADR', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Test',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      const result = generateADR(options);
      const content = fs.readFileSync(result.path, 'utf-8');

      const dateMatch = content.match(/\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/);
      expect(dateMatch).toBeTruthy();
      expect(dateMatch?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('sequential numbering: generating 3 ADRs produces ADR-001, ADR-002, ADR-003', () => {
      const projectPath = TEST_DIR;

      const result1 = generateADR({
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'First Decision',
        context: 'Context 1',
        decision: 'Decision 1',
        consequences: 'Consequences 1',
      });

      const result2 = generateADR({
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Second Decision',
        context: 'Context 2',
        decision: 'Decision 2',
        consequences: 'Consequences 2',
      });

      const result3 = generateADR({
        workflowId: 'test-workflow',
        unitId: 'unit-001',
        projectPath,
        title: 'Third Decision',
        context: 'Context 3',
        decision: 'Decision 3',
        consequences: 'Consequences 3',
      });

      expect(result1.number).toBe(1);
      expect(result2.number).toBe(2);
      expect(result3.number).toBe(3);

      expect(result1.path).toContain('ADR-001-');
      expect(result2.path).toContain('ADR-002-');
      expect(result3.path).toContain('ADR-003-');
    });

    it('correctly stores ADR in workflow-specific directory', () => {
      const projectPath = TEST_DIR;
      const options: ADROptions = {
        workflowId: 'group-1a-test-infrastructure',
        unitId: 'unit-backend',
        projectPath,
        title: 'Test Decision',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      };

      const result = generateADR(options);

      expect(result.path).toContain('aidlc-docs');
      expect(result.path).toContain('group-1a-test-infrastructure');
      expect(result.path).toContain('decisions');
    });
  });

  describe('detectSignificantDecisions', () => {
    it('returns empty array for file with no significant decisions', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'simple.ts');

      fs.writeFileSync(
        testFile,
        `
export function add(a: number, b: number): number {
  return a + b;
}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);
      expect(decisions).toEqual([]);
    });

    it('detects new imports/dependencies (best-effort heuristic)', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'app.ts');

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          express: '^4.0.0',
        },
      };
      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify(pkgJson, null, 2));

      fs.writeFileSync(
        testFile,
        `
import express from 'express';
import axios from 'axios';
import { setupLogging } from './logging';

export function createApp() {
  return express();
}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const depDecision = decisions.find((d) => d.title.includes('axios'));
      expect(depDecision).toBeDefined();
      expect(depDecision?.title).toBe('Added dependency: axios');
      expect(depDecision?.context).toContain('axios');
      expect(depDecision?.decision).toContain('axios');
      expect(depDecision?.consequences).toContain('bundle size');
    });

    it('ignores @types/ scoped packages when detecting dependencies', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'types.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(
        testFile,
        `
import axios from 'axios';
import type { Request } from '@types/express/index';

export interface AppConfig {}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      expect(decisions.find((d) => d.title.includes('@types/'))).toBeUndefined();
      expect(decisions.find((d) => d.title.includes('axios'))).toBeDefined();
    });

    it('detects new data models with schema-like names', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'models.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(
        testFile,
        `
export interface UserSchema {
  id: string;
  email: string;
}

export type OrderModel = {
  id: string;
  amount: number;
};

export interface ProductEntity {
  id: string;
  name: string;
}

export interface PlainInterface {
  value: string;
}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const modelDecisions = decisions.filter((d) => d.title.includes('New data model'));
      expect(modelDecisions).toHaveLength(3);

      expect(modelDecisions.map((d) => d.title)).toEqual([
        'New data model: UserSchema',
        'New data model: OrderModel',
        'New data model: ProductEntity',
      ]);

      expect(modelDecisions[0]?.context).toContain('UserSchema');
    });

    it('detects API route changes', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'routes.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(
        testFile,
        `
const app = express();

app.get('/users', (req, res) => {
  res.json([]);
});

app.post('/users', (req, res) => {
  res.json({});
});

router.put('/users/:id', (req, res) => {
  res.json({});
});
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const routeDecisions = decisions.filter((d) => d.title.includes('API contract change'));
      expect(routeDecisions).toHaveLength(3);

      const titles = routeDecisions.map((d) => d.title);
      expect(titles).toContain('API contract change: GET /users');
      expect(titles).toContain('API contract change: POST /users');
      expect(titles).toContain('API contract change: PUT /users/:id');
    });

    it('detects new modules via index.ts files', () => {
      const projectPath = TEST_DIR;
      const moduleDir = path.join(TEST_DIR, 'src', 'auth');
      fs.mkdirSync(moduleDir, { recursive: true });

      const indexFile = path.join(moduleDir, 'index.ts');
      fs.writeFileSync(
        indexFile,
        `
export * from './login';
export * from './logout';
      `
      );

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      const decisions = detectSignificantDecisions([indexFile], projectPath);

      const moduleDecision = decisions.find((d) => d.title.includes('New module'));
      expect(moduleDecision).toBeDefined();
      expect(moduleDecision?.title).toBe('New module: auth');
      expect(moduleDecision?.context).toContain('auth');
      expect(moduleDecision?.decision).toContain('dedicated module');
    });

    it('does not detect modules for root index.ts or src/index.ts', () => {
      const projectPath = TEST_DIR;
      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      const srcDir = path.join(projectPath, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const srcIndex = path.join(srcDir, 'index.ts');
      fs.writeFileSync(srcIndex, `export * from './auth';`);

      const decisions = detectSignificantDecisions([srcIndex], projectPath);

      const moduleDecision = decisions.find((d) => d.title.includes('New module: src'));
      expect(moduleDecision).toBeUndefined();
    });

    it('skips files that do not exist gracefully', () => {
      const projectPath = TEST_DIR;
      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      const decisions = detectSignificantDecisions(['/nonexistent/file.ts'], projectPath);

      expect(decisions).toEqual([]);
    });

    it('handles missing package.json gracefully', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'app.ts');

      fs.writeFileSync(
        testFile,
        `
import axios from 'axios';

export function fetchData() {}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const depDecision = decisions.find((d) => d.title.includes('axios'));
      expect(depDecision).toBeDefined();
    });

    it('handles malformed package.json gracefully', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'app.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), 'invalid json {');

      fs.writeFileSync(
        testFile,
        `
import axios from 'axios';

export function fetchData() {}
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const depDecision = decisions.find((d) => d.title.includes('axios'));
      expect(depDecision).toBeDefined();
    });

    it('does not duplicate decisions for same dependency across multiple files', () => {
      const projectPath = TEST_DIR;
      const testFile1 = path.join(TEST_DIR, 'app1.ts');
      const testFile2 = path.join(TEST_DIR, 'app2.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(testFile1, `import axios from 'axios';`);
      fs.writeFileSync(testFile2, `import axios from 'axios';`);

      const decisions = detectSignificantDecisions([testFile1, testFile2], projectPath);

      const axiosDecisions = decisions.filter((d) => d.title.includes('axios'));
      expect(axiosDecisions).toHaveLength(1);
    });

    it('detects decisions from multiple files in sequence', () => {
      const projectPath = TEST_DIR;
      const modelsFile = path.join(TEST_DIR, 'models.ts');
      const routesFile = path.join(TEST_DIR, 'routes.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(
        modelsFile,
        `
export interface UserModel {
  id: string;
}
      `
      );

      fs.writeFileSync(
        routesFile,
        `
app.get('/users', () => {});
      `
      );

      const decisions = detectSignificantDecisions([modelsFile, routesFile], projectPath);

      expect(decisions.some((d) => d.title.includes('UserModel'))).toBe(true);
      expect(decisions.some((d) => d.title.includes('GET /users'))).toBe(true);
    });

    it('handles files with multiple route methods correctly', () => {
      const projectPath = TEST_DIR;
      const testFile = path.join(TEST_DIR, 'routes.ts');

      fs.writeFileSync(path.join(projectPath, 'package.json'), JSON.stringify({}, null, 2));

      fs.writeFileSync(
        testFile,
        `
app.get('/api/items', () => {});
app.post('/api/items', () => {});
app.patch('/api/items/:id', () => {});
app.delete('/api/items/:id', () => {});
      `
      );

      const decisions = detectSignificantDecisions([testFile], projectPath);

      const routeDecisions = decisions.filter((d) => d.title.includes('API contract change'));
      expect(routeDecisions).toHaveLength(4);

      const methods = routeDecisions.map((d) => d.title);
      expect(methods).toContain('API contract change: GET /api/items');
      expect(methods).toContain('API contract change: POST /api/items');
      expect(methods).toContain('API contract change: PATCH /api/items/:id');
      expect(methods).toContain('API contract change: DELETE /api/items/:id');
    });
  });
});
