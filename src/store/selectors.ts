import { getArchetype } from '../data';
import {
  ECONOMY,
  RERUN_MINIMUM_EPISODES,
  episodeCost,
  episodeDeficit,
  rerunWeeklyValue,
  rightsSaleValue,
} from '../engine/economy';
import { attachedIds } from '../engine/production';
import { episodesPerWeek } from '../engine/schedule';
import type {
  Company,
  GameState,
  Pitch,
  Production,
  SegmentId,
  ShowArchetype,
  TalentState,
} from '../engine/types';

/**
 * Derived views over GameState for the UI.
 *
 * Kept out of the engine because none of it affects simulation — it exists purely to
 * answer questions screens ask ("what am I losing per week?", "how far is this show
 * from syndication?").
 */

export function playerStudio(game: GameState): Company | undefined {
  return game.companies[game.player.studioId];
}

export function playerNetwork(game: GameState): Company | undefined {
  return game.player.networkId ? game.companies[game.player.networkId] : undefined;
}

export function playerStreamer(game: GameState): Company | undefined {
  return game.player.streamerId ? game.companies[game.player.streamerId] : undefined;
}

export function playerCompanyIds(game: GameState): string[] {
  return [game.player.studioId, game.player.networkId, game.player.streamerId].filter(
    (id): id is string => Boolean(id),
  );
}

export function playerShows(game: GameState): Production[] {
  const ids = new Set(playerCompanyIds(game));
  return Object.values(game.productions)
    .filter((p) => ids.has(p.ownerId) && p.status !== 'cancelled' && p.status !== 'ended')
    .sort((a, b) => statusRank(a) - statusRank(b) || b.quality - a.quality);
}

/**
 * Shows that have finished — cancelled or run their course.
 *
 * These used to be filtered out of every view, which meant a show you had bankrolled
 * for six years simply disappeared the week it was cancelled. That erased the most
 * consequential outcome in the game: whether the thing you built ever reached the
 * back end. The archive is where a studio's actual track record lives.
 */
export function playerArchive(game: GameState): Production[] {
  const ids = new Set(playerCompanyIds(game));
  return Object.values(game.productions)
    .filter((p) => ids.has(p.ownerId) && (p.status === 'cancelled' || p.status === 'ended'))
    .sort((a, b) => b.totalEpisodes - a.totalEpisodes);
}

export interface ShowOutcome {
  verdict: 'hit' | 'solid' | 'flop' | 'stranded';
  headline: string;
  detail: string;
}

/**
 * What actually became of a show — the sentence a player should be able to read off
 * the archive without doing arithmetic.
 */
export function showOutcome(production: Production): ShowOutcome {
  const seasons = production.history.length;
  const averageViewers =
    seasons > 0
      ? production.history.reduce((sum, s) => sum + s.averageViewers, 0) / seasons
      : 0;
  const lifetimeProfit = production.history.reduce((sum, s) => sum + s.studioProfit, 0);

  if (production.syndicated) {
    return {
      verdict: averageViewers > 6 ? 'hit' : 'solid',
      headline: 'Syndicated',
      detail: `${production.totalEpisodes} eps · ${seasons} series · ${averageViewers.toFixed(1)}M avg`,
    };
  }

  const short = ECONOMY.syndicationThreshold - production.totalEpisodes;
  if (short > 0 && production.totalEpisodes > 0) {
    return {
      verdict: 'stranded',
      headline: `${short} eps short`,
      detail: `${production.totalEpisodes} eps · ${seasons} series · ${formatShort(Math.abs(lifetimeProfit))} lost`,
    };
  }

  return {
    verdict: averageViewers > 4 ? 'solid' : 'flop',
    headline: 'Ended',
    detail: `${production.totalEpisodes} eps · ${averageViewers.toFixed(1)}M avg`,
  };
}

function formatShort(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}

/** Lifetime studio profit/loss across every season a show ran. */
export function lifetimeProfit(production: Production): number {
  return production.history.reduce((sum, s) => sum + s.studioProfit, 0);
}

/** Every show you still own the rights to — your library. */
export function playerLibrary(game: GameState): Production[] {
  const mine = new Set(playerCompanyIds(game));
  return Object.values(game.productions)
    .filter((p) => mine.has(p.rightsOwnerId))
    .sort((a, b) => rightsSaleValue(b) - rightsSaleValue(a));
}

/** What your whole library would fetch if you sold everything today. */
export function libraryWorth(game: GameState): number {
  return playerLibrary(game).reduce((sum, p) => sum + rightsSaleValue(p), 0);
}

/** Weekly income from repeats across everything you own. */
export function rerunIncome(game: GameState): number {
  return playerLibrary(game).reduce(
    (sum, p) => sum + p.rerunDeals.reduce((s, d) => s + d.weeklyPayment, 0),
    0,
  );
}

