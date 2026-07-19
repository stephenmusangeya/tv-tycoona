import { computeQuality, isScripted, rollChemistry } from './quality';
import { clamp } from './rng';
import type { Rng } from './rng';
import type {
  Attributes,
  Format,
  Production,
  ShowArchetype,
  TalentRole,
  TalentState,
} from './types';
import { AXES } from './types';

/**
 * Building and staffing productions.
 *
 * A ShowArchetype is a template; a Production is somebody's actual attempt at it.
 * Everything here is about turning the former into the latter.
 */

export interface MintId {
  (prefix: string): string;
}

/** Copy an attribute vector — productions must never alias their archetype's. */
export function cloneAttributes(attrs: Attributes): Attributes {
  return { ...attrs };
}

/**
 * Nudge an archetype's vector so no two productions of the same template are
 * identical. Small: the archetype should still be recognisable.
 */
export function perturbAttributes(attrs: Attributes, rng: Rng, spread = 6): Attributes {
  const out = {} as Attributes;
  for (const axis of AXES) {
    out[axis] = clamp(attrs[axis] + rng.normal(0, spread));
  }
  return out;
}

/** Free agents suitable for a role, ranked by how well they fit this format. */
export function candidatesFor(
  role: TalentRole,
  format: Format,
  talent: Record<string, TalentState>,
  options: { excludeIds?: Set<string>; requireFree?: boolean } = {},
): TalentState[] {
  const { excludeIds, requireFree = true } = options;

  return Object.values(talent)
    .filter((person) => {
      if (person.retired) return false;
      if (person.role !== role) return false;
      if (requireFree && person.productionId) return false;
      if (excludeIds?.has(person.id)) return false;
      return true;
    })
    .sort((a, b) => fitScore(b, format) - fitScore(a, format));
}

/** A rough "how good is this person for this show" number, used for AI casting. */
export function fitScore(person: TalentState, format: Format): number {
  const affinity = person.genreAffinity[format] ?? person.versatility * 0.6;
  return person.craft * 0.5 + person.starPower * 0.3 + affinity * 0.2;
}

export interface StaffingBudget {
  /** 0–1. How far down the candidate list the picker is willing to reach. */
  ambition: number;
  /** Hard ceiling on combined per-episode talent salary. */
  maxTalentSpendPerEpisode?: number;
}

/**
 * Pick a cast and crew.
 *
 * `ambition` biases toward the top of the candidate list without making the choice
 * deterministic — an AI studio with money reaches for stars, a scrappy one takes the
 * best of what is left, and neither picks the identical roster every playthrough.
 */
export function autoStaff(
  production: Production,
  archetype: ShowArchetype,
  talent: Record<string, TalentState>,
  rng: Rng,
  budget: StaffingBudget,
): void {
  const taken = new Set<string>();
  let spend = 0;
  const ceiling = budget.maxTalentSpendPerEpisode ?? Infinity;

  const hire = (role: TalentRole): TalentState | undefined => {
    const pool = candidatesFor(role, production.format, talent, { excludeIds: taken });
    if (pool.length === 0) return undefined;

    // Reach into the top slice of the list; ambition decides how thin that slice is.
    const window = Math.max(1, Math.round(pool.length * (1 - budget.ambition * 0.85)));
    const shortlist = pool.slice(0, window).filter((p) => spend + p.baseSalaryPerEpisode <= ceiling);
    if (shortlist.length === 0) return undefined;

    const chosen = rng.weighted(shortlist, (p) => fitScore(p, production.format) ** 2);
    taken.add(chosen.id);
    spend += chosen.baseSalaryPerEpisode;
    return chosen;
  };

  if (isScripted(production.format)) {
    production.showrunnerId = hire('showrunner')?.id;
    production.directorId = hire('director')?.id;

    const writerCount = production.format === 'sitcom' ? 3 : 2;
    production.writerIds = [];
    for (let i = 0; i < writerCount; i++) {
      const writer = hire('writer');
      if (writer) production.writerIds.push(writer.id);
    }

    production.cast = [];
    for (let i = 0; i < archetype.castSize; i++) {
      const actor = hire('actor');
      if (actor) production.cast.push(actor.id);
    }
  } else {
    production.hostId = hire('host')?.id;
    production.showrunnerId = hire('showrunner')?.id ?? hire('producer')?.id;

    production.writerIds = [];
    const writer = hire('writer');
    if (writer) production.writerIds.push(writer.id);
  }
}

