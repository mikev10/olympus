import { describe, it, expect } from 'vitest';
import { detectFrontendUiUx, detectGitMaster, detectAscent, detectSkills } from '../features/magic-keywords.js';

describe('Skill Auto-Detection', () => {
  describe('detectFrontendUiUx', () => {
    it('should detect frontend work with component + styling', () => {
      expect(detectFrontendUiUx('Create a button component with custom styling')).toBe(true);
    });

    it('should detect UI work with multiple element keywords', () => {
      expect(detectFrontendUiUx('Build a modal dialog with a form input')).toBe(true);
    });

    it('should detect design work with ui + responsive', () => {
      expect(detectFrontendUiUx('Make the ui responsive for mobile devices')).toBe(true);
    });

    it('should NOT detect with single keyword', () => {
      expect(detectFrontendUiUx('Update the button')).toBe(false);
    });

    it('should NOT detect with negative signals (api)', () => {
      expect(detectFrontendUiUx('Create a button component that calls the api')).toBe(false);
    });

    it('should NOT detect with negative signals (backend)', () => {
      expect(detectFrontendUiUx('Design a form that sends data to the backend')).toBe(false);
    });

    it('should NOT detect with negative signals (database)', () => {
      expect(detectFrontendUiUx('Create a modal to display database records')).toBe(false);
    });

    it('should NOT detect with negative signals (server)', () => {
      expect(detectFrontendUiUx('Build a component that connects to the server')).toBe(false);
    });

    it('should NOT detect with negative signals (endpoint)', () => {
      expect(detectFrontendUiUx('Create UI that calls an endpoint')).toBe(false);
    });

    it('should NOT detect with negative signals (query)', () => {
      expect(detectFrontendUiUx('Design a form with database query logic')).toBe(false);
    });

    it('should NOT detect with negative signals (migration)', () => {
      expect(detectFrontendUiUx('Update the UI and run database migration')).toBe(false);
    });

    it('should detect with Tailwind + layout', () => {
      expect(detectFrontendUiUx('Style the layout using Tailwind CSS')).toBe(true);
    });

    it('should detect with navbar + menu', () => {
      expect(detectFrontendUiUx('Create a navbar with dropdown menu')).toBe(true);
    });

    it('should detect with animate + theme', () => {
      expect(detectFrontendUiUx('Add animate effects and apply the theme')).toBe(true);
    });

    it('should detect with card + design', () => {
      expect(detectFrontendUiUx('Design a card component for the dashboard')).toBe(true);
    });

    it('should ignore keywords in code blocks', () => {
      expect(detectFrontendUiUx('Update the file:\n```js\nconst button = "component";\nconst ui = "design";\n```')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(detectFrontendUiUx('Create a BUTTON COMPONENT with custom STYLING')).toBe(true);
    });
  });

  describe('detectGitMaster', () => {
    it('should detect refactor keyword', () => {
      expect(detectGitMaster('Refactor the authentication module')).toBe(true);
    });

    it('should detect rename keyword', () => {
      expect(detectGitMaster('Rename the utils folder to helpers')).toBe(true);
    });

    it('should detect reorganize keyword', () => {
      expect(detectGitMaster('Reorganize the project structure')).toBe(true);
    });

    it('should detect migrate keyword', () => {
      expect(detectGitMaster('Migrate to TypeScript')).toBe(true);
    });

    it('should detect restructure keyword', () => {
      expect(detectGitMaster('Restructure the codebase for better organization')).toBe(true);
    });

    it('should detect "move files" phrase', () => {
      expect(detectGitMaster('Move files from src to lib')).toBe(true);
    });

    it('should detect "move file" singular', () => {
      expect(detectGitMaster('Move file to new location')).toBe(true);
    });

    it('should NOT detect unrelated keywords', () => {
      expect(detectGitMaster('Create a new feature')).toBe(false);
    });

    it('should NOT detect keywords in code blocks', () => {
      expect(detectGitMaster('Update code:\n```js\nfunction refactor() {}\n```')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(detectGitMaster('REFACTOR the module')).toBe(true);
    });
  });

  describe('detectAscent', () => {
    it('should detect "must complete"', () => {
      expect(detectAscent('You must complete this task')).toBe(true);
    });

    it('should detect "don\'t stop"', () => {
      expect(detectAscent('Don\'t stop until it works')).toBe(true);
    });

    it('should detect "dont stop" (no apostrophe)', () => {
      expect(detectAscent('Dont stop working on this')).toBe(true);
    });

    it('should detect "finish this"', () => {
      expect(detectAscent('Please finish this task')).toBe(true);
    });

    it('should detect "finish it"', () => {
      expect(detectAscent('Finish it completely')).toBe(true);
    });

    it('should detect "finish everything"', () => {
      expect(detectAscent('Finish everything on the list')).toBe(true);
    });

    it('should detect "complete all"', () => {
      expect(detectAscent('Complete all the tasks')).toBe(true);
    });

    it('should detect "complete everything"', () => {
      expect(detectAscent('Complete everything before stopping')).toBe(true);
    });

    it('should detect "until done"', () => {
      expect(detectAscent('Keep working until done')).toBe(true);
    });

    it('should detect "until complete"', () => {
      expect(detectAscent('Continue until complete')).toBe(true);
    });

    it('should detect "until finished"', () => {
      expect(detectAscent('Work until finished')).toBe(true);
    });

    it('should detect "keep going"', () => {
      expect(detectAscent('Keep going until it\'s done')).toBe(true);
    });

    it('should detect "don\'t give up"', () => {
      expect(detectAscent('Don\'t give up on this')).toBe(true);
    });

    it('should detect "dont give up" (no apostrophe)', () => {
      expect(detectAscent('Dont give up')).toBe(true);
    });

    it('should NOT detect "try" (negative pattern)', () => {
      expect(detectAscent('Try to implement this feature')).toBe(false);
    });

    it('should NOT detect "attempt" (negative pattern)', () => {
      expect(detectAscent('Attempt to fix the bug')).toBe(false);
    });

    it('should NOT detect "explore" (negative pattern)', () => {
      expect(detectAscent('Explore the codebase')).toBe(false);
    });

    it('should NOT detect "investigate" (negative pattern)', () => {
      expect(detectAscent('Investigate the issue')).toBe(false);
    });

    it('should NOT detect "check if" (negative pattern)', () => {
      expect(detectAscent('Check if this works')).toBe(false);
    });

    it('should NOT detect "see if" (negative pattern)', () => {
      expect(detectAscent('See if you can fix it')).toBe(false);
    });

    it('should NOT detect unrelated text', () => {
      expect(detectAscent('Create a new feature')).toBe(false);
    });

    it('should NOT detect keywords in code blocks', () => {
      expect(detectAscent('Code:\n```js\nconst msg = "must complete";\n```')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(detectAscent('MUST COMPLETE this task')).toBe(true);
    });
  });

  describe('detectSkills', () => {
    it('should detect multiple skills at once', () => {
      const skills = detectSkills('Refactor the button component with new styling and don\'t stop until done');
      expect(skills).toContain('frontend-ui-ux');
      expect(skills).toContain('git-master');
      expect(skills).toContain('ascent');
      expect(skills).toHaveLength(3);
    });

    it('should detect only frontend-ui-ux', () => {
      const skills = detectSkills('Create a modal dialog with form inputs');
      expect(skills).toEqual(['frontend-ui-ux']);
    });

    it('should detect only git-master', () => {
      const skills = detectSkills('Reorganize the folder structure');
      expect(skills).toEqual(['git-master']);
    });

    it('should detect only ascent', () => {
      const skills = detectSkills('Complete all tasks until finished');
      expect(skills).toEqual(['ascent']);
    });

    it('should detect no skills for generic request', () => {
      const skills = detectSkills('Add a new function to utils.ts');
      expect(skills).toEqual([]);
    });

    it('should detect frontend-ui-ux + ascent', () => {
      const skills = detectSkills('Design a beautiful navbar and keep going until perfect');
      expect(skills).toContain('frontend-ui-ux');
      expect(skills).toContain('ascent');
      expect(skills).toHaveLength(2);
    });

    it('should detect git-master + ascent', () => {
      const skills = detectSkills('Refactor the entire codebase and must complete it');
      expect(skills).toContain('git-master');
      expect(skills).toContain('ascent');
      expect(skills).toHaveLength(2);
    });

    it('should respect negative signals (no frontend when backend present)', () => {
      const skills = detectSkills('Create a button component that calls the api endpoint and refactor the code');
      // Should detect git-master but NOT frontend-ui-ux (due to api/endpoint)
      expect(skills).not.toContain('frontend-ui-ux');
      expect(skills).toContain('git-master');
    });

    it('should respect negative patterns for ascent', () => {
      const skills = detectSkills('Try to refactor the code and finish this');
      // Should detect git-master, but NOT ascent (due to "try")
      expect(skills).toContain('git-master');
      expect(skills).not.toContain('ascent');
    });

    it('should return empty array for ambiguous text', () => {
      const skills = detectSkills('Update the file');
      expect(skills).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(detectFrontendUiUx('')).toBe(false);
      expect(detectGitMaster('')).toBe(false);
      expect(detectAscent('')).toBe(false);
      expect(detectSkills('')).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
      expect(detectFrontendUiUx('   \n\t  ')).toBe(false);
      expect(detectGitMaster('   \n\t  ')).toBe(false);
      expect(detectAscent('   \n\t  ')).toBe(false);
      expect(detectSkills('   \n\t  ')).toEqual([]);
    });

    it('should handle strings with only code blocks', () => {
      const codeOnly = '```js\nconst button = "component";\nconst ui = "design";\n```';
      expect(detectFrontendUiUx(codeOnly)).toBe(false);
      expect(detectGitMaster(codeOnly)).toBe(false);
      expect(detectAscent(codeOnly)).toBe(false);
      expect(detectSkills(codeOnly)).toEqual([]);
    });

    it('should handle multiple code blocks with text', () => {
      const mixed = 'Create a button ```code here``` and modal ```more code``` with styling';
      expect(detectFrontendUiUx(mixed)).toBe(true);
    });

    it('should handle partial word matches correctly ("trying" does not match "try")', () => {
      // "trying" contains "try" but word boundaries prevent false match
      // "finish this" IS a positive signal, and "trying" doesn't negate it
      // This correctly detects ascent because "finish this" is present
      expect(detectAscent('Finish this by trying harder')).toBe(true);
    });

    it('should reject when "try" appears as complete word', () => {
      // "try" as a complete word should prevent ascent detection
      expect(detectAscent('Try to finish this')).toBe(false);
    });

    it('should handle contractions with and without apostrophes', () => {
      expect(detectAscent('Don\'t stop')).toBe(true);
      expect(detectAscent('Dont stop')).toBe(true);
      expect(detectAscent('Don\'t give up')).toBe(true);
      expect(detectAscent('Dont give up')).toBe(true);
    });
  });
});
