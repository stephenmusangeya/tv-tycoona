import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import {
  archetypeOf,
  episodesToSyndication,
  estimateNewShow,
  latestBreakdown,
  latestViewers,
  roster,
  rosterCostPerEpisode,
  showEconomics,
  totalCash,
} from '../../store/selectors';
import {
  cancelOwnShow,
  developOriginal,
  licenseReruns,
  rerunBidsFor,
  sellRights,
  setBudget,
} from '../../engine/actions';
import { potentialAudience } from '../../engine/audience';
import { ARCHETYPES_BY_ID } from '../../data';
import {
  RERUN_MINIMUM_EPISODES,
  canSellReruns,
  rerunWeeklyValue,
  rightsSaleValue,
} from '../../engine/economy';
import { budgetScore } from '../../engine/quality';
import { formatSlotKey } from '../../engine/schedule';
import { AXES, type ShowArchetype } from '../../engine/types';
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
import { colors, deltaColor, formatMoneyShort, scoreColor, space, type } from '../theme';
import { Icon } from '../icons';
import { Poster, Avatar } from '../Poster';
import { CountUp } from '../motion';

/**
 * What the detail modal is looking at.
 *
 * A poster can name a show the player owns, a rival's show, or an idea nobody has
 * commissioned yet. The first two are `Production`s and carry history; the third is
 * only a `ShowArchetype` from the content database. Naming the kind up front keeps
 * the two views honest — the archetype view cannot accidentally reach for ratings
 * that do not exist.
 */
export type ShowSubject =
  | { kind: 'production'; id: string }
  | { kind: 'archetype'; id: string };

/** A bare string still means "a production", because that is what every caller sends. */
export type ShowRef = string | ShowSubject;

export function toShowSubject(ref: ShowRef): ShowSubject {
  return typeof ref === 'string' ? { kind: 'production', id: ref } : ref;
}

/**
 * Show detail.
 *
 * Dispatches on the subject rather than branching inside one component: the two views
 * share almost no data, and keeping them apart means neither one needs a guard on
 * every field.
 */
export function ShowDetailScreen({
  subject,
  onClose,
  onOpenProduction,
}: {
  subject: ShowRef;
  onClose: () => void;
  /** Where to go once an idea becomes a real production. */
  onOpenProduction?: (id: string) => void;
}) {
  const resolved = toShowSubject(subject);

  if (resolved.kind === 'archetype') {
    return (
      <ArchetypeDetail
        archetypeId={resolved.id}
        onClose={onClose}
        onOpenProduction={onOpenProduction}
      />
    );
  }

  return <ProductionDetail productionId={resolved.id} onClose={onClose} />;
}

/**
 * The production view — where a player actually makes decisions about a show.
 *
 * The budget control is the heart of it: moving the slider re-derives quality live, so
 * the diminishing-returns curve is something you feel rather than read about.
 */
