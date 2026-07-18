import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, space } from './theme';
import {
  SWEEPS_WEEKS,
  WEEK_AWARDS,
  WEEK_MIDSEASON,
  WEEK_SEASON_PREMIERE,
  WEEK_UPFRONTS,
  WEEKS_PER_YEAR,
} from '../engine/schedule';

/**
 * The broadcast year, laid out as a strip.
 *
 * The calendar drives everything — when shows premiere, when networks decide what
 * comes back, when ratings count double — but it was previously buried in a one-line
 * banner that only appeared during the week itself. A player needs to see the beats
 * *coming* to plan around them, so the whole 52-week year is on screen with the
 * playhead sitting where you are.
 */

interface Beat {
  week: number;
  label: string;
  short: string;
  color: string;
}

const BEATS: Beat[] = [
  { week: WEEK_MIDSEASON, label: 'Midseason launch', short: 'MID', color: colors.info },
  { week: WEEK_AWARDS, label: 'Awards night', short: 'AWD', color: '#BB6BD9' },
  { week: SWEEPS_WEEKS[0], label: 'Sweeps', short: 'SWP', color: colors.accent },
  { week: WEEK_UPFRONTS, label: 'Upfronts — renewals', short: 'UPF', color: colors.negative },
  { week: SWEEPS_WEEKS[1], label: 'Sweeps', short: 'SWP', color: colors.accent },
  { week: WEEK_SEASON_PREMIERE, label: 'Season premiere', short: 'PRM', color: colors.positive },
];

export function SeasonTimeline({ week, year }: { week: number; year: number }) {
  const next = nextBeat(week);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>BROADCAST YEAR {year}</Text>
        {next ? (
          <Text style={styles.next}>
            <Text style={{ color: next.beat.color }}>{next.beat.label}</Text>
            <Text style={{ color: colors.textFaint }}>
              {next.weeksAway === 0 ? ' — this week' : ` in ${next.weeksAway}w`}
            </Text>
          </Text>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
      >
        {Array.from({ length: WEEKS_PER_YEAR }).map((_, index) => {
          const w = index + 1;
          const beat = BEATS.find((b) => b.week === w);
          const isNow = w === week;
          const isSummer = w >= 23 && w <= 36;

          return (
            <View key={w} style={styles.cell}>
              <View
                style={[
                  styles.tick,
                  isSummer && styles.tickSummer,
                  beat ? { backgroundColor: beat.color, height: 20 } : null,
                  isNow && styles.tickNow,
                ]}
              />
              {isNow ? <View style={styles.playhead} /> : null}
              {beat ? (
                <Text style={[styles.beatLabel, { color: beat.color }]}>{beat.short}</Text>
              ) : (
                <Text style={styles.weekLabel}>{w % 4 === 0 ? w : ''}</Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.surfaceHigh }]} />
          <Text style={styles.legendText}>summer lull</Text>
        </View>
        <Text style={styles.legendText}>
          week {week} of {WEEKS_PER_YEAR}
        </Text>
      </View>
    </View>
  );
}

function nextBeat(week: number): { beat: Beat; weeksAway: number } | undefined {
  const upcoming = BEATS.filter((b) => b.week >= week).sort((a, b) => a.week - b.week)[0];
  if (upcoming) return { beat: upcoming, weeksAway: upcoming.week - week };
  // Past the last beat of the year — wrap to the first beat of the next one.
  const first = [...BEATS].sort((a, b) => a.week - b.week)[0];
  return first ? { beat: first, weeksAway: WEEKS_PER_YEAR - week + first.week } : undefined;
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  title: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: colors.textFaint },
  next: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },

  track: { alignItems: 'flex-end', paddingBottom: 2 },
  cell: { width: 13, alignItems: 'center' },
  tick: {
    width: 3,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  tickSummer: { backgroundColor: colors.surfaceHigh, height: 6 },
  tickNow: { backgroundColor: colors.text, height: 24, width: 4 },
  playhead: {
    position: 'absolute',
    top: -4,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.text,
  },
  beatLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 0.3, marginTop: 3 },
  weekLabel: { fontSize: 7, color: colors.textFaint, marginTop: 3 },

  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 8, height: 4, borderRadius: 2 },
  legendText: { fontSize: 9, color: colors.textFaint, letterSpacing: 0.4 },
});
