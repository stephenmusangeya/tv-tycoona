/**
 * TV Tycoon — core domain types.
 *
 * This module is pure: no React, no React Native, no platform APIs. The entire
 * simulation is a deterministic function of (GameState, seed), which is what makes
 * it testable and replayable from a save file. See docs/DESIGN.md.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const FORMATS = [
  'sitcom',
  'drama',
  'procedural',
  'reality',
  'competition',
  'documentary',
  'animation',
  'talkshow',
  'gameshow',
  'sketch',
  'soap',
  'anthology',
  'kids',
  'news',
] as const;
export type Format = (typeof FORMATS)[number];

export const TALENT_ROLES = [
  'actor',
  'writer',
  'showrunner',
  'producer',
  'director',
  'host',
] as const;
export type TalentRole = (typeof TALENT_ROLES)[number];

export const SEGMENTS = [
  'kids',
  'teens',
  'youngAdults',
  'families',
  'adults',
  'seniors',
] as const;
export type SegmentId = (typeof SEGMENTS)[number];

/** The eight axes every show is scored on. See DESIGN.md §3.2. */
export const AXES = [
  'entertainment',
  'prestige',
  'violence',
  'wholesomeness',
  'edginess',
  'humor',
  'heart',
  'complexity',
] as const;
export type Axis = (typeof AXES)[number];

/** A point in show-space. Every value is 0–100. */
export type Attributes = Record<Axis, number>;

// ---------------------------------------------------------------------------
// Content database (static, loaded from src/data)
// ---------------------------------------------------------------------------

export interface ShowArchetype {
  id: string;
  title: string;
  format: Format;
  genre: string;
  logline: string;
  era: string;
  attributes: Attributes;
  /** What one episode costs to make at full quality, in USD. */
  baseCostPerEpisode: number;
  episodesPerSeason: number;
  castSize: number;
  requiredRoles: string[];
  tags: string[];
}

export interface TalentRecord {
  id: string;
  name: string;
  role: TalentRole;
  age: number;
  /** Audience draw — feeds awareness, not quality. */
  starPower: number;
  /** Actual skill — feeds quality, not awareness. */
  craft: number;
  /** Low reliability generates no-shows, scandals, walkouts. */
  reliability: number;
  /** High ego raises salary demands and risks chemistry clashes. */
  ego: number;
  /** How well they travel outside their best formats. */
  versatility: number;
  /** Partial map: only the formats they are actually good at. */
  genreAffinity: Partial<Record<Format, number>>;
  baseSalaryPerEpisode: number;
  bio: string;
}

/** An audience segment's taste profile. See DESIGN.md §4. */
export interface AudienceSegment {
  id: SegmentId;
  name: string;
  /** Reachable viewers, in millions. */
  size: number;
  /** The show this segment would most like to watch. */
  ideal: Attributes;
  /** How much this segment cares about each axis (0–1). */
  weights: Attributes;
  /** What advertisers pay to reach this segment, relative to 1.0 baseline. */
  adPremium: number;
  /** Share of this segment available to watch in each prime hour. */
  availabilityByHour: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Live game entities
// ---------------------------------------------------------------------------

export type CompanyType = 'studio' | 'network' | 'streamer';

export type RivalPersonality =
  | 'prestige-chaser'
  | 'populist'
  | 'copycat'
  | 'disruptor'
  | 'balanced';

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  isPlayer: boolean;
  personality: RivalPersonality;
  cash: number;
  debt: number;
  /** Awards & critical standing, 0–100. Gates elite talent. */
  criticalStanding: number;
  /** Hits & public profile, 0–100. Gates carriage and ad rates. */
  popularStanding: number;

  // --- network only ---
  /** Share of households that can receive this network, 0–1. */
  reach?: number;
  /** slotKey ("mon-20") -> productionId currently scheduled there. */
  schedule?: Record<string, string | null>;

  // --- streamer only ---
  subscribers?: number;
  monthlyPrice?: number;
}

/** A prime-time slot on a network's grid. */
export interface Slot {
  day: number; // 0 = Monday
  hour: number; // 20, 21, 22
}

export type ProductionStatus =
  | 'development'
  | 'pilot'
  | 'airing'
  | 'hiatus'
  | 'cancelled'
  | 'ended';

export interface AiringDeal {
  networkId: string;
  slotKey: string;
  /** What the network pays the studio per episode. Usually below cost — see DESIGN.md §7.1. */
  licenseFeePerEpisode: number;
  /** Seasons remaining on the deal before it must be renegotiated. */
  seasonsRemaining: number;
}

/**
 * A repeats deal: someone pays you every week to show old episodes.
 *
 * This is the quiet income that turns a studio from something that burns money into
 * something that owns things. It needs no slot, no cast and no further spending — the
 * episodes already exist.
 */
export interface RerunDeal {
  id: string;
  /** Channel or service paying for the repeats. */
  buyerId: string;
  buyerName: string;
  weeklyPayment: number;
  weeksRemaining: number;
}

export interface SeasonRecord {
  season: number;
  episodes: number;
  averageViewers: number;
  averageQuality: number;
  /** Viewers by segment, in millions — the demographic breakdown. */
  viewersBySegment: Record<SegmentId, number>;
  studioProfit: number;
  networkProfit: number;
}

export interface Production {
  id: string;
  archetypeId: string;
  title: string;
  format: Format;
  /** Studio that owns the show and carries the deficit. */
  ownerId: string;

