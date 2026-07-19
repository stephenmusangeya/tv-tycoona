import { conceptOf, registerConcepts } from '../data';
import { bindTalent, createProduction, refreshQuality } from './production';
import {
  archetypeCeiling,
  budgetScore,
  effectiveCraft,
  isScripted,
  rollChemistry,
  talentScore,
} from './quality';
import { clamp, createRng } from './rng';
import {
  AXES,
  type Angle,
  type Attributes,
  type Axis,
  type Format,
  type GameState,
  type Pitch,
  type Production,
  type ShowArchetype,
  type TalentState,
} from './types';

/**
 * Making a show, rather than shopping for one.
 *
 * The studio used to pick from a fixed catalogue: 120 shows that existed from nowhere,
 * priced identically in every playthrough, waiting to be bought. That is a menu, not a
 * studio. Here the player authors the thing — title, format, genre, treatment, order
 * length, budget, and the people — and the result is written into `state.concepts` as
 * an ordinary concept. Downstream (ratings, reviews, posters, syndication) never learns
 * that a human invented it, which is the whole point: no special cases.
 *
 * Every creative choice has to *land somewhere in the numbers* or the flow is a form
 * with a show at the end of it. The chain is deliberately legible:
 *
 *   format  → the baseline vector, the price of an hour, how many hours are normal
 *   genre   → what the show is about, as a shove on the axes
 *   angle   → how it is played; the same premise gritty or comic is two shows
 *   order   → volume trades prestige for presence, and lowers the cost of an hour
 *   producer→ their craft (filtered through their feel for the format) is the ceiling
 *   cast    → conviction: a strong company makes the show *more* like itself
 *   budget  → money on screen, scored against what the show actually needs
 *
 * The one thing the player never sets is quality. Quality is what those inputs
 * produced — see quality.ts.
 */

// ---------------------------------------------------------------------------
// The vocabulary the player picks from
// ---------------------------------------------------------------------------

/** What a format is like before anyone touches it, and what an hour of it costs. */
interface FormatShape {
  base: Attributes;
  /** What one episode of an unremarkable example costs, in USD. */
  costPerEpisode: number;
  /** A normal order — the reference point volume is measured against. */
  episodes: number;
  /** How short and how long an order the format tolerates. */
  episodeRange: [number, number];
  castSize: number;
}

const attrs = (
  entertainment: number,
  prestige: number,
  violence: number,
  wholesomeness: number,
  edginess: number,
  humor: number,
  heart: number,
  complexity: number,
): Attributes => ({
  entertainment,
  prestige,
  violence,
  wholesomeness,
  edginess,
  humor,
  heart,
  complexity,
});

/**
 * Format baselines.
 *
 * Measured from the authored pool rather than invented, so a show the player makes sits
 * in the same economy and the same taste-space as the shows the world is already
 * making. A sitcom you commission costs what a sitcom costs.
 */
const FORMAT_SHAPES: Record<Format, FormatShape> = {
  sitcom: {
    base: attrs(81, 66, 7, 61, 38, 84, 74, 25),
    costPerEpisode: 1_900_000,
    episodes: 24,
    episodeRange: [8, 26],
    castSize: 6,
  },
  drama: {
    base: attrs(78, 74, 51, 29, 56, 35, 59, 63),
    costPerEpisode: 5_600_000,
    episodes: 16,
    episodeRange: [6, 26],
    castSize: 10,
  },
  procedural: {
    base: attrs(80, 62, 38, 35, 38, 36, 41, 41),
    costPerEpisode: 3_800_000,
    episodes: 24,
    episodeRange: [10, 26],
    castSize: 6,
  },
  reality: {
    base: attrs(71, 20, 11, 38, 56, 48, 47, 15),
    costPerEpisode: 800_000,
    episodes: 18,
    episodeRange: [6, 40],
    castSize: 7,
  },
  competition: {
    base: attrs(79, 36, 2, 60, 29, 47, 62, 20),
    costPerEpisode: 1_000_000,
    episodes: 18,
    episodeRange: [8, 40],
    castSize: 7,
  },
  documentary: {
    base: attrs(71, 59, 36, 43, 40, 19, 52, 36),
    costPerEpisode: 900_000,
    episodes: 16,
    episodeRange: [4, 32],
    castSize: 2,
  },
  animation: {
    base: attrs(81, 50, 35, 33, 59, 77, 51, 32),
    costPerEpisode: 2_000_000,
    episodes: 24,
    episodeRange: [8, 52],
    castSize: 6,
  },
  talkshow: {
    base: attrs(73, 35, 14, 43, 50, 55, 45, 7),
    costPerEpisode: 300_000,
    episodes: 190,
    episodeRange: [52, 260],
    castSize: 2,
  },
  gameshow: {
    base: attrs(66, 18, 0, 75, 10, 40, 41, 7),
    costPerEpisode: 260_000,
    episodes: 190,
    episodeRange: [52, 260],
    castSize: 3,
  },
  sketch: {
    base: attrs(81, 67, 9, 37, 63, 87, 40, 18),
    costPerEpisode: 1_000_000,
    episodes: 22,
    episodeRange: [8, 30],
    castSize: 9,
  },
  soap: {
    base: attrs(80, 36, 30, 25, 58, 28, 51, 47),
    costPerEpisode: 4_600_000,
    episodes: 26,
    episodeRange: [26, 260],
    castSize: 11,
  },
  anthology: {
    base: attrs(74, 88, 51, 20, 65, 15, 59, 70),
    costPerEpisode: 5_800_000,
    episodes: 8,
    episodeRange: [6, 16],
    castSize: 6,
  },
  kids: {
    base: attrs(78, 50, 3, 94, 7, 72, 81, 6),
    costPerEpisode: 700_000,
    episodes: 52,
    episodeRange: [13, 130],
    castSize: 6,
  },
  news: {
    base: attrs(45, 56, 14, 41, 37, 16, 24, 32),
    costPerEpisode: 260_000,
    episodes: 200,
    episodeRange: [52, 260],
    castSize: 3,
  },
};

