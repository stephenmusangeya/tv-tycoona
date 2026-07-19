import { AUDIENCE_SEGMENTS, conceptOf, getArchetype } from '../data';
import {
  ECONOMY,
  adRevenueForEpisode,
  canSyndicate,
  episodeCost,
  simulateStreamingMonth,
  syndicationResidual,
  syndicationValue,
  weeklyInterest,
  weeklyOverhead,
} from './economy';
import { isClosedDown, reviewBank } from './bank';
import { refreshQuality, releaseTalent } from './production';
import { rollChemistry } from './quality';
import { decayBuzz, seasonFatigueIncrement, simulateSlot } from './ratings';
import type { SlotEntrant } from './ratings';
import {
  TAG_LABELS,
  computeStudioBrand,
  criticRng,
  earnedTags,
  fileReview,
  hadScandal,
  reviewSeason,
} from './reception';
import { clamp, createRng } from './rng';
import type { Rng } from './rng';
import {
  WEEK_AWARDS,
  WEEK_MIDSEASON,
  WEEK_SEASON_PREMIERE,
  WEEK_UPFRONTS,
  WEEKS_PER_YEAR,
  episodesPerWeek,
  isSummer,
  isSweeps,
  parseSlotKey,
} from './schedule';
import { generateRookieClass, padTalentPool } from './talentGen';
import { runRivalTurn } from './rivals';
import { generatePitches } from './pitches';
import { creditSeason, tickStaff } from './staff';
import { tickCasting } from './casting';
import type {
  Company,
  GameEvent,
  GameEventKind,
  GameState,
  Production,
  RunningSeason,
  SeasonRecord,
  SegmentId,
  ShowArchetype,
  WeekResult,
} from './types';

/**
 * The weekly tick — the single entry point that moves the world forward.
 *
 * Everything in here is driven by the seeded RNG carried in GameState, so replaying a
 * save from the same point produces byte-identical results. See docs/DESIGN.md §2.
 */

function emptySegments(): Record<SegmentId, number> {
  return Object.fromEntries(AUDIENCE_SEGMENTS.map((s) => [s.id, 0])) as Record<
    SegmentId,
    number
  >;
}

function newRunningSeason(): RunningSeason {
  return {
    episodes: 0,
    viewersSum: 0,
    viewersBySegmentSum: emptySegments(),
    qualitySum: 0,
    studioProfit: 0,
    networkProfit: 0,
  };
}

export function advanceWeek(state: GameState): WeekResult {
  /**
   * A closed-down studio has no next week.
   *
   * Returning the current position unchanged rather than throwing keeps every caller —
   * the store, the harnesses, a player mashing PLAY WEEK — working without a special
   * case, while making it impossible to quietly keep playing a run that is over.
   */
  if (isClosedDown(state)) {
    return {
      year: state.year,
      week: state.week,
      events: [],
      playerCashDelta: 0,
      airedThisWeek: [],
    };
  }

  const rng = createRng(state.rngState);
  const events: GameEvent[] = [];
  const cashBefore = playerCash(state);

  const mintId = (prefix: string) => `${prefix}_${(state.nextId++).toString(36)}`;
  const emit = (
    kind: GameEventKind,
    headline: string,
    extra: Partial<GameEvent> = {},
  ) => {
    const event: GameEvent = {
      id: mintId('ev'),
      week: state.week,
      year: state.year,
      kind,
      headline,
      playerRelevant: false,
      ...extra,
    };
    events.push(event);
    return event;
  };

  const ctx: TickContext = { state, rng, emit, mintId };

  // --- Calendar beats that happen before anything airs --------------------
  if (state.week === WEEK_SEASON_PREMIERE || state.week === WEEK_MIDSEASON) {
    launchScheduledShows(ctx);
  }
  if (state.week === WEEK_AWARDS) {
    runAwards(ctx);
  }

  advanceDevelopment(ctx);

  // --- Air this week's episodes -------------------------------------------
  const aired = airWeek(ctx);

  // --- Company upkeep ------------------------------------------------------
  payRerunIncome(ctx);
  // Before overheads on purpose: that is what turns a payroll the studio cannot cover
  // into debt in the same week, rather than leaving cash visibly negative until the
  // next tick picks it up.
  tickStaff(state, rng, emit);
  // Scouting sits between payroll and overheads on purpose: a casting director is a
  // standing cost, so an unaffordable fee has to land as debt in the same week it is
  // incurred rather than being quietly deferred. Returns before touching the RNG when
  // nobody is employed, so a studio with no casting department cannot have its stream
  // shifted by a department it does not have.
  tickCasting(state, rng, mintId, emit);
  applyOverheads(ctx);

  // Streaming settles monthly, not weekly.
  if (state.week % 4 === 0) {
    settleStreamers(ctx);
  }

  // --- Later calendar beats ------------------------------------------------
  if (state.week === WEEK_UPFRONTS) {
    runUpfronts(ctx);
  }

  updateTalent(ctx);

  // The brand is derived from the whole slate, so it only moves at the speed shows do.
  // Rebuilding it weekly would be waste; a monthly refresh (plus the one forced at
  // every season wrap) keeps it honest without walking every production every tick.
  if (!state.brand || state.absoluteWeek % 4 === 0) {
    refreshBrand(ctx);
  }

  generatePitches(state, rng, mintId, emit);
  runRivalTurn(state, rng, mintId, emit);

  // Last, so the bank's letter quotes the position the player is about to read on the
  // desk rather than a figure the rest of the week then moved.
  reviewBank(state, emit);

  // --- Roll the calendar ---------------------------------------------------
  state.week += 1;
  state.absoluteWeek += 1;
  if (state.week > WEEKS_PER_YEAR) {
    state.week = 1;
    state.year += 1;
    runAnnualTurnover(ctx);
  }

  state.rngState = rng.state();
  state.events.push(...events);
  // Keep the news feed bounded — old items are not worth the save-file bytes.
  if (state.events.length > 400) {
    state.events = state.events.slice(-400);
  }

  return {
    year: state.year,
    week: state.week,
    events,
    playerCashDelta: playerCash(state) - cashBefore,
    airedThisWeek: aired,
  };
}

