import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinear,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { avatarColor, initialsOf, posterFor, type PosterArt } from './art';
import { Icon } from './icons';
import type { Format } from '../engine/types';

/**
 * Show posters.
 *
 * A poster used to be a gradient with a geometric motif stamped on it. That beat a wall
 * of text, but it read as a colour swatch rather than artwork for a television
 * programme — and the poster is the main image in the entire product, on the shelf, the
 * pitch table, the ratings chart, the in-tray and the archive.
 *
 * A poster is now an actual composition: a background, a midground, a foreground
 * subject, a period finish and a frame device, drawn as SVG paths on a 100×130 stage.
 * `art.ts` decides *which* composition from the show's id and era; everything below
 * just draws it. Nothing here is random at render time — the same show is the same
 * picture forever.
 *
 * Two rules keep it honest at the sizes it actually ships at:
 *   • Everything is silhouettes and flat fields. A silhouette survives 40×52; a
 *     one-pixel outline does not.
 *   • Every drawing function takes a `detail` level and drops layers at `sm`. A
 *     thumbnail with the boldest three shapes reads; the same drawing at full detail
 *     is mud.
 */

/** The stage every poster is drawn on. All geometry below is in these units. */
const W = 100;
const H = 130;

/** 0 = thumbnail, 1 = card, 2 = hero. Drives how many layers survive. */
type Detail = 0 | 1 | 2;

/**
 * Memoised because the pitch pile, the archive and the ratings chart each put thirty
 * of these on screen, and every store tick re-renders their parents.
 */
