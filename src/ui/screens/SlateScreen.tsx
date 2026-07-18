import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useGame } from '../../store/gameStore';
import { episodeCost } from '../../engine/economy';
import { episodesPerWeek } from '../../engine/schedule';
import {
  episodesToSyndication,
  latestViewers,
  libraryWorth,
  lifetimeProfit,
  playerArchive,
  playerShows,
  showOutcome,
} from '../../store/selectors';
import { Poster } from '../Poster';
import { Icon } from '../icons';
import { Room, Deck, Panel, Readout } from '../game/Room';
import { colors, deltaColor, formatMoneyShort, formatViewers, space } from '../theme';
import type { GameState, Production } from '../../engine/types';

/**
 * The shelf room.
 *
 * "My Shows" used to be a scrolling document of cards — you read your slate instead of
 * standing in front of it. It is now a fixed room: a summary bar you never scroll away
 * from, the running shows racked on a shelf, and the archive sitting underneath them.
 *
 * The archive is deliberately given real estate rather than a link. A show the player
 * bankrolled for six years should not vanish the week it is cancelled; how it ended is
 * the most consequential thing that ever happens to it, so it stays on the wall —
 * visibly finished, greyed out, with its lifetime number still legible.
 */
export function SlateScreen({
  onOpenShow,
  onMakeShow,
}: {
  onOpenShow: (id: string) => void;
  onMakeShow: () => void;
}) {
  const game = useGame();
  const { width } = useWindowDimensions();

  if (!game) return null;

  const wide = width > 820;
  const shows = playerShows(game);
  const archive = playerArchive(game);
  const airing = shows.filter((s) => s.status === 'airing');
  const slateNet = shows.reduce((sum, p) => sum + weeklyPnl(p), 0);

  // Cards are sized so two always fit on a phone; on a wide screen a fixed width keeps
  // the shelf reading as a rack of objects rather than stretching into table rows.
  const cardWidth = wide ? 156 : Math.floor((width - 2 * space.sm - 2 * space.md - space.sm) / 2);

  const shelf = (
    <Panel title={`ON THE SHELF · ${shows.length}`} flex={wide ? 3 : undefined} style={{ flex: 1 }}>
      {shows.length === 0 ? (
        <EmptyShelf onMakeShow={onMakeShow} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.rack}>
            {shows.map((production) => (
              <ShowCard
                key={production.id}
                game={game}
                production={production}
                width={cardWidth}
                onPress={() => onOpenShow(production.id)}
              />
            ))}

            <Pressable
              testID="slate-new-show"
              onPress={onMakeShow}
              style={({ pressed }) => [
                styles.newCard,
                { width: cardWidth },
                pressed && { transform: [{ scale: 0.97 }] },
              ]}
            >
              <Icon name="plus" size={22} color={colors.accent} />
              <Text style={styles.newLabel}>NEW SHOW</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </Panel>
  );

  const vault = (
    <Panel
      title={`ARCHIVE · ${archive.length}`}
      flex={wide ? 2 : undefined}
      style={{ flex: 1 }}
      accent={colors.textFaint}
    >
      {archive.length === 0 ? (
        <View style={styles.emptyArchive}>
          <Icon name="reel" size={20} color={colors.textFaint} opacity={0.5} />
          <Text style={styles.emptyArchiveLabel}>NOTHING FINISHED YET</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ gap: 6 }}>
            {archive.map((production) => (
              <ArchiveRow
                key={production.id}
                production={production}
                onPress={() => onOpenShow(production.id)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </Panel>
  );

  return (
    <Room>
      {/* -------- Summary bar: the three numbers the slate is judged on -------- */}
      <View style={styles.topBar}>
        <View style={styles.topTitle}>
          <Icon name="shelf" size={16} color={colors.accent} />
          <Text style={styles.roomName}>MY SHOWS</Text>
        </View>

        <View style={styles.gauges}>
          <Readout label="ON AIR" value={String(airing.length)} size="sm" />
          <Readout
            label={slateNet >= 0 ? 'PROFIT / WK' : 'LOSS / WK'}
            value={formatMoneyShort(Math.abs(slateNet))}
            size="sm"
            color={deltaColor(slateNet)}
          />
          <Readout label="LIBRARY" value={formatMoneyShort(libraryWorth(game))} size="sm" />
        </View>
      </View>

      {wide ? (
        <Deck flex={1}>
          {shelf}
          {vault}
        </Deck>
      ) : (
        <>
          <Deck flex={3}>{shelf}</Deck>
          <Deck flex={2}>{vault}</Deck>
        </>
      )}
    </Room>
  );
}

/**
 * What this show does to the bank balance each week.
 *
 * A show with no channel still costs nothing until it airs, so only airing shows move
 * money — otherwise a slate full of finished-but-unsold pilots would read as a
 * catastrophic weekly loss the player cannot act on.
 */
function weeklyPnl(production: Production): number {
  if (production.status !== 'airing') return 0;
  const perWeek = episodesPerWeek(production.format);
  const fee = production.deal?.licenseFeePerEpisode ?? 0;
  return (fee - episodeCost(production)) * perWeek;
}

/** A running show as a physical card: art on top, money underneath. */
function ShowCard({
  game,
  production,
  width,
  onPress,
}: {
  game: GameState;
  production: Production;
  width: number;
  onPress: () => void;
}) {
  const viewers = latestViewers(production);
  const live = production.status === 'airing';
  const cost = episodeCost(production);
  const fee = production.deal?.licenseFeePerEpisode ?? 0;
  const net = weeklyPnl(production);
  const toSyndication = episodesToSyndication(production);
  const network = production.deal ? game.companies[production.deal.networkId] : undefined;

  const status = live
    ? `S${production.season} · EP ${production.episodesAiredThisSeason}/${production.episodesPerSeason}`
    : production.status === 'development'
      ? `IN ${production.developmentWeeksRemaining ?? 0}W`
      : production.deal
        ? 'BETWEEN SERIES'
        : 'NO CHANNEL';

  return (
    <Pressable
      testID={`slate-show-${production.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <Poster
        seed={production.id}
        format={production.format}
        live={live}
        size="md"
        style={{ width: '100%', height: 104 }}
      />

      <View style={styles.cardFoot}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {production.title}
        </Text>
        <Text style={styles.cardChannel} numberOfLines={1}>
          {network ? network.name.toUpperCase() : status}
        </Text>

        <View style={styles.viewerRow}>
          <Text style={styles.cardViewers}>
            {viewers !== undefined ? formatViewers(viewers) : '—'}
          </Text>
          <Text style={styles.cardStatus} numberOfLines={1}>
            {status}
          </Text>
        </View>

        {/* Cost in, fee out, and the difference — the whole argument for a show. */}
        <View style={styles.economics}>
          <EconLine label="COST" value={formatMoneyShort(cost)} color={colors.textDim} />
          <EconLine label="FEE" value={fee > 0 ? formatMoneyShort(fee) : '—'} color={colors.textDim} />
          <EconLine
            label={net >= 0 ? 'PROFIT/WK' : 'LOSS/WK'}
            value={formatMoneyShort(Math.abs(net))}
            color={net > 0 ? colors.positive : net < 0 ? colors.negative : colors.textDim}
          />
        </View>

        {production.syndicated ? (
          <Text style={[styles.tail, { color: colors.positive }]}>REPEATS EARNING</Text>
        ) : toSyndication > 0 && production.totalEpisodes > 0 ? (
          <Text style={styles.tail}>{toSyndication} EPS TO REPEATS</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function EconLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.econRow}>
      <Text style={styles.econLabel}>{label}</Text>
      <Text style={[styles.econValue, { color }]}>{value}</Text>
    </View>
  );
}

/**
 * A finished show, and it should look finished.
 *
 * The dimmed poster and the flat grey title do the work a "cancelled" label cannot:
 * you can tell at a glance which half of your track record is still alive.
 */
function ArchiveRow({
  production,
  onPress,
}: {
  production: Production;
  onPress: () => void;
}) {
  const outcome = showOutcome(production);
  const profit = lifetimeProfit(production);

  return (
    <Pressable
      testID={`slate-archive-${production.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.archiveRow, pressed && { opacity: 0.7 }]}
    >
      <Poster
        seed={production.id}
        format={production.format}
        size="sm"
        style={{ opacity: 0.42 }}
      />

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.archiveTitle} numberOfLines={1}>
          {production.title}
        </Text>
        <Text style={styles.archiveDetail} numberOfLines={1}>
          {outcome.detail}
        </Text>
      </View>

      <View style={styles.archiveRight}>
        <Text style={[styles.archiveVerdict, { color: verdictColor(outcome.verdict) }]}>
          {outcome.headline.toUpperCase()}
        </Text>
        <Text style={[styles.archiveProfit, { color: deltaColor(profit) }]}>
          {formatMoneyShort(profit)}
        </Text>
      </View>
    </Pressable>
  );
}

function verdictColor(verdict: string): string {
  if (verdict === 'hit') return colors.positive;
  if (verdict === 'stranded') return colors.negative;
  if (verdict === 'solid') return colors.accent;
  return colors.textDim;
}

/**
 * An empty slate is not a blank panel — it is the worst position in the game.
 *
 * Overheads keep running whether or not anything is in production, so the empty state
 * says what it is costing and hands over the one action that fixes it.
 */
function EmptyShelf({ onMakeShow }: { onMakeShow: () => void }) {
  return (
    <View style={styles.empty}>
      <Icon name="clapper" size={30} color={colors.textFaint} opacity={0.6} />
      <Text style={styles.emptyHead}>NO SHOWS</Text>
      <Text style={styles.emptyLine}>0 ON AIR · $0 IN · OVERHEADS OUT</Text>

      <Pressable
        testID="slate-empty-new-show"
        onPress={onMakeShow}
        style={({ pressed }) => [styles.emptyButton, pressed && { transform: [{ scale: 0.97 }] }]}
      >
        <Icon name="plus" size={14} color={colors.surface} />
        <Text style={styles.emptyButtonLabel}>MAKE A SHOW</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    gap: space.md,
  },
  topTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roomName: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
  },
  gauges: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },

  rack: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'flex-start' },

  card: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardFoot: { padding: 6 },
  cardTitle: { fontSize: 11, fontWeight: '800', color: colors.text },
  cardChannel: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginTop: 1,
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 4,
    marginTop: 2,
  },
  cardViewers: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },
  cardStatus: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.textFaint,
    flexShrink: 1,
    textAlign: 'right',
  },

  economics: {
    marginTop: 5,
    gap: 1,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  econRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  econLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 0.8, color: colors.textFaint },
  econValue: { fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },

  tail: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.textFaint,
    marginTop: 3,
  },

  newCard: {
    height: 200,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  newLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.accent },

  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 5,
    paddingHorizontal: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.035)',
  },
  archiveTitle: { fontSize: 12, fontWeight: '700', color: colors.textDim },
  archiveDetail: {
    fontSize: 9,
    color: colors.textFaint,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  archiveRight: { alignItems: 'flex-end', gap: 1 },
  archiveVerdict: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  archiveProfit: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyHead: { fontSize: 13, fontWeight: '900', letterSpacing: 1.6, color: colors.textDim },
  emptyLine: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  emptyButtonLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: colors.surface,
  },

  emptyArchive: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyArchiveLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.textFaint,
  },
});
