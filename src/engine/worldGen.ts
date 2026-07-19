import { SHOW_ARCHETYPES } from '../data';
import { clamp } from './rng';
import type { Rng } from './rng';
import type { Attributes, Format, ShowArchetype } from './types';
import { AXES, FORMATS } from './types';

/**
 * Procedural world generation — what television *exists* in this save.
 *
 * The catalogue used to be a static JSON file, which meant every playthrough shopped
 * from an identical menu at identical prices. Two saves could not diverge, the second
 * run had nothing left to discover, and "which show should I make?" had one correct
 * answer forever.
 *
 * So the concept catalogue is now generated per save, from the seed, in two parts:
 *
 *  - the 120 authored shows are a *pool to draw from*, not a fixture. Roughly two
 *    thirds appear in any given save, and the ones that do are perturbed — attributes
 *    jittered, budget renegotiated, episode order moved. The good writing survives;
 *    the certainty does not.
 *  - originals are generated to fill out the world, built from the authored pool's own
 *    per-format statistics so they sit alongside it rather than reading as filler.
 *
 * Everything here is a pure function of the RNG cursor it is handed, which is what
 * keeps `newGame({seed})` byte-identical across runs.
 */

// ---------------------------------------------------------------------------
// The cost ladder
// ---------------------------------------------------------------------------

/**
 * What a whole season of each format commits a studio to, low rung → top rung.
 *
 * Season cost, not per-episode cost, because a season is the thing you actually sign
 * up for: $180K an episode sounds cheap right up until you notice the order is 190
 * episodes. Pricing the ladder per-episode is what previously hid a $28M daytime strip
 * behind a reassuring sticker price.
 *
 * The bottom rung is the load-bearing part. A studio opens with $10M, so there has to
 * be television it can actually make and modestly profit from — a $1M documentary, a
 * cheap reality format — with the prestige rungs visible and genuinely unaffordable
 * until there is a library paying for them. `src/data/shows.json` was rebalanced onto
 * this same ladder, so authored and generated shows are priced by one rule.
 */
export const SEASON_COST_BAND: Record<Format, [number, number]> = {
  news: [1_800_000, 6_500_000],
  talkshow: [2_200_000, 9_000_000],
  gameshow: [1_900_000, 8_000_000],
  documentary: [1_000_000, 7_000_000],
  reality: [1_100_000, 8_500_000],
  kids: [1_600_000, 8_000_000],
  competition: [2_200_000, 14_000_000],
  sketch: [2_600_000, 12_000_000],
  soap: [5_000_000, 20_000_000],
  sitcom: [3_000_000, 45_000_000],
  animation: [4_000_000, 30_000_000],
  anthology: [8_000_000, 55_000_000],
  procedural: [8_000_000, 60_000_000],
  drama: [9_000_000, 130_000_000],
};

/** Later television is more expensive television. */
const ERA_FACTOR: Record<string, number> = {
  '1950s': 0.82,
  '1960s': 0.86,
  '1970s': 0.9,
  '1980s': 0.96,
  '1990s': 1.02,
  '2000s': 1.08,
  '2010s': 1.14,
  '2020s': 1.2,
};

const ERAS = Object.keys(ERA_FACTOR);

/** What makes a show expensive: seriousness, plot machinery, and spectacle. */
function ambitionOf(attributes: Attributes): number {
  return (
    0.45 * attributes.prestige + 0.3 * attributes.complexity + 0.25 * attributes.violence
  );
}

/**
 * Place a show on its format's ladder from its own attributes.
 *
 * `^1.7` skews each cohort toward its cheap end on purpose: most television is not
 * prestige television, and the expensive rung should be a handful of shows rather than
 * half the catalogue.
 */
function ladderCostPerEpisode(
  format: Format,
  attributes: Attributes,
  era: string,
  episodesPerSeason: number,
): number {
  const [lo, hi] = SEASON_COST_BAND[format];
  const t = clamp(ambitionOf(attributes) / 100, 0, 1);
  const seasonCost = lo * (hi / lo) ** t ** 1.7 * (ERA_FACTOR[era] ?? 1);
  return Math.max(500, Math.round(seasonCost / Math.max(1, episodesPerSeason)));
}