/** Everyone currently attached to a production. */
export function attachedIds(production: Production): string[] {
  return [
    production.showrunnerId,
    production.directorId,
    production.hostId,
    ...production.cast,
    ...production.writerIds,
  ].filter((id): id is string => Boolean(id));
}

/** Mark everyone attached as working on this show. */
export function bindTalent(
  production: Production,
  talent: Record<string, TalentState>,
  employerId: string,
): void {
  for (const id of attachedIds(production)) {
    const person = talent[id];
    if (!person) continue;
    person.productionId = production.id;
    person.employerId = employerId;
    person.contractSalaryPerEpisode = person.baseSalaryPerEpisode;
    person.relationships[employerId] = clamp((person.relationships[employerId] ?? 40) + 8);
  }
}

/** Release everyone from a production — on cancellation or a show ending. */
export function releaseTalent(
  production: Production,
  talent: Record<string, TalentState>,
): void {
  for (const id of attachedIds(production)) {
    const person = talent[id];
    if (!person || person.productionId !== production.id) continue;
    person.productionId = undefined;
    person.contractWeeksRemaining = undefined;
    person.contractSalaryPerEpisode = undefined;
  }
}

/** Combined per-episode salary of everyone attached. */
export function talentCostPerEpisode(
  production: Production,
  talent: Record<string, TalentState>,
): number {
  return attachedIds(production).reduce((sum, id) => {
    const person = talent[id];
    if (!person) return sum;
    return sum + (person.contractSalaryPerEpisode ?? person.baseSalaryPerEpisode);
  }, 0);
}

export interface CreateProductionOptions {
  ownerId: string;
  budgetMultiplier?: number;
  marketingRatio?: number;
  ambition?: number;
  /** Skip auto-staffing — the player will cast it themselves. */
  unstaffed?: boolean;
  titleOverride?: string;
  attributesOverride?: Attributes;
}

/**
 * Create a fresh production from an archetype: perturb it, staff it, price it, and
 * compute the quality that falls out of those choices.
 */
export function createProduction(
  archetype: ShowArchetype,
  talent: Record<string, TalentState>,
  rng: Rng,
  mintId: MintId,
  options: CreateProductionOptions,
): Production {
  const {
    ownerId,
    budgetMultiplier = 1,
    marketingRatio = 0.12,
    ambition = 0.5,
    unstaffed = false,
    titleOverride,
    attributesOverride,
  } = options;

  const budgetPerEpisode = Math.round(archetype.baseCostPerEpisode * budgetMultiplier);

  const production: Production = {
    id: mintId('prod'),
    archetypeId: archetype.id,
    title: titleOverride ?? archetype.title,
    format: archetype.format,
    // Every show starts played straight with no reputation and no press. Both are
    // earned by airing; see engine/reception.ts.
    angle: 'straight',
    tags: [],
    reviews: [],
    ownerId,
    attributes: attributesOverride ?? perturbAttributes(archetype.attributes, rng),
    quality: 50,
    chemistry: 58,
    budgetPerEpisode,
    episodesPerSeason: archetype.episodesPerSeason,
    marketingPerEpisode: Math.round(budgetPerEpisode * marketingRatio),
    cast: [],
    writerIds: [],
    status: 'development',
    season: 1,
    episodesAiredThisSeason: 0,
    totalEpisodes: 0,
    buzz: rng.range(8, 22),
    fatigue: 0,
    history: [],
    syndicated: false,
    // You made it, so you own it. Rights only move if you sell them.
    rightsOwnerId: ownerId,
    rerunDeals: [],
  };

  if (!unstaffed) {
    autoStaff(production, archetype, talent, rng, { ambition });
    bindTalent(production, talent, ownerId);
  }

  production.chemistry = rollChemistry(production, talent, (m, s) => rng.normal(m, s));
  production.quality = computeQuality(production, archetype, talent);

  return production;
}

/** Recompute derived quality after the player changes cast or budget. */
export function refreshQuality(
  production: Production,
  archetype: ShowArchetype,
  talent: Record<string, TalentState>,
): void {
  production.quality = computeQuality(production, archetype, talent);
}
