import React, { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '../theme';

/**
 * Play control.
 *
 * Replaces the rotary dial, which was handsome but ate a whole panel for one action.
 * This keeps the physical press — gold marquee button, haptic thump, a scale kick —
 * in the corner where it belongs, with the week reading beside it.
 */
export function PlayButton({
  year,
  week,
  busy,
  onAdvance,
  onSkip,
}: {
  year: number;
  week: number;
  busy: boolean;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const press = useRef(new Animated.Value(0)).current;

  const tap = (fn: () => void, style: Haptics.ImpactFeedbackStyle) => () => {
    // Haptics are device-only; calling them on web throws.
    if (Platform.OS !== 'web') void Haptics.impactAsync(style);
    Animated.sequence([
      Animated.timing(press, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.spring(press, { toValue: 0, friction: 5, useNativeDriver: true }),
    ]).start();
    fn();
  };

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] });

  return (
    <View style={styles.wrap}>
      <View style={styles.clock}>
        <Text style={styles.year}>YEAR {year}</Text>
        <Text style={styles.week}>WEEK {String(week).padStart(2, '0')}</Text>
      </View>

      <Pressable
        testID="skip-four"
        onPress={tap(onSkip, Haptics.ImpactFeedbackStyle.Light)}
        disabled={busy}
        style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.skipText}>▸▸</Text>
      </Pressable>

      <Pressable
        testID="advance-week"
        onPress={tap(onAdvance, Haptics.ImpactFeedbackStyle.Medium)}
        disabled={busy}
      >
        <Animated.View style={[styles.play, { transform: [{ scale }] }, busy && { opacity: 0.6 }]}>
          <LinearGradient
            colors={['#C94236', '#8E2119']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.playFill}
          />
          <Text style={styles.playText}>{busy ? 'ON AIR…' : 'PLAY WEEK ▸'}</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  clock: { alignItems: 'flex-end', marginRight: 2 },
  year: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: colors.textFaint },
  week: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  skip: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: { fontSize: 12, fontWeight: '900', color: colors.textDim },

  play: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    boxShadow: '0px 2px 10px rgba(176,52,42,0.35)',
  },
  playFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  playText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#FDF6E8' },
});