export const Poster = React.memo(function Poster({
  seed,
  format,
  title,
  size = 'md',
  live = false,
  era,
  style,
}: {
  seed: string;
  format: Format;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  live?: boolean;
  /** Overrides the era looked up from the seed — for callers holding the archetype. */
  era?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const art = posterFor(seed, format, era);
  const metrics = SIZES[size];
  const detail: Detail = size === 'sm' ? 0 : size === 'md' ? 1 : 2;
  const p = art.palette;

  // Rebuilding forty path strings on every store tick is the one thing that could make
  // a thirty-poster room stutter. Only the spec and the size can change the picture.
  const picture = React.useMemo(() => buildPicture(art, detail), [art, detail]);

  return (
    <View style={[styles.frame, metrics.frame, { backgroundColor: p.ground }, style]}>
      <Svg
        width={metrics.frame.width}
        height={metrics.frame.height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        {picture}
      </Svg>

      {/* The genre mark, as a network bug in the corner rather than stamped across the
          middle — the composition already says what kind of show this is.

          Absent entirely at `sm`, where a 40px tile has room for exactly one idea and
          the picture is the better one. A badge big enough to read there was eating a
          quarter of the artwork to repeat what the artwork already said. */}
      {size !== 'sm' ? (
        <View
          style={[
            styles.bug,
            {
              width: metrics.bug,
              height: metrics.bug,
              borderRadius: metrics.bug / 3,
              backgroundColor: p.ink,
              borderColor: p.light,
            },
          ]}
        >
          <Icon name={art.icon} size={metrics.glyph} color={p.light} opacity={0.95} />
        </View>
      ) : null}

      {live ? (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      ) : null}

      {title && size !== 'sm' ? (
        <View style={[styles.captionWrap, { backgroundColor: p.ink }]}>
          {/* A rule in the accent above the title — the one detail that reads as
              typesetting rather than a label slapped over a picture. */}
          <View style={[styles.captionRule, { backgroundColor: p.accent }]} />
          <Text
            style={[
              styles.caption,
              CAPTION_STYLE[art.caption],
              titleType(title, size, art.caption),
              { color: p.light },
            ]}
            numberOfLines={3}
          >
            {art.caption === 'quiet' ? title : title.toUpperCase()}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/** Round avatar for a person, coloured from their name. */
export function Avatar({
  name,
  size = 36,
  style,
}: {
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [from, to] = avatarColor(name);

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' },
        style,
      ]}
    >
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill as StyleProp<ViewStyle>, styles.avatarInner]}
      >
        <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initialsOf(name)}</Text>
      </LinearGradient>
    </View>
  );
}

/* ------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Background wash → composition → period finish → frame.
 *
 * Kept as one flat list rather than nested groups: SVG has no z-index, so paint order
 * *is* the depth, and a single ordered array makes that impossible to get wrong.
 */
function buildPicture(art: PosterArt, d: Detail): React.ReactNode {
  const p = art.palette;
  const g = art.gid;

  return (
    <>
      <Defs>
        <SvgLinear id={`${g}s`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={p.sky} />
          <Stop offset="1" stopColor={p.ground} />
        </SvgLinear>
        {d > 0 ? (
          <RadialGradient id={`${g}v`} cx="50%" cy="45%" rx="72%" ry="66%">
            <Stop offset="0.5" stopColor={p.ink} stopOpacity="0" />
            <Stop offset="1" stopColor={p.ink} stopOpacity={String(r1(art.vignette))} />
          </RadialGradient>
        ) : null}
      </Defs>

      <Rect x={0} y={0} width={W} height={H} fill={`url(#${g}s)`} />

      {TEMPLATES[art.template](art, d)}

      {finish(art, d)}

      {/* Vignette last but one: it has to sit over the picture and under the frame,
          or the keyline gets dimmed at exactly the corners that carry it. */}
      {d > 0 ? <Rect x={0} y={0} width={W} height={H} fill={`url(#${g}v)`} /> : null}

      {frame(art, d)}
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Drawing helpers                                                            */
/* ------------------------------------------------------------------------- */

/** One decimal is plenty at this scale, and it keeps the path strings short. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A standing figure as a single path: head, shoulders, flared body to the floor.
 *
 * Deliberately faceless and slightly heroic in proportion. It is the workhorse of five
 * of the eight compositions, and it is what makes a poster read as being *about people*
 * from across the room.
 */
function person(cx: number, base: number, h: number): string {
  const hr = h * 0.135;
  const hy = base - h + hr;
  const sw = h * 0.17;
  const bw = h * 0.24;
  return (
    `M${r1(cx)} ${r1(hy - hr)}a${r1(hr)} ${r1(hr)} 0 1 1 0 ${r1(hr * 2)}` +
    `a${r1(hr)} ${r1(hr)} 0 1 1 0 ${r1(-hr * 2)}Z` +
    `M${r1(cx - sw)} ${r1(hy + hr * 1.05)}q${r1(sw)} ${r1(-hr * 0.85)} ${r1(sw * 2)} 0` +
    `L${r1(cx + bw)} ${r1(base)}L${r1(cx - bw)} ${r1(base)}Z`
  );
}

/**
 * Scale the subject about the bottom of the frame.
 *
 * The era's `fill` is the difference between a 1950s one-sheet packed to the keyline
 * and 2020s key art that is mostly empty cream. Scaling about the floor rather than the
 * centre keeps the subject standing on the ground while it shrinks.
 */
function subjectTransform(a: PosterArt, d: Detail): string {
  const fill = subjectFill(a, d);
  return `translate(${r1(W / 2 - (W / 2) * fill)} ${r1(H - H * fill)}) scale(${r1(fill)})`;
}

/**
 * Thumbnails get a bigger subject than the era would ask for.
 *
 * The 2010s and 2020s treatments are deliberately mostly empty space, which is right at
 * 132px and useless at 40px — a lone figure at 72% of a 40px tile is a smudge. The
 * boost only applies at `sm`, so the era's sense of scale survives everywhere it can
 * actually be seen.
 */
function subjectFill(a: PosterArt, d: Detail): number {
  return d === 0 ? Math.min(1, a.fill * 1.3) : a.fill;
}

/** A wedge from a focal point out past the frame — rays, starbursts, light cones. */
function wedge(fx: number, fy: number, a0: number, a1: number, len: number): string {
  const x0 = fx + Math.cos(a0) * len;
  const y0 = fy + Math.sin(a0) * len;
  const x1 = fx + Math.cos(a1) * len;
  const y1 = fy + Math.sin(a1) * len;
  return `${r1(fx)},${r1(fy)} ${r1(x0)},${r1(y0)} ${r1(x1)},${r1(y1)}`;
}

/* ------------------------------------------------------------------------- */
/* The eight compositions                                                     */
/* ------------------------------------------------------------------------- */

type Template = (a: PosterArt, d: Detail) => React.ReactNode;

/** Proscenium arch, twin light cones, a performer in the pool. Variety and talk. */
const stage: Template = (a, d) => {
  const p = a.palette;
  const floor = 98;
  const cast = 1 + Math.round(a.v[3] * (d > 0 ? 2 : 0));

  return (
    <>
      <Rect x={0} y={floor} width={W} height={H - floor} fill={p.ground} />
      {/* Light cones before the curtains: the beams have to fall *behind* the drapes. */}
      <Polygon points={`16,-4 -6,${floor} 44,${floor}`} fill={p.light} opacity={0.16} />
      <Polygon points={`84,-4 56,${floor} 106,${floor}`} fill={p.light} opacity={0.16} />
      {d > 0 ? <Polygon points={`50,-4 22,${floor} 78,${floor}`} fill={p.light} opacity={0.1} /> : null}

      <Ellipse cx={50} cy={floor + 2} rx={34} ry={8} fill={p.accent} opacity={0.55} />

      <G transform={subjectTransform(a, d)}>
        {Array.from({ length: cast }, (_, i) => {
          const spread = cast === 1 ? 0 : (i / (cast - 1) - 0.5) * (30 + a.v[4] * 14);
          const h = 40 + a.bars[i] * 12 - Math.abs(spread) * 0.15;
          return <Path key={i} d={person(50 + spread, floor + 3, h)} fill={p.ink} />;
        })}
      </G>

      {d > 0 ? (
        <>
          {/* Drapes, gathered — the shape that says "theatre" faster than any icon. */}
          <Path d="M0 0 H26 C23 28 27 58 19 86 C13 104 7 118 0 126 Z" fill={p.accent} />
          <Path d="M100 0 H74 C77 28 73 58 81 86 C87 104 93 118 100 126 Z" fill={p.accent} />
          <Path d="M0 0 H100 V13 Q75 27 50 14 Q25 27 0 13 Z" fill={p.accent} />
          <Path
            d="M0 13 Q25 27 50 14 Q75 27 100 13 V17 Q75 31 50 18 Q25 31 0 17 Z"
            fill={p.ink}
            opacity={0.35}
          />
        </>
      ) : null}
      {d > 1 ? (
        <Rect x={49} y={floor - 30} width={1.6} height={30} fill={p.ink} opacity={0.7} />
      ) : null}
    </>
  );
};

/** City at three depths under a low disc. Crime, melodrama, the ten o'clock news. */
const skyline: Template = (a, d) => {
  const p = a.palette;
  const cx = 22 + a.v[0] * 56;
  const cy = 28 + a.v[1] * 16;
  const rad = 11 + a.v[2] * 9;

  const row = (n: number, top: number, span: number, opacity: number) =>
    Array.from({ length: n }, (_, i) => {
      const w = W / (n - 1);
      return (
        <Rect
          key={`${top}-${i}`}
          x={r1(i * w - w * 0.35)}
          y={r1(top + a.bars[(i + Math.round(top)) % 12] * span)}
          width={r1(w * 0.86)}
          height={H}
          fill={p.ink}
          opacity={opacity}
        />
      );
    });

  return (
    <>
      <Circle cx={cx} cy={cy} r={rad} fill={p.accent} />
      {d > 0 ? <Circle cx={cx} cy={cy} r={rad + 5} fill={p.accent} opacity={0.22} /> : null}

      {d > 0 ? row(8, 54, 26, 0.46) : null}
      {d > 0 ? row(7, 74, 20, 0.74) : null}
      {row(6, d > 0 ? 90 : 66, d > 0 ? 16 : 26, 1)}

      {/* Lit windows: the difference between a bar chart and a city after dark. */}
      {d > 1
        ? Array.from({ length: 9 }, (_, i) => (
            <Rect
              key={`w${i}`}
              x={r1(6 + ((i * 23) % 88))}
              y={r1(96 + a.v[i % 12] * 20)}
              width={2.4}
              height={3.4}
              fill={p.light}
              opacity={0.65}
            />
          ))
        : null}

      <Rect x={0} y={122} width={W} height={8} fill={p.ink} />
    </>
  );
};

/** Rolling land under a big sun. Nature, childhood, anything with weather in it. */
const horizon: Template = (a, d) => {
  const p = a.palette;
  const sx = 26 + a.v[0] * 48;
  const sr = 14 + a.v[1] * 9;

  return (
    <>
      <Circle cx={sx} cy={42} r={sr} fill={p.accent} />
      {d > 0 ? (
        <Circle cx={sx} cy={42} r={sr + 6} fill="none" stroke={p.light} strokeWidth={1.2} opacity={0.4} />
      ) : null}

      {d > 0 ? (
        <Path
          d={`M-2 ${r1(76 + a.v[2] * 6)}Q26 ${r1(60 + a.v[3] * 12)} 54 ${r1(72 + a.v[4] * 6)}` +
            `Q80 ${r1(62 + a.v[5] * 10)} 102 ${r1(74 + a.v[6] * 6)}V132H-2Z`}
          fill={p.ink}
          opacity={0.3}
        />
      ) : null}
      <Path
        d={`M-2 ${r1(92 + a.v[7] * 5)}Q30 ${r1(76 + a.v[8] * 12)} 58 ${r1(89 + a.v[9] * 5)}` +
          `Q84 ${r1(80 + a.v[10] * 10)} 102 ${r1(91 + a.v[11] * 5)}V132H-2Z`}
        fill={p.ink}
        opacity={0.6}
      />
      <Path
        d={`M-2 108Q28 ${r1(95 + a.v[0] * 10)} 56 106Q82 ${r1(99 + a.v[1] * 8)} 102 108V132H-2Z`}
        fill={p.ink}
      />

      {/* A lone tree on the near ridge gives the hills a scale to be read against. */}
      {d > 0 ? (
        <Path
          d={`M${r1(16 + a.v[3] * 68)} 88 l-7 18 h4 l-5 12 h16 l-5 -12 h4 Z`}
          fill={p.ink}
          opacity={0.85}
        />
      ) : null}
      {d > 1
        ? [0, 1, 2].map((i) => {
            const bx = 14 + a.v[i + 4] * 60;
            const by = 20 + a.v[i + 7] * 20;
            return (
              <Path
                key={`b${i}`}
                d={`M${r1(bx)} ${r1(by)}q3.5 -3 7 0q3.5 -3 7 0`}
                fill="none"
                stroke={p.ink}
                strokeWidth={1.2}
                opacity={0.55}
              />
            );
          })
        : null}
    </>
  );
};

/**
 * One face filling the frame. The prestige one-sheet, and the soap close-up.
 *
 * Everything here is off a seed value, because portrait is the busiest template in the
 * set — five formats reach for it, and thirty 2000s shows leaning on one fixed head in
 * one fixed disc made a whole shelf read as the same poster. The head moves, changes
 * size, gains a hat or a bob, and the glow behind it moves independently.
 */
const portrait: Template = (a, d) => {
  const p = a.palette;
  const hx = 50 + (a.v[4] - 0.5) * 16;
  const hy = 48 + a.v[5] * 8;
  const hr = 19 + a.v[6] * 5;
  const hair = Math.floor(a.v[0] * 4);

  return (
    <>
      <Circle
        cx={r1(50 + (a.v[1] - 0.5) * 24)}
        cy={r1(46 + a.v[2] * 16)}
        r={r1(28 + a.v[3] * 14)}
        fill={p.accent}
        opacity={0.55}
      />
      <G transform={subjectTransform(a, d)}>
        {/* Neck first, then a bust whose shoulders start well clear of the jaw.
            The earlier version ran the shoulders straight off the bottom of the head
            and the two fused into one egg — a silhouette needs the pinch at the neck
            to read as a person rather than a keyhole. */}
        <Rect
          x={r1(hx - hr * 0.34)}
          y={r1(hy + hr * 0.5)}
          width={r1(hr * 0.68)}
          height={r1(hr * 1.3)}
          fill={p.ink}
        />
        <Path
          d={
            `M${r1(hx - hr * 2.6)} 132V${r1(hy + hr * 2.1)}` +
            `q${r1(hr * 0.4)}-${r1(hr * 0.75)} ${r1(hr * 2.6)}-${r1(hr * 0.75)}` +
            `t${r1(hr * 2.6)} ${r1(hr * 0.75)}V132Z`
          }
          fill={p.ink}
        />
        <Circle cx={r1(hx)} cy={r1(hy)} r={r1(hr)} fill={p.ink} />

        {hair === 0 ? (
          // Fedora, sitting on the crown rather than cutting across the face.
          <>
            <Rect
              x={r1(hx - hr * 1.9)}
              y={r1(hy - hr * 0.72)}
              width={r1(hr * 3.8)}
              height={r1(hr * 0.26)}
              rx={r1(hr * 0.12)}
              fill={p.ink}
            />
            <Path
              d={
                `M${r1(hx - hr * 1.02)} ${r1(hy - hr * 0.72)}` +
                `c0-${r1(hr * 0.95)} ${r1(hr * 0.44)}-${r1(hr * 1.28)} ${r1(hr * 1.02)}-${r1(hr * 1.28)}` +
                `s${r1(hr * 1.02)} ${r1(hr * 0.33)} ${r1(hr * 1.02)} ${r1(hr * 1.28)}Z`
              }
              fill={p.ink}
            />
          </>
        ) : hair === 1 ? (
          // Bob — a shell around the head that falls past the jaw.
          <Path
            d={
              `M${r1(hx - hr * 1.18)} ${r1(hy + hr * 0.85)}` +
              `a${r1(hr * 1.18)} ${r1(hr * 1.3)} 0 1 1 ${r1(hr * 2.36)} 0` +
              `l${r1(-hr * 0.4)} 0` +
              `a${r1(hr * 0.8)} ${r1(hr * 0.95)} 0 1 0 ${r1(-hr * 1.56)} 0Z`
            }
            fill={p.ink}
          />
        ) : hair === 2 ? (
          // Quiff.
          <Path
            d={
              `M${r1(hx - hr * 0.96)} ${r1(hy - hr * 0.42)}` +
              `a${r1(hr * 0.96)} ${r1(hr * 0.96)} 0 0 1 ${r1(hr * 1.92)} 0` +
              `c${r1(-hr * 0.3)}-${r1(hr * 0.5)}-${r1(hr * 1.56)}-${r1(hr * 0.5)}-${r1(hr * 1.92)} 0Z`
            }
            fill={p.ink}
          />
        ) : null}

        {/* Rim light down one cheek: the whole reason the head reads as a head and not
            a circle. Only at card size and up — one pixel of it is noise. */}
        {d > 0 ? (
          <Path
            d={
              `M${r1(hx - hr * 0.9)} ${r1(hy - hr * 0.45)}` +
              `a${r1(hr)} ${r1(hr)} 0 0 0 ${r1(hr * 0.55)} ${r1(hr * 1.35)}` +
              `l${r1(-hr * 0.3)} ${r1(hr * 0.12)}` +
              `a${r1(hr)} ${r1(hr)} 0 0 1 ${r1(-hr * 0.42)}-${r1(hr * 1.42)}Z`
            }
            fill={p.light}
            opacity={0.5}
          />
        ) : null}
      </G>
    </>
  );
};

/**
 * Radiating wedges around a central device. Prizes, spectacle, Saturday night.
 *
 * The first version put a star in a disc every time, and a sheet of them read as one
 * poster printed fourteen times. The device is now one of four — star badge, prize
 * wheel, eclipse, marquee plate — the focal point moves off centre, the spokes vary in
 * count and colour, and half of them are cut from the accent rather than the light.
 */
const starburst: Template = (a, d) => {
  const p = a.palette;
  const fx = 50 + (a.v[2] - 0.5) * 22;
  const fy = 46 + a.v[3] * 22;
  const spokes = d > 0 ? [10, 14, 18][Math.floor(a.v[5] * 3)] : 8;
  const step = (Math.PI * 2) / spokes;
  const spin = a.v[0] * step;
  const rayInk = a.v[4] < 0.45 ? p.accent : p.light;
  const device = Math.floor(a.v[1] * 4);
  const rad = 22 + a.v[6] * 10;

  return (
    <>
      {Array.from({ length: Math.floor(spokes / 2) }, (_, i) => (
        <Polygon
          key={i}
          points={wedge(fx, fy, spin + i * step * 2, spin + i * step * 2 + step, 190)}
          fill={rayInk}
          opacity={0.24}
        />
      ))}
      <G transform={subjectTransform(a, d)}>
        {device === 0 ? (
          <>
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad)} fill={p.accent} />
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad)} fill="none" stroke={p.ink} strokeWidth={3} />
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad * 0.6)} fill={p.light} />
            <Path
              d={
                `M${r1(fx)} ${r1(fy - rad * 0.5)}l${r1(rad * 0.14)} ${r1(rad * 0.33)}` +
                `l${r1(rad * 0.36)} .02l${r1(-rad * 0.27)} ${r1(rad * 0.24)}` +
                `l${r1(rad * 0.1)} ${r1(rad * 0.35)}l${r1(-rad * 0.33)}-${r1(rad * 0.2)}` +
                `l${r1(-rad * 0.33)} ${r1(rad * 0.2)}l${r1(rad * 0.1)}-${r1(rad * 0.35)}` +
                `l${r1(-rad * 0.27)}-${r1(rad * 0.24)}l${r1(rad * 0.36)}-.02Z`
              }
              fill={p.ink}
            />
          </>
        ) : device === 1 ? (
          <>
            {/* Prize wheel: alternating segments, hub and a pointer at the top. */}
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad)} fill={p.light} />
            {Array.from({ length: 4 }, (_, i) => (
              <Polygon
                key={i}
                points={wedge(fx, fy, i * (Math.PI / 2) + spin, i * (Math.PI / 2) + Math.PI / 4 + spin, rad)}
                fill={p.accent}
              />
            ))}
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad)} fill="none" stroke={p.ink} strokeWidth={3} />
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad * 0.22)} fill={p.ink} />
            <Path
              d={`M${r1(fx - 4)} ${r1(fy - rad - 6)}h8l-4 9Z`}
              fill={p.ink}
            />
          </>
        ) : device === 2 ? (
          <>
            {/* Eclipse: two offset discs, no badge at all. */}
            <Circle cx={r1(fx)} cy={r1(fy)} r={r1(rad * 1.15)} fill={p.accent} />
            <Circle
              cx={r1(fx + rad * 0.35)}
              cy={r1(fy - rad * 0.28)}
              r={r1(rad * 0.82)}
              fill={p.ink}
            />
            <Circle
              cx={r1(fx)}
              cy={r1(fy)}
              r={r1(rad * 1.45)}
              fill="none"
              stroke={p.light}
              strokeWidth={1.6}
              opacity={0.6}
            />
          </>
        ) : (
          <>
            {/* Marquee plate: a card of type rules, the way a variety bill was set. */}
            <Rect
              x={r1(fx - rad * 1.35)}
              y={r1(fy - rad * 0.8)}
              width={r1(rad * 2.7)}
              height={r1(rad * 1.6)}
              rx={2}
              fill={p.light}
            />
            <Rect
              x={r1(fx - rad * 1.35)}
              y={r1(fy - rad * 0.8)}
              width={r1(rad * 2.7)}
              height={r1(rad * 1.6)}
              rx={2}
              fill="none"
              stroke={p.ink}
              strokeWidth={2.4}
            />
            <Rect x={r1(fx - rad)} y={r1(fy - rad * 0.4)} width={r1(rad * 2)} height={r1(rad * 0.3)} fill={p.accent} />
            <Rect x={r1(fx - rad * 0.7)} y={r1(fy + rad * 0.05)} width={r1(rad * 1.4)} height={r1(rad * 0.22)} fill={p.ink} />
            <Rect x={r1(fx - rad * 0.45)} y={r1(fy + rad * 0.4)} width={r1(rad * 0.9)} height={r1(rad * 0.16)} fill={p.ink} opacity={0.6} />
          </>
        )}
      </G>
      {d > 1
        ? Array.from({ length: 8 }, (_, i) => (
            <Circle
              key={`c${i}`}
              cx={r1(6 + a.v[i] * 88)}
              cy={r1(6 + a.bars[i] * 118)}
              r={r1(1.4 + a.bars[(i + 3) % 12] * 2)}
              fill={p.light}
              opacity={0.5}
            />
          ))
        : null}
      <Rect x={0} y={120} width={W} height={10} fill={p.ink} opacity={0.7} />
    </>
  );
};

