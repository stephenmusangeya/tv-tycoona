import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import {
  companiesByType,
  latestViewers,
  playerShows,
  playerStudio,
  ratingsBoard,
} from '../../store/selectors';
import { acquireNetwork, launchStreamer } from '../../engine/actions';
import { ECONOMY } from '../../engine/economy';
import { Poster } from '../Poster';
import { Icon, type IconName } from '../icons';
import { CountUp, WeekSweep } from '../motion';
import { Room, Deck, Panel, Readout } from '../game/Room';
import {
  colors,
  formatMoneyShort,
  formatViewers,
  scoreColor,
  space,
} from '../theme';
import type { Company, GameState } from '../../engine/types';

/**
 * The countdown.
 *
 * Industry used to be three tabs of cards you scrolled — a document about the
 * industry rather than a place in it. It is now the room where the chart is read
 * out: the week's ratings arrive the way a chart show delivers them, lowest placed
 * first, each figure rolling up, building to number one. Waiting is the point. A
 * table that simply appears tells you where you came; a countdown makes you feel it.
 *
 * The rivals rack and the empire ladder sit alongside because the chart only means
 * something relative to who beat you and what rung you are trying to reach.
 *
 * Panels scroll internally; the room itself never moves.
 */

/** Twelve is a chart — long enough to climb, short enough to sit still on screen. */
const CHART_SIZE = 12;
/** Slow enough that each placing lands, fast enough that a week is not a wait. */
const REVEAL_MS = 240;

type RivalTab = Company['type'];

const TAB_ICON: Record<RivalTab, IconName> = {
  network: 'broadcast',
  streamer: 'television',
  studio: 'reel',
};