/** Shows you own that could be earning from repeats but currently aren't. */
export function unsoldRepeats(game: GameState): Production[] {
  return playerLibrary(game).filter(
    (p) => p.rerunDeals.length === 0 && rerunWeeklyValue(p) > 0,
  );
}

/** What is on air right now, for the broadcast monitor. */
export function nowAiring(game: GameState): Production[] {
  return playerShows(game)
    .filter((p) => p.status === 'airing')
    .sort((a, b) => (latestViewers(b) ?? 0) - (latestViewers(a) ?? 0));
}

function statusRank(production: Production): number {
  switch (production.status) {
    case 'airing':
      return 0;
    case 'hiatus':
      return production.deal ? 1 : 2;
    case 'development':
      return 3;
    default:
      return 4;
  }
}

export function totalCash(game: GameState): number {
  return playerCompanyIds(game).reduce(
    (sum, id) => sum + (game.companies[id]?.cash ?? 0),
    0,
  );
}

export function totalDebt(game: GameState): number {
  return playerCompanyIds(game).reduce(
    (sum, id) => sum + (game.companies[id]?.debt ?? 0),
    0,
  );
}

/**
 * What the player's slate costs them each week, net of license fees.
 *
 * This is the single most important number on the dashboard — a studio's whole
 * problem is the deficit, and it should never be more than a glance away.
 */
export function weeklyNet(game: GameState): number {
  // Summed from the same breakdown the player reads, so the headline total can never
  // disagree with the lines above it. An earlier version computed this separately and
  // silently omitted repeat income, so selling repeats visibly changed nothing.
  return moneyBreakdown(game).reduce((sum, line) => sum + line.amount, 0);
}

export interface MoneyLine {
  label: string;
  detail: string;
  amount: number;
}

/**
 * Where the money actually goes each week, in plain English.
 *
 * "Your net is -$929K" tells a player nothing they can act on. This breaks the same
 * number into the handful of real causes — what channels pay you, what making the
 * shows costs, what repeats bring in, what the office costs — so the answer to "why
 * am I losing money?" is on screen instead of inferred.
 */
export function moneyBreakdown(game: GameState): MoneyLine[] {
  const lines: MoneyLine[] = [];
  const shows = playerShows(game);
  const mine = new Set(playerCompanyIds(game));

  let channelPayments = 0;
  let makingCost = 0;
  let airingCount = 0;

  for (const production of shows) {
    if (production.status !== 'airing' || !production.deal) continue;
    const perWeek = episodesPerWeek(production.format);
    airingCount += 1;

    // A show you air on your own channel pays you nothing — you are paying yourself.
    const sameCompany = production.deal.networkId === production.ownerId;
    if (!sameCompany) {
      channelPayments += production.deal.licenseFeePerEpisode * perWeek;
    }
    makingCost += episodeCost(production) * perWeek;
  }

  let rerunIncome = 0;
  for (const production of Object.values(game.productions)) {
    if (!mine.has(production.rightsOwnerId)) continue;
    for (const deal of production.rerunDeals) rerunIncome += deal.weeklyPayment;
  }

  let overhead = 0;
  for (const id of playerCompanyIds(game)) {
    const company = game.companies[id];
    if (company) overhead += ECONOMY.overheadPerWeek[company.type];
  }

  if (channelPayments > 0) {
    lines.push({
      label: 'Licence fees',
      detail: `${airingCount} on air`,
      amount: channelPayments,
    });
  }
  if (rerunIncome > 0) {
    lines.push({
      label: 'Repeat sales',
      detail: 'library',
      amount: rerunIncome,
    });
  }
  if (makingCost > 0) {
    lines.push({
      label: 'Production',
      detail: 'cast, crew, sets',
      amount: -makingCost,
    });
  }
  lines.push({
    label: 'Overheads',
    detail: 'fixed',
    amount: -overhead,
  });

  return lines;
}

export interface ShowMoney {
  lines: MoneyLine[];
  perEpisode: number;
  perSeries: number;
  episodesPerSeries: number;
  /** Cast and crew wages, shown as a component of the making cost. */
  talentCost: number;
}

/**
 * Exactly where one show's money goes, per episode.
 *
 * Answers "why is this show losing money?" with arithmetic rather than an
 * explanation: what comes in, what goes out, and what the difference is over a
 * whole series.
 */
export function showEconomics(game: GameState, production: Production): ShowMoney {
  const lines: MoneyLine[] = [];
  const fee = production.deal?.licenseFeePerEpisode ?? 0;
  const talent = rosterCostPerEpisode(game, production);

  if (production.deal) {
    const channel = game.companies[production.deal.networkId];
    lines.push({
      label: 'Licence fee',
      detail: channel?.name ?? 'channel',
      amount: fee,
    });
  }

  lines.push({
    label: 'Production',
    detail:
      talent >= production.budgetPerEpisode
        ? `wages ${formatShort(talent)} — over budget`
        : `wages ${formatShort(talent)}`,
    amount: -production.budgetPerEpisode,
  });

  if (production.marketingPerEpisode > 0) {
    lines.push({
      label: 'Marketing',
      detail: 'trailers, posters',
      amount: -production.marketingPerEpisode,
    });
  }

  const perEpisode = lines.reduce((sum, l) => sum + l.amount, 0);

  return {
    lines,
    perEpisode,
    perSeries: perEpisode * production.episodesPerSeason,
    episodesPerSeries: production.episodesPerSeason,
    talentCost: talent,
  };
}

