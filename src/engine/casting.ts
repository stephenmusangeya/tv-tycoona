import { clamp, createRng } from './rng';
import type { Rng } from './rng';
import { generateTalent, toTalentState } from './talentGen';
import type {
  GameEvent,
  GameEventKind,
  GameState,
  TalentRole,
  TalentState,
} from './types';

/**
 * The casting department.
 *
 * The rolodex used to be the whole of casting: every free agent in the world, already
 * sorted, waiting to be read. Nothing was ever discovered, so there was no reason to
 * spend a penny on the people-finding side of a studio — the good unknowns were as
 * visible as the stars, and finding one was a scrolling exercise.
 *
 * A casting director changes what exists rather than what is shown. The people they
 * turn up are not in the world until they find them: they were teaching, waiting
 * tables, doing panto in Scarborough, and nobody — not you, not your rivals — had a
 * card on them. That is the only honest way to build the fantasy the department is
 * for, which is signing someone brilliant before the industry has a price for them.
 *
 * The bargain: a real weekly bill against an irregular, unpromised payoff. A good
 * director finds more people and finds better ones, but never on a schedule, so the
 * decision is whether you believe in scouting rather than whether you can afford a
 * known return.
 *
 * Determinism: discovery draws from the seeded tick RNG, in a fixed order, and only
 * when a director is actually employed — a studio with no casting department consumes
 * nothing, so adding the department cannot shift anyone else's stream. The hiring
 * shortlist is derived from a hash of (seed, market window) through a private RNG, so
 * the UI can ask for it on every frame without touching the shared cursor.
 */

// ---------------------------------------------------------------------------
// Result — mirrors actions.ts and staff.ts so these re-export as player actions.
// ---------------------------------------------------------------------------

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CastingDirector {
  id: string;
  name: string;
  /** 0–100. Drives how often they find anyone, and how good the finds are. */
  quality: number;
  /** What the agency charges for them, every week, forever. */
  feePerWeek: number;
  /** Their line before you hired them — flavour, but it sells the quality number. */
  reputation: string;
  /** Absolute week they came on. */
  hiredWeek: number;
  weeksEmployed: number;
}

/** One person the department turned up, kept so the find can be read back later. */
export interface CastingFind {
  talentId: string;
  name: string;
  role: TalentRole;
  /** Absolute week, plus the display year, so the office can date the file. */
  week: number;
  year: number;
  directorName: string;
  /** Where they were found. The sentence that makes a row read as a discovery. */
  provenance: string;
  /** True for the finds worth the department: real craft, no name, no price. */
  gem: boolean;
}

export interface CastingState {
  director?: CastingDirector;
  /** All-time, newest last, capped. Survives changing directors. */
  finds: CastingFind[];
  /** Absolute week of the last discovery — paces the department. */
  lastFindWeek?: number;
  /** Everything the department has ever cost, so the payoff can be judged. */
  spent: number;
}

/**
 * Where this lives.
 *
 * `GameState` does not declare `casting`: types.ts is owned elsewhere while this
 * lands, so the department carries its own slice through a widened view of the state.
 * It is plain JSON like every other field, so it saves, loads and migrates unchanged —
 * promoting the property onto `GameState` later changes only this alias.
 */
type CastingHost = GameState & { casting?: CastingState };

/** The empty department. Shared and frozen: readers must never mutate on a read. */
const NO_CASTING: CastingState = Object.freeze({ finds: [], spent: 0 });

/**
 * Read the department without creating it.
 *
 * The UI calls this during render, so it has to be pure — a lazy initialiser here
 * would mutate game state from inside a component and desync the store's revision.
 */
export function readCasting(state: GameState): CastingState {
  return (state as CastingHost).casting ?? NO_CASTING;
}

/** Read-write access. Only hiring and the weekly tick are allowed to call this. */
function ensureCasting(state: GameState): CastingState {
  const host = state as CastingHost;
  host.casting ??= { finds: [], spent: 0 };
  // An older save could carry a half-written slice; the tick appends to `finds`, so a
  // missing array is a crash rather than a cosmetic gap.
  if (!Array.isArray(host.casting.finds)) host.casting.finds = [];
  if (typeof host.casting.spent !== 'number') host.casting.spent = 0;
  return host.casting;
}