export interface GenreOption {
  id: string;
  name: string;
  /** What the subject matter does to the vector. */
  delta: Partial<Attributes>;
  /** Formats it naturally belongs to — used to order the list, never to forbid. */
  suits: Format[];
}

/**
 * What the show is *about*.
 *
 * Genre is not decoration: it is the largest single shove on the vector after the
 * format itself, which is why a wholesome format plus a true-crime subject makes
 * something genuinely strange rather than something generic.
 */
export const GENRES: GenreOption[] = [
  {
    id: 'comedy',
    name: 'Comedy',
    delta: { humor: 18, heart: 6, violence: -12, prestige: -4 },
    suits: ['sitcom', 'sketch', 'animation'],
  },
  {
    id: 'family',
    name: 'Family',
    delta: { wholesomeness: 20, heart: 14, edginess: -14, violence: -12 },
    suits: ['sitcom', 'kids', 'animation', 'competition'],
  },
  {
    id: 'crime',
    name: 'Crime',
    delta: { violence: 18, complexity: 10, wholesomeness: -18, humor: -8 },
    suits: ['drama', 'procedural', 'documentary'],
  },
  {
    id: 'mystery',
    name: 'Mystery',
    delta: { complexity: 16, edginess: 8, entertainment: 4, humor: -6 },
    suits: ['drama', 'procedural', 'anthology'],
  },
  {
    id: 'medical',
    name: 'Medical',
    delta: { heart: 14, complexity: 10, prestige: 6, humor: -6 },
    suits: ['drama', 'procedural', 'documentary'],
  },
  {
    id: 'legal',
    name: 'Legal',
    delta: { prestige: 12, complexity: 14, heart: -4, humor: -6 },
    suits: ['drama', 'procedural'],
  },
  {
    id: 'romance',
    name: 'Romance',
    delta: { heart: 18, humor: 8, violence: -12, complexity: -4 },
    suits: ['drama', 'soap', 'sitcom'],
  },
  {
    id: 'sci-fi',
    name: 'Science fiction',
    delta: { complexity: 14, entertainment: 8, prestige: 6, wholesomeness: -6 },
    suits: ['drama', 'anthology', 'animation'],
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    delta: { entertainment: 12, complexity: 8, wholesomeness: 6, prestige: 4 },
    suits: ['drama', 'kids', 'animation'],
  },
  {
    id: 'horror',
    name: 'Horror',
    delta: { violence: 22, edginess: 18, wholesomeness: -24, heart: -8 },
    suits: ['drama', 'anthology'],
  },
  {
    id: 'action',
    name: 'Action',
    delta: { entertainment: 14, violence: 16, complexity: -8, prestige: -4 },
    suits: ['drama', 'procedural', 'animation'],
  },
  {
    id: 'historical',
    name: 'Historical',
    delta: { prestige: 18, complexity: 12, entertainment: -6, humor: -6 },
    suits: ['drama', 'anthology', 'documentary'],
  },
  {
    id: 'satire',
    name: 'Satire',
    delta: { humor: 14, edginess: 16, prestige: 8, wholesomeness: -12 },
    suits: ['sketch', 'animation', 'sitcom'],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    delta: { wholesomeness: 14, heart: 10, complexity: -10, violence: -8 },
    suits: ['reality', 'competition', 'talkshow'],
  },
  {
    id: 'true-crime',
    name: 'True crime',
    delta: { violence: 16, edginess: 14, complexity: 10, wholesomeness: -16 },
    suits: ['documentary', 'reality'],
  },
];

const GENRES_BY_ID: Record<string, GenreOption> = Object.fromEntries(
  GENRES.map((genre) => [genre.id, genre]),
);

