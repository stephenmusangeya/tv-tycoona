/**
 * Headless balance harness.
 *
 * Runs the simulation for N years with no UI and prints what the economy actually
 * did. Game balance is impossible to tune by playing — you need a hundred simulated
 * years in two seconds, which is what this is for. See DESIGN.md §11.
 *
 *   npx tsx tools/sim.ts [years] [seed]
 */

import { newGame, advanceWeek, formatMoney } from '../src/engine';
import { getArchetype } from '../src/data';
import type { GameState, Production } from '../src/engine/types';

const years = Number(process.argv[2] ?? 10);
const seed = Number(process.argv[3] ?? 42);

const state = newGame({ seed, studioName: 'Test Pictures' });

console.log(`\nTV Tycoon — headless simulation`);
console.log(`seed ${seed}, ${years} years\n`);
console.log(
  `world: ${Object.keys(state.companies).length} companies, ` +
    `${Object.keys(state.productions).length} shows on air, ` +
    `${Object.keys(state.talent).length} talent\n`,
);

const started = Date.now();
const totalWeeks = years * 52;

for (let week = 0; week < totalWeeks; week++) {
  advanceWeek(state);
}

const elapsed = Date.now() - started;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const live = Object.values(state.productions).filter(
  (p) => p.status === 'airing' || p.status === 'hiatus',
);
const cancelled = Object.values(state.productions).filter((p) => p.status === 'cancelled');
const withHistory = Object.values(state.productions).filter((p) => p.history.length > 0);

function averageViewers(p: Production): number {
  if (p.history.length === 0) return 0;
  return p.history.reduce((s, h) => s + h.averageViewers, 0) / p.history.length;
}

console.log(`ran ${totalWeeks} weeks in ${elapsed}ms (${(elapsed / totalWeeks).toFixed(2)}ms/week)\n`);

console.log('--- shows ---');
console.log(`live         ${live.length}`);
console.log(`cancelled    ${cancelled.length}`);
console.log(`total ever   ${Object.keys(state.productions).length}`);
console.log(`syndicated   ${Object.values(state.productions).filter((p) => p.syndicated).length}`);

const viewerSamples = withHistory.map(averageViewers).sort((a, b) => a - b);
if (viewerSamples.length > 0) {
  const pct = (q: number) => viewerSamples[Math.floor(viewerSamples.length * q)] ?? 0;
  console.log(`\n--- ratings distribution (avg viewers, millions) ---`);
  console.log(`min ${pct(0).toFixed(2)}  p25 ${pct(0.25).toFixed(2)}  median ${pct(0.5).toFixed(2)}  p75 ${pct(0.75).toFixed(2)}  p95 ${pct(0.95).toFixed(2)}  max ${viewerSamples.at(-1)!.toFixed(2)}`);
}

console.log(`\n--- top 10 shows by average viewers ---`);
withHistory
  .sort((a, b) => averageViewers(b) - averageViewers(a))
  .slice(0, 10)
  .forEach((p, i) => {
    const owner = state.companies[p.ownerId]?.name ?? '?';
    console.log(
      `${String(i + 1).padStart(2)}. ${p.title.padEnd(32)} ${averageViewers(p).toFixed(1).padStart(5)}M  ` +
        `q${String(Math.round(p.quality)).padStart(3)}  s${p.history.length}  ${p.totalEpisodes}ep  ${owner}`,
    );
  });

console.log(`\n--- companies ---`);
Object.values(state.companies)
  .sort((a, b) => b.cash - b.debt - (a.cash - a.debt))
  .forEach((c) => {
    const net = c.cash - c.debt;
    const extra =
      c.type === 'streamer'
        ? `  ${(c.subscribers ?? 0).toFixed(1)}M subs`
        : c.type === 'network'
          ? `  reach ${((c.reach ?? 0) * 100).toFixed(0)}%`
          : '';
    console.log(
      `${c.isPlayer ? '*' : ' '} ${c.name.padEnd(26)} ${c.type.padEnd(9)} ` +
        `${formatMoney(net).padStart(9)}  crit ${String(Math.round(c.criticalStanding)).padStart(3)}  ` +
        `pop ${String(Math.round(c.popularStanding)).padStart(3)}${extra}`,
    );
  });

// ---------------------------------------------------------------------------
// Sanity checks — these are the balance assertions that matter
// ---------------------------------------------------------------------------

