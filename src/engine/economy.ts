import { blendedAdPremium } from './audience';
import { clamp } from './rng';
import type {
  Attributes,
  Company,
  Production,
  SegmentId,
  ShowArchetype,
} from './types';

/**
 * The money model. See docs/DESIGN.md §7.
 *
 * All figures are USD. Viewer counts are in millions throughout — the conversion to
 * head-count happens here and nowhere else.
 */

// ---------------------------------------------------------------------------
// Tunables — every magic number in the economy lives here, so balancing is one file.
// ---------------------------------------------------------------------------

export const ECONOMY = {
  /**
   * Ad revenue per viewer per episode, at a neutral demographic and full brand safety.
   *
   * Raised from 0.55 as the reciprocal of the MARKET_CAPTURE cut in ratings.ts. That
   * change roughly halved every viewer figure on screen; without this, it would also
   * have halved every network's income and quietly made the whole industry insolvent.
   * The two numbers move together — change one, change the other.
   */
  revenuePerViewer: 1.0,
  /** Ratings count double for advertisers during sweeps; revenue premium is milder. */
  sweepsRevenueMultiplier: 1.15,

  /** Episodes required before a show can be sold into syndication. */
  syndicationThreshold: 65,
  /**
   * Syndication value per episode, per million average viewers.
   *
   * Set so that clearing the threshold is a genuine windfall rather than a rebate.
   * At 180k the payout barely repaid the deficit that built the library, which made
   * the back end feel like a consolation prize; the whole point is that surviving to
   * episode 65 is where a studio's fortune is actually made.
   */
  syndicationPerEpisodePerMillion: 260_000,
  /** Annual residual as a share of the original syndication sale. */
  syndicationResidualRate: 0.08,

  /** Weekly overhead per company tier. */
  overheadPerWeek: {
    studio: 120_000,
    network: 900_000,
    streamer: 1_400_000,
  },

  /** Cost of acquiring each tier. */
  acquisitionCost: {
    network: 450_000_000,
    streamer: 800_000_000,
  },

  /** Popular standing required to be allowed to buy each tier. */
  acquisitionStandingRequired: {
    network: 55,
    streamer: 70,
  },

  /** Annual interest on debt. */
  interestRate: 0.09,

  streaming: {
    baseMonthlyChurn: 0.055,
    /** Each 100 library episodes cuts churn by this much. */
    churnReliefPerHundredEpisodes: 0.004,
    /** Gross adds per month, in millions, per unit of release strength. */
    acquisitionPerStrength: 0.9,
    maxSubscribers: 70, // millions
    /**
     * Annual content spend per subscriber, beyond the license fees the simulation
     * tracks show-by-show.
     *
     * Without this a streamer is a money printer: subscription revenue scales with
     * the subscriber base while licensing costs scale with the handful of shows the
     * sim models individually. Real services plough roughly half their revenue back
     * into content, and this term is what reproduces that pressure — it is why
     * growing a streamer is expensive rather than automatic.
     */
    contentSpendPerSubscriberPerYear: 110,
  },

  /**
   * The second window: what a smaller channel pays for a show that did not make it.
   *
   * Syndication is a windfall for surviving to 65 episodes. Everything short of that
   * used to be worth literally nothing, which made a cancellation a total write-off and
   * left the player with no move at all. In the real business a 12-episode failure still
   * gets sold — cheaply, to someone with hours to fill and no first-run to protect.
   */
  secondWindow: {
    /** Below this there is no run to package; a two-episode burn-off is not inventory. */
    minimumEpisodes: 6,
    /** Roughly 58% of the syndication rate — a discount buy, never a rival to the back end. */
    perEpisodePerMillion: 150_000,
    /**
     * A minor channel strips one package, not a library. Paying for every episode of a
     * 60-episode run would let the second window creep up on syndication money, which
     * would make limping to the threshold pointless.
     */
    episodeCap: 26,
    /** Even a show nobody watched is worth something as filler. */
    floorPerEpisode: 30_000,
    /** Share of the deal paid as an advance; the rest trickles over the licence term. */
    advanceShare: 0.7,
    licenceWeeks: 78,
    /** Networks bigger than this have first-run to protect and will not touch a flop. */
    buyerReachCeiling: 0.75,
  },

  /**
   * Bringing a show back.
   *
   * Priced off a season of the show's own budget rather than a flat fee, so reviving a
   * cheap format is a real option early and reviving a prestige hit is a project you
   * have to save up for. The premiums are what stop it being a money loop: the shows
   * most worth reviving are precisely the ones that cost the most to reassemble.
   */
  revival: {
    minimumEpisodes: 6,
    /** Fraction of one season's production cost, paid up front to put it back together. */
    reassemblyRate: 0.35,
    /** A proven audience makes every agent in town more expensive. */
    provenPremium: 0.6,
    /** A syndicated library title is the hardest and dearest thing to prise back. */
    syndicatedPremium: 1.25,
    /** A second comeback is a harder sell than the first. */
    repeatRevivalPremium: 1.4,
    /** Fatigue carried over. A revival is a fresh start, but not a clean one. */
    fatigueCarry: 0.55,
    /** Shorter than a new show's 12 — the format already exists. */
    developmentWeeks: 8,
    /** Base odds any given cast member comes back at all. */
    returnBaseChance: 0.45,
    /** What returning talent adds to their asking price for the trouble. */
    returningRaise: 0.15,
  },

  /**
   * What a finished show is worth in repeats over one still on air.
   *
   * A completed run is the better product for a repeat buyer: it is a fixed package with
   * a known length and no first-run airing opposite it competing for the same audience.
   * This is why the archive should be inventory rather than a graveyard.
   */
  archiveRepeatPremium: 1.15,
} as const;