/**
 * How the premise is played.
 *
 * `Angle` already existed as something a running show could change between seasons.
 * Choosing it up front is the same lever pulled earlier, so a show is born with a
 * treatment rather than defaulting to "straight" and being adjusted afterwards.
 */
const ANGLE_DELTAS: Record<Angle, Partial<Attributes>> = {
  straight: {},
  comic: { humor: 20, heart: 8, violence: -12, prestige: -8 },
  gritty: { violence: 16, edginess: 16, complexity: 10, wholesomeness: -20, humor: -12 },
  wholesome: { wholesomeness: 22, heart: 16, edginess: -18, violence: -16 },
  sensational: { entertainment: 16, edginess: 18, prestige: -16, complexity: -10 },
  prestige: { prestige: 20, complexity: 16, entertainment: -6, humor: -8 },
};

/** Human wording for the generated logline — the angle as an adjective. */
const ANGLE_WORDS: Record<Angle, string> = {
  straight: 'A straight-played',
  comic: 'A comic',
  gritty: 'A gritty',
  wholesome: 'A warm-hearted',
  sensational: 'A loud, tabloid',
  prestige: 'An austere, awards-minded',
};

export const ORDER_STEPS = [6, 8, 10, 13, 16, 20, 22, 24, 26, 39, 52, 78, 130, 190, 260];

// ---------------------------------------------------------------------------
// The blueprint
// ---------------------------------------------------------------------------

/** Everything the player decides about a show that does not exist yet. */
export interface ShowBlueprint {
  title: string;
  format: Format;
  /** A `GenreOption.id`; anything unrecognised is kept as flavour and moves nothing. */
  genre: string;
  angle: Angle;
  episodesPerSeason: number;
  budgetPerEpisode: number;
  /** The producer developing it. Required — this is a commission, not a purchase. */
  producerId?: string;
  castIds?: string[];
  writerIds?: string[];
  directorId?: string;
  hostId?: string;
  marketingRatio?: number;
}

/** Sensible opening values for a format, so the form is never blank. */
export function blueprintFor(format: Format, title = ''): ShowBlueprint {
  const shape = FORMAT_SHAPES[format];
  const genre = GENRES.find((g) => g.suits.includes(format)) ?? GENRES[0];

  return {
    title,
    format,
    genre: genre.id,
    angle: 'straight',
    episodesPerSeason: shape.episodes,
    budgetPerEpisode: shape.costPerEpisode,
    castIds: [],
    writerIds: [],
  };
}

/** The orders this format will accept, for a stepper that cannot be driven off a cliff. */
export function orderOptions(format: Format): number[] {
  const [min, max] = FORMAT_SHAPES[format].episodeRange;
  const inRange = ORDER_STEPS.filter((n) => n >= min && n <= max);
  return inRange.length > 0 ? inRange : [FORMAT_SHAPES[format].episodes];
}

/** What a format is worth per hour before anything else is decided. */
export function formatBaseCost(format: Format): number {
  return FORMAT_SHAPES[format].costPerEpisode;
}

/** Genres ordered so the ones that belong to this format come first. */
export function genresFor(format: Format): GenreOption[] {
  return [...GENRES].sort((a, b) => {
    const aFits = a.suits.includes(format) ? 0 : 1;
    const bFits = b.suits.includes(format) ? 0 : 1;
    return aFits - bFits;
  });
}

/** Which crew roles this format actually uses — the form should not ask for a host on a drama. */
export function rolesFor(format: Format): {
  scripted: boolean;
  roles: Array<'producer' | 'writer' | 'director' | 'host' | 'actor'>;
} {
  return isScripted(format)
    ? { scripted: true, roles: ['producer', 'writer', 'director', 'actor'] }
    : { scripted: false, roles: ['producer', 'writer', 'host'] };
}

// ---------------------------------------------------------------------------
// Turning choices into a show
// ---------------------------------------------------------------------------

/**
 * Push an axis toward a bound rather than through it.
 *
 * Straight addition made every choice agree too loudly: a sitcom is already the
 * funniest thing on television, so adding a comedy genre and a comic angle pinned humor
 * flat at 100 and threw away the difference between a broad farce and a wry one. Moves
 * now shrink as they run out of room, which keeps the far end of every axis rare and
 * meaningful — and means stacking three comedy choices is emphasis, not saturation.
 */
function applyDelta(target: Attributes, delta: Partial<Attributes>): void {
  for (const axis of AXES) {
    const move = delta[axis];
    if (!move) continue;
    const room = move > 0 ? (100 - target[axis]) / 100 : target[axis] / 100;
    target[axis] += move * (0.35 + 0.65 * clamp(room, 0, 1));
  }
}

