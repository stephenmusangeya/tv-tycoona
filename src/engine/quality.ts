import { clamp } from './rng';
import type { Format, Production, ShowArchetype, TalentState } from './types';

/**
 * Quality derivation. See docs/DESIGN.md §6.
 *
 * Quality is never chosen by the player — it is what the money and the people
 * actually produced. The player chooses inputs and lives with the output.
 */

/** Formats where the on-screen talent is a cast; everything else is host-led. */
const SCRIPTED_FORMATS = new Set<Format>([
  'sitcom',
  'drama',
  'procedural',
  'soap',
  'anthology',
  'kids',
  'animation',
  'sketch',
]);

export function isScripted(format: Format): boolean {
  return SCRIPTED_FORMATS.has(format);
}

/** What an unstaffed role contributes — bad, but not a zero that nukes the average. */
const UNSTAFFED_BASELINE = 32;

/**
 * A person's usable skill on this particular show.
 *
 * Craft is general ability; genre affinity is whether it transfers. A superb sitcom
 * actor dropped into a procedural is worth noticeably less than their raw craft, and
 * `versatility` is the fallback that decides how much less.
 */
export function effectiveCraft(person: TalentState, format: Format): number {
  const affinity = person.genreAffinity[format] ?? person.versatility * 0.6;
  // Never fully discount someone: floor the multiplier at 0.55 so craft always counts.
  const transfer = 0.55 + 0.45 * (affinity / 100);
  const moraleFactor = 0.85 + 0.15 * (person.morale / 100);
  return person.craft * transfer * moraleFactor;
}

function averageCraft(
  ids: readonly string[],
  talent: Record<string, TalentState>,
  format: Format,
): number {
  const people = ids.map((id) => talent[id]).filter(Boolean);
  if (people.length === 0) return UNSTAFFED_BASELINE;
  const sum = people.reduce((acc, p) => acc + effectiveCraft(p, format), 0);
  return sum / people.length;
}

function oneCraft(
  id: string | undefined,
  talent: Record<string, TalentState>,
  format: Format,
): number {
  const person = id ? talent[id] : undefined;
  return person ? effectiveCraft(person, format) : UNSTAFFED_BASELINE;
}

/** Weighted craft of everyone attached, 0–100. */
export function talentScore(
  production: Production,
  talent: Record<string, TalentState>,
): number {
  const { format } = production;

  if (isScripted(format)) {
    return (
      0.3 * oneCraft(production.showrunnerId, talent, format) +
      0.25 * averageCraft(production.writerIds, talent, format) +
      0.3 * averageCraft(production.cast, talent, format) +
      0.15 * oneCraft(production.directorId, talent, format)
    );
  }

  // Unscripted lives or dies on its host; the room behind them matters less.
  return (
    0.45 * oneCraft(production.hostId, talent, format) +
    0.35 * oneCraft(production.showrunnerId, talent, format) +
    0.2 * averageCraft(production.writerIds, talent, format)
  );
}

/**
 * How well-funded the show is, 0–100.
 *
 * Deliberately asymmetric: underfunding is punished hard and fast, overfunding buys
 * very little. You cannot purchase a good show, but you can absolutely starve one.
 */
export function budgetScore(budgetPerEpisode: number, baseCostPerEpisode: number): number {
  if (baseCostPerEpisode <= 0) return 50;
  const ratio = budgetPerEpisode / baseCostPerEpisode;

  if (ratio <= 0.5) return clamp((ratio / 0.5) * 25); // visibly cheap television
  if (ratio <= 1) return clamp(25 + ((ratio - 0.5) / 0.5) * 60); // 25 → 85
  return clamp(85 + Math.log2(ratio) * 12, 0, 100); // 2× budget ≈ 97
}

/**
 * The archetype's own ceiling — some concepts are simply better television than
 * others, no matter who you throw at them.
 */
export function archetypeCeiling(archetype: ShowArchetype): number {
  return 0.6 * archetype.attributes.entertainment + 0.4 * archetype.attributes.prestige;
}

/**
 * The full quality calculation.
 *
 * `chemistry` is re-rolled per season and supplied by the caller, which is what stops
 * two identically-staffed productions from being the same show.
 */
export function computeQuality(
  production: Production,
  archetype: ShowArchetype,
  talent: Record<string, TalentState>,
): number {
  const raw =
    0.35 * talentScore(production, talent) +
    0.25 * budgetScore(production.budgetPerEpisode, archetype.baseCostPerEpisode) +
    0.25 * archetypeCeiling(archetype) +
    0.15 * production.chemistry;

  return clamp(raw);
}

/**
 * Chemistry roll for a season, 0–100.
 *
 * Centred slightly above the midpoint so most shows are fine, with ego clashes as the
 * downside tail: two people above 80 ego on the same production is a real hazard, and
 * the more of them there are the worse it gets.
 */
export function rollChemistry(
  production: Production,
  talent: Record<string, TalentState>,
  roll: (mean: number, stdDev: number) => number,
): number {
  const attached = [
    production.showrunnerId,
    production.directorId,
    production.hostId,
    ...production.cast,
    ...production.writerIds,
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => talent[id])
    .filter(Boolean);

  const bigEgos = attached.filter((p) => p.ego > 80).length;
  const egoPenalty = bigEgos <= 1 ? 0 : (bigEgos - 1) * 9;

  const averageMorale =
    attached.length > 0
      ? attached.reduce((acc, p) => acc + p.morale, 0) / attached.length
      : 60;
  const moraleBonus = (averageMorale - 60) * 0.15;

  return clamp(roll(58, 16) - egoPenalty + moraleBonus);
}
