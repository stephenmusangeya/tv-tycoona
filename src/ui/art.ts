import { ARCHETYPES_BY_ID } from '../data';
import type { Format } from '../engine/types';
import type { IconName } from './icons';

/**
 * Procedural artwork.
 *
 * The game has no image assets and shouldn't need any: every show gets a poster
 * derived deterministically from its id, so the same show looks the same forever,
 * across saves and devices, without shipping a single file. This is what stops the
 * screens being walls of text.
 *
 * This module is the *art direction* — it decides what a given poster is: which
 * composition, which palette, which period finish, and the handful of numbers the
 * drawing code needs to lay out silhouettes. It deliberately holds no JSX: keeping
 * the decisions here and the paths in `Poster.tsx` means the expensive-to-think-about
 * part is a pure function that can be cached, and the render is a dumb walk over data.
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

/**
 * A deterministic 0–1 stream from a seed.
 *
 * The compositions need a dozen independent decisions each (how many buildings, how
 * tall, where the sun sits). Pulling them off one LCG keeps every one of them a pure
 * function of the show id, which is the whole promise of procedural art here.
 */
function stream(seed: number, count: number): number[] {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(s / 4294967296);
  }
  return out;
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

/**
 * An icon per format — instant, readable genre signalling at any size.
 *
 * These were emoji until the cinema icon set landed. Emoji rendered as another
 * vendor's artwork inside our own, and varied by platform; these are our paths, in
 * our colours. See `icons.tsx`.
 */
export const FORMAT_ICON: Record<Format, IconName> = {
  sitcom: 'popcorn',
  drama: 'masks',
  procedural: 'magnifier',
  reality: 'camcorder',
  competition: 'trophy',
  documentary: 'filmStrip',
  animation: 'palette',
  talkshow: 'microphone',
  gameshow: 'wheel',
  sketch: 'spotlight',
  soap: 'heart',
  anthology: 'key',
  kids: 'teddy',
  news: 'newspaper',
};

/* ------------------------------------------------------------------------- */
/* Composition templates                                                      */
/* ------------------------------------------------------------------------- */

/**
 * The eight things a poster can *be*.
 *
 * Named after what a real poster does rather than after a shape, because the point is
 * that a nature documentary and a gritty procedural should be different pictures, not
 * the same rectangle with a different tint. Each one has a foreground, a midground and
 * a background; see the drawing functions in `Poster.tsx`.
 */
export type PosterTemplate =
  /** Proscenium, curtains, two light cones, a performer in the pool of light. */
  | 'stage'
  /** Layered city at three depths under a big disc — night, crime, melodrama. */
  | 'skyline'
  /** Rolling land, sun, birds — the outdoors, nature, childhood. */
  | 'horizon'
  /** One face filling the frame, vignetted. The prestige-drama one-sheet. */
  | 'portrait'
  /** Radiating wedges from a focal badge. Prizes, variety, spectacle. */
  | 'starburst'
  /** Venetian-blind light across a lone figure with a long shadow. */
  | 'noir'
  /** A row of silhouettes shoulder to shoulder — the cast, the troupe, the housemates. */
  | 'ensemble'
  /** Concentric rings, colour bars, crosshair. Broadcast itself. */
  | 'testcard';

/**
 * Which compositions suit which format.
 *
 * Three each, so the format is legible from the picture alone but the fourteen shows
 * of a given format don't all come out as the same poster. The seed picks within the
 * list, so a show's choice never moves.
 */
const FORMAT_TEMPLATES: Record<Format, PosterTemplate[]> = {
  sitcom: ['ensemble', 'stage', 'portrait'],
  drama: ['portrait', 'skyline', 'noir', 'ensemble'],
  procedural: ['noir', 'skyline', 'testcard', 'portrait'],
  reality: ['ensemble', 'portrait', 'stage'],
  competition: ['starburst', 'stage', 'ensemble'],
  documentary: ['horizon', 'testcard', 'skyline'],
  animation: ['horizon', 'ensemble', 'starburst'],
  talkshow: ['stage', 'portrait', 'ensemble'],
  gameshow: ['starburst', 'stage', 'testcard'],
  sketch: ['stage', 'ensemble', 'portrait'],
  soap: ['portrait', 'ensemble', 'horizon', 'skyline'],
  anthology: ['noir', 'testcard', 'skyline'],
  kids: ['horizon', 'starburst', 'ensemble'],
  news: ['testcard', 'skyline', 'portrait'],
};

