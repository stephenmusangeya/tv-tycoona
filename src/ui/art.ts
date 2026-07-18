import type { Format } from '../engine/types';

/**
 * Procedural artwork.
 *
 * The game has no image assets and shouldn't need any: every show gets a poster
 * derived deterministically from its id, so the same show looks the same forever,
 * across saves and devices, without shipping a single file. This is what stops the
 * screens being walls of text.
 */

/** Cheap deterministic hash — same string, same art, always. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** Palettes chosen so any two adjacent posters stay distinguishable. */
const PALETTES: Array<[string, string]> = [
  ['#FF6B35', '#C2185B'],
  ['#2D7FF9', '#0B3B8C'],
  ['#0FA968', '#065F46'],
  ['#9E5FE8', '#4C1D95'],
  ['#F5B915', '#B45309'],
  ['#E5484D', '#7F1D1D'],
  ['#14B8C4', '#0E5F72'],
  ['#EC4899', '#701A47'],
  ['#64748B', '#1E293B'],
  ['#84CC16', '#3F6212'],
];

/** A glyph per format — instant, readable genre signalling at any size. */
export const FORMAT_GLYPH: Record<Format, string> = {
  sitcom: '😄',
  drama: '🎭',
  procedural: '🔍',
  reality: '📹',
  competition: '🏆',
  documentary: '🎞️',
  animation: '🎨',
  talkshow: '🎙️',
  gameshow: '🎰',
  sketch: '🤹',
  soap: '💔',
  anthology: '🗝️',
  kids: '🧸',
  news: '📰',
};

export interface PosterArt {
  from: string;
  to: string;
  glyph: string;
  /** 0–3: which geometric motif to overlay. */
  motif: number;
  /** Rotation for the motif, in degrees. */
  angle: number;
}

export function posterFor(seed: string, format: Format): PosterArt {
  const hash = hashString(seed);
  const [from, to] = PALETTES[hash % PALETTES.length];

  return {
    from,
    to,
    glyph: FORMAT_GLYPH[format] ?? '📺',
    motif: (hash >> 3) % 4,
    angle: ((hash >> 5) % 8) * 15 - 60,
  };
}

/** Deterministic colour for a person, so their avatar is stable. */
export function avatarColor(seed: string): [string, string] {
  return PALETTES[hashString(seed) % PALETTES.length];
}

/** Initials for an avatar — two letters, upper case. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
