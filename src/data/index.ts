import type { ShowArchetype, TalentRecord } from '../engine/types';
import showsJson from './shows.json';
import talentJson from './talent.json';

/**
 * Content database access.
 *
 * The JSON files are inspired-by-but-original: see docs/DESIGN.md §13. Titles,
 * loglines and people are all fictional.
 */

export const SHOW_ARCHETYPES = showsJson as unknown as ShowArchetype[];
export const TALENT_RECORDS = talentJson as unknown as TalentRecord[];

export const ARCHETYPES_BY_ID: Record<string, ShowArchetype> = Object.fromEntries(
  SHOW_ARCHETYPES.map((show) => [show.id, show]),
);

export function getArchetype(id: string): ShowArchetype {
  const archetype = ARCHETYPES_BY_ID[id];
  if (!archetype) throw new Error(`Unknown show archetype: ${id}`);
  return archetype;
}

/**
 * Resolve a concept for a given save.
 *
 * Concepts live in the save (see `GameState.concepts`) so that two playthroughs can
 * diverge and so a show the player invented is indistinguishable from one the world
 * generated. The static pool is the fallback, which keeps every existing save and
 * every tool that reaches for a known id working unchanged.
 *
 * Takes the concepts map rather than the whole state so the engine, the selectors and
 * the tools can all call it without dragging a circular import between data/ and
 * engine/ into existence.
 */
export function conceptOf(
  concepts: Record<string, ShowArchetype> | undefined,
  id: string,
): ShowArchetype {
  const own = concepts?.[id];
  if (own) return own;
  return getArchetype(id);
}

/** Non-throwing variant, for UI that may hold a stale or unknown id. */
export function findConcept(
  concepts: Record<string, ShowArchetype> | undefined,
  id: string,
): ShowArchetype | undefined {
  return concepts?.[id] ?? ARCHETYPES_BY_ID[id];
}

export { AUDIENCE_SEGMENTS, SEGMENTS_BY_ID, TOTAL_AUDIENCE } from './segments';
