import { SHOW_ARCHETYPES, conceptOf, getArchetype } from '../data';
import { desirability, licenseFee } from './economy';
import { createProduction } from './production';
import { clamp } from './rng';
import type { Rng } from './rng';
import { WEEK_SEASON_PREMIERE, WEEK_UPFRONTS } from './schedule';
import type {
  Company,
  GameEvent,
  GameEventKind,
  GameState,
  Production,
  RivalPersonality,
  TalentState,
} from './types';

/**
 * Rival behaviour. See docs/DESIGN.md §9.
 *
 * The AI is intentionally legible. Each rival has a personality that biases what it
 * chases, and those biases are consistent enough that an attentive player can predict
 * and exploit them — a prestige chaser will always overpay for the awards show and
 * always be short of cash in the spring. Unpredictable opponents are not harder, just
 * more annoying.
 */

const OFFER_LIFETIME_WEEKS = 4;

/** How each personality weighs a prospective show. */
const PERSONALITY_WEIGHTS: Record<
  RivalPersonality,
  { prestige: number; entertainment: number; cost: number }
> = {
  'prestige-chaser': { prestige: 0.55, entertainment: 0.25, cost: -0.2 },
  populist: { prestige: 0.05, entertainment: 0.6, cost: -0.35 },
  copycat: { prestige: 0.2, entertainment: 0.45, cost: -0.35 },
  disruptor: { prestige: 0.4, entertainment: 0.45, cost: -0.15 },
  balanced: { prestige: 0.3, entertainment: 0.4, cost: -0.3 },
};

export function runRivalTurn(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  expireOffers(state, emit);

  developNewShows(state, rng, mintId, emit);

  // Networks reshuffle their grids around the upfronts and the premiere.
  const schedulingWindow =
    state.week >= WEEK_UPFRONTS - 2 && state.week <= WEEK_SEASON_PREMIERE;
  if (schedulingWindow || state.week % 6 === 0) {
    fillEmptySlots(state, rng, mintId, emit);
  }

  /**
   * Buyers look at the player's finished shows every other week rather than every
   * sixth. At the old cadence a show could sit unsold for months while offers that
   * did appear expired before the next window came round, which read as "nobody is
   * interested" when the truth was "nobody was asked".
   */
  if (state.week % 2 === 0) {
    bidForPlayerShows(state, rng, mintId, emit);
  }

  // Streamers restock continuously rather than around a broadcast calendar — the
  // whole point of the model is that they never have an off-season.
  stockStreamers(state, rng, emit);
}

/**
 * Streamers acquire content.
 *
 * They have no grid to fill, so the constraint is cadence: a streamer that stops
 * releasing bleeds subscribers immediately (see economy.ts). That makes them
 * aggressive, price-insensitive buyers, which is exactly the competitive pressure the
 * player should feel when shopping a show.
 */
function stockStreamers(
  state: GameState,
  rng: Rng,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  for (const streamer of Object.values(state.companies)) {
    if (streamer.type !== 'streamer' || streamer.isPlayer) continue;
    if (streamer.cash < 50_000_000) continue;

    const airing = Object.values(state.productions).filter(
      (p) => p.deal?.networkId === streamer.id && p.status === 'airing',
    ).length;

    // Target a steady slate; below it, buy something every week until restocked.
    const target = streamer.personality === 'disruptor' ? 14 : 9;
    if (airing >= target) continue;
    if (!rng.chance(0.35)) continue;

    const pool = availableShows(state, false);
    if (pool.length === 0) continue;

    const weights = PERSONALITY_WEIGHTS[streamer.personality];
    const pick = rng.weighted(pool, (production) =>
      Math.max(
        1,
        production.attributes.prestige * weights.prestige +
          production.attributes.entertainment * weights.entertainment +
          production.quality * 0.4 +
          // Streamers pay a premium for demanding, serialised shows — bingeing is
          // what their model is for, and complexity is a liability on a network.
          production.attributes.complexity * 0.25,
      ),
    );

    const archetype = conceptOf(state.concepts, pick.archetypeId);
    // No ad revenue to recoup against, so they simply pay more than a network would.
    const fee = Math.round(
      licenseFee(archetype, desirability(pick, archetype, peakStarPower(pick, state.talent)), pick.history.length) *
        rng.range(1.05, 1.35),
    );

    pick.deal = {
      networkId: streamer.id,
      slotKey: 'stream',
      licenseFeePerEpisode: fee,
      seasonsRemaining: rng.int(2, 3),
    };

    emit('rival', `${streamer.name} acquires "${pick.title}"`, {
      companyId: streamer.id,
      productionId: pick.id,
    });
  }
}