/** Blind-light across a lone figure with a long shadow. Procedurals and anthologies. */
const noir: Template = (a, d) => {
  const p = a.palette;
  const fx = 30 + a.v[0] * 40;
  const bars = d > 0 ? 7 : 4;
  const gap = 132 / bars;

  return (
    <>
      <Rect x={0} y={0} width={W} height={H} fill={p.ink} opacity={0.5} />
      {Array.from({ length: bars }, (_, i) => {
        const y = -6 + i * gap;
        const h = gap * 0.42;
        return (
          <Polygon
            key={i}
            points={`-8,${r1(y)} 108,${r1(y - 34)} 108,${r1(y - 34 + h)} -8,${r1(y + h)}`}
            fill={p.light}
            opacity={0.17}
          />
        );
      })}

      {/* The shadow is drawn before the figure so the figure keeps its hard edge. */}
      {d > 0 ? (
        <Polygon
          points={`${r1(fx - 6)},116 ${r1(fx + 6)},116 108,${r1(92 + a.v[1] * 14)} 108,132 ${r1(fx)},132`}
          fill={p.ink}
          opacity={0.6}
        />
      ) : null}
      <Path d={person(fx, 117, (d > 0 ? 72 : 92) * subjectFill(a, d))} fill={p.ink} />
      {d > 0 ? (
        <Path
          d={person(fx, 117, 72 * a.fill)}
          fill="none"
          stroke={p.accent}
          strokeWidth={0.9}
          opacity={0.7}
        />
      ) : null}

      <Rect x={0} y={116} width={W} height={14} fill={p.ink} opacity={0.9} />
    </>
  );
};

