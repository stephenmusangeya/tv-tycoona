import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useGame, useGameStore } from '../../store/gameStore';
import { playerNews } from '../../store/selectors';
import { Room, Deck, Panel, Readout } from '../game/Room';
import { Icon, type IconName } from '../icons';
import { colors, radius, space } from '../theme';
import type { GameEvent, GameEventKind } from '../../engine/types';

/**
 * The post room.
 *
 * This was a ScrollView of message cards — a mail client, which is to say a web page.
 * Post does not arrive in a feed, it arrives in a wire tray on a desk, and that is the
 * only thing this screen needed to be: a fixed room with a tray in it.
 *
 * The stack is the whole design. Letters sit at slightly different angles because paper
 * dropped into a tray never lands square, unread ones sit proud with their seal still
 * on, read ones have settled flat and lost their colour. You can tell at a glance how
 * much post you have without reading a single word, which is what a count in a corner
 * can never do.
 *
 * Picking a letter lifts it out of the tray and onto the desk beside it, where the full
 * text is legible. The tray stays visible while you read — you are standing at the desk
 * the whole time, not navigating between two pages.
 */

type Filter = 'all' | 'deals' | 'money' | 'shows' | 'people';

const FILTERS: Array<{ key: Filter; label: string; kinds: GameEventKind[] }> = [
  { key: 'all', label: 'ALL', kinds: [] },
  { key: 'deals', label: 'OFFERS', kinds: ['deal', 'pitch'] },
  { key: 'money', label: 'MONEY', kinds: ['money', 'milestone'] },
  { key: 'shows', label: 'SHOWS', kinds: ['ratings', 'award'] },
  { key: 'people', label: 'PEOPLE', kinds: ['talent', 'scandal'] },
];

/**
 * Who sent it, and what is stamped on the seal.
 *
 * The icon does the work the sender's name used to: at stack size the letters overlap
 * and only the seal is reliably visible, so the seal has to say what kind of post it is
 * on its own. These were emoji, which meant nine different art directions on the desk.
 */
const SENDERS: Record<string, { from: string; color: string; icon: IconName }> = {
  deal: { from: 'DEALS DESK', color: '#7A5A8C', icon: 'key' },
  pitch: { from: 'YOUR AGENT', color: colors.info, icon: 'bulb' },
  money: { from: 'ACCOUNTS', color: colors.positive, icon: 'ticket' },
  ratings: { from: 'RATINGS', color: colors.accent, icon: 'broadcast' },
  award: { from: 'AWARDS', color: colors.positive, icon: 'trophy' },
  scandal: { from: 'PRESS OFFICE', color: colors.negative, icon: 'megaphone' },
  talent: { from: 'CASTING', color: colors.info, icon: 'star' },
  milestone: { from: 'YOUR STUDIO', color: colors.positive, icon: 'clapper' },
  rival: { from: 'TRADE PRESS', color: colors.textFaint, icon: 'newspaper' },
};

function senderFor(kind: string) {
  return SENDERS[kind] ?? SENDERS.rival;
}

/**
 * A stable pseudo-random number in [0,1) from an id.
 *
 * The tilt of each letter has to be the same on every render — paper that re-shuffles
 * itself whenever the parent re-renders reads as a glitch, not as a stack.
 */
function jitter(seed: string, salt: number): number {
  let hash = salt * 2654435761;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return ((hash >>> 0) % 1000) / 1000;
}

