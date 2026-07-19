import React from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * expo-linear-gradient, for the render harness only.
 *
 * Same problem as the SVG stub: the real module reaches `react-native` through a
 * CommonJS require inside node_modules, where the tsconfig `paths` alias cannot
 * follow, so Node pulls the native build and esbuild dies on its Flow syntax.
 *
 * A gradient is decoration — the harness asserts on text and structure, so rendering
 * it as a plain view loses nothing that is actually being checked. Colour fidelity is
 * verified by looking at screenshots, which is the only way it ever could be.
 */
export function LinearGradient({
  colors,
  start,
  end,
  locations,
  style,
  ...props
}: ViewProps & {
  colors: readonly string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  locations?: readonly number[];
}) {
  // Emitted as a real CSS gradient rather than a bare View, because tools/art-sheet
  // rasterises this markup in a browser to review the poster artwork. A stub that
  // dropped the colour would have made every poster in that review look blank — which
  // is exactly the sort of "verification" that quietly checks nothing.
  const angle = gradientAngle(start, end);
  const stops = colors
    .map((c, i) => (locations?.[i] !== undefined ? `${c} ${locations[i]! * 100}%` : c))
    .join(', ');

  return (
    <View
      {...props}
      style={[style, { backgroundImage: `linear-gradient(${angle}deg, ${stops})` } as never]}
    />
  );
}

/** RN's 0–1 start/end points, expressed as the CSS angle that matches them. */
function gradientAngle(
  start: { x: number; y: number } = { x: 0.5, y: 0 },
  end: { x: number; y: number } = { x: 0.5, y: 1 },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // CSS 0deg points up and rotates clockwise; atan2 here is measured from that axis.
  return Math.round((Math.atan2(dx, dy) * 180) / Math.PI);
}

export default LinearGradient;
