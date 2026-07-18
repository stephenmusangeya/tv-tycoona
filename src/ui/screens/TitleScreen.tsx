import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { useGameStore } from '../../store/gameStore';
import { AUTOSAVE_ID } from '../../store/saves';
import { colors, space } from '../theme';

/**
 * Title screen.
 *
 * The previous version was a white card with two paragraphs and a Start button — it
 * read as a newsletter signup, not a game. This is a dark broadcast room: a wall of
 * dim sets behind SMPTE colour bars, with the menu constrained to a sensible width
 * instead of stretching across the viewport.
 */

/** Classic SMPTE test-card bars — instantly legible as "television". */
const BARS = ['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'];

export function TitleScreen({ onOpenMenu }: { onOpenMenu: () => void }) {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const slots = useGameStore((s) => s.slots);
  const refreshSlots = useGameStore((s) => s.refreshSlots);

  const { width, height } = useWindowDimensions();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('Fledgling Pictures');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshSlots();
  }, [refreshSlots]);

  const autosave = slots.find((s) => s.id === AUTOSAVE_ID);

  // Slow scanline drift across the wall — the room feels powered, not painted.
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, {
        toValue: 1,
        duration: 7000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  const driftY = drift.interpolate({ inputRange: [0, 1], outputRange: [0, 60] });
  const tally = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  // A wall of sets sized to the viewport.
  const columns = Math.max(4, Math.round(width / 150));
  const rows = Math.max(3, Math.round(height / 150));

  const startGame = () => {
    setBusy(true);
    // Let the button paint its pressed state before world generation blocks.
    setTimeout(() => {
      startNewGame(name.trim() || 'Fledgling Pictures');
      setBusy(false);
    }, 30);
  };

  return (
    <View style={styles.screen}>
      {/* ---------- The wall ---------- */}
      <View style={styles.wall} pointerEvents="none">
        {Array.from({ length: rows }).map((_, r) => (
          <View key={r} style={styles.wallRow}>
            {Array.from({ length: columns }).map((__, c) => {
              // Deterministic variation so the wall looks arranged, not random noise.
              const seed = (r * 7 + c * 13) % 11;
              return (
                <View
                  key={c}
                  style={[
                    styles.set,
                    { opacity: 0.1 + (seed % 4) * 0.045 },
                    seed % 5 === 0 && { backgroundColor: '#241a12' },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>

      <Animated.View
        pointerEvents="none"
        style={[styles.scanlines, { transform: [{ translateY: driftY }] }]}
      >
        {Array.from({ length: 80 }).map((_, i) => (
          <View key={i} style={[styles.scanline, { top: i * 12 }]} />
        ))}
      </Animated.View>

      {/* ---------- The console ---------- */}
      <View style={styles.center}>
        <View style={styles.console}>
          {/* Colour bars */}
          <View style={styles.bars}>
            {BARS.map((c) => (
              <View key={c} style={[styles.bar, { backgroundColor: c }]} />
            ))}
          </View>

          <View style={styles.plate}>
            <View style={styles.tallyRow}>
              <Animated.View style={[styles.tallyDot, { opacity: tally }]} />
              <Text style={styles.tallyText}>ON AIR</Text>
            </View>

            <Text style={styles.logo}>TV TYCOON</Text>
            <Text style={styles.tagline}>RUN A STUDIO · BUY A NETWORK · OWN THE AIRWAVES</Text>
          </View>

          {/* Menu */}
          <View style={styles.menu}>
            {naming ? (
              <>
                <Text style={styles.fieldLabel}>NAME YOUR STUDIO</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                  placeholder="Fledgling Pictures"
                  placeholderTextColor="#5D6673"
                  autoCorrect={false}
                  maxLength={28}
                />
                <MenuButton
                  label={busy ? 'BUILDING THE INDUSTRY…' : 'START'}
                  testID="start-game"
                  primary
                  onPress={startGame}
                  disabled={busy}
                />
                <MenuButton label="BACK" onPress={() => setNaming(false)} />
              </>
            ) : (
              <>
                {autosave ? (
                  <MenuButton
                    label="CONTINUE"
                    testID="continue-game"
                    primary
                    sub={`${autosave.studioName} · Y${autosave.year} W${autosave.week}`}
                    onPress={() => void loadSlot(AUTOSAVE_ID)}
                  />
                ) : null}
                <MenuButton
                  label="NEW GAME"
                  testID="new-game"
                  primary={!autosave}
                  onPress={() => setNaming(true)}
                />
                <MenuButton label="LOAD GAME" testID="title-load" onPress={onOpenMenu} />
              </>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function MenuButton({
  label,
  sub,
  onPress,
  primary = false,
  disabled = false,
  testID,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.menuButton,
        primary && styles.menuButtonPrimary,
        pressed && !disabled && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.menuLabel, primary && styles.menuLabelPrimary]}>{label}</Text>
      {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0E13' },

  wall: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 10, gap: 10 },
  wallRow: { flexDirection: 'row', gap: 10, flex: 1 },
  set: {
    flex: 1,
    backgroundColor: '#161B22',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E252F',
  },

  scanlines: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#000',
    opacity: 0.35,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },

  console: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#12161D',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2C3542',
    overflow: 'hidden',
    boxShadow: '0px 18px 50px rgba(0, 0, 0, 0.55)',
  },

  bars: { flexDirection: 'row', height: 10 },
  bar: { flex: 1 },

  plate: { alignItems: 'center', paddingTop: space.xl, paddingBottom: space.lg },
  tallyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.md },
  tallyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E5484D' },
  tallyText: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: '#E5484D' },

  logo: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
    textAlign: 'center',
  },
  tagline: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: '#6B7686',
    marginTop: space.sm,
    textAlign: 'center',
  },

  menu: { padding: space.lg, paddingTop: 0, gap: space.sm },

  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#6B7686',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0B0E13',
    borderWidth: 1,
    borderColor: '#2C3542',
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: '#F5F7FA',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: space.sm,
  },

  menuButton: {
    paddingVertical: space.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2C3542',
    backgroundColor: '#1A1F28',
    minHeight: 46,
  },
  menuButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  menuLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4, color: '#C6CEDA' },
  menuLabelPrimary: { color: '#25150C' },
  menuSub: { fontSize: 9, color: '#25150C', opacity: 0.75, marginTop: 2, letterSpacing: 0.4 },
});
