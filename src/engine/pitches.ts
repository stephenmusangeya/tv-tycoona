import { SHOW_ARCHETYPES } from '../data';
import { perturbAttributes } from './production';
import { clamp } from './rng';
import type { Rng } from './rng';
import type {
  Format,
  GameEvent,
  GameEventKind,
  GameState,
  Pitch,
  TalentState,
} from './types';

/**
 * Pitches. See docs/DESIGN.md §8.1.
 *
 * Talent you have a relationship with brings you shows. This is the main way a
 * player who has not yet bought a network still has interesting decisions every
 * week — and the main way the game surfaces archetypes the player would never have
 * gone looking for.
 */

/** How long an offer stays on the table before the pitcher takes it elsewhere. */
const PITCH_LIFETIME_WEEKS = 6;
const MAX_OPEN_PITCHES = 6;

/** Roles that bring projects in. Actors do too, but rarely and only when hot. */
const PITCHING_ROLES: Record<string, number> = {
  showrunner: 1,
  writer: 0.8,
  producer: 0.6,
  director: 0.4,
  actor: 0.25,
  host: 0.3,
};

export function generatePitches(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  // Expire stale offers first.
  const before = state.pitches.length;
  state.pitches = state.pitches.filter((p) => p.expiresWeek > state.absoluteWeek);
  if (state.pitches.length < before) {
    emit('pitch', 'A pitch has lapsed', {
      body: 'The project has gone elsewhere.',
      playerRelevant: true,
    });
  }

  if (state.pitches.length >= MAX_OPEN_PITCHES) return;

  const studioId = state.player.studioId;
  const studio = state.companies[studioId];
  if (!studio) return;

  // A better-regarded studio hears from more people. This is the practical payoff of
  // critical standing: prestige is not a score, it is deal flow.
  const standing = (studio.criticalStanding + studio.popularStanding) / 2;
  let weeklyChance = 0.06 + (standing / 100) * 0.18;

  /*
   * The dry-spell guarantee.
   *
   * At a new studio's standing the roll above lands around 8%, which means a player
   * could press "next week" ten times in a row and be offered nothing — the game
   * simply stalled with no decision available. That is the worst thing a management
   * sim can do, and it happened most often to a brand-new player, who has the least
   * patience for it.
   *
   * So the odds now scale with how little the player has on their plate. With an
   * empty tray and nothing on air, work is all but guaranteed to arrive; once there
   * are decisions pending or shows running, the original curve takes over and
   * standing goes back to being what governs deal flow.
   *
   * Derived from existing state on purpose — a "weeks since last pitch" counter would
   * be a new saved field, and every one of those needs a backfill in migrate.ts or it
   * crashes old saves on the weekly tick.
   */
  const pending = state.pitches.length + state.offers.length;
  const running = Object.values(state.productions).filter(
    (p) =>
      p.ownerId === studioId &&
      p.status !== 'cancelled' &&
      p.status !== 'ended',
  ).length;

  if (pending === 0) {
    // Nothing to decide. How hard the game pushes depends on whether the player at
    // least has shows to watch while they wait.
    weeklyChance = running === 0 ? 0.9 : 0.45;
  }

  if (!rng.chance(weeklyChance)) return;

  const available = Object.values(state.talent).filter(
    (p) => !p.retired && !p.productionId && PITCHING_ROLES[p.role] !== undefined,
  );
  if (available.length === 0) return;

  const pitcher = rng.weighted(available, (person) => {
    const roleWeight = PITCHING_ROLES[person.role] ?? 0;
    const relationship = person.relationships[studioId] ?? 20;
    // People who know you, and people who need work, pitch the most.
    return roleWeight * (relationship + 15) * (person.craft / 100 + 0.4);
  });

  const pitch = buildPitch(pitcher, state, rng, mintId);
  if (!pitch) return;

  state.pitches.push(pitch);
  emit('pitch', `${pitcher.name} pitches "${pitch.title}"`, {
    body: pitch.logline,
    playerRelevant: true,
    talentId: pitcher.id,
  });
}

/**
 * Turn a person into a proposal.
 *
 * The archetype is drawn from the formats they are actually good at, so a pitch
 * always plays to its pitcher's strengths — and the attribute vector is nudged
 * toward their sensibility, so a high-ego prestige writer brings you something
 * darker and more complex than the template says.
 */
export function buildPitch(
  pitcher: TalentState,
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
): Pitch | undefined {
  const strongFormats = (Object.entries(pitcher.genreAffinity) as [Format, number][])
    .filter(([, value]) => value >= 50)
    .map(([format]) => format);

  const inProduction = new Set(
    Object.values(state.productions)
      .filter((p) => p.status !== 'cancelled' && p.status !== 'ended')
      .map((p) => p.archetypeId),
  );

  const candidates = SHOW_ARCHETYPES.filter(
    (a) =>
      !inProduction.has(a.id) &&
      (strongFormats.length === 0 || strongFormats.includes(a.format)),
  );
  if (candidates.length === 0) return undefined;

  const archetype = rng.pick(candidates);
  const attributes = perturbAttributes(archetype.attributes, rng, 9);

  // The pitcher's own sensibility bends the show.
  if (pitcher.craft > 70) {
    attributes.prestige = clamp(attributes.prestige + rng.range(3, 12));
    attributes.complexity = clamp(attributes.complexity + rng.range(0, 9));
  }
  if (pitcher.starPower > 75) {
    attributes.entertainment = clamp(attributes.entertainment + rng.range(2, 8));
  }

  // Ambitious people ask for more money than the template assumes.
  const costMultiplier = 0.85 + (pitcher.ego / 100) * 0.45;

  return {
    id: mintId('pitch'),
    archetypeId: archetype.id,
    title: archetype.title,
    format: archetype.format,
    logline: archetype.logline,
    attributes,
    pitcherId: pitcher.id,
    estimatedCostPerEpisode: Math.round(archetype.baseCostPerEpisode * costMultiplier),
    expiresWeek: state.absoluteWeek + PITCH_LIFETIME_WEEKS,
  };
}