interface TickContext {
  state: GameState;
  rng: Rng;
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent;
  mintId: (prefix: string) => string;
}

// ---------------------------------------------------------------------------
// Airing
// ---------------------------------------------------------------------------

/**
 * Air every scheduled episode for the week.
 *
 * Shows are grouped by slot *across all networks*, because that is what competition
 * actually is: everyone broadcasting at 9pm on Thursday is fighting over the same
 * living rooms. See ratings.ts for the allocation.
 */
function airWeek(ctx: TickContext): WeekResult['airedThisWeek'] {
  const { state, rng, emit } = ctx;
  const sweeps = isSweeps(state.week);
  const summer = isSummer(state.week);

  const bySlot = new Map<string, SlotEntrant[]>();
  const unscheduled: SlotEntrant[] = [];

  for (const production of Object.values(state.productions)) {
    if (production.status !== 'airing' || !production.deal) continue;
    if (production.episodesAiredThisSeason >= production.episodesPerSeason) continue;

    const network = state.companies[production.deal.networkId];
    if (!network) continue;

    const entrant: SlotEntrant = {
      production,
      archetype: conceptOf(state.concepts, production.archetypeId),
      network,
    };

    // Streamers have no grid — nothing competes for a timeslot that does not exist.
    if (network.type === 'streamer') {
      unscheduled.push(entrant);
      continue;
    }

    const key = production.deal.slotKey;
    const group = bySlot.get(key);
    if (group) group.push(entrant);
    else bySlot.set(key, [entrant]);
  }

  const aired: WeekResult['airedThisWeek'] = [];

  const resolve = (entrants: SlotEntrant[], hour: number, slotKey?: string) => {
    const outcomes = simulateSlot(entrants, state.talent, {
      hour,
      isSweeps: sweeps,
      isPremiere: entrants.some((e) => e.production.episodesAiredThisSeason === 0),
      noise: () => rng.range(0.9, 1.1),
    });

    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      const entrant = entrants.find((e) => e.production.id === outcome.productionId);
      if (!entrant) continue;

      // Summer viewing is simply lower across the board.
      const seasonal = summer ? 0.78 : 1;
      outcome.viewers *= seasonal;
      for (const key of Object.keys(outcome.viewersBySegment) as SegmentId[]) {
        outcome.viewersBySegment[key] *= seasonal;
      }

      settleEpisode(ctx, entrant, outcome.viewers, outcome.viewersBySegment, sweeps);

      aired.push({
        productionId: outcome.productionId,
        title: entrant.production.title,
        viewers: outcome.viewers,
        viewersBySegment: outcome.viewersBySegment,
        slotKey,
      });
    }
  };

  for (const [key, entrants] of bySlot) {
    resolve(entrants, parseSlotKey(key).hour, key);
  }
  // Streaming releases are resolved individually at a notional prime hour.
  for (const entrant of unscheduled) {
    resolve([entrant], 21);
  }

  // Buzz decays for everything, aired or not.
  for (const production of Object.values(state.productions)) {
    production.buzz = decayBuzz(production.buzz);
  }

  void emit; // events for airing are emitted inside settleEpisode
  return aired;
}

