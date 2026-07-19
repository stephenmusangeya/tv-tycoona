import { AUDIENCE_SEGMENTS } from '../data/segments';
import { appealProfile } from './audience';
import { budgetScore, talentScore } from './quality';
import { clamp } from './rng';
import type { Rng } from './rng';
import type {
  Angle,
  Attributes,
  Axis,
  GameState,
  Production,
  ProductionStatus,
  Review,
  SegmentId,
  ShowArchetype,
  ShowTag,
  StudioBrand,
  TalentState,
} from './types';

/**
 * Reception: what the world thinks of your shows, and of you.
 *
 * The simulation already knows exactly why a show is working — it computed the
 * quality, rolled the chemistry, tracked the fatigue. The player sees none of that;
 * they see a viewer count and are left to guess. This module is the translation
 * layer: it reads the same state the ratings model reads and says it out loud.
 *
 * Three timescales, deliberately separated:
 *   - a Review is a snapshot of one season, and must be *actionable* — every line of
 *     criticism corresponds to a lever the player can actually pull next season;
 *   - a ShowTag is a durable reputation earned over years, and is never taken away,
 *     because "the one everybody watched as a kid" does not stop being true;
 *   - a StudioBrand is how the public reads the slate as a whole, derived rather than
 *     chosen, so the player's identity is the sum of what they actually made.
 *
 * Everything here is pure and deterministic. Where taste needs a coin flip it takes
 * the caller's seeded Rng — see rng.ts for why Math.random() is banned outright.
 */

// ---------------------------------------------------------------------------
// Angle fit — does the treatment suit the material?
// ---------------------------------------------------------------------------

/**
 * The attribute signature each angle implies.
 *
 * An angle is a promise about what the show is doing. Playing a premise for laughs
 * when it has no jokes in it, or for prestige when it has no ideas, reads on screen as
 * a show at war with itself — which is precisely the note a critic would give and the
 * player can act on, because the angle is changeable between seasons.
 *
 * `straight` is deliberately absent: playing it straight is never wrong and never
 * exciting, so it takes the neutral baseline below.
 */
const ANGLE_SIGNATURE: Record<Angle, Partial<Attributes>> = {
  straight: {},
  comic: { humor: 78, entertainment: 72 },
  gritty: { edginess: 68, violence: 58, wholesomeness: 22 },
  wholesome: { wholesomeness: 78, heart: 68, violence: 12 },
  sensational: { edginess: 76, entertainment: 74, complexity: 22 },
  prestige: { prestige: 74, complexity: 64 },
};

/** Playing it straight can never mismatch, so it sits just above the middle. */
const STRAIGHT_FIT = 0.62;

/**
 * How much critics reward the angle itself, before the show is even considered.
 *
 * Critics are not neutral observers and pretending otherwise makes them boring. A
 * prestige treatment buys goodwill; going sensational costs it. This is small enough
 * to never outweigh the work, and large enough that chasing the tabloids has a price.
 */
const ANGLE_CRITICAL_BIAS: Record<Angle, number> = {
  straight: 0,
  comic: 1,
  gritty: 2,
  wholesome: -1,
  prestige: 5,
  sensational: -7,
};