/* ------------------------------------------------------------------------- */
/* Era treatments                                                             */
/* ------------------------------------------------------------------------- */

export type EraKey =
  | '1950s' | '1960s' | '1970s' | '1980s'
  | '1990s' | '2000s' | '2010s' | '2020s';

const ERAS: EraKey[] = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

export interface PosterPalette {
  /** Top of the background wash. */
  sky: string;
  /** Bottom of the background wash — the ground the foreground stands on. */
  ground: string;
  /** Silhouette colour. Always the darkest thing in the palette. */
  ink: string;
  /** The one saturated note: light pools, suns, prize wheels, neon. */
  accent: string;
  /** Paper — title plates, rules, rim light. Always the lightest thing. */
  light: string;
}

/** The finish laid over the composition. Period, not decoration. */
export type PosterOverlay = 'halftone' | 'rays' | 'grid' | 'scan' | 'gloss' | 'letterbox' | 'none';

/** The frame device around the edge. */
export type PosterBorder = 'double' | 'thick' | 'thin' | 'none';

interface EraStyle {
  palettes: PosterPalette[];
  overlay: PosterOverlay;
  border: PosterBorder;
  /**
   * How much of the frame the picture fills, 0–1.
   *
   * A 1950s one-sheet is edge-to-edge ink; a 2020s streamer key art is mostly empty
   * space with one small subject. Driving that from a single number means every
   * composition inherits the period's sense of scale for free.
   */
  fill: number;
  /** Title-plate treatment: how loud the caption is, and how it is spaced. */
  caption: 'plaque' | 'banner' | 'neon' | 'bar' | 'quiet';
}

/**
 * Eight decades of television art direction, compressed to five colours each.
 *
 * The eras are not just tints. A 1950s poster is a two-colour print job with halftone
 * dots and a double keyline; a 1980s one is neon on black with a vanishing-point grid;
 * a 2020s one is a nearly empty cream field. Given a show carries its era in the data,
 * the poster should look like it came out of that decade's art department.
 */
