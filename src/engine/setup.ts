import { getArchetype, registerConcepts } from '../data';
import { potentialAudience, totalViewers } from './audience';
import { licenseFee } from './economy';
import { createProduction } from './production';
import { seasonFatigueIncrement } from './ratings';
import { clamp, createRng } from './rng';
import type { Rng } from './rng';
import { allSlotKeys, emptySchedule } from './schedule';
import { padTalentPool, toTalentState, varyAuthoredTalent } from './talentGen';
import { generateConcepts } from './worldGen';
import { TALENT_RECORDS } from '../data';
import type {
  Company,
  GameState,
  Production,
  RivalPersonality,
  SeasonRecord,
  SegmentId,
  ShowArchetype,
  TalentState,
} from './types';

/**
 * World creation.
 *
 * The industry exists before the player does. When a new game starts there are
 * already four networks with full-ish schedules, rival studios with libraries, and
 * shows midway through their fourth season. The player is a newcomer walking into a
 * business that has been running for decades — which is the correct emotional
 * starting position for this game.
 */

const RIVAL_STUDIO_NAMES: Array<[string, RivalPersonality]> = [
  ['Meridian Pictures', 'prestige-chaser'],
  ['Halcyon Television', 'balanced'],
  ['Brightline Studios', 'populist'],
  ['Ironwood Media', 'copycat'],
  ['Copperfield Entertainment', 'populist'],
  ['Saltmarsh Productions', 'prestige-chaser'],
];

const NETWORK_SEEDS: Array<{
  name: string;
  reach: number;
  cash: number;
  personality: RivalPersonality;
}> = [
  { name: 'Apex Broadcasting', reach: 0.95, cash: 900_000_000, personality: 'populist' },
  { name: 'Continental Network', reach: 0.92, cash: 780_000_000, personality: 'balanced' },
  { name: 'Vantage Television', reach: 0.84, cash: 520_000_000, personality: 'prestige-chaser' },
  { name: 'Northstar Channel', reach: 0.71, cash: 310_000_000, personality: 'copycat' },
];

const STREAMER_SEEDS: Array<{
  name: string;
  subscribers: number;
  price: number;
  cash: number;
  personality: RivalPersonality;
}> = [
  { name: 'Orbit', subscribers: 48, price: 15.99, cash: 1_400_000_000, personality: 'disruptor' },
  { name: 'Streamline+', subscribers: 26, price: 11.99, cash: 620_000_000, personality: 'prestige-chaser' },
];

/** How much of each network's grid is already occupied at world creation. */
const INITIAL_FILL_RATE = 0.72;

export interface NewGameOptions {
  seed?: number;
  studioName?: string;
  startingCash?: number;
  startYear?: number;
}

