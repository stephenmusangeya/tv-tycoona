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

console.log();
void getArchetype;
void (state as GameState);
