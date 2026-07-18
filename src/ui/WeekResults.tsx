import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Poster } from './Poster';
import { CountUp } from './motion';
import { SegmentBar } from './components';
import { colors, formatViewers, space } from './theme';
import type { SegmentId, WeekResult } from '../engine/types';

/**
 * The overnights.
 *
 * The payoff for pressing the button. Before this, a week passed and some numbers
 * quietly changed somewhere on the page — the single most important moment in the
 * game had no moment. Now the results come in like ratings actually do: a card per
 * show, a verdict, and the number counting up.
 *
 * Only appears when one of the player's shows aired, and dismisses on tap.
 */

export interface AiredLine {
  productionId: string;
  title: string;
  format: string;
  viewers: number;
  viewersBySegment: Record<SegmentId, number>;
  /** Previous average, for the up/down comparison. */
  previous?: number;
}

type Verdict = 'hit' | 'up' | 'steady' | 'down' | 'flop';

function verdictFor(line: AiredLine): { verdict: Verdict; label: string; color: string } {
  const previous = line.previous;

  if (line.viewers >= 9) return { verdict: 'hit', label: 'SMASH HIT', color: '#0FA968' };
  if (previous === undefined) {
    return line.viewers >= 4
      ? { verdict: 'up', label: 'STRONG START', color: '#0FA968' }
      : { verdict: 'down', label: 'QUIET START', color: colors.warning };
  }

  const change = (line.viewers - previous) / Math.max(0.4, previous);
  if (change > 0.12) return { verdict: 'up', label: 'RATINGS UP', color: '#0FA968' };
  if (change < -0.12) return { verdict: 'down', label: 'RATINGS DOWN', color: colors.negative };
  if (line.viewers < 1.5) return { verdict: 'flop', label: 'NOBODY WATCHED', color: colors.negative };
  return { verdict: 'steady', label: 'HOLDING', color: colors.textDim };
}

export function WeekResults({
  result,
  lines,
  onDismiss,
}: {
  result: WeekResult;
  lines: AiredLine[];
  onDismiss: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    enter.setValue(0);
    setReady(false);
    Animated.timing(enter, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start(() => setReady(true));
  }, [enter, result.week]);

  if (lines.length === 0) return null;

  const total = lines.reduce((sum, l) => sum + l.viewers, 0);

  return (
    <Pressable style={styles.backdrop} onPress={onDismiss} testID="dismiss-results">
      <Animated.View
        style={[
          styles.card,
          {
            opacity: enter,
            transform: [
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['#1A2029', '#0E1319']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.head}
        >
          <View>
            <Text style={styles.kicker}>THE OVERNIGHTS</Text>
            <Text style={styles.headline}>
              Year {result.year} · Week {String(result.week).padStart(2, '0')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatViewers(total)}</Text>
          </View>
        </LinearGradient>

        <View style={styles.bars}>
          {['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'].map(
            (c) => (
              <View key={c} style={[styles.bar, { backgroundColor: c }]} />
            ),
          )}
        </View>

        <View style={styles.body}>
          {lines.slice(0, 4).map((line) => {
            const { label, color } = verdictFor(line);
            const delta =
              line.previous !== undefined ? line.viewers - line.previous : undefined;

            return (
              <View key={line.productionId} style={styles.row}>
                <Poster
                  seed={line.productionId}
                  format={line.format as never}
                  size="sm"
                  live
                />

                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>
                    {line.title}
                  </Text>
                  <View style={[styles.verdictPill, { borderColor: `${color}66` }]}>
                    <Text style={[styles.verdictText, { color }]}>{label}</Text>
                  </View>
                  <View style={styles.demo}>
                    <SegmentBar breakdown={line.viewersBySegment} height={5} />
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  {/* Counts up only once the card has landed, so the number is the
                      thing you watch rather than competing with the entrance. */}
                  <CountUp
                    value={ready ? line.viewers : 0}
                    format={(n) => n.toFixed(1)}
                    style={styles.viewers}
                    duration={900}
                  />
                  <Text style={styles.viewersUnit}>MILLION</Text>
                  {delta !== undefined ? (
                    <Text
                      style={[
                        styles.delta,
                        { color: delta >= 0 ? '#0FA968' : colors.negative },
                      ]}
                    >
                      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}M
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {lines.length > 4 ? (
            <Text style={styles.more}>+{lines.length - 4} more on air</Text>
          ) : null}
        </View>

        <Pressable onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>TAP TO CONTINUE</Text>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,7,10,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    zIndex: 50,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0px 20px 60px rgba(0,0,0,0.45)',
  },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: space.lg,
  },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.6, color: colors.accent },
  headline: { fontSize: 20, fontWeight: '900', color: '#F5F7FA', marginTop: 2 },
  totalLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: '#6B7686' },
  totalValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#F5F7FA',
    fontVariant: ['tabular-nums'],
  },

  bars: { flexDirection: 'row', height: 4 },
  bar: { flex: 1 },

  body: { padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 14, fontWeight: '800', color: colors.text },
  verdictPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginTop: 3,
  },
  verdictText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  demo: { marginTop: 6 },

  viewers: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  viewersUnit: { fontSize: 7, fontWeight: '800', letterSpacing: 1, color: colors.textFaint },
  delta: { fontSize: 11, fontWeight: '800', marginTop: 2 },

  more: { fontSize: 11, color: colors.textFaint, textAlign: 'center', marginTop: 2 },

  dismiss: {
    padding: space.md,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dismissText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: colors.textFaint },
});
