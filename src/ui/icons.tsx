import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * The cinema icon set.
 *
 * Every glyph in the game used to be an emoji. Emoji are a trap for a game that wants
 * to look authored: they render differently on every platform, they carry another
 * vendor's art direction, and at poster size they read as a chat message rather than
 * artwork. These are drawn as paths on a 24×24 grid so they inherit the game's colour,
 * scale to any size, and look like one hand made them.
 *
 * The vocabulary is the picture-palace one — clapperboard, reel, film strip, ticket,
 * popcorn, megaphone — which is also the visual language of the rest of the interface.
 *
 * Style rules, so the set stays coherent:
 *   • 24×24 viewBox, artwork inset ~2px from the edge.
 *   • Solid fills, no strokes. A filled silhouette stays legible at 14px; a 1px stroke
 *     disappears. Cut-outs are done with `fillRule="evenodd"` rather than a background
 *     colour, so icons work on any surface.
 *   • One colour per icon, taken from `color`. Depth comes from shape, not shading.
 */

export interface IconProps {
  size?: number;
  color?: string;
  /** Opacity for the whole glyph — used to dim inactive nav items. */
  opacity?: number;
}

type PathSpec = string | { d: string; opacity?: number };

/**
 * Build an icon component from its paths.
 *
 * Factory rather than 25 near-identical components: it keeps each icon a single line
 * of path data, which is the only part that actually differs.
 */
function icon(paths: PathSpec[]) {
  return function Icon({ size = 20, color = '#241E1A', opacity = 1 }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" opacity={opacity}>
        <G>
          {paths.map((spec, i) => {
            const d = typeof spec === 'string' ? spec : spec.d;
            const o = typeof spec === 'string' ? 1 : (spec.opacity ?? 1);
            return <Path key={i} d={d} fill={color} fillRule="evenodd" opacity={o} />;
          })}
        </G>
      </Svg>
    );
  };
}

/* ------------------------------------------------------------------------- */
/* The set                                                                    */
/* ------------------------------------------------------------------------- */

/** Clapperboard — the mark of the studio itself. */
export const Clapper = icon([
  // Slate bar, tilted, with the striped teeth cut out of it.
  'M2.6 6.1 L20.9 2.2 L21.9 6.6 L3.6 10.5 Z M6.4 5.3 L5.0 8.0 L7.3 7.5 L8.7 4.8 Z M11.0 4.3 L9.6 7.0 L11.9 6.5 L13.3 3.8 Z M15.6 3.3 L14.2 6.0 L16.5 5.5 L17.9 2.8 Z',
  // Body.
  'M3.2 11.4 H21.4 A0.9 0.9 0 0 1 22.3 12.3 V20.6 A1.2 1.2 0 0 1 21.1 21.8 H3.5 A1.2 1.2 0 0 1 2.3 20.6 V12.3 A0.9 0.9 0 0 1 3.2 11.4 Z',
]);

/** Film reel. */
export const Reel = icon([
  'M12 1.8 A10.2 10.2 0 1 0 12 22.2 A10.2 10.2 0 1 0 12 1.8 Z M12 9.8 A2.2 2.2 0 1 1 12 14.2 A2.2 2.2 0 1 1 12 9.8 Z M12 4.6 A2.1 2.1 0 1 1 12 8.8 A2.1 2.1 0 1 1 12 4.6 Z M12 15.2 A2.1 2.1 0 1 1 12 19.4 A2.1 2.1 0 1 1 12 15.2 Z M5.3 9.9 A2.1 2.1 0 1 1 5.3 14.1 A2.1 2.1 0 1 1 5.3 9.9 Z M18.7 9.9 A2.1 2.1 0 1 1 18.7 14.1 A2.1 2.1 0 1 1 18.7 9.9 Z',
]);

