import type { AudienceSegment } from '../engine/types';

/**
 * The six audience segments. See docs/DESIGN.md §4.
 *
 * `ideal` is the show this segment would most like to watch; `weights` is how much
 * they care about each axis. A weight near 0 means the segment is indifferent — which
 * is how "kids don't care about prestige" gets expressed without special-casing.
 *
 * Note the asymmetry that makes the game interesting: young adults are less than a
 * fifth of the audience but carry the highest ad premium, so a show can lose the
 * ratings race and still win the revenue race.
 */
export const AUDIENCE_SEGMENTS: AudienceSegment[] = [
  {
    id: 'kids',
    name: 'Kids',
    size: 14,
    adPremium: 0.7, // advertising to children is restricted, so inventory is cheap
    ideal: {
      entertainment: 85,
      prestige: 10,
      violence: 15,
      wholesomeness: 90,
      edginess: 5,
      humor: 90,
      heart: 70,
      complexity: 10,
    },
    weights: {
      entertainment: 0.9,
      prestige: 0.05,
      violence: 0.5,
      wholesomeness: 0.8,
      edginess: 0.5,
      humor: 0.9,
      heart: 0.5,
      complexity: 0.6,
    },
    availabilityByHour: { 20: 0.5, 21: 0.15, 22: 0.02 },
  },
  {
    id: 'teens',
    name: 'Teens',
    size: 12,
    adPremium: 1.15,
    ideal: {
      entertainment: 88,
      prestige: 30,
      violence: 60,
      wholesomeness: 25,
      edginess: 80,
      humor: 75,
      heart: 40,
      complexity: 45,
    },
    weights: {
      entertainment: 0.9,
      prestige: 0.15,
      violence: 0.4,
      wholesomeness: 0.5,
      edginess: 0.85,
      humor: 0.7,
      heart: 0.3,
      complexity: 0.3,
    },
    availabilityByHour: { 20: 0.5, 21: 0.8, 22: 0.6 },
  },
  {
    id: 'youngAdults',
    name: 'Young Adults',
    size: 26,
    adPremium: 1.6, // the demographic every advertiser actually wants
    ideal: {
      entertainment: 80,
      prestige: 70,
      violence: 55,
      wholesomeness: 25,
      edginess: 72,
      humor: 60,
      heart: 55,
      complexity: 75,
    },
    weights: {
      entertainment: 0.8,
      prestige: 0.6,
      violence: 0.3,
      wholesomeness: 0.45,
      edginess: 0.6,
      humor: 0.4,
      heart: 0.4,
      complexity: 0.65,
    },
    availabilityByHour: { 20: 0.45, 21: 0.75, 22: 0.85 },
  },
  {
    id: 'families',
    name: 'Families',
    size: 30, // the largest single bloc — and the one violence costs you
    adPremium: 1.1,
    ideal: {
      entertainment: 82,
      prestige: 30,
      violence: 12,
      wholesomeness: 88,
      edginess: 8,
      humor: 78,
      heart: 85,
      complexity: 20,
    },
    weights: {
      entertainment: 0.85,
      prestige: 0.1,
      violence: 0.8,
      wholesomeness: 0.85,
      edginess: 0.8,
      humor: 0.7,
      heart: 0.75,
      complexity: 0.6,
    },
    availabilityByHour: { 20: 0.85, 21: 0.5, 22: 0.15 },
  },
  {
    id: 'adults',
    name: 'Adults 35-54',
    size: 28,
    adPremium: 1.0,
    /**
     * This segment is the moderate one, but deliberately NOT the centroid of taste
     * space. An earlier version sat almost exactly at 50 on every axis, which made a
     * show that was bland on every axis this segment's single favourite programme —
     * so "offend nobody" became a dominant strategy against 28M viewers, exactly the
     * outcome the appeal curve exists to prevent. They are moderate on tone but
     * genuinely demanding about entertainment, heart and craft.
     */
    ideal: {
      entertainment: 88,
      prestige: 68,
      violence: 48,
      wholesomeness: 38,
      edginess: 42,
      humor: 58,
      heart: 72,
      complexity: 62,
    },
    weights: {
      entertainment: 0.95,
      prestige: 0.45,
      violence: 0.25,
      wholesomeness: 0.3,
      edginess: 0.35,
      humor: 0.5,
      heart: 0.6,
      complexity: 0.5,
    },
    availabilityByHour: { 20: 0.6, 21: 0.85, 22: 0.7 },
  },
  {
    id: 'seniors',
    name: 'Adults 55+',
    size: 22,
    adPremium: 0.65, // large, loyal, and advertisers do not care
    ideal: {
      entertainment: 70,
      prestige: 45,
      violence: 25,
      wholesomeness: 78,
      edginess: 5,
      humor: 55,
      heart: 70,
      complexity: 18,
    },
    weights: {
      entertainment: 0.75,
      prestige: 0.3,
      violence: 0.6,
      wholesomeness: 0.7,
      edginess: 0.85,
      humor: 0.5,
      heart: 0.6,
      complexity: 0.8,
    },
    availabilityByHour: { 20: 0.8, 21: 0.7, 22: 0.3 },
  },
];

/** Total reachable audience in millions — the ceiling nobody ever hits. */
export const TOTAL_AUDIENCE = AUDIENCE_SEGMENTS.reduce((sum, s) => sum + s.size, 0);

export const SEGMENTS_BY_ID = Object.fromEntries(
  AUDIENCE_SEGMENTS.map((s) => [s.id, s]),
) as Record<AudienceSegment['id'], AudienceSegment>;