export function IndustryScreen() {
  const game = useGame();
  const run = useAction();
  const { width } = useWindowDimensions();

  const [tab, setTab] = useState<RivalTab>('network');

  // The reveal is keyed on a run counter rather than the week directly, so the manual
  // replay button and a fresh week both restart it through exactly one code path.
  const [runId, setRunId] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const shown = useRef(0);

  const week = game?.absoluteWeek ?? 0;
  useEffect(() => {
    // Depends only on the week number, so a re-render for any other reason (a rival
    // filter, a purchase) never restarts a countdown that is already playing.
    setRunId((n) => n + 1);
  }, [week]);

  const board = useMemo(() => (game ? ratingsBoard(game, CHART_SIZE) : []), [game]);
  const count = board.length;

  useEffect(() => {
    shown.current = 0;
    setRevealed(0);
    if (count === 0) return;

    const id = setInterval(() => {
      if (shown.current >= count) {
        clearInterval(id);
        return;
      }
      shown.current += 1;
      setRevealed(shown.current);
    }, REVEAL_MS);

    return () => clearInterval(id);
  }, [runId, count]);

  if (!game) return null;

  const wide = width > 820;
  const studio = playerStudio(game);
  const mine = new Set(
    [game.player.studioId, game.player.networkId, game.player.streamerId].filter(Boolean),
  );

  const playing = revealed < count;
  const best = board.findIndex((entry) => mine.has(entry.production.ownerId));
  const onAir = playerShows(game).filter((p) => p.status === 'airing').length;

  const chart = (
    <Panel title="THE CHART" flex={1} accent={colors.accent}>
      <View style={styles.chartHead}>
        <Readout
          label="WEEK"
          value={`Y${game.year} W${game.week}`}
          size="sm"
        />
        <Readout
          label="YOUR BEST"
          value={best >= 0 ? `#${best + 1}` : '—'}
          size="sm"
          color={best >= 0 ? colors.accent : colors.textFaint}
        />
        <Readout label="ON AIR" value={String(onAir)} size="sm" />

        <View style={styles.chartButtons}>
          <ChartButton
            testID="chart-skip"
            icon="star"
            label="SKIP"
            disabled={!playing || count === 0}
            onPress={() => {
              shown.current = count;
              setRevealed(count);
            }}
          />
          <ChartButton
            testID="chart-replay"
            icon="reel"
            label="REPLAY"
            disabled={count === 0}
            onPress={() => setRunId((n) => n + 1)}
          />
        </View>
      </View>

      {count === 0 ? (
        <NothingAired />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.chartList}>
          {board.map((entry, index) => {
            // The countdown fills from the bottom: the last rows are on screen first
            // and number one lands last, which is the whole reason to watch it.
            const isOut = index >= count - revealed;
            const rank = index + 1;

            if (!isOut) return <ChartSlot key={entry.production.id} rank={rank} />;

            return (
              <ChartRow
                key={`${runId}-${entry.production.id}`}
                rank={rank}
                title={entry.production.title}
                format={entry.production.format}
                seed={entry.production.id}
                channel={entry.network?.name ?? entry.owner?.name ?? 'UNSOLD'}
                viewers={entry.viewers}
                yours={mine.has(entry.production.ownerId)}
              />
            );
          })}
        </ScrollView>
      )}
    </Panel>
  );

  const rivals = (
    <Panel title="RIVALS" flex={1}>
      <View style={styles.tabs}>
        {(['network', 'streamer', 'studio'] as RivalTab[]).map((key) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              testID={`rivals-tab-${key}`}
              onPress={() => setTab(key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Icon
                name={TAB_ICON[key]}
                size={13}
                color={active ? colors.accent : colors.textFaint}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {key.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.rivalList}>
        {companiesByType(game, tab).map((company) => (
          <RivalRow key={company.id} game={game} company={company} />
        ))}
      </ScrollView>
    </Panel>
  );

  const worth = (studio?.cash ?? 0) - (studio?.debt ?? 0);
  const standing = studio?.popularStanding ?? 0;

  const ladder = (
    <Deck flex={wide ? 2 : 3} style={!wide ? { flexDirection: 'column' } : undefined}>
      <Rung
        icon="reel"
        label="STUDIO"
        held
        figures={[
          ['WORTH', formatMoneyShort(worth), worth >= 0 ? colors.text : colors.negative],
          ['RANK', empireRank(game), colors.accent],
          ['FAME', String(Math.round(standing)), scoreColor(standing)],
        ]}
      />

      <Rung
        icon="broadcast"
        label="NETWORK"
        held={Boolean(game.player.networkId)}
        figures={
          game.player.networkId
            ? [
                ['NAME', game.companies[game.player.networkId]?.name ?? '—', colors.text],
                [
                  'REACH',
                  `${Math.round((game.companies[game.player.networkId]?.reach ?? 0) * 100)}%`,
                  colors.accent,
                ],
              ]
            : [
                ['COST', formatMoneyShort(ECONOMY.acquisitionCost.network), colors.text],
                [
                  'FAME',
                  `${Math.round(standing)}/${ECONOMY.acquisitionStandingRequired.network}`,
                  standing >= ECONOMY.acquisitionStandingRequired.network
                    ? colors.positive
                    : colors.negative,
                ],
              ]
        }
        actions={
          game.player.networkId
            ? null
            : companiesByType(game, 'network')
                .slice(0, 3)
                .map((network) => ({
                  testID: `empire-acquire-${network.id}`,
                  label: `BUY ${network.name.toUpperCase()}`,
                  onPress: () => run((g) => acquireNetwork(g, network.id)),
                }))
        }
      />

      <Rung
        icon="television"
        label="STREAMER"
        held={Boolean(game.player.streamerId)}
        figures={
          game.player.streamerId
            ? [
                [
                  'SUBS',
                  `${(game.companies[game.player.streamerId]?.subscribers ?? 0).toFixed(1)}M`,
                  colors.accent,
                ],
                [
                  'PRICE',
                  formatMoneyShort(game.companies[game.player.streamerId]?.monthlyPrice ?? 0),
                  colors.text,
                ],
              ]
            : [
                ['COST', formatMoneyShort(ECONOMY.acquisitionCost.streamer), colors.text],
                [
                  'FAME',
                  `${Math.round(standing)}/${ECONOMY.acquisitionStandingRequired.streamer}`,
                  standing >= ECONOMY.acquisitionStandingRequired.streamer
                    ? colors.positive
                    : colors.negative,
                ],
              ]
        }
        actions={
          game.player.streamerId
            ? null
            : [
                {
                  testID: 'empire-launch-streamer',
                  label: 'LAUNCH SERVICE',
                  onPress: () => run((g) => launchStreamer(g, `${studio?.name ?? 'My'}+`)),
                },
              ]
        }
      />
    </Deck>
  );

  return (
    <Room>
      {wide ? (
        <>
          <Deck flex={7}>
            <View style={{ flex: 3 }}>{chart}</View>
            <View style={{ flex: 2 }}>{rivals}</View>
          </Deck>
          {ladder}
        </>
      ) : (
        <>
          <Deck flex={6}>{chart}</Deck>
          <Deck flex={4}>{rivals}</Deck>
          {ladder}
        </>
      )}

      <WeekSweep trigger={game.absoluteWeek} />
    </Room>
  );
}

/**
 * A placing that has not been read out yet.
 *
 * Rendering the empty slot rather than nothing is what makes it a countdown: you can
 * see how far there is left to climb, and the gap above is visibly reserved for a
 * number that has not been announced.
 */
function ChartSlot({ rank }: { rank: number }) {
  return (
    <View style={styles.slot}>
      <Text style={styles.slotRank}>{rank}</Text>
      <View style={styles.slotBar} />
    </View>
  );
}

/** A placing, announced. */
function ChartRow({
  rank,
  title,
  format,
  seed,
  channel,
  viewers,
  yours,
}: {
  rank: number;
  title: string;
  format: React.ComponentProps<typeof Poster>['format'];
  seed: string;
  channel: string;
  viewers: number;
  yours: boolean;
}) {
  return (
    <View style={[styles.row, yours && styles.rowMine, rank === 1 && styles.rowTop]}>
      <Text style={[styles.rank, rank === 1 && styles.rankTop, yours && { color: colors.accent }]}>
        {rank}
      </Text>

      <Poster seed={seed} format={format} size="sm" />

      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          {yours ? <Icon name="star" size={11} color={colors.accent} /> : null}
          <Text
            style={[styles.rowTitle, yours && { color: colors.accent }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {channel.toUpperCase()}
        </Text>
      </View>

      <RollUp value={viewers} yours={yours} />
    </View>
  );
}

/**
 * The figure, rolling up from zero.
 *
 * CountUp only animates when its value changes, so the row mounts at zero and moves
 * to the real number on the next frame — the placing arrives, then the number climbs
 * to meet it.
 */
function RollUp({ value, yours }: { value: number; yours: boolean }) {
  const [target, setTarget] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setTarget(value), 16);
    return () => clearTimeout(id);
  }, [value]);

  return (
    <CountUp
      value={target}
      format={formatViewers}
      duration={700}
      style={[styles.viewers, yours && { color: colors.accent }]}
    />
  );
}

/** Week one: the chart exists but has nothing in it yet. */
function NothingAired() {
  return (
    <View style={styles.empty}>
      <Icon name="broadcast" size={34} color={colors.textFaint} />
      <Text style={styles.emptyTitle}>NO BROADCASTS</Text>
      <Text style={styles.emptyBody}>Commission a show, sell it, wait for air.</Text>
    </View>
  );
}

function ChartButton({
  testID,
  icon,
  label,
  onPress,
  disabled,
}: {
  testID: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chartButton,
        disabled && { opacity: 0.35 },
        pressed && { transform: [{ scale: 0.95 }] },
      ]}
    >
      <Icon name={icon} size={12} color={colors.accent} />
      <Text style={styles.chartButtonText}>{label}</Text>
    </Pressable>
  );
}