/** Film strip — a run of frames, used for documentary and the archive. */
export const FilmStrip = icon([
  'M3.4 2.6 H20.6 A1.1 1.1 0 0 1 21.7 3.7 V20.3 A1.1 1.1 0 0 1 20.6 21.4 H3.4 A1.1 1.1 0 0 1 2.3 20.3 V3.7 A1.1 1.1 0 0 1 3.4 2.6 Z M4.6 5.0 V7.2 H6.8 V5.0 Z M4.6 10.9 V13.1 H6.8 V10.9 Z M4.6 16.8 V19.0 H6.8 V16.8 Z M17.2 5.0 V7.2 H19.4 V5.0 Z M17.2 10.9 V13.1 H19.4 V10.9 Z M17.2 16.8 V19.0 H19.4 V16.8 Z M8.6 5.0 V19.0 H15.4 V5.0 Z',
]);

/** Ticket — a deal, an offer, a sale. */
export const Ticket = icon([
  'M2.4 5.4 H21.6 A1 1 0 0 1 22.6 6.4 V9.4 A2.6 2.6 0 0 0 22.6 14.6 V17.6 A1 1 0 0 1 21.6 18.6 H2.4 A1 1 0 0 1 1.4 17.6 V14.6 A2.6 2.6 0 0 0 1.4 9.4 V6.4 A1 1 0 0 1 2.4 5.4 Z M15.6 8.2 V10.0 H17.2 V8.2 Z M15.6 11.1 V12.9 H17.2 V11.1 Z M15.6 14.0 V15.8 H17.2 V14.0 Z',
]);

/** Popcorn — the audience, and comedy. */
export const Popcorn = icon([
  // Kernels, each its own path: they overlap, and overlapping subpaths inside a single
  // evenodd path cancel each other out — which erased the popcorn and left a bare tub.
  'M6.5 6.4 A2.1 2.1 0 1 1 6.5 10.6 A2.1 2.1 0 1 1 6.5 6.4 Z',
  'M17.4 6.4 A2.1 2.1 0 1 1 17.4 10.6 A2.1 2.1 0 1 1 17.4 6.4 Z',
  'M9.1 8.0 A1.9 1.9 0 1 1 9.1 11.8 A1.9 1.9 0 1 1 9.1 8.0 Z',
  'M14.8 8.0 A1.9 1.9 0 1 1 14.8 11.8 A1.9 1.9 0 1 1 14.8 8.0 Z',
  'M11.9 4.3 A2.3 2.3 0 1 1 11.9 8.9 A2.3 2.3 0 1 1 11.9 4.3 Z',
  // Carton, with its stripes.
  'M4.6 11.6 H19.4 L17.9 21.6 A0.9 0.9 0 0 1 17.0 22.3 H7.0 A0.9 0.9 0 0 1 6.1 21.6 Z',
  { d: 'M9.4 11.6 L10.1 22.3 H11.9 L11.4 11.6 Z M14.6 11.6 L13.9 22.3 H12.1 L12.6 11.6 Z', opacity: 0.35 },
]);

/** Megaphone — publicity, announcements, the network shouting. */
export const Megaphone = icon([
  'M20.4 3.1 A0.9 0.9 0 0 1 21.4 4.0 V19.6 A0.9 0.9 0 0 1 20.0 20.4 L9.6 14.6 H7.0 A3.4 3.4 0 0 1 7.0 8.4 H9.6 Z',
  'M8.4 15.8 H12.0 L12.8 21.2 A1 1 0 0 1 11.8 22.4 H10.0 A1 1 0 0 1 9.0 21.6 Z',
]);

/** Trophy — competitions and awards. */
export const Trophy = icon([
  'M7.0 2.4 H17.0 V9.0 A5.0 5.0 0 0 1 7.0 9.0 Z',
  'M10.9 13.6 H13.1 V17.6 H10.9 Z M7.4 18.6 H16.6 A1 1 0 0 1 17.6 19.6 V21.6 H6.4 V19.6 A1 1 0 0 1 7.4 18.6 Z',
  'M6.0 4.0 V6.2 H4.4 V8.0 A2.0 2.0 0 0 0 6.0 10.0 V12.0 A4.0 4.0 0 0 1 2.4 8.0 V5.0 A1 1 0 0 1 3.4 4.0 Z M18.0 4.0 H20.6 A1 1 0 0 1 21.6 5.0 V8.0 A4.0 4.0 0 0 1 18.0 12.0 V10.0 A2.0 2.0 0 0 0 19.6 8.0 V6.2 H18.0 Z',
]);

