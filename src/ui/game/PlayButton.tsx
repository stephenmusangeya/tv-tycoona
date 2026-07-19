import React, { useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { DUR, Flip, useOnChange, usePressScale, useReducedMotion } from '../motion';
import { colors } from '../theme';

/**
 * Play control.
 *
 * Replaces the rotary dial, which was handsome but ate a whole panel for one action.
 * This keeps the physical press — gold marquee button, haptic thump, a scale kick —
 * in the corner where it belongs, with the week reading beside it.
 *
 * Advancing the week is the game's one mandatory verb, so the press is built as three
 * beats rather than one event: the button *loads* under your finger, *releases* when
 * you let go, and then the week readout flips over to say time actually moved. Each
 * beat is tied to a different real thing (touch down, touch up, a changed week), which
 * is what makes it read as cause and effect instead of as a canned flourish.
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
  const reduced = useReducedMotion();
  const play = usePressScale(0.94);
  const skip = usePressScale(0.9);

  // The arrival beat: the button settles back out a fraction over its resting size the
  // moment the new week lands. It is the button reporting that the press took effect,
  // which is why it is keyed to the week rather than fired from the press handler —
  // if the advance were ever refused, nothing here should claim it happened.
  const land = useRef(new Animated.Value(0)).current;
  useOnChange(week, () => {
    if (reduced) return;
    land.setValue(0);
    Animated.sequence([
      Animated.timing(land, {
        toValue: 1,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(land, {
        toValue: 0,
        duration: DUR.tick,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  });

  const tap = (fn: () => void, style: Haptics.ImpactFeedbackStyle) => () => {
    // Haptics are device-only; calling them on web throws.
    if (Platform.OS !== 'web') void Haptics.impactAsync(style);
    fn();
  };

  const landScale = land.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <View style={styles.wrap}>
      <View style={styles.clock}>
        <Text style={styles.year}>YEAR {year}</Text>
        {/* Only the digits move. Flipping the whole "WEEK 12" line would animate the
            word every week to tell you the number changed. */}
        <View style={styles.weekLine}>
          <Text style={styles.week}>WEEK </Text>
          <Flip value={String(week).padStart(2, '0')} style={styles.week} />
        </View>
      </View>

      <Pressable
        testID="skip-four"
        onPress={tap(onSkip, Haptics.ImpactFeedbackStyle.Light)}
        onPressIn={skip.onPressIn}
        onPressOut={skip.onPressOut}
        disabled={busy}
      >
        <Animated.View style={[styles.skip, { transform: [{ scale: skip.scale }] }]}>
          <Text style={styles.skipText}>▸▸</Text>
        </Animated.View>
      </Pressable>

      <Pressable
        testID="advance-week"
        onPress={tap(onAdvance, Haptics.ImpactFeedbackStyle.Medium)}
        onPressIn={play.onPressIn}
        onPressOut={play.onPressOut}
        disabled={busy}
      >
        <Animated.View
          style={[
            styles.play,
            { transform: [{ scale: play.scale }, { scale: landScale }] },
            busy && { opacity: 0.6 },
          ]}
        >
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
  weekLine: { flexDirection: 'row', alignItems: 'baseline' },
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
