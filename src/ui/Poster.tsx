import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { avatarColor, initialsOf, posterFor } from './art';
import { Icon } from './icons';
import type { Format } from '../engine/types';

/**
 * Show poster.
 *
 * Every show carries one, generated from its id — a gradient, a geometric motif and a
 * genre glyph. Cheap, deterministic, and the single biggest reason the screens now
 * look like a game rather than a spreadsheet.
 */
export function Poster({
  seed,
  format,
  title,
  size = 'md',
  live = false,
  style,
}: {
  seed: string;
  format: Format;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  live?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const art = posterFor(seed, format);
  const metrics = SIZES[size];

  return (
    <View style={[styles.frame, metrics.frame, style]}>
      <LinearGradient
        colors={[art.from, art.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill as StyleProp<ViewStyle>}
      />

      {/* Motif — the thing that stops every poster looking like a colour swatch. */}
      <View style={styles.motifLayer} pointerEvents="none">
        {art.motif === 0 ? (
          <View style={[styles.ring, { transform: [{ rotate: `${art.angle}deg` }] }]} />
        ) : null}
        {art.motif === 1 ? (
          <View style={[styles.slash, { transform: [{ rotate: `${art.angle}deg` }] }]} />
        ) : null}
        {art.motif === 2 ? (
          <View style={styles.stack}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.stackBar, { opacity: 0.16 + i * 0.06 }]} />
            ))}
          </View>
        ) : null}
        {art.motif === 3 ? (
          <View style={[styles.dot, { transform: [{ rotate: `${art.angle}deg` }] }]} />
        ) : null}
      </View>

      {/* The genre mark, in white on the gradient — our own artwork, not an emoji. */}
      <View style={styles.glyph}>
        <Icon name={art.icon} size={metrics.glyph} color="#FFFFFF" opacity={0.92} />
      </View>

      {live ? (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      ) : null}

      {title && size !== 'sm' ? (
        <View style={styles.captionWrap}>
          <Text style={[styles.caption, metrics.caption]} numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

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

const SIZES = {
  sm: {
    frame: { width: 40, height: 52, borderRadius: 6 },
    glyph: 20,
    caption: { fontSize: 8 },
  },
  md: {
    frame: { width: 92, height: 120, borderRadius: 10 },
    glyph: 34,
    caption: { fontSize: 10 },
  },
  lg: {
    frame: { width: 132, height: 172, borderRadius: 12 },
    glyph: 48,
    caption: { fontSize: 12 },
  },
} as const;

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },

  motifLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  ring: {
    position: 'absolute',
    top: '-25%',
    right: '-35%',
    width: '110%',
    height: '110%',
    borderRadius: 999,
    borderWidth: 14,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  slash: {
    position: 'absolute',
    top: '-40%',
    left: '20%',
    width: '55%',
    height: '180%',
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  stack: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 5 },
  stackBar: { height: 12, backgroundColor: '#fff' },
  dot: {
    position: 'absolute',
    bottom: '-20%',
    left: '-15%',
    width: '80%',
    height: '80%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  // A soft drop shadow keeps the mark legible on the lighter end of every gradient.
  glyph: { filter: 'drop-shadow(0px 2px 5px rgba(0,0,0,0.35))' },

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
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  caption: { color: '#fff', fontWeight: '800', lineHeight: 13 },

  avatarInner: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '900', letterSpacing: 0.5 },
});
