import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path } from 'react-native-svg';

import type { TalentRole } from '../engine/types';
import { hashString } from './art';

/**
 * Procedural portraits.
 *
 * The cast used to be coloured circles with two initials in them, which made the
 * casting screens read as a database rather than a business full of people. You cannot
 * feel anything about "MR" in a magenta disc; you can feel something about a face.
 *
 * Every portrait is derived from the person's id, so a performer looks the same
 * forever — across saves, devices and platforms — without a single image file. Same
 * bargain as `posterFor` in `art.ts`, applied to people instead of shows.
 *
 * Style rules, so 180 of these sit happily next to the brass Walk of Fame stars:
 *   • 64×64 viewBox, everything clipped to the disc.
 *   • Flat fills, essentially no strokes. A filled silhouette survives being drawn at
 *     30px in a cast list; a 1px eyelid does not. Depth comes from one shade of the
 *     fill colour, never from gradients or shading.
 *   • Features are built from a handful of forgiving primitives — a skull cap path, a
 *     rotated blob, a ring of curls. Hair especially: a union of simple shapes takes
 *     any head geometry without folding in on itself, where one clever path would not.
 *   • Nothing is exaggerated. These are people, and the player is meant to want to
 *     hire them. Any feature that could only ever read as a punchline is not in here.
 *
 * The palettes are deliberately broad — the name pool in `talentGen.ts` is
 * international and the authored cast more so, so the skin tones run the full range
 * and hair texture is a first-class axis rather than a colour swap.
 */

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * One independent 0–1 draw per feature.
 *
 * Indexed rather than sequential: adding a new feature later must not reshuffle
 * everybody's face, so each feature owns a slot and reads only its own slot.
 */
