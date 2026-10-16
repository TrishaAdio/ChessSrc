#!/usr/bin/env node
// Bundles a TypeScript entry with Vite (honouring the `@/` alias) and runs it in
// Node. Used for fast CLI checks of pure logic such as perft.
// Usage: node scripts/run-ts.mjs <entry.ts> [args…]
import { build } from 'vite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(process.argv[2]);
// Kept inside the project so Node can resolve externals from node_modules.
const cacheRoot = join(root, 'node_modules', '.run-ts');
mkdirSync(cacheRoot, { recursive: true });
const work = mkdtempSync(join(cacheRoot, 'b-'));

try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: { '@': join(root, 'src') } },
    build: {
      ssr: entry,
      outDir: work,
      emptyOutDir: false,
      minify: false,
      target: 'node22',
      rollupOptions: { external: ['chess.js'], output: { entryFileNames: 'bundle.mjs' } },
    },
  });
  process.argv = [process.argv[0], entry, ...process.argv.slice(3)];
  await import(pathToFileURL(join(work, 'bundle.mjs')).href);
} finally {
  rmSync(work, { recursive: true, force: true });
}