export function InboxScreen() {
  const game = useGame();
  const markRead = useGameStore((s) => s.markInboxRead);
  const lastReadEventId = useGameStore((s) => s.lastReadEventId);
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

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

  const wide = width > 820;
  const active = FILTERS.find((f) => f.key === filter)!;
  const shown =
    active.kinds.length === 0 ? news : news.filter((e) => active.kinds.includes(e.kind));

  const open = openId ? (news.find((e) => e.id === openId) ?? null) : null;

  return (
    <Room>
      {/* --------- Desk edge: what the tray holds, stated as figures --------- */}
      <View style={styles.topBar}>
        <Text style={styles.roomName}>POST ROOM</Text>
        <View style={styles.counts}>
          <Readout label="LETTERS" value={String(news.length)} size="sm" />
          <Readout
            label="UNREAD"
            value={String(unreadAtOpen.size)}
            size="sm"
            color={unreadAtOpen.size > 0 ? colors.accent : colors.textFaint}
          />
        </View>
      </View>

      <Deck style={!wide && { flexDirection: 'column' }}>
        {/* ------------------------- The tray ------------------------- */}
        <Panel title="IN TRAY" flex={wide ? 3 : 5} accent={colors.accent}>
          {/* Sorting slots along the front of the tray. */}
          <View style={styles.tabs}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                testID={`inbox-filter-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={[styles.tab, filter === f.key && styles.tabActive]}
              >
                <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {shown.length === 0 ? (
            <EmptyTray />
          ) : (
            <View style={styles.trayWell}>
              {/* The wire rails the paper rests on, seen through the gaps in the stack. */}
              <View style={styles.rail} />
              <View style={[styles.rail, { top: '38%' }]} />
              <View style={[styles.rail, { top: '64%' }]} />

              <ScrollView
                testID="inbox-stack"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.stack}
              >
                {shown.map((event, index) => (
                  <Letter
                    key={event.id}
                    event={event}
                    index={index}
                    unread={unreadAtOpen.has(event.id)}
                    open={openId === event.id}
                    onPress={() => setOpenId(openId === event.id ? null : event.id)}
                  />
                ))}
              </ScrollView>

              {/* Front lip of the tray, so the stack sits *in* something. */}
              <View style={styles.trayLip} />
            </View>
          )}
        </Panel>

        {/* ------------------- The desk beside the tray ------------------- */}
        <Panel title={open ? 'OPENED' : 'DESK'} flex={wide ? 2 : 4}>
          {open ? <OpenLetter event={open} onClose={() => setOpenId(null)} /> : <NoLetter />}
        </Panel>
      </Deck>
    </Room>
  );
}

/**
 * One letter in the stack.
 *
 * Negative margin is what makes this a stack rather than a list: each sheet overlaps
 * the one above it, so you see edges rather than rows. The open letter pulls clear of
 * its neighbours to show which one is in your hand.
 */
function Letter({
  event,
  index,
  unread,
  open,
  onPress,
}: {
  event: GameEvent;
  index: number;
  unread: boolean;
  open: boolean;
  onPress: () => void;
}) {
  const sender = senderFor(event.kind);
  const tilt = (jitter(event.id, 1) - 0.5) * (unread ? 2.4 : 1.4);
  const slide = (jitter(event.id, 2) - 0.5) * 10;

  return (
    <Pressable
      testID={`inbox-letter-${event.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.letter,
        index > 0 && { marginTop: -6 },
        {
          transform: [{ rotate: `${tilt.toFixed(2)}deg` }, { translateX: slide }],
          zIndex: open ? 999 : undefined,
        },
        unread ? styles.letterUnread : styles.letterRead,
        open && styles.letterOpen,
        pressed && { transform: [{ rotate: '0deg' }, { translateX: slide }, { scale: 0.99 }] },
      ]}
    >
      {/* Torn-open flap on read post; a whole sealed edge on unread. */}
      <View style={[styles.edge, { backgroundColor: unread ? sender.color : colors.border }]} />

      <View style={[styles.seal, unread && { backgroundColor: sender.color }]}>
        <Icon name={sender.icon} size={13} color={unread ? '#FFF6E8' : colors.textFaint} />
      </View>

      <View style={styles.letterText}>
        <View style={styles.letterHead}>
          <Text style={[styles.from, { color: unread ? sender.color : colors.textFaint }]}>
            {sender.from}
          </Text>
          <Text style={styles.stamp}>
            Y{event.year} W{String(event.week).padStart(2, '0')}
          </Text>
        </View>
        <Text
          style={[styles.subject, unread ? styles.subjectUnread : styles.subjectRead]}
          numberOfLines={2}
        >
          {event.headline}
        </Text>
      </View>

      {unread ? <View style={styles.flag} /> : null}
    </Pressable>
  );
}