const ERA_STYLES: Record<EraKey, EraStyle> = {
  // Two-colour print: sepia, kinescope grey, one spot ink. Dots and keylines.
  '1950s': {
    palettes: [
      { sky: '#E8D9B8', ground: '#C29A66', ink: '#2A2118', accent: '#B0342A', light: '#F7EFD9' },
      { sky: '#DCE3E0', ground: '#9AA6A1', ink: '#1E2321', accent: '#C08A1E', light: '#F4F1E6' },
      { sky: '#E4CBB4', ground: '#A8734F', ink: '#2B1A12', accent: '#9E2A20', light: '#F6E8D6' },
      { sky: '#F0E2C0', ground: '#9C8B5E', ink: '#241D14', accent: '#2E6E7E', light: '#FBF3DF' },
    ],
    overlay: 'halftone', border: 'double', fill: 0.96, caption: 'plaque',
  },
  // Pop art: flat saturated fields, mod circles, heavy keyline.
  '1960s': {
    palettes: [
      { sky: '#FFD54A', ground: '#EF5F2E', ink: '#2B1B4A', accent: '#E8402C', light: '#FFF3C4' },
      { sky: '#3FC7C4', ground: '#15697F', ink: '#0F2338', accent: '#FF7A3D', light: '#DFF6F4' },
      { sky: '#F09FC2', ground: '#87357E', ink: '#2A1030', accent: '#FFD54A', light: '#FDE4F0' },
      { sky: '#FFE9A8', ground: '#2E9E6B', ink: '#16321F', accent: '#E8402C', light: '#FFF7DE' },
    ],
    overlay: 'halftone', border: 'thick', fill: 0.94, caption: 'banner',
  },
  // Earth tones and a sunburst behind everything. Orange, mustard, burnt brick.
  '1970s': {
    palettes: [
      { sky: '#F3B23C', ground: '#AC4519', ink: '#3A1D0E', accent: '#E2622A', light: '#FBE6C0' },
      { sky: '#D9C24A', ground: '#657228', ink: '#2A2E12', accent: '#C7622A', light: '#F1EDCB' },
      { sky: '#E58B3A', ground: '#722C1B', ink: '#2E140C', accent: '#F0C24A', light: '#F8DFB6' },
      { sky: '#F7D06A', ground: '#9A5B22', ink: '#33200F', accent: '#B33B2A', light: '#FCEFD0' },
    ],
    overlay: 'rays', border: 'thin', fill: 0.98, caption: 'banner',
  },
  /**
   * Neon on black.
   *
   * The first pass took "on black" literally and the thumbnails came out as a run of
   * indistinguishable dark tiles. The grounds are now genuinely coloured — still much
   * darker than the sky, so the vanishing-point grid and the neon still read as light
   * in the dark, but with enough hue in them to survive at 40px.
   */
  '1980s': {
    palettes: [
      { sky: '#6B23B8', ground: '#1E0C4A', ink: '#0A0424', accent: '#FF3D93', light: '#38EBFF' },
      { sky: '#1E63C0', ground: '#0B1A48', ink: '#040C22', accent: '#2FE8FF', light: '#FFE45A' },
      { sky: '#7E1E88', ground: '#2A0A38', ink: '#100418', accent: '#FF7A34', light: '#8CFFD0' },
      { sky: '#128A86', ground: '#052E38', ink: '#01141A', accent: '#FFD84A', light: '#64F0E0' },
    ],
    overlay: 'grid', border: 'thin', fill: 0.98, caption: 'neon',
  },
  // Grunge: knocked-back greens and slates, video scanlines, no frame at all.
  '1990s': {
    palettes: [
      { sky: '#C8CFC3', ground: '#54634F', ink: '#1C2420', accent: '#D4622F', light: '#EDEDE0' },
      { sky: '#A9BCC6', ground: '#3D5666', ink: '#141E24', accent: '#E8B02E', light: '#E6EEF0' },
      { sky: '#CDBFA8', ground: '#6E5B44', ink: '#241C13', accent: '#86AC5E', light: '#F0E7D6' },
      { sky: '#D6CDBA', ground: '#57503E', ink: '#1E1A12', accent: '#C24040', light: '#F2ECDD' },
    ],
    overlay: 'scan', border: 'none', fill: 0.92, caption: 'bar',
  },
  // Glossy: steel blues, a lens sweep across the top, thin chrome keyline.
  '2000s': {
    palettes: [
      { sky: '#A9D0EE', ground: '#1B5A87', ink: '#08202E', accent: '#35A0FF', light: '#EDF6FF' },
      { sky: '#CDD4DC', ground: '#44535F', ink: '#121B22', accent: '#EF5A5F', light: '#F4F7FA' },
      { sky: '#98E0D6', ground: '#1A7570', ink: '#082624', accent: '#F5B915', light: '#E9FAF6' },
      { sky: '#E3D9F0', ground: '#57458A', ink: '#1A1230', accent: '#A971F0', light: '#F6F1FC' },
    ],
    overlay: 'gloss', border: 'thin', fill: 0.9, caption: 'bar',
  },
  /**
   * The teal-and-orange trailer grade.
   *
   * The muddiest era by design, and the one that most needed rescuing: the grounds are
   * lifted well off black and the accents pushed hot, because a letterbox plus a
   * vignette on top of a near-black ground left nothing at all at thumbnail size.
   */
  '2010s': {
    palettes: [
      { sky: '#C3D0C9', ground: '#35514B', ink: '#101E1C', accent: '#F5892B', light: '#F3EEE4' },
      { sky: '#9AB4BE', ground: '#2C4652', ink: '#0C1A22', accent: '#F5B02E', light: '#EBF2F3' },
      { sky: '#D3C5B0', ground: '#5A4B3A', ink: '#1D1711', accent: '#2FC0AA', light: '#F5EFE4' },
      { sky: '#B8C6D6', ground: '#3E5474', ink: '#131B26', accent: '#EF5A48', light: '#EEF3F8' },
    ],
    overlay: 'letterbox', border: 'none', fill: 0.82, caption: 'quiet',
  },
  // Streamer key art: enormous negative space, one small subject, hairline rule.
  '2020s': {
    palettes: [
      { sky: '#F2ECDF', ground: '#C0AC8C', ink: '#14110F', accent: '#B0342A', light: '#FFFFFF' },
      { sky: '#3F3A34', ground: '#141210', ink: '#000000', accent: '#F5B915', light: '#F2ECDF' },
      { sky: '#D8DEE8', ground: '#54637E', ink: '#12161E', accent: '#6D5BD0', light: '#F4F6FA' },
      { sky: '#FCE9D8', ground: '#D9A05C', ink: '#1A120C', accent: '#16786B', light: '#FFFFFF' },
    ],
    overlay: 'none', border: 'thin', fill: 0.72, caption: 'quiet',
  },
};

