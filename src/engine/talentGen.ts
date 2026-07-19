import { TALENT_RECORDS } from '../data';
import { clamp } from './rng';
import type { Rng } from './rng';
import type { Format, TalentRecord, TalentRole, TalentState } from './types';
import { FORMATS } from './types';

/**
 * Procedural talent generation.
 *
 * The hand-authored database (180 people) supplies the memorable names — the
 * prestige-drama queen, the burnt-out showrunner. But an industry needs bodies: four
 * networks running full schedules need far more showrunners than any hand-written
 * list should contain, and the design calls for the pool to keep regenerating as
 * people age out (DESIGN.md §8). This fills both needs with plausible journeymen.
 *
 * Generated people skew ordinary on purpose. The authored cast should stay the
 * interesting one; these are the working professionals they are surrounded by.
 */

const FIRST_NAMES = [
  'Adaeze', 'Aiko', 'Alastair', 'Amara', 'Anders', 'Anika', 'Arturo', 'Aurelia',
  'Bianca', 'Bodhi', 'Callum', 'Camila', 'Cassius', 'Cerys', 'Chidi', 'Clementine',
  'Dara', 'Desmond', 'Dmitri', 'Eleni', 'Elias', 'Esme', 'Farrah', 'Fenwick',
  'Gemma', 'Gideon', 'Halima', 'Hollis', 'Idris', 'Imogen', 'Ines', 'Isamu',
  'Jarrah', 'Jocasta', 'Joaquin', 'Junia', 'Kaveh', 'Keiko', 'Kwame', 'Lark',
  'Leocadia', 'Linus', 'Magnus', 'Mairead', 'Marisol', 'Mateo', 'Nadia', 'Ngozi',
  'Niamh', 'Octavia', 'Oluwa', 'Orson', 'Paloma', 'Percival', 'Priya', 'Rafferty',
  'Ramona', 'Rashida', 'Rune', 'Saoirse', 'Selim', 'Sereno', 'Sunniva', 'Tamsin',
  'Thandiwe', 'Tobias', 'Ursula', 'Valentina', 'Vikram', 'Wren', 'Xiomara', 'Yusuf',
  'Zadie', 'Zephyr',
];

const SURNAMES = [
  'Abernathy', 'Achebe', 'Ashworth', 'Balogun', 'Barros', 'Beaumont', 'Bhandari',
  'Blackwood', 'Cardoso', 'Castellanos', 'Chatterjee', 'Cheng', 'Corrigan', 'Dubois',
  'Ekstrom', 'Fairweather', 'Farrow', 'Fontaine', 'Gallagher', 'Ghorbani', 'Halloran',
  'Hartsock', 'Ibarra', 'Ikeda', 'Jaworski', 'Kallio', 'Kasongo', 'Kirkbride',
  'Lindqvist', 'Lowenthal', 'Mabuza', 'Marchetti', 'Mbeki', 'Mendoza', 'Nakamura',
  'Nascimento', 'Obradovic', 'Okonkwo', 'Pemberton', 'Petrosyan', 'Quintero',
  'Rasmussen', 'Ravenscroft', 'Rosales', 'Sandoval', 'Sarkisian', 'Sharma',
  'Sinclair', 'Stavros', 'Thackeray', 'Torvald', 'Ueda', 'Vasquez', 'Verhoeven',
  'Wainwright', 'Wickham', 'Yamamoto', 'Zabala', 'Zeleny', 'Ziegler',
];

interface SalaryBand {
  /** What the least-known person in the role works for. */
  min: number;
  /** What the biggest name in the role commands. */
  max: number;
  /**
   * How steeply pay follows fame across the band.
   *
   * This is the load-bearing number, and getting it wrong is what emptied every cast
   * in the game once. Interpolating linearly on `(starPower/100)^1.9` puts a merely
   * average person at 27% of the band maximum — harmless when the band tops out at
   * $37K, catastrophic when it tops out near a million, because the median actor then
   * costs more than a whole episode and `autoStaff` silently hires nobody.
   *
   * So the exponent is per role, and it encodes something real: on-screen fame is paid
   * superlinearly and the distribution is brutally top-heavy, while craft roles are
   * paid comparatively flatly. Every band is tuned so a *median* person in the role
   * lands where a median show can afford them; the top end stays genuinely ruinous.
   */
  fameExponent: number;
}

/**
 * What people cost, per episode, from jobbing to unaffordable.
 *
 * Rebuilt alongside the show-cost ladder. The old bands were written against a
 * catalogue whose cheapest show cost $160K an episode; with a real bottom rung — daily
 * formats in the low tens of thousands — they priced an entire tier of television out
 * of being able to hire anybody at all.
 *
 * Medians here sit at roughly: actor $10K, host $12K, showrunner $25K, director $12K,
 * writer $6K, producer $8K. On a median $164K/ep drama that is a cast at ~37% of the
 * budget and a crew at ~30%, which is the shape the money is supposed to have. The
 * maxima are deliberately unchanged in spirit: a genuine star still costs several times
 * a small studio's entire episode budget, and that is meant to hurt.
 */