// ---------------------------------------------------------------------------
// Advertising
// ---------------------------------------------------------------------------

/**
 * How willing advertisers are to be adjacent to this show, 0.6–1.0.
 *
 * Violence and edginess buy you young adults and cost you advertisers. This is the
 * mechanical reason prestige violence migrated to subscription in the real world —
 * it is simply a bad ad-supported business, and the game reproduces that pressure
 * rather than asserting it.
 */
export function brandSafety(attributes: Attributes): number {
  const penalty = attributes.violence * 0.0018 + attributes.edginess * 0.0022;
  return clamp(1 - penalty, 0.6, 1);
}

/** What a network earns from one episode's ad inventory. */
export function adRevenueForEpisode(
  viewersBySegment: Record<SegmentId, number>,
  attributes: Attributes,
  isSweeps: boolean,
): number {
  let viewers = 0;
  for (const key of Object.keys(viewersBySegment) as SegmentId[]) {
    viewers += viewersBySegment[key] ?? 0;
  }

  const premium = blendedAdPremium(viewersBySegment);
  const safety = brandSafety(attributes);
  const sweeps = isSweeps ? ECONOMY.sweepsRevenueMultiplier : 1;

  return viewers * 1_000_000 * ECONOMY.revenuePerViewer * premium * safety * sweeps;
}

// ---------------------------------------------------------------------------
// Licensing — the studio/network split
// ---------------------------------------------------------------------------

/**
 * What a network will pay a studio per episode.
 *
 * Deliberately below cost for a new show. The studio eats the deficit and banks the
 * back end — this asymmetry is the entire studio game (see DESIGN.md §7.1).
 * Leverage only arrives once a show is a proven hit, at which point renewals can
 * genuinely clear cost.
 */
export function licenseFee(
  archetype: ShowArchetype,
  desirability: number, // 0–1: expected quality, star power, track record
  provenSeasons: number,
): number {
  // A brand-new show clears 55–85% of its cost, depending on how badly they want it.
  const base = archetype.baseCostPerEpisode * (0.55 + 0.3 * clamp(desirability, 0, 1));
  // Each proven season shifts leverage toward the studio, up to ~1.25× cost.
  const leverage = 1 + Math.min(provenSeasons, 5) * 0.09;
  return Math.round(base * leverage);
}

/**
 * How much a network wants a given show, 0–1. Drives both the license fee and
 * whether a rival outbids you for a slot.
 */