// ---------------------------------------------------------------------------
// Tunables — the whole department's balance in one block.
// ---------------------------------------------------------------------------

export const CASTING = {
  /**
   * The weekly fee, before quality.
   *
   * Sized under a staff writer's $9K retainer on purpose: a casting director makes
   * nothing, so they should never read as the most expensive person in the building.
   * A good one still lands near $17K/week — about an eighth of studio overhead, which
   * is enough that an empty month of scouting is felt.
   */
  baseFeePerWeek: 6_000,
  feePerQuality: 125,

  /** Names on offer at any one time, and how long that shortlist stands. */
  shortlistSize: 3,
  shortlistWeeks: 26,

  /**
   * Odds of a find in any given week.
   *
   * At the bottom of the market that is roughly one person a quarter; at the top,
   * one every five weeks. Deliberately irregular — a department that delivered on a
   * schedule would be a subscription, and the player would stop reading the in-tray.
   */
  findChanceBase: 0.05,
  findChancePerQuality: 0.18,

  /** Finds cannot clump. Three weeks of nothing is part of what you are buying. */
  minWeeksBetweenFinds: 3,

  /**
   * Odds a find is the one you pay the department for: high craft, no fame, no price.
   *
   * Multiplied through the find rate this is about one gem a year from a journeyman
   * scout and one every other season from the best in the business — rare enough that
   * it still reads as luck, frequent enough to be a strategy.
   */
  gemChanceBase: 0.1,
  gemChancePerQuality: 0.35,

  /** Odds a find is an overlooked veteran rather than a young unknown. */
  veteranShare: 0.35,

  /** A veteran knows roughly what they are worth. Still cheap, just not free. */
  veteranFeeMultiplier: 1.6,

  /** How much cover the studio needs before the agency will place anyone. */
  requiredWeeksOfCover: 4,

  /** Files kept in the office. Older finds are not worth the save-file bytes. */
  maxFindsKept: 40,
} as const;

/**
 * What the department goes looking for.
 *
 * Weighted toward the roles a studio burns through — you are always short of writers
 * and always short of faces — so the finds accumulate into a bench rather than six
 * showrunners nobody has a chair for.
 */
const SCOUTED_ROLES: Array<[TalentRole, number]> = [
  ['actor', 3.2],
  ['writer', 2.4],
  ['director', 1.2],
  ['host', 1.0],
  ['producer', 0.9],
  ['showrunner', 0.7],
];

// ---------------------------------------------------------------------------
// Flavour
// ---------------------------------------------------------------------------

const DIRECTOR_FIRST = [
  'Beatrix', 'Cormac', 'Delphine', 'Emeka', 'Freya', 'Gustav', 'Hester', 'Ilse',
  'Jonquil', 'Kester', 'Lorna', 'Mirembe', 'Norah', 'Ottoline', 'Pascal', 'Rosalind',
  'Sylvie', 'Thaddeus', 'Ulrike', 'Verity', 'Wilhelmina', 'Yolanda',
];

const DIRECTOR_LAST = [
  'Ashby', 'Bellweather', 'Coltrane', 'Delacroix', 'Ellingham', 'Fitzhugh',
  'Grimaldi', 'Havelock', 'Ivarsson', 'Kowalczyk', 'Lindqvist', 'Mbatha',
  'Nightingale', 'Oyelaran', 'Prendergast', 'Quiller', 'Rackham', 'Stroud',
  'Tewkesbury', 'Vasilenko', 'Wickersham', 'Yarborough',
];

/** How the trade talks about them. Indexed by quality band, low to high. */
const REPUTATIONS = [
  'Two years in the job. Keen, and cheap for a reason.',
  'Works the drama schools. Knows every agent under forty.',
  'Sits at the back of fringe theatres taking notes nobody else takes.',
  'Cast three shows you have heard of before anyone had heard of them.',
  'Has not been wrong about a face in a decade.',
];

