import React from 'react';

/**
 * react-native-svg, for the render harness only.
 *
 * The real package ships a web build, but every file in it reaches `react-native`
 * through a CommonJS `require`, and Node resolves those itself — the tsconfig `paths`
 * alias that redirects `react-native` to `react-native-web` never gets a look in. The
 * harness therefore pulled the *native* build and died transforming Flow syntax.
 *
 * On the web, react-native-svg renders plain SVG DOM elements anyway, so this shim
 * produces the same markup the browser gets. That matters: it means `render-check`
 * still genuinely asserts that icons emit paths, rather than being switched off.
 *
 * Not used by the app, the web bundle or the device build — only by `tools/`.
 */

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

/** react-native-svg accepts numbers where SVG wants strings; DOM is happy with both. */
function element(tag: string) {
  return function SvgElement({ children, ...props }: AnyProps) {
    return React.createElement(tag, props, children);
  };
}

export const Svg = element('svg');
export const Path = element('path');
export const Circle = element('circle');
export const Rect = element('rect');
export const G = element('g');
export const Line = element('line');
export const Polygon = element('polygon');
export const Polyline = element('polyline');
export const Ellipse = element('ellipse');
export const Text = element('text');
export const TSpan = element('tspan');
export const Defs = element('defs');
export const Stop = element('stop');
export const ClipPath = element('clipPath');
export const Mask = element('mask');
export const LinearGradient = element('linearGradient');
export const RadialGradient = element('radialGradient');

export default Svg;
