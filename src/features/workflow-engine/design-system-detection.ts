import * as path from 'path';
import { promises as fs } from 'node:fs';

/**
 * Represents a detected design system or frontend framework.
 */
export interface DesignSystemEntry {
  name: string;
  type: 'component-library' | 'token-file' | 'theme-config' | 'css-framework';
  path: string;
  description: string;
}

/**
 * Result of design system detection.
 */
export interface DesignSystemInfo {
  detected: boolean;
  systems: DesignSystemEntry[];
}

/**
 * Known component libraries to detect in package.json dependencies.
 */
const COMPONENT_LIBRARIES: Record<string, string> = {
  '@mui/material': 'Material-UI (MUI)',
  '@chakra-ui/react': 'Chakra UI',
  '@mantine/core': 'Mantine',
  'antd': 'Ant Design',
  '@radix-ui/react-*': 'Radix UI',
  'shadcn': 'shadcn/ui',
};

/**
 * Known CSS frameworks to detect in package.json dependencies.
 */
const CSS_FRAMEWORKS: Record<string, string> = {
  'tailwindcss': 'Tailwind CSS',
  'bootstrap': 'Bootstrap',
  'styled-components': 'styled-components',
  '@emotion/react': 'Emotion',
};

/**
 * Config file patterns to detect for theme/design system configurations.
 */
const CONFIG_PATTERNS = [
  'tailwind.config.ts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'stitches.config.ts',
  'stitches.config.js',
  'theme.ts',
  'theme.js',
  'theme.config.ts',
  'theme.config.js',
  'tokens.json',
  'design-tokens.json',
  'design-tokens.ts',
  'design-tokens.js',
];

/**
 * Detects design systems and frontend frameworks in a project.
 * Returns gracefully (no error, no warning) for non-frontend projects.
 *
 * @param projectPath - Root path of the project
 * @returns DesignSystemInfo with detected systems, or { detected: false, systems: [] }
 */
export async function detectDesignSystems(
  projectPath: string
): Promise<DesignSystemInfo> {
  const systems: DesignSystemEntry[] = [];

  try {
    // Read package.json
    const packageJsonPath = path.join(projectPath, 'package.json');
    let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};

    try {
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(content);
    } catch {
      // No package.json or invalid JSON — graceful no-op
      return { detected: false, systems: [] };
    }

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    // If no dependencies, return graceful no-op
    if (Object.keys(allDeps).length === 0) {
      return { detected: false, systems: [] };
    }

    // Check for component libraries
    for (const [libName, libLabel] of Object.entries(COMPONENT_LIBRARIES)) {
      if (libName.endsWith('-*')) {
        // Handle prefix matching for packages like @radix-ui/react-*
        const prefix = libName.slice(0, -2);
        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith(prefix)) {
            systems.push({
              name: libLabel,
              type: 'component-library',
              path: `node_modules/${depName}`,
              description: `Component library: ${libLabel}`,
            });
            break; // Add once per prefix
          }
        }
      } else if (libName in allDeps) {
        systems.push({
          name: libLabel,
          type: 'component-library',
          path: `node_modules/${libName}`,
          description: `Component library: ${libLabel}`,
        });
      }
    }

    // Check for CSS frameworks
    for (const [libName, libLabel] of Object.entries(CSS_FRAMEWORKS)) {
      if (libName in allDeps) {
        systems.push({
          name: libLabel,
          type: 'css-framework',
          path: `node_modules/${libName}`,
          description: `CSS framework: ${libLabel}`,
        });
      }
    }

    // Check for config files in project root
    for (const pattern of CONFIG_PATTERNS) {
      try {
        const filePath = path.join(projectPath, pattern);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          // Determine type
          let type: DesignSystemEntry['type'] = 'theme-config';
          let description = 'Theme configuration file';

          if (pattern.includes('tokens')) {
            type = 'token-file';
            description = 'Design tokens file';
          } else if (pattern.includes('tailwind')) {
            type = 'css-framework';
            description = 'Tailwind CSS configuration';
          }

          systems.push({
            name: pattern,
            type,
            path: pattern,
            description,
          });
        }
      } catch {
        // File doesn't exist, continue
      }
    }

    // Return graceful no-op if no frontend detected
    if (systems.length === 0) {
      return { detected: false, systems: [] };
    }

    return { detected: true, systems };
  } catch {
    // Unexpected error — graceful no-op
    return { detected: false, systems: [] };
  }
}