/** A row of silhouettes shoulder to shoulder. The cast, the troupe, the housemates. */
const ensemble: Template = (a, d) => {
  const p = a.palette;
  const n = d > 0 ? 4 + Math.round(a.v[0]) : 3;
  const base = 118;

  return (
    <>
      <Circle cx={50} cy={54} r={r1(32 + a.v[1] * 10)} fill={p.accent} opacity={0.85} />
      {d > 0 ? (
        <Circle cx={50} cy={54} r={r1(38 + a.v[1] * 10)} fill="none" stroke={p.light} strokeWidth={1.4} opacity={0.45} />
      ) : null}

      <G transform={subjectTransform(a, d)}>
        {/* Back row first, then the taller front pair over it — depth from overlap,
            which is the cheapest convincing depth cue there is. */}
        {Array.from({ length: n }, (_, i) => {
          const cx = (W / (n + 1)) * (i + 1);
          const h = 44 + a.bars[i] * 16;
          return <Path key={i} d={person(cx, base, h)} fill={p.ink} />;
        })}
      </G>

      <Rect x={0} y={base - 2} width={W} height={H - base + 2} fill={p.ink} />
      {d > 1 ? <Rect x={0} y={base - 3} width={W} height={1.2} fill={p.light} opacity={0.5} /> : null}
    </>
  );
};

