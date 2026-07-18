/**
 * Reproduce the "Shows owned: 0" bug from a real save and prove migration fixes it.
 *
 * Simulates a save written by the build that shipped before shows had owners, by
 * deleting the fields that version did not know about.
 */
import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { developOriginal, acceptOffer } from '../src/engine/actions';
import { migrateSave, looksLikeSave } from '../src/engine/migrate';
import { SHOW_ARCHETYPES } from '../src/data';
import { playerLibrary, libraryWorth } from '../src/store/selectors';

let fails = 0;
const check = (l: string, ok: boolean, d = '') => { if (!ok) fails++; console.log(`${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); };

const state = newGame({ seed: 7, studioName: 'Old Save Pictures' });
const taken = new Set(Object.values(state.productions).map(p => p.archetypeId));
const target = SHOW_ARCHETYPES.find(a => !taken.has(a.id) && a.format === 'sitcom')!;
const made = developOriginal(state, target.id);
if (!made.ok) throw new Error(made.reason);
for (let i = 0; i < 300; i++) {
  advanceWeek(state);
  const o = state.offers.find(x => x.productionId === made.value.id);
  if (o) acceptOffer(state, o.id);
  if (made.value.totalEpisodes >= 12) break;
}
console.log(`\nBefore downgrade: ${playerLibrary(state).length} shows owned\n`);

// --- Write it out the way the OLD build would have ---
const oldSave = JSON.parse(JSON.stringify(state));
for (const p of Object.values<any>(oldSave.productions)) {
  delete p.rightsOwnerId;
  delete p.rerunDeals;
}
delete oldSave.offers;

console.log('=== Loading that save with TODAY\'s code ===');
check('save still recognised as a save', looksLikeSave(oldSave));

// Without migration the tick crashes on the missing field.
let crashed = false;
try {
  const unmigrated = JSON.parse(JSON.stringify(oldSave));
  unmigrated.offers = [];
  advanceWeek(unmigrated);
} catch (e) {
  crashed = true;
  console.log(`      unmigrated tick threw: ${(e as Error).message.slice(0, 60)}`);
}
check('unmigrated old save DOES crash the week tick', crashed);

// --- Now migrate ---
const report = migrateSave(oldSave);
console.log(`\n=== After migration ===`);
report.notes.forEach(n => console.log(`      ${n}`));

check('migration reported changes', report.changed);
check('shows have their owner back', playerLibrary(oldSave).length > 0, `${playerLibrary(oldSave).length} owned`);
check('library has a value again', libraryWorth(oldSave) > 0, `$${(libraryWorth(oldSave)/1e6).toFixed(1)}M`);

let ok2 = true;
try { advanceWeek(oldSave); advanceWeek(oldSave); } catch (e) { ok2 = false; console.log('      ' + (e as Error).message); }
check('migrated save advances without crashing', ok2);

// --- Junk must not crash the app ---
check('rejects a truncated file', !looksLikeSave({ year: 1 }));
check('rejects null', !looksLikeSave(null));
check('rejects a string', !looksLikeSave('nonsense'));

console.log(fails === 0 ? '\nALL MIGRATION CHECKS PASSED\n' : `\n${fails} FAILED\n`);
process.exit(fails ? 1 : 0);
