import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type Backdrop = 'mica' | 'acrylic' | 'blur' | 'none';

export const inTauri = (): boolean => isTauri();

export async function getBackdrop(): Promise<Backdrop> {
  if (!inTauri()) return 'none';
  try {
    return await invoke<Backdrop>('get_backdrop');
  } catch {
    return 'none';
  }
}

/** Thin wrappers over the native window so components stay platform-agnostic. */
export const nativeWindow = {
  minimize: () => (inTauri() ? getCurrentWindow().minimize() : Promise.resolve()),
  toggleMaximize: () => (inTauri() ? getCurrentWindow().toggleMaximize() : Promise.resolve()),
  close: () => (inTauri() ? getCurrentWindow().close() : Promise.resolve()),
  isMaximized: () => (inTauri() ? getCurrentWindow().isMaximized() : Promise.resolve(false)),
  /** Shows the window after the first frame to avoid a white flash (window starts hidden). */
  reveal: async () => {
    if (!inTauri()) return;
    const w = getCurrentWindow();
    await w.show();
    await w.setFocus();
  },
  onResized: async (cb: () => void): Promise<() => void> => {
    if (!inTauri()) return () => {};
    return getCurrentWindow().onResized(cb);
  },
};
