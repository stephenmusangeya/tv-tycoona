import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAction, useGame } from '../store/gameStore';
import { acceptOffer, declineOffer, greenlightPitch, passOnPitch } from '../engine/actions';
import { formatSlotKey } from '../engine/schedule';
import { Button } from './components';
import { Poster } from './Poster';
import { FadeIn } from './motion';
import { colors, formatMoneyShort, space } from './theme';

/**
 * Decisions waiting on the player, on the home screen.
 *
 * This exists because of a bug you could only find by playing: a commissioned show
 * would sit unsold for a *simulated year* while channel offers piled up silently in
 * another tab. The player made one decision and then pressed a button fifty times
 * with nothing to react to.
 *
 * Anything that needs an answer now appears on the desk, so there is always something
 * to do rather than somewhere to go looking.
 */
/**
 * Anything with a poster on it should open. A card in the tray names a show the
 * player is being asked to decide about, and "what actually is this?" is the first
 * question — but the poster was inert, so the only way to find out was to accept it.
 * Offers open the production; pitches open the archetype, which is why this needs a
 * second opener rather than reusing the production one.
 */
export function DecisionDeck({
  onOpenShow,
  onOpenArchetype,
}: {
  onOpenShow: (id: string) => void;
  onOpenArchetype?: (archetypeId: string) => void;
}) {
  const game = useGame();
  const run = useAction();
  if (!game) return null;

  const offers = game.offers;
  const pitches = game.pitches;
  const unsold = Object.values(game.productions).filter(
    (p) =>
      p.ownerId === game.player.studioId &&
      p.status === 'hiatus' &&
      !p.deal &&
      !offers.some((o) => o.productionId === p.id),
  );

  const nothing = offers.length === 0 && pitches.length === 0 && unsold.length === 0;
  if (nothing) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.pulse} />
        <Text style={styles.headerText}>NEEDS YOUR DECISION</Text>
        <Text style={styles.count}>{offers.length + pitches.length}</Text>
      </View>

      {/* --- Channel offers: the thing that was invisible --- */}
      {offers.map((offer, index) => {
        const production = game.productions[offer.productionId];
        const channel = game.companies[offer.networkId];
        if (!production || !channel) return null;

        return (
          <FadeIn key={offer.id} delay={index * 50}>
            <View style={styles.card}>
              <Pressable
                testID={`tray-open-offer-${offer.id}`}
                onPress={() => onOpenShow(production.id)}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Poster seed={production.id} format={production.format} size="sm" />
              </Pressable>

              <View style={styles.body}>
                <Text style={styles.kicker}>OFFER · {channel.name.toUpperCase()}</Text>
                <Pressable
                  testID={`tray-open-offer-title-${offer.id}`}
                  onPress={() => onOpenShow(production.id)}
                >
                  <Text style={styles.title} numberOfLines={1}>
                    {production.title}
                  </Text>
                </Pressable>
                <View style={styles.figures}>
                  <Figure label="PER EP" value={formatMoneyShort(offer.licenseFeePerEpisode)} />
                  <Figure label="SLOT" value={formatSlotKey(offer.slotKey)} />
                  <Figure label="SERIES" value={String(offer.seasons)} />
                  <Figure
                    label="REACH"
                    value={`${Math.round((channel.reach ?? 0) * 100)}%`}
                  />
                </View>
              </View>

              <View style={styles.actions}>
                <Button
                  label="Accept"
                  testID="accept-offer"
                  onPress={() => run((g) => acceptOffer(g, offer.id))}
                />
                <Button
                  label="Pass"
                  variant="ghost"
                  onPress={() => run((g) => declineOffer(g, offer.id))}
                />
              </View>
            </View>
          </FadeIn>
        );
      })}

      {/* --- Pitches --- */}
      {pitches.map((pitch, index) => {
        const pitcher = game.talent[pitch.pitcherId];
        return (
          <FadeIn key={pitch.id} delay={(offers.length + index) * 50}>
            <View style={styles.card}>
              <Pressable
                testID={`tray-open-pitch-${pitch.id}`}
                onPress={() => onOpenArchetype?.(pitch.archetypeId)}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Poster seed={pitch.archetypeId} format={pitch.format} size="sm" />
              </Pressable>

              <View style={styles.body}>
                <Text style={[styles.kicker, { color: colors.info }]}>
                  PITCH · {(pitcher?.name ?? 'UNKNOWN').toUpperCase()}
                </Text>
                <Pressable
                  testID={`tray-open-pitch-title-${pitch.id}`}
                  onPress={() => onOpenArchetype?.(pitch.archetypeId)}
                >
                  <Text style={styles.title} numberOfLines={1}>
                    {pitch.title}
                  </Text>
                </Pressable>
                <View style={styles.figures}>
                  <Figure
                    label="PER EP"
                    value={formatMoneyShort(pitch.estimatedCostPerEpisode)}
                  />
                  <Figure label="CRAFT" value={String(Math.round(pitcher?.craft ?? 0))} />
                  <Figure label="STAR" value={String(Math.round(pitcher?.starPower ?? 0))} />
                </View>
              </View>

              <View style={styles.actions}>
                <Button
                  label="Make it"
                  onPress={() => {
                    const made = run((g) => greenlightPitch(g, pitch.id));
                    if (made) onOpenShow(made.id);
                  }}
                />
                <Button
                  label="Pass"
                  variant="ghost"
                  onPress={() => run((g) => passOnPitch(g, pitch.id))}
                />
              </View>
            </View>
          </FadeIn>
        );
      })}

      {/* --- Finished but nobody has bid yet: say so, with a number --- */}
      {unsold.map((production) => (
        <View key={production.id} style={[styles.card, styles.waiting]}>
          <Poster seed={production.id} format={production.format} size="sm" />
          <View style={styles.body}>
            <Text style={[styles.kicker, { color: colors.textFaint }]}>
              WAITING FOR AN OFFER
            </Text>
            <Text style={styles.title} numberOfLines={1}>
              {production.title}
            </Text>
            <Text style={styles.waitingNote}>Channels bid around the upfronts.</Text>
          </View>
          <View style={styles.actions}>
            <Button
              label="Open"
              variant="secondary"
              onPress={() => onOpenShow(production.id)}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.md, gap: space.sm },

  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  headerText: {
    flex: 1,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.accentDeep,
  },
  count: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
    backgroundColor: colors.accent,
    borderRadius: 9,
    minWidth: 18,
    textAlign: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: space.sm,
  },
  waiting: { borderColor: colors.border },

  body: { flex: 1 },
  kicker: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.accentDeep },
  title: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2 },

  figures: { flexDirection: 'row', gap: space.lg, marginTop: 6 },
  figureLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 0.8, color: colors.textFaint },
  figureValue: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },

  waitingNote: { fontSize: 10, color: colors.textFaint, marginTop: 4 },

  actions: { gap: 4, minWidth: 92 },
});