/** Where a young unknown turns up. Specific on purpose — a place, not a category. */
const NEWCOMER_PROVENANCE = [
  'in a fifty-seat theatre above a pub',
  'on a student film nobody finished',
  'reading the traffic on regional radio',
  'in the chorus of a touring musical',
  'at a comedy night in a hotel function room',
  'presenting a shopping channel at four in the morning',
  'in an insurance advert, for nine seconds',
  'running a drama workshop for the council',
  'in a wedding video the department was shown by mistake',
  'on a demo tape sent to the wrong address',
];

/** And where a career that stalled is found again. */
const VETERAN_PROVENANCE = [
  'after eleven years of uncredited rewrites',
  'teaching at a drama school in the north',
  'directing regional theatre since the soap ended',
  'in the second unit on other people’s films',
  'writing continuity for a shopping channel',
  'after a decade nobody in this town returned a call',
  'script-editing a daytime serial into its ninth year',
  'running a repertory company out of a converted chapel',
];

// ---------------------------------------------------------------------------
// The hiring shortlist — derived, never stored, never touches the shared cursor
// ---------------------------------------------------------------------------

/** FNV-1a. Cheap, well-mixed, and stable across platforms — which is the requirement. */
function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    }
    // Separator, so ('ab', 'c') and ('a', 'bc') do not collide.
    h = Math.imul(h ^ 0x5f, 0x01000193);
  }
  return h >>> 0;
}

/** Which half-year of hiring we are in. The shortlist stands for exactly one. */
function marketWindow(state: GameState): number {
  return Math.floor(state.absoluteWeek / CASTING.shortlistWeeks);
}

/**
 * Who the agency has on its books this half-year.
 *
 * Derived from a hash rather than stored, so it costs nothing to save and the UI can
 * ask for it on every render. It rolls over twice a year: the names you passed on are
 * gone, which is what stops the shortlist being a permanent menu.
 */
export function castingShortlist(state: GameState): CastingDirector[] {
  const window = marketWindow(state);
  const out: CastingDirector[] = [];

  for (let i = 0; i < CASTING.shortlistSize; i++) {
    const rng = createRng(hashSeed('casting-director', state.seed, window, i));

    // Skewed low, with a long tail: most of the market is competent, and the person
    // worth paying for is genuinely uncommon rather than one slot in three.
    const quality = Math.round(clamp(rng.normal(46, 19), 12, 94));

    out.push({
      id: `cd_${state.seed}_${window}_${i}`,
      name: `${rng.pick(DIRECTOR_FIRST)} ${rng.pick(DIRECTOR_LAST)}`,
      quality,
      feePerWeek: feeFor(quality),
      reputation: REPUTATIONS[Math.min(REPUTATIONS.length - 1, Math.floor(quality / 20))],
      hiredWeek: 0,
      weeksEmployed: 0,
    });
  }

  // Best first: the price difference is the decision, so it should be read top-down.
  return out.sort((a, b) => b.quality - a.quality);
}

export function feeFor(quality: number): number {
  return Math.round(CASTING.baseFeePerWeek + quality * CASTING.feePerQuality);
}

/** The department's weekly bill. Zero when nobody is employed. */
export function weeklyCastingCost(state: GameState): number {
  return readCasting(state).director?.feePerWeek ?? 0;
}

/** Expected weeks between finds at this quality — the honest version of the pitch. */
export function weeksPerFind(quality: number): number {
  const chance = CASTING.findChanceBase + (quality / 100) * CASTING.findChancePerQuality;
  return Math.round(1 / chance + CASTING.minWeeksBetweenFinds * chance);
}

// ---------------------------------------------------------------------------
// Hiring and firing
// ---------------------------------------------------------------------------

/**
 * Put a casting director on the books.
 *
 * Charges nothing up front, like every other staff deal — the whole cost is the weekly
 * one. The month-of-cover gate is the same paternalism `hireToPayroll` applies, for the
 * same reason: hiring a scout you cannot pay past Christmas is never the decision the
 * player meant to make.
 */