export function desirability(
  production: Production,
  archetype: ShowArchetype,
  peakStarPower: number,
): number {
  const priorSeason = production.history[production.history.length - 1];
  const trackRecord = priorSeason ? clamp(priorSeason.averageViewers / 12, 0, 1) : 0.35;

  return clamp(
    0.4 * (production.quality / 100) +
      0.25 * (peakStarPower / 100) +
      0.2 * trackRecord +
      0.15 * (archetype.attributes.entertainment / 100),
    0,
    1,
  );
}

// ---------------------------------------------------------------------------
// Production costs
// ---------------------------------------------------------------------------

/** Total cash cost to the studio of producing one episode, including marketing. */
export function episodeCost(production: Production): number {
  return production.budgetPerEpisode + production.marketingPerEpisode;
}

/**
 * The per-episode deficit the studio carries. Positive means losing money on air —
 * which is normal, expected, and the whole point.
 */
export function episodeDeficit(production: Production): number {
  const revenue = production.deal?.licenseFeePerEpisode ?? 0;
  return episodeCost(production) - revenue;
}

// ---------------------------------------------------------------------------
// Syndication — the back end
// ---------------------------------------------------------------------------

export function canSyndicate(production: Production): boolean {
  return (
    !production.syndicated && production.totalEpisodes >= ECONOMY.syndicationThreshold
  );
}

/**
 * What the library asset is worth once it clears the episode threshold.
 *
 * Scales with both episode count and how well the show rated, which is why a modest
 * show that limped to 88 episodes can be worth more than a beloved one cancelled at
 * 26. Longevity beats brilliance on the back end, and the game should teach that.
 */
export function syndicationValue(production: Production): number {
  if (production.history.length === 0) return 0;

  const averageViewers = averageViewersOf(production);

  const prestigeBonus = 1 + (production.attributes.prestige / 100) * 0.25;

  return Math.round(
    production.totalEpisodes *
      averageViewers *
      ECONOMY.syndicationPerEpisodePerMillion *
      prestigeBonus,
  );
}

/** Annual library residual once a show has been syndicated. */
export function syndicationResidual(production: Production): number {
  if (!production.syndicated) return 0;
  return Math.round(syndicationValue(production) * ECONOMY.syndicationResidualRate);
}

// ---------------------------------------------------------------------------
// Owning the show — repeats and rights
// ---------------------------------------------------------------------------

/**
 * Episodes needed before anyone will pay to run repeats.
 *
 * One full series of almost anything. Set at 26 originally, which locked out every
 * short-run drama in the database — an 8-episode prestige series would have needed
 * three full seasons before it could earn a penny from repeats, so the mechanic
 * simply never appeared for players who made that kind of show.
 */
export const RERUN_MINIMUM_EPISODES = 10;

/** Whether a show has enough episodes banked to sell repeats at all. */
export function canSellReruns(production: Production): boolean {
  return production.totalEpisodes >= RERUN_MINIMUM_EPISODES;
}

/**
 * What a buyer will pay per week to run repeats of a show.
 *
 * Driven by how many episodes exist and how well it rated: a big pile of episodes
 * that people liked is easy to schedule and cheap to run, which is exactly what a
 * channel wants for daytime. Prestige helps a little; a streamer will pay for a show
 * that critics rated even if the audience was modest.
 */
/**
 * Average viewers across everything a show has broadcast, including the series
 * currently on air.
 *
 * Counting only completed series is wrong for any show in its first run: a show 14
 * episodes into season one has an empty history, which valued its repeats at zero and
 * produced buyers offering nothing at all.
 */
export function averageViewersOf(production: Production): number {
  let viewers = 0;
  let episodes = 0;

  for (const season of production.history) {
    viewers += season.averageViewers * season.episodes;
    episodes += season.episodes;
  }

  const running = production.runningSeason;
  if (running && running.episodes > 0) {
    viewers += running.viewersSum;
    episodes += running.episodes;
  }

  return episodes > 0 ? viewers / episodes : 0;
}

/**
 * Whether a show's run is over — cancelled or ended.
 *
 * The archive and the live slate want opposite things from the same production, so the
 * distinction is worth naming once rather than re-deriving the pair of status checks at
 * every call site.
 */
export function isFinished(production: Production): boolean {
  return production.status === 'cancelled' || production.status === 'ended';
}

