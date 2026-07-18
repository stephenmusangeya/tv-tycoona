import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, scoreColor, space, type } from './theme';

/**
 * Shared UI primitives.
 *
 * Deliberately small and unopinionated — the screens do the composing. Everything
 * here is theme-driven so the whole app restyles from theme.ts.
 */

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return (
    <View style={[styles.card, padded && { padding: space.md }, style]}>{children}</View>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  style,
  testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Stable hook for the screenshot harness; renders as data-testid on web. */
  testID?: string;
}) {
  const isDisabled = disabled || busy;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? '#25150C' : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary' && styles.buttonLabelPrimary,
            variant === 'danger' && styles.buttonLabelDanger,
            isDisabled && styles.buttonLabelDisabled,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'positive' | 'negative' | 'info';
}) {
  const toneColor =
    tone === 'accent'
      ? colors.accent
      : tone === 'positive'
        ? colors.positive
        : tone === 'negative'
          ? colors.negative
          : tone === 'info'
            ? colors.info
            : colors.textDim;

  return (
    <View style={[styles.pill, { borderColor: `${toneColor}55` }]}>
      <Text style={[styles.pillLabel, { color: toneColor }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

/** A labelled figure. The workhorse of every screen. */
export function Stat({
  label,
  value,
  sub,
  valueColor,
  align = 'left',
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  align?: 'left' | 'right';
}) {
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[type.number, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** 0–100 meter with a colour that carries the verdict. */
export function ScoreBar({
  label,
  value,
  max = 100,
  color,
  showValue = true,
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
  showValue?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value / max));
  const barColor = color ?? scoreColor((value / max) * 100);

  return (
    <View style={styles.scoreRow}>
      <Text style={styles.scoreLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.scoreTrack}>
        <View style={[styles.scoreFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
      </View>
      {showValue ? (
        <Text style={styles.scoreValue}>{Math.round(value)}</Text>
      ) : null}
    </View>
  );
}

/**
 * Stacked demographic bar. This is the component that teaches the game's central
 * lesson — that who is watching matters more than how many.
 */
export function SegmentBar({
  breakdown,
  height = 10,
}: {
  breakdown: Record<string, number>;
  height?: number;
}) {
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  if (total <= 0) {
    return <View style={[styles.segmentEmpty, { height, borderRadius: height / 2 }]} />;
  }

  return (
    <View style={[styles.segmentBar, { height, borderRadius: height / 2 }]}>
      {Object.entries(breakdown).map(([key, value]) => {
        const pct = value / total;
        if (pct <= 0.001) return null;
        return (
          <View
            key={key}
            style={{
              flex: pct,
              backgroundColor: colors.segments[key] ?? colors.textFaint,
            }}
          />
        );
      })}
    </View>
  );
}

export function SegmentLegend({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return (
    <View style={styles.legend}>
      {Object.entries(breakdown).map(([key, value]) => (
        <View key={key} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.segments[key] ?? colors.textFaint }]} />
          <Text style={styles.legendLabel}>
            {key === 'youngAdults' ? 'Young' : key.charAt(0).toUpperCase() + key.slice(1)}
          </Text>
          <Text style={styles.legendValue}>
            {total > 0 ? `${Math.round((value / total) * 100)}%` : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

/** A tappable row — the standard list idiom throughout the app. */
export function Row({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
    marginTop: space.lg,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textFaint,
  },
  sectionAction: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },

  button: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceHigh, borderColor: colors.borderBright },
  buttonGhost: { backgroundColor: 'transparent', borderColor: colors.border },
  buttonDanger: { backgroundColor: 'transparent', borderColor: `${colors.negative}66` },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  buttonLabelPrimary: { color: '#25150C' },
  buttonLabelDanger: { color: colors.negative },
  buttonLabelDisabled: { color: colors.textDim },

  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pillLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },

  statLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginBottom: 2,
  },
  statSub: { fontSize: 11, color: colors.textDim, marginTop: 1 },

  scoreRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  scoreLabel: { width: 96, fontSize: 12, color: colors.textDim },
  scoreTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreFill: { height: '100%', borderRadius: 3 },
  scoreValue: {
    width: 30,
    textAlign: 'right',
    fontSize: 11,
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

  segmentBar: { flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.surfaceHigh },
  segmentEmpty: { backgroundColor: colors.surfaceHigh },

  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.sm, gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { fontSize: 10, color: colors.textDim },
  legendValue: { fontSize: 10, color: colors.text, fontWeight: '600' },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.md },

  empty: { padding: space.xl, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: colors.textDim, textAlign: 'center' },
  emptyBody: {
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: space.xs,
    lineHeight: 17,
  },

  row: {
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceAlt },
});