const ROLE_SALARY_BANDS: Record<TalentRole, SalaryBand> = {
  actor: { min: 700, max: 650_000, fameExponent: 6.1 },
  host: { min: 1_200, max: 400_000, fameExponent: 5.2 },
  showrunner: { min: 3_000, max: 180_000, fameExponent: 3.0 },
  director: { min: 2_000, max: 90_000, fameExponent: 3.1 },
  writer: { min: 800, max: 40_000, fameExponent: 2.9 },
  producer: { min: 1_500, max: 60_000, fameExponent: 3.2 },
};

/**
 * Price a role from a position along its band, 0 = unknown, 1 = the biggest name alive.
 *
 * One function for generated journeymen and authored stars alike, so the two
 * populations are a single labour market rather than two that happen to coexist.
 */
function bandSalary(role: TalentRole, position: number): number {
  const { min, max, fameExponent } = ROLE_SALARY_BANDS[role];
  return min + (max - min) * clamp(position, 0, 1) ** fameExponent;
}

/** Roles whose peak arrives later — writers and showrunners improve with mileage. */
const LATE_PEAK_ROLES = new Set<TalentRole>(['showrunner', 'writer', 'producer']);

function generateName(rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Exhausted the obvious combinations — fall back to a middle initial.
  const name = `${rng.pick(FIRST_NAMES)} ${String.fromCharCode(65 + rng.int(0, 25))}. ${rng.pick(SURNAMES)}`;
  used.add(name);
  return name;
}

export interface GenerateTalentOptions {
  role: TalentRole;
  /** 0–1. Rough seniority: drives craft, star power, salary and age together. */
  tier?: number;
  /** Force a newcomer profile: young, cheap, unknown, sometimes very good. */
  newcomer?: boolean;
}

export function generateTalent(
  rng: Rng,
  usedNames: Set<string>,
  mintId: (prefix: string) => string,
  options: GenerateTalentOptions,
): TalentRecord {
  const { role, newcomer = false } = options;
  // Skewed low so generated talent stays background by default.
  const tier = options.tier ?? clamp(rng.normal(0.42, 0.2), 0.05, 0.95);

  const latePeak = LATE_PEAK_ROLES.has(role);
  const age = newcomer
    ? rng.int(21, 29)
    : clamp(
        Math.round(rng.normal(latePeak ? 44 : 38, 11)),
        latePeak ? 28 : 23,
        latePeak ? 74 : 68,
      );

  // Newcomers are the bargain profile: real craft, no name, nearly free.
  const craft = newcomer
    ? clamp(rng.normal(52, 18), 15, 92)
    : clamp(rng.normal(38 + tier * 45, 10), 8, 97);

  const starPower = newcomer
    ? clamp(rng.normal(12, 7), 1, 35)
    : clamp(rng.normal(28 + tier * 52, 12), 2, 96);

  // Fame is the only thing that sets a price, for authored and generated people alike —
  // see `bandSalary`. Newcomers need no special case: they are unknown by construction,
  // and the curve already makes the unknown nearly free.
  const baseSalaryPerEpisode = Math.round(
    bandSalary(role, starPower / 100) * rng.range(0.85, 1.2),
  );

  // Affinity for 2–4 formats; everything else falls back to versatility.
  const affinityCount = rng.int(2, 4);
  const genreAffinity: Partial<Record<Format, number>> = {};
  for (const format of rng.shuffle(FORMATS).slice(0, affinityCount)) {
    genreAffinity[format] = clamp(rng.normal(60 + tier * 25, 14), 25, 98);
  }

  return {
    id: mintId('tal'),
    name: generateName(rng, usedNames),
    role,
    age,
    starPower,
    craft,
    reliability: clamp(rng.normal(66, 18), 10, 99),
    // Ego tracks fame only loosely — the mismatches are the interesting cases.
    ego: clamp(rng.normal(40 + starPower * 0.25, 20), 5, 99),
    versatility: clamp(rng.normal(52, 18), 10, 95),
    genreAffinity,
    baseSalaryPerEpisode,
    bio: newcomer
      ? 'Untested, inexpensive, and quietly better than their résumé suggests.'
      : 'A reliable industry professional with a steady list of credits.',
  };
}

/**
 * Where each authored person sits in their own profession's pay order, 0–1.
 *
 * `talent.json` prices its 180 people against the old catalogue, where the cheapest
 * show in the game cost $160K an episode. Those absolute figures are now meaningless —
 * but the *ordering* is not: it is the writing saying who the expensive one is, and
 * that is worth keeping.
 *
 * So authored people are re-priced by rank rather than by any transform of their old
 * number. The cheapest authored actor lands on the bottom of the actor band and the
 * biggest name lands on top, with everyone in between spread along the same curve the
 * generated journeymen use. One labour market, the pecking order intact, and no way for
 * a hand-written figure to escape the band and empty a cast again.
 */