/** Microphone — talk shows and interviews. */
export const Microphone = icon([
  'M12 1.9 A3.5 3.5 0 0 1 15.5 5.4 V11.4 A3.5 3.5 0 0 1 8.5 11.4 V5.4 A3.5 3.5 0 0 1 12 1.9 Z',
  'M5.4 10.6 H7.4 A4.6 4.6 0 0 0 16.6 10.6 H18.6 A6.6 6.6 0 0 1 13.0 17.1 V19.8 H16.2 V21.8 H7.8 V19.8 H11.0 V17.1 A6.6 6.6 0 0 1 5.4 10.6 Z',
]);

/** Magnifier — procedurals, investigation, the ratings deep-dive. */
export const Magnifier = icon([
  'M10.4 2.2 A8.2 8.2 0 1 1 10.4 18.6 A8.2 8.2 0 1 1 10.4 2.2 Z M10.4 4.8 A5.6 5.6 0 1 0 10.4 16.0 A5.6 5.6 0 1 0 10.4 4.8 Z',
  'M16.1 17.9 L17.9 16.1 L22.1 20.3 A1.3 1.3 0 0 1 20.3 22.1 Z',
]);

/** Camcorder — reality television. */
export const Camcorder = icon([
  'M2.4 6.4 H14.2 A1.2 1.2 0 0 1 15.4 7.6 V16.4 A1.2 1.2 0 0 1 14.2 17.6 H2.4 A1.2 1.2 0 0 1 1.2 16.4 V7.6 A1.2 1.2 0 0 1 2.4 6.4 Z M5.4 9.2 A2.8 2.8 0 1 1 5.4 14.8 A2.8 2.8 0 1 1 5.4 9.2 Z M11.4 9.2 A2.8 2.8 0 1 1 11.4 14.8 A2.8 2.8 0 1 1 11.4 9.2 Z',
  'M16.6 10.6 L21.6 7.2 A0.8 0.8 0 0 1 22.8 7.9 V16.1 A0.8 0.8 0 0 1 21.6 16.8 L16.6 13.4 Z',
]);

/** Theatre masks — drama. */
export const Masks = icon([
  'M2.2 4.2 H13.4 V10.4 A5.6 5.6 0 0 1 2.2 10.4 Z M5.2 6.6 A1.1 1.1 0 1 1 5.2 8.8 A1.1 1.1 0 1 1 5.2 6.6 Z M10.4 6.6 A1.1 1.1 0 1 1 10.4 8.8 A1.1 1.1 0 1 1 10.4 6.6 Z',
  'M10.6 12.0 H21.8 V17.4 A5.6 5.6 0 0 1 10.6 17.4 Z M13.6 14.0 A1.1 1.1 0 1 1 13.6 16.2 A1.1 1.1 0 1 1 13.6 14.0 Z M18.8 14.0 A1.1 1.1 0 1 1 18.8 16.2 A1.1 1.1 0 1 1 18.8 14.0 Z',
]);

/** Palette — animation. */
export const Palette = icon([
  'M12 2.2 A9.8 9.8 0 0 0 12 21.8 A2.0 2.0 0 0 0 13.7 18.7 A1.9 1.9 0 0 1 15.3 15.7 H17.7 A4.1 4.1 0 0 0 21.8 11.6 C21.8 6.4 17.4 2.2 12 2.2 Z M7.0 13.6 A1.7 1.7 0 1 1 7.0 17.0 A1.7 1.7 0 1 1 7.0 13.6 Z M6.2 8.0 A1.7 1.7 0 1 1 6.2 11.4 A1.7 1.7 0 1 1 6.2 8.0 Z M11.2 5.2 A1.7 1.7 0 1 1 11.2 8.6 A1.7 1.7 0 1 1 11.2 5.2 Z M16.4 7.0 A1.7 1.7 0 1 1 16.4 10.4 A1.7 1.7 0 1 1 16.4 7.0 Z',
]);

