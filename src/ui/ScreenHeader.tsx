import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, space } from './theme';

/**
 * Screen header.
 *
 * Every screen opens with the same dark band and colour-bar strip as the title
 * screen, so the game reads as one object rather than a set of documents. It also
 * gives each screen a clear top edge — the previous versions started with a bare
 * heading floating on cream, which is what made them look like web pages.
 */

const BARS = ['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'];

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={['#232C38', '#141A22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.band}
      >
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      </LinearGradient>

      <View style={styles.bars}>
        {BARS.map((c) => (
          <View key={c} style={[styles.bar, { backgroundColor: c }]} />
        ))}
      </View>
    </View>
  );
}

/** A figure to sit on the right of a header. */
export function HeaderStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: -space.lg, marginTop: -space.md, marginBottom: space.lg },
  band: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#F5F7FA',
    letterSpacing: 0.3,
  },
  subtitle: { fontSize: 11, color: '#8D97A6', marginTop: 3, letterSpacing: 0.3 },

  statLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: '#6B7686' },
  statValue: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },

  bars: { flexDirection: 'row', height: 4 },
  bar: { flex: 1 },
});
