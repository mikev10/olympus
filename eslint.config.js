// ESLint for the whole workspace. Every package's `lint` script runs `eslint .`
// from its own directory and resolves to this file, so one configuration
// governs every file whether linted per package or from the root.
//
// I7 depends on three typed rules staying active on every TypeScript file:
// restrict-plus-operands, restrict-template-expressions, and
// no-base-to-string close the paths by which UntrustedText could reach a
// string without a cast. The conformance registry asserts, per file, that the
// resolved configuration keeps them at 'error' and that they fire on a
// fixture; turning one off here fails CI.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // Compile-error fixtures fail to typecheck by design; the fixture
      // compiler is the only thing that reads them.
      'packages/conformance/fixtures/types/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      // A disable comment that no longer suppresses anything is an error, so
      // a lint fixture whose rule stopped firing is caught twice over.
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // I7: untrusted text must not be coerced into a string by concatenation,
      // interpolation, or String(). Every option that would exempt a type is
      // off, so an object-typed operand always reports.
      '@typescript-eslint/restrict-plus-operands': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNullish: false,
          allowNumberAndString: false,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowArray: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: false,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/no-base-to-string': 'error',
      // Conventions: no `any`, no non-null assertion without a named invariant.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // The contracts write `Array<{ ... }>` for object element types and
      // `T[]` otherwise; array-simple is exactly that convention.
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      // The contracts use `type` for branded and opaque shapes (UntrustedText,
      // the branded ids) and `interface` for records. Both are deliberate.
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
