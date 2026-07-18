import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useGame } from '../../store/gameStore';
import {
  episodesToSyndication,
  latestBreakdown,
  latestViewers,
  lifetimeProfit,
  playerArchive,
  playerShows,
  showOutcome,
} from '../../store/selectors';
import { episodeDeficit } from '../../engine/economy';
import { formatSlotKey } from '../../engine/schedule';
import { Button, Card, EmptyState, Pill, Row, SectionHeader, SegmentBar } from '../components';
import { ScreenHeader, HeaderStat } from '../ScreenHeader';
import { Poster } from '../Poster';
import { FadeIn } from '../motion';
import { colors, deltaColor, formatMoneyShort, scoreColor, space, type } from '../theme';
import type { Production } from '../../engine/types';

/**
 * The slate: every project you own, in one dense list.
 *
 * Each row is built to answer the three questions a studio head actually has about a
 * show — is anyone watching, is it bleeding money, and how far is it from being worth
 * something on the back end.
 */
export function SlateScreen({
  onOpenShow,
  onMakeShow,
}: {
  onOpenShow: (id: string) => void;
  onMakeShow: () => void;
}) {
  const game = useGame();
  if (!game) return null;

  const shows = playerShows(game);
  const airing = shows.filter((s) => s.status === 'airing');
  const ready = shows.filter((s) => s.status === 'hiatus');
  const developing = shows.filter((s) => s.status === 'development');
  const archive = playerArchive(game);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="My Shows"
        subtitle={`${shows.length} in production · ${archive.length} finished`}
        right={<HeaderStat label="ON AIR" value={String(airing.length)} />}
      />

      {shows.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <EmptyState
            title="You have no shows"
            body="You still pay for your offices every week, so an empty studio just loses money."
          />
          <Button label="＋ Make a Show" onPress={onMakeShow} />
        </Card>
      ) : null}

      {airing.length > 0 ? (
        <>
          <SectionHeader title={`On air now (${airing.length})`} />
          <Card padded={false}>
            {airing.map((production) => (
              <ShowRow
                key={production.id}
                production={production}
                game={game}
                onPress={() => onOpenShow(production.id)}
              />
            ))}
          </Card>
        </>
      ) : null}

      {ready.length > 0 ? (
        <>
          <SectionHeader title={`Finished — looking for a channel (${ready.length})`} />
          <Card padded={false}>
            {ready.map((production) => (
              <ShowRow
                key={production.id}
                production={production}
                game={game}
                onPress={() => onOpenShow(production.id)}
              />
            ))}
          </Card>
        </>
      ) : null}

      {developing.length > 0 ? (
        <>
          <SectionHeader title={`Being made (${developing.length})`} />
          <Card padded={false}>
            {developing.map((production) => (
              <ShowRow
                key={production.id}
                production={production}
                game={game}
                onPress={() => onOpenShow(production.id)}
              />
            ))}
          </Card>
        </>
      ) : null}

      {archive.length > 0 ? (
        <>
          <SectionHeader title={`Shows you've finished (${archive.length})`} />
          <Card padded={false}>
            {archive.map((production, index) => {
              const outcome = showOutcome(production);
              const profit = lifetimeProfit(production);
              return (
                <Row key={production.id} onPress={() => onOpenShow(production.id)}>
                  <View style={styles.rowTop}>
                    <View style={{ flex: 1, marginRight: space.sm }}>
                      <Text style={styles.title} numberOfLines={1}>
                        {production.title}
                      </Text>
                      <Text style={styles.archiveOutcome}>{outcome.detail}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Pill label={outcome.headline} tone={outcomeTone(outcome.verdict)} />
                      <Text
                        style={[
                          styles.archiveProfit,
                          { color: profit >= 0 ? colors.positive : colors.negative },
                        ]}
                      >
                        {formatMoneyShort(profit)} lifetime
                      </Text>
                    </View>
                  </View>
                  {index === archive.length - 1 ? null : null}
                </Row>
              );
            })}
          </Card>
        </>
      ) : null}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

function outcomeTone(verdict: string): 'positive' | 'negative' | 'accent' | 'neutral' {
  if (verdict === 'hit') return 'positive';
  if (verdict === 'stranded') return 'negative';
  if (verdict === 'solid') return 'accent';
  return 'neutral';
}

function ShowRow({
  production,
  game,
  onPress,
}: {
  production: Production;
  game: ReturnType<typeof useGame> & {};
  onPress: () => void;
}) {
  const viewers = latestViewers(production);
  const breakdown = latestBreakdown(production);
  const deficit = production.deal ? episodeDeficit(production) : 0;
  const toSyndication = episodesToSyndication(production);
  const network = production.deal ? game.companies[production.deal.networkId] : undefined;

  return (
    <Row onPress={onPress}>
      <View style={styles.rowTop}>
        <Poster
          seed={production.id}
          format={production.format}
          size="sm"
          live={production.status === 'airing'}
          style={{ marginRight: space.md }}
        />
        <View style={{ flex: 1, marginRight: space.sm }}>
          <Text style={styles.title} numberOfLines={1}>
            {production.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {production.status === 'development'
              ? `being made · ready in ${production.developmentWeeksRemaining ?? 0} weeks`
              : network
                ? `${network.name}${
                    production.deal?.slotKey && production.deal.slotKey !== 'stream'
                      ? ` · ${formatSlotKey(production.deal.slotKey)}`
                      : ' · streaming'
                  }`
                : 'no channel yet'}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.viewers}>
            {viewers !== undefined ? `${viewers.toFixed(1)}M` : '—'}
          </Text>
          <Text style={[styles.quality, { color: scoreColor(production.quality) }]}>
            Q{Math.round(production.quality)}
          </Text>
        </View>
      </View>

      {breakdown ? (
        <View style={{ marginTop: space.sm }}>
          <SegmentBar breakdown={breakdown} height={6} />
        </View>
      ) : null}

      <View style={styles.rowBottom}>
        <View style={styles.tags}>
          <Pill label={production.format} />
          {production.status === 'airing' ? (
            <Text style={styles.progress}>
              S{production.season} · ep {production.episodesAiredThisSeason}/
              {production.episodesPerSeason}
            </Text>
          ) : null}
          {production.status === 'hiatus' && !production.deal ? (
            <Pill label="needs a channel" tone="accent" />
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          {production.deal ? (
            <Text style={[styles.deficit, { color: deltaColor(-deficit) }]}>
              {deficit > 0 ? '−' : '+'}
              {formatMoneyShort(Math.abs(deficit))}/ep
            </Text>
          ) : null}
          {production.syndicated ? (
            <Text style={styles.syndicated}>earning from repeats</Text>
          ) : toSyndication > 0 && production.totalEpisodes > 0 ? (
            <Text style={styles.toSyndication}>{toSyndication} more for repeats</Text>
          ) : null}
        </View>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.sm },

  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  viewers: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  quality: { fontSize: 11, fontWeight: '700', marginTop: 1 },

  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: space.sm,
  },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  progress: { fontSize: 10, color: colors.textFaint },

  deficit: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  syndicated: { fontSize: 9, color: colors.positive, marginTop: 2, letterSpacing: 0.4 },
  toSyndication: { fontSize: 9, color: colors.textFaint, marginTop: 2 },

  archiveOutcome: { fontSize: 11, color: colors.textFaint, marginTop: 3, lineHeight: 16 },
  archiveProfit: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