/**
 * Money and bookkeeping for the episodes one show airs in a week.
 *
 * `viewers` is a per-episode figure; strips air five of them, so the money multiplies
 * but the ratings number the player sees does not.
 */
function settleEpisode(
  ctx: TickContext,
  entrant: SlotEntrant,
  viewers: number,
  viewersBySegment: Record<SegmentId, number>,
  sweeps: boolean,
): void {
  const { state, emit } = ctx;
  const { production, network } = entrant;
  const deal = production.deal!;

  const studio = state.companies[production.ownerId];

  // Strips air five nights a week — costs, fees and ad revenue all scale with it.
  const remaining = production.episodesPerSeason - production.episodesAiredThisSeason;
  const count = Math.max(1, Math.min(episodesPerWeek(production.format), remaining));

  const cost = episodeCost(production) * count;
  const fee = deal.licenseFeePerEpisode * count;

  const adRevenue =
    network.type === 'streamer'
      ? 0 // streamers earn from subscriptions, settled monthly
      : adRevenueForEpisode(viewersBySegment, production.attributes, sweeps) * count;

  if (studio && studio.id === network.id) {
    // In-house production: one company carries both sides of the ledger.
    network.cash += adRevenue - cost;
  } else {
    if (studio) studio.cash += fee - cost;
    network.cash += adRevenue - fee;
  }

  production.episodesAiredThisSeason += count;
  production.totalEpisodes += count;

  const running = (production.runningSeason ??= newRunningSeason());
  running.episodes += count;
  running.viewersSum += viewers * count;
  running.qualitySum += production.quality * count;
  running.studioProfit += studio && studio.id === network.id ? adRevenue - cost : fee - cost;
  running.networkProfit += adRevenue - (studio?.id === network.id ? cost : fee);
  for (const key of Object.keys(viewersBySegment) as SegmentId[]) {
    running.viewersBySegmentSum[key] += viewersBySegment[key] * count;
  }

  // A strong showing feeds momentum; a weak one bleeds it.
  const expectation = production.history.at(-1)?.averageViewers ?? 5;
  if (viewers > expectation * 1.25) {
    production.buzz = clamp(production.buzz + 6);
  }

  if (production.episodesAiredThisSeason >= production.episodesPerSeason) {
    wrapSeason(ctx, production);
  }

  void emit;
}

/** Fold a completed season into history and decide what happens next. */
function wrapSeason(ctx: TickContext, production: Production): void {
  const { state, rng, emit } = ctx;
  const running = production.runningSeason ?? newRunningSeason();
  const episodes = Math.max(1, running.episodes);

  const viewersBySegment = emptySegments();
  for (const key of Object.keys(running.viewersBySegmentSum) as SegmentId[]) {
    viewersBySegment[key] = running.viewersBySegmentSum[key] / episodes;
  }

  const record: SeasonRecord = {
    season: production.season,
    episodes: running.episodes,
    averageViewers: running.viewersSum / episodes,
    averageQuality: running.qualitySum / episodes,
    viewersBySegment,
    studioProfit: running.studioProfit,
    networkProfit: running.networkProfit,
  };

  const archetype = conceptOf(state.concepts, production.archetypeId);

  production.history.push(record);

  // The only moment the simulation knows how a season actually went, so it is the
  // only place experience can be credited. Without this, payroll and loyalty still
  // work but nobody ever gets better at their job.
  creditSeason(state, production, rng, emit);

  production.runningSeason = undefined;
  production.status = 'hiatus';
  production.fatigue = Math.min(
    0.85,
    production.fatigue + seasonFatigueIncrement(production, archetype),
  );

  const owner = state.companies[production.ownerId];
  const isPlayerOwned = isPlayerCompany(state, production.ownerId);

  emit('ratings', `${production.title} wraps season ${production.season}`, {
    body: `Averaged ${record.averageViewers.toFixed(1)}M viewers across ${record.episodes} episodes.`,
    playerRelevant: isPlayerOwned,
    productionId: production.id,
    companyId: production.ownerId,
  });

  fileSeasonReview(ctx, production, archetype, isPlayerOwned);
  awardSeasonTags(ctx, production, isPlayerOwned);

  // The back end finally pays out — see DESIGN.md §7.1.
  if (canSyndicate(production)) {
    const value = syndicationValue(production);
    production.syndicated = true;
    if (owner) owner.cash += value;
    emit('money', `${production.title} sells into syndication`, {
      body: `${production.totalEpisodes} episodes banked. ${formatMoney(value)} to ${owner?.name ?? 'the studio'}.`,
      playerRelevant: isPlayerOwned,
      productionId: production.id,
      companyId: production.ownerId,
    });
  }

  // The slate just changed shape, so the public reading of it has too.
  if (isPlayerOwned) refreshBrand(ctx);

  void rng;
}