/**
 * How often each format turns up among generated originals.
 *
 * Weighted toward the cheap and unglamorous. A schedule is mostly talk, games,
 * reality and sitcoms with a few expensive dramas on top — and a world composed that
 * way is what makes a modest show read as a normal outcome rather than a failure.
 */
const FORMAT_FREQUENCY: Record<Format, number> = {
  reality: 13,
  sitcom: 13,
  drama: 11,
  documentary: 9,
  procedural: 8,
  competition: 7,
  gameshow: 7,
  kids: 6,
  talkshow: 5,
  animation: 4,
  sketch: 4,
  news: 3,
  soap: 3,
  anthology: 3,
};

// ---------------------------------------------------------------------------
// Title vocabulary
// ---------------------------------------------------------------------------

const PLACES = [
  'Ashgrove', 'Bellhaven', 'Cinder Row', 'Dunmore', 'Eastmarch', 'Fenwick Cross',
  'Gallowsgate', 'Harrow Point', 'Ivywood', 'Kestrel Bay', 'Larkspur', 'Maple Reach',
  'Northgate', 'Otterfield', 'Pinehollow', 'Quarry Hill', 'Redwater', 'Saltbridge',
  'Thistledown', 'Underbrook', 'Vantage Row', 'Westmoor', 'Yarrow Green', 'Ashenford',
  'Copper Creek', 'Drakemoor', 'Elmswick', 'Fairholt', 'Greyloch', 'Hazelmere',
];

const SURNAMES = [
  'Ardley', 'Balfour', 'Castellan', 'Draycott', 'Everly', 'Fairbourne', 'Grimsby',
  'Halloway', 'Ingram', 'Jessop', 'Kirkwood', 'Lambourne', 'Merrick', 'Norwood',
  'Ospry', 'Pemberton', 'Quill', 'Radcliffe', 'Sable', 'Thorne', 'Ulverton',
  'Vayne', 'Whitlock', 'Yardley', 'Ashcombe', 'Brackwater', 'Corvin', 'Dunhill',
];

const NOUNS = [
  'Bargain', 'Verdict', 'Inheritance', 'Reckoning', 'Appointment', 'Arrangement',
  'Understudy', 'Nightshift', 'Handover', 'Remainder', 'Long Weekend', 'Quiet Part',
  'Second Helping', 'Standing Order', 'Waiting Room', 'Lost Hour', 'Open Secret',
  'Short Straw', 'Last Round', 'Spare Room', 'Wrong Trousers', 'Slow Lane',
  'Home Straight', 'Near Thing', 'Fine Print', 'Small Print', 'Good Name',
];

const ADJECTIVES = [
  'Borrowed', 'Reluctant', 'Accidental', 'Unlikely', 'Restless', 'Careless',
  'Honourable', 'Terrible', 'Splendid', 'Quiet', 'Crooked', 'Golden', 'Bitter',
  'Gentle', 'Ruthless', 'Modest', 'Furious', 'Patient',
];

const OCCUPATIONS = [
  'Locksmith', 'Coroner', 'Auctioneer', 'Vicar', 'Fishmonger', 'Cartographer',
  'Undertaker', 'Bailiff', 'Sommelier', 'Taxidermist', 'Archivist', 'Bookbinder',
  'Cabbie', 'Ferryman', 'Glazier', 'Milliner', 'Nightporter', 'Watchmaker',
];

const ACTIVITIES = [
  'Bake', 'Build', 'Restore', 'Renovate', 'Sing', 'Dance', 'Sew', 'Forge',
  'Garden', 'Sculpt', 'Barter', 'Survive', 'Sail', 'Cook', 'Pitch',
];

