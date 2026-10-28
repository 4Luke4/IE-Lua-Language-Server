// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const noVscodeImport = {
  paths: [
    {
      name: 'vscode',
      message:
        'The `vscode` module only exists in the extension host. Server, shared code, unit tests and scripts must not import it (CLAUDE.md §2).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.cache/**', '.vscode-test/**', 'third_party/lua52/dist/**'],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Shipped code: no console output (use the LogOutputChannel / connection.console).
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'test/unit/**/*.ts', 'scripts/**/*.ts', 'third_party/**/*.mts', 'scripts/**/*.mts'],
    rules: { 'no-restricted-imports': ['error', noVscodeImport] },
  },
  {
    // Mocha's `this` and chai-less assertions: allow unbound methods in tests.
    files: ['test/**/*.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