/** Rings, bars and a crosshair. Broadcast itself — news, documentary, anthology. */
const testcard: Template = (a, d) => {
  const p = a.palette;
  const cy = 54;
  const rings = d > 0 ? [34, 26, 18, 10] : [30, 16];
  const barColors = [p.accent, p.light, p.ink, p.accent, p.light, p.ink];
  const bars = d > 0 ? 6 : 4;

  return (
    <>
      <Rect x={0} y={0} width={W} height={H} fill={p.ink} opacity={0.18} />
      {rings.map((rr, i) => (
        <Circle
          key={rr}
          cx={50}
          cy={cy}
          r={rr}
          fill="none"
          stroke={i % 2 === 0 ? p.light : p.accent}
          strokeWidth={d > 0 ? 3 : 4}
          opacity={0.9}
        />
      ))}
      {d > 0 ? (
        <>
          <Rect x={12} y={cy - 0.7} width={76} height={1.4} fill={p.light} opacity={0.75} />
          <Rect x={49.3} y={cy - 38} width={1.4} height={76} fill={p.light} opacity={0.75} />
        </>
      ) : null}

      {Array.from({ length: bars }, (_, i) => (
        <Rect
          key={`b${i}`}
          x={r1((W / bars) * i)}
          y={98}
          width={r1(W / bars) + 0.4}
          height={32}
          fill={barColors[i % barColors.length]}
          opacity={0.9}
        />
      ))}
      {d > 1
        ? [
            [4, 4], [88, 4], [4, 118], [88, 118],
          ].map(([x, y], i) => (
            <Rect key={`t${i}`} x={x} y={y} width={8} height={8} fill={p.light} opacity={0.5} />
          ))
        : null}
    </>
  );
};

