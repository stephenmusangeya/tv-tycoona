import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TVScreen } from '../src/ui/TVScreen';
import { SeasonTimeline } from '../src/ui/SeasonTimeline';
import { Poster } from '../src/ui/Poster';
import { Sidebar } from '../src/ui/Sidebar';
import { newGame } from '../src/engine/setup';
import { advanceWeek } from '../src/engine/tick';
import { developOriginal, acceptOffer } from '../src/engine/actions';
import { SHOW_ARCHETYPES } from '../src/data';
import { latestBreakdown, latestViewers, nowAiring } from '../src/store/selectors';

const state = newGame({ seed: 7, studioName: 'Render Pictures' });
const taken = new Set(Object.values(state.productions).map(p => p.archetypeId));
const target = SHOW_ARCHETYPES.find(a => !taken.has(a.id) && a.format === 'sitcom')!;
const made = developOriginal(state, target.id);
if (!made.ok) throw new Error('could not commission: ' + made.reason);

// Drive the real player path all the way to air, otherwise the "live" TV render
// silently falls back to the no-signal state and verifies nothing.
for (let i = 0; i < 200; i++) {
  advanceWeek(state);
  const offer = state.offers.find(o => o.productionId === made.value.id);
  if (offer) acceptOffer(state, offer.id);
  if (made.value.status === 'airing' && made.value.episodesAiredThisSeason > 2) break;
}
if (made.value.status !== 'airing') {
  throw new Error(`show never reached air (status: ${made.value.status})`);
}

let fails = 0;
function check(label: string, html: string, needles: string[]) {
  const missing = needles.filter(n => !html.includes(n));
  const ok = html.length > 100 && missing.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} (${html.length} chars)${missing.length ? ' missing: ' + missing.join(', ') : ''}`);
}

// --- TV with no signal ---
const off = renderToStaticMarkup(
  <TVScreen year={1} week={5} channelLabel="RENDER PICTURES" />
);
check('TVScreen — no signal', off, ['NO SIGNAL', 'OFF AIR', 'RENDER PICTURES']);

// --- TV live ---
const airing = nowAiring(state)[0];
if (!airing) throw new Error('nothing on air — the live TV render would not be exercised');
const live = renderToStaticMarkup(
  <TVScreen
    airing={airing}
    viewers={airing ? latestViewers(airing) : undefined}
    breakdown={airing ? latestBreakdown(airing) : undefined}
    year={state.year}
    week={state.week}
    channelLabel="RENDER PICTURES"
  />
);
check('TVScreen — live broadcast', live, airing ? ['ON AIR', 'NOW BROADCASTING', airing.title] : ['OFF AIR']);
if (airing) console.log(`      showing "${airing.title}" at ${latestViewers(airing)?.toFixed(1)}M`);

// --- Timeline ---
const timeline = renderToStaticMarkup(<SeasonTimeline week={20} year={2} />);
check('SeasonTimeline', timeline, ['BROADCAST YEAR 2', 'UPF', 'PRM', 'SWP']);

// --- Sidebar full + compact ---
const nav = [
  { key: 'dashboard' as const, label: 'The Desk', icon: 'television' as const },
  { key: 'slate' as const, label: 'My Shows', icon: 'shelf' as const, badge: 3 },
];
const sidebar = renderToStaticMarkup(
  <Sidebar items={nav} active="dashboard" onSelect={() => {}} compact={false}
    studioName="Render Pictures" cash={119900000} year={1} week={12}
    onMakeShow={() => {}} onOpenMenu={() => {}} />
);
check('Sidebar — full', sidebar, ['TV TYCOON', 'MAKE A SHOW', 'The Desk', '$119.9M']);
check('Sidebar has a menu (save/load/quit) button', sidebar, ['Menu']);
// Advancing time belongs to the desk alone — a second control in the rail was
// redundant and made it unclear which one moved the game on.
check('Sidebar has no duplicate advance control', !/NEXT WEEK/.test(sidebar) ? sidebar : '', ['TV TYCOON']);

const compact = renderToStaticMarkup(
  <Sidebar items={nav} active="slate" onSelect={() => {}} compact={true}
    studioName="Render Pictures" cash={119900000} year={1} week={12}
    onMakeShow={() => {}} onOpenMenu={() => {}} />
);
check('Sidebar — compact', compact, ['$119.9M']);

// --- Artwork is ours, not the platform's ---
// Emoji render as another vendor's artwork inside our own and differ per platform.
// These two checks are what stop them creeping back in one convenient glyph at a time.
const posters = renderToStaticMarkup(
  <>
    {SHOW_ARCHETYPES.slice(0, 24).map((a) => (
      <Poster key={a.id} seed={a.id} format={a.format} title={a.title} size="md" />
    ))}
  </>
);
check('Posters draw real icon paths', posters, ['<svg', '<path']);

const EMOJI = /\p{Extended_Pictographic}/u;
for (const [label, markup] of [
  ['posters', posters],
  ['sidebar', sidebar],
  ['the TV', live],
] as const) {
  check(`no emoji in ${label}`, EMOJI.test(markup) ? '' : markup, []);
}

console.log(fails === 0 ? '\nALL RENDER CHECKS PASSED\n' : `\n${fails} RENDER CHECK(S) FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
