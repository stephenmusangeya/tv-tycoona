import { Platform } from 'react-native';

/**
 * Design tokens.
 *
 * Bright, warm and friendly — cream paper, white cards, and saturated accents. The
 * earlier near-black scheme read as a professional dashboard rather than a game; this
 * one is aimed at a younger player and should feel closer to a board game box than a
 * trading terminal.
 *
 * Numerals stay monospaced and aligned everywhere, because a management game still
 * lives or dies on being able to compare figures at a glance.
 */

export const colors = {
  /**
   * A picture-palace lobby: warm light stone walls, cream panels, oxblood and gold.
   *
   * Two earlier attempts got this wrong in opposite directions — a flat grey dashboard
   * and then a near-black room. The room is now genuinely light, which does something
   * the dark version could not: the television is the only dark object on screen, so
   * it reads as a lit screen in a bright room and becomes the obvious focal point.
   */
  bg: '#DCD4C4',
  surface: '#F2ECDF',
  surfaceAlt: '#E7DFCD',
  surfaceHigh: '#D6CAB1',
  border: '#C4B69C',
  borderBright: '#A2917A',

  text: '#241E1A',
  textDim: '#6B5F52',
  textFaint: '#948674',

  /** Oxblood is the brand; gold is the reward. */
  accent: '#B0342A',
  accentSoft: '#F4DED9',
  accentDeep: '#7E211A',
  info: '#8A6D4B',
  infoSoft: '#EFE4D2',

  positive: '#C08A1E',
  positiveSoft: '#F7E9C8',
  negative: '#B0342A',
  negativeSoft: '#F7DED9',
  warning: '#C08A1E',

  /** The set: cream cabinet, and the only dark surface in the room. */
  tvCabinet: '#EDE4D0',
  tvCabinetEdge: '#BFAF92',
  tvScreen: '#14100E',
  tvScreenEdge: '#3A322B',
  tvText: '#F7F1E4',
  tvTextDim: '#B6A794',
  tvTextFaint: '#7A6D5D',

  segments: {
    kids: '#D9A32E',
    teens: '#B0342A',
    youngAdults: '#7A5A8C',
    families: '#6E8250',
    adults: '#8A6D4B',
    seniors: '#9A8E80',
  } as Record<string, string>,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const type = {
  display: { fontSize: 28, fontWeight: '800' as const, color: colors.text },
  title: { fontSize: 22, fontWeight: '800' as const, color: colors.text },
  heading: { fontSize: 16, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 14, fontWeight: '400' as const, color: colors.text },
  small: { fontSize: 12, fontWeight: '400' as const, color: colors.textDim },
  tiny: { fontSize: 10, fontWeight: '700' as const, color: colors.textFaint },
  number: { fontFamily: mono, fontSize: 15, fontWeight: '700' as const, color: colors.text },
  numberBig: { fontFamily: mono, fontSize: 24, fontWeight: '800' as const, color: colors.text },
} as const;

/** Colour for a delta: green up, red down, grey at zero. */
export function deltaColor(value: number): string {
  if (value > 0) return colors.positive;
  if (value < 0) return colors.negative;
  return colors.textDim;
}

/** 0–100 scale colour — red through orange to green. */
export function scoreColor(score: number): string {
  if (score >= 75) return colors.positive;
  if (score >= 55) return '#6FBF3F';
  if (score >= 40) return colors.warning;
  if (score >= 25) return '#F2743D';
  return colors.negative;
}

/**
 * Plain-English verdict for a 0–100 score.
 *
 * The player should never have to interpret a bare number. "72" means nothing to
 * someone new; "Really good" means exactly what it says.
 */
export function scoreWord(score: number): string {
  if (score >= 85) return 'Brilliant';
  if (score >= 72) return 'Really good';
  if (score >= 58) return 'Pretty good';
  if (score >= 44) return 'okay';
  if (score >= 30) return 'Weak';
  return 'Terrible';
}

export function formatViewers(millions: number): string {
  return `${millions.toFixed(1)}M`;
}

/**
 * Money, written the way a person would say it.
 *
 * Deliberately plain: "$1.4M" rather than "$1,400,000", and never a bare number
 * without its sign where a sign carries meaning.
 */
export function formatMoneyShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Big soft shadow used on cards and the TV, expressed the RN 0.86 way. */
export const softShadow = '0px 2px 8px rgba(0, 0, 0, 0.35)';
export const liftShadow = '0px 10px 28px rgba(0, 0, 0, 0.5)';
