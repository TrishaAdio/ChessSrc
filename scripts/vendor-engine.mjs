#!/usr/bin/env node
// Vendors the Stockfish.js "lite" builds (multi-threaded + single-threaded) into public/engine/.
// Usage: node scripts/vendor-engine.mjs [version]   (default 19.0.1)
// The full builds (~94 MB each) are intentionally not vendored.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] ?? '19.0.1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'engine');
const work = mkdtempSync(join(tmpdir(), 'sf-'));

try {
  execFileSync('npm', ['pack', `stockfish@${version}`, '--silent'], { cwd: work, stdio: ['ignore', 'pipe', 'inherit'] });
  execFileSync('tar', ['xzf', `stockfish-${version}.tgz`], { cwd: work });
  const major = version.split('.')[0];
  mkdirSync(out, { recursive: true });
  for (const flavor of ['lite', 'lite-single']) {
    for (const ext of ['js', 'wasm']) {
      copyFileSync(join(work, 'package', 'bin', `stockfish-${major}-${flavor}.${ext}`), join(out, `stockfish-${flavor}.${ext}`));
    }
  }
  copyFileSync(join(work, 'package', 'Copying.txt'), join(out, 'COPYING.txt'));
  console.log(`Vendored Stockfish ${version} lite engines into public/engine/`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