const TEMPLATES: Record<PosterArt['template'], Template> = {
  stage,
  skyline,
  horizon,
  portrait,
  starburst,
  noir,
  ensemble,
  testcard,
};

/* ------------------------------------------------------------------------- */
/* Period finish                                                              */
/* ------------------------------------------------------------------------- */

/**
 * The layer that dates the poster.
 *
 * Halftone dots and a two-colour print say 1955. A vanishing-point grid says 1985.
 * Letterboxing says a 2014 trailer frame. It is the same composition underneath; the
 * finish is what makes the shelf read as forty years of television rather than a set.
 */
function finish(a: PosterArt, d: Detail): React.ReactNode {
  const p = a.palette;
  if (a.overlay === 'letterbox') {
    return (
      <>
        <Rect x={0} y={0} width={W} height={9} fill="#000000" opacity={0.88} />
        <Rect x={0} y={H - 9} width={W} height={9} fill="#000000" opacity={0.88} />
      </>
    );
  }

  // Everything else is texture, and texture at 40px is dirt. Thumbnails go without.
  if (d === 0) return null;

  switch (a.overlay) {
    case 'halftone':
      return (
        <G opacity={0.32}>
          {Array.from({ length: 16 }, (_, i) => {
            const col = i % 4;
            const row = Math.floor(i / 4);
            return (
              <Circle
                key={i}
                cx={r1(62 + col * 11)}
                cy={r1(8 + row * 11)}
                r={r1(1 + (col + row) * 0.42)}
                fill={p.ink}
              />
            );
          })}
        </G>
      );
    case 'rays':
      return (
        <G opacity={0.12}>
          {Array.from({ length: 5 }, (_, i) => (
            <Polygon
              key={i}
              points={wedge(50, -16, Math.PI * 0.18 + i * 0.32, Math.PI * 0.18 + i * 0.32 + 0.14, 220)}
              fill={p.light}
            />
          ))}
        </G>
      );
    case 'grid': {
      const vy = 84;
      return (
        <G opacity={0.55}>
          {Array.from({ length: 9 }, (_, i) => (
            <Path
              key={`v${i}`}
              d={`M50 ${vy}L${r1(-70 + i * 30)} 132`}
              stroke={p.accent}
              strokeWidth={0.7}
              fill="none"
            />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <Rect
              key={`h${i}`}
              x={0}
              y={r1(vy + Math.pow(i + 1, 1.7) * 2.6)}
              width={W}
              height={0.7}
              fill={p.accent}
            />
          ))}
        </G>
      );
    }
    case 'scan':
      return (
        <G opacity={0.12}>
          {Array.from({ length: 11 }, (_, i) => (
            <Rect key={i} x={0} y={r1(i * 12)} width={W} height={1.8} fill={p.ink} />
          ))}
        </G>
      );
    case 'gloss':
      return (
        <Polygon
          points={`0,0 100,0 100,26 0,54`}
          fill={p.light}
          opacity={0.18}
        />
      );
    default:
      return null;
  }
}

