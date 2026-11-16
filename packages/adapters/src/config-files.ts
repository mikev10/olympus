/**
 * Files that change how a Node.js or Python project installs, compiles, lints, tests,
 * or measures coverage, wherever they sit in the tree. A change to one
 * changes what every check means without changing a line of product or test
 * code, which is why `ManifestAdapter` reports them.
 *
 * Matched by name, at any depth, with dotfiles included. Files a config
 * names by path — setup files, custom transformers, test environments — are
 * code that runs inside the test process and are not listed here: which of
 * those an agent may touch is the policy's protected-path list, not this one.
 */
import picomatch from 'picomatch';

export const CONFIG_FILE_GLOBS: readonly string[] = [
  // Dependencies and the package manager.
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpmfile.cjs',
  'yarn.lock', '.yarnrc', '.yarnrc.yml', 'bun.lock', 'bun.lockb', '.npmrc', '.nvmrc', '.node-version',
  // Compilation.
  'tsconfig.json', 'tsconfig.*.json', 'jsconfig.json', 'babel.config.*', '.babelrc', '.babelrc.*', '.swcrc',
  // Test runners and coverage.
  'vitest.config.*', 'vite.config.*', 'vitest.workspace.*', 'vitest.projects.*', 'jest.config.*',
  '.c8rc', '.c8rc.json', '.nycrc', '.nycrc.*', 'nyc.config.*',
  // Lint and format.
  'eslint.config.*', '.eslintrc', '.eslintrc.*', '.eslintignore', '.prettierrc', '.prettierrc.*', 'prettier.config.*', '.prettierignore',
  // Python: dependencies, packaging, pytest and coverage, and the files an interpreter loads at start (D-R29-08).
  'pyproject.toml', 'setup.cfg', 'setup.py', 'tox.ini', 'pytest.ini', '.pytest.ini', 'pytest.toml', '.pytest.toml', 'conftest.py',
  '.coveragerc', 'uv.lock', 'uv.toml', 'requirements*.txt', 'constraints*.txt', 'poetry.lock', 'Pipfile', 'Pipfile.lock', 'pdm.lock',
  '.python-version', 'sitecustomize.py', 'usercustomize.py', '*.pth',
  // What the diff and the environment contain.
  '.gitignore', '.gitattributes', '.env', '.env.*',
].map((name) => `**/${name}`);

const matcher = picomatch([...CONFIG_FILE_GLOBS], { dot: true });

/** Whether a path, relative to a tree root with POSIX separators, is a config file. */
export function isConfigFile(relativePath: string): boolean {
  return matcher(relativePath);
}