  /** Tuned copy of the archetype vector — talent and notes move this. */
  attributes: Attributes;
  /** Derived 0–100. See DESIGN.md §6. Recomputed when cast or budget change. */
  quality: number;
  /** Hidden per-season roll that makes two identical productions differ. */
  chemistry: number;

  budgetPerEpisode: number;
  episodesPerSeason: number;
  marketingPerEpisode: number;

  cast: string[];
  showrunnerId?: string;
  writerIds: string[];
  directorId?: string;
  hostId?: string;

  status: ProductionStatus;
  season: number;
  episodesAiredThisSeason: number;
  /** Lifetime episode count — drives the syndication threshold. */
  totalEpisodes: number;

  deal?: AiringDeal;

  /** Weeks left in development before the show is ready to be scheduled. */
  developmentWeeksRemaining?: number;

  /** Decaying momentum, 0–100. Awards, premieres and marketing push it up. */
  buzz: number;
  /** Creative exhaustion, 0–1. Grows every season. */
  fatigue: number;

  history: SeasonRecord[];
  /** True once the show's repeats have been sold into syndication. */
  syndicated: boolean;

  /**
   * Whether you still own the show itself.
   *
   * You make the show, so you own it — the rights are the asset, and a studio's real
   * balance sheet is its library rather than its cash. Selling the rights hands the
   * show to somebody else permanently: you take a lump sum and give up every future
   * penny it would have earned.
   */
  rightsOwnerId: string;
  /** Repeat deals currently paying out. A show can run several at once. */
  rerunDeals: RerunDeal[];

  /**
   * Running totals for the season currently on air, folded into `history` when the
   * season wraps. Kept separate so `history` only ever contains completed seasons and
   * "last season's numbers" is never ambiguous.
   */
  runningSeason?: RunningSeason;
}

export interface RunningSeason {
  episodes: number;
  viewersSum: number;
  viewersBySegmentSum: Record<SegmentId, number>;
  qualitySum: number;
  studioProfit: number;
  networkProfit: number;
}

// ---------------------------------------------------------------------------
// Events & news
// ---------------------------------------------------------------------------

export type GameEventKind =
  | 'ratings'
  | 'money'
  | 'talent'
  | 'scandal'
  | 'award'
  | 'deal'
  | 'rival'
  | 'pitch'
  | 'milestone';

export interface GameEvent {
  id: string;
  week: number;
  year: number;
  kind: GameEventKind;
  headline: string;
  body?: string;
  /** Only surfaced to the player if true; rival churn stays in the background. */
  playerRelevant: boolean;
  productionId?: string;
  talentId?: string;
  companyId?: string;
}

/**
 * A network's bid for one of the player's finished shows. Rivals fill their own grids
 * automatically; the player is always asked, because choosing between a big fee in a
 * bad slot and a small fee in a good one is one of the better decisions in the game.
 */
export interface NetworkOffer {
  id: string;
  productionId: string;
  networkId: string;
  slotKey: string;
  licenseFeePerEpisode: number;
  seasons: number;
  expiresWeek: number;
}

export interface Pitch {
  id: string;
  archetypeId: string;
  title: string;
  format: Format;
  logline: string;
  attributes: Attributes;
  /** Talent bringing the pitch — attached as an element if green-lit. */
  pitcherId: string;
  estimatedCostPerEpisode: number;
  /** Week the offer lapses. */
  expiresWeek: number;
}

// ---------------------------------------------------------------------------
// Root state
// ---------------------------------------------------------------------------

export interface PlayerEmpire {
  studioId: string;
  networkId?: string;
  streamerId?: string;
}

export interface GameState {
  /** Seeded RNG cursor — kept in state so saves replay identically. */
  rngState: number;
  seed: number;

  year: number;
  /** 1–52. */
  week: number;
  /** Weeks elapsed since game start; monotonic. */
  absoluteWeek: number;

  player: PlayerEmpire;

  companies: Record<string, Company>;
  productions: Record<string, Production>;
  /** Runtime talent state, seeded from the static database. */
  talent: Record<string, TalentState>;

  pitches: Pitch[];
  /** Live bids from networks for the player's finished shows. */
  offers: NetworkOffer[];
  events: GameEvent[];

  /** Monotonic counter for generated entity ids — keeps saves deterministic. */
  nextId: number;
}

export interface TalentState extends TalentRecord {
  /** Company they are contracted to, if any. */
  employerId?: string;
  /** Production they are currently attached to. */
  productionId?: string;
  /** 0–100. Low morale means walkouts and refused renewals. */
  morale: number;
  /** 0–100. Rises with hits, decays without exposure. Drives asking price. */
  heat: number;
  /** Per-company relationship, 0–100. Drives whether they pitch to you. */
  relationships: Record<string, number>;
  /** Weeks until an active contract expires; undefined if a free agent. */
  contractWeeksRemaining?: number;
  contractSalaryPerEpisode?: number;
  retired: boolean;
}

/** Result of simulating a single week — what the UI reports back to the player. */
export interface WeekResult {
  year: number;
  week: number;
  events: GameEvent[];
  playerCashDelta: number;
  airedThisWeek: Array<{
    productionId: string;
    title: string;
    viewers: number;
    viewersBySegment: Record<SegmentId, number>;
    slotKey?: string;
  }>;
}
