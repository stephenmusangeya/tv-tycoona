import { conceptOf } from '../data';
import {
  ECONOMY,
  RERUN_MINIMUM_EPISODES,
  canRevive,
  canSellReruns,
  canSellSecondWindow,
  isFinished,
  rerunWeeklyValue,
  revivalBuzz,
  revivalCost,
  rightsSaleValue,
  secondWindowAdvance,
  secondWindowValue,
  secondWindowWeekly,
} from './economy';
import {
  attachedIds,
  bindTalent,
  createProduction,
  refreshQuality,
  releaseTalent,
} from './production';
import { rollChemistry } from './quality';
import { clamp, createRng } from './rng';
import { emptySchedule } from './schedule';
import type { Company, GameState, Production, RerunDeal, TalentState } from './types';

/**
 * Player actions.
 *
 * Every function here mutates GameState and returns a Result rather than throwing, so
 * the UI can show a reason for a refusal instead of crashing. Actions consume the
 * seeded RNG the same way the tick does, keeping saves reproducible.
 */

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

function mintId(state: GameState, prefix: string): string {
  return `${prefix}_${(state.nextId++).toString(36)}`;
}

function studioOf(state: GameState): Company | undefined {
  return state.companies[state.player.studioId];
}

// ---------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------

export interface GreenlightOptions {
  budgetMultiplier?: number;
  marketingRatio?: number;
  /** Leave unstaffed so the player casts it themselves. */
  selfCast?: boolean;
}

/**
 * Green-light a pitch.
 *
 * Charges nothing up front — production costs land per episode once it airs. What
 * you are really committing to is the *deficit*, which is why the game shows the
 * projected shortfall rather than a sticker price.
 */
export function greenlightPitch(
  state: GameState,
  pitchId: string,
  options: GreenlightOptions = {},
): Result<Production> {
  const pitch = state.pitches.find((p) => p.id === pitchId);
  if (!pitch) return fail('That pitch is no longer available.');

  const studio = studioOf(state);
  if (!studio) return fail('No studio.');

  const archetype = conceptOf(state.concepts, pitch.archetypeId);
  const rng = createRng(state.rngState);

  const production = createProduction(archetype, state.talent, rng, (p) => mintId(state, p), {
    ownerId: studio.id,
    budgetMultiplier:
      options.budgetMultiplier ?? pitch.estimatedCostPerEpisode / archetype.baseCostPerEpisode,
    marketingRatio: options.marketingRatio ?? 0.12,
    unstaffed: options.selfCast ?? false,
    ambition: 0.55,
    attributesOverride: pitch.attributes,
  });

  // The pitcher is attached as an element — that is what they were selling.
  const pitcher = state.talent[pitch.pitcherId];
  if (pitcher && !pitcher.productionId) {
    attachPitcher(production, pitcher);
    pitcher.productionId = production.id;
    pitcher.employerId = studio.id;
    pitcher.contractSalaryPerEpisode = pitcher.baseSalaryPerEpisode;
    pitcher.relationships[studio.id] = clamp((pitcher.relationships[studio.id] ?? 40) + 20);
  }

  production.developmentWeeksRemaining = 12;
  refreshQuality(production, archetype, state.talent);

  state.productions[production.id] = production;
  state.pitches = state.pitches.filter((p) => p.id !== pitchId);
  state.rngState = rng.state();

  return ok(production);
}

function attachPitcher(production: Production, pitcher: TalentState): void {
  switch (pitcher.role) {
    case 'showrunner':
    case 'producer':
      production.showrunnerId = pitcher.id;
      break;
    case 'writer':
      if (!production.writerIds.includes(pitcher.id)) production.writerIds.push(pitcher.id);
      break;
    case 'director':
      production.directorId = pitcher.id;
      break;
    case 'host':
      production.hostId = pitcher.id;
      break;
    case 'actor':
      if (!production.cast.includes(pitcher.id)) production.cast.unshift(pitcher.id);
      break;
  }
}

/** Passing costs you the relationship, and the pitcher remembers. */
export function passOnPitch(state: GameState, pitchId: string): Result {
  const pitch = state.pitches.find((p) => p.id === pitchId);
  if (!pitch) return fail('That pitch is no longer available.');

  const pitcher = state.talent[pitch.pitcherId];
  const studioId = state.player.studioId;
  if (pitcher) {
    pitcher.relationships[studioId] = clamp((pitcher.relationships[studioId] ?? 40) - 12);
  }

  state.pitches = state.pitches.filter((p) => p.id !== pitchId);
  return ok(undefined);
}

