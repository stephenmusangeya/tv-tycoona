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

export { AUDIENCE_SEGMENTS, SEGMENTS_BY_ID, TOTAL_AUDIENCE } from './segments';