/** Prize wheel — game shows. */
export const Wheel = icon([
  'M12 1.8 A10.2 10.2 0 1 0 12 22.2 A10.2 10.2 0 1 0 12 1.8 Z M12 4.2 A7.8 7.8 0 1 1 12 19.8 A7.8 7.8 0 1 1 12 4.2 Z',
  // Spokes, one path each — as a single path they all cross at the hub, and evenodd
  // turned that crossing into a hole, so the wheel read as an asterisk.
  { d: 'M11.2 5.0 H12.8 V19.0 H11.2 Z', opacity: 0.55 },
  { d: 'M5.0 11.2 H19.0 V12.8 H5.0 Z', opacity: 0.55 },
  { d: 'M6.8 5.7 L18.3 17.2 L17.2 18.3 L5.7 6.8 Z', opacity: 0.55 },
  { d: 'M17.2 5.7 L18.3 6.8 L6.8 18.3 L5.7 17.2 Z', opacity: 0.55 },
  'M12 9.9 A2.1 2.1 0 1 1 12 14.1 A2.1 2.1 0 1 1 12 9.9 Z',
]);

/** Heart — soaps and romance. */
export const Heart = icon([
  'M12 21.4 C12 21.4 2.4 14.6 2.4 8.4 A5.6 5.6 0 0 1 12 4.6 A5.6 5.6 0 0 1 21.6 8.4 C21.6 14.6 12 21.4 12 21.4 Z',
]);

/** Key — anthologies and mysteries. */
export const Key = icon([
  'M15.8 2.4 A5.8 5.8 0 1 1 15.8 14.0 A5.8 5.8 0 1 1 15.8 2.4 Z M15.8 5.6 A2.6 2.6 0 1 0 15.8 10.8 A2.6 2.6 0 1 0 15.8 5.6 Z',
  'M11.6 11.0 L13.4 12.8 L5.6 20.6 V22.2 H3.0 A0.8 0.8 0 0 1 2.2 21.4 V18.8 Z M7.2 15.4 L9.0 17.2 L7.7 18.5 L5.9 16.7 Z',
]);

/** Star — talent, the Walk of Fame, and anything the player should want. */
export const Star = icon([
  'M12 2.0 L14.6 8.6 L21.6 8.2 L16.4 13.2 L18.0 20.0 L12 16.4 L6.0 20.0 L7.6 13.2 L2.4 8.2 L9.4 8.6 Z',
]);

/** Newspaper — news, and the trade press. */
export const Newspaper = icon([
  'M2.2 4.0 H18.4 A0.9 0.9 0 0 1 19.3 4.9 V19.2 A2.6 2.6 0 0 0 21.9 21.8 H4.8 A2.6 2.6 0 0 1 2.2 19.2 Z M4.6 6.4 V11.6 H11.0 V6.4 Z M12.6 6.4 V8.0 H16.9 V6.4 Z M12.6 9.2 V10.8 H16.9 V9.2 Z M4.6 13.4 V15.0 H16.9 V13.4 Z M4.6 16.4 V18.0 H16.9 V16.4 Z',
  'M20.5 8.4 H21.8 A0.9 0.9 0 0 1 22.7 9.3 V19.2 A1.4 1.4 0 0 1 20.5 20.3 Z',
]);

/** Teddy bear — children's programming. */
export const Teddy = icon([
  'M6.4 3.4 A2.9 2.9 0 1 1 6.4 9.2 A2.9 2.9 0 1 1 6.4 3.4 Z M17.6 3.4 A2.9 2.9 0 1 1 17.6 9.2 A2.9 2.9 0 1 1 17.6 3.4 Z',
  'M12 4.8 A8.4 8.4 0 1 1 12 21.6 A8.4 8.4 0 1 1 12 4.8 Z M9.0 10.4 A1.3 1.3 0 1 1 9.0 13.0 A1.3 1.3 0 1 1 9.0 10.4 Z M15.0 10.4 A1.3 1.3 0 1 1 15.0 13.0 A1.3 1.3 0 1 1 15.0 10.4 Z M12 14.4 A3.4 3.4 0 0 1 15.2 16.6 A4.6 4.6 0 0 1 8.8 16.6 A3.4 3.4 0 0 1 12 14.4 Z',
]);