// ---------------------------------------------------------------------------
// Reception — reviews, reputations and the studio's public identity
// ---------------------------------------------------------------------------

/**
 * The press respond to a finished season.
 *
 * This is the game's answer to "why is my show doing well or badly?", so the player's
 * notice is always emitted, whatever the score — a mediocre review is still a list of
 * things to fix. Rival shows are only reported when the notice is remarkable, because
 * the in-tray is the player's, not the industry's.
 */
function fileSeasonReview(
  ctx: TickContext,
  production: Production,
  archetype: ShowArchetype,
  isPlayerOwned: boolean,
): void {
  const { state, emit } = ctx;

  const review = reviewSeason({
    production,
    archetype,
    talent: state.talent,
    week: state.absoluteWeek,
    // Not ctx.rng on purpose — the critics get their own derived stream so that what
    // they say can never change what happens. See criticRng in reception.ts.
    rng: criticRng(state.seed, state.absoluteWeek, production.id),
  });
  fileReview(production, review);

  const rave = review.score >= 88;
  if (!isPlayerOwned && !rave) return;

  // The body carries the diagnosis: what to keep, and what to change before the next
  // commission. Two lines, because a note the player will not read is not a note.
  const lines = [review.verdict];
  if (review.praise[0]) lines.push(review.praise[0]);
  if (review.criticism[0]) lines.push(review.criticism[0]);

  emit('ratings', `${review.outlet} on ${production.title}: ${review.score}/100`, {
    body: lines.join(' '),
    playerRelevant: isPlayerOwned,
    productionId: production.id,
    companyId: production.ownerId,
  });
}

/** Reputations are announced, not discovered — a tag the player never noticed is wasted. */
function awardSeasonTags(
  ctx: TickContext,
  production: Production,
  isPlayerOwned: boolean,
): void {
  const { state, emit } = ctx;

  const earned = earnedTags(production, hadScandal(state, production.id));
  if (earned.length === 0) return;

  production.tags.push(...earned);

  for (const tag of earned) {
    emit('award', `${production.title} is now ${TAG_LABELS[tag]}`, {
      body: `Earned after ${production.totalEpisodes} episodes. Reputations like this raise what the library is worth.`,
      playerRelevant: isPlayerOwned,
      productionId: production.id,
      companyId: production.ownerId,
    });
  }
}

/**
 * Recompute how the public reads the studio.
 *
 * Only the change of *label* is worth telling the player about: the axes drift every
 * month and reporting that would be noise, but "you are now a prestige house" is a
 * genuine event, and one they arrived at by making things rather than choosing it.
 */
function refreshBrand(ctx: TickContext): void {
  const { state, emit } = ctx;

  const previous = state.brand;
  const brand = computeStudioBrand(state);
  state.brand = brand;

  if (!previous || previous.label === brand.label || brand.label === 'Unproven') return;

  emit('ratings', `Your studio is now known for: ${brand.label}`, {
    body: `The trades used to call you ${previous.label}. Your slate has changed what people expect from you.`,
    playerRelevant: true,
    companyId: state.player.studioId,
  });
}

// ---------------------------------------------------------------------------
// Calendar beats
// ---------------------------------------------------------------------------

