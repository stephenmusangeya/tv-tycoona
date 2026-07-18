import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { useAction, useGame } from '../../store/gameStore';
import { freeAgents, playerShows, roster, rosterCostPerEpisode } from '../../store/selectors';
import { castTalent } from '../../engine/actions';
import { TALENT_ROLES } from '../../engine/types';
import type { Production, TalentRole, TalentState } from '../../engine/types';
import { Avatar } from '../Poster';
import { Icon, WalkOfFameStar, type IconName } from '../icons';
import { Room, Deck, Panel, Readout } from '../game/Room';
import { colors, formatMoneyShort, radius, scoreColor, space } from '../theme';

/**
 * The casting rolodex.
 *
 * Talent used to be a scrolling table of rows, which made hiring a person feel like
 * picking a line item. It is now a place: the people you have signed are brass stars
 * set into the pavement across the top — the only screen in the game that pays you in
 * status rather than money — and the market underneath is a card index you flick
 * sideways through rather than a list you read downwards.
 *
 * Craft and star power are still shown side by side and never averaged, because the
 * gap between them is where the good decisions are: the cheap unknown with craft 80
 * and star 12 is the whole game, and one combined number would hide her.
 */
export function TalentScreen() {
  const game = useGame();
  const run = useAction();
  const { width } = useWindowDimensions();
  const [role, setRole] = useState<TalentRole | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Hooks must run unconditionally — see the note in DevelopmentScreen.
  const agents = useMemo(
    () => (game ? freeAgents(game, { role, search, limit: 60 }) : []),
    [game, role, search, game?.absoluteWeek, game?.nextId],
  );

  if (!game) return null;

  const wide = width > 820;
  const shows = playerShows(game);

  // Everyone under contract, paired with the production they are attached to, so a
  // star can be read as "who, on what, for how much" without a second lookup.
  const signed: Array<{ person: TalentState; production: Production }> = [];
  for (const production of shows) {
    for (const person of roster(game, production)) signed.push({ person, production });
  }
  signed.sort((a, b) => b.person.starPower - a.person.starPower);

  const wageBill = shows.reduce((sum, p) => sum + rosterCostPerEpisode(game, p), 0);

  // Casting is locked once a season is on air, so only these shows can take a signing.
  const castable = shows.filter((p) => p.status !== 'airing');
  const selected = selectedId ? (agents.find((p) => p.id === selectedId) ?? null) : null;

  return (
    <Room>
      {/* ---------------- Title bar: the wage bill is the number that bites -------- */}
      <View style={styles.topBar}>
        <Text style={styles.roomName}>CASTING</Text>
        <View style={styles.topStats}>
          <Readout label="SIGNED" value={String(signed.length)} size="sm" />
          <Readout
            label="WAGES / EP"
            value={formatMoneyShort(wageBill)}
            size="sm"
            color={wageBill > 0 ? colors.negative : undefined}
          />
          <Readout label="FREE" value={String(agents.length)} size="sm" />
        </View>
      </View>

      {/* ---------------- Upper deck: the pavement ---------------- */}
      <Deck flex={wide ? 3 : 2}>
        <Panel title="WALK OF FAME" flex={1} accent="#C08A1E">
          {signed.length === 0 ? (
            <EmptyPavement />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              testID="walk-of-fame-scroll"
              contentContainerStyle={styles.pavement}
            >
              {signed.map(({ person, production }) => (
                <StarSlab
                  key={person.id}
                  person={person}
                  production={production}
                  size={wide ? 96 : 76}
                />
              ))}
            </ScrollView>
          )}
        </Panel>
      </Deck>

      {/* ---------------- Lower deck: the card index, and the dossier -------------- */}
      <Deck flex={wide ? 4 : 5} style={!wide && { flexDirection: 'column' }}>
        <Panel title="ROLODEX" flex={wide ? 5 : selected ? 3 : 1}>
          <View style={styles.filters}>
            <View style={styles.searchBox}>
              <Icon name="magnifier" size={13} color={colors.textFaint} />
              <TextInput
                testID="talent-search"
                value={search}
                onChangeText={setSearch}
                placeholder="NAME"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                autoCorrect={false}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabs}
            >
              <RoleTab
                testID="role-tab-all"
                label="ALL"
                icon="star"
                active={!role}
                onPress={() => setRole(undefined)}
              />
              {TALENT_ROLES.map((r) => (
                <RoleTab
                  key={r}
                  testID={`role-tab-${r}`}
                  label={r.toUpperCase()}
                  icon={ROLE_ICON[r]}
                  active={role === r}
                  onPress={() => setRole(r === role ? undefined : r)}
                />
              ))}
            </ScrollView>
          </View>

          {agents.length === 0 ? (
            <View style={styles.emptyIndex}>
              <Icon name="magnifier" size={22} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>NO CARDS</Text>
              <Text style={styles.emptyLine}>Clear the name or pick ALL.</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              testID="rolodex-scroll"
              contentContainerStyle={styles.index}
            >
              {agents.map((person) => (
                <RolodexCard
                  key={person.id}
                  person={person}
                  selected={selectedId === person.id}
                  onPress={() => setSelectedId(selectedId === person.id ? null : person.id)}
                />
              ))}
            </ScrollView>
          )}
        </Panel>

        {/* The dossier is always present when wide; on a phone it only earns its space
            once a card is actually pulled out of the index. */}
        {wide || selected ? (
          <Panel title="DOSSIER" flex={wide ? 4 : 2} accent={colors.accent}>
            {selected ? (
              <Dossier
                person={selected}
                castable={castable}
                onCast={(productionId) => {
                  const result = run((g) => castTalent(g, productionId, selected.id));
                  if (result) setSelectedId(null);
                }}
              />
            ) : (
              <View style={styles.emptyIndex}>
                <Icon name="teddy" size={22} color={colors.textFaint} />
                <Text style={styles.emptyTitle}>NO CARD PULLED</Text>
                <Text style={styles.emptyLine}>Tap a card to read the file.</Text>
              </View>
            )}
          </Panel>
        ) : null}
      </Deck>
    </Room>
  );
}