function clampAll(target: Attributes): Attributes {
  const out = {} as Attributes;
  for (const axis of AXES) out[axis] = clamp(Math.round(target[axis]));
  return out;
}

/**
 * Volume against a normal order, as a signed number of doublings.
 *
 * Used for both taste and price, because they move together: a hundred hours a year is
 * a factory, and a factory is cheaper per hour and less likely to be art.
 */
function volumeDoublings(format: Format, episodes: number): number {
  const normal = FORMAT_SHAPES[format].episodes;
  if (normal <= 0 || episodes <= 0) return 0;
  return clamp(Math.log2(episodes / normal), -2, 2);
}

function people(ids: readonly string[], talent: Record<string, TalentState>): TalentState[] {
  return ids.map((id) => talent[id]).filter((p): p is TalentState => Boolean(p));
}

/**
 * The vector a blueprint would produce, before money is spent on it.
 *
 * Split out from the budget shift below because the budget is scored against what the
 * show *needs*, and what it needs is read off this vector — so the two would otherwise
 * chase each other in a circle.
 */
function creativeVector(
  blueprint: ShowBlueprint,
  talent: Record<string, TalentState>,
): Attributes {
  const { format } = blueprint;
  const out = { ...FORMAT_SHAPES[format].base };

  applyDelta(out, GENRES_BY_ID[blueprint.genre]?.delta ?? {});
  applyDelta(out, ANGLE_DELTAS[blueprint.angle] ?? {});

  // Volume trades standing for presence. A show that is on constantly is part of the
  // furniture; a six-hour event is television people write about.
  const volume = volumeDoublings(format, blueprint.episodesPerSeason);
  out.prestige -= volume * 7;
  out.complexity -= volume * 5;
  out.entertainment += volume * 2;

  // The producer is the ceiling. Craft is filtered through their feel for the format,
  // so hiring a sitcom producer to run a procedural buys much less than their CV says.
  const producer = blueprint.producerId ? talent[blueprint.producerId] : undefined;
  if (producer) {
    const craft = (effectiveCraft(producer, format) - 50) / 50;
    out.prestige += craft * 12;
    out.complexity += craft * 8;
    out.entertainment += ((producer.starPower - 50) / 50) * 6;
    // Difficult people make less comfortable television, and that is not always bad.
    out.edginess += ((producer.ego - 50) / 50) * 8;
  }

  // Conviction: a strong company commits to whatever the show already is, and a weak
  // one sands it toward the middle. This is why casting well makes a show *more*
  // distinctive rather than simply better.
  const company = people(
    [
      ...(blueprint.castIds ?? []),
      ...(blueprint.writerIds ?? []),
      blueprint.directorId,
      blueprint.hostId,
    ].filter((id): id is string => Boolean(id)),
    talent,
  );

  if (company.length > 0) {
    const craft =
      company.reduce((sum, p) => sum + effectiveCraft(p, format), 0) / company.length;
    const star = company.reduce((sum, p) => sum + p.starPower, 0) / company.length;
    const conviction = clamp((craft - 45) / 55, -0.5, 0.7);

    for (const axis of AXES) out[axis] += (out[axis] - 50) * 0.14 * conviction;
    out.entertainment += ((star - 50) / 50) * 7;
  }

  return out;
}

/**
 * What this show actually needs per episode.
 *
 * Deliberately *not* the budget the player typed. If the two were the same number the
 * budget slider would be scored against itself and every show would be perfectly
 * funded — the choice has to be measured against an independent estimate or it is not
 * a choice at all. See `budgetScore` in quality.ts.
 */
function requiredCostPerEpisode(
  blueprint: ShowBlueprint,
  vector: Attributes,
  castSize: number,
): number {
  const shape = FORMAT_SHAPES[blueprint.format];

  // Long orders get cheaper per hour: standing sets, a crew that already knows the job.
  const volumeFactor = clamp(2 ** (volumeDoublings(blueprint.format, blueprint.episodesPerSeason) * -0.3), 0.55, 1.7);
  const castFactor = clamp(Math.sqrt(castSize / Math.max(1, shape.castSize)), 0.7, 1.7);
  // Ambitious television is expensive television, whoever is making it.
  const ambitionFactor = 0.85 + 0.3 * ((vector.prestige + vector.complexity) / 200);

  return Math.max(50_000, Math.round(shape.costPerEpisode * volumeFactor * castFactor * ambitionFactor));
}

/** What visible money does to a show, once there is something to spend it on. */
function applyBudget(vector: Attributes, budget: number, required: number): void {
  if (required <= 0) return;
  const doublings = clamp(Math.log2(Math.max(budget, 1) / required), -1.5, 1.5);
  vector.entertainment += doublings * 6;
  vector.prestige += doublings * 4;
}

function decadeOf(year: number): string {
  return `${Math.floor(year / 10) * 10}s`;
}

