import { AUDIENCE_SEGMENTS } from '../data/segments';
import type { Attributes, AudienceSegment, SegmentId } from './types';
import { AXES } from './types';

/**
 * The taste model. See docs/DESIGN.md §4.
 *
 * A show is a point in 8-dimensional space; a segment is a point plus a set of
 * weights saying which dimensions it actually notices. Appeal is how close the show
 * lands to the segment's ideal, measured only along the axes the segment cares about.
 */

/**
 * How well a show suits one segment, 0–1.
 *
 * The exponent at the end is the important part. Without it, a show that is mildly
 * agreeable on every axis scores respectably with all six segments and beats a show
 * that is perfect for one — which is both bad design and wrong about television.
 * Raising closeness to the fourth power makes the curve punishing near the middle, so
 * "inoffensive to everyone" reliably loses to "adored by somebody".
 *
 * The exponent is also the main lever on how top-heavy ratings are: it sets the gap
 * between a well-targeted show and an unfocused one. Balanced against OUTSIDE_OPTIONS
 * in ratings.ts — raising one without lowering the other moves every show at once.
 */
const APPEAL_EXPONENT = 4;

export function segmentMatch(attrs: Attributes, segment: AudienceSegment): number {
  let weightedDistance = 0;
  let totalWeight = 0;

  for (const axis of AXES) {
    const weight = segment.weights[axis];
    if (weight <= 0) continue;
    weightedDistance += weight * Math.abs(attrs[axis] - segment.ideal[axis]);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  const normalised = weightedDistance / totalWeight; // 0–100
  const closeness = Math.max(0, 1 - normalised / 100);
  return closeness ** APPEAL_EXPONENT;
}

/** Appeal across all six segments, 0–1 each. */
export function appealProfile(attrs: Attributes): Record<SegmentId, number> {
  const out = {} as Record<SegmentId, number>;
  for (const segment of AUDIENCE_SEGMENTS) {
    out[segment.id] = segmentMatch(attrs, segment);
  }
  return out;
}

/**
 * Potential viewers per segment, in millions, before any scheduling or awareness
 * effects. This is the show's theoretical ceiling: everyone who would enjoy it if
 * they all knew about it and were all free to watch.
 */
export function potentialAudience(attrs: Attributes): Record<SegmentId, number> {
  const appeal = appealProfile(attrs);
  const out = {} as Record<SegmentId, number>;
  for (const segment of AUDIENCE_SEGMENTS) {
    out[segment.id] = segment.size * appeal[segment.id];
  }
  return out;
}

/**
 * Overlap between two shows' audiences, 0–1, as cosine similarity of their appeal
 * profiles.
 *
 * This is what makes counter-programming work. Two prestige dramas in the same slot
 * are fighting over one pool of people and overlap near 1.0, so they gut each other.
 * A wholesome family sitcom against a violent crime drama overlaps near 0.1 — they
 * barely notice each other, and both can win their night.
 */
export function audienceOverlap(
  a: Record<SegmentId, number>,
  b: Record<SegmentId, number>,
): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const key of Object.keys(a) as SegmentId[]) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Blended ad premium for an actual viewership mix. A show watched by young adults
 * earns far more per viewer than one watched by seniors, so raw ratings are a
 * deliberately misleading headline number.
 */
export function blendedAdPremium(viewersBySegment: Record<SegmentId, number>): number {
  let weighted = 0;
  let total = 0;

  for (const segment of AUDIENCE_SEGMENTS) {
    const viewers = viewersBySegment[segment.id] ?? 0;
    weighted += viewers * segment.adPremium;
    total += viewers;
  }

  return total > 0 ? weighted / total : 1;
}

/** Sum a per-segment breakdown into total viewers (millions). */
export function totalViewers(viewersBySegment: Record<SegmentId, number>): number {
  let total = 0;
  for (const key of Object.keys(viewersBySegment) as SegmentId[]) {
    total += viewersBySegment[key] ?? 0;
  }
  return total;
}
