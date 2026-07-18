import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Motion primitives.
 *
 * A management game's numbers are the action, so they should move. Money counts up
 * rather than snapping, new content slides in rather than appearing, and the week
 * advancing produces a visible beat. Without this the game reads as a document that
 * occasionally changes.
 */

/**
 * A number that animates to its new value.
 *
 * Counting is the cheapest possible "something happened" signal, and it makes a
 * payday feel like a payday instead of a re-render.
 */
export function CountUp({
  value,
  format,
  style,
  duration = 650,
}: {
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const animated = useRef(new Animated.Value(value)).current;
  const previous = useRef(value);

  useEffect(() => {
    if (value === previous.current) return;

    const id = animated.addListener(({ value: v }) => setShown(v));
    Animated.timing(animated, {
      toValue: value,
      duration,
      easing: Easing.out(Easing.cubic),
      // Driving JS state from the value, so this cannot use the native driver.
      useNativeDriver: false,
    }).start(() => {
      setShown(value);
      animated.removeListener(id);
    });

    previous.current = value;
    return () => animated.removeListener(id);
  }, [value, animated, duration]);

  return <Text style={style}>{format(shown)}</Text>;
}

/** Fades and lifts its children in on mount — used for lists and new panels. */
export function FadeIn({
  children,
  delay = 0,
  distance = 10,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Pops when `trigger` changes — a small kick for "this just updated". */
export function Pop({
  trigger,
  children,
  style,
}: {
  trigger: unknown;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [trigger, scale]);

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * A sweep of light across the screen when the week turns.
 *
 * The broadcast equivalent of a page turn: it tells you time moved without a modal or
 * a spinner, and it makes pressing the button feel like doing something.
 */
export function WeekSweep({ trigger }: { trigger: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setVisible(true);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }, [trigger, progress]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255,107,53,0.14)',
        opacity: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
      }}
    />
  );
}

/** Animated 0–1 bar fill, for meters that should grow rather than jump. */
export function GrowBar({
  value,
  color,
  height = 6,
  track = '#FFFFFF14',
}: {
  value: number;
  color: string;
  height?: number;
  track?: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: Math.max(0, Math.min(1, value)),
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, progress]);

  return (
    <View style={{ height, backgroundColor: track, borderRadius: height / 2, overflow: 'hidden' }}>
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0%', '100%'],
          }),
        }}
      />
    </View>
  );
}