function ProductionDetail({
  productionId,
  onClose,
}: {
  productionId: string;
  onClose: () => void;
}) {
  const game = useGame();
  const run = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSell, setConfirmSell] = useState(false);

  const production = game?.productions[productionId];
  const ownsRights = Boolean(
    game && production && production.rightsOwnerId === game.player.studioId,
  );
  const bids = useMemo(
    () => (game && production ? rerunBidsFor(game, production.id) : []),
    [game, production, production?.rerunDeals.length, game?.absoluteWeek],
  );

  const archetype = useMemo(
    () => (production ? archetypeOf(production) : undefined),
    [production],
  );

  if (!game || !production || !archetype) {
    return (
      <View style={styles.screen}>
        <Header title="Show" onClose={onClose} />
        <EmptyState title="That show no longer exists." />
      </View>
    );
  }

  const viewers = latestViewers(production);
  const breakdown = latestBreakdown(production);
  const cast = roster(game, production);
  const talentCost = rosterCostPerEpisode(game, production);
  const network = production.deal ? game.companies[production.deal.networkId] : undefined;
  const toSyndication = episodesToSyndication(production);
  const economics = showEconomics(game, production);

  const budgetRatio = production.budgetPerEpisode / archetype.baseCostPerEpisode;
  const funding = budgetScore(production.budgetPerEpisode, archetype.baseCostPerEpisode);
  const canEditBudget = production.status !== 'airing';

  const adjustBudget = (multiplier: number) => {
    const next = Math.round(archetype.baseCostPerEpisode * multiplier);
    run((g) => setBudget(g, production.id, next, Math.round(next * 0.12)));
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Header title={production.title} onClose={onClose} />

      <View style={styles.heroRow}>
        <Poster
          seed={production.id}
          format={production.format}
          size="lg"
          live={production.status === 'airing'}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.logline}>{archetype.logline}</Text>
        </View>
      </View>

      <View style={styles.tagRow}>
        <Pill label={production.format} tone="accent" />
        <Pill label={production.status} />
        {production.syndicated ? <Pill label="syndicated" tone="positive" /> : null}
      </View>

      {/* --- Headline numbers --- */}
      <Card style={{ marginTop: space.lg }}>
        <View style={styles.statRow}>
          <Stat
            label="Viewers"
            value={viewers !== undefined ? `${viewers.toFixed(1)}M` : '—'}
            sub={production.status === 'airing' ? 'this season' : 'last season'}
          />
          <Stat
            label="How good it is"
            value={String(Math.round(production.quality))}
            valueColor={scoreColor(production.quality)}
            align="right"
          />
        </View>
        <Divider />
        <View style={styles.statRow}>
          <Stat label="Season" value={`${production.season}`} sub={`${production.totalEpisodes} episodes made`} />
          <Stat
            label="Hype"
            value={String(Math.round(production.buzz))}
            align="right"
            sub={`${Math.round(production.fatigue * 100)}% stale`}
          />
        </View>
      </Card>

      {/* --- Who is watching --- */}
      {breakdown ? (
        <>
          <SectionHeader title="Audience" />
          <Card>
            <SegmentBar breakdown={breakdown} height={12} />
            <SegmentLegend breakdown={breakdown} />
            <Text style={styles.hint}>
              Advertisers pay most for young adults, least for over-55s.
            </Text>
          </Card>
        </>
      ) : null}

      {/* --- The deal --- */}
      <SectionHeader title="Broadcast" />
      <Card>
        {production.deal && network ? (
          <>
            <View style={styles.statRow}>
              <Stat label="Channel" value={network.name} />
              <Stat
                label="When it's on"
                value={
                  production.deal.slotKey === 'stream'
                    ? 'Streaming'
                    : formatSlotKey(production.deal.slotKey)
                }
                align="right"
              />
            </View>
          </>
        ) : (
          <EmptyState
            title="No channel is showing it yet"
            body="Channels make offers for finished shows. Check New Shows to see who wants it."
          />
        )}
      </Card>

      {/* --- Where the money goes, per episode --- */}
      <SectionHeader title="Money" />
      <Card>
        <View style={styles.moneyHead}>
          <Text style={styles.moneyHeadLabel}>PER EPISODE</Text>
        </View>

        {economics.lines.map((line) => (
          <View key={line.label} style={styles.moneyRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.moneyLabel}>{line.label}</Text>
              <Text style={styles.moneyDetail}>{line.detail}</Text>
            </View>
            <Text style={[styles.moneyAmount, { color: deltaColor(line.amount) }]}>
              {line.amount >= 0 ? '+' : '−'}
              {formatMoneyShort(Math.abs(line.amount))}
            </Text>
          </View>
        ))}

        <View style={styles.moneyTotalRow}>
          <Text style={styles.moneyTotalLabel}>Per episode</Text>
          <Text
            style={[styles.moneyTotalValue, { color: deltaColor(economics.perEpisode) }]}
          >
            {economics.perEpisode >= 0 ? '+' : '−'}
            {formatMoneyShort(Math.abs(economics.perEpisode))}
          </Text>
        </View>

        <View style={styles.moneySeriesRow}>
          <Text style={styles.moneySeriesLabel}>
            Per series ({economics.episodesPerSeries} episodes)
          </Text>
          <Text
            style={[styles.moneySeriesValue, { color: deltaColor(economics.perSeries) }]}
          >
            {economics.perSeries >= 0 ? '+' : '−'}
            {formatMoneyShort(Math.abs(economics.perSeries))}
          </Text>
        </View>

        {/* Repeats are the counterweight — show the target as a number, not a lecture. */}
        <View style={styles.repeatTarget}>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Episodes</Text>
            <Text style={styles.repeatTargetValue}>{production.totalEpisodes}</Text>
          </View>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Needed for repeats</Text>
            <Text style={styles.repeatTargetValue}>{RERUN_MINIMUM_EPISODES}</Text>
          </View>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Repeats worth</Text>
            <Text
              style={[
                styles.repeatTargetValue,
                { color: canSellReruns(production) ? colors.positive : colors.textFaint },
              ]}
            >
              {formatMoneyShort(rerunWeeklyValue(production))}/wk
            </Text>
          </View>
        </View>
      </Card>

      {/* --- Budget --- */}
      <SectionHeader title="Budget" />
      <Card>
        <View style={styles.statRow}>
          <Stat
            label="Each episode"
            value={formatMoneyShort(production.budgetPerEpisode)}
            sub={`${(budgetRatio * 100).toFixed(0)}% of standard`}
          />
          <Stat
            label="Is it enough?"
            value={String(Math.round(funding))}
            valueColor={scoreColor(funding)}
            align="right"
            sub={`marketing ${formatMoneyShort(production.marketingPerEpisode)}`}
          />
        </View>

        <View style={styles.budgetButtons}>
          {[0.7, 0.85, 1, 1.25, 1.6].map((multiplier) => {
            const active = Math.abs(budgetRatio - multiplier) < 0.03;
            return (
              <Pressable
                key={multiplier}
                testID={`budget-${multiplier}x`}
                disabled={!canEditBudget}
                onPress={() => adjustBudget(multiplier)}
                style={[
                  styles.budgetChip,
                  active && styles.budgetChipActive,
                  !canEditBudget && styles.budgetChipDisabled,
                ]}
              >
                <Text style={[styles.budgetChipText, active && styles.budgetChipTextActive]}>
                  {multiplier}×
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.hint}>
          {canEditBudget
            ? 'Under 70% and quality drops fast. Over 100% barely helps.'
            : 'Locked while a series is on air.'}
        </Text>
      </Card>

      {/* --- Creative profile --- */}
      <SectionHeader title="Profile" />
      <Card>
        {AXES.map((axis) => (
          <ScoreBar key={axis} label={axisLabel(axis)} value={production.attributes[axis]} />
        ))}
      </Card>

      {/* --- Cast & crew --- */}
      <SectionHeader title={`Cast & crew (${cast.length})`} />
      <Card padded={false}>
        {cast.length === 0 ? (
          <EmptyState title="Nobody attached" body="This show has no cast or crew." />
        ) : (
          cast.map((person, index) => (
            <View
              key={person.id}
              style={[styles.castRow, index === cast.length - 1 && { borderBottomWidth: 0 }]}
            >
              <Avatar name={person.name} size={30} style={{ marginRight: space.sm }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.castName}>{person.name}</Text>
                <Text style={styles.castRole}>
                  {person.role} · age {person.age}
                </Text>
              </View>
              <View style={styles.castStats}>
                <Text style={styles.castStat}>
                  <Text style={{ color: colors.textFaint }}>craft </Text>
                  <Text style={{ color: scoreColor(person.craft) }}>
                    {Math.round(person.craft)}
                  </Text>
                </Text>
                <Text style={styles.castStat}>
                  <Text style={{ color: colors.textFaint }}>star </Text>
                  <Text style={{ color: colors.text }}>{Math.round(person.starPower)}</Text>
                </Text>
                <Text style={styles.castSalary}>
                  {formatMoneyShort(person.contractSalaryPerEpisode ?? person.baseSalaryPerEpisode)}
                </Text>
              </View>
            </View>
          ))
        )}
        {cast.length > 0 ? (
          <View style={styles.castTotal}>
            <Text style={type.small}>Talent cost</Text>
            <Text style={styles.castTotalValue}>{formatMoneyShort(talentCost)}/ep</Text>
          </View>
        ) : null}
      </Card>

      {/* --- History --- */}
      {production.history.length > 0 ? (
        <>
          <SectionHeader title="Series history" />
          <Card padded={false}>
            <View style={[styles.historyRow, styles.historyHead]}>
              <Text style={[styles.historyCell, styles.historyHeadText, { flex: 0.6 }]}>S</Text>
              <Text style={[styles.historyCell, styles.historyHeadText]}>EPS</Text>
              <Text style={[styles.historyCell, styles.historyHeadText]}>WATCHED</Text>
              <Text style={[styles.historyCell, styles.historyHeadText, { flex: 1.4 }]}>
                YOU MADE
              </Text>
            </View>
            {production.history.map((season) => (
              <View key={season.season} style={styles.historyRow}>
                <Text style={[styles.historyCell, { flex: 0.6 }]}>{season.season}</Text>
                <Text style={styles.historyCell}>{season.episodes}</Text>
                <Text style={styles.historyCell}>{season.averageViewers.toFixed(1)}M</Text>
                <Text
                  style={[
                    styles.historyCell,
                    { flex: 1.4, color: season.studioProfit >= 0 ? colors.positive : colors.negative },
                  ]}
                >
                  {formatMoneyShort(season.studioProfit)}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* --- You own this show --- */}
      <SectionHeader title="Rights" />
      <Card>
        {ownsRights ? (
          <>
            <View style={styles.statRow}>
              <Stat label="Ownership" value="100%" valueColor={colors.positive} />
              <Stat
                label="Sale value"
                value={formatMoneyShort(rightsSaleValue(production))}
                align="right"
                valueColor={colors.positive}
              />
            </View>

            {/* Repeat deals already running */}
            {production.rerunDeals.length > 0 ? (
              <View style={styles.dealsBox}>
                <Text style={styles.dealsLabel}>SHOWING REPEATS RIGHT NOW</Text>
                {production.rerunDeals.map((deal) => (
                  <View key={deal.id} style={styles.dealRow}>
                    <Text style={styles.dealBuyer}>{deal.buyerName}</Text>
                    <Text style={styles.dealPay}>
                      +{formatMoneyShort(deal.weeklyPayment)}/wk
                    </Text>
                    <Text style={styles.dealWeeks}>
                      {Math.round(deal.weeksRemaining / 52) > 0
                        ? `${(deal.weeksRemaining / 52).toFixed(1)}y left`
                        : `${deal.weeksRemaining}w left`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Buyers for repeats */}
            {!canSellReruns(production) ? (
              <View style={styles.lockedBox}>
                <Text style={styles.lockedLabel}>REPEATS LOCKED</Text>
                <Text style={styles.lockedValue}>
                  {RERUN_MINIMUM_EPISODES - production.totalEpisodes} more episodes
                </Text>
              </View>
            ) : null}

            {canSellReruns(production) ? (
              bids.length > 0 ? (
                <>
                  <Text style={styles.subHeading}>Sell the repeats</Text>
                  <Text style={styles.ownHint}>
                    You keep the show. Sell to as many as you like.
                  </Text>
                  {bids.slice(0, 4).map((bid) => (
                    <View key={bid.buyerId} style={styles.bidRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bidBuyer}>{bid.buyerName}</Text>
                        <Text style={styles.bidTerms}>
                          {formatMoneyShort(bid.weeklyPayment)} a week for{' '}
                          {(bid.weeks / 52).toFixed(0)} years
                        </Text>
                      </View>
                      <Button
                        label="Sell"
                        testID={`license-reruns-${bid.buyerId}`}
                        variant="secondary"
                        onPress={() => run((g) => licenseReruns(g, production.id, bid.buyerId))}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <Text style={styles.ownHint}>All buyers taken.</Text>
              )
            ) : null}

            {/* Sell outright */}
            {confirmSell ? (
              <View style={styles.sellConfirm}>
                <View style={styles.sellRow}>
                  <Text style={styles.sellLabel}>Cash now</Text>
                  <Text style={[styles.sellValue, { color: colors.positive }]}>
                    +{formatMoneyShort(rightsSaleValue(production))}
                  </Text>
                </View>
                <View style={styles.sellRow}>
                  <Text style={styles.sellLabel}>Lost income / wk</Text>
                  <Text style={[styles.sellValue, { color: colors.negative }]}>
                    −{formatMoneyShort(rerunWeeklyValue(production))}
                  </Text>
                </View>
                <View style={styles.sellRow}>
                  <Text style={styles.sellLabel}>Reversible</Text>
                  <Text style={styles.sellValue}>no</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                  <Button
                    label="Keep it"
                    testID="cancel-sell-rights"
                    variant="secondary"
                    style={{ flex: 1 }}
                    onPress={() => setConfirmSell(false)}
                  />
                  <Button
                    label="Sell it"
                    testID="confirm-sell-rights"
                    variant="danger"
                    style={{ flex: 1 }}
                    onPress={() => {
                      run((g) => sellRights(g, production.id));
                      setConfirmSell(false);
                    }}
                  />
                </View>
              </View>
            ) : (
              <Button
                label={`Sell the show for ${formatMoneyShort(rightsSaleValue(production))}`}
                testID="sell-rights"
                variant="ghost"
                style={{ marginTop: space.md }}
                onPress={() => setConfirmSell(true)}
              />
            )}
          </>
        ) : (
          <View>
            <Pill label="sold" tone="negative" />
            <Text style={styles.ownBody}>
              Sold to {game.companies[production.rightsOwnerId]?.name ?? 'another company'}.
            </Text>
          </View>
        )}
      </Card>

      {/* --- Danger zone --- */}
      <SectionHeader title="Actions" />
      {confirmCancel ? (
        <Card>
          <Text style={styles.confirmText}>
            Stopping frees up the cast and crew, but you stop earning from it.
            {toSyndication > 0 && production.totalEpisodes > 0
              ? ` You are only ${toSyndication} episodes away from being able to sell repeats forever. Everything you have spent on it so far would be wasted.`
              : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button
              label="Keep it"
              testID="keep-show"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => setConfirmCancel(false)}
            />
            <Button
              label="Stop it"
              testID="confirm-cancel-show"
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => {
                run((g) => cancelOwnShow(g, production.id));
                onClose();
              }}
            />
          </View>
        </Card>
      ) : (
        <Button
          label="Stop making this show"
          testID="cancel-show"
          variant="danger"
          onPress={() => setConfirmCancel(true)}
        />
      )}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------------- */
/* The idea view                                                              */
/* ------------------------------------------------------------------------- */

/**
 * An idea nobody has made yet.
 *
 * There is no ratings history, no cast, no P&L — so where the production view prints
 * what happened, this prints what would happen: the estimate from `estimateNewShow`
 * and the audience the attribute profile would reach at its ceiling. Everything on
 * screen is a projection, and the PROJECTED banner says so once rather than hedging
 * every figure.
 */
function ArchetypeDetail({
  archetypeId,
  onClose,
  onOpenProduction,
}: {
  archetypeId: string;
  onClose: () => void;
  onOpenProduction?: (id: string) => void;
}) {
  const game = useGame();
  const run = useAction();

  const archetype: ShowArchetype | undefined = ARCHETYPES_BY_ID[archetypeId];

  // A show already in production anywhere in the world blocks a second commission,
  // so find it once and offer it as a destination instead of a dead button.
  const existing = useMemo(() => {
    if (!game || !archetype) return undefined;
    return Object.values(game.productions).find(
      (p) =>
        p.archetypeId === archetype.id && p.status !== 'cancelled' && p.status !== 'ended',
    );
  }, [game, archetype]);

  const audience = useMemo(
    () => (archetype ? potentialAudience(archetype.attributes) : undefined),
    [archetype],
  );

  if (!game || !archetype || !audience) {
    return (
      <View style={styles.screen}>
        <Header title="Show" onClose={onClose} />
        <EmptyState title="No such show." />
      </View>
    );
  }

  const est = estimateNewShow(archetype);
  const cash = totalCash(game);
  const after = cash + est.perSeries;
  const affordable = after > 0;
  const reach = Object.values(audience).reduce((sum, v) => sum + v, 0);
  const best = Object.entries(audience).sort((a, b) => b[1] - a[1])[0];
  const mine = existing ? existing.ownerId === game.player.studioId : false;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Header title={archetype.title} onClose={onClose} />

      <View style={styles.heroRow}>
        <Poster seed={archetype.id} format={archetype.format} size="lg" />
        <View style={{ flex: 1 }}>
          <Text style={styles.logline}>{archetype.logline}</Text>
        </View>
      </View>

      <View style={styles.tagRow}>
        <Pill label={archetype.format} tone="accent" />
        <Pill label={archetype.genre} />
        <Pill label={archetype.era} />
        {existing ? <Pill label={mine ? 'yours' : 'taken'} tone="info" /> : null}
      </View>

      {/* --- What it would cost --- */}
      <SectionHeader title="Projection" />
      <Card>
        <View style={styles.projectedHead}>
          <Icon name="bulb" size={12} color={colors.textFaint} />
          <Text style={styles.projectedLabel}>NOT COMMISSIONED — ESTIMATES</Text>
        </View>

        <View style={styles.statRow}>
          <Stat label="Cost / ep" value={formatMoneyShort(est.costPerEpisode)} />
          <Stat label="Episodes" value={String(est.episodes)} align="right" />
        </View>
        <Divider />
        <View style={styles.statRow}>
          <Stat
            label="Whole series"
            value={formatMoneyShort(est.seriesCost)}
            sub={`budget ${formatMoneyShort(est.budget)} + ads ${formatMoneyShort(est.marketing)}`}
          />
          <Stat
            label="Fee / ep"
            value={formatMoneyShort(est.expectedFee)}
            sub="channel pays"
            align="right"
          />
        </View>

        <View style={styles.moneyTotalRow}>
          <Text style={styles.moneyTotalLabel}>Per episode</Text>
          <Text style={[styles.moneyTotalValue, { color: deltaColor(est.perEpisode) }]}>
            {est.perEpisode >= 0 ? '+' : '−'}
            {formatMoneyShort(Math.abs(est.perEpisode))}
          </Text>
        </View>

        <View style={styles.moneySeriesRow}>
          <Text style={styles.moneySeriesLabel}>Per series ({est.episodes} episodes)</Text>
          <Text style={[styles.moneySeriesValue, { color: deltaColor(est.perSeries) }]}>
            {est.perSeries >= 0 ? '+' : '−'}
            {formatMoneyShort(Math.abs(est.perSeries))}
          </Text>
        </View>

        <View style={styles.repeatTarget}>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Cash now</Text>
            <Text style={styles.repeatTargetValue}>{formatMoneyShort(cash)}</Text>
          </View>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Cash after</Text>
            <Text style={[styles.repeatTargetValue, { color: deltaColor(after) }]}>
              {formatMoneyShort(after)}
            </Text>
          </View>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Needed for repeats</Text>
            <Text style={styles.repeatTargetValue}>{RERUN_MINIMUM_EPISODES}</Text>
          </View>
          <View style={styles.repeatTargetRow}>
            <Text style={styles.repeatTargetLabel}>Series until repeats</Text>
            <Text style={styles.repeatTargetValue}>{est.seriesToRepeats}</Text>
          </View>
        </View>
      </Card>

      {/* --- Who it is aimed at: the ceiling, not a forecast of week one --- */}
      <SectionHeader title="Audience" />
      <Card>
        <View style={styles.statRow}>
          <Stat label="Ceiling" value={`${reach.toFixed(1)}M`} sub="if everyone knew" />
          <Stat
            label="Best fit"
            value={segmentLabel(best?.[0] ?? '')}
            sub={`${(best?.[1] ?? 0).toFixed(1)}M`}
            align="right"
          />
        </View>
        <View style={{ marginTop: space.md }}>
          <SegmentBar breakdown={audience} height={12} />
          <SegmentLegend breakdown={audience} />
        </View>
      </Card>

      {/* --- Creative profile --- */}
      <SectionHeader title="Profile" />
      <Card>
        {AXES.map((axis) => (
          <ScoreBar key={axis} label={axisLabel(axis)} value={archetype.attributes[axis]} />
        ))}
      </Card>

      {/* --- What it takes to make --- */}
      <SectionHeader title="Shoot" />
      <Card>
        <View style={styles.statRow}>
          <Stat label="Cast & crew" value={String(archetype.castSize)} />
          <Stat
            label="Standard cost"
            value={`${formatMoneyShort(archetype.baseCostPerEpisode)}/ep`}
            align="right"
          />
        </View>
        {archetype.requiredRoles.length > 0 ? (
          <View style={styles.repeatTarget}>
            {archetype.requiredRoles.map((role) => (
              <View key={role} style={styles.repeatTargetRow}>
                <Text style={styles.repeatTargetLabel}>{role}</Text>
                <Text style={styles.repeatTargetValue}>required</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* --- Commission --- */}
      <SectionHeader title="Actions" />
      {existing ? (
        <Card>
          <View style={styles.statRow}>
            <Stat
              label="In production"
              value={game.companies[existing.ownerId]?.name ?? 'another studio'}
              sub={existing.status}
            />
            <Stat label="Season" value={String(existing.season)} align="right" />
          </View>
          <Button
            label="Open the production"
            testID="open-production"
            variant="secondary"
            style={{ marginTop: space.md }}
            onPress={() => onOpenProduction?.(existing.id)}
          />
        </Card>
      ) : (
        <>
          <Button
            label={`Commission for ${formatMoneyShort(est.seriesCost)}`}
            testID="commission-archetype"
            disabled={!affordable}
            onPress={() => {
              const production = run((g) => developOriginal(g, archetype.id));
              // Straight into the production view — the idea is now a real thing.
              if (production) onOpenProduction?.(production.id);
            }}
          />
          {!affordable ? (
            <View style={styles.lockedBox}>
              <Text style={styles.lockedLabel}>SHORT BY</Text>
              <Text style={[styles.lockedValue, { color: colors.negative }]}>
                {formatMoneyShort(Math.abs(after))}
              </Text>
            </View>
          ) : null}
        </>
      )}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.header}>
      <Text style={[type.title, { flex: 1 }]} numberOfLines={2}>
        {title}
      </Text>
      <Pressable testID="close-show" onPress={onClose} hitSlop={12} style={styles.close}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  );
}

/** Segment ids are camelCase keys; the legend prints the same short forms. */
function segmentLabel(id: string): string {
  if (!id) return '—';
  if (id === 'youngAdults') return 'Young';
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function axisLabel(axis: string): string {
  if (axis === 'wholesomeness') return 'Wholesome';
  if (axis === 'entertainment') return 'Entertain';
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.sm },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },

  logline: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
  heroRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', marginTop: space.md },
  tagRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },

  statRow: { flexDirection: 'row', justifyContent: 'space-between' },

  deficitBox: {
    marginTop: space.md,
    padding: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 6,
    borderLeftWidth: 3,
  },
  deficitLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1, color: colors.textFaint },
  deficitValue: { fontSize: 18, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  deficitBody: { fontSize: 11, color: colors.textDim, marginTop: space.xs, lineHeight: 16 },

  budgetButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  budgetChip: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  budgetChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  budgetChipDisabled: { opacity: 0.4 },
  budgetChipText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  budgetChipTextActive: { color: '#1A1206' },

  hint: { fontSize: 11, color: colors.textFaint, marginTop: space.md, lineHeight: 16 },

  projectedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: space.sm,
  },
  projectedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: colors.textFaint },

  castRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  castName: { fontSize: 13, color: colors.text, fontWeight: '500' },
  castRole: { fontSize: 10, color: colors.textFaint, marginTop: 1 },
  castStats: { alignItems: 'flex-end' },
  castStat: { fontSize: 11, fontVariant: ['tabular-nums'] },
  castSalary: { fontSize: 10, color: colors.textDim, marginTop: 1 },
  castTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.md,
    backgroundColor: colors.surfaceAlt,
  },
  castTotalValue: { fontSize: 13, fontWeight: '700', color: colors.text },

  historyRow: {
    flexDirection: 'row',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyHead: { backgroundColor: colors.surfaceAlt },
  historyHeadText: { fontSize: 9, color: colors.textFaint, fontWeight: '700', letterSpacing: 0.8 },
  historyCell: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  confirmText: { fontSize: 12, color: colors.textDim, lineHeight: 18 },

  moneyHead: { marginBottom: space.sm },
  moneyHeadLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: colors.textFaint },
  moneyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moneyLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  moneyDetail: { fontSize: 10, color: colors.textFaint, marginTop: 1 },
  moneyAmount: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  moneyTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.sm,
  },
  moneyTotalLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  moneyTotalValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  moneySeriesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 2,
    borderTopColor: colors.text,
  },
  moneySeriesLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  moneySeriesValue: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },

  repeatTarget: {
    marginTop: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: space.sm,
  },
  repeatTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  repeatTargetLabel: { fontSize: 11, color: colors.textDim },
  repeatTargetValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  lockedBox: {
    marginTop: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: space.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lockedLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2, color: colors.textFaint },
  lockedValue: { fontSize: 12, fontWeight: '700', color: colors.text },

  sellRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  sellLabel: { fontSize: 12, color: colors.text },
  sellValue: { fontSize: 13, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },

  ownBody: { fontSize: 13, color: colors.textDim, lineHeight: 19, marginTop: space.sm },
  ownHint: { fontSize: 11, color: colors.textFaint, lineHeight: 16, marginTop: space.xs },
  subHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    marginTop: space.lg,
  },
  dealsBox: {
    marginTop: space.md,
    backgroundColor: colors.positiveSoft,
    borderRadius: 8,
    padding: space.sm,
  },
  dealsLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.positive,
    marginBottom: 4,
  },
  dealRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 3 },
  dealBuyer: { flex: 1, fontSize: 12, color: colors.text, fontWeight: '600' },
  dealPay: { fontSize: 12, fontWeight: '700', color: colors.positive, fontVariant: ['tabular-nums'] },
  dealWeeks: { fontSize: 10, color: colors.textFaint, width: 56, textAlign: 'right' },

  bidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bidBuyer: { fontSize: 13, color: colors.text, fontWeight: '600' },
  bidTerms: { fontSize: 11, color: colors.textDim, marginTop: 1 },

  sellConfirm: {
    marginTop: space.md,
    backgroundColor: colors.negativeSoft,
    borderRadius: 8,
    padding: space.md,
  },
  sellWarn: { fontSize: 12, color: colors.text, lineHeight: 18 },
});
