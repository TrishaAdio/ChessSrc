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
  void import('@/store/gameStore').then(({ useGameStore }) => {
    (window as unknown as { __cc: typeof useGameStore }).__cc = useGameStore;
  });
}

// The native window starts hidden; reveal it once the first frame is painted.
requestAnimationFrame(() => requestAnimationFrame(() => void nativeWindow.reveal()));
