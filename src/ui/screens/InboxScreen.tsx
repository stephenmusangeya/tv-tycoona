import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useGame, useGameStore } from '../../store/gameStore';
import { playerNews } from '../../store/selectors';
import { Card, EmptyState, Pill } from '../components';
import { ScreenHeader, HeaderStat } from '../ScreenHeader';
import { FadeIn } from '../motion';
import { colors, space, type } from '../theme';
import type { GameEventKind } from '../../engine/types';

/**
 * The inbox.
 *
 * Everything that happens to the player arrives here as a message. Previously the
 * news feed lived as a long list at the bottom of the desk, which made the main
 * screen read like a web page you scroll rather than a game you look at. Moving it
 * here gives the desk its space back and gives news somewhere to accumulate without
 * being lost.
 */

type Filter = 'all' | 'deals' | 'money' | 'shows' | 'people';

const FILTERS: Array<{ key: Filter; label: string; kinds: GameEventKind[] }> = [
  { key: 'all', label: 'All', kinds: [] },
  { key: 'deals', label: 'Offers', kinds: ['deal', 'pitch'] },
  { key: 'money', label: 'Money', kinds: ['money', 'milestone'] },
  { key: 'shows', label: 'Shows', kinds: ['ratings', 'award'] },
  { key: 'people', label: 'People', kinds: ['talent', 'scandal'] },
];

/** Sender name and colour per event kind — messages should feel like they came from someone. */
const SENDERS: Record<string, { from: string; color: string; glyph: string }> = {
  deal: { from: 'Deals desk', color: '#9E5FE8', glyph: '✉' },
  pitch: { from: 'Your agent', color: colors.info, glyph: '✦' },
  money: { from: 'Accounts', color: colors.positive, glyph: '$' },
  ratings: { from: 'Ratings', color: colors.accent, glyph: '▤' },
  award: { from: 'Awards', color: colors.accent, glyph: '★' },
  scandal: { from: 'Press office', color: colors.negative, glyph: '!' },
  talent: { from: 'Casting', color: colors.info, glyph: '☺' },
  milestone: { from: 'Your studio', color: colors.positive, glyph: '▣' },
  rival: { from: 'Trade press', color: colors.textFaint, glyph: '◈' },
};

export function InboxScreen() {
  const game = useGame();
  const markRead = useGameStore((s) => s.markInboxRead);
  const lastReadEventId = useGameStore((s) => s.lastReadEventId);
  const [filter, setFilter] = useState<Filter>('all');

  const news = useMemo(() => (game ? playerNews(game, 120) : []), [game, game?.absoluteWeek]);

  // Everything newer than the last-read marker is unread. Snapshot it on mount so
  // messages do not un-highlight themselves while the player is still reading.
  const [unreadAtOpen] = useState(() => {
    if (!lastReadEventId) return new Set(news.map((e) => e.id));
    const index = news.findIndex((e) => e.id === lastReadEventId);
    return new Set(index === -1 ? news.map((e) => e.id) : news.slice(0, index).map((e) => e.id));
  });

  useEffect(() => {
    if (news.length > 0) markRead(news[0].id);
  }, [news, markRead]);

  if (!game) return null;

  const active = FILTERS.find((f) => f.key === filter)!;
  const shown =
    active.kinds.length === 0 ? news : news.filter((e) => active.kinds.includes(e.kind));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Inbox"
        subtitle={`${news.length} messages`}
        right={
          <HeaderStat
            label="UNREAD"
            value={String(unreadAtOpen.size)}
            color={unreadAtOpen.size > 0 ? undefined : '#6B7686'}
          />
        }
      />

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, filter === f.key && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {shown.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <EmptyState title="Nothing here" body="Play a few weeks." />
        </Card>
      ) : (
        <Card padded={false} style={{ marginTop: space.lg }}>
          {shown.map((event, index) => {
            const sender = SENDERS[event.kind] ?? SENDERS.rival;
            const unread = unreadAtOpen.has(event.id);

            return (
              <View
                key={event.id}
                style={[
                  styles.message,
                  index === shown.length - 1 && { borderBottomWidth: 0 },
                  unread && styles.messageUnread,
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: `${sender.color}22` }]}>
                  <Text style={[styles.avatarGlyph, { color: sender.color }]}>
                    {sender.glyph}
                  </Text>
                </View>

                <View style={{ flex: 1 }}>
                  <View style={styles.messageTop}>
                    <Text style={[styles.from, { color: sender.color }]}>{sender.from}</Text>
                    <Text style={styles.when}>
                      Y{event.year} W{String(event.week).padStart(2, '0')}
                    </Text>
                  </View>
                  <Text style={[styles.subject, unread && styles.subjectUnread]}>
                    {event.headline}
                  </Text>
                  {event.body ? <Text style={styles.body}>{event.body}</Text> : null}
                </View>

                {unread ? <View style={styles.unreadDot} /> : null}
              </View>
            );
          })}
        </Card>
      )}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

/** Count of messages the player has not seen — drives the nav badge. */
export function useUnreadCount(): number {
  const game = useGame();
  const lastReadEventId = useGameStore((s) => s.lastReadEventId);
  if (!game) return 0;

  const news = playerNews(game, 120);
  if (news.length === 0) return 0;
  if (!lastReadEventId) return news.length;

  const index = news.findIndex((e) => e.id === lastReadEventId);
  return index === -1 ? news.length : index;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.md },

  filters: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.md,
    backgroundColor: colors.surface,
    padding: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filter: { flex: 1, paddingVertical: space.sm, borderRadius: 6, alignItems: 'center' },
  filterActive: { backgroundColor: colors.surfaceHigh },
  filterText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  filterTextActive: { color: colors.text },

  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  messageUnread: { backgroundColor: colors.accentSoft },

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarGlyph: { fontSize: 14, fontWeight: '800' },

  messageTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  from: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  when: { fontSize: 9, color: colors.textFaint, letterSpacing: 0.4 },
  subject: { fontSize: 13, color: colors.text, marginTop: 2, lineHeight: 18 },
  subjectUnread: { fontWeight: '700' },
  body: { fontSize: 11, color: colors.textDim, marginTop: 3, lineHeight: 16 },

  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
});