/** Spotlight — sketch and variety. */
export const Spotlight = icon([
  'M6.6 2.2 H14.2 A1 1 0 0 1 15.2 3.2 V7.2 A1 1 0 0 1 14.2 8.2 H6.6 A1 1 0 0 1 5.6 7.2 V3.2 A1 1 0 0 1 6.6 2.2 Z',
  { d: 'M6.2 9.0 H14.6 L20.4 21.8 H1.4 Z', opacity: 0.45 },
]);

/** Envelope — the in-tray. */
export const Envelope = icon([
  'M2.4 4.6 H21.6 A1.2 1.2 0 0 1 22.8 5.8 V18.2 A1.2 1.2 0 0 1 21.6 19.4 H2.4 A1.2 1.2 0 0 1 1.2 18.2 V5.8 A1.2 1.2 0 0 1 2.4 4.6 Z M3.9 7.0 L12 13.0 L20.1 7.0 Z',
]);

/** Lightbulb — new ideas, the pitch table. */
export const Bulb = icon([
  'M12 1.8 A7.2 7.2 0 0 1 16.4 14.7 A2.6 2.6 0 0 0 15.4 16.7 V17.6 H8.6 V16.7 A2.6 2.6 0 0 0 7.6 14.7 A7.2 7.2 0 0 1 12 1.8 Z',
  'M8.6 19.0 H15.4 V20.2 A0.9 0.9 0 0 1 14.5 21.1 H9.5 A0.9 0.9 0 0 1 8.6 20.2 Z',
]);

/** Broadcast mast — the industry at large. */
export const Broadcast = icon([
  'M12 6.2 A2.4 2.4 0 1 1 12 11.0 A2.4 2.4 0 1 1 12 6.2 Z',
  'M10.9 11.6 H13.1 L16.4 22.0 H14.0 L13.2 19.2 H10.8 L10.0 22.0 H7.6 Z',
  { d: 'M6.9 3.1 L8.5 4.7 A5.4 5.4 0 0 0 8.5 12.5 L6.9 14.1 A7.7 7.7 0 0 1 6.9 3.1 Z M17.1 3.1 A7.7 7.7 0 0 1 17.1 14.1 L15.5 12.5 A5.4 5.4 0 0 0 15.5 4.7 Z', opacity: 0.55 },
  { d: 'M3.7 0.4 L5.3 2.0 A9.9 9.9 0 0 0 5.3 15.2 L3.7 16.8 A12.2 12.2 0 0 1 3.7 0.4 Z M20.3 0.4 A12.2 12.2 0 0 1 20.3 16.8 L18.7 15.2 A9.9 9.9 0 0 0 18.7 2.0 Z', opacity: 0.28 },
]);

/** Stacked shelf — the slate of shows you own. */
export const Shelf = icon([
  'M2.4 3.0 H7.0 A0.8 0.8 0 0 1 7.8 3.8 V20.2 A0.8 0.8 0 0 1 7.0 21.0 H2.4 A0.8 0.8 0 0 1 1.6 20.2 V3.8 A0.8 0.8 0 0 1 2.4 3.0 Z',
  'M9.6 5.4 H13.6 A0.8 0.8 0 0 1 14.4 6.2 V20.2 A0.8 0.8 0 0 1 13.6 21.0 H9.6 A0.8 0.8 0 0 1 8.8 20.2 V6.2 A0.8 0.8 0 0 1 9.6 5.4 Z',
  { d: 'M16.4 8.0 H21.6 A0.8 0.8 0 0 1 22.4 8.8 V20.2 A0.8 0.8 0 0 1 21.6 21.0 H16.4 A0.8 0.8 0 0 1 15.6 20.2 V8.8 A0.8 0.8 0 0 1 16.4 8.0 Z', opacity: 0.55 },
]);

/** Mixing-desk sliders — settings, save and load. A cog would read as an OS control. */
export const Sliders = icon([
  'M2.4 4.3 H21.6 V6.1 H2.4 Z M2.4 11.1 H21.6 V12.9 H2.4 Z M2.4 17.9 H21.6 V19.7 H2.4 Z',
  'M7.6 2.6 A2.6 2.6 0 1 1 7.6 7.8 A2.6 2.6 0 1 1 7.6 2.6 Z M15.8 9.4 A2.6 2.6 0 1 1 15.8 14.6 A2.6 2.6 0 1 1 15.8 9.4 Z M10.4 16.2 A2.6 2.6 0 1 1 10.4 21.4 A2.6 2.6 0 1 1 10.4 16.2 Z',
]);