/** Premiere week: everything with a slot and a green light goes on air. */
function launchScheduledShows(ctx: TickContext): void {
  const { state, rng, emit } = ctx;

  for (const production of Object.values(state.productions)) {
    if (production.status !== 'hiatus' || !production.deal) continue;

    production.status = 'airing';
    production.episodesAiredThisSeason = 0;
    production.runningSeason = newRunningSeason();
    if (production.history.length > 0) production.season += 1;

    // Fresh chemistry roll each season — casts change, rooms change, luck changes.
    production.chemistry = rollChemistry(production, state.talent, (m, s) => rng.normal(m, s));
    refreshQuality(production, conceptOf(state.concepts, production.archetypeId), state.talent);
    production.buzz = clamp(production.buzz + 20);

    if (isPlayerCompany(state, production.ownerId)) {
      emit('milestone', `${production.title} premieres`, {
        body: `Season ${production.season}. Quality ${Math.round(production.quality)}.`,
        playerRelevant: true,
        productionId: production.id,
      });
    }
  }
}

/** Shows in development gradually become ready to schedule. */
function advanceDevelopment(ctx: TickContext): void {
  const { state, emit } = ctx;

  for (const production of Object.values(state.productions)) {
    if (production.status !== 'development') continue;
    if (production.developmentWeeksRemaining === undefined) continue;

    production.developmentWeeksRemaining -= 1;
    if (production.developmentWeeksRemaining > 0) continue;

    production.status = 'hiatus';
    production.developmentWeeksRemaining = undefined;

    if (isPlayerCompany(state, production.ownerId)) {
      emit('milestone', `${production.title} is ready to air`, {
        body: 'Production wrapped. It needs a network and a slot.',
        playerRelevant: true,
        productionId: production.id,
      });
    }
  }
}

/**
 * Upfronts: networks decide what comes back.
 *
 * The renewal test is deliberately network-centric — a network cancels on *its* P&L,
 * not on whether the studio has recouped. That is precisely the squeeze that makes
 * the studio game hard, because your show can be cancelled at 44 episodes purely
 * because someone else's arithmetic said so.
 */
function runUpfronts(ctx: TickContext): void {
  const { state, rng, emit } = ctx;

  for (const network of Object.values(state.companies)) {
    if (network.type !== 'network' || !network.schedule) continue;

    for (const [slotKey, productionId] of Object.entries(network.schedule)) {
      if (!productionId) continue;
      const production = state.productions[productionId];
      if (!production || production.status === 'cancelled') continue;

      const lastSeason = production.history.at(-1);
      if (!lastSeason) continue;

      /**
       * A show that has not aired anything since it was scheduled is not up for renewal.
       *
       * The renewal test reads `history.at(-1)`, which assumes the newest season record
       * is the one that just ran. That holds for an incumbent, but not for a show
       * holding a signed deal it has yet to broadcast under — a revival. Its newest
       * record is from its *previous* life, so it was being judged on the very season
       * that got it cancelled and could be dropped before airing a single frame, taking
       * the slot and the deal with it. A network cannot cancel a show it has not seen.
       *
       * `episodesAiredThisSeason` is the honest signal: the premiere zeroes it and every
       * episode raises it, so it is only zero between being scheduled and going to air.
       */
      if (production.episodesAiredThisSeason === 0) continue;

      const profitable = lastSeason.networkProfit > 0;
      const strongRatings = lastSeason.averageViewers > 4.5;
      const beloved = production.quality > 72;

      // Even a marginal show survives if it is cheap and inoffensive; the killer
      // combination is expensive, unwatched, and out of creative road.
      let renewChance = 0.15;
      if (profitable) renewChance += 0.45;
      if (strongRatings) renewChance += 0.25;
      if (beloved) renewChance += 0.15;
      renewChance -= production.fatigue * 0.4;

      if (rng.chance(clamp(renewChance, 0.02, 0.97))) {
        production.deal!.seasonsRemaining = Math.max(1, production.deal!.seasonsRemaining);
        continue;
      }

      cancelProduction(ctx, production, network, slotKey);
    }
  }

  void emit;
}

