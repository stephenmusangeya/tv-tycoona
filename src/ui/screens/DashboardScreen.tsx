import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useGame, useGameStore } from '../../store/gameStore';
import {
  latestBreakdown,
  latestViewers,
  libraryWorth,
  moneyBreakdown,
  nowAiring,
  playerLibrary,
  playerShows,
  playerStudio,
  rerunIncome,
  totalCash,
  totalDebt,
  unsoldRepeats,
  weeklyNet,
} from '../../store/selectors';
import { TVScreen } from '../TVScreen';
import { Poster } from '../Poster';
import { DecisionDeck } from '../DecisionDeck';
import { WeekResults, type AiredLine } from '../WeekResults';
import { CountUp, FadeIn, Pop, WeekSweep } from '../motion';
import { SeasonTimeline } from '../SeasonTimeline';
import { Button, Card, ScoreBar } from '../components';
import { colors, deltaColor, formatMoneyShort, scoreColor, space } from '../theme';
import type { Production } from '../../engine/types';

/**
 * The desk — the game's home screen.
 *
 * Deliberately not a document. It holds exactly four things: what is on air, what the
 * money is doing, what you own, and where you are in the year. News lives in the
 * inbox and finished shows live under My Shows, because stacking those as scrolling
 * sections here is what made the game read like a web page.
 */
export function DashboardScreen({
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

  // The overnights are shown once per week, then dismissed.
  const [seenWeek, setSeenWeek] = React.useState(-1);

  if (!game) return null;

  const wide = width > 940;
  const studio = playerStudio(game);
  const shows = playerShows(game);
  const airing = nowAiring(game);
  const headline = airing[0];
  const money = moneyBreakdown(game);
  const net = weeklyNet(game);
  const cash = totalCash(game);
  const debt = totalDebt(game);
  const library = playerLibrary(game);
  const worth = libraryWorth(game);
  const repeats = rerunIncome(game);
  const sellable = unsoldRepeats(game);

  const mine = new Set(shows.map((s) => s.id));
  const airedLines: AiredLine[] =
    lastWeek?.airedThisWeek
      .filter((entry) => mine.has(entry.productionId))
      .map((entry) => {
        const production = game.productions[entry.productionId];
        // Compare against the last completed series, not the run in progress.
        const previous = production?.history.at(-1)?.averageViewers;
        return {
          productionId: entry.productionId,
          title: entry.title,
          format: production?.format ?? 'drama',
          viewers: entry.viewers,
          viewersBySegment: entry.viewersBySegment,
          previous,
        };
      })
      .sort((a, b) => b.viewers - a.viewers) ?? [];

  const showResults =
    lastWeek !== null && airedLines.length > 0 && seenWeek !== game.absoluteWeek;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.room, wide && styles.roomWide]}>
        {/* ---------------- Broadcast ---------------- */}
        <View style={wide ? { flex: 3 } : undefined}>
          <TVScreen
            airing={headline}
            viewers={headline ? latestViewers(headline) : undefined}
            breakdown={headline ? latestBreakdown(headline) : undefined}
            year={game.year}
            week={game.week}
            channelLabel={(studio?.name ?? 'STUDIO').toUpperCase()}
          />

          {/* Your shows, as cards you can walk into */}
          <View style={styles.showStrip}>
            {shows.slice(0, 4).map((production, index) => (
              <FadeIn key={production.id} delay={index * 60}>
                <ShowTile production={production} onPress={() => onOpenShow(production.id)} />
              </FadeIn>
            ))}

            <Pressable testID="new-show-tile" onPress={onMakeShow} style={styles.newTile}>
              <Text style={styles.newTilePlus}>＋</Text>
              <Text style={styles.newTileLabel}>New show</Text>
            </Pressable>
          </View>

          {/* Anything awaiting an answer, right where the player already is. */}
          <DecisionDeck onOpenShow={onOpenShow} />

          <View style={{ marginTop: space.md }}>
            <SeasonTimeline week={game.week} year={game.year} />
          </View>
        </View>

        {/* ---------------- Control panel ---------------- */}
        <View style={[styles.panel, wide && { flex: 2, marginTop: 0 }]}>
          <Card>
            <Text style={styles.panelLabel}>BANK</Text>
            <Pop trigger={cash}>
              <CountUp
                value={cash}
                format={formatMoneyShort}
                style={[styles.cash, { color: cash > 0 ? colors.text : colors.negative }]}
              />
            </Pop>
            {debt > 0 ? (
              <Text style={styles.debt}>Debt {formatMoneyShort(debt)}</Text>
            ) : null}

            <View style={styles.moneyBox}>
              {money.map((line) => (
                <View key={line.label} style={styles.moneyRow}>
                  <Text style={styles.moneyLabel} numberOfLines={1}>
                    {line.label}
                  </Text>
                  <Text style={[styles.moneyAmount, { color: deltaColor(line.amount) }]}>
                    {line.amount >= 0 ? '+' : '−'}
                    {formatMoneyShort(Math.abs(line.amount))}
                  </Text>
                </View>
              ))}

              <View style={styles.moneyTotal}>
                <Text style={styles.moneyTotalLabel}>
                  {net >= 0 ? 'Profit / week' : 'Loss / week'}
                </Text>
                <Text style={[styles.moneyTotalValue, { color: deltaColor(net) }]}>
                  {net >= 0 ? '+' : '−'}
                  {formatMoneyShort(Math.abs(net))}
                </Text>
              </View>

              {net < 0 ? (
                <View style={styles.runwayRow}>
                  <Text style={styles.runwayLabel}>Cash lasts</Text>
                  <Text style={styles.runwayValue}>{runway(cash, net)}</Text>
                </View>
              ) : null}
            </View>

            {/* The single way time moves. */}
            <View style={styles.advanceRow}>
              <Button
                label={advancing ? 'On air…' : 'Play next week ▸'}
                testID="advance-week"
                onPress={() => advance(1)}
                busy={advancing}
                style={{ flex: 3 }}
              />
              <Pressable
                testID="skip-four"
                onPress={() => advance(4)}
                disabled={advancing}
                style={({ pressed }) => [
                  styles.skip,
                  pressed && { opacity: 0.7 },
                  advancing && { opacity: 0.4 },
                ]}
              >
                <Text style={styles.skipText}>▸▸</Text>
                <Text style={styles.skipSub}>4w</Text>
              </Pressable>
            </View>
          </Card>

          <Card style={{ marginTop: space.md }}>
            <Text style={styles.panelLabel}>LIBRARY</Text>
            <CountUp value={worth} format={formatMoneyShort} style={styles.worth} />

            <View style={styles.ownRows}>
              <OwnRow label="Shows" value={String(library.length)} />
              <OwnRow
                label="Repeat income"
                value={`${formatMoneyShort(repeats)}/wk`}
                color={repeats > 0 ? colors.positive : colors.textFaint}
              />
              <OwnRow
                label="Unsold repeats"
                value={String(sellable.length)}
                color={sellable.length > 0 ? colors.accent : colors.textFaint}
              />
            </View>
          </Card>

          <Card style={{ marginTop: space.md }}>
            <Text style={styles.panelLabel}>REPUTATION</Text>
            <View style={{ marginTop: space.sm }}>
              <ScoreBar label="Critics" value={studio?.criticalStanding ?? 0} />
              <ScoreBar label="Fame" value={studio?.popularStanding ?? 0} />
            </View>
          </Card>
        </View>
      </View>

      <View style={{ height: space.xl }} />
      <WeekSweep trigger={game.absoluteWeek} />

      {showResults && lastWeek ? (
        <WeekResults
          result={lastWeek}
          lines={airedLines}
          onDismiss={() => setSeenWeek(game.absoluteWeek)}
        />
      ) : null}
    </ScrollView>
  );
}

function OwnRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.ownRow}>
      <Text style={styles.ownLabel}>{label}</Text>
      <Text style={[styles.ownValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/** A show as a card — the object you tap to go and manage it. */
function ShowTile({
  production,
  onPress,
}: {
  production: Production;
  onPress: () => void;
}) {
  const viewers = latestViewers(production);
  const live = production.status === 'airing';
  const waiting = production.status === 'hiatus' && !production.deal;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
    >
      <Poster
        seed={production.id}
        format={production.format}
        live={live}
        size="md"
        style={{ width: '100%', height: 104 }}
      />

      <View style={styles.tileBody}>
        <Text style={styles.tileStatus}>
          {live
            ? 'ON AIR'
            : waiting
              ? 'NEEDS A CHANNEL'
              : production.status === 'development'
                ? `${production.developmentWeeksRemaining ?? 0}W LEFT`
                : 'READY'}
        </Text>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {production.title}
        </Text>

        <View style={styles.tileBottom}>
          <Text style={styles.tileViewers}>
            {viewers !== undefined ? `${viewers.toFixed(1)}M` : '—'}
          </Text>
          <View
            style={[styles.tileQuality, { backgroundColor: scoreColor(production.quality) }]}
          />
        </View>
      </View>
    </Pressable>
  );
}

function runway(cash: number, net: number): string {
  if (net >= 0) return '∞';
  const weeks = Math.floor(cash / -net);
  if (weeks > 260) return '5y+';
  if (weeks > 52) return `${(weeks / 52).toFixed(1)}y`;
  return `${weeks}w`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.md },

  room: { gap: space.md },
  roomWide: { flexDirection: 'row', alignItems: 'flex-start' },

  showStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },

  tile: {
    width: 132,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileBody: { padding: space.sm },
  tileStatus: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8, color: colors.textFaint },
  tileTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 4, lineHeight: 17 },
  tileBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  tileViewers: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  tileQuality: { width: 22, height: 4, borderRadius: 2 },

  newTile: {
    width: 132,
    minHeight: 178,
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  newTilePlus: { fontSize: 22, fontWeight: '800', color: colors.accent },
  newTileLabel: { fontSize: 11, fontWeight: '700', color: colors.accentDeep },

  panel: { marginTop: space.md },
  panelLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: colors.textFaint },
  cash: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  debt: { fontSize: 11, color: colors.negative },
  worth: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.positive,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },

  moneyBox: {
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    gap: space.sm,
  },
  moneyLabel: { fontSize: 12, color: colors.textDim, flex: 1 },
  moneyAmount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moneyTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 2,
    borderTopColor: colors.text,
  },
  moneyTotalLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  moneyTotalValue: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },

  runwayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 6,
    paddingHorizontal: space.sm,
    borderRadius: 8,
  },
  runwayLabel: { fontSize: 11, color: colors.textDim },
  runwayValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  advanceRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  skip: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderBright,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  skipText: { fontSize: 13, fontWeight: '800', color: colors.text },
  skipSub: { fontSize: 8, fontWeight: '700', color: colors.textFaint, letterSpacing: 0.6 },

  ownRows: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  ownLabel: { fontSize: 12, color: colors.textDim },
  ownValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
