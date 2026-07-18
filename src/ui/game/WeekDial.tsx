import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '../theme';

/**
 * The week dial.
 *
 * Advancing time is the game's one mandatory action, and it was a rectangular button
 * with a label — the single most website-shaped thing on the screen. This is a
 * physical channel dial: it rotates a detent each week, clicks a haptic, and the
 * indicator sweeps. The action is the same; the feel is not.
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
  const rotation = useRef(new Animated.Value(week)).current;
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: week,
      duration: 420,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
    }).start();
  }, [week, rotation]);

  const spin = rotation.interpolate({
    inputRange: [0, 52],
    // A full year is one full turn, so the dial's position reads as the season.
    outputRange: ['0deg', '360deg'],
  });

  const tap = (fn: () => void, style: Haptics.ImpactFeedbackStyle) => () => {
    // Haptics exist on device only; calling them on web throws.
    if (Platform.OS !== 'web') void Haptics.impactAsync(style);
    Animated.sequence([
      Animated.timing(press, { toValue: 1, duration: 70, useNativeDriver: true }),
      Animated.spring(press, { toValue: 0, friction: 5, useNativeDriver: true }),
    ]).start();
    fn();
  };

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });

  return (
    <View style={styles.wrap}>
      <Pressable
        testID="advance-week"
        onPress={tap(onAdvance, Haptics.ImpactFeedbackStyle.Medium)}
        disabled={busy}
        style={{ opacity: busy ? 0.6 : 1 }}
      >
        <Animated.View style={[styles.dial, { transform: [{ scale }] }]}>
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
          </Animated.View>

          <View style={styles.hub}>
            <Text style={styles.hubWeek}>{String(week).padStart(2, '0')}</Text>
            <Text style={styles.hubLabel}>WEEK</Text>
          </View>
        </Animated.View>
      </Pressable>

      <Text style={styles.caption}>{busy ? 'ON AIR…' : 'TURN TO PLAY'}</Text>

      <Pressable
        testID="skip-four"
        onPress={tap(onSkip, Haptics.ImpactFeedbackStyle.Light)}
        disabled={busy}
        style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.skipText}>▸▸ SKIP A MONTH</Text>
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
