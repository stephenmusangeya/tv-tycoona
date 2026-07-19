import { AUDIENCE_SEGMENTS } from '../data/segments';
import { appealProfile } from './audience';
import type { Company, Production, SegmentId, ShowArchetype, TalentState } from './types';

/**
 * The ratings model. See docs/DESIGN.md §5.
 *
 * Ratings are resolved a *slot at a time*, not a show at a time. Every show airing
 * in the same hour competes for the same finite pool of people, segment by segment,
 * and each takes a share proportional to how hard it pulls on that specific segment.
 *
 * Resolving by slot rather than by show is what makes counter-programming emerge for
 * free. A show with zero appeal to families takes zero family audience no matter how
 * big a hit it is, so the wholesome sitcom opposite the violent prestige drama keeps
 * its entire audience. No special case required — it falls out of the allocation.
 */

/**
 * Everything the audience could be doing instead: the hundreds of channels, services
 * and distractions the simulation does not model individually.
 *
 * Without this term shares would sum to 1 and the four simulated networks would split
 * the entire country between them.
 *
 * Kept deliberately low, because this number also controls how hard shows fight each
 * other. A large value swamps the denominator and makes rivals nearly irrelevant —
 * an earlier pass set it to 4.5 and counter-programming, though directionally
 * correct, moved total viewers by only 8%. Competition should be felt.
 */
const OUTSIDE_OPTIONS = 1.2;

/**
 * Share of the theoretically available audience that any real broadcast converts.
 *
 * This is the absolute-level dial, deliberately separated from OUTSIDE_OPTIONS so the
 * two jobs — "how big is the market" and "how hard do shows fight over it" — can be
 * tuned independently. Conflating them is what made competition toothless before.
 *
 * Lowered from 0.4 because the numbers were flattering to the point of meaninglessness:
 * the player's first show pulled 9M and the chart topped out near 11M, so every show
 * looked like a phenomenon and nothing felt earned. A hit should read as a hit. At
 * 0.22 a strong show lands around 5M, a solid one 2–3M, and a flop under 1M — which
 * is roughly where real broadcast television sits and, more importantly, gives the
 * ratings room to mean something.
 *
 * `ECONOMY.revenuePerViewer` was raised by the reciprocal, so this changes what the
 * player *reads* without quietly halving every network's income underneath them.
 *
 * Lowered again from 0.22 alongside the cost-ladder rebuild. With a real bottom rung
 * in the catalogue the game now expects small television to exist, but the floor of
 * the ratings distribution sat near 0.9M and the lower quartile near 2M — every show
 * in the world, including the cheap daytime strips, was a broadcast success. A studio
 * making its first modest thing had no honest frame of reference for what modest looks
 * like. At 0.15 a few hundred thousand viewers is a normal outcome for a small show,
 * which is what the bottom of the ladder needs in order to read as a starting point
 * rather than a failure.
 */
const MARKET_CAPTURE = 0.15;

export interface SlotEntrant {
  production: Production;
  archetype: ShowArchetype;
  network: Company;
}

export interface AiringOutcome {
  productionId: string;
  viewers: number;
  viewersBySegment: Record<SegmentId, number>;
}

/**
 * How many people know the show is on, 0–1.
 *
 * Exponential saturation: the first dollar of marketing is worth far more than the
 * hundredth, and an established show carries awareness for free — which is exactly
 * why cancelling a show with 40 episodes banked and replacing it with a new one is
 * usually a downgrade even when the new show is better.
 */
export function computeAwareness(
  production: Production,
  archetype: ShowArchetype,
  talent: Record<string, TalentState>,
): number {
  const marketingUnits =
    archetype.baseCostPerEpisode > 0
      ? (production.marketingPerEpisode / archetype.baseCostPerEpisode) * 1.4
      : 0;

  const buzzUnits = (production.buzz / 100) * 1.0;

  const attached = [production.showrunnerId, production.hostId, ...production.cast]
    .filter((id): id is string => Boolean(id))
    .map((id) => talent[id])
    .filter(Boolean);
  const peakStar = attached.reduce((max, p) => Math.max(max, p.starPower), 0);
  const starUnits = (peakStar / 100) * 0.8;

  // Longevity is its own marketing budget.
  const legacyUnits = Math.min(production.totalEpisodes / 40, 1) * 1.2;

  const total = marketingUnits + buzzUnits + starUnits + legacyUnits;
  return 1 - Math.exp(-total);
}

