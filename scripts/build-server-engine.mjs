#!/usr/bin/env node
// Bundles the variant rule engine for the Node server, so the server and the
// client validate moves with byte-identical rules (no second implementation).
// Output: server/vendor/variant-engine.mjs
import { build } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'scripts', '.server-engine-entry.ts');
const outDir = join(root, 'server', 'vendor');

mkdirSync(dirname(entry), { recursive: true });
writeFileSync(
  entry,
  `export { createEngine, replayEngine } from '@/variants/engine';
export { VariantBoard } from '@/variants/board';
export { chess960Setup, randomChess960Id, CHESS960_POSITIONS } from '@/variants/chess960';
export { VARIANTS } from '@/variants/types';
`,
);

await build({
  root,
  configFile: false,
  logLevel: 'error',
  resolve: { alias: { '@': join(root, 'src') } },
  build: {
    ssr: entry,
    outDir,
    emptyOutDir: false,
    minify: false,
    target: 'node22',
    rollupOptions: { external: ['chess.js'], output: { entryFileNames: 'variant-engine.mjs' } },
  },
});
console.log(`Bundled variant engine → ${join(outDir, 'variant-engine.mjs')}`);
