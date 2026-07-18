/**
 * Can a finished show always find a buyer?
 *
 * Reproduces the lock-out: rivals fill every network grid, and a full grid used to
 * mean no bid could ever be made, so a player's finished show waited forever.
 */
import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { acceptOffer, developOriginal } from '../src/engine/actions';
import { SHOW_ARCHETYPES } from '../src/data';

let fails = 0;
const check = (l: string, ok: boolean, d = '') => { if (!ok) fails++; console.log(`${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); };

// Run the world forward so every grid saturates, exactly as a real game does.
const state = newGame({ seed: 5, studioName: 'Offer Test' });
for (let i = 0; i < 52 * 3; i++) advanceWeek(state);

const grids = Object.values(state.companies).filter(c => c.type === 'network' && c.schedule);
const emptyTotal = grids.reduce((n, c) => n + Object.values(c.schedule!).filter(v => !v).length, 0);
console.log(`\nafter 3 years: ${grids.length} networks, ${emptyTotal} empty slots across all grids\n`);

// Make a show and see whether anyone ever bids.
const taken = new Set(Object.values(state.productions).filter(p => p.status !== 'cancelled').map(p => p.archetypeId));
const target = SHOW_ARCHETYPES.filter(a => !taken.has(a.id) && a.baseCostPerEpisode < 3_000_000)
  .sort((a, b) => b.attributes.entertainment - a.attributes.entertainment)[0];
const made = developOriginal(state, target.id);
if (!made.ok) throw new Error(made.reason);
console.log(`made "${made.value.title}"`);

let firstOfferWeek = -1;
for (let i = 0; i < 120; i++) {
  advanceWeek(state);
  if (firstOfferWeek === -1 && state.offers.some(o => o.productionId === made.value.id)) {
    firstOfferWeek = i;
  }
}
check('a channel bids within 120 weeks', firstOfferWeek >= 0, firstOfferWeek >= 0 ? `week ${firstOfferWeek}` : 'never bid');

const offer = state.offers.find(o => o.productionId === made.value.id);
if (offer) {
  const network = state.companies[offer.networkId]!;
  const incumbentId = network.schedule![offer.slotKey];
  const contested = Boolean(incumbentId && incumbentId !== made.value.id);
  console.log(`  offer from ${network.name}, slot ${offer.slotKey}${contested ? ' (contested — they will drop a show)' : ' (empty slot)'}`);

  const before = incumbentId ? state.productions[incumbentId] : undefined;
  const res = acceptOffer(state, offer.id);
  check('offer accepted', res.ok, res.ok ? '' : res.reason);
  check('our show now holds the slot', network.schedule![offer.slotKey] === made.value.id);
  if (before) {
    check('displaced show was retired, not orphaned', before.status === 'cancelled' && !before.deal, before.title);
  }
}

// No zombies anywhere: every scheduled id must be a live production.
const zombies = Object.values(state.companies)
  .filter(c => c.schedule)
  .flatMap(c => Object.values(c.schedule!))
  .filter(id => id && state.productions[id]?.status === 'cancelled').length;
check('no cancelled shows left occupying slots', zombies === 0, `${zombies} zombies`);

console.log(fails === 0 ? '\nALL OFFER CHECKS PASSED\n' : `\n${fails} FAILED\n`);
process.exit(fails ? 1 : 0);
