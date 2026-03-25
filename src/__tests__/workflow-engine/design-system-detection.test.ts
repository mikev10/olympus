import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { detectDesignSystems } from '../../features/workflow-engine/design-system-detection.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), '.test-design-system-'));
});

afterEach(async () => {
  await fs.remove(tmpDir);
});

describe('detectDesignSystems', () => {
  it('detects tailwindcss from package.json dependencies', async () => {
    const packageJson = {
      dependencies: {
        'tailwindcss': '^3.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    expect(result.systems.length).toBeGreaterThan(0);
    const tailwind = result.systems.find(s => s.name === 'Tailwind CSS');
    expect(tailwind).toBeDefined();
    expect(tailwind?.type).toBe('css-framework');
  });

  it('detects MUI from package.json dependencies', async () => {
    const packageJson = {
      dependencies: {
        '@mui/material': '^5.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const mui = result.systems.find(s => s.name === 'Material-UI (MUI)');
    expect(mui).toBeDefined();
    expect(mui?.type).toBe('component-library');
  });

  it('detects tailwind.config.ts config file', async () => {
    const packageJson = {
      dependencies: {
        'tailwindcss': '^3.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));
    await fs.writeFile(path.join(tmpDir, 'tailwind.config.ts'), '// config');

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const tailwindConfig = result.systems.find(s => s.path === 'tailwind.config.ts');
    expect(tailwindConfig).toBeDefined();
    expect(tailwindConfig?.type).toBe('css-framework');
  });

  it('returns graceful no-op when no frontend dependencies', async () => {
    const packageJson = {
      dependencies: {
        'express': '^4.0.0',
        'dotenv': '^16.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(false);
    expect(result.systems).toEqual([]);
  });

  it('returns graceful no-op when package.json does not exist', async () => {
    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(false);
    expect(result.systems).toEqual([]);
  });

  it('returns graceful no-op for CLI project like Olympus (no frontend deps)', async () => {
    const packageJson = {
      name: 'olympus-ai',
      dependencies: {
        'fs-extra': '^11.0.0',
        'typescript': '^5.0.0',
      },
      devDependencies: {
        'vitest': '^0.34.0',
        'eslint': '^8.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(false);
    expect(result.systems).toEqual([]);
  });

  it('detects Chakra UI from package.json', async () => {
    const packageJson = {
      dependencies: {
        '@chakra-ui/react': '^2.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const chakra = result.systems.find(s => s.name === 'Chakra UI');
    expect(chakra).toBeDefined();
    expect(chakra?.type).toBe('component-library');
  });

  it('detects multiple design systems', async () => {
    const packageJson = {
      dependencies: {
        'tailwindcss': '^3.0.0',
        '@mui/material': '^5.0.0',
        'styled-components': '^5.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    expect(result.systems.length).toBeGreaterThanOrEqual(3);
  });

  it('detects design tokens file', async () => {
    const packageJson = {
      dependencies: {
        'some-lib': '^1.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));
    await fs.writeFile(path.join(tmpDir, 'tokens.json'), JSON.stringify({}));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const tokens = result.systems.find(s => s.path === 'tokens.json');
    expect(tokens).toBeDefined();
    expect(tokens?.type).toBe('token-file');
  });

  it('detects theme.ts config file', async () => {
    const packageJson = {
      dependencies: {
        'some-lib': '^1.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));
    await fs.writeFile(path.join(tmpDir, 'theme.ts'), '// theme');

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const theme = result.systems.find(s => s.path === 'theme.ts');
    expect(theme).toBeDefined();
    expect(theme?.type).toBe('theme-config');
  });

  it('detects Radix UI with prefix matching', async () => {
    const packageJson = {
      dependencies: {
        '@radix-ui/react-button': '^1.0.0',
        '@radix-ui/react-dialog': '^1.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const radix = result.systems.find(s => s.name === 'Radix UI');
    expect(radix).toBeDefined();
    expect(radix?.type).toBe('component-library');
  });

  it('handles invalid JSON in package.json gracefully', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), 'not valid json {');

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(false);
    expect(result.systems).toEqual([]);
  });

  it('detects Bootstrap CSS framework', async () => {
    const packageJson = {
      dependencies: {
        'bootstrap': '^5.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const bootstrap = result.systems.find(s => s.name === 'Bootstrap');
    expect(bootstrap).toBeDefined();
    expect(bootstrap?.type).toBe('css-framework');
  });

  it('handles empty dependencies object', async () => {
    const packageJson = {
      dependencies: {},
      devDependencies: {},
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(false);
    expect(result.systems).toEqual([]);
  });

  it('detects Mantine component library', async () => {
    const packageJson = {
      dependencies: {
        '@mantine/core': '^6.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const mantine = result.systems.find(s => s.name === 'Mantine');
    expect(mantine).toBeDefined();
    expect(mantine?.type).toBe('component-library');
  });

  it('detects Ant Design component library', async () => {
    const packageJson = {
      dependencies: {
        'antd': '^5.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const antd = result.systems.find(s => s.name === 'Ant Design');
    expect(antd).toBeDefined();
    expect(antd?.type).toBe('component-library');
  });

  it('detects Emotion CSS-in-JS framework', async () => {
    const packageJson = {
      dependencies: {
        '@emotion/react': '^11.0.0',
      },
    };
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(packageJson));

    const result = await detectDesignSystems(tmpDir);

    expect(result.detected).toBe(true);
    const emotion = result.systems.find(s => s.name === 'Emotion');
    expect(emotion).toBeDefined();
    expect(emotion?.type).toBe('css-framework');
  });
});