function expireOffers(
  state: GameState,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const before = state.offers.length;
  state.offers = state.offers.filter((offer) => offer.expiresWeek > state.absoluteWeek);
  if (state.offers.length < before) {
    emit('deal', 'An offer has expired', {
      body: 'A network has moved on and filled the slot with something else.',
      playerRelevant: true,
    });
  }
}

/**
 * Rival studios green-light new projects.
 *
 * Kept at a low weekly rate so the world turns over at a believable pace: a studio
 * develops a handful of shows a year, not a handful a week.
 */
function developNewShows(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const inProduction = new Set(
    Object.values(state.productions)
      .filter((p) => p.status !== 'cancelled' && p.status !== 'ended')
      .map((p) => p.archetypeId),
  );

  for (const company of Object.values(state.companies)) {
    if (company.isPlayer) continue;
    if (company.type === 'studio' && company.cash < 30_000_000) continue;
    if (company.type !== 'studio' && company.cash < 120_000_000) continue;

    const developing = Object.values(state.productions).filter(
      (p) => p.ownerId === company.id && p.status === 'development',
    ).length;
    if (developing >= 3) continue;

    if (!rng.chance(0.05)) continue;

    const weights = PERSONALITY_WEIGHTS[company.personality];
    const candidates = SHOW_ARCHETYPES.filter((a) => !inProduction.has(a.id));
    if (candidates.length === 0) continue;

    const archetype = rng.weighted(candidates, (a) => {
      const costPenalty =
        (a.baseCostPerEpisode / 20_000_000) * weights.cost * 100;
      const score =
        a.attributes.prestige * weights.prestige +
        a.attributes.entertainment * weights.entertainment +
        costPenalty;
      return Math.max(1, score);
    });

    // Copycats chase whatever rated well last season rather than trusting taste.
    const ambition = company.personality === 'prestige-chaser' ? 0.8 : 0.45;
    const budgetMultiplier =
      company.personality === 'populist' ? rng.range(0.72, 0.95) : rng.range(0.9, 1.2);

    const production = createProduction(archetype, state.talent, rng, mintId, {
      ownerId: company.id,
      ambition,
      budgetMultiplier,
    });
    production.developmentWeeksRemaining = rng.int(8, 20);

    state.productions[production.id] = production;
    inProduction.add(archetype.id);

    emit('rival', `${company.name} green-lights "${production.title}"`, {
      companyId: company.id,
      productionId: production.id,
    });
  }
}

/** Peak star power attached to a show — used for pricing and for offers. */
function peakStarPower(
  production: Production,
  talent: Record<string, TalentState>,
): number {
  const ids = [production.showrunnerId, production.hostId, ...production.cast].filter(
    (id): id is string => Boolean(id),
  );
  return ids.reduce((max, id) => Math.max(max, talent[id]?.starPower ?? 0), 0);
}

/** Shows that are finished, unsold, and looking for a home. */
function availableShows(state: GameState, includePlayer: boolean): Production[] {
  return Object.values(state.productions).filter(
    (p) =>
      p.status === 'hiatus' &&
      !p.deal &&
      (includePlayer || !isPlayerOwned(state, p.ownerId)),
  );
}

function isPlayerOwned(state: GameState, companyId: string): boolean {
  const { studioId, networkId, streamerId } = state.player;
  return companyId === studioId || companyId === networkId || companyId === streamerId;
}

/**
 * The slot a network would give up for something better, if any.
 *
 * Only returns a slot when the incoming show is clearly stronger than the incumbent,
 * so a network never drops a hit to take a dud — and never touches a show the player
 * already owns, which would be the game cannibalising itself.
 */
function weakestSlot(state: GameState, network: Company, incoming: number): string | undefined {
  let worstKey: string | undefined;
  let worstScore = Infinity;

  for (const [key, productionId] of Object.entries(network.schedule ?? {})) {
    if (!productionId) continue;
    const production = state.productions[productionId];
    if (!production || production.status === 'cancelled') continue;
    if (isPlayerOwned(state, production.ownerId)) continue;

    const lastSeason = production.history.at(-1);
    // No history yet means it is brand new; leave it alone.
    if (!lastSeason) continue;

    const score = lastSeason.averageViewers / 12 + production.quality / 200;
    if (score < worstScore) {
      worstScore = score;
      worstKey = key;
    }
  }

  // Only worth a fight if the newcomer is meaningfully better.
  return worstKey !== undefined && incoming > worstScore + 0.15 ? worstKey : undefined;
}

