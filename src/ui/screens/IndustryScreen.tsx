import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import { companiesByType, playerStudio, ratingsBoard } from '../../store/selectors';
import { acquireNetwork, launchStreamer } from '../../engine/actions';
import { ECONOMY } from '../../engine/economy';
import { Button, Card, EmptyState, Pill, ScoreBar, SectionHeader, Stat } from '../components';
import { ScreenHeader, HeaderStat } from '../ScreenHeader';
import { Poster } from '../Poster';
import { colors, formatMoneyShort, scoreColor, space, type } from '../theme';

type Tab = 'ratings' | 'rivals' | 'empire';

/**
 * The industry view: the ratings board, who your rivals are, and the ladder from
 * studio to network to streamer.
 *
 * The empire tab is deliberately explicit about its gates. A progression system the
 * player cannot see the requirements for reads as arbitrary rather than aspirational.
 */
export function IndustryScreen() {
  const game = useGame();
  const run = useAction();
  const [tab, setTab] = useState<Tab>('ratings');

  if (!game) return null;

  const board = ratingsBoard(game, 30);
  const studio = playerStudio(game);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Industry"
        subtitle="Ratings, rivals and your empire"
        right={<HeaderStat label="WEEK" value={`Y${game.year} W${game.week}`} />}
      />

      <View style={styles.tabs}>
        {(
          [
            ['ratings', 'Ratings'],
            ['rivals', 'Rivals'],
            ['empire', 'Empire'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* ------------------------------------------------ Ratings board */}
      {tab === 'ratings' ? (
        board.length === 0 ? (
          <Card style={{ marginTop: space.lg }}>
            <EmptyState title="Nothing has aired yet" body="Advance a few weeks." />
          </Card>
        ) : (
          <Card padded={false} style={{ marginTop: space.lg }}>
            {board.map((entry, index) => {
              const isPlayer =
                entry.production.ownerId === game.player.studioId ||
                entry.production.ownerId === game.player.networkId ||
                entry.production.ownerId === game.player.streamerId;

              return (
                <View
                  key={entry.production.id}
                  style={[
                    styles.boardRow,
                    index === board.length - 1 && { borderBottomWidth: 0 },
                    isPlayer && styles.boardRowPlayer,
                  ]}
                >
                  <Text style={styles.rank}>{index + 1}</Text>
                  <Poster
                    seed={entry.production.id}
                    format={entry.production.format}
                    size="sm"
                    style={{ marginRight: space.sm }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.boardTitle, isPlayer && { color: colors.accent }]}
                      numberOfLines={1}
                    >
                      {entry.production.title}
                    </Text>
                    <Text style={styles.boardMeta} numberOfLines={1}>
                      {entry.network?.name ?? 'unsold'} · {entry.owner?.name ?? '—'}
                    </Text>
                  </View>
                  <Text style={styles.boardViewers}>{entry.viewers.toFixed(1)}M</Text>
                </View>
              );
            })}
          </Card>
        )
      ) : null}

      {/* ------------------------------------------------ Rivals */}
      {tab === 'rivals' ? (
        <>
          {(['network', 'streamer', 'studio'] as const).map((companyType) => (
            <View key={companyType}>
              <SectionHeader title={`${companyType}s`} />
              <Card padded={false}>
                {companiesByType(game, companyType).map((company, index, list) => (
                  <View
                    key={company.id}
                    style={[styles.rivalRow, index === list.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.rivalName, company.isPlayer && { color: colors.accent }]}
                      >
                        {company.name}
                        {company.isPlayer ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.rivalMeta}>
                        {company.personality.replace('-', ' ')}
                        {company.type === 'network'
                          ? ` · ${((company.reach ?? 0) * 100).toFixed(0)}% reach`
                          : company.type === 'streamer'
                            ? ` · ${(company.subscribers ?? 0).toFixed(1)}M subs`
                            : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text
                        style={[
                          styles.rivalCash,
                          { color: company.cash - company.debt >= 0 ? colors.text : colors.negative },
                        ]}
                      >
                        {formatMoneyShort(company.cash - company.debt)}
                      </Text>
                      <Text style={styles.rivalStanding}>
                        <Text style={{ color: scoreColor(company.criticalStanding) }}>
                          {Math.round(company.criticalStanding)}
                        </Text>
                        <Text style={{ color: colors.textFaint }}> crit · </Text>
                        <Text style={{ color: scoreColor(company.popularStanding) }}>
                          {Math.round(company.popularStanding)}
                        </Text>
                        <Text style={{ color: colors.textFaint }}> pop</Text>
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ))}
        </>
      ) : null}

      {/* ------------------------------------------------ Empire */}
      {tab === 'empire' ? (
        <>
          <SectionHeader title="Your position" />
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Stat label="Cash" value={formatMoneyShort(studio?.cash ?? 0)} />
              <Stat
                label="Debt"
                value={formatMoneyShort(studio?.debt ?? 0)}
                align="right"
                valueColor={(studio?.debt ?? 0) > 0 ? colors.negative : undefined}
              />
            </View>
            <View style={{ marginTop: space.md }}>
              <ScoreBar label="Critical" value={studio?.criticalStanding ?? 0} />
              <ScoreBar label="Popular" value={studio?.popularStanding ?? 0} />
            </View>
          </Card>

          {/* --- Network --- */}
          <SectionHeader title="Buy a network" />
          <Card>
            {game.player.networkId ? (
              <View>
                <Pill label="owned" tone="positive" />
                <Text style={styles.empireBody}>
                  You own {game.companies[game.player.networkId]?.name}. You now control a
                  schedule — where a show airs matters as much as whether it is good.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.empireBody}>
                  Owning a network means you sell advertising instead of shows, and you decide
                  which of your own programmes get the good slots.
                </Text>
                <View style={styles.requirement}>
                  <Text style={styles.reqLabel}>Cost</Text>
                  <Text style={styles.reqValue}>
                    {formatMoneyShort(ECONOMY.acquisitionCost.network)}
                  </Text>
                </View>
                <View style={styles.requirement}>
                  <Text style={styles.reqLabel}>Public standing</Text>
                  <Text
                    style={[
                      styles.reqValue,
                      {
                        color:
                          (studio?.popularStanding ?? 0) >=
                          ECONOMY.acquisitionStandingRequired.network
                            ? colors.positive
                            : colors.negative,
                      },
                    ]}
                  >
                    {Math.round(studio?.popularStanding ?? 0)} /{' '}
                    {ECONOMY.acquisitionStandingRequired.network}
                  </Text>
                </View>

                {companiesByType(game, 'network').map((network) => (
                  <Button
                    key={network.id}
                    label={`Acquire ${network.name}`}
                    variant="secondary"
                    style={{ marginTop: space.sm }}
                    onPress={() => run((g) => acquireNetwork(g, network.id))}
                  />
                ))}
              </>
            )}
          </Card>

          {/* --- Streaming --- */}
          <SectionHeader title="Launch streaming" />
          <Card>
            {game.player.streamerId ? (
              <View>
                <Pill label="live" tone="positive" />
                <Text style={styles.empireBody}>
                  {(game.companies[game.player.streamerId]?.subscribers ?? 0).toFixed(1)}M
                  subscribers. Keep releasing — a quiet month is a leaking month.
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.empireBody}>
                  A service of your own: no slots, no advertisers to offend, and no
                  off-season. Churn is relentless and only a steady release cadence holds it
                  back.
                </Text>
                <View style={styles.requirement}>
                  <Text style={styles.reqLabel}>Cost</Text>
                  <Text style={styles.reqValue}>
                    {formatMoneyShort(ECONOMY.acquisitionCost.streamer)}
                  </Text>
                </View>
                <View style={styles.requirement}>
                  <Text style={styles.reqLabel}>Public standing</Text>
                  <Text
                    style={[
                      styles.reqValue,
                      {
                        color:
                          (studio?.popularStanding ?? 0) >=
                          ECONOMY.acquisitionStandingRequired.streamer
                            ? colors.positive
                            : colors.negative,
                      },
                    ]}
                  >
                    {Math.round(studio?.popularStanding ?? 0)} /{' '}
                    {ECONOMY.acquisitionStandingRequired.streamer}
                  </Text>
                </View>
                <Button
                  label="Launch service"
                  variant="secondary"
                  style={{ marginTop: space.sm }}
                  onPress={() => run((g) => launchStreamer(g, `${studio?.name ?? 'My'}+`))}
                />
              </>
            )}
          </Card>
        </>
      ) : null}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.sm },

  tabs: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.lg,
    backgroundColor: colors.surface,
    padding: 3,
    borderRadius: 8,
  },
  tab: { flex: 1, paddingVertical: space.sm, borderRadius: 6, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surfaceHigh },
  tabText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  tabTextActive: { color: colors.text },

  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  boardRowPlayer: { backgroundColor: `${colors.accent}12` },
  rank: {
    width: 22,
    fontSize: 11,
    color: colors.textFaint,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  boardTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  boardMeta: { fontSize: 10, color: colors.textFaint, marginTop: 1 },
  boardViewers: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  rivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rivalName: { fontSize: 14, fontWeight: '600', color: colors.text },
  rivalMeta: { fontSize: 10, color: colors.textFaint, marginTop: 2 },
  rivalCash: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rivalStanding: { fontSize: 10, marginTop: 2 },

  empireBody: { fontSize: 12, color: colors.textDim, lineHeight: 18, marginTop: space.sm },
  requirement: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reqLabel: { fontSize: 12, color: colors.textDim },
  reqValue: { fontSize: 13, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
});
