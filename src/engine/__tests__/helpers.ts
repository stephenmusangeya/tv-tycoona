import { budgetScore } from '../quality';

export { brandSafety, licenseFee, syndicationValue } from '../economy';

/**
 * Budget adequacy at a given multiple of a show's proper cost, so tests can talk in
 * ratios ("half-funded", "double-funded") rather than in dollars.
 */
export function budgetScoreProbe(ratio: number): number {
  const baseCost = 1_000_000;
  return budgetScore(baseCost * ratio, baseCost);
}
