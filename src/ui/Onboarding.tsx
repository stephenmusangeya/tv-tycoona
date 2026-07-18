import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, space } from './theme';
import { Icon, type IconName } from './icons';

/**
 * First-run coaching.
 *
 * The game opens on a room full of equipment and expects the player to know that a
 * studio makes shows, sells them to a channel, and lives on the difference. That is
 * three concepts before the first click, and none of them are visible in the fittings.
 * Anyone who has played a management sim will work it out; a new player downloading
 * this from a store will not, and will leave.
 *
 * So: four cards, shown once, each naming one thing and pointing at the control that
 * does it. Skippable on every card — a tutorial you cannot escape is worse than none.
 *
 * The "seen" flag lives in its own AsyncStorage key rather than in GameState on
 * purpose. Every new saved field needs a backfill in engine/migrate.ts or it crashes
 * old saves on the weekly tick, and "has this person seen the tutorial" is a property
 * of the device, not of the save file.
 */

const SEEN_KEY = 'tv-tycoon/onboarded/v1';

interface Step {
  icon: IconName;
  kicker: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: 'clapper',
    kicker: 'YOU RUN A STUDIO',
    title: 'You make shows. You do not own a channel.',
    body:
      'Studios make programmes and licence them to channels. The channel pays you a fee for every episode. Owning a channel comes later, and costs a great deal.',
  },
  {
    icon: 'ticket',
    kicker: 'HOW YOU EARN',
    title: 'The fee rarely covers the cost.',
    body:
      'Almost every show loses money per episode. You make it back on the library: past 100 episodes a show goes into repeats and pays you for years. That is the whole game.',
  },
  {
    icon: 'bulb',
    kicker: 'HOW YOU START',
    title: 'Green-light something.',
    body:
      'MAKE A SHOW opens the pitch table. Swipe right to commission, left to pass. Cheap formats — game shows, panel shows — reach repeats fastest.',
  },
  {
    icon: 'television',
    kicker: 'HOW TIME MOVES',
    title: 'Nothing happens until you play the week.',
    body:
      'PLAY WEEK on the desk advances time. Shows shoot, air and get their ratings. Watch the set — the overnights arrive on it.',
  },
];

/** Has this device seen the introduction? Undefined while we are still finding out. */
export function useOnboarding(): {
  show: boolean;
  dismiss: () => void;
  replay: () => void;
} {
  const [seen, setSeen] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(SEEN_KEY);
        if (alive) setSeen(raw === '1');
      } catch {
        // A storage failure must never block the game — assume they have seen it.
        if (alive) setSeen(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return {
    // Undefined means "still loading" — showing then hiding would flash the overlay.
    show: seen === false,
    dismiss: () => {
      setSeen(true);
      void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
    },
    replay: () => {
      setSeen(false);
      void AsyncStorage.removeItem(SEEN_KEY).catch(() => {});
    },
  };
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <View style={styles.scrim}>
      <View style={styles.card} testID="onboarding-card">
        <View style={styles.head}>
          <View style={styles.badge}>
            <Icon name={current.icon} size={22} color={colors.accent} />
          </View>
          <Text style={styles.kicker}>{current.kicker}</Text>
        </View>

        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>

        <View style={styles.pips}>
          {STEPS.map((s, i) => (
            <View key={s.kicker} style={[styles.pip, i === step && styles.pipOn]} />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="onboarding-skip"
            onPress={onDone}
            style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.skipText}>SKIP</Text>
          </Pressable>

          <Pressable
            testID="onboarding-next"
            onPress={() => (last ? onDone() : setStep((n) => n + 1))}
            style={({ pressed }) => [styles.next, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.nextText}>{last ? "LET'S GO" : 'NEXT'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(36,30,26,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    zIndex: 50,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderBright,
    padding: space.xl,
    gap: space.md,
    boxShadow: '0px 18px 44px rgba(0,0,0,0.4)',
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.6, color: colors.accent },

  title: { fontSize: 19, fontWeight: '900', color: colors.text, lineHeight: 25 },
  body: { fontSize: 13, color: colors.textDim, lineHeight: 20 },

  pips: { flexDirection: 'row', gap: 5, marginTop: space.xs },
  pip: {
    width: 18,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
  },
  pipOn: { backgroundColor: colors.accent },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  skip: { paddingVertical: space.sm, paddingHorizontal: space.md },
  skipText: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.textFaint },
  next: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  nextText: { fontSize: 12, fontWeight: '900', letterSpacing: 1, color: '#F7F1E4' },
});