/** A rival, and the one thing about them that matters: what they have on air. */
function RivalRow({ game, company }: { game: GameState; company: Company }) {
  const top = useMemo(() => {
    let bestShow: { title: string; viewers: number } | undefined;
    for (const production of Object.values(game.productions)) {
      if (production.ownerId !== company.id) continue;
      if (production.status !== 'airing') continue;
      const viewers = latestViewers(production) ?? 0;
      if (!bestShow || viewers > bestShow.viewers) {
        bestShow = { title: production.title, viewers };
      }
    }
    return bestShow;
  }, [game.productions, company.id]);

  const worth = company.cash - company.debt;
  const scale =
    company.type === 'network'
      ? `${Math.round((company.reach ?? 0) * 100)}%`
      : company.type === 'streamer'
        ? `${(company.subscribers ?? 0).toFixed(1)}M`
        : `${Math.round(company.criticalStanding)}`;

  return (
    <View style={[styles.rival, company.isPlayer && styles.rivalMine]}>
      <View style={styles.rivalHead}>
        <Text
          style={[styles.rivalName, company.isPlayer && { color: colors.accent }]}
          numberOfLines={1}
        >
          {company.name}
        </Text>
        <Text style={[styles.rivalWorth, { color: worth >= 0 ? colors.text : colors.negative }]}>
          {formatMoneyShort(worth)}
        </Text>
      </View>

      <View style={styles.rivalFigures}>
        <Text style={styles.rivalShow} numberOfLines={1}>
          {top ? top.title : 'DARK'}
        </Text>
        <Text style={styles.rivalNumber}>{top ? formatViewers(top.viewers) : '—'}</Text>
        <Text style={[styles.rivalNumber, { color: scoreColor(company.popularStanding) }]}>
          {Math.round(company.popularStanding)}
        </Text>
        <Text style={[styles.rivalNumber, { color: colors.textDim }]}>{scale}</Text>
      </View>
    </View>
  );
}