function loglineFor(blueprint: ShowBlueprint): string {
  const genre = GENRES_BY_ID[blueprint.genre]?.name.toLowerCase() ?? blueprint.genre;
  const order = blueprint.episodesPerSeason;
  return `${ANGLE_WORDS[blueprint.angle]} ${genre} ${blueprint.format}, developed in-house — ${order} episodes a series.`;
}

// ---------------------------------------------------------------------------
// Preview — the same arithmetic the commission will run
// ---------------------------------------------------------------------------

export interface ShowPreview {
  /** The concept as it would be written into the save, with an empty id. */
  concept: ShowArchetype;
  attributes: Attributes;
  /** What the show needs per episode — the yardstick the budget is scored against. */
  requiredCostPerEpisode: number;
  /** 0–100 on the same curve quality uses. Below ~40 the show looks cheap on screen. */
  funding: number;
  /** Weekly wage bill of everyone attached, per episode. */
  talentCostPerEpisode: number;
  /** Cash on signature: the producer's development fee plus opening the office. */
  upfrontCost: number;
  /** Projected quality at an average chemistry roll — an estimate, never a promise. */
  projectedQuality: number;
  /** Why it cannot be commissioned yet, if it cannot. */
  blocker?: string;
}

/**
 * What the studio pays before a frame is shot.
 *
 * Hiring a producer is a real transaction, not a dropdown: they are paid to develop the
 * show whether or not it ever airs, and a good one is expensive. Everything else lands
 * per episode once it is on air, as it always has.
 */
function upfrontCostOf(producer: TalentState | undefined, required: number): number {
  const fee = producer ? producer.baseSalaryPerEpisode * 3 + (producer.heat / 100) * 250_000 : 0;
  return Math.round(fee + required * 0.15);
}

/**
 * A Production-shaped object that exists only to be scored.
 *
 * `talentScore` reads a Production because that is what it scores everywhere else;
 * rather than duplicate its weighting here — and let the preview drift away from the
 * real thing — the draft is scored by the same function.
 */
function draftProduction(blueprint: ShowBlueprint, budget: number): Production {
  return {
    format: blueprint.format,
    showrunnerId: blueprint.producerId,
    directorId: blueprint.directorId,
    hostId: blueprint.hostId,
    cast: blueprint.castIds ?? [],
    writerIds: blueprint.writerIds ?? [],
    budgetPerEpisode: budget,
  } as Production;
}

export function previewShow(state: GameState, blueprint: ShowBlueprint): ShowPreview {
  const shape = FORMAT_SHAPES[blueprint.format];
  const producer = blueprint.producerId ? state.talent[blueprint.producerId] : undefined;

  const vector = creativeVector(blueprint, state.talent);
  const castSize = Math.max(shape.castSize, (blueprint.castIds ?? []).length);
  const required = requiredCostPerEpisode(blueprint, vector, castSize);
  applyBudget(vector, blueprint.budgetPerEpisode, required);

  const attributes = clampAll(vector);

  const concept: ShowArchetype = {
    id: '',
    title: blueprint.title.trim() || 'Untitled',
    format: blueprint.format,
    genre: GENRES_BY_ID[blueprint.genre]?.name ?? blueprint.genre,
    logline: loglineFor(blueprint),
    era: decadeOf(state.year),
    attributes,
    baseCostPerEpisode: required,
    episodesPerSeason: blueprint.episodesPerSeason,
    castSize,
    requiredRoles: rolesFor(blueprint.format).roles,
    tags: ['original', blueprint.genre, blueprint.angle],
  };

  const attached = people(
    [
      blueprint.producerId,
      blueprint.directorId,
      blueprint.hostId,
      ...(blueprint.castIds ?? []),
      ...(blueprint.writerIds ?? []),
    ].filter((id): id is string => Boolean(id)),
    state.talent,
  );

  const draft = draftProduction(blueprint, blueprint.budgetPerEpisode);
  // 58 is the mean of the chemistry roll — the honest middle of the distribution.
  const projectedQuality = clamp(
    0.35 * talentScore(draft, state.talent) +
      0.25 * budgetScore(blueprint.budgetPerEpisode, required) +
      0.25 * archetypeCeiling(concept) +
      0.15 * 58,
  );

  return {
    concept,
    attributes,
    requiredCostPerEpisode: required,
    funding: budgetScore(blueprint.budgetPerEpisode, required),
    talentCostPerEpisode: attached.reduce((sum, p) => sum + p.baseSalaryPerEpisode, 0),
    upfrontCost: upfrontCostOf(producer, required),
    projectedQuality,
    blocker: blueprintProblem(state, blueprint, upfrontCostOf(producer, required)),
  };
}

