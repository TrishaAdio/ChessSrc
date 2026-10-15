import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { soundBus } from '@/lib/audio/soundBus';

interface SettingsState {
  soundEnabled: boolean;
  volume: number;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  premovesEnabled: boolean;
  setSoundEnabled(v: boolean): void;
  setVolume(v: number): void;
  toggle(key: 'showCoordinates' | 'showLegalMoves' | 'premovesEnabled'): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      soundEnabled: true,
      volume: 0.7,
      showCoordinates: true,
      showLegalMoves: true,
      premovesEnabled: true,
      setSoundEnabled(soundEnabled) {
        soundBus.setEnabled(soundEnabled);
        set({ soundEnabled });
      },
      setVolume(volume) {
        soundBus.setVolume(volume);
        set({ volume });
      },
      toggle(key) {
        set({ [key]: !get()[key] } as Pick<SettingsState, typeof key>);
      },
    }),
    {
      name: 'crystalchess.settings',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        soundBus.setEnabled(state.soundEnabled);
        soundBus.setVolume(state.volume);
      },
    },
  ),
);
