/** Verify the per-show and pre-purchase money panels show correct, consistent sums. */
import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { acceptOffer, developOriginal, licenseReruns, rerunBidsFor } from '../src/engine/actions';
import { SHOW_ARCHETYPES } from '../src/data';
import { showEconomics, estimateNewShow, moneyBreakdown, weeklyNet, rerunIncome, libraryWorth } from '../src/store/selectors';
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

console.log(fails === 0 ? '\nALL MONEY CHECKS PASSED\n' : `\n${fails} FAILED\n`);
process.exit(fails ? 1 : 0);
