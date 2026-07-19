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
import {
  acceptOffer,
  availableFor,
  availableProducers,
  blueprintFor,
  createShow,
  developOriginal,
  previewShow,
  setBudget,
} from '../src/engine/actions';
import { formatMoney } from '../src/engine/tick';
import { SHOW_ARCHETYPES } from '../src/data';
import { latestViewers, playerShows, totalCash, totalDebt, weeklyNet } from '../src/store/selectors';
import { ECONOMY } from '../src/engine/economy';
import { BANK } from '../src/engine/bank';
import { WEEKS_PER_YEAR } from '../src/engine/schedule';
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

// ---------------------------------------------------------------------------
// [7] The on-ramp: $10M is enough to build something
// ---------------------------------------------------------------------------
// Starting cash dropped from $120M to $10M, which makes the opening question real:
// what can I actually afford? A prestige drama is now genuinely out of reach, and it
// should be. But the cheap-daily-format route has to *work*, or the game is simply
// unwinnable from its own starting position. This drives that route deliberately —
// commission the cheapest thing available, take the first offer, and check the studio
// reaches syndication without going bust.
log('\n[7] The on-ramp — starting small has to work');

const lean = newGame({ seed: seed + 202, studioName: 'Lean Pictures' });
const leanTaken = new Set(
  Object.values(lean.productions).map((p) => p.archetypeId),
);
// The cheapest format with a high episode order — the fast route to repeats.
const cheap = SHOW_ARCHETYPES.filter((a) => !leanTaken.has(a.id) && a.episodesPerSeason >= 100)
  .sort((a, b) => a.baseCostPerEpisode - b.baseCostPerEpisode)[0];

expect('a cheap high-volume format exists to start with', Boolean(cheap));

if (cheap) {
  log(`  chose "${cheap.title}" — ${formatMoney(cheap.baseCostPerEpisode)}/ep, ${cheap.episodesPerSeason} eps`);
  const leanShow = developOriginal(lean, cheap.id);
  expect('can afford to commission it', leanShow.ok);

  if (leanShow.ok) {
    let lowWater = totalCash(lean);
    for (let i = 0; i < 200; i++) {
      advanceWeek(lean);
      const offer = lean.offers.find((o) => o.productionId === leanShow.value.id);
      if (offer) acceptOffer(lean, offer.id);
      lowWater = Math.min(lowWater, totalCash(lean));
      if (leanShow.value.syndicated) break;
    }

    log(`  lowest cash: ${formatMoney(lowWater)} · episodes: ${leanShow.value.totalEpisodes}`);
    expect(
      'a lean studio reaches syndication',
      leanShow.value.syndicated,
      `${leanShow.value.totalEpisodes} episodes`,
    );
    expect(
      'and gets there without the debt spiralling',
      totalDebt(lean) < 20_000_000,
      `debt ${formatMoney(totalDebt(lean))}`,
    );
  }
}

// ---------------------------------------------------------------------------
// [8] The bank: there has to be a way to lose
// ---------------------------------------------------------------------------
// The game used to go on for ever — you could run at a loss for twenty years and
// nothing came to collect, which made every financial decision weightless. This drives
// the fail state deliberately: a studio that over-commits must climb the warning
// ladder, then be closed, and pressing "next week" afterwards must do nothing at all.
// The lean studio from [7] is the control — a sensible operation must never even
// receive a letter.
log('\n[8] The bank — running out of rope');

const reckless = newGame({ seed: seed + 303, studioName: 'Reckless Pictures' });
const recklessTaken = new Set(
  Object.values(reckless.productions)
    .filter((p) => p.status !== 'cancelled')
    .map((p) => p.archetypeId),
);
// Three of the most expensive things on the shelf, each funded half again over what
// it needs. Deliberately over-committed rather than absurd: the point is to walk the
// studio up through the letters, not to blow the ceiling apart in a single week.
const extravagant = SHOW_ARCHETYPES.filter((a) => !recklessTaken.has(a.id))
  .sort((a, b) => b.baseCostPerEpisode - a.baseCostPerEpisode)
  .slice(0, 3);

for (const archetype of extravagant) {
  const made = developOriginal(reckless, archetype.id);
  if (made.ok) setBudget(reckless, made.value.id, archetype.baseCostPerEpisode * 1.5);
}

