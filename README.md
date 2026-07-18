# TV Tycoon

A never-ending TV industry management sim for iOS, in the Football Manager mould.
You start as a small studio selling shows to networks. If you make enough hits, you
buy a network. Then you launch a streaming service.

Built with Expo (SDK 57) / React Native + TypeScript.

---

## Running it

Node 20+ is required (the repo was built against Node 22 LTS).

```bash
npm install
npm run web      # fastest preview — opens in a browser
npm run ios      # iOS simulator (needs an installed iOS runtime in Xcode)
```

> **Note:** this machine currently has no iOS simulator runtime installed — the
> simulators listed by `xcrun simctl` are stale entries from an older Xcode. Install
> one via *Xcode → Settings → Platforms* before `npm run ios` will work. `npm run web`
> needs nothing extra.

## Development commands

```bash
npm test              # 33 engine tests
npm run typecheck     # tsc --noEmit
npm run sim 15        # headless: simulate 15 years, print the economy
npm run playthrough   # scripted player path: commission → deal → air → syndicate
```

`npm run sim` is the balance harness. It runs the whole industry for N years in about
a second and prints the ratings distribution, company balances, and a set of assertions
about whether the economy is behaving. Game balance is impossible to tune by playing;
this is how it gets tuned.

---

## Architecture

```
src/engine/     pure TypeScript simulation — no React, no platform APIs
src/data/       120 show archetypes, 180 talent records, 6 audience segments
src/store/      zustand binding + AsyncStorage saves + UI selectors
src/ui/         theme, components, screens
tools/          headless harnesses (sim.ts, playthrough.ts)
docs/DESIGN.md  the full design document — read this first
```

The engine is a **deterministic function of `(state, seed)`**. The RNG cursor lives
inside `GameState`, so a save file replays identically and any bug is reproducible
from a seed. There is no `Math.random()` anywhere in the simulation.

The engine deliberately has no dependency on React Native, which is what lets
`tools/sim.ts` run a hundred simulated years in a terminal.

---

## The core mechanic: deficit financing

This is the thing to understand about the game, and it is how television actually
works.

A network licenses your show for **less than it costs you to make**. You eat the
difference every episode. You make it back on the **back end**: once a show reaches
~65 episodes (about three seasons) it can be sold into syndication, and that library
asset is where a studio's fortune is actually made.

The consequence is the game's central tension: **a show cancelled at season two is a
catastrophe, not a disappointment.** You paid the entire cost of building the asset
and never collected. That is why the renewal decision matters more than any other, and
why the ratings you can see are less important than the episode count you are climbing
toward.

## Other things the model does on purpose

- **Ratings resolve per timeslot, not per show.** Everyone broadcasting at 9pm Thursday
  competes for the same people, segment by segment. Counter-programming therefore works
  *emergently* — a wholesome family sitcom opposite a violent prestige drama keeps
  almost its whole audience, because the two barely overlap. No special case in the code.
- **Who watches matters more than how many.** Advertisers pay ~2.5× more for young
  adults than for seniors, so a show can lose the ratings race and win the revenue race.
- **Craft and star power are separate stats.** The famous and the good are not the same
  people, and the best decisions in the game live in that gap.
- **Quality is derived, never chosen.** It falls out of talent, budget, the archetype's
  ceiling, and a per-season chemistry roll. You choose inputs and live with the output.
- **Violence and edginess are double-edged.** They buy the young-adult demographic and
  cost you advertisers and the family segment — which is the mechanical reason prestige
  violence migrated to subscription in the real world.

## The show database

The 120 archetypes are *inspired by* landmark television but are original works:
original titles, original loglines, original characters. Real TV history is used as a
source of **shapes** — the mob-family prestige drama, the desert-island mystery box —
not as a source of names to file the serial numbers off. This is both the safer
position legally and the better design, since archetypes recombine and the game can
generate shows that never existed.

All 180 hand-authored talent records are fictional people. The engine generates several
hundred more procedurally so the industry never runs short of showrunners, and a fresh
intake of young unknowns arrives every year.

---

## Status

**Done:** simulation engine, content database, economy (studio/network/streaming),
rival AI, talent + pitches + offers, save/load, and five screens — Desk, Slate,
Development, Talent, Industry.

**Next:** the network schedule grid UI (the engine supports it; the player-facing
scheduling screen is not built), contract negotiation, awards season depth, and an
iOS device build.

See `docs/DESIGN.md` §12 for the full build order.