/* ------------------------------------------------------------------------- */
/* The spec                                                                   */
/* ------------------------------------------------------------------------- */

export interface PosterArt {
  /** Background wash, top and bottom. Kept as `from`/`to` for the older callers. */
  from: string;
  to: string;
  icon: IconName;
  /** 0–3: retained so anything still reading the old motif field keeps working. */
  motif: number;
  /** Rotation for the motif, in degrees. */
  angle: number;

  template: PosterTemplate;
  era: EraKey;
  palette: PosterPalette;
  overlay: PosterOverlay;
  border: PosterBorder;
  caption: EraStyle['caption'];
  /** How much of the frame the subject occupies, 0–1. Era-driven. */
  fill: number;
  /**
   * Strength of the corner shading, 0–1.
   *
   * A fixed vignette compounded with the already-dark eras: a 2010s poster was a dark
   * ground under a dark grade under dark corners, and the thumbnail sheet came out as
   * a run of sludge. Deriving it from the ground's own brightness means the device does
   * its job on the cream-and-gold posters and gets out of the way on the dark ones.
   */
  vignette: number;
  /** Unique per poster, so 30 posters on one screen don't share gradient ids. */
  gid: string;
  /** Twelve independent 0–1 decisions for the composition to spend. */
  v: number[];
  /** Twelve 0–1 heights, reused as buildings, cast members, colour bars. */
  bars: number[];
}

/** Rough perceived brightness of a `#rrggbb`, 0–1. Good enough to grade a vignette by. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Which decade a show belongs to.
 *
 * Most call sites pass an archetype id, so the real era is a lookup away and the
 * poster genuinely reflects the show's period. Productions carry a minted id instead;
 * those fall back to a hash so the poster is still stable, just not period-accurate —
 * callers that know better can pass `era` to `Poster` directly.
 */
export function eraOf(seed: string): EraKey {
  const declared = ARCHETYPES_BY_ID[seed]?.era as EraKey | undefined;
  if (declared && ERA_STYLES[declared]) return declared;
  return ERAS[hashString(seed) % ERAS.length];
}

/**
 * Derived specs are cached.
 *
 * A pitch pile or the archive renders 30+ posters, and React will re-render them on
 * every store tick. Building the spec is a hash and two dozen multiplies — cheap once,
 * wasteful thirty times a frame — and it is a pure function of the key, so a map is
 * all the memoisation it needs.
 */
const SPEC_CACHE = new Map<string, PosterArt>();

export function posterFor(seed: string, format: Format, era?: string): PosterArt {
  const key = `${seed}|${format}|${era ?? ''}`;
  const cached = SPEC_CACHE.get(key);
  if (cached) return cached;

  const hash = hashString(seed);
  const eraKey = (era && ERA_STYLES[era as EraKey] ? (era as EraKey) : eraOf(seed));
  const style = ERA_STYLES[eraKey];
  const palette = style.palettes[(hash >> 7) % style.palettes.length];

  const choices = FORMAT_TEMPLATES[format] ?? FORMAT_TEMPLATES.drama;
  const template = choices[(hash >> 3) % choices.length];

  const v = stream(hash, 12);
  const bars = stream(hash ^ 0x5bf03635, 12);

  const art: PosterArt = {
    from: palette.sky,
    to: palette.ground,
    icon: FORMAT_ICON[format] ?? 'television',
    motif: (hash >> 3) % 4,
    angle: ((hash >> 5) % 8) * 15 - 60,
    template,
    era: eraKey,
    palette,
    overlay: style.overlay,
    border: style.border,
    caption: style.caption,
    fill: style.fill,
    vignette: 0.1 + 0.48 * luminance(palette.ground),
    gid: `p${hash.toString(36)}`,
    v,
    bars,
  };

  // The map is unbounded by nature — minted production ids keep arriving. A hard cap
  // beats a leak, and rebuilding a spec is cheap enough that dropping the lot is fine.
  if (SPEC_CACHE.size > 600) SPEC_CACHE.clear();
  SPEC_CACHE.set(key, art);
  return art;
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
