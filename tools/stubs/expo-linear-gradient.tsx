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
  colors: _colors,
  start: _start,
  end: _end,
  locations: _locations,
  ...props
}: ViewProps & {
  colors: readonly string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  locations?: readonly number[];
}) {
  return <View {...props} />;
}

export default LinearGradient;