// The week the bank *used* when it wrote, not the week the loop observed it: the
// calendar rolls at the end of the tick, so reading absoluteWeek here would be one
// ahead of every figure the bank recorded.
let firstWarningWeek: number | undefined;
for (let i = 0; i < 400; i++) {
  advanceWeek(reckless);
  for (const offer of [...reckless.offers]) acceptOffer(reckless, offer.id);
  if (firstWarningWeek === undefined && reckless.bank.warnings > 0) {
    firstWarningWeek = reckless.bank.lastWarningWeek;
  }
  if (reckless.bank.closedDownWeek !== undefined) break;
}

const letters = reckless.events.filter(
  (e) => e.kind === 'money' && e.playerRelevant && /bank/i.test(e.headline),
);
log(`  debt ${formatMoney(totalDebt(reckless))} against a ceiling of ${formatMoney(reckless.bank.creditLimit)}`);
for (const letter of letters) log(`  Y${letter.year}W${letter.week}  ${letter.headline}`);

expect(
  'a reckless studio is warned before anything happens to it',
  firstWarningWeek !== undefined,
  firstWarningWeek !== undefined ? `first letter at week ${firstWarningWeek}` : 'never warned',
);
expect(
  'the bank closes it down',
  reckless.bank.closedDownWeek !== undefined,
  reckless.bank.closedDownReason ?? `debt ${formatMoney(totalDebt(reckless))}`,
);
expect(
  'the closure is never a surprise — the grace period is served in full',
  firstWarningWeek !== undefined &&
    reckless.bank.closedDownWeek !== undefined &&
    reckless.bank.closedDownWeek - firstWarningWeek >= BANK.graceWeeks,
  `${(reckless.bank.closedDownWeek ?? 0) - (firstWarningWeek ?? 0)} weeks of notice`,
);

// The save must survive foreclosure — the player looks at what they built.
expect('the closed studio keeps its shows', Object.keys(reckless.productions).length > 0);

const frozenWeek = reckless.absoluteWeek;
const frozenCash = totalCash(reckless);
for (let i = 0; i < 10; i++) advanceWeek(reckless);
expect(
  'advancing time does nothing once the studio is closed',
  reckless.absoluteWeek === frozenWeek && totalCash(reckless) === frozenCash,
  `week ${reckless.absoluteWeek}`,
);

expect(
  'a lean studio is never troubled by the bank',
  lean.bank.warnings === 0 && lean.bank.closedDownWeek === undefined,
  `${lean.bank.warnings} warning(s), debt ${formatMoney(totalDebt(lean))} of ${formatMoney(lean.bank.creditLimit)}`,
);

// A studio that over-commits blows through every tier in the single week its shows
// premiere, which proves the hard stop but not the staircase. This walks a studio into
// the ceiling a slice at a time instead, so all three letters can actually be observed
// in order — that is the path a player who is gradually losing control will take, and
// nobody should ever reach foreclosure without having read the first two.
//
// The debt is applied directly rather than played into existence on purpose: how fast
// a slate bleeds is a matter of live economy tuning, but the ladder must hold at any
// speed, so the harness sets the speed itself.
const sinking = newGame({ seed: seed + 404, studioName: 'Sinking Pictures' });
const sinkingStudio = sinking.companies[sinking.player.studioId];
for (let i = 0; i < 120 && sinking.bank.closedDownWeek === undefined; i++) {
  sinkingStudio.debt += sinking.bank.creditLimit * 0.05;
  advanceWeek(sinking);
}

const bankLetters = sinking.events
  .filter((e) => e.kind === 'money' && e.playerRelevant && /bank/i.test(e.headline))
  .map((e) => ({ headline: e.headline, at: (e.year - 1) * WEEKS_PER_YEAR + e.week }));
const driftLetters = bankLetters.map((l) => l.headline);
for (const headline of driftLetters) log(`  sinking: ${headline}`);

