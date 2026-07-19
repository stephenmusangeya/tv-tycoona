import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/**
 * Motion primitives.
 *
 * A management game's numbers are the action, so they should move. Money counts up
 * rather than snapping, new content arrives rather than appearing, and the week
 * advancing produces a visible beat. Without this the game reads as a document that
 * occasionally changes.
 *
 * Two rules govern everything in here, because both are easy to get wrong and both
 * ruin the game when you do:
 *
 * 1. Fast. This is a game you play by pressing the same button several hundred times.
 *    Anything that makes the player wait is charming once and hateful by turn twenty,
 *    so entrances are ~200ms, reactions ~260ms, and nothing on the critical path
 *    blocks input or fails to reach a resting state.
 * 2. Tied to state, not to render. Motion here means "this changed *because* that
 *    happened". A panel that re-stages itself every time its parent re-renders is
 *    saying something false, so every reaction animation is gated behind `useOnChange`
 *    and every entrance is gated behind mounting.
 */

/** House durations. Kept together so the whole app can be re-timed in one place. */
export const DUR = {
  /** Finger-tracking press feedback. Must feel instant. */
  press: 90,
  /** A value flipping or a control clicking over. */
  tick: 180,
  /** Something appearing for the first time. */
  enter: 200,
  /** Something landing in a tray from off-screen. */
  arrive: 240,
  /** A reaction wash that draws the eye and then gets out of the way. */
  react: 260,
  /** Digits rolling to a new figure. */
  count: 420,
} as const;

/* ------------------------------------------------------------------ *
 * Accessibility
 * ------------------------------------------------------------------ */

/**
 * Cached across components so a room full of panels does not each wait on their own
 * async probe — the first mount of the session pays for the lookup, the rest read the
 * answer synchronously and start in the right state.
 */
let reduceMotionCache = false;

/**
 * Whether the player has asked the system for reduced motion.
 *
 * Honouring this is a genuine accessibility requirement, not a nicety: vestibular
 * disorders make sliding and scaling UI actively unpleasant. Every primitive below
 * degrades to "the final state, immediately" rather than to "no feedback" — the
 * information a change happened is still delivered, just without the travel.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reduceMotionCache);

  useEffect(() => {
    let alive = true;

    // Guarded rather than called directly: this API is absent on some web targets and
    // an unhandled rejection here would trip the screenshot harness's error assertion.
    const probe = AccessibilityInfo.isReduceMotionEnabled?.();
    if (probe && typeof probe.then === 'function') {
      probe
        .then((value: boolean) => {
          reduceMotionCache = value;
          if (alive) setReduced(value);
        })
        .catch(() => {});
    }

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (value: boolean) => {
        reduceMotionCache = value;
        if (alive) setReduced(value);
      },
    );

    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------ *
 * Gating
 * ------------------------------------------------------------------ */

/**
 * Runs `react` when `value` actually changes — never on first render, never on a
 * re-render that did not move the value.
 *
 * This is the single most important thing in this file. The common failure mode for
 * game motion is an animation keyed to render rather than to state: the ledger
 * flashes because a sibling updated, the tray re-deals itself because the window
 * resized, and the player learns to ignore all of it. Every reaction below goes
 * through here.
 */
export function useOnChange<T>(value: T, react: (previous: T) => void) {
  const previous = useRef(value);
  const first = useRef(true);
  const latest = useRef(react);
  latest.current = react;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      previous.current = value;
      return;
    }
    if (Object.is(previous.current, value)) return;
    const was = previous.current;
    previous.current = value;
    latest.current(was);
  }, [value]);
}

/* ------------------------------------------------------------------ *
 * Entrances
 * ------------------------------------------------------------------ */

const StaggerContext = createContext<{ claim: () => number } | null>(null);

/**
 * Hands out entrance slots in mount order.
 *
 * A room whose panels all fade in together still blinks into existence — it is one
 * event, just a soft one. Dealing them out over a few frames is what makes the room
 * read as assembling around you. The counter lives in a ref created per mount, so
 * re-entering a room re-deals it while merely re-rendering one does nothing.
 */
export function StaggerGroup({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => {
    let next = 0;
    return { claim: () => next++ };
  }, []);

  return <StaggerContext.Provider value={value}>{children}</StaggerContext.Provider>;
}

/** This component's place in its group's entrance order (0 when outside a group). */
export function useStaggerSlot(): number {
  const group = useContext(StaggerContext);
  // Claimed once per component instance, in the lazy initialiser, so the slot survives
  // every subsequent render.
  const [slot] = useState(() => (group ? group.claim() : 0));
  return slot;
}

/**
 * Delay for a given entrance slot.
 *
 * Capped deliberately: a room with nine panels must not take 400ms to be readable, and
 * past the fourth panel the eye has stopped tracking the order anyway.
 */
export function staggerDelay(slot: number, step = 40, max = 4): number {
  return Math.min(slot, max) * step;
}

/**
 * An entrance expressed as a style rather than a wrapper component.
 *
 * Panels carry flex values and sit directly inside decks, so wrapping them in an
 * animating View would insert a layout box into the room and quietly change its
 * proportions. Handing back a style lets the panel animate itself.
 *
 * Mount-gated by construction: the effect's dependencies are stable, so it fires once
 * when the component appears and never again for a re-render.
 */
export function useEnter({
  delay = 0,
  distance = 8,
}: { delay?: number; distance?: number } = {}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DUR.enter,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay, reduced]);

  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  };
}

