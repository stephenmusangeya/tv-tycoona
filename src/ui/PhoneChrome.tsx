import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, formatMoneyShort, space } from './theme';
import { Clapper, Icon, Plus, Sliders, type IconName } from './icons';
import type { NavItem } from './Sidebar';

/**
 * Phone chrome: a status bar across the top, a tab bar across the bottom.
 *
 * The rail is the right answer on a desktop or a tablet — it keeps the studio's vital
 * signs and its two driving actions permanently on screen, which is what a management
 * sim's control panel should do. On a phone it is the wrong answer for one measurable
 * reason: even collapsed to icons it is 74px of a 390px screen, so a fifth of the
 * width is furniture before the game gets any. The rooms are already tight at that
 * size and were losing the argument to their own navigation.
 *
 * So the rail stays wide, and phones get the layout phones actually want: vitals along
 * the top where they are glanceable, navigation along the bottom where thumbs are.
 * Nothing is lost — every control on the rail has a home here.
 */

export function PhoneStatusBar({
  studioName,
  cash,
  year,
  week,
  onMakeShow,
  onOpenMenu,
}: {
  studioName: string;
  cash: number;
  year: number;
  week: number;
  onMakeShow: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <View style={styles.status}>
      <Clapper size={18} color={colors.accent} />

      <View style={styles.statusIdentity}>
        <Text style={styles.statusStudio} numberOfLines={1}>
          {studioName}
        </Text>
        <Text style={styles.statusDate}>
          Y{year} · W{String(week).padStart(2, '0')}
        </Text>
      </View>

      <Text
        style={[styles.statusCash, cash <= 0 && { color: colors.negative }]}
        numberOfLines={1}
      >
        {formatMoneyShort(cash)}
      </Text>

      {/* The primary action keeps a permanent home on phones too — "how do I make a
          show?" was a genuine question before the rail put this in front of people. */}
      <Pressable
        testID="make-show"
        onPress={onMakeShow}
        style={({ pressed }) => [styles.statusMake, pressed && { opacity: 0.8 }]}
      >
        <Plus size={13} color="#25150C" />
      </Pressable>

      <Pressable
        testID="open-menu"
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.statusMenu, pressed && { opacity: 0.6 }]}
      >
        <Sliders size={15} color={colors.textDim} />
      </Pressable>
    </View>
  );
}

export function PhoneTabBar<K extends string>({
  items,
  active,
  onSelect,
}: {
  items: NavItem<K>[];
  active: K;
  onSelect: (key: K) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Pressable
            key={item.key}
            testID={`nav-${item.key}`}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [styles.tab, pressed && !isActive && { opacity: 0.6 }]}
          >
            {/* The active marker is a bar above the icon rather than a filled pill:
                six tabs across 390px leaves no room for a pill that isn't cramped. */}
            <View style={[styles.tabMark, isActive && styles.tabMarkOn]} />

            <View style={styles.tabIcon}>
              <Icon
                name={item.icon as IconName}
                size={20}
                color={isActive ? colors.accent : colors.textDim}
                opacity={isActive ? 1 : 0.7}
              />
              {item.badge ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>
                    {item.badge > 9 ? '9+' : item.badge}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              style={[styles.tabLabel, isActive && styles.tabLabelOn]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statusIdentity: { flex: 1, minWidth: 0 },
  statusStudio: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: colors.text,
    textTransform: 'uppercase',
  },
  statusDate: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: colors.accent },
  statusCash: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  statusMake: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusMenu: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 2,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 0, paddingBottom: 5, gap: 2 },
  tabMark: { height: 3, width: 22, borderRadius: 2, backgroundColor: 'transparent' },
  tabMarkOn: { backgroundColor: colors.accent },
  tabIcon: { marginTop: 3 },
  tabBadge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: { fontSize: 9, fontWeight: '900', color: '#25150C' },
  tabLabel: { fontSize: 8, fontWeight: '700', color: colors.textDim, letterSpacing: 0.2 },
  tabLabelOn: { color: colors.accent, fontWeight: '900' },
});
