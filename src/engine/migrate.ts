import type { GameState, Production } from './types';

/**
 * Save migration.
 *
 * Saved games are plain JSON written by whatever version of the engine was running at
 * the time, so a save from last week can be missing fields this week's code assumes
 * exist. Those absences are not harmless: `production.rerunDeals.length` throws on a
 * save written before repeats existed, which breaks the weekly tick outright, and a
 * production with no `rightsOwnerId` silently vanishes from the player's library.
 *
 * Every field added to a saved type needs a backfill here. Migration runs once on
 * load and is deliberately defensive rather than clever — it fills gaps and never
 * reinterprets data it does not recognise.
 */

export interface MigrationReport {
  changed: boolean;
  notes: string[];
}

export function migrateSave(state: GameState): MigrationReport {
  const notes: string[] = [];

  // --- Root collections -------------------------------------------------
  if (!Array.isArray(state.pitches)) {
    state.pitches = [];
    notes.push('added missing pitches');
  }
  if (!Array.isArray(state.offers)) {
    state.offers = [];
    notes.push('added missing offers');
  }
  if (!Array.isArray(state.events)) {
    state.events = [];
    notes.push('added missing events');
  }
  if (typeof state.nextId !== 'number') {
    state.nextId = 100_000;
    notes.push('reset id counter');
  }

  // Concepts moved into the save so playthroughs can diverge. An older save's shows
  // all reference static catalogue ids, and `conceptOf` falls through to those, so an
  // empty map is the correct backfill rather than a broken one.
  if (!state.concepts || typeof state.concepts !== 'object') {
    state.concepts = {};
    notes.push('added concept store');
  }

  // The bank arrived after launch. An existing studio has been operating without a
  // ceiling, so it gets a generous one rather than being foreclosed on load — being
  // shut down by a migration would be an outrageous way to lose a twenty-year run.
  if (!state.bank || typeof state.bank !== 'object') {
    const player = state.companies?.[state.player?.studioId ?? ''];
    const debt = player?.debt ?? 0;
    state.bank = {
      creditLimit: Math.max(25_000_000, Math.ceil(debt * 2)),
      warnings: 0,
    };
    notes.push('opened a bank facility');
  }

  // --- Productions ------------------------------------------------------
  let ownerlessShows = 0;
  let dealless = 0;

  for (const production of Object.values(state.productions ?? {})) {
    const show = production as Production;

    // Rights were introduced after launch. A show with no recorded owner was made by
    // whoever produced it, which is exactly what the field now means.
    if (!show.rightsOwnerId) {
      show.rightsOwnerId = show.ownerId;
      ownerlessShows += 1;
    }

    if (!Array.isArray(show.rerunDeals)) {
      show.rerunDeals = [];
      dealless += 1;
    }

    if (!Array.isArray(show.history)) show.history = [];
    if (!Array.isArray(show.cast)) show.cast = [];
    if (!Array.isArray(show.writerIds)) show.writerIds = [];
    if (typeof show.totalEpisodes !== 'number') show.totalEpisodes = 0;
    if (typeof show.syndicated !== 'boolean') show.syndicated = false;
    if (typeof show.buzz !== 'number') show.buzz = 0;
    if (typeof show.fatigue !== 'number') show.fatigue = 0;

    // Angle, tags and reviews arrived with the reception system. A show made before
    // then was played straight and has earned no reputation yet — which is exactly
    // what these defaults say. `tags` and `reviews` are iterated on the weekly tick,
    // so a missing array is a crash rather than a cosmetic gap.
    if (typeof show.angle !== 'string') show.angle = 'straight';
    if (!Array.isArray(show.tags)) show.tags = [];
    if (!Array.isArray(show.reviews)) show.reviews = [];
  }

  if (ownerlessShows > 0) notes.push(`gave ${ownerlessShows} shows their rightful owner`);
  if (dealless > 0) notes.push(`initialised repeat deals on ${dealless} shows`);
  void dealless;

  // --- Talent -----------------------------------------------------------
  for (const person of Object.values(state.talent ?? {})) {
    if (!person.relationships) person.relationships = {};
    if (typeof person.morale !== 'number') person.morale = 60;
    if (typeof person.heat !== 'number') person.heat = 0;
    if (typeof person.retired !== 'boolean') person.retired = false;

    // Payroll arrived after launch. Nobody on an old save was ever on staff, and
    // `weeksEmployed`/`hits` are accumulated with `+=` on the tick, so they have to be
    // numbers rather than undefined or every payroll figure becomes NaN.
    if (typeof person.onPayroll !== 'boolean') person.onPayroll = false;
    if (typeof person.weeksEmployed !== 'number') person.weeksEmployed = 0;
    if (typeof person.hits !== 'number') person.hits = 0;
  }

  // --- Studio brand and audience trends ---------------------------------
  // Both are derived state, so the safe backfill is to drop them and let the next
  // weekly tick recompute from the slate that is actually there. Inventing values
  // here would assert a reputation the player never earned.
  if (state.brand && typeof state.brand.label !== 'string') {
    delete state.brand;
    notes.push('cleared a malformed studio brand — it will be rederived');
  }
  if (state.trends && typeof state.trends !== 'object') {
    delete state.trends;
    notes.push('cleared malformed audience trends');
  }

  // --- Companies --------------------------------------------------------
  for (const company of Object.values(state.companies ?? {})) {
    if (typeof company.debt !== 'number') company.debt = 0;
    if (typeof company.cash !== 'number') company.cash = 0;
  }

  return { changed: notes.length > 0, notes };
}

/**
 * Cheap structural check before we trust a parsed save at all. A truncated or
 * hand-edited file should start a new game rather than crash the app.
 */
export function looksLikeSave(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameState>;
  return (
    typeof candidate.year === 'number' &&
    typeof candidate.week === 'number' &&
    Boolean(candidate.companies) &&
    Boolean(candidate.productions) &&
    Boolean(candidate.player)
  );
}