/** Fades and lifts its children in on mount — used for lists and new content. */
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
  const enter = useEnter({ delay, distance });
  return <Animated.View style={[style, enter]}>{children}</Animated.View>;
}

/**
 * Something landing from off to the side, with a little overshoot.
 *
 * For the in-tray specifically. A decision card is a thing that arrived on your desk
 * while you were elsewhere, and sliding in from the edge says that in a way fading
 * does not — fading says "was always there, you missed it". Gated by mounting: a new
 * offer is a new React key, so only genuinely new cards fly in while the ones already
 * on the desk sit still.
 */
export function Arrive({
  children,
  delay = 0,
  distance = 18,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration: DUR.arrive,
        // A touch of back-easing so the card overshoots and settles, like something
        // dropped onto a desk rather than slid into a slot.
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [progress, delay, reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          // Clamped separately from the transform: back-easing overshoots past 1, and
          // an opacity above 1 is not something every target handles gracefully.
          opacity: progress.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [0, 1, 1],
            extrapolate: 'clamp',
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ *
 * Reactions
 * ------------------------------------------------------------------ */

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
  duration = DUR.count,
}: {
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const animated = useRef(new Animated.Value(value)).current;
  const previous = useRef(value);

  useEffect(() => {
    if (value === previous.current) return;
    previous.current = value;

    if (reduced) {
      animated.setValue(value);
      setShown(value);
      return;
    }

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

    return () => animated.removeListener(id);
  }, [value, animated, duration, reduced]);

  return <Text style={style}>{format(shown)}</Text>;
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
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  useOnChange(trigger, () => {
    if (reduced) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 110, useNativeDriver: true }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 220,
        useNativeDriver: true,
      }),
    ]).start();
  });

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * A short coloured wash behind a figure when it changes: green up, red down.
 *
 * Money moving is the *consequence* of the week you just played, and a number that
 * merely holds a different value afterwards makes the player audit the screen to find
 * out what their press did. The wash points at the answer and then leaves, which is
 * the whole job — it is informative, not decorative, and it is gone in a quarter of a
 * second so it never competes with the next press.
 */
export function Flash({
  value,
  children,
  style,
  up = '#2E7D4F',
  down = '#B0342A',
}: {
  value: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  up?: string;
  down?: string;
}) {
  const reduced = useReducedMotion();
  const glow = useRef(new Animated.Value(0)).current;
  const [tint, setTint] = useState<string | null>(null);

  useOnChange(value, (previous) => {
    if (reduced || value === previous) return;
    setTint(value > previous ? up : down);
    glow.setValue(0);
    Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(glow, {
        toValue: 0,
        duration: DUR.react,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Unmounting the wash on completion guarantees a resting state, so a screenshot
      // taken later can never catch a half-lit panel.
    ]).start(() => setTint(null));
  });

  return (
    <View style={style}>
      {children}
      {tint ? (
        <Animated.View
          style={{
            // style.pointerEvents rather than the prop, which is deprecated in RN 0.86.
            pointerEvents: 'none',
            position: 'absolute',
            top: -4,
            left: -6,
            right: -6,
            bottom: -4,
            borderRadius: 6,
            backgroundColor: tint,
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }),
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * A short string that flips up into place when it changes.
 *
 * For readouts that step rather than count — a week number, a status word. `CountUp`
 * is wrong for these because there is nothing meaningful between 12 and 13.
 */
export function Flip({
  value,
  style,
  distance = 6,
}: {
  value: string;
  style?: StyleProp<TextStyle>;
  distance?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;

  useOnChange(value, () => {
    if (reduced) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: DUR.tick,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  });

  return (
    <Animated.Text
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {value}
    </Animated.Text>
  );
}

/**
 * A sweep of light across the screen when the week turns.
 *
 * The broadcast equivalent of a page turn: it tells you time moved without a modal or
 * a spinner, and it makes pressing the button feel like doing something. Deliberately
 * non-blocking and short — it is a flourish over the top of a screen that has already
 * updated, never a transition you have to sit through.
 */
export function WeekSweep({ trigger }: { trigger: number }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useOnChange(trigger, () => {
    if (reduced) return;
    setVisible(true);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setVisible(false));
  });

  if (!visible) return null;

  return (
    <Animated.View
      style={{
        pointerEvents: 'none',
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
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(1, value));

  useEffect(() => {
    if (reduced) {
      progress.setValue(target);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: target,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [target, progress, reduced]);

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

/* ------------------------------------------------------------------ *
 * Touch
 * ------------------------------------------------------------------ */

/**
 * Press feedback that tracks the finger rather than replaying after the fact.
 *
 * The old pattern here fired a fixed down-then-up sequence from `onPress`, which means
 * the control moved *after* you let go — it read as an animation about the button
 * rather than as the button being pushed. Sinking on `onPressIn` and springing back on
 * `onPressOut` gives the control weight, and it gives the week-advance press its
 * anticipation beat for free: you load the button, you release, time moves.
 */
export function usePressScale(depth = 0.96) {
  const reduced = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;

  const handlers = useMemo(
    () => ({
      onPressIn: () => {
        if (reduced) return;
        Animated.timing(press, {
          toValue: 1,
          duration: DUR.press,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      },
      onPressOut: () => {
        if (reduced) return;
        Animated.spring(press, {
          toValue: 0,
          friction: 5,
          tension: 220,
          useNativeDriver: true,
        }).start();
      },
    }),
    [press, reduced],
  );

  return {
    scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, depth] }),
    ...handlers,
  };
}
