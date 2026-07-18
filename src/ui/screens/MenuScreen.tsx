import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useGame, useGameStore } from '../../store/gameStore';
import { AUTOSAVE_ID, deleteSlot, formatSavedAt } from '../../store/saves';
import { Button, Card, EmptyState } from '../components';
import { colors, formatMoneyShort, space, type } from '../theme';
import { useOnboarding } from '../Onboarding';

/**
 * Pause menu — save, load, quit.
 *
 * Table stakes for anything that calls itself a game. The autosave keeps running in
 * the background, but a player needs to be able to keep a run deliberately, go back
 * to an earlier one, and leave without feeling like they have lost something.
 */
export function MenuScreen({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const slots = useGameStore((s) => s.slots);
  const refreshSlots = useGameStore((s) => s.refreshSlots);
  const saveAs = useGameStore((s) => s.saveAs);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const quitToTitle = useGameStore((s) => s.quitToTitle);
  const onboarding = useOnboarding();

  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);

  useEffect(() => {
    void refreshSlots();
  }, [refreshSlots]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(timer);
  }, [flash]);

  const doSave = async (name: string) => {
    setBusy(true);
    await saveAs(name);
    setBusy(false);
    setSaveName('');
    setFlash('Saved');
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={type.title}>Menu</Text>
        <Pressable testID="close-menu" onPress={onClose} hitSlop={12} style={styles.close}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {flash ? (
        <View style={styles.flash}>
          <Text style={styles.flashText}>{flash}</Text>
        </View>
      ) : null}

      {/* --- Save --- */}
      {game ? (
        <Card style={{ marginTop: space.lg }}>
          <Text style={styles.label}>SAVE GAME</Text>
          <View style={styles.saveRow}>
            <TextInput
              value={saveName}
              onChangeText={setSaveName}
              placeholder={`Year ${game.year}, week ${game.week}`}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              maxLength={32}
            />
            <Button
              label="Save"
              testID="save-game"
              busy={busy}
              onPress={() =>
                void doSave(saveName || `Year ${game.year}, week ${game.week}`)
              }
            />
          </View>
        </Card>
      ) : null}

      {/* --- Load --- */}
      <Card style={{ marginTop: space.md }} padded={false}>
        <View style={{ padding: space.md, paddingBottom: space.sm }}>
          <Text style={styles.label}>SAVED GAMES</Text>
        </View>

        {slots.length === 0 ? (
          <EmptyState title="No saves yet" />
        ) : (
          slots.map((slot, index) => (
            <View
              key={slot.id}
              style={[styles.slot, index === slots.length - 1 && { borderBottomWidth: 0 }]}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.slotTop}>
                  <Text style={styles.slotName} numberOfLines={1}>
                    {slot.name}
                  </Text>
                  {slot.id === AUTOSAVE_ID ? (
                    <View style={styles.autoTag}>
                      <Text style={styles.autoTagText}>AUTO</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.slotMeta}>
                  {slot.studioName} · Y{slot.year} W{slot.week} ·{' '}
                  {formatMoneyShort(slot.cash)} · {slot.shows} show
                  {slot.shows === 1 ? '' : 's'}
                </Text>
                <Text style={styles.slotWhen}>{formatSavedAt(slot.savedAt)}</Text>
              </View>

              <View style={styles.slotActions}>
                <Button
                  label="Load"
                  variant="secondary"
                  onPress={() => {
                    void loadSlot(slot.id).then((ok) => {
                      if (ok) onClose();
                    });
                  }}
                />
                {slot.id !== AUTOSAVE_ID ? (
                  <Pressable
                    onPress={() => void deleteSlot(slot.id).then(refreshSlots)}
                    hitSlop={8}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))
        )}
      </Card>

      {/* --- Quit --- */}
      {game ? (
        <Card style={{ marginTop: space.md }}>
          <Text style={styles.label}>LEAVE</Text>
          {confirmQuit ? (
            <>
              <Text style={styles.quitNote}>Your progress is saved automatically.</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <Button
                  label="Stay"
                  variant="secondary"
                  style={{ flex: 1 }}
                  onPress={() => setConfirmQuit(false)}
                />
                <Button
                  label="Quit to title"
                  variant="danger"
                  style={{ flex: 1 }}
                  testID="confirm-quit"
                  onPress={() => {
                    quitToTitle();
                    onClose();
                  }}
                />
              </View>
            </>
          ) : (
            <Button
              label="Quit to title"
              variant="ghost"
              testID="quit-to-title"
              style={{ marginTop: space.sm }}
              onPress={() => setConfirmQuit(true)}
            />
          )}
        </Card>
      ) : null}

      {/* The introduction explains that a studio licenses shows to channels and lives
          on the library. That is the premise of the whole game, and someone who
          skipped it on day one has no other way to find it out. */}
      <Card style={{ marginTop: space.lg }}>
        <Button
          label="Replay the introduction"
          variant="ghost"
          testID="replay-onboarding"
          onPress={() => {
            onboarding.replay();
            onClose();
          }}
        />
      </Card>

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.textDim, fontSize: 14, fontWeight: '700' },

  flash: {
    marginTop: space.md,
    backgroundColor: colors.positiveSoft,
    borderRadius: 8,
    padding: space.sm,
  },
  flashText: { fontSize: 12, fontWeight: '700', color: colors.positive },

  label: { fontSize: 9, fontWeight: '800', letterSpacing: 1.3, color: colors.textFaint },

  saveRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: 14,
    minHeight: 44,
  },

  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  slotTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slotName: { fontSize: 14, fontWeight: '700', color: colors.text },
  autoTag: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  autoTagText: { fontSize: 8, fontWeight: '800', color: colors.textDim, letterSpacing: 0.6 },
  slotMeta: { fontSize: 11, color: colors.textDim, marginTop: 2 },
  slotWhen: { fontSize: 10, color: colors.textFaint, marginTop: 1 },

  slotActions: { alignItems: 'flex-end', gap: 4 },
  deleteButton: { paddingVertical: 2, paddingHorizontal: 4 },
  deleteText: { fontSize: 10, color: colors.negative, fontWeight: '600' },

  quitNote: { fontSize: 12, color: colors.textDim, marginTop: space.sm },
});