const sawTier = (needle: string) => driftLetters.some((h) => h.includes(needle));
expect(
  'a slow decline gets the full ladder: a word, then a notice, then a demand',
  sawTier('would like a word') && sawTier('Formal notice') && sawTier('Final demand'),
  driftLetters.join(' | ') || 'no letters',
);
// A letter every few months while you are in trouble is pressure; the same letter every
// week is wallpaper, and the player stops reading the in-tray the rest of the game
// speaks through. Escalating to a new tier may follow hard on the last letter — that is
// news — but repeating one must wait out the cooling-off period.
let closestRepeat = Infinity;
for (let i = 0; i < bankLetters.length; i++) {
  for (let j = i + 1; j < bankLetters.length; j++) {
    if (bankLetters[i].headline !== bankLetters[j].headline) continue;
    closestRepeat = Math.min(closestRepeat, bankLetters[j].at - bankLetters[i].at);
  }
}
expect(
  'the bank never sends the same letter twice in quick succession',
  closestRepeat >= BANK.reminderWeeks,
  closestRepeat === Infinity
    ? `${driftLetters.length} letters, none repeated`
    : `closest repeat ${closestRepeat} weeks apart`,
);
expect(
  'and it eventually closes a studio that never recovers',
  sinking.bank.closedDownWeek !== undefined,
  sinking.bank.closedDownReason ?? `debt ${formatMoney(totalDebt(sinking))}`,
);


// ---------------------------------------------------------------------------
// 9. Making a show, rather than picking one
// ---------------------------------------------------------------------------

log('\n[9] Inventing a show from scratch');

{
  const studio = newGame({ seed: seed + 41, studioName: 'Original Pictures' });
  const producer = availableProducers(studio)[0];
  expect('there is a producer to hire', Boolean(producer), producer?.name ?? 'none free');

  const blueprint = blueprintFor('sitcom', 'The Long Way Round');
  blueprint.genre = 'family';
  blueprint.angle = 'comic';
  blueprint.producerId = producer?.id;
  blueprint.castIds = availableFor(studio, 'actor', 'sitcom', 6).map((p) => p.id);
  blueprint.writerIds = availableFor(studio, 'writer', 'sitcom', 2).map((p) => p.id);

  // The creative choices have to move the show, or the flow is a form with a generic
  // show at the end of it. A comic family sitcom must be visibly warmer and funnier
  // than the same format played gritty about crime.
  const warm = previewShow(studio, blueprint);
  const hard = previewShow(studio, { ...blueprint, genre: 'crime', angle: 'gritty' });
  expect(
    'genre and angle change what the show is',
    warm.attributes.wholesomeness > hard.attributes.wholesomeness + 15 &&
      hard.attributes.violence > warm.attributes.violence + 15,
    `warm ${warm.attributes.wholesomeness}/${warm.attributes.violence} vs hard ${hard.attributes.wholesomeness}/${hard.attributes.violence}`,
  );

  const starved = previewShow(studio, { ...blueprint, budgetPerEpisode: Math.round(warm.requiredCostPerEpisode * 0.4) });
  expect(
    'starving the budget shows on screen',
    starved.projectedQuality < warm.projectedQuality - 8,
    `${Math.round(starved.projectedQuality)} vs ${Math.round(warm.projectedQuality)}`,
  );

  const cashBefore = totalCash(studio);
  const made = createShow(studio, blueprint);
  expect('createShow succeeds', made.ok, made.ok ? made.value.title : made.reason);
  if (!made.ok) throw new Error(`could not make a show: ${made.reason}`);

  const invented = made.value;
  expect(
    'the concept is written into the save',
    Boolean(studio.concepts[invented.archetypeId]),
    invented.archetypeId,
  );
  expect(
    'hiring a producer costs real money',
    totalCash(studio) < cashBefore,
    formatMoney(cashBefore - totalCash(studio)),
  );
  expect(
    'the people the player chose are the people on it',
    invented.showrunnerId === producer?.id && invented.cast.length === 6,
    `showrunner ${state.talent[invented.showrunnerId ?? '']?.name ?? '—'}, cast ${invented.cast.length}`,
  );
  log(`  "${invented.title}" — quality ${Math.round(invented.quality)}, angle ${invented.angle}`);

  // The real test: a concept nobody authored has to survive the ordinary weekly tick,
  // which resolves every production's archetype by id.
  for (let i = 0; i < 120; i++) {
    advanceWeek(studio);
    // Take the first bid that comes in, so the show actually reaches air — a concept
    // nobody authored has to survive being rated, reviewed and renewed, not merely sit
    // in development without crashing.
    const bid = studio.offers.find((o) => o.productionId === invented.id);
    if (bid) acceptOffer(studio, bid.id);
  }
  expect(
    'an invented show gets on air and stays there',
    studio.productions[invented.id]?.totalEpisodes > 0,
    `${studio.productions[invented.id]?.status} · ${studio.productions[invented.id]?.totalEpisodes} eps · ${studio.productions[invented.id]?.reviews.length} reviews`,
  );
}

log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

void (state as GameState);
