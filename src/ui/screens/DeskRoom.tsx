import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useGame, useGameStore } from '../../store/gameStore';
import { episodeCost, episodeDeficit } from '../../engine/economy';
import {
  latestBreakdown,
  latestViewers,
  libraryWorth,
  moneyBreakdown,
  nowAiring,
  playerShows,
  playerStudio,
  rerunIncome,
  totalCash,
  totalDebt,
  weeklyNet,
} from '../../store/selectors';
import { TVScreen } from '../TVScreen';
import { Poster } from '../Poster';
import { CountUp, WeekSweep } from '../motion';
import type { ResultLine } from '../TVScreen';
import { DecisionDeck } from '../DecisionDeck';
import { Room, Deck, Panel, Readout } from '../game/Room';
import { Plus } from '../icons';
import { PlayButton } from '../game/PlayButton';
import { colors, deltaColor, formatMoneyShort, scoreColor, space } from '../theme';
import type { Production } from '../../engine/types';

/**
 * The control room.
 *
 * The desk rebuilt as a place rather than a page: a fixed viewport that never scrolls
 * as a whole, laid out like equipment on a console. The set is the centrepiece, the
 * ledger is bolted to the right, your shows sit on a shelf beneath, and time is
 * advanced by turning a dial.
 *
 * Panels scroll internally when they must; the room itself is still.
 */