export function cancelProduction(
  ctx: TickContext,
  production: Production,
  network: Company | undefined,
  slotKey: string | undefined,
): void {
  const { state, emit } = ctx;

  production.status = 'cancelled';
  releaseTalent(production, state.talent);

  if (network?.schedule && slotKey) network.schedule[slotKey] = null;
  production.deal = undefined;

  const isPlayerOwned = isPlayerCompany(state, production.ownerId);
  const stranded =
    !production.syndicated && production.totalEpisodes < ECONOMY.syndicationThreshold;

  emit('deal', `${production.title} cancelled`, {
    body: stranded
      ? `Cancelled ${ECONOMY.syndicationThreshold - production.totalEpisodes} episodes short of syndication. The deficit is unrecoverable.`
      : `Ends after ${production.totalEpisodes} episodes.`,
    playerRelevant: isPlayerOwned,
    productionId: production.id,
    companyId: production.ownerId,
  });
}

/**
 * Awards night. Prestige converts into critical standing, which is the currency that
 * buys access to talent who would otherwise not take your calls.
 */
function runAwards(ctx: TickContext): void {
  const { state, rng, emit } = ctx;

  const eligible = Object.values(state.productions).filter(
    (p) => p.history.length > 0 && (p.status === 'airing' || p.status === 'hiatus'),
  );
  if (eligible.length === 0) return;

  const contenders = eligible
    .map((production) => ({
      production,
      score:
        production.attributes.prestige * 0.55 +
        production.quality * 0.35 +
        rng.range(0, 22),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (let i = 0; i < contenders.length; i++) {
    const { production } = contenders[i];
    const owner = state.companies[production.ownerId];
    const isWinner = i === 0;

    production.buzz = clamp(production.buzz + (isWinner ? 34 : 14));
    if (owner) {
      owner.criticalStanding = clamp(owner.criticalStanding + (isWinner ? 7 : 2.5));
    }

    emit('award', isWinner ? `${production.title} wins Best Series` : `${production.title} nominated`, {
      playerRelevant: isPlayerCompany(state, production.ownerId),
      productionId: production.id,
      companyId: production.ownerId,
    });
  }
}

// ---------------------------------------------------------------------------
// Companies & talent
// ---------------------------------------------------------------------------

/**
 * Pay out repeat deals.
 *
 * Money that arrives for doing nothing, from episodes made years ago. This is the
 * payoff for owning your shows and the clearest signal that a library is an asset
 * rather than a filing cabinet.
 */
function payRerunIncome(ctx: TickContext): void {
  const { state, emit } = ctx;

  for (const production of Object.values(state.productions)) {
    if (production.rerunDeals.length === 0) continue;

    const owner = state.companies[production.rightsOwnerId];
    let expired = false;

    for (const deal of production.rerunDeals) {
      if (owner) owner.cash += deal.weeklyPayment;
      deal.weeksRemaining -= 1;
      if (deal.weeksRemaining <= 0) expired = true;
    }

    if (expired) {
      const ending = production.rerunDeals.filter((d) => d.weeksRemaining <= 0);
      production.rerunDeals = production.rerunDeals.filter((d) => d.weeksRemaining > 0);

      for (const deal of ending) {
        emit('money', `${deal.buyerName} stops showing repeats of ${production.title}`, {
          body: 'You can sell the repeats again to someone else.',
          playerRelevant: isPlayerCompany(state, production.rightsOwnerId),
          productionId: production.id,
        });
      }
    }
  }
}

function applyOverheads(ctx: TickContext): void {
  const { state } = ctx;

  const slateSize = new Map<string, number>();
  for (const production of Object.values(state.productions)) {
    if (production.status === 'cancelled' || production.status === 'ended') continue;
    slateSize.set(production.ownerId, (slateSize.get(production.ownerId) ?? 0) + 1);
  }

  for (const company of Object.values(state.companies)) {
    company.cash -= weeklyOverhead(company, slateSize.get(company.id) ?? 0);
    company.cash -= weeklyInterest(company.debt);

    // Going negative converts into debt rather than a game over — you are allowed
    // to be in trouble for a long time, which is the point of a never-ending game.
    if (company.cash < 0) {
      company.debt += -company.cash;
      company.cash = 0;
    }
  }
}

function settleStreamers(ctx: TickContext): void {
  const { state, emit } = ctx;

  for (const company of Object.values(state.companies)) {
    if (company.type !== 'streamer') continue;

    const owned = Object.values(state.productions).filter(
      (p) => p.deal && p.deal.networkId === company.id,
    );
    const libraryEpisodes = owned.reduce((sum, p) => sum + p.totalEpisodes, 0);
    const releaseStrength = owned
      .filter((p) => p.status === 'airing')
      .reduce((sum, p) => sum + (p.quality / 100) * (0.5 + p.buzz / 200), 0);

    const result = simulateStreamingMonth({
      subscribers: company.subscribers ?? 0,
      monthlyPrice: company.monthlyPrice ?? 12,
      libraryEpisodes,
      releaseStrength,
      criticalStanding: company.criticalStanding,
    });

    company.subscribers = result.subscribers;
    company.cash += result.revenue;

    if (isPlayerCompany(state, company.id)) {
      emit('money', `${company.name}: ${result.subscribers.toFixed(1)}M subscribers`, {
        body: `+${result.added.toFixed(2)}M added, -${result.churned.toFixed(2)}M churned.`,
        playerRelevant: true,
        companyId: company.id,
      });
    }
  }
}

/** Weekly talent drift: morale, heat, contracts, and the occasional disaster. */
function updateTalent(ctx: TickContext): void {
  const { state, rng, emit } = ctx;

  for (const person of Object.values(state.talent)) {
    if (person.retired) continue;

    // Heat fades without exposure; working keeps you warm.
    person.heat = person.productionId ? clamp(person.heat + 0.3) : clamp(person.heat - 0.4);

    // Idle talent gets restless.
    person.morale = clamp(person.morale + (person.productionId ? 0.15 : -0.25));

    if (person.contractWeeksRemaining !== undefined) {
      person.contractWeeksRemaining -= 1;
    }

    // Unreliable people generate incidents. Rare per-week, common over a career.
    const incidentChance = ((100 - person.reliability) / 100) * 0.0018;
    if (person.productionId && rng.chance(incidentChance)) {
      const production = state.productions[person.productionId];
      if (!production) continue;

      production.buzz = clamp(production.buzz + 12); // scandal is still attention
      production.chemistry = clamp(production.chemistry - rng.range(6, 18));
      refreshQuality(production, conceptOf(state.concepts, production.archetypeId), state.talent);
      person.morale = clamp(person.morale - rng.range(5, 20));

      emit('scandal', `${person.name} in trouble on ${production.title}`, {
        body: 'Production disrupted. Chemistry has taken a hit.',
        playerRelevant: isPlayerCompany(state, production.ownerId),
        talentId: person.id,
        productionId: production.id,
      });
    }
  }
}

/**
 * Year end: everyone gets a year older, some retire, a new intake arrives, and
 * library residuals are paid. This is what keeps a never-ending game from ossifying.
 */
function runAnnualTurnover(ctx: TickContext): void {
  const { state, rng, emit, mintId } = ctx;

  for (const person of Object.values(state.talent)) {
    if (person.retired) continue;
    person.age += 1;

    // Actors trade on presence and lose it; writers and showrunners keep improving.
    const presenceRole = person.role === 'actor' || person.role === 'host';
    if (presenceRole && person.age > 50) {
      person.starPower = clamp(person.starPower - rng.range(0.5, 3));
    }
    if (person.age < 45) {
      person.craft = clamp(person.craft + rng.range(0.2, 1.4));
    }

    const retirementAge = presenceRole ? 72 : 78;
    if (person.age > retirementAge && rng.chance(0.25) && !person.productionId) {
      person.retired = true;
      if (person.starPower > 70) {
        emit('talent', `${person.name} retires`, { talentId: person.id });
      }
    }
  }

  generateRookieClass(state.talent, rng, mintId, {
    actor: 26,
    writer: 14,
    showrunner: 6,
    producer: 4,
    director: 6,
    host: 3,
  });

  // Backstop so a long game can never starve a role.
  padTalentPool(state.talent, rng, mintId, {
    actor: 380,
    writer: 190,
    showrunner: 80,
    producer: 50,
    director: 80,
    host: 38,
  });

  for (const production of Object.values(state.productions)) {
    if (!production.syndicated) continue;
    const owner = state.companies[production.ownerId];
    if (owner) owner.cash += syndicationResidual(production);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPlayerCompany(state: GameState, companyId: string): boolean {
  const { studioId, networkId, streamerId } = state.player;
  return companyId === studioId || companyId === networkId || companyId === streamerId;
}

export function playerCompanies(state: GameState): Company[] {
  return [state.player.studioId, state.player.networkId, state.player.streamerId]
    .filter((id): id is string => Boolean(id))
    .map((id) => state.companies[id])
    .filter(Boolean);
}

export function playerCash(state: GameState): number {
  return playerCompanies(state).reduce((sum, company) => sum + company.cash, 0);
}

export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
