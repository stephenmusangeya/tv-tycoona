/** Verify the per-show and pre-purchase money panels show correct, consistent sums. */
import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { acceptOffer, developOriginal, licenseReruns, rerunBidsFor } from '../src/engine/actions';
import { SHOW_ARCHETYPES } from '../src/data';
import { showEconomics, estimateNewShow, moneyBreakdown, weeklyNet, rerunIncome, libraryWorth, totalCash, totalDebt } from '../src/store/selectors';
import { rerunWeeklyValue, RERUN_MINIMUM_EPISODES } from '../src/engine/economy';
import { formatMoney } from '../src/engine/tick';

let fails = 0;
const check = (l: string, ok: boolean, d = '') => { if (!ok) fails++; console.log(`${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); };
const m = (n: number) => (n < 0 ? '-' : '+') + formatMoney(Math.abs(n));

const state = newGame({ seed: 7, studioName: 'Test Pictures' });
const taken = new Set(Object.values(state.productions).map(p => p.archetypeId));
const target = SHOW_ARCHETYPES.find(a => !taken.has(a.id) && a.format === 'sitcom' && a.baseCostPerEpisode < 2_500_000)!;

// ---- BEFORE BUYING ----
const est = estimateNewShow(target);
console.log(`\n=== BEFORE BUYING: "${target.title}" ===`);
console.log(`  Making each episode        ${m(-est.budget)}`);
console.log(`  Advertising it             ${m(-est.marketing)}`);
console.log(`  A channel should pay about ${m(est.expectedFee)}`);
console.log(`  ${'-'.repeat(38)}`);
console.log(`  Per episode                ${m(est.perEpisode)}`);
console.log(`  Per series (${String(est.episodes).padStart(2)} eps)        ${m(est.perSeries)}`);
console.log(`  Series until repeats:      ${est.seriesToRepeats}`);
check('estimate: per-series = per-episode x episodes', est.perSeries === est.perEpisode * est.episodes);
check('estimate: a new show loses money', est.perEpisode < 0, m(est.perEpisode));

const made = developOriginal(state, target.id);
if (!made.ok) throw new Error(made.reason);
for (let i = 0; i < 400; i++) {
  advanceWeek(state);
  const o = state.offers.find(x => x.productionId === made.value.id);
  if (o) acceptOffer(state, o.id);
  if (made.value.totalEpisodes >= 14) break;
}

// ---- AFTER MAKING ----
const eco = showEconomics(state, made.value);
console.log(`\n=== THE MONEY (per episode), ${made.value.totalEpisodes} episodes made ===`);
for (const l of eco.lines) console.log(`  ${l.label.padEnd(26)} ${m(l.amount).padStart(9)}   (${l.detail})`);
console.log(`  ${'-'.repeat(38)}`);
console.log(`  Per episode                ${m(eco.perEpisode)}`);
console.log(`  Per series (${eco.episodesPerSeries} eps)        ${m(eco.perSeries)}`);

const sum = eco.lines.reduce((s, l) => s + l.amount, 0);
check('show lines sum to the per-episode total', Math.abs(sum - eco.perEpisode) < 1, `${m(sum)} vs ${m(eco.perEpisode)}`);
check('per-series = per-episode x episodes', eco.perSeries === eco.perEpisode * eco.episodesPerSeries);
check('cast wages are part of the making cost', eco.talentCost > 0 && eco.talentCost <= made.value.budgetPerEpisode * 1.5, formatMoney(eco.talentCost));

// ---- REPEATS ----
console.log(`\n=== REPEATS (threshold ${RERUN_MINIMUM_EPISODES} episodes) ===`);
check('can sell repeats after one series', made.value.totalEpisodes >= RERUN_MINIMUM_EPISODES, `${made.value.totalEpisodes} eps`);
const bids = rerunBidsFor(state, made.value.id);
console.log(`  buyers: ${bids.length}, would pay ${formatMoney(rerunWeeklyValue(made.value))}/wk each-ish`);
bids.slice(0,3).forEach(b => console.log(`    ${b.buyerName.padEnd(22)} ${formatMoney(b.weeklyPayment).padStart(8)}/wk`));
check('there are buyers for repeats', bids.length > 0);

const netBefore = weeklyNet(state);
if (bids.length) licenseReruns(state, made.value.id, bids[0].buyerId);
const netAfter = weeklyNet(state);
check('licensing improves the weekly total', netAfter > netBefore, `${m(netBefore)} -> ${m(netAfter)}`);
check('breakdown total matches weeklyNet', Math.abs(moneyBreakdown(state).reduce((s,l)=>s+l.amount,0) - netAfter) < 1);
console.log(`  repeats income ${formatMoney(rerunIncome(state))}/wk · library worth ${formatMoney(libraryWorth(state))}`);

// ---------------------------------------------------------------------------
// THE BOTTOM RUNG: can a small studio actually make money on small television?
// ---------------------------------------------------------------------------
// The premise of the game is that you start with $10M, make unglamorous things, and
// build a library. That is a claim about arithmetic, and it is worth asserting rather
// than hoping: commission the cheapest thing in the world, run it, sell the repeats,
// and check the studio is genuinely ahead — without ever touching an expensive show.

console.log('\n=== THE BOTTOM RUNG: starting small and turning a profit ===');

const YEARS_ALLOWED = 6;
const SLATE_SIZE = 4;

const lean = newGame({ seed: 11, studioName: 'Bottom Rung Pictures' });
const openingCash = totalCash(lean);

// A slate, not a show. One 20-episode documentary is not a business — it is on air
// twenty weeks a year and idle for the rest — and the design's claim is not "one cheap
// show pays for a studio", it is that a studio can be built out of cheap shows. So this
// buys the cheapest few things in the catalogue and runs them like a small studio would.
const onAir = new Set(Object.values(lean.productions).map((p) => p.archetypeId));
const seasonCostOf = (c: { baseCostPerEpisode: number; episodesPerSeason: number }) =>
  c.baseCostPerEpisode * c.episodesPerSeason;

const entries = Object.values(lean.concepts)
  .filter((c) => !onAir.has(c.id) && c.episodesPerSeason >= 20)
  .sort((a, b) => seasonCostOf(a) - seasonCostOf(b))
  .slice(0, SLATE_SIZE);

check('there are cheap formats to start on', entries.length === SLATE_SIZE);

console.log(`  opening cash ${formatMoney(openingCash)}`);
const slateCost = entries.reduce((sum, c) => sum + seasonCostOf(c), 0);
for (const c of entries) {
  console.log(
    `  "${c.title}" (${c.format}) — ${formatMoney(c.baseCostPerEpisode)}/ep ` +
      `x${c.episodesPerSeason} = ${formatMoney(seasonCostOf(c))}/season`,
  );
}
console.log(`  whole slate: ${formatMoney(slateCost)}/season`);

check(
  'a whole cheap slate costs less than opening cash',
  slateCost < openingCash,
  `${formatMoney(slateCost)} vs ${formatMoney(openingCash)}`,
);

const slate = entries
  .map((c) => developOriginal(lean, c.id))
  .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
  .map((r) => r.value);

check('the studio can commission the slate', slate.length === SLATE_SIZE, `${slate.length} commissioned`);

let lowWater = openingCash;

// Behave like a competent small studio: take the licence deals, and sell the repeats
// as soon as there are enough episodes to package.
for (let i = 0; i < 52 * YEARS_ALLOWED; i++) {
  advanceWeek(lean);

  for (const production of slate) {
    const offer = lean.offers.find((o) => o.productionId === production.id);
    if (offer) acceptOffer(lean, offer.id);

    if (production.rerunDeals.length === 0) {
      const available = rerunBidsFor(lean, production.id);
      if (available.length > 0) licenseReruns(lean, production.id, available[0].buyerId);
    }
  }

  lowWater = Math.min(lowWater, totalCash(lean));
}

const finalCash = totalCash(lean);
const episodes = slate.reduce((sum, p) => sum + p.totalEpisodes, 0);
const syndicated = slate.filter((p) => p.syndicated).length;

console.log(
  `  after ${YEARS_ALLOWED} years: ${episodes} episodes across ${slate.length} shows, ` +
    `${syndicated} syndicated`,
);
console.log(
  `  cash ${formatMoney(openingCash)} -> ${formatMoney(finalCash)}  ` +
    `(low water ${formatMoney(lowWater)}, debt ${formatMoney(totalDebt(lean))})`,
);
console.log(`  library worth ${formatMoney(libraryWorth(lean))}`);

check(
  'the small studio survives its own slate',
  lowWater > 0 && totalDebt(lean) < openingCash,
  `low water ${formatMoney(lowWater)}, debt ${formatMoney(totalDebt(lean))}`,
);

check(
  `a cheap slate is ahead within ${YEARS_ALLOWED} years`,
  finalCash > openingCash,
  `${m(finalCash - openingCash)}`,
);

// Small television should make *small* money. If the cheapest shows in the game
// multiplied the studio's capital, the ladder would be upside down again and the
// correct strategy would be to make nothing but daytime filler forever.
check(
  'the profit is modest, not a windfall',
  finalCash < openingCash * 6,
  `${formatMoney(finalCash)} from ${formatMoney(openingCash)}`,
);

// ---------------------------------------------------------------------------
// CASTING: every show must actually have people on screen
// ---------------------------------------------------------------------------
// A 10x rescale of show costs once emptied the cast of every scripted show in the game
// and nothing caught it: the playthrough happily printed "cast of 0" and passed, because
// no check asserted that a commissioned show has anyone in it. Cast feeds quality,
// awareness, the wage bill and half the UI, so this is the check that should have
// existed first. It sweeps several seeds and both halves of the catalogue, because the
// failure mode was budget-dependent and would hide on any single lucky show.

console.log('\n=== CASTING: shows have people on screen ===');

const SCRIPTED_SAMPLE = ['sitcom', 'drama', 'procedural', 'animation'] as const;
const UNSCRIPTED_SAMPLE = ['gameshow', 'talkshow', 'news', 'reality'] as const;

let castChecked = 0;
let castEmpty = 0;
let castShort = 0;
let rosterOutOfRange = 0;
const rosterShares: number[] = [];

for (const castSeed of [7, 8, 42, 101]) {
  const world = newGame({ seed: castSeed, studioName: 'Casting Pictures' });
  const inUse = new Set(Object.values(world.productions).map((p) => p.archetypeId));

  for (const format of [...SCRIPTED_SAMPLE, ...UNSCRIPTED_SAMPLE]) {
    const concept = Object.values(world.concepts).find(
      (c) => !inUse.has(c.id) && c.format === format,
    );
    if (!concept) continue;

    const result = developOriginal(world, concept.id);
    if (!result.ok) continue;

    const show = result.value;
    const scripted = (SCRIPTED_SAMPLE as readonly string[]).includes(format);
    const faces = scripted ? show.cast.length : show.hostId ? 1 : 0;
    const wanted = scripted ? concept.castSize : 1;

    const roster = [
      ...show.cast,
      show.hostId,
      show.showrunnerId,
      show.directorId,
      ...show.writerIds,
    ]
      .filter((id): id is string => Boolean(id))
      .reduce((sum, id) => sum + (world.talent[id]?.baseSalaryPerEpisode ?? 0), 0);
    const share = roster / concept.baseCostPerEpisode;

    castChecked++;
    if (faces === 0) {
      castEmpty++;
      console.log(
        `  EMPTY  seed ${castSeed} ${format} "${concept.title}" ` +
          `${formatMoney(concept.baseCostPerEpisode)}/ep`,
      );
    } else if (faces < wanted) {
      castShort++;
    }
    // A roster costing nothing means nobody was hired; one costing more than the
    // episode means the spend ceiling is not being applied at all.
    if (share < 0.03 || share > 0.95) {
      rosterOutOfRange++;
      console.log(
        `  ROSTER seed ${castSeed} ${format} at ${(share * 100).toFixed(0)}% of budget`,
      );
    }
    rosterShares.push(share);
  }
}

rosterShares.sort((a, b) => a - b);
const medianShare = rosterShares[Math.floor(rosterShares.length / 2)] ?? 0;
console.log(
  `  ${castChecked} shows commissioned across 4 seeds · roster ` +
    `${(rosterShares[0] * 100).toFixed(0)}%–${(rosterShares.at(-1)! * 100).toFixed(0)}% ` +
    `of budget (median ${(medianShare * 100).toFixed(0)}%)`,
);

check('every commissioned show has someone on screen', castEmpty === 0, `${castEmpty} empty of ${castChecked}`);
// A cheap show genuinely cannot always afford its full ensemble, and that is the spend
// ceiling doing its job — but it should be the exception, not the rule.
check(
  'shows are cast to their full ensemble, give or take',
  castShort <= castChecked * 0.15,
  `${castShort} short of ${castChecked}`,
);
check('the wage bill is a sane share of the budget', rosterOutOfRange === 0, `${rosterOutOfRange} outside 3–95%`);
check(
  'talent is a meaningful cost without eating the show',
  medianShare > 0.2 && medianShare < 0.8,
  `median ${(medianShare * 100).toFixed(0)}% of budget`,
);

console.log(fails === 0 ? '\nALL MONEY CHECKS PASSED\n' : `\n${fails} FAILED\n`);
process.exit(fails ? 1 : 0);