/** Networks fill their own holes with whatever rival product is going. */
function fillEmptySlots(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  for (const network of Object.values(state.companies)) {
    if (network.isPlayer) continue;
    if (network.type !== 'network' || !network.schedule) continue;

    const empty = Object.entries(network.schedule)
      .filter(([, id]) => !id)
      .map(([key]) => key);
    if (empty.length === 0) continue;

    // One acquisition per network per pass — grids fill over weeks, not instantly.
    const pool = availableShows(state, false);
    if (pool.length === 0) continue;

    const weights = PERSONALITY_WEIGHTS[network.personality];
    const pick = rng.weighted(pool, (production) =>
      Math.max(
        1,
        production.attributes.prestige * weights.prestige +
          production.attributes.entertainment * weights.entertainment +
          production.quality * 0.3,
      ),
    );

    const archetype = conceptOf(state.concepts, pick.archetypeId);
    const slot = rng.pick(empty);
    const fee = licenseFee(
      archetype,
      desirability(pick, archetype, peakStarPower(pick, state.talent)),
      pick.history.length,
    );

    pick.deal = {
      networkId: network.id,
      slotKey: slot,
      licenseFeePerEpisode: fee,
      seasonsRemaining: rng.int(1, 2),
    };
    network.schedule[slot] = pick.id;

    emit('rival', `${network.name} picks up "${pick.title}"`, {
      companyId: network.id,
      productionId: pick.id,
    });
  }

  void mintId;
}

/**
 * Networks bid for the player's finished shows.
 *
 * Offers vary in both fee and slot quality, and deliberately do not correlate
 * perfectly — the network that pays best is often the one with the worst reach or the
 * graveyard timeslot, so "highest number wins" is the wrong heuristic.
 */
function bidForPlayerShows(
  state: GameState,
  rng: Rng,
  mintId: (prefix: string) => string,
  emit: (kind: GameEventKind, headline: string, extra?: Partial<GameEvent>) => GameEvent,
): void {
  const playerShows = Object.values(state.productions).filter(
    (p) => p.status === 'hiatus' && !p.deal && isPlayerOwned(state, p.ownerId),
  );
  if (playerShows.length === 0) return;

  for (const production of playerShows) {
    const alreadyOffered = new Set(
      state.offers.filter((o) => o.productionId === production.id).map((o) => o.networkId),
    );

    const archetype = conceptOf(state.concepts, production.archetypeId);
    const want = desirability(production, archetype, peakStarPower(production, state.talent));

    for (const network of Object.values(state.companies)) {
      if (network.type !== 'network' || network.isPlayer || !network.schedule) continue;
      if (alreadyOffered.has(network.id)) continue;

      const empty = Object.entries(network.schedule)
        .filter(([, id]) => !id)
        .map(([key]) => key);

      /**
       * A full grid used to mean "no offer". Since rivals fill their schedules
       * continuously, every network saturated within a couple of years and the player
       * could never sell another show — a finished show sat in the in-tray forever.
       *
       * Networks do not behave that way: they cancel their weakest hour to make room
       * for something better. If there is no empty slot, find the worst-performing
       * show on the grid and offer that slot instead.
       */
      let slotKey: string | undefined = empty.length > 0 ? rng.pick(empty) : undefined;

      if (!slotKey) {
        const contested = weakestSlot(state, network, want);
        if (!contested) continue;
        slotKey = contested;
      }

      // Weaker networks have to want it more to compete for it at all.
      const interest = want * (0.7 + (network.reach ?? 0.8) * 0.4);
      if (!rng.chance(clamp(interest, 0.05, 0.9) * 0.7)) continue;

      const fee = Math.round(
        licenseFee(archetype, want, production.history.length) * rng.range(0.9, 1.15),
      );

      state.offers.push({
        id: mintId('offer'),
        productionId: production.id,
        networkId: network.id,
        slotKey,
        licenseFeePerEpisode: fee,
        seasons: rng.int(1, 3),
        expiresWeek: state.absoluteWeek + OFFER_LIFETIME_WEEKS,
      });

      emit('deal', `${network.name} bids for "${production.title}"`, {
        body: `${fee.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} per episode.`,
        playerRelevant: true,
        productionId: production.id,
        companyId: network.id,
      });
    }
  }
}
