import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri exposes TAURI_ENV_* variables to the frontend build.
const host = process.env.TAURI_DEV_HOST;

// Cross-origin isolation enables SharedArrayBuffer → the multi-threaded Stockfish build.
// The same headers are set for the packaged app in tauri.conf.json (app.security.headers).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const isDebug = !!process.env.TAURI_ENV_DEBUG;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Keep Rust/Tauri errors visible in the terminal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
    headers: isolationHeaders,
  },
  preview: { headers: isolationHeaders },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // Phase 3: Stockfish runs in an ES-module Web Worker.
  worker: { format: 'es' },
  build: {
    // WebView2 on Windows 10/11 is evergreen Chromium.
    target: 'chrome120',
    minify: isDebug ? false : 'oxc',
    sourcemap: isDebug,
    chunkSizeWarningLimit: 1200,
  },
});