/**
 * Quality's effect on tune-in, roughly 0.5× to 1.6×.
 *
 * Superlinear at the top: the difference between a good show and a great one is
 * bigger than the difference between a bad show and a mediocre one, because great
 * shows get recommended and mediocre ones do not.
 */
export function qualityMultiplier(quality: number): number {
  return 0.5 + (quality / 100) ** 1.2 * 1.1;
}

/** Raw pull, before competition — how hard this show tugs at each segment. */
function entrantPull(
  entrant: SlotEntrant,
  talent: Record<string, TalentState>,
): { pull: Record<SegmentId, number>; appeal: Record<SegmentId, number> } {
  const { production, archetype, network } = entrant;

  const appeal = appealProfile(production.attributes);
  const awareness = computeAwareness(production, archetype, talent);
  const quality = qualityMultiplier(production.quality);
  const reach = network.reach ?? 1;
  const fatigueFactor = 1 - production.fatigue;

  const pull = {} as Record<SegmentId, number>;
  for (const segment of AUDIENCE_SEGMENTS) {
    pull[segment.id] =
      appeal[segment.id] * awareness * quality * reach * Math.max(0.15, fatigueFactor);
  }

  return { pull, appeal };
}

export interface SlotOptions {
  /** 20, 21 or 22 — decides which segments are even awake. */
  hour: number;
  /** Sweeps weeks inflate sampling slightly as networks stunt. */
  isSweeps?: boolean;
  /** Premieres draw a curiosity bump. */
  isPremiere?: boolean;
  /** Multiplicative noise, ±. Supplied by the caller's seeded RNG. */
  noise?: (productionId: string) => number;
}

/**
 * Resolve one timeslot across every network airing in it.
 *
 * Returns viewers in millions, broken down by segment — the demographic split is not
 * cosmetic, it is what determines revenue (see economy.ts).
 */
export function simulateSlot(
  entrants: SlotEntrant[],
  talent: Record<string, TalentState>,
  options: SlotOptions,
): AiringOutcome[] {
  if (entrants.length === 0) return [];

  const { hour, isSweeps = false, isPremiere = false, noise } = options;

  const pulls = entrants.map((entrant) => ({
    entrant,
    ...entrantPull(entrant, talent),
  }));

  const outcomes: AiringOutcome[] = pulls.map(({ entrant }) => ({
    productionId: entrant.production.id,
    viewers: 0,
    viewersBySegment: Object.fromEntries(
      AUDIENCE_SEGMENTS.map((s) => [s.id, 0]),
    ) as Record<SegmentId, number>,
  }));

  for (const segment of AUDIENCE_SEGMENTS) {
    const availability = segment.availabilityByHour[hour] ?? 0;
    if (availability <= 0) continue;

    const availableViewers = segment.size * availability * MARKET_CAPTURE;

    let totalPull = OUTSIDE_OPTIONS;
    for (const p of pulls) totalPull += p.pull[segment.id];

    for (let i = 0; i < pulls.length; i++) {
      const share = pulls[i].pull[segment.id] / totalPull;
      outcomes[i].viewersBySegment[segment.id] = availableViewers * share;
    }
  }

  // Global modifiers applied after allocation so they never break share arithmetic.
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    let modifier = 1;
    if (isSweeps) modifier *= 1.08;
    if (isPremiere) modifier *= 1.25;
    if (noise) modifier *= noise(outcome.productionId);

    let total = 0;
    for (const segment of AUDIENCE_SEGMENTS) {
      outcome.viewersBySegment[segment.id] *= modifier;
      total += outcome.viewersBySegment[segment.id];
    }
    outcome.viewers = total;
  }

  return outcomes;
}

/**
 * How much a season took out of the show, 0–1, added to `fatigue` at season end.
 *
 * Serialised, complex shows burn out faster than procedurals — a procedural can run
 * for fifteen years because it never has to escalate, while a heavily serialised
 * drama runs out of story. Quality slows the decay but never stops it.
 */
export function seasonFatigueIncrement(
  production: Production,
  archetype: ShowArchetype,
): number {
  const complexityBurn = 0.02 + (archetype.attributes.complexity / 100) * 0.055;
  const qualityRelief = (production.quality / 100) * 0.025;
  return Math.max(0.008, complexityBurn - qualityRelief);
}

/** Buzz decays toward zero every week unless something keeps feeding it. */
export function decayBuzz(buzz: number): number {
  return buzz * 0.88;
}
