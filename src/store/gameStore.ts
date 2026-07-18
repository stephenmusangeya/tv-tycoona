import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { advanceWeek } from '../engine/tick';
import { looksLikeSave, migrateSave } from '../engine/migrate';
import { AUTOSAVE_ID, listSaves, newSlotId, readSlot, writeSlot } from './saves';
import type { SlotInfo } from './saves';
import { newGame } from '../engine/setup';
import type { GameState, WeekResult } from '../engine/types';

/**
 * Game state binding.
 *
 * The engine mutates GameState in place — it is a large object graph and cloning it
 * every week would be wasteful. React cannot see in-place mutation, so the store
 * carries an explicit `revision` counter that every mutating action bumps. Components
 * subscribe to `revision` and read the (stable) game object, which gives correct
 * re-renders without immutable copies.
 */

const SAVE_KEY = 'tv-tycoon:save:v1';
const READ_KEY = 'tv-tycoon:inbox-read:v1';
const AUTOSAVE_EVERY_WEEKS = 4;

interface GameStore {
  game: GameState | null;
  revision: number;
  lastWeek: WeekResult | null;
  advancing: boolean;
  loading: boolean;
  /** Transient message shown to the player after a refused action. */
  notice: string | null;
  /** Newest event the player has seen in the inbox; everything after it is unread. */
  lastReadEventId: string | null;
  /**
   * Week whose results the player has already dismissed.
   *
   * Lives here rather than in the desk component: as component state it reset every
   * time the player switched tabs and came back, so the same week's overnights
   * popped up again and again.
   */
  resultsSeenWeek: number;

  bootstrap: () => Promise<void>;
  startNewGame: (studioName: string, seed?: number) => void;
  advance: (weeks?: number) => Promise<void>;
  /** Run a mutating engine action and signal React. */
  mutate: <T>(fn: (game: GameState) => T) => T | undefined;
  setNotice: (message: string | null) => void;
  markInboxRead: (newestEventId: string | null) => void;
  dismissResults: (week: number) => void;
  save: () => Promise<void>;
  clearSave: () => Promise<void>;

  // --- save slots ---
  slots: SlotInfo[];
  refreshSlots: () => Promise<void>;
  saveAs: (name: string) => Promise<void>;
  loadSlot: (id: string) => Promise<boolean>;
  quitToTitle: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  revision: 0,
  lastWeek: null,
  advancing: false,
  loading: true,
  notice: null,
  lastReadEventId: null,
  resultsSeenWeek: -1,
  slots: [],

  async bootstrap() {
    try {
      const readMarker = await AsyncStorage.getItem(READ_KEY);
      if (readMarker) set({ lastReadEventId: readMarker });

      set({ slots: await listSaves() });

      const raw = await AsyncStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (looksLikeSave(parsed)) {
          // Saves written by older builds are missing fields today's code assumes
          // exist — see engine/migrate.ts.
          migrateSave(parsed);
          set({ game: parsed, loading: false, revision: get().revision + 1 });
          return;
        }
      }
    } catch {
      // A corrupt save should never block the app — fall through to a new game.
    }
    set({ loading: false });
  },

  startNewGame(studioName: string, seed?: number) {
    const game = newGame({
      studioName,
      // Undefined seed means "surprise me" — the one place randomness is allowed to
      // leak in, because it only chooses which deterministic world to play.
      seed: seed ?? Math.floor(Math.random() * 2_000_000_000),
    });
    set({
      game,
      lastWeek: null,
      revision: get().revision + 1,
      notice: null,
      lastReadEventId: null,
    });
    void AsyncStorage.removeItem(READ_KEY);
    void get().save();
  },

  async advance(weeks = 1) {
    const { game } = get();
    if (!game || get().advancing) return;

    set({ advancing: true });

    // Yield to the runtime so the spinner paints before a multi-week run blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    let result: WeekResult | null = null;
    for (let i = 0; i < weeks; i++) {
      result = advanceWeek(game);
    }

    set({
      lastWeek: result,
      revision: get().revision + 1,
      advancing: false,
      // Skipping time deliberately fast-forwards past the weekly reveal.
      resultsSeenWeek: weeks > 1 ? game.absoluteWeek : get().resultsSeenWeek,
    });

    if (game.absoluteWeek % AUTOSAVE_EVERY_WEEKS === 0) {
      void get().save();
      void writeSlot(game, AUTOSAVE_ID, 'Autosave').then(() => get().refreshSlots());
    }
  },

  mutate<T>(fn: (game: GameState) => T): T | undefined {
    const { game } = get();
    if (!game) return undefined;
    const result = fn(game);
    set({ revision: get().revision + 1 });
    return result;
  },

  setNotice(message: string | null) {
    set({ notice: message });
  },

  dismissResults(week: number) {
    set({ resultsSeenWeek: week });
  },

  markInboxRead(newestEventId: string | null) {
    if (!newestEventId || get().lastReadEventId === newestEventId) return;
    set({ lastReadEventId: newestEventId });
    void AsyncStorage.setItem(READ_KEY, newestEventId);
  },

  async save() {
    const { game } = get();
    if (!game) return;
    try {
      await AsyncStorage.setItem(SAVE_KEY, JSON.stringify(game));
    } catch {
      // Storage failures are not worth interrupting play for; the next autosave
      // will try again.
    }
  },

  async clearSave() {
    await AsyncStorage.removeItem(SAVE_KEY);
    set({ game: null, lastWeek: null, revision: get().revision + 1 });
  },

  async refreshSlots() {
    set({ slots: await listSaves() });
  },

  async saveAs(name: string) {
    const { game } = get();
    if (!game) return;
    await writeSlot(game, newSlotId(), name.trim() || 'Untitled save');
    await get().refreshSlots();
  },

  async loadSlot(id: string) {
    const loaded = await readSlot(id);
    if (!loaded) return false;
    set({
      game: loaded,
      lastWeek: null,
      revision: get().revision + 1,
      notice: null,
    });
    void get().save();
    return true;
  },

  /**
   * Back to the title screen. The autosave is left intact so "quit" never means
   * "lose your run" — the player can pick it straight back up.
   */
  quitToTitle() {
    const { game } = get();
    if (game) void writeSlot(game, AUTOSAVE_ID, 'Autosave');
    set({ game: null, lastWeek: null, revision: get().revision + 1, notice: null });
  },
}));

/**
 * Read the live game. Subscribing to `revision` is what makes in-place engine
 * mutations show up in the UI.
 */
export function useGame(): GameState | null {
  useGameStore((s) => s.revision);
  return useGameStore.getState().game;
}

/** Convenience: run an engine action that returns a Result and surface any refusal. */
export function useAction() {
  const mutate = useGameStore((s) => s.mutate);
  const setNotice = useGameStore((s) => s.setNotice);

  return function run<T>(
    fn: (game: GameState) => { ok: true; value: T } | { ok: false; reason: string },
  ): T | undefined {
    const result = mutate(fn);
    if (!result) return undefined;
    if (!result.ok) {
      setNotice(result.reason);
      return undefined;
    }
    setNotice(null);
    return result.value;
  };
}