/**
 * The same sums for a show that does not exist yet, so the player can see what a
 * commission would cost before agreeing to it.
 */
export function estimateNewShow(archetype: ShowArchetype, budgetMultiplier = 1) {
  const budget = Math.round(archetype.baseCostPerEpisode * budgetMultiplier);
  const marketing = Math.round(budget * 0.12);
  // Channels typically cover 55–85% of cost; use the middle for an estimate.
  const expectedFee = Math.round(archetype.baseCostPerEpisode * 0.7);
  const perEpisode = expectedFee - budget - marketing;

  return {
    budget,
    marketing,
    expectedFee,
    costPerEpisode: budget + marketing,
    perEpisode,
    perSeries: perEpisode * archetype.episodesPerSeason,
    seriesCost: (budget + marketing) * archetype.episodesPerSeason,
    episodes: archetype.episodesPerSeason,
    episodesToRepeats: Math.max(0, RERUN_MINIMUM_EPISODES - archetype.episodesPerSeason),
    seriesToRepeats: Math.ceil(RERUN_MINIMUM_EPISODES / archetype.episodesPerSeason),
  };
}

/** Episodes still needed before a show is worth anything on the back end. */
export function episodesToSyndication(production: Production): number {
  return Math.max(0, ECONOMY.syndicationThreshold - production.totalEpisodes);
}

export function latestSeason(production: Production) {
  return production.history.at(-1);
}

/** Most recent average viewers, or undefined if it has never aired. */
export function latestViewers(production: Production): number | undefined {
  const running = production.runningSeason;
  if (running && running.episodes > 0) return running.viewersSum / running.episodes;
  return latestSeason(production)?.averageViewers;
}

export function latestBreakdown(
  production: Production,
): Record<SegmentId, number> | undefined {
  const running = production.runningSeason;
  if (running && running.episodes > 0) {
    const out = {} as Record<SegmentId, number>;
    for (const key of Object.keys(running.viewersBySegmentSum) as SegmentId[]) {
      out[key] = running.viewersBySegmentSum[key] / running.episodes;
    }
    return out;
  }
  return latestSeason(production)?.viewersBySegment;
}

export function roster(game: GameState, production: Production): TalentState[] {
  return attachedIds(production)
    .map((id) => game.talent[id])
    .filter(Boolean);
}

export function rosterCostPerEpisode(game: GameState, production: Production): number {
  return roster(game, production).reduce(
    (sum, person) => sum + (person.contractSalaryPerEpisode ?? person.baseSalaryPerEpisode),
    0,
  );
}

export function productionCostPerEpisode(production: Production): number {
  return episodeCost(production);
}

/** Free agents, optionally filtered — the talent market view. */
export function freeAgents(
  game: GameState,
  options: { role?: string; search?: string; limit?: number } = {},
): TalentState[] {
  const { role, search, limit = 60 } = options;
  const needle = search?.trim().toLowerCase();

  return Object.values(game.talent)
    .filter((person) => {
      if (person.retired || person.productionId) return false;
      if (role && person.role !== role) return false;
      if (needle && !person.name.toLowerCase().includes(needle)) return false;
      return true;
    })
    .sort((a, b) => b.starPower + b.craft - (a.starPower + a.craft))
    .slice(0, limit);
}

export function pitcherOf(game: GameState, pitch: Pitch): TalentState | undefined {
  return game.talent[pitch.pitcherId];
}

export function archetypeOf(production: Production | Pitch) {
  return getArchetype(production.archetypeId);
}

/** Player-relevant news, newest first. */
export function playerNews(game: GameState, limit = 40) {
  return game.events
    .filter((event) => event.playerRelevant)
    .slice(-limit)
    .reverse();
}

/** Everything on air, ranked — the industry ratings board. */
export function ratingsBoard(game: GameState, limit = 25) {
  return Object.values(game.productions)
    .filter((p) => p.status === 'airing' || p.status === 'hiatus')
    .map((production) => ({
      production,
      viewers: latestViewers(production) ?? 0,
      owner: game.companies[production.ownerId],
      network: production.deal ? game.companies[production.deal.networkId] : undefined,
    }))
    .filter((entry) => entry.viewers > 0)
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, limit);
}

export function companiesByType(game: GameState, type: Company['type']): Company[] {
  return Object.values(game.companies)
    .filter((c) => c.type === type)
    .sort((a, b) => b.cash - b.debt - (a.cash - a.debt));
}
