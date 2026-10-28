// Builds the two extension bundles (client + language server) and, with
// `--tests`, the integration tests that run inside the VS Code extension host.
//
//   node esbuild.mjs               development build (source maps, no minify)
//   node esbuild.mjs --production  release build (minified, no source maps)
//   node esbuild.mjs --watch       incremental rebuilds (VS Code problem matcher friendly)
//   node esbuild.mjs --tests       development build + out/test/integration
//
// esbuild does not type-check: run `npm run check-types` as well.
import { writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

/**
 * Prints errors in the `✘ [ERROR] message` + `file:line:column:` shape that
 * the `$esbuild-watch` problem matcher understands.
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // VS Code 1.91 runs extensions on Electron 29.4.0 / Node 20.9.0
  // (microsoft/vscode@1.91.0 package.json, releases.electronjs.org).
  target: 'node20.9',
  // `vscode` is provided by the extension host at runtime; never bundle it.
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'warning',
  plugins: watch ? [problemMatcherPlugin] : [],
};

/** @type {import('esbuild').BuildOptions[]} */
const configs = [
  // `metafile` lists every bundled input; scripts/third-party-notices.mts reads it.
  { ...common, metafile: true, entryPoints: ['src/client/extension.ts'], outfile: 'dist/client/extension.js' },
  { ...common, metafile: true, entryPoints: ['src/server/server.ts'], outfile: 'dist/server/server.js' },
];

if (tests) {
  configs.push({
    ...common,
    entryPoints: ['test/integration/**/*.test.ts'],
    outdir: 'out/test/integration',
    outbase: 'test/integration',
    // Mocha is injected by @vscode/test-cli inside the extension host.
    external: ['vscode', 'mocha'],
  });
}

async function main() {
  const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    return;
  }
  try {
    const results = await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    const errorCount = results.reduce((sum, result) => sum + result.errors.length, 0);
    if (errorCount > 0) {
      throw new Error(`esbuild reported ${errorCount} error(s); see the messages above.`);
    }
    for (const [index, result] of results.entries()) {
      const outfile = configs[index]?.outfile;
      if (result.metafile && outfile) {
        await writeFile(outfile.replace(/\.js$/, '.meta.json'), JSON.stringify(result.metafile));
      }
    }
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