/** Title shapes, per format. Generated shows should read like scheduled television. */
function generateTitle(rng: Rng, format: Format, used: Set<string>): string {
  const make = (): string => {
    switch (format) {
      case 'drama':
      case 'anthology':
        return rng.pick([
          `${rng.pick(PLACES)}`,
          `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`,
          `${rng.pick(SURNAMES)} & Sons`,
          `The ${rng.pick(SURNAMES)} ${rng.pick(['Inheritance', 'Affair', 'Papers', 'Estate'])}`,
        ]);
      case 'procedural':
        return rng.pick([
          `${rng.pick(PLACES)} ${rng.pick(['Division', 'Precinct', 'General', 'Nights', 'Response'])}`,
          `${rng.pick(SURNAMES)} & ${rng.pick(SURNAMES)}`,
          `The ${rng.pick(PLACES)} Files`,
        ]);
      case 'sitcom':
        return rng.pick([
          `${rng.pick(['Meet', 'Just', 'Only', 'Strictly'])} the ${rng.pick(SURNAMES)}s`,
          `${rng.pick(NOUNS)} for ${rng.pick(['One', 'Two', 'Three'])}`,
          `The ${rng.pick(ADJECTIVES)} ${rng.pick(OCCUPATIONS)}`,
          `${rng.pick(PLACES)} Mansions`,
        ]);
      case 'soap':
        return rng.pick([
          `${rng.pick(PLACES)}`,
          `${rng.pick(PLACES)} ${rng.pick(['Row', 'Crescent', 'Gardens', 'Terrace'])}`,
        ]);
      case 'reality':
        return rng.pick([
          `${rng.pick(ADJECTIVES)} ${rng.pick(['Neighbours', 'Weddings', 'Lives', 'Fortunes'])}`,
          `${rng.pick(['Life', 'Love', 'Trouble'])} at ${rng.pick(PLACES)}`,
          `${rng.pick(OCCUPATIONS)}s of ${rng.pick(PLACES)}`,
        ]);
      case 'competition':
        return rng.pick([
          `The Great ${rng.pick(PLACES)} ${rng.pick(ACTIVITIES)}-Off`,
          `${rng.pick(ACTIVITIES)} or ${rng.pick(['Go Home', 'Bust', 'Sink'])}`,
          `Last One ${rng.pick(['Standing', 'Sailing', 'Baking'])}`,
        ]);
      case 'gameshow':
        return rng.pick([
          `${rng.pick(['Name', 'Guess', 'Beat'])} That ${rng.pick(['Price', 'Tune', 'Face', 'Total'])}`,
          `${rng.pick(NOUNS)} or Nothing`,
          `The ${rng.pick(['Money', 'Prize', 'Jackpot'])} ${rng.pick(['Ladder', 'Wall', 'Round'])}`,
        ]);
      case 'talkshow':
        return rng.pick([
          `${rng.pick(['Mornings', 'Evenings', 'Late'])} with ${rng.pick(SURNAMES)}`,
          `The ${rng.pick(SURNAMES)} Hour`,
          `Sitting Down with ${rng.pick(SURNAMES)}`,
        ]);
      case 'news':
        return rng.pick([
          `The ${rng.pick(PLACES)} Report`,
          `${rng.pick(['Frontline', 'Dispatch', 'Bulletin', 'Newsdesk'])} ${rng.pick(['Tonight', 'at Six', 'Weekly'])}`,
        ]);
      case 'documentary':
        return rng.pick([
          `Inside ${rng.pick(PLACES)}`,
          `The ${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`,
          `${rng.pick(['Making', 'Breaking', 'Saving'])} ${rng.pick(PLACES)}`,
        ]);
      case 'animation':
        return rng.pick([
          `${rng.pick(SURNAMES)}!`,
          `The ${rng.pick(ADJECTIVES)} ${rng.pick(OCCUPATIONS)}`,
          `${rng.pick(PLACES)} Cadets`,
        ]);
      case 'kids':
        return rng.pick([
          `${rng.pick(PLACES)} Clubhouse`,
          `${rng.pick(ADJECTIVES)} ${rng.pick(['Friends', 'Adventures', 'Days'])}`,
          `Hello, ${rng.pick(PLACES)}!`,
        ]);
      case 'sketch':
        return rng.pick([
          `The ${rng.pick(PLACES)} Revue`,
          `${rng.pick(ADJECTIVES)} Business`,
          `Half an Hour with ${rng.pick(SURNAMES)}`,
        ]);
    }
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    const title = make();
    if (!used.has(title)) {
      used.add(title);
      return title;
    }
  }
  // Vocabulary exhausted for this shape — a numbered edition is how real formats cope.
  const fallback = `${make()} ${rng.int(2, 9)}`;
  used.add(fallback);
  return fallback;
}