export function rerunWeeklyValue(production: Production): number {
  if (!canSellReruns(production)) return 0;

  const averageViewers = averageViewersOf(production);
  const depth = Math.min(production.totalEpisodes / 100, 2.2);
  const prestigeBonus = 1 + (production.attributes.prestige / 100) * 0.3;
  // A closed run is worth more than a live one — see ECONOMY.archiveRepeatPremium.
  const finished = isFinished(production) ? ECONOMY.archiveRepeatPremium : 1;

  return Math.round(averageViewers * depth * 26_000 * prestigeBonus * finished);
}

/** Lifetime studio profit across every completed season. Negative means the show lost money. */
export function lifetimeStudioProfit(production: Production): number {
  return production.history.reduce((sum, season) => sum + season.studioProfit, 0);
}

// ---------------------------------------------------------------------------
// The second window — selling a show that did not make it
// ---------------------------------------------------------------------------

/**
 * Whether a failed show can still be packaged and sold on.
 *
 * Deliberately narrow. The second window is the exit for a run that is *over* — a show
 * still on air has a first-run channel that would never allow it, and a show already in
 * repeats has no exclusive package left to sell. Requiring an empty slate of repeat
 * deals also makes the sale one-shot without needing a saved field to remember it.
 */
export function canSellSecondWindow(production: Production): boolean {
  return (
    isFinished(production) &&
    !production.syndicated &&
    production.totalEpisodes >= ECONOMY.secondWindow.minimumEpisodes &&
    production.totalEpisodes < ECONOMY.syndicationThreshold &&
    production.rerunDeals.length === 0
  );
}

/**
 * What the whole run fetches in a second-window sale.
 *
 * Capped at the money the studio actually lost on the show. That single rule is what
 * keeps this a lifeline rather than a business model: a cheap format that flops cannot
 * earn more from failing than it burned, so there is no loop in making rubbish on
 * purpose — while an expensive failure, which loses far more than the cap could ever
 * return, gets a genuine softening of the blow. A show that turned a profit has no
 * deficit to recoup and falls back to scrap value.
 */
export function secondWindowValue(production: Production): number {
  if (!canSellSecondWindow(production)) return 0;

  const cfg = ECONOMY.secondWindow;
  const episodes = Math.min(production.totalEpisodes, cfg.episodeCap);
  const prestigeBonus = 1 + (production.attributes.prestige / 100) * 0.2;

  const raw = episodes * averageViewersOf(production) * cfg.perEpisodePerMillion * prestigeBonus;
  const deficit = Math.max(0, -lifetimeStudioProfit(production));
  const ceiling = Math.max(deficit, episodes * cfg.floorPerEpisode);

  return Math.round(Math.min(raw, ceiling));
}

/** The cash that lands the moment a second window is signed, versus the weekly trickle. */
export function secondWindowAdvance(production: Production): number {
  return Math.round(secondWindowValue(production) * ECONOMY.secondWindow.advanceShare);
}

export function secondWindowWeekly(production: Production): number {
  const residual = secondWindowValue(production) - secondWindowAdvance(production);
  return Math.round(residual / ECONOMY.secondWindow.licenceWeeks);
}

// ---------------------------------------------------------------------------
// Revivals — bringing a show back
// ---------------------------------------------------------------------------

/** Whether a show is a candidate to be brought back at all. */
export function canRevive(production: Production): boolean {
  return isFinished(production) && production.totalEpisodes >= ECONOMY.revival.minimumEpisodes;
}

/**
 * What it costs to put a show back together.
 *
 * Scaled off the show's own season cost, not a flat fee, so the decision reads the same
 * way the original commission did. The premiums all push in the same direction: the
 * more the show proved, the more everyone attached to it now wants, which is why
 * reviving your biggest hit is the expensive option rather than the obvious one.
 */
export function revivalCost(production: Production): number {
  const cfg = ECONOMY.revival;
  const seasonCost = production.budgetPerEpisode * production.episodesPerSeason;

  const proven = 1 + Math.min(averageViewersOf(production) / 5, 1.2) * cfg.provenPremium;
  const library = production.syndicated ? cfg.syndicatedPremium : 1;
  const again = production.revived ? cfg.repeatRevivalPremium : 1;

  return Math.round(seasonCost * cfg.reassemblyRate * proven * library * again);
}