export function hireCastingDirector(state: GameState, directorId: string): Result<CastingDirector> {
  const studio = state.companies[state.player.studioId];
  if (!studio) return fail('No studio.');

  const casting = readCasting(state);
  if (casting.director) {
    return fail(`${casting.director.name} already runs your casting department.`);
  }

  const candidate = castingShortlist(state).find((c) => c.id === directorId);
  if (!candidate) return fail('That name is no longer on the agency’s books.');

  if (studio.cash < candidate.feePerWeek * CASTING.requiredWeeksOfCover) {
    return fail(
      `You cannot cover a month of ${candidate.name}’s fee. They cost ${weekly(candidate.feePerWeek)}.`,
    );
  }

  const hired: CastingDirector = {
    ...candidate,
    hiredWeek: state.absoluteWeek,
    weeksEmployed: 0,
  };
  ensureCasting(state).director = hired;

  return ok(hired);
}

/**
 * Let the casting director go.
 *
 * Nothing is clawed back: the people they found stay found, and stay in the world for
 * anyone to sign. That is the whole shape of the investment — you paid for access to
 * names, not for the names themselves, and the moment you stop paying you stop being
 * the only studio with a card on the next one.
 */
export function dismissCastingDirector(state: GameState): Result<CastingDirector> {
  const casting = readCasting(state);
  const director = casting.director;
  if (!director) return fail('You do not have a casting director.');

  ensureCasting(state).director = undefined;
  return ok(director);
}

// ---------------------------------------------------------------------------
// The weekly hook
// ---------------------------------------------------------------------------

/**
 * One week of running a casting department.
 *
 * Call once per week from the tick, alongside `tickStaff` and before `applyOverheads`,
 * so a fee the studio cannot cover becomes debt in the same week rather than leaving
 * cash visibly negative until the next one.
 *
 * The early return matters more than anything below it: with no director employed this
 * function draws nothing from `rng`, so a studio that never opens a casting department
 * gets byte-identical results to one built before the department existed.
 */
export function tickCasting(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const director = readCasting(state).director;
  if (!director) return;

  const studio = state.companies[state.player.studioId];
  if (!studio) return;

  const casting = ensureCasting(state);
  studio.cash -= director.feePerWeek;
  casting.spent += director.feePerWeek;
  director.weeksEmployed += 1;

  // A scout who has just turned somebody up is not out looking this week.
  const since = state.absoluteWeek - (casting.lastFindWeek ?? -Infinity);
  if (since < CASTING.minWeeksBetweenFinds) return;

  const chance =
    CASTING.findChanceBase + (director.quality / 100) * CASTING.findChancePerQuality;
  if (!rng.chance(chance)) return;

  discover(state, casting, director, rng, mintId, emit);
}

/**
 * Turn somebody up.
 *
 * Every find is cheap and unknown — that is what being undiscovered means, and it is
 * why the department pays for itself at all. What the director's quality buys is
 * craft: how good the person actually is behind the absent CV.
 */
