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

const ROLE_SALARY_BANDS: Record<TalentRole, [number, number]> = {
  actor: [8_000, 900_000],
  writer: [10_000, 110_000],
  showrunner: [40_000, 450_000],
  producer: [20_000, 190_000],
  director: [25_000, 230_000],
  host: [20_000, 700_000],
};

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

  const [minSalary, maxSalary] = ROLE_SALARY_BANDS[role];
  const salaryTier = newcomer ? 0.02 : (starPower / 100) ** 1.9;
  const baseSalaryPerEpisode = Math.round(
    (minSalary + (maxSalary - minSalary) * salaryTier) * rng.range(0.85, 1.2),
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
