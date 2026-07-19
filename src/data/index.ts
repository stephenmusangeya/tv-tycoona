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

/**
 * Every concept the process knows about: the authored 120, plus the generated
 * concepts of any save that has been opened.
 *
 * Concepts live in the save (see `GameState.concepts`), but plenty of call sites hold
 * only a `production.archetypeId` and no state to resolve it against. Registering
 * generated concepts here keeps that lookup total, so a procedurally generated show
 * behaves exactly like an authored one everywhere — including in the UI, which reads
 * this map directly for cover art.
 *
 * Concept ids are namespaced by seed (see engine/worldGen.ts), so two saves alive at
 * once can never overwrite each other's entries.
 */
export const ARCHETYPES_BY_ID: Record<string, ShowArchetype> = Object.fromEntries(
  SHOW_ARCHETYPES.map((show) => [show.id, show]),
);

/**
 * Make a save's generated concepts globally resolvable.
 *
 * Called when a world is created and whenever a save is loaded. Idempotent, and
 * append-only by construction: ids carry their seed, so re-registering the same world
 * rewrites identical entries and registering a different one cannot clobber it.
 */
export function registerConcepts(
  concepts: Record<string, ShowArchetype> | undefined,
): void {
  if (!concepts) return;
  for (const [id, concept] of Object.entries(concepts)) {
    ARCHETYPES_BY_ID[id] = concept;
  }
}

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