export function newGame(options: NewGameOptions = {}): GameState {
  const {
    seed = 1,
    studioName = 'Fledgling Pictures',
    /**
     * Enough runway to carry a show to the syndication threshold.
     *
     * Sized against the real arithmetic rather than picked for feel: a cheap sitcom
     * runs a deficit of roughly $12M a season, three seasons is the threshold, and
     * studio overhead adds ~$6M a year. At $50M the player went broke before any
     * show could ever reach the back end, which made the whole progression loop
     * unreachable — the game's central mechanic was mathematically out of reach.
     */
    // $10M, not $120M. The old figure meant the first real decision — what can I
    // actually afford to make? — never had to be asked: you could greenlight anything
    // on the table and still not notice the money. Starting small forces the early
    // game to be about cheap formats that reach repeats fast, which is the actual
    // studio business, and makes the first hit feel like it changed something.
    // There is no upfront commissioning cost, so this funds a real slate: you pay the
    // deficit per episode as it airs, against the licence fee.
    startingCash = 10_000_000,
    startYear = 1,
  } = options;

  const rng = createRng(seed);
  let idCounter = 0;
  const mintId = (prefix: string) => `${prefix}_${(idCounter++).toString(36)}`;

  // --- The catalogue ------------------------------------------------------
  // What television exists at all is decided here, from the seed, before anything is
  // cast or scheduled — so two saves are different worlds rather than the same world
  // with different dice. See worldGen.ts.
  const concepts = generateConcepts(rng, seed);
  registerConcepts(concepts);
  const conceptPool = Object.values(concepts);

  // --- Talent -------------------------------------------------------------
  const talent: Record<string, TalentState> = {};
  for (const record of TALENT_RECORDS) {
    // The authored people are the memorable ones and keep their names, but a star who
    // is identically gifted, identically priced and identically reliable in every save
    // is a lookup table rather than a character. Their numbers move per world.
    talent[record.id] = toTalentState(varyAuthoredTalent(record, rng));
  }

  // An industry this size needs far more working professionals than the authored
  // list holds — see talentGen.ts.
  /*
   * Host and producer counts were raised when the cost ladder was rebuilt.
   *
   * The catalogue is now deliberately weighted toward cheap unscripted formats — talk,
   * games, reality — so the industry needs far more hosts than the 40 that were enough
   * when the world was mostly drama. Worse than the headcount was the shape: a role
   * with only 40 people has almost no low-fame tail, and pay follows fame steeply, so
   * *every free host in the world* was priced above what a $10K-an-episode strip could
   * pay and the cheapest formats went to air with nobody presenting them.
   *
   * A bigger pool is what gives the bottom of the ladder a labour market rather than
   * just a price list.
   */
  /*
   * These are *minimum pool sizes*, not headcounts of working people — the opening
   * world immediately binds most of them to the shows already on air.
   *
   * At 400 actors the industry went to air with **nine** unattached actors in it. The
   * player's first show could just about be cast and nothing after it could, which no
   * check caught because staffing used to ignore budgets and simply take whoever was
   * nearest. Sizing the pool against the opening slate — roughly sixty productions,
   * most of them scripted — is what leaves a genuine casting market behind once the
   * world has helped itself.
   */
  padTalentPool(talent, rng, mintId, {
    actor: 900,
    writer: 320,
    showrunner: 140,
    producer: 90,
    director: 140,
    host: 150,
  });

  // --- Companies ----------------------------------------------------------
  const companies: Record<string, Company> = {};

  const playerStudio: Company = {
    id: mintId('co'),
    name: studioName,
    type: 'studio',
    isPlayer: true,
    personality: 'balanced',
    cash: startingCash,
    debt: 0,
    criticalStanding: 20,
    popularStanding: 12,
  };
  companies[playerStudio.id] = playerStudio;

  const rivalStudios: Company[] = RIVAL_STUDIO_NAMES.map(([name, personality]) => {
    const company: Company = {
      id: mintId('co'),
      name,
      type: 'studio',
      isPlayer: false,
      personality,
      cash: rng.range(80_000_000, 400_000_000),
      debt: 0,
      criticalStanding: clamp(rng.normal(personality === 'prestige-chaser' ? 68 : 45, 12)),
      popularStanding: clamp(rng.normal(personality === 'populist' ? 68 : 48, 12)),
    };
    companies[company.id] = company;
    return company;
  });

  const networks: Company[] = NETWORK_SEEDS.map((seed) => {
    const company: Company = {
      id: mintId('co'),
      name: seed.name,
      type: 'network',
      isPlayer: false,
      personality: seed.personality,
      cash: seed.cash,
      debt: 0,
      criticalStanding: clamp(rng.normal(50, 12)),
      popularStanding: clamp(rng.normal(62, 12)),
      reach: seed.reach,
      schedule: emptySchedule(),
    };
    companies[company.id] = company;
    return company;
  });

  const streamers: Company[] = STREAMER_SEEDS.map((seed) => {
    const company: Company = {
      id: mintId('co'),
      name: seed.name,
      type: 'streamer',
      isPlayer: false,
      personality: seed.personality,
      cash: seed.cash,
      debt: 0,
      criticalStanding: clamp(rng.normal(58, 10)),
      popularStanding: clamp(rng.normal(55, 10)),
      subscribers: seed.subscribers,
      monthlyPrice: seed.price,
    };
    companies[company.id] = company;
    return company;
  });

  // --- Existing shows -----------------------------------------------------
  const productions: Record<string, Production> = {};
  const usedArchetypes = new Set<string>();

  for (const network of networks) {
    const slots = rng.shuffle(allSlotKeys());
    const fillCount = Math.round(slots.length * INITIAL_FILL_RATE);

    for (let i = 0; i < fillCount; i++) {
      const key = slots[i];

      const available: ShowArchetype[] = conceptPool.filter(
        (a) => !usedArchetypes.has(a.id),
      );
      if (available.length === 0) break;

      // Prime time is where the money is: networks put their expensive shows in these
      // slots, so weighting by cost keeps the cheap end of the catalogue available for
      // the player rather than having it all pre-spent on the opening grid.
      const archetype = rng.weighted(available, (a) =>
        Math.sqrt(a.baseCostPerEpisode * a.episodesPerSeason),
      );
      usedArchetypes.add(archetype.id);

      // Networks air a mix of in-house and licensed-from-studio programming.
      const owner = rng.chance(0.35) ? network : rng.pick(rivalStudios);

      const production = createProduction(archetype, talent, rng, mintId, {
        ownerId: owner.id,
        budgetMultiplier: rng.range(0.85, 1.15),
        ambition: clamp(rng.normal(0.5, 0.2), 0.05, 0.95),
      });

      // Give the show a plausible past so the world does not feel newly booted.
      const seasonsRun = rng.weighted([1, 1, 2, 2, 3, 4, 5, 7], (n) => 8 - n);
      backfillHistory(production, archetype.id, seasonsRun, rng);

      production.status = 'airing';
      production.episodesAiredThisSeason = rng.int(0, production.episodesPerSeason - 1);
      production.deal = {
        networkId: network.id,
        slotKey: key,
        licenseFeePerEpisode: licenseFee(
          archetype,
          rng.range(0.4, 0.9),
          Math.max(0, seasonsRun - 1),
        ),
        seasonsRemaining: rng.int(1, 3),
      };

      productions[production.id] = production;
      network.schedule![key] = production.id;
    }
  }

  /**
   * What the bank will lend a studio with no track record.
   *
   * Twice opening cash: enough that deficit-financing a first show is genuinely
   * possible, tight enough that a second expensive commission before the first pays
   * back is a decision rather than a formality. The limit is re-assessed as the studio
   * builds a library — see the bank module.
   */
  function openingFacility(cash: number) {
    return { creditLimit: Math.round(cash * 2), warnings: 0 };
  }

  const state: GameState = {
    rngState: rng.state(),
    seed,
    year: startYear,
    week: 1,
    absoluteWeek: 0,
    player: { studioId: playerStudio.id },
    companies,
    productions,
    talent,
    concepts,
    pitches: [],
    offers: [],
    events: [],
    bank: openingFacility(playerStudio.cash),
    nextId: idCounter,
  };

  return state;
}