/** One rung of the ladder: held, or priced. */
function Rung({
  icon,
  label,
  held,
  figures,
  actions,
}: {
  icon: IconName;
  label: string;
  held: boolean;
  figures: [string, string, string][];
  actions?: { testID: string; label: string; onPress: () => void }[] | null;
}) {
  return (
    <Panel flex={1} accent={held ? colors.positive : colors.border}>
      <View style={styles.rungHead}>
        <Icon name={icon} size={14} color={held ? colors.accent : colors.textFaint} />
        <Text style={[styles.rungLabel, held && { color: colors.text }]}>{label}</Text>
        <Text style={[styles.rungState, held && { color: colors.positive }]}>
          {held ? 'HELD' : 'LOCKED'}
        </Text>
      </View>

      <View style={styles.rungFigures}>
        {figures.map(([figureLabel, value, color]) => (
          <Readout key={figureLabel} label={figureLabel} value={value} size="sm" color={color} />
        ))}
      </View>

      {actions && actions.length > 0 ? (
        <ScrollView showsVerticalScrollIndicator={false} style={styles.rungActions}>
          {actions.map((action) => (
            <Pressable
              key={action.testID}
              testID={action.testID}
              onPress={action.onPress}
              style={({ pressed }) => [styles.buy, pressed && { opacity: 0.7 }]}
            >
              <Icon name="key" size={11} color={colors.accent} />
              <Text style={styles.buyText} numberOfLines={1}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </Panel>
  );
}

/** Where the player sits on net worth against every company in the world. */
function empireRank(game: GameState): string {
  const all = Object.values(game.companies).sort(
    (a, b) => b.cash - b.debt - (a.cash - a.debt),
  );
  const index = all.findIndex((c) => c.id === game.player.studioId);
  return index < 0 ? '—' : `${index + 1}/${all.length}`;
}

const styles = StyleSheet.create({
  chartHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.sm,
    marginBottom: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chartButtons: { flexDirection: 'row', gap: space.xs, marginLeft: 'auto' },
  chartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chartButtonText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.accent,
  },

  chartList: { gap: 3, paddingBottom: space.xs },

  slot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 34, opacity: 0.4 },
  slotRank: {
    width: 22,
    fontSize: 12,
    fontWeight: '900',
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  slotBar: { flex: 1, height: 2, borderRadius: 1, backgroundColor: colors.border },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 3,
    paddingRight: space.sm,
    borderRadius: 8,
  },
  rowMine: { backgroundColor: colors.accentSoft },
  rowTop: { borderWidth: 1, borderColor: colors.accent },
  rank: {
    width: 22,
    fontSize: 15,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  rankTop: { fontSize: 20, color: colors.accent },
  rowText: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowTitle: { flexShrink: 1, fontSize: 12, fontWeight: '800', color: colors.text },
  rowMeta: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginTop: 1,
  },
  viewers: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: colors.textDim },
  emptyBody: { fontSize: 10, color: colors.textFaint },

  tabs: { flexDirection: 'row', gap: 3, marginBottom: space.sm },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tabText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textFaint },
  tabTextActive: { color: colors.accent },

  rivalList: { gap: 2, paddingBottom: space.xs },
  rival: {
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rivalMine: { backgroundColor: colors.accentSoft, borderBottomColor: colors.accent },
  rivalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  rivalName: { flex: 1, fontSize: 12, fontWeight: '800', color: colors.text },
  rivalWorth: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rivalFigures: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 1 },
  rivalShow: { flex: 1, fontSize: 9, color: colors.textFaint, fontWeight: '700' },
  rivalNumber: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    minWidth: 30,
    textAlign: 'right',
  },

  rungHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rungLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.textDim,
  },
  rungState: {
    marginLeft: 'auto',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.textFaint,
  },
  rungFigures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.sm,
  },
  rungActions: { marginTop: space.sm },
  buy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    marginBottom: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  buyText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.8, color: colors.accent },
});
