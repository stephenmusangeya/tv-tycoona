import AsyncStorage from '@react-native-async-storage/async-storage';

import { looksLikeSave, migrateSave } from '../engine/migrate';
import type { GameState } from '../engine/types';

/**
 * Named save slots.
 *
 * The game previously had exactly one invisible autosave and no way to keep a run,
 * branch a decision, or start over without wiping it. Slots are the minimum a
 * management game needs: an autosave that just happens, plus named saves the player
 * controls.
 */

const INDEX_KEY = 'tv-tycoon:slots:v1';
const slotKey = (id: string) => `tv-tycoon:slot:${id}`;

export const AUTOSAVE_ID = 'autosave';

export interface SlotInfo {
  id: string;
  name: string;
  /** ISO timestamp — stamped outside the engine, which has no clock. */
  savedAt: string;
  year: number;
  week: number;
  studioName: string;
  cash: number;
  shows: number;
}

async function readIndex(): Promise<SlotInfo[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SlotInfo[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(slots: SlotInfo[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(slots));
}

function describe(game: GameState, id: string, name: string): SlotInfo {
  const studio = game.companies[game.player.studioId];
  const mine = new Set(
    [game.player.studioId, game.player.networkId, game.player.streamerId].filter(Boolean),
  );
  const shows = Object.values(game.productions).filter(
    (p) => mine.has(p.ownerId) && p.status !== 'cancelled' && p.status !== 'ended',
  ).length;

  return {
    id,
    name,
    savedAt: new Date().toISOString(),
    year: game.year,
    week: game.week,
    studioName: studio?.name ?? 'Studio',
    cash: studio?.cash ?? 0,
    shows,
  };
}

/** Newest first, with the autosave always pinned to the top. */
export async function listSaves(): Promise<SlotInfo[]> {
  const slots = await readIndex();
  return slots.sort((a, b) => {
    if (a.id === AUTOSAVE_ID) return -1;
    if (b.id === AUTOSAVE_ID) return 1;
    return b.savedAt.localeCompare(a.savedAt);
  });
}

export async function writeSlot(
  game: GameState,
  id: string,
  name: string,
): Promise<SlotInfo> {
  const info = describe(game, id, name);
  await AsyncStorage.setItem(slotKey(id), JSON.stringify(game));

  const slots = await readIndex();
  const next = slots.filter((s) => s.id !== id);
  next.push(info);
  await writeIndex(next);

  return info;
}

export async function readSlot(id: string): Promise<GameState | null> {
  try {
    const raw = await AsyncStorage.getItem(slotKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!looksLikeSave(parsed)) return null;
    // A slot written by an older build needs the same backfill as the autosave.
    migrateSave(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteSlot(id: string): Promise<void> {
  await AsyncStorage.removeItem(slotKey(id));
  const slots = await readIndex();
  await writeIndex(slots.filter((s) => s.id !== id));
}

/** Id for a new named save. Monotonic so ordering stays sane without a clock. */
export function newSlotId(): string {
  return `slot_${Date.now().toString(36)}`;
}

export function formatSavedAt(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