const ROLE_ICON: Record<TalentRole, IconName> = {
  actor: 'masks',
  writer: 'newspaper',
  showrunner: 'clapper',
  producer: 'key',
  director: 'camcorder',
  host: 'microphone',
};

/**
 * One signed performer as a brass star set into the pavement.
 *
 * The portrait sits in the middle of the star rather than beside it, so the whole
 * thing reads as a single object embedded in the ground — the point of the Walk of
 * Fame treatment is that a signing looks permanent, not like a row in a table.
 */
function StarSlab({
  person,
  production,
  size,
}: {
  person: TalentState;
  production: Production;
  size: number;
}) {
  const wage = person.contractSalaryPerEpisode ?? person.baseSalaryPerEpisode;

  return (
    <View style={styles.slab} testID={`star-${person.id}`}>
      <View style={{ width: size, height: size }}>
        <WalkOfFameStar size={size} />
        <View style={[StyleSheet.absoluteFill, styles.slabCentre]}>
          <Avatar name={person.name} size={size * 0.38} style={styles.medallion} />
        </View>
      </View>

      {/* The engraved nameplate. Uppercase and letter-spaced because that is what
          stamped brass looks like, and it keeps long names from wrapping raggedly. */}
      <View style={[styles.plate, { width: size + 18 }]}>
        <Text style={styles.plateName} numberOfLines={1}>
          {person.name.toUpperCase()}
        </Text>
        <View style={styles.plateRow}>
          <Icon name={ROLE_ICON[person.role]} size={9} color={colors.textFaint} />
          <Text style={styles.plateShow} numberOfLines={1}>
            {production.title}
          </Text>
        </View>
        <View style={styles.plateRow}>
          <Stat label="CFT" value={person.craft} />
          <Stat label="STR" value={person.starPower} />
          <Text style={styles.plateWage}>{formatMoneyShort(wage)}</Text>
        </View>
      </View>
    </View>
  );
}

