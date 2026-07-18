import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import { freeAgents, playerShows } from '../../store/selectors';
import { castTalent } from '../../engine/actions';
import { TALENT_ROLES } from '../../engine/types';
import type { TalentState } from '../../engine/types';
import { Button, Card, EmptyState, Pill, SectionHeader } from '../components';
import { ScreenHeader, HeaderStat } from '../ScreenHeader';
import { Avatar } from '../Poster';
import { colors, formatMoneyShort, scoreColor, space, type } from '../theme';

/**
 * The talent market.
 *
 * Craft and star power are shown side by side and never combined into one number,
 * because the gap between them is where the good decisions are — the cheap unknown
 * with craft 80 and star 12 is the whole game, and averaging the two would hide her.
 */
export function TalentScreen() {
  const game = useGame();
  const run = useAction();
  const [role, setRole] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TalentState | null>(null);

  // Hooks must run unconditionally — see the note in DevelopmentScreen.
  const agents = useMemo(
    () => (game ? freeAgents(game, { role, search, limit: 50 }) : []),
    [game, role, search, game?.absoluteWeek, game?.nextId],
  );

  if (!game) return null;

  // Only shows that are not mid-season can be recast.
  const castable = playerShows(game).filter((p) => p.status !== 'airing');

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <ScreenHeader
        title="Talent"
        subtitle="Actors, writers, showrunners for hire"
        right={<HeaderStat label="AVAILABLE" value={String(agents.length)} />}
      />

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name"
        placeholderTextColor={colors.textFaint}
        style={styles.search}
        autoCorrect={false}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: space.sm }}
        contentContainerStyle={{ gap: space.xs }}
      >
        <Pressable
          onPress={() => setRole(undefined)}
          style={[styles.roleChip, !role && styles.roleChipActive]}
        >
          <Text style={[styles.roleChipText, !role && styles.roleChipTextActive]}>All</Text>
        </Pressable>
        {TALENT_ROLES.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r === role ? undefined : r)}
            style={[styles.roleChip, role === r && styles.roleChipActive]}
          >
            <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
              {r}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {agents.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <EmptyState title="Nobody available" body="Try a different role or clear the search." />
        </Card>
      ) : (
        <Card padded={false} style={{ marginTop: space.lg }}>
          {agents.map((person, index) => {
            const isSelected = selected?.id === person.id;
            return (
              <View key={person.id}>
                <Pressable
                  onPress={() => setSelected(isSelected ? null : person)}
                  style={[
                    styles.row,
                    index === agents.length - 1 && !isSelected && { borderBottomWidth: 0 },
                    isSelected && styles.rowSelected,
                  ]}
                >
                  <Avatar name={person.name} size={34} style={{ marginRight: space.md }} />
                  <View style={{ flex: 1, marginRight: space.sm }}>
                    <Text style={styles.name}>{person.name}</Text>
                    <Text style={styles.role}>
                      {person.role} · {person.age}
                    </Text>
                  </View>

                  <View style={styles.statBlock}>
                    <Text style={styles.statTiny}>CRAFT</Text>
                    <Text style={[styles.statValue, { color: scoreColor(person.craft) }]}>
                      {Math.round(person.craft)}
                    </Text>
                  </View>
                  <View style={styles.statBlock}>
                    <Text style={styles.statTiny}>STAR</Text>
                    <Text style={[styles.statValue, { color: scoreColor(person.starPower) }]}>
                      {Math.round(person.starPower)}
                    </Text>
                  </View>
                  <View style={[styles.statBlock, { width: 62 }]}>
                    <Text style={styles.statTiny}>PER EP</Text>
                    <Text style={styles.salary}>
                      {formatMoneyShort(person.baseSalaryPerEpisode)}
                    </Text>
                  </View>
                </Pressable>

                {isSelected ? (
                  <View style={styles.detail}>
                    <Text style={styles.bio}>{person.bio}</Text>

                    <View style={styles.detailStats}>
                      <DetailStat label="Reliability" value={person.reliability} />
                      <DetailStat label="Ego" value={person.ego} />
                      <DetailStat label="Versatility" value={person.versatility} />
                      <DetailStat label="Morale" value={person.morale} />
                    </View>

                    {Object.keys(person.genreAffinity).length > 0 ? (
                      <View style={styles.affinities}>
                        {Object.entries(person.genreAffinity)
                          .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                          .slice(0, 4)
                          .map(([format, value]) => (
                            <Pill
                              key={format}
                              label={`${format} ${Math.round(value ?? 0)}`}
                              tone={(value ?? 0) > 70 ? 'positive' : 'neutral'}
                            />
                          ))}
                      </View>
                    ) : null}

                    <SectionHeader title="Attach to a show" />
                    {castable.length === 0 ? (
                      <Text style={styles.hint}>
                        You have no shows that can be recast. Casting is locked once a season
                        is on air.
                      </Text>
                    ) : (
                      castable.map((production) => (
                        <Button
                          key={production.id}
                          label={production.title}
                          variant="secondary"
                          style={{ marginBottom: space.sm }}
                          onPress={() => {
                            const result = run((g) =>
                              castTalent(g, production.id, person.id),
                            );
                            if (result) setSelected(null);
                          }}
                        />
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}

      <View style={{ height: space.xxl }} />
    </ScrollView>
  );
}

function DetailStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.statTiny}>{label.toUpperCase()}</Text>
      <Text style={[styles.statValue, { color: scoreColor(value) }]}>{Math.round(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingTop: space.sm },

  search: {
    marginTop: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.text,
    fontSize: 14,
  },

  roleChip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  roleChipText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
  roleChipTextActive: { color: '#1A1206' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: colors.surfaceAlt, borderBottomWidth: 0 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  role: { fontSize: 10, color: colors.textFaint, marginTop: 1 },

  statBlock: { width: 44, alignItems: 'center' },
  statTiny: { fontSize: 8, fontWeight: '700', letterSpacing: 0.6, color: colors.textFaint },
  statValue: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 1 },
  salary: { fontSize: 11, color: colors.textDim, marginTop: 3, fontVariant: ['tabular-nums'] },

  detail: {
    padding: space.md,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bio: { fontSize: 12, color: colors.textDim, lineHeight: 18, fontStyle: 'italic' },
  detailStats: { flexDirection: 'row', marginTop: space.md },
  affinities: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  hint: { fontSize: 11, color: colors.textFaint, lineHeight: 16 },
});