function draw(hash: number, slot: number): number {
  let t = (hash + slot * 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(items: readonly T[], hash: number, slot: number): T {
  return items[Math.floor(draw(hash, slot) * items.length) % items.length];
}

/** A draw mapped onto a range — used for the continuous bits, like face width. */
function span(hash: number, slot: number, lo: number, hi: number): number {
  return lo + draw(hash, slot) * (hi - lo);
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function channels(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Blend two hex colours. Every shade in a portrait is a mix of a base and one tint. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const to = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${((1 << 24) | (to(ar, br) << 16) | (to(ag, bg) << 8) | to(ab, bb))
    .toString(16)
    .slice(1)}`;
}

/**
 * Skin, light to deep, warm-leaning to match the cream-and-brass interface.
 *
 * A ten-step range rather than the usual three: the cast is international by design
 * and a portrait system that can only draw the pale end of it is not fit for it.
 */
const SKINS = [
  '#F7E0CB', '#F0D0B0', '#E7BE97', '#DCAA80',
  '#C9945F', '#B27A4A', '#96603A', '#7B4C2C',
  '#5F3A21', '#482916',
];

const HAIR = {
  black: '#191310',
  softBlack: '#271D18',
  darkBrown: '#3B2A1D',
  brown: '#59391F',
  chestnut: '#7A4A26',
  auburn: '#8A3A1C',
  ginger: '#B0561C',
  darkBlond: '#9A7238',
  blond: '#C9A257',
  ash: '#877B6B',
} as const;

/**
 * Hair colour is picked per skin tone rather than globally.
 *
 * Not squeamishness — a uniform draw produces platinum-blond deep-skinned people at
 * the same rate as everything else, which reads as a bug in the generator rather than
 * as a person, and undermines the whole point of drawing faces.
 */
const HAIR_BY_SKIN: readonly string[][] = [
  [HAIR.blond, HAIR.darkBlond, HAIR.ginger, HAIR.auburn, HAIR.chestnut, HAIR.brown, HAIR.darkBrown, HAIR.ash, HAIR.black],
  [HAIR.blond, HAIR.darkBlond, HAIR.ginger, HAIR.auburn, HAIR.chestnut, HAIR.brown, HAIR.darkBrown, HAIR.softBlack],
  [HAIR.darkBlond, HAIR.auburn, HAIR.chestnut, HAIR.brown, HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.auburn, HAIR.chestnut, HAIR.brown, HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.chestnut, HAIR.brown, HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.brown, HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.darkBrown, HAIR.softBlack, HAIR.black],
  [HAIR.softBlack, HAIR.black],
  [HAIR.softBlack, HAIR.black],
];

/** Iris colours. Kept dark on purpose — an eye reads as a mass at 30px, not a colour. */
const IRIS = ['#2A1C12', '#3C2A17', '#4B3A22', '#3B4A3B', '#3A4A57', '#5A4030'];

/** Muted lobby tones behind the head, so two people in a row never share a card. */
const BACKDROPS = [
  '#D8C6A4', '#C6B4C1', '#AEBFB4', '#D2B3A2',
  '#B7C2CF', '#CDBEA0', '#C3B29C', '#BFC7B2',
];

/** Mid-century wardrobe: no primaries, everything one step towards the cream paper. */
const GARMENTS = [
  '#8E3A31', '#3E6B6A', '#3A4A6B', '#B2842E',
  '#6B4A6B', '#5E6B45', '#3C3730', '#A8967A',
];

/** Steel rather than white: grey hair has to keep its edge against a pale forehead. */
const GREY = '#A69D8F';
const RIM = '#F7F1E4';
const BRASS = '#C08A1E';

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

interface Head {
  /** Centre of the head. */
  cx: number;
  cy: number;
  /** Half-width at the cheekbones, and half-height crown to chin. */
  w: number;
  h: number;
  /** Jaw half-width as a fraction of `w` — the difference between square and heart. */
  jaw: number;
}

const f = (n: number) => n.toFixed(2);

/**
 * A rotated blob — one ellipse expressed as four cubics.
 *
 * Everything soft in the portrait is this shape at a different size and angle: eyes,
 * hair lobes, beards, buns. Written out as a path rather than an `<Ellipse>` with a
 * transform because a transform prop on an ellipse is the one thing that renders
 * differently between the native build, the web build and the render harness's stub.
 */
function blob(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tilt = 0,
  topScale = 1,
): string {
  const k = 0.5523;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const p = (x: number, y: number) => `${f(cx + x * cos - y * sin)} ${f(cy + x * sin + y * cos)}`;
  const rt = ry * topScale;
  return [
    `M ${p(-rx, 0)}`,
    `C ${p(-rx, -rt * k)} ${p(-rx * k, -rt)} ${p(0, -rt)}`,
    `C ${p(rx * k, -rt)} ${p(rx, -rt * k)} ${p(rx, 0)}`,
    `C ${p(rx, ry * k)} ${p(rx * k, ry)} ${p(0, ry)}`,
    `C ${p(-rx * k, ry)} ${p(-rx, ry * k)} ${p(-rx, 0)} Z`,
  ].join(' ');
}

/** The face outline: widest at the cheekbones, narrowing to a jaw of the given width. */
function facePath(g: Head): string {
  const { cx, cy, w, h } = g;
  const jw = w * g.jaw;
  return [
    `M ${f(cx)} ${f(cy - h)}`,
    `C ${f(cx + w * 0.86)} ${f(cy - h)} ${f(cx + w)} ${f(cy - h * 0.45)} ${f(cx + w)} ${f(cy)}`,
    `C ${f(cx + w)} ${f(cy + h * 0.42)} ${f(cx + jw)} ${f(cy + h * 0.82)} ${f(cx)} ${f(cy + h)}`,
    `C ${f(cx - jw)} ${f(cy + h * 0.82)} ${f(cx - w)} ${f(cy + h * 0.42)} ${f(cx - w)} ${f(cy)}`,
    `C ${f(cx - w)} ${f(cy - h * 0.45)} ${f(cx - w * 0.86)} ${f(cy - h)} ${f(cx)} ${f(cy - h)} Z`,
  ].join(' ');
}

/**
 * The skull cap every hairstyle is built on: an arc over the crown, closed by a
 * hairline that can sit at a different height on each side.
 *
 * The asymmetry is what buys partings, sweeps and receding hairlines from one shape.
 */
function skullCap(
  g: Head,
  opts: { sideY: number; fyL: number; fyR: number; partX?: number; grow?: number },
): string {
  const { cx, cy } = g;
  const R = g.w + (opts.grow ?? 1.3);
  const top = cy - g.h - (opts.grow ?? 1.3);
  const partX = opts.partX ?? 0;
  const mid = (opts.fyL + opts.fyR) / 2;
  return [
    `M ${f(cx - R)} ${f(opts.sideY)}`,
    `C ${f(cx - R)} ${f(top)} ${f(cx + R)} ${f(top)} ${f(cx + R)} ${f(opts.sideY)}`,
    `C ${f(cx + R * 0.72)} ${f(opts.fyR)} ${f(cx + R * 0.34)} ${f(opts.fyR)} ${f(cx + partX)} ${f(mid)}`,
    `C ${f(cx - R * 0.34)} ${f(opts.fyL)} ${f(cx - R * 0.72)} ${f(opts.fyL)} ${f(cx - R)} ${f(opts.sideY)} Z`,
  ].join(' ');
}

/** A mane behind the head — the shape long styles fall onto the shoulders with. */
function backPanel(g: Head, spread: number, drop: number): string {
  const { cx, cy } = g;
  const R = g.w + spread;
  const top = cy - g.h - spread * 0.8;
  return [
    `M ${f(cx - R)} ${f(cy)}`,
    `C ${f(cx - R)} ${f(top)} ${f(cx + R)} ${f(top)} ${f(cx + R)} ${f(cy)}`,
    `C ${f(cx + R + 1.5)} ${f(cy + g.h * 0.9)} ${f(cx + R + 1)} ${f(drop - 4)} ${f(cx + R + 2)} ${f(drop)}`,
    `L ${f(cx - R - 2)} ${f(drop)}`,
    `C ${f(cx - R - 1)} ${f(drop - 4)} ${f(cx - R - 1.5)} ${f(cy + g.h * 0.9)} ${f(cx - R)} ${f(cy)} Z`,
  ].join(' ');
}

/** Curls laid around an arc — the texture that makes afros and coils read as hair. */
function curlRing(
  g: Head,
  radius: number,
  fromDeg: number,
  toDeg: number,
  count: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / (count - 1)) * Math.PI) / 180;
    out.push([g.cx + Math.cos(a) * radius, g.cy + Math.sin(a) * radius * 0.94]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

const HAIR_STYLES = [
  'crop', 'fade', 'sidePart', 'fringe', 'curtains', 'afro', 'coils',
  'bob', 'long', 'wavy', 'bun', 'locs', 'thin',
] as const;
type HairStyle = (typeof HAIR_STYLES)[number];

/** Hair renders in two passes: what falls behind the head, and what sits over it. */
interface HairArt {
  back: React.ReactNode;
  front: React.ReactNode;
  /** True when the style covers the ears, so earrings are not drawn through it. */
  coversEars: boolean;
}

function hairFor(style: HairStyle, g: Head, color: string, skin: string): HairArt {
  const { cx, cy, h } = g;
  const shine = mix(color, '#FFFFFF', 0.16);
  const shade = mix(color, '#000000', 0.22);
  const y = (t: number) => cy + h * t;

  // A highlight down one side of the crown, borrowed from the brass star: flat hair
  // with one lighter facet reads as hair, flat hair without one reads as a helmet.
  const gloss = (
    <Path d={blob(cx - g.w * 0.42, y(-0.62), g.w * 0.34, h * 0.16, -0.5)} fill={shine} opacity={0.55} />
  );

  const curls = (pts: Array<[number, number]>, r: number, fill: string, key: string) =>
    pts.map(([x, cyy], i) => <Circle key={`${key}${i}`} cx={f(x)} cy={f(cyy)} r={r} fill={fill} />);

  switch (style) {
    case 'crop':
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.02), fyL: y(-0.46), fyR: y(-0.44) })} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'fade':
      // Short sides with a squared-off hairline. An earlier version drew a second,
      // *larger* cap in the shade colour to suggest the taper — which simply covered
      // the first one and read as a headband.
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(-0.08), fyL: y(-0.4), fyR: y(-0.4), grow: 0.9 })} fill={color} />
            <Path d={blob(cx - g.w - 0.2, y(0.02), 1.7, h * 0.16)} fill={color} />
            <Path d={blob(cx + g.w + 0.2, y(0.02), 1.7, h * 0.16)} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'sidePart':
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path
              d={skullCap(g, { sideY: y(0.0), fyL: y(-0.52), fyR: y(-0.24), partX: -g.w * 0.28 })}
              fill={color}
            />
            {/* The swept side — a lobe over the temple, which is the whole point of a part. */}
            <Path d={blob(cx + g.w * 0.5, y(-0.4), g.w * 0.55, h * 0.2, 0.28)} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'fringe':
      return {
        coversEars: true,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.24), fyL: y(-0.2), fyR: y(-0.2) })} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'curtains':
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.06), fyL: y(-0.44), fyR: y(-0.44) })} fill={color} />
            <Path d={blob(cx - g.w * 0.52, y(-0.34), g.w * 0.42, h * 0.24, 0.35)} fill={color} />
            <Path d={blob(cx + g.w * 0.52, y(-0.34), g.w * 0.42, h * 0.24, -0.35)} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'afro': {
      const r = g.w * 0.36;
      return {
        coversEars: true,
        back: (
          <>
            {curls(curlRing(g, g.w + r * 0.7, 182, 358, 9), r, color, 'ab')}
            <Path d={blob(cx, y(-0.28), g.w + r * 0.5, h * 0.78)} fill={color} />
          </>
        ),
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(-0.06), fyL: y(-0.5), fyR: y(-0.5), grow: 2.2 })} fill={color} />
            {curls(curlRing(g, g.w + r * 0.55, 196, 344, 7), r * 0.82, shine, 'af')}
            {curls(curlRing(g, g.w + r * 0.7, 182, 358, 9), r * 0.9, color, 'ac')}
          </>
        ),
      };
    }

    case 'coils': {
      const r = 2.1;
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.0), fyL: y(-0.42), fyR: y(-0.42), grow: 1.6 })} fill={color} />
            {curls(curlRing(g, g.w + 0.6, 190, 350, 11), r, shine, 'ct')}
            {curls(curlRing(g, g.w - 1.4, 200, 340, 8), r * 0.85, color, 'ci')}
          </>
        ),
      };
    }

    case 'bob':
      return {
        coversEars: true,
        back: <Path d={backPanel(g, 3, y(0.95))} fill={color} />,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.3), fyL: y(-0.3), fyR: y(-0.26), partX: g.w * 0.2 })} fill={color} />
            <Path d={blob(cx - g.w - 1.4, y(0.34), 3.4, h * 0.42)} fill={color} />
            <Path d={blob(cx + g.w + 1.4, y(0.34), 3.4, h * 0.42)} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'long':
      return {
        coversEars: true,
        back: <Path d={backPanel(g, 4, 62)} fill={color} />,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.34), fyL: y(-0.46), fyR: y(-0.3), partX: -g.w * 0.24 })} fill={color} />
            {gloss}
          </>
        ),
      };

    case 'wavy': {
      const panel = backPanel(g, 4.5, 56);
      return {
        coversEars: true,
        back: (
          <>
            <Path d={panel} fill={color} />
            {[-1, -0.55, 0, 0.55, 1].map((t, i) => (
              <Circle key={`w${i}`} cx={f(cx + t * (g.w + 4.5))} cy={56} r={4.4} fill={color} />
            ))}
          </>
        ),
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.3), fyL: y(-0.34), fyR: y(-0.44), partX: g.w * 0.26 })} fill={color} />
            <Path d={blob(cx - g.w * 0.86, y(-0.24), g.w * 0.36, h * 0.26, 0.4)} fill={shine} opacity={0.45} />
            {gloss}
          </>
        ),
      };
    }

    case 'bun':
      return {
        coversEars: false,
        // The bun overlaps the cap on purpose: pushed any higher it detaches into a
        // floating blob and gets sliced off by the disc.
        back: <Circle cx={f(cx)} cy={f(cy - h - 1.2)} r={f(g.w * 0.36)} fill={color} />,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(-0.1), fyL: y(-0.54), fyR: y(-0.54), grow: 1 })} fill={color} />
            <Path d={blob(cx, cy - h + 1, g.w * 0.72, h * 0.12)} fill={shine} opacity={0.4} />
          </>
        ),
      };

    case 'locs': {
      const cols = [-1, -0.62, -0.24, 0.24, 0.62, 1];
      return {
        coversEars: true,
        back: (
          <>
            {cols.map((t, i) => (
              <Path
                key={`l${i}`}
                d={blob(cx + t * (g.w + 1.2), y(0.5 + Math.abs(t) * 0.1), 2.3, h * 0.62)}
                fill={i % 2 === 0 ? color : shade}
              />
            ))}
          </>
        ),
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.1), fyL: y(-0.44), fyR: y(-0.44), grow: 1.6 })} fill={color} />
            {cols.map((t, i) => (
              <Path
                key={`lf${i}`}
                d={blob(cx + t * g.w * 0.72, y(-0.5), 1.9, h * 0.12)}
                fill={i % 2 === 0 ? shade : shine}
                opacity={0.55}
              />
            ))}
          </>
        ),
      };
    }

    case 'thin':
    default:
      // Receding, not bald. Drawn as a full cap with the crown taken back out again in
      // skin: the curve of that cut-out *is* the receding hairline, and it keeps hair
      // on the sides so the head still has a silhouette at 30px.
      return {
        coversEars: false,
        back: null,
        front: (
          <>
            <Path d={skullCap(g, { sideY: y(0.06), fyL: y(-0.5), fyR: y(-0.5), grow: 1 })} fill={color} />
            {/* Taken well below the cap's hairline: leave any of it showing and the
                remaining sliver reads as a headband rather than as a bare crown. */}
            <Path d={blob(cx, y(-0.74), g.w * 0.76, h * 0.42)} fill={skin} />
          </>
        ),
      };
  }
}

// ---------------------------------------------------------------------------
// Facial hair
// ---------------------------------------------------------------------------

const BEARDS = ['none', 'none', 'none', 'stubble', 'moustache', 'goatee', 'full', 'shortBeard'] as const;
type Beard = (typeof BEARDS)[number];

function beardFor(kind: Beard, g: Head, color: string): React.ReactNode {
  const { cx, cy, w, h } = g;
  const jw = w * g.jaw;
  const y = (t: number) => cy + h * t;

  /** The jawline mass, reused by the full beard and by stubble at low opacity. */
  const jawMass = [
    `M ${f(cx - w - 0.4)} ${f(y(-0.02))}`,
    `C ${f(cx - w - 0.4)} ${f(y(0.44))} ${f(cx - jw)} ${f(y(0.84))} ${f(cx)} ${f(y(1.05))}`,
    `C ${f(cx + jw)} ${f(y(0.84))} ${f(cx + w + 0.4)} ${f(y(0.44))} ${f(cx + w + 0.4)} ${f(y(-0.02))}`,
    `C ${f(cx + w * 0.55)} ${f(y(0.34))} ${f(cx - w * 0.55)} ${f(y(0.34))} ${f(cx - w - 0.4)} ${f(y(-0.02))} Z`,
  ].join(' ');

  switch (kind) {
    case 'stubble':
      return <Path d={jawMass} fill={color} opacity={0.3} />;
    case 'moustache':
      return (
        <Path
          d={`M ${f(cx - w * 0.42)} ${f(y(0.48))} C ${f(cx - w * 0.2)} ${f(y(0.4))} ${f(cx + w * 0.2)} ${f(y(0.4))} ${f(cx + w * 0.42)} ${f(y(0.48))} C ${f(cx + w * 0.24)} ${f(y(0.58))} ${f(cx - w * 0.24)} ${f(y(0.58))} ${f(cx - w * 0.42)} ${f(y(0.48))} Z`}
          fill={color}
        />
      );
    case 'goatee':
      return (
        <>
          <Path d={blob(cx, y(0.78), w * 0.36, h * 0.2)} fill={color} />
          <Path
            d={`M ${f(cx - w * 0.4)} ${f(y(0.48))} C ${f(cx - w * 0.18)} ${f(y(0.41))} ${f(cx + w * 0.18)} ${f(y(0.41))} ${f(cx + w * 0.4)} ${f(y(0.48))} C ${f(cx + w * 0.22)} ${f(y(0.57))} ${f(cx - w * 0.22)} ${f(y(0.57))} ${f(cx - w * 0.4)} ${f(y(0.48))} Z`}
            fill={color}
          />
        </>
      );
    case 'shortBeard':
      return <Path d={jawMass} fill={color} opacity={0.85} />;
    case 'full':
      return (
        <>
          <Path d={jawMass} fill={color} />
          <Path d={blob(cx, y(1.02), w * 0.62, h * 0.2)} fill={color} />
        </>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The portrait
// ---------------------------------------------------------------------------

/**
 * The clip is the same disc for everybody, so one shared id is correct rather than
 * merely convenient — every definition it could resolve to is identical.
 */
const CLIP_ID = 'tvt-portrait-disc';

export interface PortraitProps {
  /** Stable identity. Prefer the person's id: two people can share a name. */
  seed?: string;
  /** Used as the seed when no id is available, and never rendered as text. */
  name?: string;
  size?: number;
  /** Greying and softer lines. Optional — the face is complete without it. */
  age?: number;
  /** Nudges the odds on glasses. Writers' rooms wear them; leading actors less so. */
  role?: TalentRole;
  /** Star power ≥ 80 earns a brass rim, matching the Walk of Fame. */
  starPower?: number;
  retired?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Portrait({
  seed,
  name,
  size = 36,
  age,
  role,
  starPower = 0,
  retired = false,
  style,
}: PortraitProps) {
  const hash = hashString(seed ?? name ?? 'unknown');

  // --- Colour ---------------------------------------------------------------
  const skinIndex = Math.floor(draw(hash, 0) * SKINS.length) % SKINS.length;
  const skin = SKINS[skinIndex];
  const skinShade = mix(skin, '#6B3A20', 0.26);
  const skinDeep = mix(skin, '#5A2E18', 0.4);

  // Grey arrives gradually from the mid-forties and never goes fully white, because a
  // pure white cap at 30px reads as a bald spot rather than as an older person.
  const years = age ?? 38;
  const greyJitter = span(hash, 16, -6, 8);
  const grey = Math.max(0, Math.min(0.72, (years + greyJitter - 44) / 34));
  const baseHair = pick(HAIR_BY_SKIN[skinIndex], hash, 3);
  const hairColor = mix(baseHair, GREY, grey);
  const browColor = mix(baseHair, GREY, grey * 0.55);

  const backdrop = retired
    ? mix(pick(BACKDROPS, hash, 12), '#C4B69C', 0.65)
    : pick(BACKDROPS, hash, 12);
  const garment = retired
    ? mix(pick(GARMENTS, hash, 13), '#948674', 0.55)
    : pick(GARMENTS, hash, 13);
  const iris = mix(pick(IRIS, hash, 17), '#171310', 0.3);
  const lip = mix(skin, '#8C3A38', span(hash, 15, 0.34, 0.58));

  // --- Head -----------------------------------------------------------------
  const g: Head = {
    cx: 32,
    cy: 27.5,
    w: span(hash, 1, 14, 16.6),
    h: span(hash, 18, 19, 21.4),
    jaw: span(hash, 14, 0.54, 0.9),
  };
  const y = (t: number) => g.cy + g.h * t;

  // --- Features -------------------------------------------------------------
  const hairStyle = pick(HAIR_STYLES, hash, 2);
  const hair = hairFor(hairStyle, g, hairColor, skin);

  const eyeSep = span(hash, 5, 5.6, 7.2);
  const eyeY = y(0.02);
  const eyeRx = span(hash, 4, 2.0, 2.7);
  const eyeSquash = span(hash, 19, 0.62, 1.0);
  const eyeTilt = span(hash, 20, -0.16, 0.16);
  const hooded = draw(hash, 21) < 0.4;

  const browLift = span(hash, 22, 3.6, 5.2);
  const browArch = span(hash, 6, -0.9, 1.6);
  const browThick = span(hash, 23, 1.1, 2.1);

  const noseW = span(hash, 7, 1.7, 3.2);
  const noseLen = span(hash, 24, 0.2, 0.34);

  const mouthW = span(hash, 8, 3.4, 5.4);
  const mouthKind = Math.floor(draw(hash, 25) * 4);

  // Long hair and a full beard together read as a costume rather than a person, so
  // the two draws are coupled rather than independent.
  const longHair = hairStyle === 'long' || hairStyle === 'wavy' || hairStyle === 'bob';
  const beard: Beard = longHair && draw(hash, 26) < 0.88 ? 'none' : pick(BEARDS, hash, 9);
  const beardColor = mix(baseHair, GREY, grey * 0.85);

  const deskJob = role === 'writer' || role === 'showrunner' || role === 'producer';
  const glasses = draw(hash, 10) < (deskJob ? 0.4 : 0.16);
  const glassFrame = pick(['#332B25', '#332B25', '#8A6D4B', '#6B4A3A'], hash, 27);
  const earring = draw(hash, 11) < 0.18 && !hair.coversEars;

  const lines = years >= 56;

  const eye = (dir: 1 | -1) => {
    const ex = g.cx + dir * eyeSep;
    return (
      <G key={dir}>
        <Path d={blob(ex, eyeY, eyeRx, eyeRx * eyeSquash, dir * eyeTilt)} fill={iris} />
        {hooded ? (
          <Path
            d={blob(ex, eyeY - eyeRx * eyeSquash * 0.9, eyeRx * 1.06, eyeRx * 0.42, dir * eyeTilt)}
            fill={skinShade}
            opacity={0.55}
          />
        ) : null}
        {/* A catchlight does nothing at list size and everything at medallion size. */}
        <Circle cx={f(ex - dir * eyeRx * 0.3)} cy={f(eyeY - eyeRx * 0.34)} r={0.62} fill="#FFFFFF" opacity={0.85} />
      </G>
    );
  };

  const brow = (dir: 1 | -1) => {
    const bx = g.cx + dir * eyeSep;
    const by = eyeY - browLift;
    const half = eyeRx * 1.5;
    return (
      <Path
        key={dir}
        d={[
          `M ${f(bx - half)} ${f(by + browArch * 0.5)}`,
          `Q ${f(bx)} ${f(by - browArch)} ${f(bx + half)} ${f(by + browArch * 0.2)}`,
          `L ${f(bx + half)} ${f(by + browArch * 0.2 + browThick)}`,
          `Q ${f(bx)} ${f(by - browArch + browThick * 1.1)} ${f(bx - half)} ${f(by + browArch * 0.5 + browThick)} Z`,
        ].join(' ')}
        fill={browColor}
      />
    );
  };

  const mouth = () => {
    const my = y(0.62);
    if (mouthKind === 0) {
      // Closed and level.
      return <Path d={blob(g.cx, my, mouthW, 1.05)} fill={lip} />;
    }
    if (mouthKind === 1) {
      // A slight smile — a crescent, never teeth. Teeth at 30px are a white smudge.
      return (
        <Path
          d={`M ${f(g.cx - mouthW)} ${f(my - 0.6)} Q ${f(g.cx)} ${f(my + 2.8)} ${f(g.cx + mouthW)} ${f(my - 0.6)} Q ${f(g.cx)} ${f(my + 1.1)} ${f(g.cx - mouthW)} ${f(my - 0.6)} Z`}
          fill={lip}
        />
      );
    }
    if (mouthKind === 2) {
      // Fuller: two lobes above, one below.
      return (
        <>
          <Path d={blob(g.cx - mouthW * 0.45, my - 0.7, mouthW * 0.55, 0.95)} fill={lip} />
          <Path d={blob(g.cx + mouthW * 0.45, my - 0.7, mouthW * 0.55, 0.95)} fill={lip} />
          <Path d={blob(g.cx, my + 0.55, mouthW * 0.92, 1.25)} fill={mix(lip, '#FFFFFF', 0.12)} />
        </>
      );
    }
    return <Path d={blob(g.cx, my, mouthW * 0.8, 1.5)} fill={lip} />;
  };

  const nose = () => {
    const tip = y(noseLen + 0.06);
    return (
      <Path
        d={[
          `M ${f(g.cx - noseW * 0.2)} ${f(y(noseLen - 0.22))}`,
          `C ${f(g.cx + noseW * 0.6)} ${f(y(noseLen - 0.04))} ${f(g.cx + noseW)} ${f(tip - 1.2)} ${f(g.cx + noseW)} ${f(tip)}`,
          `C ${f(g.cx + noseW * 0.5)} ${f(tip + 1.4)} ${f(g.cx - noseW * 0.6)} ${f(tip + 1.2)} ${f(g.cx - noseW * 0.9)} ${f(tip - 0.2)} Z`,
        ].join(' ')}
        fill={skinShade}
        opacity={0.5}
      />
    );
  };

  const rim = starPower >= 80 && !retired ? BRASS : RIM;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <ClipPath id={CLIP_ID}>
            <Circle cx={32} cy={32} r={32} />
          </ClipPath>
        </Defs>

        <G clipPath={`url(#${CLIP_ID})`} opacity={retired ? 0.82 : 1}>
          <Circle cx={32} cy={32} r={32} fill={backdrop} />

          {hair.back}

          {/* Neck, then shoulders over it — the collar opening is cut into the
              shoulder path itself so no separate mask is needed. */}
          <Path
            d={`M ${f(g.cx - 5.8)} ${f(y(0.48))} L ${f(g.cx - 5.8)} 58 L ${f(g.cx + 5.8)} 58 L ${f(g.cx + 5.8)} ${f(y(0.48))} Z`}
            fill={skinShade}
          />
          <Path
            d="M 0 64 C 2 57 11 52.5 23 51.5 C 25 56.5 39 56.5 41 51.5 C 53 52.5 62 57 64 64 Z"
            fill={garment}
          />
          <Path
            d="M 23 51.5 C 25 56.5 39 56.5 41 51.5 C 39.5 53.4 38 54.4 32 54.4 C 26 54.4 24.5 53.4 23 51.5 Z"
            fill={mix(garment, '#000000', 0.28)}
          />

          {/* Ears sit under the face so only the outer edge shows. */}
          <Path d={blob(g.cx - g.w, y(0.08), 2.4, 3.4)} fill={skin} />
          <Path d={blob(g.cx + g.w, y(0.08), 2.4, 3.4)} fill={skin} />
          <Path d={blob(g.cx - g.w - 0.2, y(0.08), 1.2, 1.8)} fill={skinShade} opacity={0.5} />
          <Path d={blob(g.cx + g.w + 0.2, y(0.08), 1.2, 1.8)} fill={skinShade} opacity={0.5} />

          <Path d={facePath(g)} fill={skin} />

          {beardFor(beard, g, beardColor)}

          {nose()}
          {eye(-1)}
          {eye(1)}
          {brow(-1)}
          {brow(1)}
          {mouth()}

          {lines ? (
            <>
              <Path
                d={`M ${f(g.cx - g.w * 0.42)} ${f(y(0.4))} Q ${f(g.cx - g.w * 0.5)} ${f(y(0.56))} ${f(g.cx - g.w * 0.36)} ${f(y(0.68))}`}
                stroke={skinDeep}
                strokeWidth={0.9}
                strokeLinecap="round"
                fill="none"
                opacity={0.32}
              />
              <Path
                d={`M ${f(g.cx + g.w * 0.42)} ${f(y(0.4))} Q ${f(g.cx + g.w * 0.5)} ${f(y(0.56))} ${f(g.cx + g.w * 0.36)} ${f(y(0.68))}`}
                stroke={skinDeep}
                strokeWidth={0.9}
                strokeLinecap="round"
                fill="none"
                opacity={0.32}
              />
            </>
          ) : null}

          {hair.front}

          {glasses ? (
            <G>
              <Path
                d={`M ${f(g.cx - eyeSep - 4)} ${f(eyeY - 3.2)} h 8 v 6.6 h -8 Z M ${f(g.cx + eyeSep - 4)} ${f(eyeY - 3.2)} h 8 v 6.6 h -8 Z`}
                fill="none"
                stroke={glassFrame}
                strokeWidth={1.5}
              />
              <Path
                d={`M ${f(g.cx - eyeSep + 4)} ${f(eyeY)} H ${f(g.cx + eyeSep - 4)} M ${f(g.cx - eyeSep - 4)} ${f(eyeY - 1.4)} H ${f(g.cx - g.w)} M ${f(g.cx + eyeSep + 4)} ${f(eyeY - 1.4)} H ${f(g.cx + g.w)}`}
                stroke={glassFrame}
                strokeWidth={1.3}
                fill="none"
              />
            </G>
          ) : null}

          {earring ? (
            <>
              <Circle cx={f(g.cx - g.w - 0.4)} cy={f(y(0.2))} r={1.4} fill={BRASS} />
              <Circle cx={f(g.cx + g.w + 0.4)} cy={f(y(0.2))} r={1.4} fill={BRASS} />
            </>
          ) : null}
        </G>

        {/* The rim keeps the disc off a cream panel, and turns brass for a real star. */}
        <Circle cx={32} cy={32} r={31} fill="none" stroke={rim} strokeWidth={2} opacity={0.9} />
      </Svg>
    </View>
  );
}
