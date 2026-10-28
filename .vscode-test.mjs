// Integration test configuration for @vscode/test-cli (`npm test`).
// Tests are bundled by `node esbuild.mjs --tests` (the `pretest` script).
import { defineConfig } from '@vscode/test-cli';

/** @param {string} label @param {string} version */
const config = (label, version) => ({
  label,
  version,
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: 'test/fixtures/workspace',
  // Isolated user data and extensions: never depend on the developer's own setup.
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  // failZero: a run that finds no tests (e.g. tests not built) fails instead of passing.
  mocha: { ui: 'tdd', timeout: 20000, forbidOnly: true, failZero: true },
});

export default defineConfig([
  // Lowest version allowed by engines.vscode — keep in sync with package.json.
  config('minimum', '1.91.0'),
  config('stable', 'stable'),
]);
