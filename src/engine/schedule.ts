import type { Slot } from './types';

/**
 * The prime-time grid and the broadcast calendar.
 *
 * Three hours a night, seven nights a week: 21 slots per network. Filling a grid is
 * the network tier's core puzzle, and the hour matters as much as the night because
 * each hour has a different audience awake (see data/segments.ts).
 */

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const PRIME_HOURS = [20, 21, 22] as const;

export function slotKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

export function parseSlotKey(key: string): Slot {
  const [day, hour] = key.split('-').map(Number);
  return { day, hour };
}

export function formatSlotKey(key: string): string {
  const { day, hour } = parseSlotKey(key);
  return `${DAY_NAMES[day] ?? '?'} ${hour}:00`;
}

export function allSlotKeys(): string[] {
  const keys: string[] = [];
  for (let day = 0; day < DAY_NAMES.length; day++) {
    for (const hour of PRIME_HOURS) keys.push(slotKey(day, hour));
  }
  return keys;
}

export function emptySchedule(): Record<string, string | null> {
  return Object.fromEntries(allSlotKeys().map((key) => [key, null]));
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Week the broadcast season premieres — everything launches at once. */
export const WEEK_SEASON_PREMIERE = 37;
/** Networks lock next season's schedule; pickups and cancellations land. */
export const WEEK_UPFRONTS = 20;
/** Midseason replacement launch window. */
export const WEEK_MIDSEASON = 2;
/** Awards night — prestige converts into reputation. */
export const WEEK_AWARDS = 3;
/** Ratings count double for advertisers. */
export const SWEEPS_WEEKS = [8, 44] as const;

export const WEEKS_PER_YEAR = 52;

export function isSweeps(week: number): boolean {
  return (SWEEPS_WEEKS as readonly number[]).includes(week);
}

export function isPremiereWindow(week: number): boolean {
  return week === WEEK_SEASON_PREMIERE || week === WEEK_MIDSEASON;
}

/** Weeks 23–36 are summer: reduced viewing, and nothing new launches. */
export function isSummer(week: number): boolean {
  return week >= 23 && week <= 36;
}

export function formatWeek(year: number, week: number): string {
  return `Y${year} W${week}`;
}

/**
 * How many episodes of a format air in one week.
 *
 * Talk shows, game shows and news are *strips*: they run five nights a week in the
 * same slot. Airing them one episode a week would mean a 200-episode season took four
 * years to broadcast, which is why they need this and scripted drama does not.
 */
export function episodesPerWeek(format: string): number {
  return format === 'talkshow' || format === 'gameshow' || format === 'news' ? 5 : 1;
}
