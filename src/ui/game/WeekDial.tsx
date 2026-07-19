import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { DUR, Flip, useOnChange, usePressScale, useReducedMotion } from '../motion';
import { colors } from '../theme';

/**
 * The week dial.
 *
 * Advancing time is the game's one mandatory action, and it was a rectangular button
 * with a label — the single most website-shaped thing on the screen. This is a
 * physical channel dial: it rotates a detent each week, clicks a haptic, and the
 * indicator sweeps. The action is the same; the feel is not.
 *
 * The sweep is deliberately quick and slightly over-rotated. A dial that eases
 * politely into position reads as a progress bar; one that snaps past the detent and
 * settles back reads as a sprung mechanism you just clicked.
 */
export function WeekDial({
  week,
  onAdvance,
  onSkip,
  busy,
}: {
  week: number;
  onAdvance: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const reduced = useReducedMotion();
  const rotation = useRef(new Animated.Value(week)).current;
  const dial = usePressScale(0.94);
  const skip = usePressScale(0.92);

  useEffect(() => {
    if (reduced) {
      rotation.setValue(week);
      return;
    }
    const animation = Animated.timing(rotation, {
      toValue: week,
      duration: DUR.react,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [week, rotation, reduced]);

  // The pointer flares as the detent passes — the dial's own confirmation that the
  // turn registered, tied to the week rather than to the tap so it cannot fire on a
  // press the game refused.
  const flare = useRef(new Animated.Value(0)).current;
  useOnChange(week, () => {
    if (reduced) return;
    flare.setValue(1);
    Animated.timing(flare, {
      toValue: 0,
      duration: DUR.react,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  });

  const spin = rotation.interpolate({
    inputRange: [0, 52],
    // A full year is one full turn, so the dial's position reads as the season.
    outputRange: ['0deg', '360deg'],
  });

  const tap = (fn: () => void, style: Haptics.ImpactFeedbackStyle) => () => {
    // Haptics exist on device only; calling them on web throws.
    if (Platform.OS !== 'web') void Haptics.impactAsync(style);
    fn();
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="advance-week"
        onPress={tap(onAdvance, Haptics.ImpactFeedbackStyle.Medium)}
        onPressIn={dial.onPressIn}
        onPressOut={dial.onPressOut}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1 }}
      >
        <Animated.View style={[styles.dial, { transform: [{ scale: dial.scale }] }]}>
          <LinearGradient
            colors={['#2E3846', '#151B23']}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={styles.dialFill}
          />

          {/* Detents around the rim — one per fortnight, so a turn reads as time. */}
          {Array.from({ length: 26 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.detent,
                { transform: [{ rotate: `${(i * 360) / 26}deg` }, { translateY: -38 }] },
              ]}
            />
          ))}

          {/* The indicator that sweeps as weeks pass. */}
          <Animated.View style={[styles.pointerHub, { transform: [{ rotate: spin }] }]}>
            <View style={styles.pointer} />
            <Animated.View style={[styles.pointerFlare, { opacity: flare }]} />
          </Animated.View>

          <View style={styles.hub}>
            <Flip value={String(week).padStart(2, '0')} style={styles.hubWeek} />
            <Text style={styles.hubLabel}>WEEK</Text>
          </View>
        </Animated.View>
      </Pressable>

      <Text style={styles.caption}>{busy ? 'ON AIR…' : 'TURN TO PLAY'}</Text>

      <Pressable
        testID="skip-four"
        onPress={tap(onSkip, Haptics.ImpactFeedbackStyle.Light)}
        onPressIn={skip.onPressIn}
        onPressOut={skip.onPressOut}
        disabled={busy}
      >
        <Animated.View style={[styles.skip, { transform: [{ scale: skip.scale }] }]}>
          <Text style={styles.skipText}>▸▸ SKIP A MONTH</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const SIZE = 96;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },

  dial: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#3A4553',
    overflow: 'hidden',
    boxShadow: '0px 6px 16px rgba(0,0,0,0.6)',
  },
  dialFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  detent: {
    position: 'absolute',
    width: 2,
    height: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },

  pointerHub: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
  },
  pointer: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginTop: 6,
    boxShadow: '0px 0px 8px rgba(255,107,53,0.9)',
  },
  /** Sits over the pointer and burns off, so the flare costs no layout. */
  pointerFlare: {
    position: 'absolute',
    top: 2,
    width: 9,
    height: 30,
    borderRadius: 5,
    backgroundColor: 'rgba(255,171,120,0.75)',
  },

  hub: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0E131A',
    borderWidth: 1,
    borderColor: '#39434F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubWeek: {
    fontSize: 20,
    fontWeight: '900',
    color: '#F0F3F7',
    fontVariant: ['tabular-nums'],
    lineHeight: 22,
  },
  hubLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 1.4, color: '#66717F' },

  caption: { fontSize: 8, fontWeight: '900', letterSpacing: 1.6, color: colors.accent },

  skip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2A3441',
  },
  skipText: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: '#7C8899' },
});