/** The one place the rules for "can this be made" live, so preview and commit agree. */
function blueprintProblem(
  state: GameState,
  blueprint: ShowBlueprint,
  upfront: number,
): string | undefined {
  if (!blueprint.title.trim()) return 'Give it a title.';

  const producer = blueprint.producerId ? state.talent[blueprint.producerId] : undefined;
  if (!producer) return 'Hire a producer to develop it.';
  if (producer.role !== 'producer' && producer.role !== 'showrunner') {
    return `${producer.name} does not develop shows.`;
  }
  if (producer.retired) return `${producer.name} has retired.`;
  if (producer.productionId) return `${producer.name} is already on a show.`;

  const [min, max] = FORMAT_SHAPES[blueprint.format].episodeRange;
  if (blueprint.episodesPerSeason < min || blueprint.episodesPerSeason > max) {
    return `Nobody orders ${blueprint.episodesPerSeason} episodes of a ${blueprint.format}.`;
  }
  if (blueprint.budgetPerEpisode <= 0) return 'The budget has to be a number.';

  for (const id of everyoneIn(blueprint)) {
    const person = state.talent[id];
    if (!person) return 'Somebody on the call sheet no longer exists.';
    if (person.retired) return `${person.name} has retired.`;
    if (person.productionId) return `${person.name} is already on a show.`;
  }

  const studio = state.companies[state.player.studioId];
  if (!studio) return 'No studio.';
  if (studio.cash < upfront) return 'You cannot cover the development fee.';

  return undefined;
}