/** The letter you picked up, flattened out on the desk and readable. */
function OpenLetter({ event, onClose }: { event: GameEvent; onClose: () => void }) {
  const sender = senderFor(event.kind);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.sheetHead}>
        <View style={[styles.sealBig, { backgroundColor: sender.color }]}>
          <Icon name={sender.icon} size={18} color="#FFF6E8" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.from, { color: sender.color }]}>{sender.from}</Text>
          <Text style={styles.stampBig}>
            Y{event.year} W{String(event.week).padStart(2, '0')}
          </Text>
        </View>
        <Pressable testID="inbox-letter-close" onPress={onClose} style={styles.putBack}>
          <Text style={styles.putBackText}>PUT BACK</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.sheet}>
        <Text style={styles.sheetSubject}>{event.headline}</Text>
        {event.body ? <Text style={styles.sheetBody}>{event.body}</Text> : null}
      </ScrollView>
    </View>
  );
}

/** Nothing in your hand — the bare desk, with the instruction and no prose around it. */
function NoLetter() {
  return (
    <View style={styles.blank}>
      <Icon name="envelope" size={30} color={colors.border} />
      <Text style={styles.blankLabel}>NO LETTER OPEN</Text>
      <Text style={styles.blankHint}>TAP THE STACK</Text>
    </View>
  );
}

/** An empty tray should look like an empty tray: bare rails and a floor. */
function EmptyTray() {
  return (
    <View testID="inbox-empty" style={[styles.trayWell, styles.trayEmpty]}>
      <View style={styles.rail} />
      <View style={[styles.rail, { top: '38%' }]} />
      <View style={[styles.rail, { top: '64%' }]} />
      <Icon name="envelope" size={34} color={colors.border} />
      <Text style={styles.blankLabel}>TRAY EMPTY</Text>
      <Text style={styles.blankHint}>0 LETTERS</Text>
    </View>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  roomName: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
  },
  counts: { flexDirection: 'row', gap: space.lg },

  tabs: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: space.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 5,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.borderBright,
  },
  tabText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8, color: colors.textFaint },
  tabTextActive: { color: colors.text },

  /** The well of the tray: darker than the panel, so paper sits inside it. */
  trayWell: {
    flex: 1,
    borderRadius: radius.sm,
    backgroundColor: '#D6CAB1',
    borderWidth: 1,
    borderColor: colors.borderBright,
    overflow: 'hidden',
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
  },
  trayEmpty: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '14%',
    height: 2,
    backgroundColor: colors.borderBright,
    opacity: 0.55,
  },
  trayLip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 7,
    pointerEvents: 'none',
    backgroundColor: colors.surfaceHigh,
    borderTopWidth: 1,
    borderTopColor: colors.borderBright,
  },

  stack: { paddingBottom: space.lg, paddingTop: 2 },

  letter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingRight: space.sm,
    paddingLeft: space.md,
    borderRadius: 3,
    borderWidth: 1,
    overflow: 'hidden',
  },
  /** Unread paper is bright and lifted; read paper has settled and gone grey. */
  letterUnread: {
    backgroundColor: '#FBF6EA',
    borderColor: colors.borderBright,
    boxShadow: '0px 3px 7px rgba(60,45,30,0.24)',
  },
  letterRead: {
    backgroundColor: '#E4DCCA',
    borderColor: colors.border,
    opacity: 0.72,
  },
  letterOpen: {
    borderColor: colors.accent,
    borderWidth: 2,
    opacity: 1,
    boxShadow: '0px 6px 14px rgba(60,45,30,0.3)',
  },

  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },

  seal: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  sealBig: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  letterText: { flex: 1 },
  letterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  from: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  stamp: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
  },
  stampBig: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },
  subject: { fontSize: 12, marginTop: 1, lineHeight: 15 },
  subjectUnread: { color: colors.text, fontWeight: '800' },
  subjectRead: { color: colors.textDim, fontWeight: '500' },

  /** The corner flag: the one mark that survives being half-buried in the stack. */
  flag: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    alignSelf: 'flex-start',
  },

  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  putBack: {
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.borderBright,
    backgroundColor: colors.surfaceHigh,
  },
  putBackText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textDim },

  sheet: { flex: 1, marginTop: space.sm },
  sheetSubject: { fontSize: 15, fontWeight: '800', color: colors.text, lineHeight: 20 },
  sheetBody: { fontSize: 13, color: colors.textDim, lineHeight: 19, marginTop: space.sm },

  blank: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  blankLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: colors.textDim },
  blankHint: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: colors.textFaint },
});
