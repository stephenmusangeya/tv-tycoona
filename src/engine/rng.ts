/**
 * Seeded, serialisable RNG.
 *
 * The whole simulation must be reproducible from (seed, state) so that a save file
 * replays identically and any bug can be reconstructed from a bug report. That rules
 * out Math.random() entirely — the cursor lives in GameState.
 *
 * mulberry32: fast, tiny, good enough distribution for a management sim.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly pick one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Pick one element, weighted. Weights need not sum to 1. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** New array, Fisher-Yates shuffled. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** Approximately normal, via sum of 3 uniforms. Clamped to ±3σ. */
  normal(mean: number, stdDev: number): number;
  /** Current cursor — write this back into GameState. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number) => min + next() * (max - min);

  const rng: Rng = {
    next,
    range,
    int: (min, max) => Math.floor(range(min, max + 1)),
    chance: (p) => next() < p,

    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)];
    },

    weighted<T>(items: readonly T[], weight: (item: T) => number): T {
      if (items.length === 0) throw new Error('rng.weighted: empty array');
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      // All weights zero — degrade to uniform rather than returning undefined.
      if (total <= 0) return rng.pick(items);
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weight(item));
        if (roll <= 0) return item;
      }
      return items[items.length - 1];
    },

    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },

    normal(mean: number, stdDev: number): number {
      // Bates(3) has σ = 1/√36; scale to unit variance, then to the requested σ.
      const bates = (next() + next() + next()) / 3;
      return mean + (bates - 0.5) * 6 * stdDev * 0.577;
    },

    state: () => s,
  };

  return rng;
}

/** Clamp a value into [min, max]. Used constantly — every stat is bounded. */
export function clamp(value: number, min = 0, max = 100): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