function everyoneIn(blueprint: ShowBlueprint): string[] {
  return [
    blueprint.producerId,
    blueprint.directorId,
    blueprint.hostId,
    ...(blueprint.castIds ?? []),
    ...(blueprint.writerIds ?? []),
  ].filter((id): id is string => Boolean(id));
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

function mintId(state: GameState, prefix: string): string {
  return `${prefix}_${(state.nextId++).toString(36)}`;
}

/** Attach the people the player chose, in the slots their roles imply. */
function staffFromBlueprint(
  production: Production,
  blueprint: ShowBlueprint,
  talent: Record<string, TalentState>,
): void {
  production.showrunnerId = blueprint.producerId;
  production.directorId = blueprint.directorId;
  production.hostId = blueprint.hostId;
  production.cast = [...(blueprint.castIds ?? [])];
  production.writerIds = [...(blueprint.writerIds ?? [])];

  // Silently drop anyone who has since become unavailable rather than binding a ghost.
  const usable = (id: string | undefined) => {
    if (!id) return false;
    const person = talent[id];
    return Boolean(person) && !person.retired;
  };
  if (!usable(production.showrunnerId)) production.showrunnerId = undefined;
  if (!usable(production.directorId)) production.directorId = undefined;
  if (!usable(production.hostId)) production.hostId = undefined;
  production.cast = production.cast.filter(usable);
  production.writerIds = production.writerIds.filter(usable);
}

/**
 * Commission a show the player invented.
 *
 * The concept is minted into `state.concepts` and the production is created against it
 * exactly as if the concept had always existed, so nothing downstream needs to know the
 * difference. The RNG is drawn from the state cursor, never `Math.random`, because a
 * save has to replay identically.
 */
export function createShow(state: GameState, blueprint: ShowBlueprint): Result<Production> {
  const studio = state.companies[state.player.studioId];
  if (!studio) return fail('No studio.');

  const preview = previewShow(state, blueprint);
  if (preview.blocker) return fail(preview.blocker);

  const rng = createRng(state.rngState);

  const concept: ShowArchetype = { ...preview.concept, id: mintId(state, 'concept') };
  state.concepts[concept.id] = concept;
  // The rest of the engine still resolves a production's archetype by id through the
  // static pool, which has never heard of a show invented five seconds ago.
  registerConcepts(state.concepts);

  const production = createProduction(concept, state.talent, rng, (p) => mintId(state, p), {
    ownerId: studio.id,
    budgetMultiplier: blueprint.budgetPerEpisode / concept.baseCostPerEpisode,
    marketingRatio: blueprint.marketingRatio ?? 0.12,
    // The player casts it; auto-staffing would overwrite the choices they just made.
    unstaffed: true,
    titleOverride: concept.title,
    attributesOverride: { ...concept.attributes },
  });

  // Born with a treatment. Everywhere else `angle` starts 'straight' and is changed
  // between seasons; choosing it up front is the same lever, pulled earlier.
  production.angle = blueprint.angle;

  staffFromBlueprint(production, blueprint, state.talent);
  bindTalent(production, state.talent, studio.id);

  // Chemistry has to be re-rolled now that there is a company: createProduction rolled
  // it against an empty call sheet, which is nobody's actual show.
  production.chemistry = rollChemistry(production, state.talent, (m, s) => rng.normal(m, s));
  refreshQuality(production, concept, state.talent);
  production.developmentWeeksRemaining = 12;

  studio.cash -= preview.upfrontCost;

  state.productions[production.id] = production;
  state.rngState = rng.state();

  return ok(production);
}

// ---------------------------------------------------------------------------
// Pitches you put your stamp on
// ---------------------------------------------------------------------------

/**
 * The changes a studio can make to somebody else's pitch before green-lighting it.
 *
 * Every field left undefined means "as pitched". Notes are not free: the further the
 * show is moved from what the pitcher wrote, the more the room is fighting the
 * material, and that comes out of chemistry rather than out of nothing.
 */
export interface PitchRevision {
  title?: string;
  angle?: Angle;
  genre?: string;
  episodesPerSeason?: number;
  budgetPerEpisode?: number;
  /** Put your own producer on it. The pitcher stays attached in their own role. */
  producerId?: string;
  castIds?: string[];
}

export interface RevisedPitch {
  /** The pitch as it would be after the notes. */
  attributes: Attributes;
  episodesPerSeason: number;
  budgetPerEpisode: number;
  title: string;
  /** 0–1. How hard the notes fight the material. */
  friction: number;
  /** Per-axis note strength, 0–1 — stored on the production as a record of the meddling. */
  notes: Partial<Record<Axis, number>>;
  /** Chemistry the show would start with, against a cold-start average of 58. */
  chemistry: number;
  concept: ShowArchetype;
  /** True when the notes are heavy enough to need a new concept rather than the old one. */
  forked: boolean;
}

/**
 * What the notes would do, without doing them.
 *
 * The pitch's own vector is the starting point rather than the format baseline — the
 * pitcher already bent it toward their sensibility (see pitches.ts) and a studio note
 * is an adjustment to *their* show, not a fresh build.
 */
export function revisionPreview(
  state: GameState,
  pitch: Pitch,
  revision: PitchRevision,
): RevisedPitch {
  const original = conceptOf(state.concepts, pitch.archetypeId);
  const episodes = revision.episodesPerSeason ?? original.episodesPerSeason;
  const budget = revision.budgetPerEpisode ?? pitch.estimatedCostPerEpisode;
  const title = (revision.title ?? pitch.title).trim() || pitch.title;

  const vector: Attributes = { ...pitch.attributes };

  // A pitch arrives played straight; naming an angle is the single biggest note there is.
  if (revision.angle && revision.angle !== 'straight') {
    applyDelta(vector, ANGLE_DELTAS[revision.angle]);
  }
  if (revision.genre && revision.genre !== original.genre) {
    applyDelta(vector, GENRES_BY_ID[revision.genre]?.delta ?? {});
  }
  if (revision.episodesPerSeason && revision.episodesPerSeason !== original.episodesPerSeason) {
    const before = volumeDoublings(pitch.format, original.episodesPerSeason);
    const after = volumeDoublings(pitch.format, episodes);
    const move = after - before;
    vector.prestige -= move * 7;
    vector.complexity -= move * 5;
    vector.entertainment += move * 2;
  }

  const attributes = clampAll(vector);

  // Friction is measured on the vector, not on the number of fields touched — moving a
  // show two points is not a note, moving it thirty is a different show.
  const notes: Partial<Record<Axis, number>> = {};
  let drift = 0;
  for (const axis of AXES) {
    const moved = Math.abs(attributes[axis] - pitch.attributes[axis]);
    drift += moved;
    if (moved >= 3) notes[axis] = Math.round((moved / 100) * 100) / 100;
  }
  let friction = clamp(drift / (AXES.length * 100), 0, 1);

  // A producer with real craft can sell the notes to the room. That is most of what a
  // producer is for, and it is why hiring one before rewriting somebody is worth it.
  const producer = revision.producerId ? state.talent[revision.producerId] : undefined;
  if (producer) friction *= clamp(1 - effectiveCraft(producer, pitch.format) / 250, 0.4, 1);

  const changed =
    friction > 0 ||
    title !== pitch.title ||
    episodes !== original.episodesPerSeason ||
    Boolean(revision.genre && revision.genre !== original.genre);

  const concept: ShowArchetype = changed
    ? {
        ...original,
        id: '',
        title,
        attributes,
        episodesPerSeason: episodes,
        genre: revision.genre ? (GENRES_BY_ID[revision.genre]?.name ?? revision.genre) : original.genre,
        tags: [...original.tags, 'revised'],
      }
    : original;

  return {
    attributes,
    episodesPerSeason: episodes,
    budgetPerEpisode: budget,
    title,
    friction,
    notes,
    // 58 is the cold-start mean; notes come straight off it.
    chemistry: clamp(58 - friction * 55),
    concept,
    forked: changed,
  };
}

/**
 * Green-light a pitch after rewriting it.
 *
 * The plain accept-it-as-pitched path stays in actions.ts. This is the version where
 * the studio has an opinion: the show is retitled, re-angled, re-ordered or recast, a
 * house producer is put on it, and the pitcher finds out what a note is.
 */
export function greenlightRevisedPitch(
  state: GameState,
  pitchId: string,
  revision: PitchRevision,
): Result<Production> {
  const pitch = state.pitches.find((p) => p.id === pitchId);
  if (!pitch) return fail('That pitch is no longer available.');

  const studio = state.companies[state.player.studioId];
  if (!studio) return fail('No studio.');

  const producer = revision.producerId ? state.talent[revision.producerId] : undefined;
  if (revision.producerId && !producer) return fail('That producer no longer exists.');
  if (producer && producer.productionId) return fail(`${producer.name} is already on a show.`);

  const revised = revisionPreview(state, pitch, revision);

  const rng = createRng(state.rngState);

  let concept = revised.concept;
  if (revised.forked) {
    concept = { ...revised.concept, id: mintId(state, 'concept') };
    state.concepts[concept.id] = concept;
    registerConcepts(state.concepts);
  }

  const production = createProduction(concept, state.talent, rng, (p) => mintId(state, p), {
    ownerId: studio.id,
    budgetMultiplier: revised.budgetPerEpisode / Math.max(1, concept.baseCostPerEpisode),
    marketingRatio: 0.12,
    unstaffed: true,
    titleOverride: revised.title,
    attributesOverride: { ...revised.attributes },
  });

  if (revision.angle) production.angle = revision.angle;
  if (Object.keys(revised.notes).length > 0) production.notes = revised.notes;

  // The pitcher keeps the job they pitched themselves for; the studio's producer takes
  // the showrunner chair, which is exactly the friction the notes are measuring.
  attachPitcher(production, state.talent[pitch.pitcherId]);
  if (producer) production.showrunnerId = producer.id;
  for (const id of revision.castIds ?? []) {
    const person = state.talent[id];
    if (!person || person.retired || person.productionId) continue;
    if (person.role === 'actor' && !production.cast.includes(id)) production.cast.push(id);
    else if (person.role === 'writer' && !production.writerIds.includes(id)) {
      production.writerIds.push(id);
    } else if (person.role === 'director') production.directorId = id;
    else if (person.role === 'host') production.hostId = id;
  }

  bindTalent(production, state.talent, studio.id);

  const pitcher = state.talent[pitch.pitcherId];
  if (pitcher) {
    // Say yes and they warm to you; rewrite them at the same time and they warm less.
    pitcher.relationships[studio.id] = clamp(
      (pitcher.relationships[studio.id] ?? 40) + 20 - revised.friction * 45,
    );
    pitcher.morale = clamp(pitcher.morale - revised.friction * 25);
  }

  // Rolled fresh for the real company, then dragged down by however hard the room is
  // fighting the material. Notes are a real cost, paid in the thing money cannot buy.
  const rolled = rollChemistry(production, state.talent, (m, s) => rng.normal(m, s));
  production.chemistry = clamp(rolled - revised.friction * 55);
  production.developmentWeeksRemaining = 12;
  refreshQuality(production, concept, state.talent);

  state.productions[production.id] = production;
  state.pitches = state.pitches.filter((p) => p.id !== pitchId);
  state.rngState = rng.state();

  return ok(production);
}

/** Slot a pitcher into whichever chair their role implies. Mirrors actions.ts. */
function attachPitcher(production: Production, pitcher: TalentState | undefined): void {
  if (!pitcher || pitcher.retired || pitcher.productionId) return;
  switch (pitcher.role) {
    case 'showrunner':
    case 'producer':
      production.showrunnerId = pitcher.id;
      break;
    case 'writer':
      if (!production.writerIds.includes(pitcher.id)) production.writerIds.push(pitcher.id);
      break;
    case 'director':
      production.directorId = pitcher.id;
      break;
    case 'host':
      production.hostId = pitcher.id;
      break;
    case 'actor':
      if (!production.cast.includes(pitcher.id)) production.cast.unshift(pitcher.id);
      break;
  }
}

/** Producers and showrunners who could develop something for you right now. */
export function availableProducers(state: GameState): TalentState[] {
  return Object.values(state.talent)
    .filter((p) => !p.retired && !p.productionId && (p.role === 'producer' || p.role === 'showrunner'))
    .sort((a, b) => b.craft + b.starPower - (a.craft + a.starPower));
}

/** Free talent in a given role, best first — the call sheet the create flow casts from. */
export function availableFor(
  state: GameState,
  role: TalentState['role'],
  format: Format,
  limit = 40,
): TalentState[] {
  return Object.values(state.talent)
    .filter((p) => !p.retired && !p.productionId && p.role === role)
    .sort((a, b) => effectiveCraft(b, format) - effectiveCraft(a, format))
    .slice(0, limit);
}

/** Kept exported so the UI can label a format without reaching into the shape table. */
export function formatShape(format: Format): Readonly<FormatShape> {
  return FORMAT_SHAPES[format];
}