const AUTHORED_PAY_RANK: Record<string, number> = (() => {
  const byRole = new Map<TalentRole, TalentRecord[]>();
  for (const record of TALENT_RECORDS) {
    const peers = byRole.get(record.role) ?? [];
    peers.push(record);
    byRole.set(record.role, peers);
  }

  const ranks: Record<string, number> = {};
  for (const peers of byRole.values()) {
    const ordered = [...peers].sort(
      (a, b) => a.baseSalaryPerEpisode - b.baseSalaryPerEpisode,
    );
    ordered.forEach((record, index) => {
      ranks[record.id] = ordered.length === 1 ? 0.5 : index / (ordered.length - 1);
    });
  }
  return ranks;
})();

/**
 * Re-roll an authored person's numbers for this save.
 *
 * The authored database supplies who exists and what they are known for; it should not
 * also fix, forever, exactly how good they are. A star who is identically gifted,
 * identically priced and identically reliable in every playthrough turns casting into
 * a memorised lookup — the second run has nothing to learn.
 *
 * Deliberately a jitter and not a re-generation: the burnt-out showrunner stays a
 * burnt-out showrunner, and their reputation still means something across saves. It is
 * the margins that move, which is where casting decisions actually live.
 */
export function varyAuthoredTalent(record: TalentRecord, rng: Rng): TalentRecord {
  const genreAffinity: Partial<Record<Format, number>> = {};
  for (const [format, value] of Object.entries(record.genreAffinity) as [
    Format,
    number,
  ][]) {
    genreAffinity[format] = clamp(value + rng.normal(0, 8), 15, 99);
  }

  // Occasionally someone turns out to have a range nobody had cast them for.
  if (rng.chance(0.25)) {
    const surprise = rng.pick(FORMATS);
    if (genreAffinity[surprise] === undefined) {
      genreAffinity[surprise] = clamp(rng.normal(58, 12), 30, 88);
    }
  }

  const starPower = clamp(record.starPower + rng.normal(0, 9), 1, 99);

  return {
    ...record,
    age: Math.max(18, record.age + rng.int(-4, 4)),
    starPower,
    craft: clamp(record.craft + rng.normal(0, 8), 5, 99),
    reliability: clamp(record.reliability + rng.normal(0, 11), 5, 99),
    ego: clamp(record.ego + rng.normal(0, 10), 3, 99),
    versatility: clamp(record.versatility + rng.normal(0, 10), 5, 99),
    genreAffinity,
    // Priced by standing within the profession, then nudged by the fame this save
    // actually rolled them — so a run where someone came out bigger is a run where they
    // are dearer, and the trade-off stays honest. Clamped to the band because no
    // authored name should ever escape the market everyone else is hired from.
    baseSalaryPerEpisode: Math.round(
      clamp(
        bandSalary(record.role, AUTHORED_PAY_RANK[record.id] ?? record.starPower / 100) *
          (starPower / Math.max(1, record.starPower)) ** 0.7 *
          rng.range(0.85, 1.2),
        ROLE_SALARY_BANDS[record.role].min * 0.8,
        ROLE_SALARY_BANDS[record.role].max * 1.25,
      ),
    ),
  };
}

/** Wrap a static record in its runtime state. */
export function toTalentState(record: TalentRecord): TalentState {
  return {
    ...record,
    morale: 65,
    heat: Math.round(record.starPower * 0.6),
    relationships: {},
    retired: false,
  };
}

/**
 * Pad a talent pool until every role has at least `minPerRole` people.
 *
 * Called at world creation and again each year, so the industry never runs out of
 * showrunners no matter how many shows are in production.
 */
export function padTalentPool(
  talent: Record<string, TalentState>,
  rng: Rng,
  mintId: (prefix: string) => string,
  minPerRole: Record<TalentRole, number>,
): void {
  const usedNames = new Set(Object.values(talent).map((p) => p.name));

  for (const role of Object.keys(minPerRole) as TalentRole[]) {
    const existing = Object.values(talent).filter(
      (p) => p.role === role && !p.retired,
    ).length;

    for (let i = existing; i < minPerRole[role]; i++) {
      const record = generateTalent(rng, usedNames, mintId, { role });
      talent[record.id] = toTalentState(record);
    }
  }
}

/** The annual intake of young unknowns — how the pool renews itself. */
export function generateRookieClass(
  talent: Record<string, TalentState>,
  rng: Rng,
  mintId: (prefix: string) => string,
  counts: Partial<Record<TalentRole, number>>,
): TalentState[] {
  const usedNames = new Set(Object.values(talent).map((p) => p.name));
  const rookies: TalentState[] = [];

  for (const [role, count] of Object.entries(counts) as [TalentRole, number][]) {
    for (let i = 0; i < count; i++) {
      const record = generateTalent(rng, usedNames, mintId, { role, newcomer: true });
      const state = toTalentState(record);
      talent[state.id] = state;
      rookies.push(state);
    }
  }

  return rookies;
}
