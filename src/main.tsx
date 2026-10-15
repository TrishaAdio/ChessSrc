import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { nativeWindow } from '@/lib/platform/window';
import '@/styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// DEV: expose the store for console debugging and automated smoke tests.
if (import.meta.env.DEV) {
  void Promise.all([import('@/store/gameStore'), import('chess.js')]).then(([{ useGameStore }, { Chess }]) => {
    Object.assign(window, { __cc: useGameStore, __ccChess: Chess });
  });
}

// The native window starts hidden; reveal it once the first frame is painted.
requestAnimationFrame(() => requestAnimationFrame(() => void nativeWindow.reveal()));