/** A plus in a rounded square — the "make a show" affordance. */
export const Plus = icon([
  'M10.8 3.6 H13.2 V10.8 H20.4 V13.2 H13.2 V20.4 H10.8 V13.2 H3.6 V10.8 H10.8 Z',
]);

/** A television set — the desk, and anything "on air". */
export const Television = icon([
  'M7.4 1.4 L12 5.2 L16.6 1.4 L18.1 3.2 L15.7 5.2 H20.8 A1.2 1.2 0 0 1 22.0 6.4 V19.4 A1.2 1.2 0 0 1 20.8 20.6 H3.2 A1.2 1.2 0 0 1 2.0 19.4 V6.4 A1.2 1.2 0 0 1 3.2 5.2 H8.3 L5.9 3.2 Z M4.4 7.6 V18.2 H16.4 V7.6 Z M18.8 8.6 A1.3 1.3 0 1 1 18.8 11.2 A1.3 1.3 0 1 1 18.8 8.6 Z M18.8 13.0 A1.3 1.3 0 1 1 18.8 15.6 A1.3 1.3 0 1 1 18.8 13.0 Z',
]);

/* ------------------------------------------------------------------------- */
/* Lookup by name                                                             */
/* ------------------------------------------------------------------------- */

export const ICONS = {
  clapper: Clapper,
  reel: Reel,
  filmStrip: FilmStrip,
  ticket: Ticket,
  popcorn: Popcorn,
  megaphone: Megaphone,
  trophy: Trophy,
  microphone: Microphone,
  magnifier: Magnifier,
  camcorder: Camcorder,
  masks: Masks,
  palette: Palette,
  wheel: Wheel,
  heart: Heart,
  key: Key,
  star: Star,
  newspaper: Newspaper,
  teddy: Teddy,
  spotlight: Spotlight,
  envelope: Envelope,
  bulb: Bulb,
  broadcast: Broadcast,
  shelf: Shelf,
  television: Television,
  sliders: Sliders,
  plus: Plus,
} as const;

export type IconName = keyof typeof ICONS;

/** Render an icon by name. Unknown names fall back to the television. */
export function Icon({
  name,
  size = 20,
  color = '#241E1A',
  opacity = 1,
}: IconProps & { name: IconName }) {
  const Component = ICONS[name] ?? Television;
  return <Component size={size} color={color} opacity={opacity} />;
}

/**
 * A brass Walk of Fame star: a five-point star set into a terrazzo pavement slab.
 *
 * Used behind talent portraits. It is its own component rather than an `Icon` because
 * it is two-tone by nature — the point of a brass star is the contrast between the
 * metal and the stone it is set into.
 */
export function WalkOfFameStar({
  size = 72,
  brass = '#C08A1E',
  stone = '#D6CAB1',
  speck = '#A2917A',
}: {
  size?: number;
  brass?: string;
  stone?: string;
  speck?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={0} y={0} width={24} height={24} rx={2} fill={stone} />
      {/* Terrazzo flecks — deterministic, so the pavement never shimmers between renders. */}
      {[
        [3.2, 4.1], [19.6, 6.4], [5.8, 19.2], [17.1, 18.6], [11.4, 2.4],
        [2.6, 12.8], [21.2, 13.4], [8.2, 21.4], [14.8, 21.8],
      ].map(([cx, cy], i) => (
        <Circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 0.7 : 0.45} fill={speck} opacity={0.8} />
      ))}
      <Path
        d="M12 3.2 L14.4 9.3 L20.9 8.9 L16.0 13.5 L17.5 19.8 L12 16.5 L6.5 19.8 L8.0 13.5 L3.1 8.9 L9.6 9.3 Z"
        fill={brass}
      />
      {/* A highlight down one side of the star so the brass reads as metal, not paint. */}
      <Path d="M12 3.2 L14.4 9.3 L20.9 8.9 L16.0 13.5 L12 11.4 Z" fill="#FFFFFF" opacity={0.22} />
    </Svg>
  );
}