/** Develop an original show from the archetype catalogue, with no pitcher attached. */
export function developOriginal(
  state: GameState,
  archetypeId: string,
  options: GreenlightOptions = {},
): Result<Production> {
  const studio = studioOf(state);
  if (!studio) return fail('No studio.');

  const inProduction = Object.values(state.productions).some(
    (p) => p.archetypeId === archetypeId && p.status !== 'cancelled' && p.status !== 'ended',
  );
  if (inProduction) return fail('Someone is already making that show.');

  const archetype = conceptOf(state.concepts, archetypeId);
  const rng = createRng(state.rngState);

  const production = createProduction(archetype, state.talent, rng, (p) => mintId(state, p), {
    ownerId: studio.id,
    budgetMultiplier: options.budgetMultiplier ?? 1,
    marketingRatio: options.marketingRatio ?? 0.12,
    unstaffed: options.selfCast ?? false,
    ambition: 0.55,
  });
  production.developmentWeeksRemaining = 12;

  state.productions[production.id] = production;
  state.rngState = rng.state();
  return ok(production);
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export function acceptOffer(state: GameState, offerId: string): Result<Production> {
  const offer = state.offers.find((o) => o.id === offerId);
  if (!offer) return fail('That offer has expired.');

  const production = state.productions[offer.productionId];
  const network = state.companies[offer.networkId];
  if (!production) return fail('Unknown production.');
  if (!network?.schedule) return fail('That network has no schedule.');

  /**
   * The slot may be contested — networks now bid with a slot they intend to clear.
   * Retire the incumbent properly, otherwise it keeps a deal pointing at a slot it no
   * longer occupies and quietly goes on earning.
   */
  const incumbentId = network.schedule[offer.slotKey];
  if (incumbentId && incumbentId !== production.id) {
    const incumbent = state.productions[incumbentId];
    if (incumbent) {
      if (isPlayerOwned(state, incumbent.ownerId)) {
        return fail('That slot is running one of your own shows.');
      }
      incumbent.status = 'cancelled';
      incumbent.deal = undefined;
      releaseTalent(incumbent, state.talent);
    }
    network.schedule[offer.slotKey] = null;
  }

  production.deal = {
    networkId: network.id,
    slotKey: offer.slotKey,
    licenseFeePerEpisode: offer.licenseFeePerEpisode,
    seasonsRemaining: offer.seasons,
  };
  network.schedule[offer.slotKey] = production.id;

  // Taking one offer takes the show off the market entirely.
  state.offers = state.offers.filter((o) => o.productionId !== production.id);

  return ok(production);
}

export function declineOffer(state: GameState, offerId: string): Result {
  const before = state.offers.length;
  state.offers = state.offers.filter((o) => o.id !== offerId);
  return before === state.offers.length ? fail('No such offer.') : ok(undefined);
}

// ---------------------------------------------------------------------------
// Running a show
// ---------------------------------------------------------------------------

export function setBudget(
  state: GameState,
  productionId: string,
  budgetPerEpisode: number,
  marketingPerEpisode?: number,
): Result<Production> {
  const production = state.productions[productionId];
  if (!production) return fail('Unknown production.');
  if (!isPlayerOwned(state, production.ownerId)) return fail('You do not own that show.');
  if (budgetPerEpisode < 0) return fail('Budget cannot be negative.');

  production.budgetPerEpisode = Math.round(budgetPerEpisode);
  if (marketingPerEpisode !== undefined) {
    production.marketingPerEpisode = Math.max(0, Math.round(marketingPerEpisode));
  }

  refreshQuality(production, conceptOf(state.concepts, production.archetypeId), state.talent);
  return ok(production);
}

/** Attach a free agent to one of your shows. */
export function castTalent(
  state: GameState,
  productionId: string,
  talentId: string,
): Result<Production> {
  const production = state.productions[productionId];
  const person = state.talent[talentId];

  if (!production) return fail('Unknown production.');
  if (!person) return fail('Unknown talent.');
  if (!isPlayerOwned(state, production.ownerId)) return fail('You do not own that show.');
  if (person.retired) return fail(`${person.name} has retired.`);
  if (person.productionId) return fail(`${person.name} is already attached to a show.`);
  if (production.status === 'airing') return fail('Casting is locked once a season is on air.');

  const archetype = conceptOf(state.concepts, production.archetypeId);

  switch (person.role) {
    case 'actor':
      if (production.cast.length >= archetype.castSize + 2) return fail('The cast is full.');
      production.cast.push(person.id);
      break;
    case 'writer':
      production.writerIds.push(person.id);
      break;
    case 'showrunner':
    case 'producer':
      production.showrunnerId = person.id;
      break;
    case 'director':
      production.directorId = person.id;
      break;
    case 'host':
      production.hostId = person.id;
      break;
  }

  person.productionId = production.id;
  person.employerId = production.ownerId;
  person.contractSalaryPerEpisode = person.baseSalaryPerEpisode;
  person.relationships[production.ownerId] = clamp(
    (person.relationships[production.ownerId] ?? 40) + 8,
  );

  refreshQuality(production, archetype, state.talent);
  return ok(production);
}

export function dropTalent(
  state: GameState,
  productionId: string,
  talentId: string,
): Result<Production> {
  const production = state.productions[productionId];
  const person = state.talent[talentId];
  if (!production || !person) return fail('Unknown production or talent.');
  if (!isPlayerOwned(state, production.ownerId)) return fail('You do not own that show.');
  if (production.status === 'airing') return fail('You cannot recast mid-season.');

  production.cast = production.cast.filter((id) => id !== talentId);
  production.writerIds = production.writerIds.filter((id) => id !== talentId);
  if (production.showrunnerId === talentId) production.showrunnerId = undefined;
  if (production.directorId === talentId) production.directorId = undefined;
  if (production.hostId === talentId) production.hostId = undefined;

  person.productionId = undefined;
  person.contractSalaryPerEpisode = undefined;
  person.morale = clamp(person.morale - 15);

  refreshQuality(production, conceptOf(state.concepts, production.archetypeId), state.talent);
  return ok(production);
}

/** Pull the plug on your own show. */
export function cancelOwnShow(state: GameState, productionId: string): Result {
  const production = state.productions[productionId];
  if (!production) return fail('Unknown production.');
  if (!isPlayerOwned(state, production.ownerId)) return fail('You do not own that show.');

  if (production.deal) {
    const network = state.companies[production.deal.networkId];
    if (network?.schedule) network.schedule[production.deal.slotKey] = null;
  }

  production.status = 'cancelled';
  production.deal = undefined;
  releaseTalent(production, state.talent);
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Owning your shows — repeats and rights
// ---------------------------------------------------------------------------

/** Who might pay to run repeats of a show, and what they would pay. */
export interface RerunBid {
  buyerId: string;
  buyerName: string;
  weeklyPayment: number;
  weeks: number;
}

/**
 * Channels and services interested in repeats.
 *
 * Everyone who isn't already running the show first-run is a candidate, and each
 * values it slightly differently — a streamer pays more for something bingeable, a
 * small channel pays less because it reaches fewer people.
 */
export function rerunBidsFor(state: GameState, productionId: string): RerunBid[] {
  const production = state.productions[productionId];
  if (!production || !canSellReruns(production)) return [];
  if (production.rightsOwnerId !== state.player.studioId) return [];

  const base = rerunWeeklyValue(production);
  const existing = new Set(production.rerunDeals.map((d) => d.buyerId));

  return Object.values(state.companies)
    .filter((company) => {
      if (company.isPlayer) return false;
      if (company.type === 'studio') return false; // studios don't broadcast
      if (existing.has(company.id)) return false;
      if (production.deal?.networkId === company.id) return false; // already airing it
      return true;
    })
    .map((company) => {
      // Streamers pay a premium for complex, serialised shows; broadcasters pay by reach.
      const streamerAppetite =
        company.type === 'streamer'
          ? 1.15 + (production.attributes.complexity / 100) * 0.35
          : 0.75 + (company.reach ?? 0.8) * 0.5;

      return {
        buyerId: company.id,
        buyerName: company.name,
        weeklyPayment: Math.round(base * streamerAppetite),
        weeks: company.type === 'streamer' ? 156 : 104,
      };
    })
    .sort((a, b) => b.weeklyPayment - a.weeklyPayment);
}

/**
 * License repeats to a buyer.
 *
 * You keep the show. This is pure additional income from episodes that already exist,
 * and it is the main reason a long-running show is worth more than a brilliant short one.
 */
export function licenseReruns(
  state: GameState,
  productionId: string,
  buyerId: string,
): Result<RerunDeal> {
  const production = state.productions[productionId];
  if (!production) return fail('We cannot find that show.');
  if (production.rightsOwnerId !== state.player.studioId) {
    return fail('You do not own this show any more, so you cannot sell its repeats.');
  }
  if (!canSellReruns(production)) {
    const short = RERUN_MINIMUM_EPISODES - production.totalEpisodes;
    return fail(`You need ${short} more episodes before anyone will buy the repeats.`);
  }

  const bid = rerunBidsFor(state, productionId).find((b) => b.buyerId === buyerId);
  if (!bid) return fail('That buyer is no longer interested.');

  const deal: RerunDeal = {
    id: mintId(state, 'rerun'),
    buyerId: bid.buyerId,
    buyerName: bid.buyerName,
    weeklyPayment: bid.weeklyPayment,
    weeksRemaining: bid.weeks,
  };

  production.rerunDeals.push(deal);
  return ok(deal);
}

/**
 * Sell a show outright.
 *
 * Permanent. The buyer takes the show and every future penny it would have made,
 * including any repeat deals already running. Deliberately irreversible — this should
 * feel like a decision, not a button.
 */
export function sellRights(
  state: GameState,
  productionId: string,
  buyerId?: string,
): Result<number> {
  const production = state.productions[productionId];
  const studio = studioOf(state);
  if (!production || !studio) return fail('We cannot find that show.');
  if (production.rightsOwnerId !== studio.id) return fail('You do not own this show.');

  const price = rightsSaleValue(production);

  // Prefer a named buyer, else the richest company that isn't us.
  const buyer =
    (buyerId ? state.companies[buyerId] : undefined) ??
    Object.values(state.companies)
      .filter((c) => !c.isPlayer && c.type !== 'studio')
      .sort((a, b) => b.cash - a.cash)[0];

  if (!buyer) return fail('Nobody is buying right now.');

  studio.cash += price;
  buyer.cash -= price;
  production.rightsOwnerId = buyer.id;
  // Future repeat income goes with the show.
  production.rerunDeals = [];

  return ok(price);
}

// ---------------------------------------------------------------------------
// The second window — the exit for a show that did not make it
// ---------------------------------------------------------------------------

/** A smaller channel's offer for the whole run of a finished show. */
export interface SecondWindowBid {
  buyerId: string;
  buyerName: string;
  /** Total value of the deal — advance plus every weekly payment. */
  total: number;
  /** Cash on signature. */
  advance: number;
  weeklyPayment: number;
  weeks: number;
}

/**
 * Who will take a failed show off your hands.
 *
 * Only the buyers with hours to fill and nothing to protect. A big network turning this
 * down is the point: the second window is a discount market, and being pushed down it is
 * what makes a cancellation sting even though it is survivable.
 */
export function secondWindowBidsFor(state: GameState, productionId: string): SecondWindowBid[] {
  const production = state.productions[productionId];
  if (!production || !canSellSecondWindow(production)) return [];
  if (production.rightsOwnerId !== state.player.studioId) return [];

  const total = secondWindowValue(production);
  if (total <= 0) return [];

  const advance = secondWindowAdvance(production);
  const weekly = secondWindowWeekly(production);

  return Object.values(state.companies)
    .filter((company) => {
      if (company.isPlayer) return false;
      if (company.type === 'studio') return false; // studios don't broadcast
      // Streamers take anything cheap; networks only if they are small enough to need it.
      if (company.type === 'network') {
        return (company.reach ?? 1) <= ECONOMY.secondWindow.buyerReachCeiling;
      }
      return true;
    })
    .map((company) => {
      // A streamer values the back catalogue by depth; a minor channel by how cheap the
      // hours are, so the same run is worth slightly different money to each of them.
      const appetite =
        company.type === 'streamer'
          ? 1 + (production.attributes.complexity / 100) * 0.25
          : 0.8 + (company.reach ?? 0.6) * 0.4;

      return {
        buyerId: company.id,
        buyerName: company.name,
        total: Math.round(total * appetite),
        advance: Math.round(advance * appetite),
        weeklyPayment: Math.max(1, Math.round(weekly * appetite)),
        weeks: ECONOMY.secondWindow.licenceWeeks,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Sell a finished show into its second window.
 *
 * You keep the rights — this is a fixed-term licence of a run that already exists, paid
 * mostly as an advance because the cash is the entire point of taking the deal. Recorded
 * as an ordinary repeats deal, which is exactly what the buyer is getting, so the weekly
 * payout and its expiry need no special handling anywhere else.
 */
export function sellSecondWindow(
  state: GameState,
  productionId: string,
  buyerId?: string,
): Result<{ deal: RerunDeal; advance: number }> {
  const production = state.productions[productionId];
  const studio = studioOf(state);
  if (!production || !studio) return fail('We cannot find that show.');

  if (production.rightsOwnerId !== studio.id) {
    return fail('You do not own this show any more, so you have nothing to sell.');
  }
  if (!isFinished(production)) {
    return fail('You can only sell a second window once the show has finished its run.');
  }
  if (production.syndicated) {
    return fail('This show is already in syndication — there is no second window left.');
  }
  if (production.totalEpisodes >= ECONOMY.syndicationThreshold) {
    return fail('This show is big enough to syndicate. Sell it properly instead.');
  }
  if (production.totalEpisodes < ECONOMY.secondWindow.minimumEpisodes) {
    const short = ECONOMY.secondWindow.minimumEpisodes - production.totalEpisodes;
    return fail(`Only ${production.totalEpisodes} episodes exist — ${short} too few to package.`);
  }
  if (production.rerunDeals.length > 0) {
    return fail('Someone is already showing the repeats, so the run is not yours to package.');
  }

  const bids = secondWindowBidsFor(state, productionId);
  if (bids.length === 0) return fail('Nobody in the discount market wants it.');

  const bid = buyerId ? bids.find((b) => b.buyerId === buyerId) : bids[0];
  if (!bid) return fail('That buyer is not interested.');

  const buyer = state.companies[bid.buyerId];
  if (!buyer) return fail('That buyer no longer exists.');

  const deal: RerunDeal = {
    id: mintId(state, 'window'),
    buyerId: bid.buyerId,
    buyerName: bid.buyerName,
    weeklyPayment: bid.weeklyPayment,
    weeksRemaining: bid.weeks,
  };

  studio.cash += bid.advance;
  buyer.cash -= bid.advance;
  production.rerunDeals.push(deal);

  return ok({ deal, advance: bid.advance });
}

// ---------------------------------------------------------------------------
// Revivals — bringing a show back
// ---------------------------------------------------------------------------

export interface RevivalOutcome {
  production: Production;
  cost: number;
  /** Talent who came back, and what it cost to get them. */
  returning: string[];
  /** Talent who had moved on, retired, or simply said no. */
  departed: string[];
  /** Quality after the recast, so the player can see what the attrition did. */
  quality: number;
  buzz: number;
  fatigue: number;
}

/**
 * Bring a cancelled or ended show back for a new season.
 *
 * The show keeps everything that made it worth reviving — its library, its episode count
 * toward syndication, and the fact that people remember it. What it does not keep is its
 * company. Everyone attached scattered when it was cancelled, and getting them back is a
 * roll rather than a purchase: some retired, some are working, some have simply moved on.
 * That is the risk being paid for, and it is why a revival can come back visibly worse
 * than the show you remember.
 */
export function reviveShow(state: GameState, productionId: string): Result<RevivalOutcome> {
  const production = state.productions[productionId];
  const studio = studioOf(state);
  if (!production || !studio) return fail('We cannot find that show.');

  if (production.rightsOwnerId !== studio.id) {
    return fail('You do not own this show any more, so you cannot bring it back.');
  }
  if (!isFinished(production)) {
    return fail('That show has not finished — there is nothing to revive.');
  }
  if (!canRevive(production)) {
    return fail(
      `Only ${production.totalEpisodes} episodes ever aired. There is not enough show to bring back.`,
    );
  }

  const cost = revivalCost(production);
  if (studio.cash < cost) {
    return fail(`Putting it back together costs ${formatCost(cost)}, and you do not have it.`);
  }

  const cfg = ECONOMY.revival;
  const rng = createRng(state.rngState);
  const archetype = conceptOf(state.concepts, production.archetypeId);

  const returning: string[] = [];
  const departed: string[] = [];

  for (const id of attachedIds(production)) {
    const person = state.talent[id];
    if (!person) {
      departed.push(id);
      continue;
    }

    // Retired or already working: gone regardless of what you would have paid.
    if (person.retired || person.productionId) {
      departed.push(id);
      continue;
    }

    // Everyone else is a negotiation. How it went the first time is what decides it —
    // weighted so goodwill tilts the odds without ever making the roll a formality.
    const goodwill = (person.relationships[studio.id] ?? 40) / 250 + person.morale / 400;
    if (!rng.chance(clamp(cfg.returnBaseChance + goodwill, 0.15, 0.9))) {
      departed.push(id);
      person.relationships[studio.id] = clamp((person.relationships[studio.id] ?? 40) - 4);
      continue;
    }

    returning.push(person.id);
  }

  // Strip the people who did not come back before rebinding, so the roster is honest.
  const gone = new Set(departed);
  production.cast = production.cast.filter((id) => !gone.has(id));
  production.writerIds = production.writerIds.filter((id) => !gone.has(id));
  if (production.showrunnerId && gone.has(production.showrunnerId)) {
    production.showrunnerId = undefined;
  }
  if (production.directorId && gone.has(production.directorId)) production.directorId = undefined;
  if (production.hostId && gone.has(production.hostId)) production.hostId = undefined;

  studio.cash -= cost;

  bindTalent(production, state.talent, studio.id);
  // Coming back is leverage: they know you want the show more than they need the job.
  for (const id of returning) {
    const person = state.talent[id];
    if (!person) continue;
    person.contractSalaryPerEpisode = Math.round(
      person.baseSalaryPerEpisode * (1 + cfg.returningRaise + person.heat / 400),
    );
  }

  production.revived = true;
  production.status = 'development';
  production.developmentWeeksRemaining = cfg.developmentWeeks;
  production.deal = undefined;
  production.episodesAiredThisSeason = 0;
  production.runningSeason = undefined;
  // Time off helps, but a show that ran out of road does not come back fresh.
  production.fatigue = production.fatigue * cfg.fatigueCarry;
  production.buzz = revivalBuzz(production);

  production.chemistry = rollChemistry(production, state.talent, (m, s) => rng.normal(m, s));
  refreshQuality(production, archetype, state.talent);

  state.rngState = rng.state();

  return ok({
    production,
    cost,
    returning,
    departed,
    quality: production.quality,
    buzz: production.buzz,
    fatigue: production.fatigue,
  });
}

function formatCost(amount: number): string {
  return amount >= 1_000_000
    ? `$${(amount / 1_000_000).toFixed(1)}M`
    : `$${Math.round(amount / 1_000)}K`;
}

// ---------------------------------------------------------------------------
// Empire progression
// ---------------------------------------------------------------------------

/**
 * Buy a network.
 *
 * Gated on standing as well as cash, because the fantasy is earning your way up, not
 * simply saving up. A studio nobody has heard of does not get to buy a broadcaster.
 */
export function acquireNetwork(state: GameState, networkId: string): Result<Company> {
  if (state.player.networkId) return fail('You already own a network.');

  const studio = studioOf(state);
  const target = state.companies[networkId];
  if (!studio) return fail('No studio.');
  if (!target || target.type !== 'network') return fail('That is not a network.');

  const price = ECONOMY.acquisitionCost.network;
  const required = ECONOMY.acquisitionStandingRequired.network;

  if (studio.popularStanding < required) {
    return fail(
      `Your studio is not established enough. Public standing ${Math.round(studio.popularStanding)}/${required}.`,
    );
  }
  if (studio.cash < price) {
    return fail(`You need ${(price / 1_000_000).toFixed(0)}M to buy ${target.name}.`);
  }

  studio.cash -= price;
  target.isPlayer = true;
  state.player.networkId = target.id;

  return ok(target);
}

/** Launch a streaming service from scratch, rather than buying one. */
export function launchStreamer(
  state: GameState,
  name: string,
  monthlyPrice = 12.99,
): Result<Company> {
  if (state.player.streamerId) return fail('You already run a streaming service.');

  const studio = studioOf(state);
  if (!studio) return fail('No studio.');

  const price = ECONOMY.acquisitionCost.streamer;
  const required = ECONOMY.acquisitionStandingRequired.streamer;

  if (studio.popularStanding < required) {
    return fail(
      `Not enough public standing to launch a service. ${Math.round(studio.popularStanding)}/${required}.`,
    );
  }
  if (studio.cash < price) {
    return fail(`Launching a service costs ${(price / 1_000_000).toFixed(0)}M.`);
  }

  studio.cash -= price;

  const streamer: Company = {
    id: mintId(state, 'co'),
    name,
    type: 'streamer',
    isPlayer: true,
    personality: 'balanced',
    cash: 0,
    debt: 0,
    criticalStanding: studio.criticalStanding,
    popularStanding: studio.popularStanding,
    subscribers: 0.5, // you launch with almost nobody
    monthlyPrice,
    schedule: emptySchedule(),
  };

  state.companies[streamer.id] = streamer;
  state.player.streamerId = streamer.id;

  return ok(streamer);
}

// ---------------------------------------------------------------------------
// Scheduling (once you own a network)
// ---------------------------------------------------------------------------

export function scheduleShow(
  state: GameState,
  productionId: string,
  slotKey: string,
  licenseFeePerEpisode?: number,
): Result<Production> {
  const networkId = state.player.networkId;
  if (!networkId) return fail('You do not own a network.');

  const network = state.companies[networkId];
  const production = state.productions[productionId];
  if (!network?.schedule) return fail('No schedule.');
  if (!production) return fail('Unknown production.');
  if (network.schedule[slotKey]) return fail('That slot is taken.');
  if (production.deal) return fail('That show is already committed elsewhere.');
  if (production.status !== 'hiatus') return fail('That show is not ready to air.');

  const archetype = conceptOf(state.concepts, production.archetypeId);
  const fee =
    licenseFeePerEpisode ??
    (isPlayerOwned(state, production.ownerId)
      ? Math.round(archetype.baseCostPerEpisode * 0.75)
      : Math.round(archetype.baseCostPerEpisode * 0.85));

  production.deal = {
    networkId,
    slotKey,
    licenseFeePerEpisode: fee,
    seasonsRemaining: 1,
  };
  network.schedule[slotKey] = production.id;

  return ok(production);
}

export function unscheduleShow(state: GameState, slotKey: string): Result {
  const networkId = state.player.networkId;
  if (!networkId) return fail('You do not own a network.');

  const network = state.companies[networkId];
  if (!network?.schedule) return fail('No schedule.');

  const productionId = network.schedule[slotKey];
  if (!productionId) return ok(undefined);

  const production = state.productions[productionId];
  if (production?.status === 'airing') return fail('You cannot pull a show mid-season.');

  network.schedule[slotKey] = null;
  if (production) production.deal = undefined;
  return ok(undefined);
}

// ---------------------------------------------------------------------------

export function isPlayerOwned(state: GameState, companyId: string): boolean {
  const { studioId, networkId, streamerId } = state.player;
  return companyId === studioId || companyId === networkId || companyId === streamerId;
}

/** Everyone attached to a production, resolved to talent records — for the UI. */
export function productionRoster(
  state: GameState,
  production: Production,
): TalentState[] {
  return attachedIds(production)
    .map((id) => state.talent[id])
    .filter(Boolean);
}

export { bindTalent };

/**
 * Making a show is a player action like any other, so it is reachable from here.
 *
 * The arithmetic lives in development.ts because it is a lot of it — format baselines,
 * genre and angle vectors, what a producer is worth — and none of it belongs in the
 * action layer.
 */
export {
  GENRES,
  availableFor,
  availableProducers,
  blueprintFor,
  createShow,
  formatBaseCost,
  formatShape,
  genresFor,
  greenlightRevisedPitch,
  orderOptions,
  previewShow,
  revisionPreview,
  rolesFor,
  type GenreOption,
  type PitchRevision,
  type RevisedPitch,
  type ShowBlueprint,
  type ShowPreview,
} from './development';