/** The keyline. A double rule reads as letterpress; none at all reads as modern. */
function frame(a: PosterArt, d: Detail): React.ReactNode {
  const p = a.palette;
  if (a.border === 'none') return null;
  if (a.border === 'thin' && d === 0) return null;

  const outer = (
    <Rect
      x={2}
      y={2}
      width={W - 4}
      height={H - 4}
      fill="none"
      stroke={a.border === 'thick' ? p.ink : p.light}
      strokeWidth={a.border === 'thick' ? 4.5 : a.border === 'double' ? 1.8 : 1}
      opacity={a.border === 'thin' ? 0.5 : 0.85}
    />
  );
  if (a.border !== 'double' || d === 0) return outer;

  return (
    <>
      {outer}
      <Rect x={6} y={6} width={W - 12} height={H - 12} fill="none" stroke={p.light} strokeWidth={0.8} opacity={0.55} />
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Metrics and styles                                                         */
/* ------------------------------------------------------------------------- */

const SIZES = {
  sm: {
    frame: { width: 40, height: 52, borderRadius: 6 },
    bug: 15,
    glyph: 10,
    caption: { fontSize: 8 },
  },
  md: {
    frame: { width: 92, height: 120, borderRadius: 10 },
    bug: 22,
    glyph: 15,
    caption: { fontSize: 10 },
  },
  lg: {
    frame: { width: 132, height: 172, borderRadius: 12 },
    bug: 28,
    glyph: 19,
    caption: { fontSize: 12 },
  },
} as const;

/**
 * Fit the type to the title rather than hoping the title is short.
 *
 * "The Saturday Spotlight Revue" and "Marshal of Copper Gulch" are the norm in this
 * catalogue, not the exception, and a caption reading "MARSHAL OF COPPE…" fails at the
 * only job it has. Three lines plus a step down for long titles clears every title in
 * `shows.json`; the tightening of the letter-spacing is what buys the last few.
 */
function titleType(title: string, size: 'sm' | 'md' | 'lg', caption: PosterArt['caption']) {
  const long = title.length > 26 ? 2 : title.length > 17 ? 1 : 0;
  const fontSize = (size === 'lg' ? 12 : 10) - long;
  return {
    fontSize,
    lineHeight: fontSize + 2,
    // Wide tracking is the period detail, but it is also what pushes a long title over
    // the edge, so it gives way first.
    letterSpacing: TRACKING[caption] * (long === 2 ? 0.2 : long === 1 ? 0.5 : 1),
  };
}

/** How loudly the title is set — the era's typography, in the little we control. */
const TRACKING: Record<PosterArt['caption'], number> = {
  plaque: 1.2, banner: 0.6, neon: 1.6, bar: 0.4, quiet: 0.2,
};

const CAPTION_STYLE = StyleSheet.create({
  plaque: { textAlign: 'center', fontWeight: '900' },
  banner: { textAlign: 'center', fontWeight: '900' },
  neon: { textAlign: 'center', fontWeight: '800' },
  bar: { textAlign: 'left', fontWeight: '800' },
  quiet: { textAlign: 'left', fontWeight: '700' },
});

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },

  bug: {
    position: 'absolute',
    top: 4,
    right: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    opacity: 0.94,
  },

  liveBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FF4D4D' },
  liveText: { fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 0.6 },

  captionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 5,
  },
  captionRule: { height: 1.5, marginBottom: 3, alignSelf: 'stretch' },
  caption: { lineHeight: 13 },

  avatarInner: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '900', letterSpacing: 0.5 },
});
