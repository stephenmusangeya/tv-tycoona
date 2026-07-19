import { newGame } from './src/engine/setup';
import { advanceWeek } from './src/engine/tick';
import { acceptOffer, developOriginal } from './src/engine/actions';
import { SHOW_ARCHETYPES } from './src/data';
import { AUDIENCE_SEGMENTS } from './src/data/segments';

const state = newGame({ seed: 11, studioName: 'Meridian Pictures' });
const used = new Set(Object.values(state.productions).map(p => p.archetypeId));
let idx = 0;
for (let i = 0; i < 52 * 25; i++) {
  // keep 3 player shows in flight
  const live = Object.values(state.productions).filter(p => p.ownerId === state.player.studioId && p.status !== 'cancelled' && p.status !== 'ended');
  if (live.length < 3) {
    while (idx < SHOW_ARCHETYPES.length && used.has(SHOW_ARCHETYPES[idx].id)) idx++;
    const a = SHOW_ARCHETYPES[idx];
    if (a) { used.add(a.id); developOriginal(state, a.id); }
  }
  advanceWeek(state);
  for (const o of [...state.offers]) {
    const p = state.productions[o.productionId];
    if (p && p.ownerId === state.player.studioId) acceptOffer(state, o.id);
  }
}
const mine = Object.values(state.productions).filter(p => p.ownerId === state.player.studioId && p.reviews.length);
console.log('player shows with reviews:', mine.length);
for (const p of mine.slice(0, 3)) {
  console.log(`\n=== ${p.title} (${p.format}, ${p.angle}) q=${Math.round(p.quality)} chem=${Math.round(p.chemistry)} fat=${p.fatigue.toFixed(2)} eps=${p.totalEpisodes} tags=[${p.tags}]`);
  for (const r of p.reviews.slice(-3)) {
    console.log(`  S${r.season} ${r.outlet} ${r.score}/100 — ${r.verdict}`);
    console.log(`    + ${r.praise.join(' | ') || '(none)'}`);
    console.log(`    - ${r.criticism.join(' | ') || '(none)'}`);
  }
}
const all = Object.values(state.productions);
const scores = all.flatMap(p => p.reviews.map(r => r.score)).sort((a,b)=>a-b);
const q = (f:number) => scores[Math.floor(scores.length*f)];
console.log('\nscores n=%d min=%d p10=%d p25=%d med=%d p75=%d p90=%d max=%d', scores.length, scores[0], q(.1), q(.25), q(.5), q(.75), q(.9), scores.at(-1));
const tagCount: Record<string, number> = {};
for (const p of all) for (const t of p.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
console.log('tags across %d shows:', all.length, tagCount);
// how many shows even qualify structurally
const longRun = all.filter(p => p.history.length >= 3).length;
console.log('shows with 3+ seasons:', longRun, '| 60+ eps:', all.filter(p=>p.totalEpisodes>=60).length);
// segment share distribution for kids+teens
const shares = all.filter(p=>p.totalEpisodes>=60).map(p => {
  let t=0, tot=0;
  for (const s of p.history) for (const seg of AUDIENCE_SEGMENTS) { const v = s.viewersBySegment?.[seg.id] ?? 0; tot+=v; if (seg.id==='kids'||seg.id==='teens') t+=v; }
  return tot ? t/tot : 0;
}).sort((a,b)=>b-a);
console.log('kids+teens share top5:', shares.slice(0,5).map(x=>x.toFixed(2)).join(' '));
console.log('max reviews stored:', Math.max(...all.map(p=>p.reviews.length)));
console.log('brand:', state.brand);
console.log('\nin-tray sample:');
for (const e of state.events.filter(e => e.playerRelevant && (e.kind === 'award' || e.headline.includes('/100') || e.headline.includes('known for'))).slice(-8)) {
  console.log(` [${e.kind}] ${e.headline}\n     ${e.body ?? ''}`);
}
const a2 = newGame({ seed: 4 }); const b2 = newGame({ seed: 4 });
for (let i=0;i<400;i++){ advanceWeek(a2); advanceWeek(b2); }
console.log('\ndeterministic:', a2.rngState === b2.rngState && JSON.stringify(a2.brand) === JSON.stringify(b2.brand));