/**
 * Invent a past for a show that is already on air when the game begins.
 *
 * The numbers are estimated from the show's own appeal rather than pulled from thin
 * air, so a show's history is consistent with what the ratings model would actually
 * have produced for it. A show that looks like a modest performer has modest
 * history, and the player can read the trend and trust it.
 */
function backfillHistory(
  production: Production,
  archetypeId: string,
  seasons: number,
  rng: Rng,
): void {
  const archetype = getArchetype(archetypeId);
  const potential = potentialAudience(production.attributes);
  const ceiling = totalViewers(potential);

  for (let season = 1; season <= seasons; season++) {
    // Shows peak in seasons 2–3, then decay.
    const arc = season === 1 ? 0.72 : season <= 3 ? 1 : Math.max(0.45, 1 - (season - 3) * 0.11);
    const realised = ceiling * 0.28 * arc * rng.range(0.75, 1.25);

    const viewersBySegment = {} as Record<SegmentId, number>;
    const scale = ceiling > 0 ? realised / ceiling : 0;
    for (const key of Object.keys(potential) as SegmentId[]) {
      viewersBySegment[key] = potential[key] * scale;
    }

    const record: SeasonRecord = {
      season,
      episodes: production.episodesPerSeason,
      averageViewers: realised,
      averageQuality: production.quality,
      viewersBySegment,
      studioProfit: 0,
      networkProfit: 0,
    };

    production.history.push(record);
    production.totalEpisodes += production.episodesPerSeason;
    production.fatigue = Math.min(
      0.75,
      production.fatigue + seasonFatigueIncrement(production, archetype),
    );
  }

  production.season = seasons + 1;
  production.buzz = clamp(rng.range(10, 45));
  // Long-running shows may already have cleared the syndication threshold.
  production.syndicated = production.totalEpisodes >= 65 && rng.chance(0.8);
}