const LOGLINE_SHAPES: Record<string, string[]> = {
  scripted: [
    'A {adj} {job} in {place} discovers the {noun} everyone agreed never to mention.',
    'Two families in {place} spend a generation arguing over {a-noun}.',
    'A {job} returns to {place} for a funeral and stays for {a-noun}.',
    'The staff of a failing {place} institution close ranks around {a-noun}.',
    'A {adj} {job} takes one last job in {place} and cannot put it down.',
  ],
  unscripted: [
    'Ordinary people in {place} compete for {a-noun} they may not want.',
    'Cameras follow the {job}s of {place} through their busiest season.',
    'Contestants tackle increasingly {adj} challenges for a share of the prize.',
    'A {adj} look inside {place}, where nothing runs on time.',
    'Every week, a new {job} opens their doors and their books.',
  ],
};

const UNSCRIPTED: ReadonlySet<Format> = new Set<Format>([
  'reality', 'competition', 'gameshow', 'talkshow', 'news', 'documentary',
]);

function generateLogline(rng: Rng, format: Format): string {
  const shape = rng.pick(LOGLINE_SHAPES[UNSCRIPTED.has(format) ? 'unscripted' : 'scripted']);
  const noun = rng.pick(NOUNS).toLowerCase();
  return shape
    .replace('{adj}', rng.pick(ADJECTIVES).toLowerCase())
    .replace('{job}', rng.pick(OCCUPATIONS).toLowerCase())
    .replace('{place}', rng.pick(PLACES))
    .replace('{a-noun}', `a ${noun}`)
    .replace('{noun}', noun);
}

// ---------------------------------------------------------------------------
// Format statistics, learned from the authored pool
// ---------------------------------------------------------------------------

interface FormatProfile {
  mean: Attributes;
  spread: Attributes;
  episodeOrders: number[];
  castSizes: number[];
  requiredRoles: string[][];
  genres: string[];
  tags: string[];
}

/**
 * Derive each format's shape from the authored shows rather than hand-writing 14
 * attribute tables.
 *
 * Generated originals then sit in the same region of show-space as the writing does —
 * a generated gameshow is recognisably a gameshow — and any future edit to the authored
 * pool pulls the generator along with it instead of silently disagreeing with it.
 */
function buildFormatProfiles(): Record<Format, FormatProfile> {
  const profiles = {} as Record<Format, FormatProfile>;

  for (const format of FORMATS) {
    const cohort = SHOW_ARCHETYPES.filter((show) => show.format === format);
    const mean = {} as Attributes;
    const spread = {} as Attributes;

    for (const axis of AXES) {
      if (cohort.length === 0) {
        mean[axis] = 50;
        spread[axis] = 15;
        continue;
      }
      const values = cohort.map((show) => show.attributes[axis]);
      const average = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance =
        values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length;
      mean[axis] = average;
      // A floor on spread: a format with one authored example must still vary.
      spread[axis] = Math.max(9, Math.sqrt(variance));
    }

    profiles[format] = {
      mean,
      spread,
      episodeOrders: cohort.length ? cohort.map((s) => s.episodesPerSeason) : [22],
      castSizes: cohort.length ? cohort.map((s) => s.castSize) : [4],
      requiredRoles: cohort.length ? cohort.map((s) => s.requiredRoles) : [['writer']],
      genres: cohort.length ? [...new Set(cohort.map((s) => s.genre))] : ['general'],
      tags: cohort.length ? [...new Set(cohort.flatMap((s) => s.tags))] : [],
    };
  }

  return profiles;
}

// Derived once from static data, so it is shared across saves without being per-save
// state. Every value here is a constant of the authored catalogue, not of any game.
const FORMAT_PROFILES = buildFormatProfiles();

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Namespace concept ids by seed.
 *
 * Two saves open at once — the app holding a game while a tool loads another, or the
 * test suite running several — must never collide on an id, or one save would silently
 * resolve the other's shows. Seeding the prefix makes ids globally unique per world
 * while staying reproducible for a given seed.
 */