/**
 * Audience memory — the buzz a revival starts with.
 *
 * A revival's one real advantage is that people already know what it is, so it does not
 * launch cold the way an original does. Capped well short of a premiere's peak: being
 * remembered is not the same as being wanted.
 */
export function revivalBuzz(production: Production): number {
  const memory = averageViewersOf(production) * 5 + (production.syndicated ? 12 : 0);
  return Math.round(clamp(8 + memory, 0, 55));
}

/**
 * The lump sum somebody will pay to own a show outright.
 *
 * Priced at roughly four years of what the repeats would earn, so selling is a real
 * choice rather than an obvious mistake: you get cash today and give up the income
 * forever. A studio in trouble sells its library; that is how it usually ends.
 */
export function rightsSaleValue(production: Production): number {
  const weekly = rerunWeeklyValue(production);
  const futureIncome = weekly * 52 * 4;
  // Even a show too small for repeats has some scrap value.
  const floor = production.totalEpisodes * 40_000;
  return Math.round(Math.max(futureIncome, floor));
}

/** Everything a company's library is worth if it sold the lot today. */
export function libraryValue(productions: Production[], ownerId: string): number {
  return productions
    .filter((p) => p.rightsOwnerId === ownerId)
    .reduce((sum, p) => sum + rightsSaleValue(p), 0);
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface StreamingInputs {
  subscribers: number; // millions
  monthlyPrice: number;
  libraryEpisodes: number;
  /** Strength of what shipped recently: Σ quality/100 × buzz/100 over new releases. */
  releaseStrength: number;
  criticalStanding: number;
}

export interface StreamingResult {
  subscribers: number;
  revenue: number;
  churned: number;
  added: number;
}

/**
 * A month of streaming. Called every fourth week.
 *
 * Streaming inverts the network game: there are no slots and no advertisers to
 * offend, but churn is relentless and a great show only suppresses it briefly. The
 * binding constraint is release *cadence* — a quiet month is a leaking month.
 */
export function simulateStreamingMonth(input: StreamingInputs): StreamingResult {
  const {
    subscribers,
    monthlyPrice,
    libraryEpisodes,
    releaseStrength,
    criticalStanding,
  } = input;
  const cfg = ECONOMY.streaming;

  const libraryRelief =
    (libraryEpisodes / 100) * cfg.churnReliefPerHundredEpisodes;
  const releaseRelief = Math.min(releaseStrength * 0.012, 0.03);
  const priceResistance = Math.max(0, (monthlyPrice - 12) * 0.0022);

  const churnRate = clamp(
    cfg.baseMonthlyChurn - libraryRelief - releaseRelief + priceResistance,
    0.012,
    0.14,
  );

  const churned = subscribers * churnRate;

  const reputationFactor = 0.6 + (criticalStanding / 100) * 0.8;
  const headroom = Math.max(0, 1 - subscribers / cfg.maxSubscribers);
  const added = releaseStrength * cfg.acquisitionPerStrength * reputationFactor * headroom;

  const next = Math.max(0, subscribers - churned + added);

  return {
    subscribers: next,
    revenue: next * 1_000_000 * monthlyPrice,
    churned,
    added,
  };
}

// ---------------------------------------------------------------------------
// Company upkeep
// ---------------------------------------------------------------------------

export function weeklyOverhead(company: Company, productionCount: number): number {
  const base = ECONOMY.overheadPerWeek[company.type];
  // Bigger slates cost more to administer, sublinearly.
  let overhead = base + Math.sqrt(Math.max(0, productionCount)) * 45_000;

  // A streaming service's dominant cost is the content budget, which scales with the
  // audience it has to keep — see ECONOMY.streaming.contentSpendPerSubscriberPerYear.
  if (company.type === 'streamer') {
    const subscribers = (company.subscribers ?? 0) * 1_000_000;
    overhead += (subscribers * ECONOMY.streaming.contentSpendPerSubscriberPerYear) / 52;
  }

  return overhead;
}

export function weeklyInterest(debt: number): number {
  return (debt * ECONOMY.interestRate) / 52;
}