export function angleFit(attributes: Attributes, angle: Angle): number {
  const signature = ANGLE_SIGNATURE[angle];
  const axes = Object.keys(signature) as Axis[];
  if (axes.length === 0) return STRAIGHT_FIT;

  let distance = 0;
  for (const axis of axes) distance += Math.abs(attributes[axis] - signature[axis]!);
  return Math.max(0, 1 - distance / axes.length / 100);
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Trade press. Invented, but they should read like cuttings from a real newsstand. */
const OUTLETS = [
  'The Trade Sheet',
  'Broadcast Weekly',
  'Aerial',
  'The Dial',
  'Screen & Signal',
  'Primetime Quarterly',
  'The Listings',
  'Cathode',
  'Set & Backlot',
  'The Nightly Review',
  'Channel Notes',
  'The Ratings Desk',
];

/** Most press notices a save needs to keep. A fifteen-year show must not bloat it. */
export const MAX_REVIEWS = 12;

/** How many of each kind of note make it into one notice. Three is a review; ten is a list. */
const MAX_NOTES = 3;

interface Diagnosis {
  /** Higher means the critic leads with it. Zero or below means it does not apply. */
  weight: number;
  text: string;
}

export interface ReviewInput {
  production: Production;
  archetype: ShowArchetype;
  talent: Record<string, TalentState>;
  /** Absolute week — reviews are filed on a timeline, not in a season. */
  week: number;
  rng: Rng;
}

/**
 * Everything the critical read is derived from, gathered once.
 *
 * Kept as a struct because the score and the prose must agree: a review that praises
 * the writing and then scores 30 is worse than no review at all.
 */
interface Reading {
  quality: number;
  craft: number;
  chemistry: number;
  fatigue: number;
  /** 0–100. How well-funded, on the same asymmetric curve quality uses. */
  funding: number;
  /** Spend relative to what this archetype actually costs to make properly. */
  budgetRatio: number;
  marketingRatio: number;
  /** Appeal to the single segment that likes it most, 0–1. Its reason to exist. */
  focus: number;
  focusSegment: SegmentId;
  fit: number;
  peakStar: number;
}

function read(input: ReviewInput): Reading {
  const { production, archetype, talent } = input;
  const appeal = appealProfile(production.attributes);

  let focus = 0;
  let focusSegment: SegmentId = AUDIENCE_SEGMENTS[0].id;
  for (const segment of AUDIENCE_SEGMENTS) {
    if (appeal[segment.id] > focus) {
      focus = appeal[segment.id];
      focusSegment = segment.id;
    }
  }

  const attached = [production.showrunnerId, production.hostId, ...production.cast]
    .filter((id): id is string => Boolean(id))
    .map((id) => talent[id])
    .filter(Boolean);

  const base = archetype.baseCostPerEpisode;

  return {
    quality: production.quality,
    craft: talentScore(production, talent),
    chemistry: production.chemistry,
    fatigue: production.fatigue,
    funding: budgetScore(production.budgetPerEpisode, base),
    budgetRatio: base > 0 ? production.budgetPerEpisode / base : 1,
    marketingRatio:
      production.budgetPerEpisode > 0
        ? production.marketingPerEpisode / production.budgetPerEpisode
        : 0,
    focus,
    focusSegment,
    fit: angleFit(production.attributes, production.angle),
    peakStar: attached.reduce((max, p) => Math.max(max, p.starPower), 0),
  };
}

/**
 * The point the score pivots around, and how hard it is pulled away from it.
 *
 * Set together: the pivot is where an ordinary show lands, the gain is how far from
 * ordinary the extremes are allowed to get. At 1.7 a genuinely excellent show clears
 * 85 and an incompetent one falls under 25, which is the range the tags are written
 * against — raise one without checking the other and critical-darling becomes either
 * automatic or impossible.
 */
const CRITICAL_PIVOT = 52;
const CRITICAL_GAIN = 1.7;

/**
 * The critical score, 0–100 — deliberately *not* the ratings.
 *
 * A show can be adored and unwatched, or enormous and indefensible, and the gap
 * between the two numbers is the most interesting thing the studio can look at. So
 * nothing here touches viewers, awareness, marketing reach or slot: this is a verdict
 * on the thing itself. Ambition is weighted heavily because critics reward reaching,
 * and fatigue bites hard because a fifth season of the same episode is the one failure
 * no amount of money fixes.
 */
export function criticalScore(input: ReviewInput, reading = read(input)): number {
  const attrs = input.production.attributes;

  const ambition = 0.6 * attrs.prestige + 0.4 * attrs.complexity;

  const craftsmanship =
    0.34 * reading.quality +
    0.17 * reading.craft +
    0.13 * reading.chemistry +
    0.16 * ambition +
    0.1 * attrs.entertainment +
    0.1 * (reading.fit * 100);

  // Stretch, because every input above is itself an average and averages of averages
  // collapse toward the middle: unstretched, the whole industry scored 45–65 and a
  // masterpiece was indistinguishable from a competent Tuesday. Critics are not
  // calibrated, they are emphatic, and the score has to be able to say so.
  let score = CRITICAL_PIVOT + (craftsmanship - CRITICAL_PIVOT) * CRITICAL_GAIN;

  score += ANGLE_CRITICAL_BIAS[input.production.angle];

  // Creative exhaustion is the one thing critics never forgive.
  score -= reading.fatigue * 30;

  // Money on screen with nothing behind it. The expensive failure is a specific and
  // very recognisable kind of bad television, and it deserves its own penalty.
  if (reading.budgetRatio > 1.1 && reading.quality < 58) {
    score -= Math.min(9, (reading.budgetRatio - 1.1) * 14 + (58 - reading.quality) * 0.2);
  }
  // The mirror image: doing it well on nothing is the thing critics love most.
  if (reading.budgetRatio < 0.8 && reading.quality > 62) {
    score += 5;
  }
  // Inoffensive to everyone is its own failure mode — see APPEAL_EXPONENT in audience.ts.
  if (reading.focus < 0.05) {
    score -= 8;
  }

  // Critics disagree with each other. Small enough that the verdict still tracks the
  // work, large enough that one bad notice is not proof of anything.
  score += input.rng.normal(0, 4.5);

  return Math.round(clamp(score));
}

function praiseFor(input: ReviewInput, r: Reading): Diagnosis[] {
  const { production } = input;
  const attrs = production.attributes;
  const segmentName =
    AUDIENCE_SEGMENTS.find((s) => s.id === r.focusSegment)?.name ?? 'somebody';

  return [
    { weight: r.quality - 70, text: 'Confidently made, top to bottom.' },
    {
      weight: r.chemistry - 72,
      text: 'The cast play like they have known each other for years.',
    },
    { weight: r.craft - 66, text: 'The writing is genuinely sharp.' },
    {
      weight: production.angle === 'straight' ? 0 : (r.fit - 0.78) * 100,
      text: `The ${production.angle} treatment is exactly right for this material.`,
    },
    {
      weight: Math.min(attrs.prestige - 64, r.quality - 58),
      text: 'Ambitious, and it earns the ambition.',
    },
    {
      weight: Math.min((0.8 - r.budgetRatio) * 40, r.quality - 62),
      text: 'Punches far above what it evidently cost.',
    },
    {
      weight: production.season >= 4 ? (0.3 - r.fatigue) * 60 : 0,
      text: `Still finding new things to do in season ${production.season}.`,
    },
    {
      weight: Math.min(attrs.heart - 64, attrs.wholesomeness - 58, r.quality - 52),
      text: 'Warm without ever being soft.',
    },
    {
      weight: (r.focus - 0.18) * 120,
      text: `It knows precisely who it is for: ${segmentName}.`,
    },
    { weight: attrs.entertainment - 78, text: 'Enormously easy to watch.' },
    {
      weight: Math.min(attrs.humor - 72, r.craft - 55),
      text: 'The jokes land, which is rarer than it sounds.',
    },
  ];
}

function criticismFor(input: ReviewInput, r: Reading): Diagnosis[] {
  const { production } = input;
  const attrs = production.attributes;
  const comedy =
    production.format === 'sitcom' ||
    production.format === 'sketch' ||
    production.angle === 'comic';

  return [
    {
      weight: Math.min((r.budgetRatio - 1.1) * 40, 58 - r.quality),
      text: 'Thin scripts for the money on screen.',
    },
    { weight: 38 - r.funding, text: 'Made for too little, and every frame says so.' },
    { weight: 42 - r.chemistry, text: 'The cast have no spark together.' },
    { weight: (r.fatigue - 0.45) * 90, text: 'It has run out of road.' },
    { weight: 46 - r.craft, text: 'The room is not strong enough for the premise.' },
    {
      weight: production.angle === 'straight' ? 0 : (0.42 - r.fit) * 110,
      text: `The ${production.angle} treatment fights the material.`,
    },
    { weight: (0.04 - r.focus) * 300, text: 'Made for nobody in particular.' },
    {
      weight: Math.min(attrs.complexity - 66, 55 - r.craft),
      text: 'Reaches for a complexity it cannot stage.',
    },
    {
      weight: Math.min(r.peakStar - 76, 52 - r.craft),
      text: 'Cast for the names, not for the parts.',
    },
    {
      weight: Math.min(attrs.edginess - 70, 36 - attrs.prestige),
      text: 'Provocation with nothing behind it.',
    },
    {
      weight: (0.06 - r.marketingRatio) * 200,
      text: 'Nobody was told it was on.',
    },
    {
      weight: comedy ? 56 - attrs.humor : 0,
      text: 'A comedy desperately short of jokes.',
    },
    {
      weight: Math.min(attrs.violence - 72, 40 - attrs.heart),
      text: 'Cruelty standing in for stakes.',
    },
  ];
}

/**
 * Take the notes the critic actually leads with.
 *
 * Sorted by weight so the loudest problem is stated first — a review that opens with
 * the real fault is one the player can act on; a review that buries it is decoration.
 * Ties break by declaration order, which keeps the output deterministic.
 */
function topNotes(notes: Diagnosis[]): string[] {
  return notes
    .map((note, index) => ({ note, index }))
    .filter((entry) => entry.note.weight > 0)
    .sort((a, b) => b.note.weight - a.note.weight || a.index - b.index)
    .slice(0, MAX_NOTES)
    .map((entry) => entry.note.text);
}

const VERDICTS: Array<{ floor: number; lines: string[] }> = [
  { floor: 86, lines: ['A genuine achievement.', 'The rare thing that justifies the medium.'] },
  { floor: 74, lines: ['The best version of itself.', 'Confident, and entitled to be.'] },
  { floor: 62, lines: ['Good television, and it knows it.', 'Solid work with a real spine.'] },
  { floor: 48, lines: ['Watchable, and no more than that.', 'Perfectly fine. Nothing more.'] },
  { floor: 34, lines: ['Falls well short of its own premise.', 'It never becomes anything.'] },
  { floor: 20, lines: ['Hard to defend at any length.', 'A slog, and an expensive one.'] },
  { floor: 0, lines: ['A waste of everyone involved.', 'Nothing here works, at all.'] },
];

function verdictFor(score: number, rng: Rng): string {
  const band = VERDICTS.find((entry) => score >= entry.floor) ?? VERDICTS[VERDICTS.length - 1];
  return rng.pick(band.lines);
}

/**
 * File one season's notice.
 *
 * The order of RNG draws matters and must not be rearranged casually: score noise,
 * then outlet, then verdict. Reordering them changes every downstream roll in the
 * save, which is exactly the kind of silent replay divergence rng.ts exists to prevent.
 */
export function reviewSeason(input: ReviewInput): Review {
  const reading = read(input);
  const score = criticalScore(input, reading);
  const outlet = input.rng.pick(OUTLETS);
  const verdict = verdictFor(score, input.rng);

  const criticism = topNotes(criticismFor(input, reading));
  const praise = topNotes(praiseFor(input, reading));

  return {
    week: input.week,
    season: input.production.season,
    score,
    outlet,
    verdict,
    praise: praise.length > 0 ? praise : [fallbackPraise(score)],
    // A competent, adequately funded show with a decent cast trips none of the
    // diagnoses above, so a merely unremarkable programme came back with an empty
    // criticism list — which reads as "no notes" and is the opposite of the truth.
    // The player asked why a show is not doing well, and for most shows the honest
    // answer is not a fault but an absence. Say that instead of saying nothing.
    criticism: criticism.length > 0 ? criticism : [fallbackCriticism(score)],
  };
}

/** What to say when a show is bad in no particular way. */
function fallbackCriticism(score: number): string {
  if (score >= 72) return 'Hard to fault, harder still to love.';
  if (score >= 58) return 'Competent throughout, memorable nowhere.';
  if (score >= 44) return 'Nothing wrong with it. Nothing to it, either.';
  return 'It fails at nothing in particular, and at everything in general.';
}

/** And when it is good in no particular way. */
function fallbackPraise(score: number): string {
  if (score >= 72) return 'Everything about it is in working order.';
  if (score >= 50) return 'It turns up every week and does the job.';
  return 'The crew got it made on time.';
}

/** Append a notice, keeping only the most recent ones. Oldest press is the first cut. */
export function fileReview(production: Production, review: Review): void {
  production.reviews.push(review);
  if (production.reviews.length > MAX_REVIEWS) {
    production.reviews = production.reviews.slice(-MAX_REVIEWS);
  }
}

// ---------------------------------------------------------------------------
// Show tags — durable reputations
// ---------------------------------------------------------------------------

function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Share of a show's lifetime audience that came from a given set of segments, 0–1. */
function segmentShare(production: Production, segments: SegmentId[]): number {
  let target = 0;
  let total = 0;
  for (const season of production.history) {
    for (const segment of AUDIENCE_SEGMENTS) {
      const viewers = season.viewersBySegment?.[segment.id] ?? 0;
      total += viewers;
      if (segments.includes(segment.id)) target += viewers;
    }
  }
  return total > 0 ? target / total : 0;
}

/** Season-to-season swing in audience as a coefficient of variation. Low means dependable. */
function ratingsVolatility(production: Production): number {
  const seasons = production.history.map((season) => season.averageViewers);
  if (seasons.length < 3) return 1;
  const mean = averageOf(seasons);
  if (mean <= 0) return 1;
  const variance = averageOf(seasons.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) / mean;
}

function recentReviewAverage(production: Production, count: number): number {
  const recent = production.reviews.slice(-count);
  return recent.length === 0 ? 0 : averageOf(recent.map((review) => review.score));
}

/**
 * Which reputations a show has *just* earned, at the end of a season.
 *
 * Thresholds are set high on purpose. A tag is meant to be the thing people say about
 * a show for thirty years, so most shows should finish their run with none at all —
 * if half the slate is a cult classic then nothing is. Nothing here ever removes a
 * tag: a show that was formative for a generation does not stop having been that
 * because its last season was poor.
 */
export function earnedTags(production: Production, scandalHit: boolean): ShowTag[] {
  const seasons = production.history.length;
  if (seasons === 0) return [];

  const attrs = production.attributes;
  const viewers = production.history.map((season) => season.averageViewers);
  const lifetimeAverage = averageOf(viewers);
  const lastSeason = production.history[seasons - 1];
  const earned: ShowTag[] = [];

  const add = (tag: ShowTag, condition: boolean) => {
    if (condition && !production.tags.includes(tag) && !earned.includes(tag)) {
      earned.push(tag);
    }
  };

  // Loved by the few who found it. The ratings ceiling is the whole point — a hit
  // cannot be a cult classic no matter how good it is.
  add(
    'cult-classic',
    seasons >= 3 && lifetimeAverage <= 2.4 && recentReviewAverage(production, 3) >= 68,
  );

  // Sustained household viewing, not one lucky family season.
  add(
    'family-favourite',
    seasons >= 3 &&
      lifetimeAverage >= 2 &&
      segmentShare(production, ['families', 'kids']) >= 0.42,
  );

  // The show that is simply always on: long, dependable, and kind.
  add(
    'comfort-show',
    production.totalEpisodes >= 80 &&
      ratingsVolatility(production) < 0.16 &&
      attrs.wholesomeness + attrs.heart >= 115,
  );

  // What the next generation grew up on — needs volume as well as demographics.
  add(
    'formative',
    production.totalEpisodes >= 60 && segmentShare(production, ['kids', 'teens']) >= 0.4,
  );

  // Everybody watched it and everybody had to talk about it the next morning.
  add(
    'water-cooler',
    attrs.complexity >= 58 && production.buzz >= 45 && lastSeason.averageViewers >= 5,
  );

  // Sustained critical standing — one rave is not a reputation.
  add(
    'critical-darling',
    production.reviews.length >= 3 && recentReviewAverage(production, 3) >= 78,
  );

  // Indefensible and enormous. The most honest tag in the game.
  add(
    'guilty-pleasure',
    seasons >= 2 && recentReviewAverage(production, 3) <= 42 && lifetimeAverage >= 4,
  );

  // Trouble on screen and trouble off it. Needs both — edge alone is just a choice.
  add('notorious', scandalHit && attrs.violence + attrs.edginess >= 130);

  return earned;
}

/** Did anything actually blow up on this production? Read from the news, not invented. */
export function hadScandal(state: GameState, productionId: string): boolean {
  return state.events.some(
    (event) => event.kind === 'scandal' && event.productionId === productionId,
  );
}

/** Player-facing wording for a tag. The engine's kebab-case is not for reading. */
export const TAG_LABELS: Record<ShowTag, string> = {
  'cult-classic': 'a cult classic',
  'family-favourite': 'a family favourite',
  'comfort-show': 'comfort viewing',
  formative: 'formative television',
  'water-cooler': 'water-cooler television',
  'critical-darling': 'a critical darling',
  'guilty-pleasure': 'a guilty pleasure',
  notorious: 'notorious',
};

// ---------------------------------------------------------------------------
// Studio brand
// ---------------------------------------------------------------------------

/**
 * How much a show still says about you.
 *
 * Reputation is about what you are putting out now. A cancelled show does not vanish
 * from the public memory, but it stops defining you, so it keeps a third of its voice
 * and a long-running current hit dominates.
 */
const SLATE_RECENCY: Record<ProductionStatus, number> = {
  airing: 1,
  hiatus: 0.7,
  pilot: 0, // same as development — an unaired pilot is not public yet
  development: 0, // nothing has aired, so the public has seen nothing
  cancelled: 0.32,
  ended: 0.32,
};

/** Episodes past this stop adding voice — one enormous show should not be the whole brand. */
const EPISODE_VOICE_CAP = 120;

interface LabelRule {
  label: string;
  /** Margin above every threshold the label requires. Highest positive margin wins. */
  margin: (brand: Omit<StudioBrand, 'label'>) => number;
}

/**
 * The single phrase the public would use.
 *
 * Ordered so ties break toward the more specific reading, and scored by *margin*
 * rather than by a cascade of ifs: a studio that is barely prestigious and hugely
 * warm should read as comfort viewing, which a first-match-wins ladder gets wrong.
 */
const LABEL_RULES: LabelRule[] = [
  { label: 'Prestige House', margin: (b) => Math.min(b.prestige - 58, b.quality - 62) },
  { label: 'Serious Drama', margin: (b) => Math.min(b.prestige - 50, b.quality - 45) },
  { label: 'Family Channel', margin: (b) => Math.min(b.family - 56, 46 - b.edge) },
  { label: 'Comfort Viewing', margin: (b) => Math.min(b.warmth - 54, b.quality - 40) },
  { label: 'Trash TV', margin: (b) => Math.min(b.edge - 56, 44 - b.quality) },
  { label: 'Talked About', margin: (b) => Math.min(b.edge - 54, b.quality - 55) },
  { label: 'High Quality', margin: (b) => b.quality - 68 },
  { label: 'Tacky', margin: (b) => Math.min(46 - b.quality, 42 - b.prestige) },
];

function labelFor(axes: Omit<StudioBrand, 'label'>): string {
  let best = '';
  let bestMargin = 0;
  for (const rule of LABEL_RULES) {
    const margin = rule.margin(axes);
    if (margin > bestMargin) {
      bestMargin = margin;
      best = rule.label;
    }
  }
  // Nothing stands out — which is itself an accurate and slightly damning description.
  return best || 'Broad Appeal';
}

/**
 * Derive the studio's public identity from the shows it has actually aired.
 *
 * The player never picks this. You are what you broadcast, weighted by how much of it
 * there was and how recently — which means a studio can change what it is known for,
 * but only slowly and only by making different television for years.
 */
export function computeStudioBrand(state: GameState): StudioBrand {
  const studioId = state.player.studioId;

  let weightTotal = 0;
  let quality = 0;
  let family = 0;
  let prestige = 0;
  let edge = 0;
  let warmth = 0;

  for (const production of Object.values(state.productions)) {
    if (production.ownerId !== studioId && production.rightsOwnerId !== studioId) continue;
    if (production.totalEpisodes <= 0) continue;

    const weight =
      Math.min(production.totalEpisodes, EPISODE_VOICE_CAP) *
      (SLATE_RECENCY[production.status] ?? 0.32);
    if (weight <= 0) continue;

    const attrs = production.attributes;
    const appeal = appealProfile(attrs);
    const householdPull = (appeal.families + appeal.kids) * 100;
    const longevity = Math.min(production.totalEpisodes / EPISODE_VOICE_CAP, 1) * 100;
    const tags = production.tags;

    weightTotal += weight;
    quality += weight * clamp(production.quality + (tags.includes('guilty-pleasure') ? -8 : 0));
    family +=
      weight *
      clamp(
        0.5 * attrs.wholesomeness +
          0.28 * attrs.heart +
          0.22 * Math.min(householdPull, 100) +
          (tags.includes('family-favourite') ? 12 : 0),
      );
    prestige +=
      weight *
      clamp(
        0.65 * attrs.prestige +
          0.35 * attrs.complexity +
          (tags.includes('critical-darling') ? 10 : 0),
      );
    edge +=
      weight *
      clamp(0.55 * attrs.edginess + 0.45 * attrs.violence + (tags.includes('notorious') ? 14 : 0));
    warmth +=
      weight *
      clamp(
        0.48 * attrs.heart +
          0.24 * attrs.wholesomeness +
          0.28 * longevity +
          (tags.includes('comfort-show') ? 12 : 0),
      );
  }

  // Nothing has aired yet, so the public has no opinion. Saying so is more honest than
  // inventing a middling one and letting the pitch generator act on it.
  if (weightTotal <= 0) {
    return { quality: 50, family: 50, prestige: 50, edge: 50, warmth: 50, label: 'Unproven' };
  }

  const axes = {
    quality: Math.round(quality / weightTotal),
    family: Math.round(family / weightTotal),
    prestige: Math.round(prestige / weightTotal),
    edge: Math.round(edge / weightTotal),
    warmth: Math.round(warmth / weightTotal),
  };

  return { ...axes, label: labelFor(axes) };
}