function discover(
  state: GameState,
  casting: CastingState,
  director: CastingDirector,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const role = rng.weighted(SCOUTED_ROLES, ([, weight]) => weight)[0];
  const gem = rng.chance(
    CASTING.gemChanceBase + (director.quality / 100) * CASTING.gemChancePerQuality,
  );
  const veteran = rng.chance(CASTING.veteranShare);

  // The newcomer profile is the right baseline for everyone the department finds: it
  // is already the cheap end of the salary band, which is precisely the bargain being
  // bought. Craft, age and story are then rewritten below.
  const usedNames = new Set(Object.values(state.talent).map((p) => p.name));
  const record = generateTalent(rng, usedNames, mintId, { role, newcomer: true });
  const person = toTalentState(record);

  person.craft = gem
    ? clamp(rng.normal(70 + director.quality * 0.22, 8), 60, 95)
    : clamp(rng.normal(42 + director.quality * 0.2, 12), 18, 78);

  // Fame is the one thing nobody found has. Without this a "discovery" could arrive
  // already priced, and the fantasy of being first would quietly stop working.
  person.starPower = clamp(rng.normal(9, 5), 1, 26);
  person.heat = Math.round(person.starPower * 0.5);

  const provenance = veteran
    ? rng.pick(VETERAN_PROVENANCE)
    : rng.pick(NEWCOMER_PROVENANCE);

  if (veteran) {
    // A career that stalled rather than one that has not started. Same absent fame,
    // same low price, but the craft was earned somewhere the industry stopped looking.
    person.age = rng.int(38, 61);
    person.reliability = clamp(person.reliability + 8);
    person.baseSalaryPerEpisode = Math.round(
      person.baseSalaryPerEpisode * CASTING.veteranFeeMultiplier,
    );
  }

  person.bio = `Found by ${director.name} ${provenance}.`;
  // They already like the studio that bothered to look. Standing gates who will take a
  // staff job, and a small studio finding people is the intended way through that gate.
  person.relationships[state.player.studioId] = 62;

  state.talent[person.id] = person;

  const find: CastingFind = {
    talentId: person.id,
    name: person.name,
    role: person.role,
    week: state.absoluteWeek,
    year: state.year,
    directorName: director.name,
    provenance,
    gem,
  };
  casting.finds.push(find);
  if (casting.finds.length > CASTING.maxFindsKept) {
    casting.finds = casting.finds.slice(-CASTING.maxFindsKept);
  }
  casting.lastFindWeek = state.absoluteWeek;

  announce(state, person, find, gem, emit);
}

/**
 * The find as news.
 *
 * A discovery that only changed a list would be invisible — the player is not reading
 * the rolodex every week, and a good find looks exactly like a bad one from the
 * outside. It arrives in the in-tray, with the number that makes it worth reading.
 */
function announce(
  state: GameState,
  person: TalentState,
  find: CastingFind,
  gem: boolean,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const craft = Math.round(person.craft);
  const fee = perEpisode(person.baseSalaryPerEpisode);
  // 'actor' is the only role that takes 'an', and "A actor of 26" in the in-tray is
  // exactly the sort of seam that stops a headline reading as something a person wrote.
  const article = /^[aeiou]/.test(person.role) ? 'An' : 'A';
  const who = `${person.role} of ${person.age}`;

  const headline = gem
    ? `${find.directorName} has found someone: ${person.name}`
    : `${find.directorName} brings in ${person.name}`;

  const body = gem
    ? `${article} ${who} with craft ${craft}, and nobody has heard of them. Found ${find.provenance}. They will work for ${fee} an episode — today.`
    : `${article} ${who}, craft ${craft}, asking ${fee} an episode. Found ${find.provenance}.`;

  emit('talent', headline, {
    body,
    playerRelevant: true,
    talentId: person.id,
    companyId: state.player.studioId,
  });
}

// ---------------------------------------------------------------------------
// Queries for the casting room
// ---------------------------------------------------------------------------

/** Everyone the department has found who is still free to sign, newest first. */
export function availableFinds(state: GameState): Array<{ find: CastingFind; person: TalentState }> {
  const casting = readCasting(state);
  const out: Array<{ find: CastingFind; person: TalentState }> = [];

  for (let i = casting.finds.length - 1; i >= 0; i--) {
    const find = casting.finds[i];
    const person = state.talent[find.talentId];
    if (person && !person.retired) out.push({ find, person });
  }
  return out;
}

/** Fast lookup for badging a discovery wherever it appears in the rolodex. */
export function discoveredIds(state: GameState): Set<string> {
  return new Set(readCasting(state).finds.map((f) => f.talentId));
}

/** The find record for one person, if the department is the reason they exist. */
export function findFor(state: GameState, talentId: string): CastingFind | undefined {
  return readCasting(state).finds.find((f) => f.talentId === talentId);
}

// ---------------------------------------------------------------------------
// Helpers — local rather than imported, to keep this module free of tick.ts
// ---------------------------------------------------------------------------

function weekly(amount: number): string {
  return `$${Math.round(amount / 1_000)}K/wk`;
}

function perEpisode(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}
