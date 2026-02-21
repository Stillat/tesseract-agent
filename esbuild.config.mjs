import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: [resolve(__dirname, 'resources/ts/index.ts')],
  bundle: true,
  outfile: resolve(__dirname, 'dist/agent.bundle.js'),
  format: 'iife',
  globalName: 'AgentBundle',
  target: ['es2020', 'safari14'], // iOS 14+ support
  minify: !isDev,
  sourcemap: isDev ? 'inline' : false,
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  },
  banner: {
    js: `// Agent Frontend Bundle - Generated ${new Date().toISOString()}\n"use strict";`,
  },
  legalComments: 'none',
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching for changes in agent/resources/ts/...');
} else {
  const result = await esbuild.build(config);
  const stats = result.metafile ? ` (${Object.keys(result.metafile.outputs)[0]})` : '';
  console.log(`Agent bundle built${stats}`);
}
