import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, formatMoneyShort, space } from './theme';
import { Clapper, Icon, Plus, Sliders, type IconName } from './icons';

/**
 * Left navigation rail.
 *
 * A persistent rail rather than bottom tabs: it keeps the studio's vital signs and
 * the two actions that drive the game — make a show, advance the week — on screen at
 * all times, the way a management sim's control panel should be. Bottom tabs hid the
 * primary action inside a screen and made "how do I make a show?" a genuine question.
 *
 * Collapses to icons on narrow screens so it still works on a phone.
 */

export interface NavItem<K extends string> {
  key: K;
  label: string;
  icon: IconName;
  badge?: number;
}

export function Sidebar<K extends string>({
  items,
  active,
  onSelect,
  compact,
  studioName,
  cash,
  year,
  week,
  onMakeShow,
  onOpenMenu,
}: {
  items: NavItem<K>[];
  active: K;
  onSelect: (key: K) => void;
  compact: boolean;
  studioName: string;
  cash: number;
  year: number;
  week: number;
  onMakeShow: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <View style={[styles.rail, compact ? styles.railCompact : styles.railFull]}>
      {/* --- Brand --- */}
      <View style={styles.brandBlock}>
        <Clapper size={22} color={colors.accent} />
        {!compact ? (
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>TV TYCOON</Text>
            <Text style={styles.studio} numberOfLines={1}>
              {studioName}
            </Text>
          </View>
        ) : null}
      </View>

      {/* --- Vitals (wide rail only; on a phone this just truncated) --- */}
      {!compact ? (
        <View style={styles.vitals}>
          <Text style={styles.vitalCash} numberOfLines={1}>
            {formatMoneyShort(cash)}
          </Text>
          <Text style={styles.vitalDate}>
            YEAR {year} · WEEK {String(week).padStart(2, '0')}
          </Text>
        </View>
      ) : (
        // The compact rail still has to show the money — dropping it meant a phone
        // player could not see their cash without opening another screen.
        <View style={styles.compactWeek}>
          <Text style={styles.compactCash} numberOfLines={1}>
            {formatMoneyShort(cash)}
          </Text>
          <Text style={styles.vitalDate}>W{week}</Text>
        </View>
      )}

      {/* --- Primary action --- */}
      <Pressable
        testID="make-show"
        onPress={onMakeShow}
        style={({ pressed }) => [styles.makeShow, pressed && { opacity: 0.8 }]}
      >
        <Plus size={14} color="#25150C" />
        {!compact ? <Text style={styles.makeShowLabel}>MAKE A SHOW</Text> : null}
      </Pressable>

      {/* --- Navigation --- */}
      <ScrollView showsVerticalScrollIndicator={false} style={styles.nav}>
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Pressable
              key={item.key}
              testID={`nav-${item.key}`}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.navItem,
                compact && styles.navItemCompact,
                isActive && styles.navItemActive,
                pressed && !isActive && styles.navItemPressed,
              ]}
            >
              {isActive ? <View style={styles.activeBar} /> : null}
              <View style={styles.navGlyph}>
                <Icon
                  name={item.icon}
                  size={19}
                  color={isActive ? colors.accent : colors.textDim}
                  opacity={isActive ? 1 : 0.75}
                />
              </View>
              {!compact ? (
                <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                  {item.label}
                </Text>
              ) : null}
              {item.badge ? (
                <View style={[styles.badge, compact && styles.badgeCompact]}>
                  <Text style={styles.badgeText}>{item.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Save, load and quit live here — the rail's spare space, used. */}
      <Pressable
        testID="open-menu"
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.7 }]}
      >
        <Sliders size={15} color={colors.textDim} />
        {!compact ? <Text style={styles.menuLabel}>Menu</Text> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: space.md,
  },
  railFull: { width: 196, paddingHorizontal: space.md },
  railCompact: { width: 74, paddingHorizontal: space.sm, alignItems: 'center' },

  brandBlock: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  brandMark: { fontSize: 20, color: colors.accent },
  brand: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: colors.text,
  },
  studio: { fontSize: 10, color: colors.textDim, marginTop: 1 },

  vitals: {
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
  },
  compactWeek: { marginTop: space.md, alignItems: 'center' },
  compactCash: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  vitalCash: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  vitalDate: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.accent,
    marginTop: 2,
  },

  makeShow: {
    marginTop: space.sm,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
  },
  makeShowLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.9, color: '#25150C' },

  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 10,
    paddingHorizontal: space.sm,
    borderRadius: 8,
    marginTop: space.xs,
  },
  navItemCompact: { justifyContent: 'center', paddingHorizontal: 0 },
  navItemActive: { backgroundColor: colors.surfaceHigh },
  navItemPressed: { backgroundColor: colors.surface },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  navGlyph: { width: 20, alignItems: 'center', justifyContent: 'center' },
  navLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.textDim },
  navLabelActive: { color: colors.text },

  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeCompact: { position: 'absolute', top: 4, right: 10 },
  badgeText: { fontSize: 10, fontWeight: '800', color: '#25150C' },

  /** Not flex:1 — letting the nav stretch is what left a large empty gap below it. */
  nav: { flexGrow: 0, marginTop: space.sm, width: '100%' },

  menuButton: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    width: '100%',
  },
  menuLabel: { fontSize: 12, fontWeight: '600', color: colors.textDim },
});
