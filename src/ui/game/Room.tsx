import React from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { StaggerGroup, staggerDelay, useEnter, useStaggerSlot } from '../motion';
import { colors, space } from '../theme';

/**
 * Room layout.
 *
 * The single biggest reason this read as a website: every screen was a ScrollView of
 * cards, so you scrolled a document instead of standing in a place. A Room is a fixed
 * viewport — it never scrolls as a whole, it fills the screen, and its contents are
 * composed spatially like a stage. Individual panels may scroll internally; the room
 * itself does not move.
 *
 * Everything the player needs for a given activity is visible at once, which is what
 * makes a screen feel like somewhere you are rather than something you read.
 *
 * A room also opens the entrance stagger for the panels inside it, so walking into one
 * assembles the console around you instead of cutting to a finished picture. The
 * ordering lives in the group, not in the screens, so no screen has to hand-number its
 * own panels to get it.
 */
export function Room({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.room, style]}>
      <StaggerGroup>{children}</StaggerGroup>
    </View>
  );
}

/** A horizontal band inside a room. */
export function Deck({
  children,
  flex = 1,
  style,
}: {
  children: React.ReactNode;
  flex?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flex }, styles.deck, style]}>{children}</View>;
}

/**
 * A physical-feeling panel: recessed, bevelled, lit from above.
 *
 * Cards on a page look like a web layout no matter what colour they are. Panels are
 * built to read as equipment bolted into a console — that difference is most of what
 * separates "dashboard" from "game".
 *
 * Panels settle into place on mount, a beat apart. This fires when the room opens and
 * never on a re-render, which matters: a panel that re-stages itself every time a
 * number inside it changes would flicker on every single week you play.
 */
export function Panel({
  children,
  title,
  accent,
  flex,
  style,
  scroll = false,
}: {
  children: React.ReactNode;
  title?: string;
  accent?: string;
  flex?: number;
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  // Animating the panel's own root rather than wrapping it: a wrapper View would sit
  // between the deck and the panel and swallow the flex that lays the room out.
  const enter = useEnter({ delay: staggerDelay(useStaggerSlot()) });

  return (
    <Animated.View style={[styles.panel, flex !== undefined && { flex }, style, enter]}>
      <LinearGradient
        colors={['#F6F1E6', '#E9E1D0']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.panelFill}
      />
      {/* Top highlight — the light source that makes it read as a solid object. */}
      <View style={styles.bevel} />

      {title ? (
        <View style={styles.panelHead}>
          <View style={[styles.tick, accent ? { backgroundColor: accent } : null]} />
          <Text style={styles.panelTitle}>{title}</Text>
        </View>
      ) : null}

      <View style={[styles.panelBody, scroll && { overflow: 'hidden' }]}>{children}</View>
    </Animated.View>
  );
}

/** A stamped metal label, for figures that should look engraved into the console. */
export function Readout({
  label,
  value,
  color,
  size = 'md',
}: {
  label: string;
  value: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const fontSize = size === 'lg' ? 30 : size === 'md' ? 18 : 13;

  return (
    <View style={styles.readout}>
      <Text style={styles.readoutLabel}>{label}</Text>
      <Text style={[styles.readoutValue, { fontSize }, color ? { color } : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  room: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: space.sm,
    gap: space.sm,
  },
  deck: { flexDirection: 'row', gap: space.sm },

  panel: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    // Inner shadow is not available, so a dark ground plus a top bevel does the work.
    boxShadow: '0px 2px 8px rgba(60,45,30,0.14)',
  },
  panelFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },

  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  tick: { width: 3, height: 11, borderRadius: 2, backgroundColor: colors.accent },
  panelTitle: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: colors.textDim,
  },
  panelBody: { flex: 1 },

  readout: { gap: 1 },
  readoutLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: colors.textFaint },
  readoutValue: {
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
});
