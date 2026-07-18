/**
 * TV Tycoon simulation engine — public surface.
 *
 * Pure TypeScript: no React, no React Native, no platform APIs. Everything the UI
 * needs should come through here.
 */

export * from './types';
export { createRng, clamp, lerp } from './rng';
export type { Rng } from './rng';

export { newGame } from './setup';
export type { NewGameOptions } from './setup';

export { advanceWeek, isPlayerCompany, playerCash, playerCompanies, formatMoney } from './tick';

export * from './actions';

export {
  appealProfile,
  potentialAudience,
  audienceOverlap,
  blendedAdPremium,
  segmentMatch,
  totalViewers,
} from './audience';

export {
  ECONOMY,
  adRevenueForEpisode,
  brandSafety,
  canSyndicate,
  desirability,
  episodeCost,
  episodeDeficit,
  licenseFee,
  syndicationValue,
  syndicationResidual,
  weeklyOverhead,
} from './economy';

export {
  computeQuality,
  budgetScore,
  talentScore,
  effectiveCraft,
  isScripted,
} from './quality';

export { computeAwareness, qualityMultiplier, simulateSlot } from './ratings';
export type { SlotEntrant, AiringOutcome } from './ratings';

export {
  candidatesFor,
  createProduction,
  fitScore,
  refreshQuality,
  talentCostPerEpisode,
  attachedIds,
} from './production';

export {
  DAY_NAMES,
  PRIME_HOURS,
  allSlotKeys,
  emptySchedule,
  formatSlotKey,
  parseSlotKey,
  slotKey,
  isSweeps,
  isSummer,
  WEEK_SEASON_PREMIERE,
  WEEK_UPFRONTS,
  WEEK_AWARDS,
  WEEKS_PER_YEAR,
} from './schedule';

export { AUDIENCE_SEGMENTS, SEGMENTS_BY_ID, SHOW_ARCHETYPES, getArchetype } from '../data';