/** A free agent as a portrait card in the index. */
function RolodexCard({
  person,
  selected,
  onPress,
}: {
  person: TalentState;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`talent-card-${person.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {/* Punch hole and tab — the two details that make a rectangle read as a card
          sitting in an index rather than a tile in a grid. */}
      <View style={styles.punch} />

      <Avatar name={person.name} size={44} style={{ marginTop: 2 }} />
      <Text style={styles.cardName} numberOfLines={2}>
        {person.name}
      </Text>
      <View style={styles.cardRole}>
        <Icon name={ROLE_ICON[person.role]} size={9} color={colors.textDim} />
        <Text style={styles.cardRoleText}>
          {person.role.toUpperCase()} {person.age}
        </Text>
      </View>

      <View style={styles.cardStats}>
        <Stat label="CFT" value={person.craft} />
        <Stat label="STR" value={person.starPower} />
      </View>
      <Text style={styles.cardFee}>{formatMoneyShort(person.baseSalaryPerEpisode)}/EP</Text>
    </Pressable>
  );
}

/** The pulled card, read in full — attributes, best formats, and where they can go. */
function Dossier({
  person,
  castable,
  onCast,
}: {
  person: TalentState;
  castable: Production[];
  onCast: (productionId: string) => void;
}) {
  const affinities = Object.entries(person.genreAffinity)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 4);

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.dossierHead}>
        <Avatar name={person.name} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.dossierName} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.dossierRole}>
            {person.role.toUpperCase()} · {person.age} · HEAT {Math.round(person.heat)}
          </Text>
        </View>
        <Readout
          label="PER EP"
          value={formatMoneyShort(person.baseSalaryPerEpisode)}
          size="sm"
        />
      </View>

      <View style={styles.dossierStats}>
        <Stat label="CRAFT" value={person.craft} big />
        <Stat label="STAR" value={person.starPower} big />
        <Stat label="RELY" value={person.reliability} big />
        <Stat label="EGO" value={person.ego} big />
        <Stat label="VERS" value={person.versatility} big />
        <Stat label="MOOD" value={person.morale} big />
      </View>

      {affinities.length > 0 ? (
        <View style={styles.affinities}>
          {affinities.map(([format, value]) => (
            <View key={format} style={styles.affinity}>
              <Text style={styles.affinityLabel}>{format.toUpperCase()}</Text>
              <Text style={[styles.affinityValue, { color: scoreColor(value ?? 0) }]}>
                {Math.round(value ?? 0)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.attachHead}>
        <Icon name="clapper" size={11} color={colors.textDim} />
        <Text style={styles.attachTitle}>ATTACH TO</Text>
      </View>

      {castable.length === 0 ? (
        <Text style={styles.emptyLine}>No show off air. Casting locks mid-season.</Text>
      ) : (
        castable.map((production) => (
          <Pressable
            key={production.id}
            testID={`cast-${production.id}`}
            onPress={() => onCast(production.id)}
            style={({ pressed }) => [styles.attachRow, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.attachName} numberOfLines={1}>
              {production.title}
            </Text>
            <Icon name="plus" size={13} color={colors.accent} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function Stat({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <View style={big ? styles.statBig : styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          big ? styles.statValueBig : styles.statValue,
          { color: scoreColor(value) },
        ]}
      >
        {Math.round(value)}
      </Text>
    </View>
  );
}

/** A new player has signed nobody, and the empty pavement should say what to do. */
function EmptyPavement() {
  return (
    <View style={styles.emptyPavement}>
      <WalkOfFameStar size={64} brass="#BFB49C" stone="#DED5C1" />
      <View style={{ flex: 1 }}>
        <Text style={styles.emptyTitle}>NO STARS YET</Text>
        <Text style={styles.emptyLine}>Pull a card below, attach them to a show.</Text>
        <Text style={styles.emptyLine}>Craft builds quality. Star power builds audience.</Text>
      </View>
    </View>
  );
}

function RoleTab({
  label,
  icon,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Icon name={icon} size={11} color={active ? '#FBF6EA' : colors.textDim} />
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const BRASS = '#C08A1E';

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  roomName: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
  },
  topStats: { flexDirection: 'row', gap: space.lg },

  // ---- pavement -----------------------------------------------------------
  pavement: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  slab: { alignItems: 'center' },
  slabCentre: { alignItems: 'center', justifyContent: 'center' },
  medallion: { borderWidth: 2, borderColor: 'rgba(255,248,225,0.85)' },

  plate: {
    marginTop: 5,
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.borderBright,
    gap: 2,
  },
  plateName: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.9,
    color: colors.text,
  },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plateShow: { fontSize: 8, color: colors.textDim, maxWidth: 78 },
  plateWage: {
    fontSize: 9,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

  emptyPavement: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1 },
  emptyIndex: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  emptyTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.textDim,
  },
  emptyLine: { fontSize: 10, color: colors.textFaint },

  // ---- filters ------------------------------------------------------------
  filters: { gap: space.xs, marginBottom: space.sm },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accentDeep },
  tabText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textDim },
  tabTextActive: { color: '#FBF6EA' },

  // ---- the card index -----------------------------------------------------
  index: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  card: {
    width: 96,
    alignItems: 'center',
    paddingTop: space.md,
    paddingBottom: space.sm,
    paddingHorizontal: 5,
    gap: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: '0px 1px 4px rgba(60,45,30,0.16)',
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  punch: {
    position: 'absolute',
    top: 5,
    width: 22,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardName: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 12,
  },
  cardRole: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cardRoleText: { fontSize: 7, fontWeight: '900', letterSpacing: 0.8, color: colors.textDim },
  cardStats: { flexDirection: 'row', gap: space.sm, marginTop: 1 },
  cardFee: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

  // ---- stats --------------------------------------------------------------
  stat: { alignItems: 'center' },
  statBig: { alignItems: 'center', flexGrow: 1, flexBasis: 44 },
  statLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.8, color: colors.textFaint },
  statValue: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  statValueBig: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },

  // ---- dossier ------------------------------------------------------------
  dossierHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dossierName: { fontSize: 14, fontWeight: '900', color: colors.text },
  dossierRole: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    color: colors.textDim,
    marginTop: 1,
  },
  dossierStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.sm,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },

  affinities: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: space.sm },
  affinity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  affinityLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 0.8, color: colors.textDim },
  affinityValue: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },

  attachHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  attachTitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.4, color: colors.textDim },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    marginBottom: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: BRASS,
  },
  attachName: { flex: 1, fontSize: 11, fontWeight: '800', color: colors.text },
});
