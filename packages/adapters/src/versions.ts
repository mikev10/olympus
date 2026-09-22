/**
 * The discovery rules of each framework major this package supports, copied
 * from that major's own published source rather than from its documentation
 * (D-P8-05). A repository whose declared range selects any other major is
 * refused: enumerating it with another major's defaults would count the
 * wrong files and say nothing.
 *
 *   vitest 4.1.11  dist/chunks/defaults.*.js     defaultInclude, defaultExclude
 *   vitest 3.2.4   dist/chunks/defaults.*.js     defaultInclude, defaultExclude
 *   vitest (both)  dist/chunks/constants.*.js    CONFIG_NAMES, CONFIG_EXTENSIONS
 *   jest 30.2.0    jest-config build/index.js    testMatch, moduleFileExtensions, JEST_CONFIG_EXT_ORDER
 *   jest 29.7.0    jest-config build/Defaults.js testMatch, moduleFileExtensions; build/constants.js
 */
import { refuse } from './refusal.js';

export type VitestMajor = 3 | 4;
export type JestMajor = 29 | 30;

export interface VitestRules {
  readonly major: VitestMajor;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

export interface JestRules {
  readonly major: JestMajor;
  readonly testMatch: readonly string[];
  readonly moduleFileExtensions: readonly string[];
  readonly configExtensions: readonly string[];
}

const VITEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];

export const VITEST: Readonly<Record<VitestMajor, VitestRules>> = {
  3: {
    major: 3,
    include: VITEST_INCLUDE,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
  },
  4: { major: 4, include: VITEST_INCLUDE, exclude: ['**/node_modules/**', '**/.git/**'] },
};

/** Both majors search these names in this order and read the first that exists. */
export const VITEST_CONFIG_FILES: readonly string[] = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((ext) => name + ext),
);

/** Files that declare several vitest projects, which this package does not enumerate. */
export const VITEST_WORKSPACE_FILES: readonly string[] = ['vitest.workspace', 'vitest.projects'].flatMap((name) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'].map((ext) => name + ext),
);

export const JEST: Readonly<Record<JestMajor, JestRules>> = {
  29: {
    major: 29,
    testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
    moduleFileExtensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'node'],
    configExtensions: ['.js', '.ts', '.mjs', '.cjs', '.json'],
  },
  30: {
    major: 30,
    testMatch: ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
    moduleFileExtensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'json', 'node'],
    configExtensions: ['.js', '.ts', '.mjs', '.cjs', '.cts', '.json'],
  },
};

/**
 * The single major a declared version range selects: `4`, `^4.1.0`, `~4.1`,
 * `4.x`, `=4.1.11`, `v4`. A range that could select more than one major —
 * `*`, `>=3`, `^3 || ^4`, a tag, a URL, a workspace protocol — is refused by
 * returning undefined, and the caller names it.
 */
export function majorOf(range: string): number | undefined {
  const match = /^\s*(?:\^|~|=)?\s*v?(\d+)(?:\.(?:\d+|x|\*)){0,2}(?:-[0-9A-Za-z.-]+)?\s*$/.exec(range);
  const major = match?.[1];
  return major === undefined ? undefined : Number(major);
}

export function vitestRules(range: string): VitestRules {
  const major = majorOf(range);
  if (major === 3 || major === 4) return VITEST[major];
  return refuse(
    'unsupported-version',
    `vitest is declared as "${range}", which does not select exactly one of the majors whose discovery rules this package encodes (3, 4)`,
  );
}

export function jestRules(range: string): JestRules {
  const major = majorOf(range);
  if (major === 29 || major === 30) return JEST[major];
  return refuse(
    'unsupported-version',
    `jest is declared as "${range}", which does not select exactly one of the majors whose discovery rules this package encodes (29, 30)`,
  );
}
