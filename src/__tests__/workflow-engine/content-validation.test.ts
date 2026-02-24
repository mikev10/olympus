import { describe, it, expect } from 'vitest';
import {
  validateMermaidSyntax,
  validateAsciiDiagram,
  validateMarkdown,
  validateAndFallback,
  CONTENT_VALIDATION_RULES,
} from '../../features/workflow-engine/content-validation.js';

describe('content-validation', () => {
  describe('validateMermaidSyntax', () => {
    it('validates correct Mermaid syntax', () => {
      const content = '```mermaid\nflowchart TD\n  A --> B\n  B --> C\n```';
      const result = validateMermaidSyntax(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid for content without mermaid blocks', () => {
      const result = validateMermaidSyntax('Just plain text');
      expect(result.valid).toBe(true);
    });

    it('detects missing diagram type', () => {
      const content = '```mermaid\n  A --> B\n```';
      const result = validateMermaidSyntax(content);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateAsciiDiagram', () => {
    it('validates correct ASCII diagram', () => {
      const content = '+---+\n| A |\n+---+';
      const result = validateAsciiDiagram(content);
      expect(result.valid).toBe(true);
    });

    it('detects Unicode box-drawing characters', () => {
      const content = '┌───┐\n│ A │\n└───┘';
      const result = validateAsciiDiagram(content);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateMarkdown', () => {
    it('validates correct markdown', () => {
      const content = '# Header\n\n- Item 1\n- Item 2\n\n```js\nconsole.log("hi")\n```';
      const result = validateMarkdown(content);
      expect(result.valid).toBe(true);
    });

    it('reports warning for unclosed code blocks', () => {
      const content = '```js\nconsole.log("hi")';
      const result = validateMarkdown(content);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateAndFallback', () => {
    it('returns content unchanged when valid', () => {
      const content = '# Header\n\nSome text';
      expect(validateAndFallback(content)).toBe(content);
    });

    it('replaces Unicode box-drawing in ASCII diagrams', () => {
      const content = '┌───┐\n│ A │\n└───┘';
      const result = validateAndFallback(content);
      expect(result).not.toContain('┌');
      expect(result).toContain('+');
    });
  });

  describe('CONTENT_VALIDATION_RULES', () => {
    it('exports rules constant', () => {
      expect(CONTENT_VALIDATION_RULES).toContain('Mermaid');
      expect(CONTENT_VALIDATION_RULES).toContain('ASCII');
    });
  });
});