function conceptIdPrefix(seed: number): string {
  return `w${(seed >>> 0).toString(36)}`;
}

export interface WorldGenOptions {
  /** Share of the authored catalogue that exists in this save. */
  authoredShare?: number;
  /** How many original concepts to invent. */
  originals?: number;
}

/**
 * Build the concept catalogue for one save.
 *
 * Returns a map keyed by concept id, ready to drop into `GameState.concepts`.
 */
export function generateConcepts(
  rng: Rng,
  seed: number,
  options: WorldGenOptions = {},
): Record<string, ShowArchetype> {
  const { authoredShare = 0.65, originals = 90 } = options;

  const prefix = conceptIdPrefix(seed);
  const concepts: Record<string, ShowArchetype> = {};
  const usedTitles = new Set<string>();

  // --- Authored shows, drawn and perturbed ---------------------------------
  for (const authored of SHOW_ARCHETYPES) {
    if (!rng.chance(authoredShare)) continue;

    const attributes = {} as Attributes;
    for (const axis of AXES) {
      attributes[axis] = clamp(Math.round(authored.attributes[axis] + rng.normal(0, 7)));
    }

    // Episode orders move the way real commissions do: a shortened run, a bumper
    // order, but never a 6-part drama becoming a 200-episode strip.
    const episodesPerSeason = Math.max(
      4,
      Math.round(authored.episodesPerSeason * rng.range(0.8, 1.25)),
    );

    // Price from the ladder, then let the negotiation land where it lands. Re-deriving
    // rather than scaling the authored figure means a perturbed show that came out
    // grittier and more complex genuinely costs more to make.
    const ladder = ladderCostPerEpisode(
      authored.format,
      attributes,
      authored.era,
      episodesPerSeason,
    );

    const id = `${prefix}-${authored.id}`;
    concepts[id] = {
      ...authored,
      id,
      attributes,
      episodesPerSeason,
      baseCostPerEpisode: Math.max(500, Math.round(ladder * rng.range(0.78, 1.3))),
      castSize: Math.max(1, authored.castSize + rng.int(-1, 1)),
    };
    usedTitles.add(authored.title);
  }

  // --- Originals -----------------------------------------------------------
  for (let i = 0; i < originals; i++) {
    const format = rng.weighted(FORMATS, (f) => FORMAT_FREQUENCY[f]);
    const profile = FORMAT_PROFILES[format];

    /*
     * How far this concept sits from the middle of its format.
     *
     * Generating everything at the cohort mean produced a world where every show was
     * averagely appealing to everybody, and the ratings distribution collapsed into a
     * narrow band — there was no such thing as a niche show, so there was no such
     * thing as a modest one either. Most television is broad, but the tail matters:
     * these are the shows that only one segment loves, and they are what makes a few
     * hundred thousand viewers a real and legible outcome.
     */
    const eccentricity = rng.chance(0.3) ? rng.range(1.5, 2.4) : rng.range(0.8, 1.3);

    const attributes = {} as Attributes;
    for (const axis of AXES) {
      attributes[axis] = clamp(
        Math.round(rng.normal(profile.mean[axis], profile.spread[axis] * eccentricity)),
      );
    }

    const episodesPerSeason = Math.max(
      4,
      Math.round(rng.pick(profile.episodeOrders) * rng.range(0.85, 1.2)),
    );
    const era = rng.pick(ERAS);
    const ladder = ladderCostPerEpisode(format, attributes, era, episodesPerSeason);

    const id = `${prefix}-o${i.toString(36)}`;
    concepts[id] = {
      id,
      title: generateTitle(rng, format, usedTitles),
      format,
      genre: rng.pick(profile.genres),
      logline: generateLogline(rng, format),
      era,
      attributes,
      baseCostPerEpisode: Math.max(500, Math.round(ladder * rng.range(0.8, 1.25))),
      episodesPerSeason,
      castSize: Math.max(1, rng.pick(profile.castSizes) + rng.int(-1, 1)),
      requiredRoles: [...rng.pick(profile.requiredRoles)],
      tags: profile.tags.length ? rng.shuffle(profile.tags).slice(0, rng.int(1, 3)) : [],
    };
  }

  return concepts;
}
