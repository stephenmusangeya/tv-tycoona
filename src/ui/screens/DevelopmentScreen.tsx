import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import { estimateNewShow, pitcherOf, playerStudio } from '../../store/selectors';
import {
  acceptOffer,
  declineOffer,
  developOriginal,
  greenlightPitch,
  passOnPitch,
} from '../../engine/actions';
import { SHOW_ARCHETYPES } from '../../data';
import { formatSlotKey } from '../../engine/schedule';
import { appealProfile } from '../../engine/audience';
import { AXES } from '../../engine/types';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  Pill,
  ScoreBar,
  SectionHeader,
  SegmentBar,
  SegmentLegend,
  Stat,
} from '../components';
import { colors, deltaColor, formatMoneyShort, space, type } from '../theme';
import { ScreenHeader, HeaderStat } from '../ScreenHeader';
import { Poster } from '../Poster';
import { FadeIn } from '../motion';

type Tab = 'pitches' | 'offers' | 'catalogue';

/**
 * Development: everything that turns money into shows.
 *
 * Three distinct decisions live here — take a pitch, take a network's offer, or
 * commission something yourself — so they are tabbed rather than stacked. Each one
 * shows the projected deficit up front, because that is the number the player is
 * really agreeing to.
 */
export function DevelopmentScreen({
  onOpenShow,
  forceCatalogue = false,
}: {
  onOpenShow: (id: string) => void;
  /** Set when the player arrived via "Make a Show" — go straight to Commission. */
  forceCatalogue?: boolean;
}) {
  const game = useGame();
  const run = useAction();

  // Open on whichever tab has something to act on. A new studio has no pitches and
  // no offers, so defaulting to "pitches" left the player staring at an empty screen
  // with no visible way to make their first show.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (forceCatalogue) return 'catalogue';
    return game && game.pitches.length > 0 ? 'pitches' : 'catalogue';
  });

  // Every hook must run before the early return below, or hook order changes between
  // renders the moment `game` goes from null to loaded.
  const inProduction = useMemo(
    () =>
      new Set(
        Object.values(game?.productions ?? {})
          .filter((p) => p.status !== 'cancelled' && p.status !== 'ended')
          .map((p) => p.archetypeId),
      ),
    [game, game?.absoluteWeek, game?.nextId],
  );

  const catalogue = useMemo(
    () => SHOW_ARCHETYPES.filter((a) => !inProduction.has(a.id)).slice(0, 40),
    [inProduction],
  );

  if (!game) return null;

  const studio = playerStudio(game);
  const offers = game.offers;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="New Shows"
        subtitle="Commission an idea, or take a pitch"
        right={
          <HeaderStat label="TO SPEND" value={formatMoneyShort(studio?.cash ?? 0)} />
        }
      />

      <View style={styles.tabs}>
        {(
          [
            ['pitches', `Pitches (${game.pitches.length})`],
            ['offers', `Offers (${offers.length})`],
            ['catalogue', 'Create a Show'],
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

      {/* ------------------------------------------------ Pitches */}
      {tab === 'pitches' ? (
        game.pitches.length === 0 ? (
          <Card style={{ marginTop: space.lg }}>
            <EmptyState
              title="Nobody has pitched you anything yet"
              body="Famous writers and actors bring you ideas once people know who you are. For now, create your own show."
            />
          </Card>
        ) : (
          game.pitches.map((pitch) => {
            const pitcher = pitcherOf(game, pitch);
            const appeal = appealProfile(pitch.attributes);

            return (
              <Card key={pitch.id} style={{ marginTop: space.md }}>
                <View style={styles.pitchHead}>
                  <Poster
                    seed={pitch.archetypeId}
                    format={pitch.format}
                    size="md"
                    style={{ marginRight: space.md }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pitchTitle}>{pitch.title}</Text>
                    <Text style={styles.pitchFrom}>
                      pitched by {pitcher?.name ?? 'someone'}
                      {pitcher ? ` · ${pitcher.role}` : ''}
                    </Text>
                  </View>
                  <Pill label={pitch.format} tone="accent" />
                </View>

                <Text style={styles.logline}>{pitch.logline}</Text>

                {pitcher ? (
                  <View style={styles.pitcherStats}>
                    <Stat label="Craft" value={String(Math.round(pitcher.craft))} />
                    <Stat label="Star" value={String(Math.round(pitcher.starPower))} />
                    <Stat label="Ego" value={String(Math.round(pitcher.ego))} />
                    <Stat
                      label="They want"
                      value={`${formatMoneyShort(pitch.estimatedCostPerEpisode)}/ep`}
                      align="right"
                    />
                  </View>
                ) : null}

                <Text style={styles.appealLabel}>WHO WOULD WATCH THIS</Text>
                <SegmentBar breakdown={appeal} height={8} />

                <View style={styles.pitchButtons}>
                  <Button
                    label="Pass"
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={() => run((g) => passOnPitch(g, pitch.id))}
                  />
                  <Button
                    label="Make it!"
                    style={{ flex: 2 }}
                    onPress={() => {
                      const production = run((g) => greenlightPitch(g, pitch.id));
                      if (production) onOpenShow(production.id);
                    }}
                  />
                </View>
              </Card>
            );
          })
        )
      ) : null}

      {/* ------------------------------------------------ Offers */}
      {tab === 'offers' ? (
        offers.length === 0 ? (
          <Card style={{ marginTop: space.lg }}>
            <EmptyState
              title="No offers yet"
              body="When one of your shows is finished, channels start bidding for it. Give it a few weeks."
            />
          </Card>
        ) : (
          offers.map((offer) => {
            const production = game.productions[offer.productionId];
            const network = game.companies[offer.networkId];
            if (!production || !network) return null;

            const annual = offer.licenseFeePerEpisode * production.episodesPerSeason;

            return (
              <Card key={offer.id} style={{ marginTop: space.md }}>
                <Text style={styles.pitchTitle}>{production.title}</Text>
                <Text style={styles.pitchFrom}>
                  {network.name} · {((network.reach ?? 0) * 100).toFixed(0)}% reach
                </Text>

                <Divider />

                <View style={styles.offerStats}>
                  <Stat
                    label="They pay you"
                    value={formatMoneyShort(offer.licenseFeePerEpisode)}
                  />
                  <Stat label="When" value={formatSlotKey(offer.slotKey)} />
                  <Stat label="Series" value={String(offer.seasons)} align="right" />
                </View>

                <Text style={styles.hint}>
                  {formatMoneyShort(annual)} per series. Watch out: lots of money on a rubbish
                  channel at a rubbish time is worth less than less money somewhere people
                  will actually see it.
                </Text>

                <View style={styles.pitchButtons}>
                  <Button
                    label="Decline"
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={() => run((g) => declineOffer(g, offer.id))}
                  />
                  <Button
                    label="Accept"
                    style={{ flex: 2 }}
                    onPress={() => run((g) => acceptOffer(g, offer.id))}
                  />
                </View>
              </Card>
            );
          })
        )
      ) : null}

      {/* ------------------------------------------------ Catalogue */}
      {tab === 'catalogue' ? (
        <>
          <Text style={[styles.hint, { marginTop: space.md }]}>
            Pick an idea and we will find you a cast and crew. Cheaper than waiting for a
            famous name to bring you something, but nobody famous comes attached.
          </Text>

          {catalogue.map((archetype) => {
            const open = expanded === archetype.id;
            const est = estimateNewShow(archetype);
            const appeal = appealProfile(archetype.attributes);
            const affordable = (studio?.cash ?? 0) + est.perSeries > 0;

            return (
              <Card key={archetype.id} style={{ marginTop: space.sm }}>
                <View style={styles.pitchHead}>
                  <Poster
                    seed={archetype.id}
                    format={archetype.format}
                    size="md"
                    style={{ marginRight: space.md }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pitchTitle}>{archetype.title}</Text>
                    <Text style={styles.pitchFrom}>
                      {archetype.genre} · {archetype.era}
                    </Text>
                    <Text style={styles.logline} numberOfLines={3}>
                      {archetype.logline}
                    </Text>
                  </View>
                  <Pill label={archetype.format} />
                </View>

                {/* Headline cost — always visible */}
                <View style={styles.offerStats}>
                  <Stat
                    label="Each episode"
                    value={formatMoneyShort(est.costPerEpisode)}
                  />
                  <Stat label="Episodes" value={String(est.episodes)} />
                  <Stat
                    label="Whole series"
                    value={formatMoneyShort(est.seriesCost)}
                    align="right"
                  />
                </View>

                {/* Full detail before committing */}
                {open ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailHead}>WHAT IT COSTS YOU</Text>
                    <DetailRow label="Making each episode" amount={-est.budget} />
                    <DetailRow label="Advertising it" amount={-est.marketing} />
                    <DetailRow label="A channel should pay about" amount={est.expectedFee} />
                    <View style={styles.detailTotal}>
                      <Text style={styles.detailTotalLabel}>Per episode</Text>
                      <Text
                        style={[
                          styles.detailTotalValue,
                          { color: deltaColor(est.perEpisode) },
                        ]}
                      >
                        {est.perEpisode >= 0 ? '+' : '−'}
                        {formatMoneyShort(Math.abs(est.perEpisode))}
                      </Text>
                    </View>
                    <View style={styles.detailTotal}>
                      <Text style={styles.detailTotalLabel}>
                        Per series ({est.episodes} eps)
                      </Text>
                      <Text
                        style={[
                          styles.detailTotalValue,
                          { color: deltaColor(est.perSeries) },
                        ]}
                      >
                        {est.perSeries >= 0 ? '+' : '−'}
                        {formatMoneyShort(Math.abs(est.perSeries))}
                      </Text>
                    </View>

                    <Text style={styles.detailHead}>REPEATS</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Series until you can sell repeats</Text>
                      <Text style={styles.detailValue}>{est.seriesToRepeats}</Text>
                    </View>

                    <Text style={styles.detailHead}>WHO WOULD WATCH</Text>
                    <SegmentBar breakdown={appeal} height={8} />
                    <SegmentLegend breakdown={appeal} />

                    <Text style={styles.detailHead}>WHAT IT'S LIKE</Text>
                    {AXES.map((axis) => (
                      <ScoreBar
                        key={axis}
                        label={axisLabel(axis)}
                        value={archetype.attributes[axis]}
                      />
                    ))}
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <Button
                    label={open ? 'Hide details' : 'See details'}
                    testID={open ? 'hide-details' : 'see-details'}
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={() => setExpanded(open ? null : archetype.id)}
                  />
                  <Button
                    label="Make this show"
                    testID="commission-show"
                    variant={affordable ? 'primary' : 'secondary'}
                    style={{ flex: 1 }}
                    onPress={() => {
                      const production = run((g) => developOriginal(g, archetype.id));
                      if (production) onOpenShow(production.id);
                    }}
                  />
                </View>
              </Card>
            );
          })}
        </>
      ) : null}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

function DetailRow({ label, amount }: { label: string; amount: number }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, { color: deltaColor(amount) }]}>
        {amount >= 0 ? '+' : '−'}
        {formatMoneyShort(Math.abs(amount))}
      </Text>
    </View>
  );
}

function axisLabel(axis: string): string {
  if (axis === 'wholesomeness') return 'Wholesome';
  if (axis === 'entertainment') return 'Entertain';
  return axis.charAt(0).toUpperCase() + axis.slice(1);
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

  pitchHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pitchTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  pitchFrom: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  logline: { fontSize: 13, color: colors.textDim, marginTop: space.sm, lineHeight: 19 },

  pitcherStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  appealLabel: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginTop: space.md,
    marginBottom: space.xs,
  },

  offerStats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },

  pitchButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },

  hint: { fontSize: 11, color: colors.textFaint, marginTop: space.md, lineHeight: 16 },

  detailBlock: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailHead: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.textFaint,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: { fontSize: 12, color: colors.textDim, flex: 1 },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.borderBright,
  },
  detailTotalLabel: { fontSize: 12, fontWeight: '800', color: colors.text },
  detailTotalValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