console.log(`\n--- checks ---`);

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(42)} ${detail}`);
};

const medianViewers = viewerSamples[Math.floor(viewerSamples.length / 2)] ?? 0;
check(
  'median show rates between 0.5M and 8M',
  medianViewers > 0.5 && medianViewers < 8,
  `${medianViewers.toFixed(2)}M`,
);

const topViewers = viewerSamples.at(-1) ?? 0;
check('a genuine hit exists (>10M)', topViewers > 10, `${topViewers.toFixed(1)}M`);

check(
  'the world keeps making shows',
  Object.keys(state.productions).length > 100,
  `${Object.keys(state.productions).length} ever produced`,
);

check('live slate has not collapsed', live.length > 20, `${live.length} live`);

const solventNetworks = Object.values(state.companies).filter(
  (c) => c.type === 'network' && c.cash - c.debt > 0,
).length;
check('networks remain solvent', solventNetworks >= 2, `${solventNetworks}/4 in the black`);

const freeShowrunners = Object.values(state.talent).filter(
  (t) => t.role === 'showrunner' && !t.productionId && !t.retired,
).length;
check('talent pool has not run dry', freeShowrunners > 5, `${freeShowrunners} free showrunners`);

const unstaffed = live.filter((p) => !p.showrunnerId && !p.hostId).length;
check('shows are getting staffed', unstaffed < live.length * 0.2, `${unstaffed} unstaffed`);

// ---------------------------------------------------------------------------
// The catalogue: is the ladder actually a ladder?
// ---------------------------------------------------------------------------

console.log('\n--- cost ladder (this save) ---');

const catalogue = Object.values(state.concepts);
const seasonCost = (c: (typeof catalogue)[number]) =>
  c.baseCostPerEpisode * c.episodesPerSeason;
const bySeason = [...catalogue].sort((a, b) => seasonCost(a) - seasonCost(b));
const rung = (q: number) => bySeason[Math.floor((bySeason.length - 1) * q)];

console.log(`concepts     ${catalogue.length}`);
for (const [label, q] of [['cheapest', 0], ['p25', 0.25], ['median', 0.5], ['p75', 0.75], ['dearest', 1]] as const) {
  const c = rung(q);
  console.log(
    `${label.padEnd(12)} ${formatMoney(seasonCost(c)).padStart(8)}/season  ` +
      `${formatMoney(c.baseCostPerEpisode).padStart(7)}/ep x${String(c.episodesPerSeason).padStart(3)}  ${c.format.padEnd(11)} ${c.title}`,
  );
}

// A studio opens with $10M. The deficit on a season is roughly 45% of its cost, so a
// bottom rung worth having is one a new studio can carry more than one of.
const STARTING_CASH = 10_000_000;
const affordable = catalogue.filter((c) => seasonCost(c) * 0.45 < STARTING_CASH * 0.5);
check(
  'a new studio can afford a real slate',
  affordable.length >= 20,
  `${affordable.length} concepts deficit-financeable on half of opening cash`,
);

check(
  'the top of the ladder is out of reach at the start',
  seasonCost(rung(1)) > STARTING_CASH * 5,
  `dearest season ${formatMoney(seasonCost(rung(1)))}`,
);

// ---------------------------------------------------------------------------
// Determinism and divergence — two saves must differ, and each must be reproducible
// ---------------------------------------------------------------------------

console.log('\n--- world generation ---');

/** Concepts are the whole world model, so comparing them compares the worlds. */
const conceptFingerprint = (g: GameState) =>
  JSON.stringify(
    Object.values(g.concepts)
      .map((c) => `${c.title}|${c.format}|${c.baseCostPerEpisode}|${c.episodesPerSeason}`)
      .sort(),
  );

const a1 = newGame({ seed: 7 });
const a2 = newGame({ seed: 7 });
const b1 = newGame({ seed: 8 });

check(
  'the same seed builds a byte-identical world',
  conceptFingerprint(a1) === conceptFingerprint(a2),
  `${Object.keys(a1.concepts).length} concepts`,
);

// Talent is re-rolled per save too, so the same person is not identical in every run.
const talentFingerprint = (g: GameState) =>
  JSON.stringify(
    Object.values(g.talent)
      .filter((p) => !p.id.startsWith('tal_'))
      .map((p) => `${p.name}|${Math.round(p.craft)}|${Math.round(p.starPower)}|${p.baseSalaryPerEpisode}`)
      .sort(),
  );

check(
  'the same seed re-rolls the authored cast identically',
  talentFingerprint(a1) === talentFingerprint(a2),
  'authored talent reproducible',
);

const titlesOf = (g: GameState) => new Set(Object.values(g.concepts).map((c) => c.title));
const titlesA = titlesOf(a1);
const titlesB = titlesOf(b1);
const shared = [...titlesA].filter((t) => titlesB.has(t)).length;
const overlap = shared / Math.max(titlesA.size, titlesB.size);

check(
  'two seeds build visibly different worlds',
  overlap < 0.6,
  `${(overlap * 100).toFixed(0)}% of titles shared (${shared} of ${titlesA.size} vs ${titlesB.size})`,
);

check(
  'the authored cast differs between seeds',
  talentFingerprint(a1) !== talentFingerprint(b1),
  'same people, different numbers',
);

// The authored shows that *do* appear should not be identical copies either.
const authoredIn = (g: GameState) =>
  new Map(
    Object.values(g.concepts)
      .filter((c) => !c.id.includes('-o'))
      .map((c) => [c.title, c.baseCostPerEpisode] as const),
  );
const authoredA = authoredIn(a1);
const authoredB = authoredIn(b1);
let sameTitleDifferentPrice = 0;
for (const [title, cost] of authoredA) {
  const other = authoredB.get(title);
  if (other !== undefined && other !== cost) sameTitleDifferentPrice++;
}
check(
  'a returning authored show is priced differently',
  sameTitleDifferentPrice > 5,
  `${sameTitleDifferentPrice} shared titles at different costs`,
);

console.log();
void getArchetype;
void (state as GameState);