export function DeskRoom({
  onOpenShow,
  onMakeShow,
}: {
  onOpenShow: (id: string) => void;
  onMakeShow: () => void;
}) {
  const game = useGame();
  const advance = useGameStore((s) => s.advance);
  const advancing = useGameStore((s) => s.advancing);
  const lastWeek = useGameStore((s) => s.lastWeek);
  const { width } = useWindowDimensions();
  const seenWeek = useGameStore((s) => s.resultsSeenWeek);
  const dismissResults = useGameStore((s) => s.dismissResults);

  if (!game) return null;

  const wide = width > 820;
  const studio = playerStudio(game);
  const shows = playerShows(game);
  const airing = nowAiring(game);
  const headline = airing[0];
  const money = moneyBreakdown(game);
  const net = weeklyNet(game);
  const cash = totalCash(game);

  const mine = new Set(shows.map((s) => s.id));
  const airedLines: ResultLine[] =
    lastWeek?.airedThisWeek
      .filter((e) => mine.has(e.productionId))
      .map((e) => {
        const production = game.productions[e.productionId];
        return {
          productionId: e.productionId,
          title: e.title,
          viewers: e.viewers,
          viewersBySegment: e.viewersBySegment,
          previous: production?.history.at(-1)?.averageViewers,
        };
      })
      .sort((a, b) => b.viewers - a.viewers) ?? [];

  const showResults =
    lastWeek !== null && airedLines.length > 0 && seenWeek !== game.absoluteWeek;

  return (
    <Room>
      {/* ---------------- Title bar: identity left, time control right ------------- */}
      <View style={[styles.topBar, !wide && { justifyContent: 'flex-end' }]}>
        {/* On a phone the studio name is already in the status bar above, so printing
            it again here just spent a line of a short screen saying it twice. */}
        {wide ? (
          <Text style={styles.studioName} numberOfLines={1}>
            {studio?.name ?? 'STUDIO'}
          </Text>
        ) : null}
        <PlayButton
          year={game.year}
          week={game.week}
          busy={advancing}
          onAdvance={() => advance(1)}
          onSkip={() => advance(4)}
        />
      </View>

      {/* ---------------- Upper deck: the set + the ledger ---------------- */}
      <Deck flex={wide ? 3 : 4} style={!wide && { flexDirection: 'column' }}>
        <View style={{ flex: wide ? 3 : 1 }}>
          <TVScreen
            airing={headline}
            viewers={headline ? latestViewers(headline) : undefined}
            breakdown={headline ? latestBreakdown(headline) : undefined}
            year={game.year}
            week={game.week}
            channelLabel={(studio?.name ?? 'STUDIO').toUpperCase()}
            results={showResults ? airedLines : undefined}
            onResultsDone={() => dismissResults(game.absoluteWeek)}
          />
        </View>

        {wide ? (
          <Panel title="THE LEDGER" flex={2}>
            <CountUp
              value={cash}
              format={formatMoneyShort}
              style={[styles.cash, { color: cash > 0 ? colors.text : colors.negative }]}
            />

            <View style={styles.ledgerLines}>
              {money.map((line) => (
                <View key={line.label} style={styles.ledgerRow}>
                  <Text style={styles.ledgerLabel} numberOfLines={1}>
                    {line.label}
                  </Text>
                  <Text style={[styles.ledgerValue, { color: deltaColor(line.amount) }]}>
                    {line.amount >= 0 ? '+' : '−'}
                    {formatMoneyShort(Math.abs(line.amount))}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.netRow}>
              <Text style={styles.netLabel}>{net >= 0 ? 'PROFIT / WK' : 'LOSS / WK'}</Text>
              <Text style={[styles.netValue, { color: deltaColor(net) }]}>
                {net >= 0 ? '+' : '−'}
                {formatMoneyShort(Math.abs(net))}
              </Text>
            </View>

            {/* The ledger used to run its figures at the top, pin its gauges to the
                bottom, and leave a large hole between them. Runway fills it with the
                one number a studio losing money actually needs: how long it has. */}
            <Runway cash={cash} net={net} debt={totalDebt(game)} />

            <View style={styles.gauges}>
              <Readout label="LIBRARY" value={formatMoneyShort(libraryWorth(game))} size="sm" />
              <Readout
                label="REPEATS"
                value={`${formatMoneyShort(rerunIncome(game))}/wk`}
                size="sm"
                color={rerunIncome(game) > 0 ? colors.positive : undefined}
              />
              <Readout
                label="CRITICS"
                value={String(Math.round(studio?.criticalStanding ?? 0))}
                size="sm"
                color={scoreColor(studio?.criticalStanding ?? 0)}
              />
              <Readout
                label="FAME"
                value={String(Math.round(studio?.popularStanding ?? 0))}
                size="sm"
                color={scoreColor(studio?.popularStanding ?? 0)}
              />
            </View>
          </Panel>
        ) : null}
      </Deck>

      {/* ---------------- Lower deck: shelf, decisions, dial ---------------- */}
      {/* Side by side is right on a desk; on a phone it gave the in-tray about 180px
          and the decision cards inside it wrapped one letter per line. Below the wide
          breakpoint the two panels stack and each gets the full width. */}
      <Deck flex={wide ? 2 : 3} style={!wide && { flexDirection: 'column' }}>
        <Panel title="YOUR SHOWS" flex={5}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.shelf}>
              {shows.map((production) => (
                <ShowCard
                  key={production.id}
                  production={production}
                  onPress={() => onOpenShow(production.id)}
                />
              ))}

              <Pressable testID="new-show-tile" onPress={onMakeShow} style={styles.newCard}>
                <Plus size={20} color={colors.accent} />
                <Text style={styles.newLabel} numberOfLines={1}>
                  NEW SHOW
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Panel>

        <Panel title="IN TRAY" flex={4} accent={colors.accent}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <DecisionDeck onOpenShow={onOpenShow} />
          </ScrollView>
        </Panel>

      </Deck>

      <WeekSweep trigger={game.absoluteWeek} />
    </Room>
  );
}

/**
 * How many weeks the studio can survive at its current burn.
 *
 * A weekly loss is abstract; "9 WEEKS LEFT" is not. When the studio is profitable the
 * same space carries the debt position instead, so the block is never dead weight.
 */
function Runway({ cash, net, debt }: { cash: number; net: number; debt: number }) {
  const losing = net < 0;
  // Twenty-six weeks — half a broadcast year — is the point past which the runway
  // stops being the thing you worry about, so that is where the bar tops out.
  const weeks = losing ? Math.max(0, Math.floor(cash / Math.abs(net))) : Infinity;
  const fill = losing ? Math.min(1, weeks / 26) : 1;
  const bad = losing && weeks <= 8;

  return (
    <View style={styles.runway}>
      <View style={styles.runwayHead}>
        <Text style={styles.runwayLabel}>{losing ? 'RUNWAY' : 'POSITION'}</Text>
        <Text
          style={[
            styles.runwayValue,
            { color: bad ? colors.negative : losing ? colors.text : colors.positive },
          ]}
        >
          {losing
            ? weeks >= 26
              ? '26+ WEEKS'
              : `${weeks} WEEK${weeks === 1 ? '' : 'S'}`
            : 'PROFITABLE'}
        </Text>
      </View>

      <View style={styles.runwayTrack}>
        <View
          style={[
            styles.runwayFill,
            {
              width: `${fill * 100}%`,
              backgroundColor: bad ? colors.negative : losing ? colors.warning : colors.positive,
            },
          ]}
        />
      </View>

      <View style={styles.runwayFoot}>
        <Text style={styles.runwayFootLabel}>DEBT</Text>
        <Text
          style={[
            styles.runwayFootValue,
            { color: debt > 0 ? colors.negative : colors.textDim },
          ]}
        >
          {debt > 0 ? formatMoneyShort(debt) : 'NONE'}
        </Text>
      </View>
    </View>
  );
}

/** A show as a physical card on the shelf. */
function ShowCard({
  production,
  onPress,
}: {
  production: Production;
  onPress: () => void;
}) {
  const viewers = latestViewers(production);
  const live = production.status === 'airing';
  const cost = episodeCost(production);
  const fee = production.deal?.licenseFeePerEpisode ?? 0;
  const perEpisode = production.deal ? -episodeDeficit(production) : -cost;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <Poster
        seed={production.id}
        format={production.format}
        live={live}
        size="md"
        style={{ width: '100%', height: 116 }}
      />
      <View style={styles.cardFoot}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {production.title}
        </Text>
        <Text style={styles.cardViewers}>
          {viewers !== undefined ? `${viewers.toFixed(1)}M` : '—'}
        </Text>

        {/* Cost, fee and the difference — the three figures the player asked for. */}
        <View style={styles.economics}>
          <EconLine label="COST" value={formatMoneyShort(cost)} color={colors.textDim} />
          <EconLine
            label="FEE"
            value={fee > 0 ? formatMoneyShort(fee) : '—'}
            color={colors.textDim}
          />
          <EconLine
            label={perEpisode >= 0 ? 'PROFIT' : 'LOSS'}
            value={formatMoneyShort(Math.abs(perEpisode))}
            color={perEpisode >= 0 ? colors.positive : colors.negative}
          />
        </View>
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

const styles = StyleSheet.create({
  cash: {
    fontSize: 28,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.6,
  },

  ledgerLines: { marginTop: space.sm, gap: 3 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  ledgerLabel: { fontSize: 11, color: colors.textDim, flex: 1 },
  ledgerValue: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },

  netRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  netLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: colors.textDim },
  netValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },

  runway: { marginTop: space.md, gap: 5 },
  runwayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runwayLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: colors.textDim },
  runwayValue: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  runwayTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  runwayFill: { height: '100%' },
  runwayFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runwayFootLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.1, color: colors.textFaint },
  runwayFootValue: { fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },

  gauges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: 'auto',
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  shelf: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  card: {
    width: 118,
    alignSelf: 'flex-start',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  studioName: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
    textTransform: 'uppercase',
  },

  economics: { marginTop: 5, gap: 1 },
  econRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  econLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 0.8, color: colors.textFaint },
  econValue: { fontSize: 9, fontWeight: '900', fontVariant: ['tabular-nums'] },

  cardFoot: { padding: 6 },
  cardTitle: { fontSize: 10, fontWeight: '800', color: colors.text },
  cardViewers: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },

  newCard: {
    width: 118,
    height: 150,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  newPlus: { fontSize: 22, fontWeight: '900', color: colors.accent },
  newLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.accent },
});
