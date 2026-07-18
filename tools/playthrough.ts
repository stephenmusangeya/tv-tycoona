/**
 * Scripted playthrough.
 *
 * Drives the exact action functions the UI calls — commission, accept an offer, air,
 * reach syndication — so the player's path through the game is verified end to end,
 * not just the simulation underneath it. The engine tests prove the model is sound;
 * this proves the game is actually playable.
 *
 *   npx tsx tools/playthrough.ts [seed]
 */

import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { acceptOffer, developOriginal, setBudget } from '../src/engine/actions';
import { formatMoney } from '../src/engine/tick';
import { SHOW_ARCHETYPES } from '../src/data';
import { latestViewers, playerShows, totalCash, weeklyNet } from '../src/store/selectors';
import { ECONOMY } from '../src/engine/economy';
import type { GameState } from '../src/engine/types';

const seed = Number(process.argv[2] ?? 7);
const state = newGame({ seed, studioName: 'Player Pictures' });

const log = (message: string) => console.log(message);
const week = () => `Y${state.year}W${String(state.week).padStart(2, '0')}`;

let failures = 0;
function expect(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++;
  log(`${condition ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

log('\n=== TV Tycoon — scripted playthrough ===\n');
log(`seed ${seed}, starting cash ${formatMoney(totalCash(state))}\n`);

// ---------------------------------------------------------------------------
// 1. Commission a show
// ---------------------------------------------------------------------------

log('[1] Commissioning a show');

const taken = new Set(
  Object.values(state.productions)
    .filter((p) => p.status !== 'cancelled')
    .map((p) => p.archetypeId),
);
// Pick an affordable sitcom — a realistic first move for a studio with $50M.
const target = SHOW_ARCHETYPES.filter(
  (a) => !taken.has(a.id) && a.format === 'sitcom' && a.baseCostPerEpisode < 2_500_000,
).sort((a, b) => b.attributes.entertainment - a.attributes.entertainment)[0];

if (!target) {
  throw new Error('no suitable archetype available');
}

const created = developOriginal(state, target.id);
expect('developOriginal succeeds', created.ok, created.ok ? target.title : created.reason);
// `throw` rather than process.exit so TypeScript narrows the Result union here.
if (!created.ok) throw new Error(`could not commission a show: ${created.reason}`);

const show = created.value;
log(`  "${show.title}" (${show.format}) — quality ${Math.round(show.quality)}`);
log(`  budget ${formatMoney(show.budgetPerEpisode)}/ep · ${show.episodesPerSeason} eps`);
log(`  cast of ${show.cast.length}, showrunner ${state.talent[show.showrunnerId ?? '']?.name ?? 'none'}`);

// Give it a modest budget bump and confirm quality responds.
const qualityBefore = show.quality;
setBudget(state, show.id, Math.round(target.baseCostPerEpisode * 1.25));
expect(
  'raising the budget raises quality',
  show.quality > qualityBefore,
  `${Math.round(qualityBefore)} → ${Math.round(show.quality)}`,
);

// ---------------------------------------------------------------------------
// 2. Wait out development, then field offers
// ---------------------------------------------------------------------------

log('\n[2] Development and shopping the show');

let guard = 0;
while (show.status === 'development' && guard++ < 60) advanceWeek(state);
expect('show finishes development', show.status === 'hiatus', `at ${week()}`);

let offerAccepted = false;
guard = 0;
while (!offerAccepted && guard++ < 120) {
  advanceWeek(state);
  const offer = state.offers.find((o) => o.productionId === show.id);
  if (!offer) continue;

  const network = state.companies[offer.networkId];
  log(
    `  ${week()}  offer from ${network?.name}: ${formatMoney(offer.licenseFeePerEpisode)}/ep, ` +
      `${offer.seasons} season(s), slot ${offer.slotKey}`,
  );

  const result = acceptOffer(state, offer.id);
  offerAccepted = result.ok;
  if (!result.ok) log(`  could not accept: ${result.reason}`);
}

expect('a network picks up the show', offerAccepted);
expect('the show has a deal', Boolean(show.deal));

if (show.deal) {
  const cost = show.budgetPerEpisode + show.marketingPerEpisode;
  const deficit = cost - show.deal.licenseFeePerEpisode;
  log(`  deficit ${formatMoney(deficit)}/ep — this is what you are really signing up for`);
  expect('a new show is licensed below cost (deficit financing)', deficit > 0);
}

// ---------------------------------------------------------------------------
// 3. Get it on air
// ---------------------------------------------------------------------------

log('\n[3] Getting to air');

guard = 0;
while (show.status !== 'airing' && guard++ < 60) advanceWeek(state);
expect('show reaches air', show.status === 'airing', `at ${week()}`);

guard = 0;
while (show.totalEpisodes < 5 && guard++ < 30) advanceWeek(state);

const viewers = latestViewers(show);
log(`  after ${show.totalEpisodes} episodes: ${viewers?.toFixed(2) ?? '—'}M viewers`);
expect('the show draws an audience', (viewers ?? 0) > 0.2, `${viewers?.toFixed(2)}M`);

const breakdown = show.runningSeason?.viewersBySegmentSum;
if (breakdown) {
  const episodes = show.runningSeason!.episodes;
  const parts = (Object.entries(breakdown) as [string, number][])
    .map(([key, value]) => `${key} ${(value / episodes).toFixed(2)}M`)
    .join(', ');
  log(`  demographics: ${parts}`);
}

// ---------------------------------------------------------------------------
// 4. Run it for years
// ---------------------------------------------------------------------------

log('\n[4] Running the studio for 12 years');

const cashAtStart = totalCash(state);
log(`  weekly net at start: ${formatMoney(weeklyNet(state))}`);

for (let i = 0; i < 52 * 12; i++) advanceWeek(state);

const shows = playerShows(state);
log(`  ${week()}  cash ${formatMoney(totalCash(state))} (was ${formatMoney(cashAtStart)})`);
log(`  active projects: ${shows.length}`);
log(`  "${show.title}": ${show.status}, ${show.totalEpisodes} episodes, ${show.history.length} seasons`);

if (show.history.length > 0) {
  log('\n  season history:');
  for (const season of show.history) {
    log(
      `    S${String(season.season).padStart(2)}  ${String(season.episodes).padStart(3)} eps  ` +
        `${season.averageViewers.toFixed(2).padStart(6)}M  ${formatMoney(season.studioProfit).padStart(10)}`,
    );
  }
}

expect('the show ran at least one full season', show.history.length >= 1);
expect(
  'syndication only pays past the threshold',
  !show.syndicated || show.totalEpisodes >= ECONOMY.syndicationThreshold,
  show.syndicated ? `syndicated at ${show.totalEpisodes} eps` : 'not syndicated',
);

// ---------------------------------------------------------------------------
// 5. State integrity after a long game
// ---------------------------------------------------------------------------

log('\n[5] State integrity');

const allFinite = Object.values(state.companies).every(
  (c) => Number.isFinite(c.cash) && Number.isFinite(c.debt),
);
expect('all company balances finite', allFinite);

const noOrphanTalent = Object.values(state.talent).every(
  (person) => !person.productionId || Boolean(state.productions[person.productionId]),
);
expect('no talent attached to a missing show', noOrphanTalent);

const schedulesValid = Object.values(state.companies)
  .filter((c) => c.schedule)
  .every((c) =>
    Object.values(c.schedule!).every((id) => !id || Boolean(state.productions[id])),
  );
expect('no schedule slot points at a missing show', schedulesValid);

// A cancelled show must never still occupy a slot.
const noZombies = Object.values(state.companies)
  .filter((c) => c.schedule)
  .every((c) =>
    Object.values(c.schedule!).every((id) => {
      if (!id) return true;
      const production = state.productions[id];
      return production && production.status !== 'cancelled';
    }),
  );
expect('cancelled shows release their slots', noZombies);

const eventsBounded = state.events.length <= 400;
expect('event log stays bounded', eventsBounded, `${state.events.length} events`);

// ---------------------------------------------------------------------------
// [6] The game never goes quiet
// ---------------------------------------------------------------------------
// A passive player — someone who only ever presses "next week" — used to be left
// with an empty tray for ten weeks at a stretch, because a pitch arrived on a flat
// ~8% roll. A management sim with nothing to decide is a broken one, and it hit new
// players hardest. This drives a fresh game with a player who never acts and asserts
// that work keeps arriving.
log('\n[6] The game never goes quiet');

const idle = newGame({ seed: seed + 101, studioName: 'Idle Pictures' });
let longestDrySpell = 0;
let currentDrySpell = 0;

for (let i = 0; i < 120; i++) {
  advanceWeek(idle);
  const hasWork = idle.pitches.length + idle.offers.length > 0;
  currentDrySpell = hasWork ? 0 : currentDrySpell + 1;
  longestDrySpell = Math.max(longestDrySpell, currentDrySpell);
}

// Six weeks is the pitch lifetime, so a gap longer than that means the tray was
// genuinely empty rather than just between offers.
expect(
  'a passive player is never left with nothing to do',
  longestDrySpell <= 6,
  `longest dry spell ${longestDrySpell} weeks over 120`,
);
expect(
  'work actually arrives for a studio with no reputation',
  idle.events.filter((e) => e.kind === 'pitch').length >= 8,
  `${idle.events.filter((e) => e.kind === 'pitch').length} pitches in 120 weeks`,
);

log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

void (state as GameState);
