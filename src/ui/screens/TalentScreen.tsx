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
import {
  availableFinds,
  castingShortlist,
  discoveredIds,
  dismissCastingDirector,
  findFor,
  hireCastingDirector,
  readCasting,
  weeklyCastingCost,
  weeksPerFind,
} from '../../engine/casting';
import type { CastingDirector, CastingFind } from '../../engine/casting';
import { TALENT_ROLES } from '../../engine/types';
import type { GameState, Production, TalentRole, TalentState } from '../../engine/types';
import { Portrait } from '../Portrait';
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
  // The office is a mode rather than a fourth panel: at 390px a room with a pavement,
  // an index, a dossier and a department in it is four things none of which fit.
  const [office, setOffice] = useState(false);

  // Hooks must run unconditionally — see the note in DevelopmentScreen.
  //
  // Your own discoveries are pinned to the front of the drawer, and they have to be:
  // the index sorts on star power *plus* craft and keeps the top sixty of seven
  // hundred people, so someone who is all craft and no fame — which is precisely what
  // a casting director finds — sits below sixty strangers and never appears at all.
  // The department would have been paying to add invisible people to the world.
  const agents = useMemo(() => {
    if (!game) return [];
    const market = freeAgents(game, { role, search, limit: 60 });

    const inMarket = new Set(market.map((p) => p.id));
    const needle = search.trim().toLowerCase();
    const mine = availableFinds(game)
      .map(({ person }) => person)
      .filter(
        (person) =>
          !inMarket.has(person.id) &&
          !person.productionId &&
          (!role || person.role === role) &&
          (!needle || person.name.toLowerCase().includes(needle)),
      )
      // Best find first, so the dossier opens on the person most worth signing rather
      // than whoever happened to turn up last.
      .sort((a, b) => b.craft + b.starPower - (a.craft + a.starPower));

    return [...mine, ...market];
  }, [game, role, search, game?.absoluteWeek, game?.nextId]);

  // Who the department has turned up. Keyed on the same revision markers as the index,
  // because a find arrives on a tick and has to appear in the room the same week.
  const found = useMemo(
    () => (game ? discoveredIds(game) : new Set<string>()),
    [game, game?.absoluteWeek, game?.nextId],
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

  // A card the player actually pulled out of the index. The fallback to the wider
  // world is what makes the office's tap-through reliable: a find that has since been
  // cast is no longer a free agent, and opening their file should still work.
  const pulled = selectedId
    ? (agents.find((p) => p.id === selectedId) ?? game.talent[selectedId] ?? null)
    : null;
  // An empty dossier is a quarter of the room showing nothing, so when no card is
  // pulled the file already open is the best free agent in the index — the one a
  // player would have reached for anyway. The panel is never blank.
  const selected = pulled ?? agents[0] ?? null;

  const empty = signed.length === 0;

  const casting = readCasting(game);
  const scoutFee = weeklyCastingCost(game);

  return (
    <Room>
      {/* ---------------- Title bar: the wage bill is the number that bites -------- */}
      <View style={styles.topBar}>
        <Text style={styles.roomName}>CASTING</Text>
        <View style={styles.topStats}>
          {!wide ? null : (
            <>
              <Readout label="SIGNED" value={String(signed.length)} size="sm" />
              <Readout
                label="WAGES / EP"
                value={formatMoneyShort(wageBill)}
                size="sm"
                color={wageBill > 0 ? colors.negative : undefined}
              />
            </>
          )}
          <Readout label="FREE" value={String(agents.length)} size="sm" />

          {/* The department's own light on the console. A scout you are paying for and
              have forgotten about is the one way this mechanic could quietly go wrong,
              so the weekly fee sits in the title bar next to the wage bill. */}
          <Pressable
            testID="casting-office-toggle"
            onPress={() => setOffice((open) => !open)}
            style={({ pressed }) => [
              styles.officeTab,
              office && styles.officeTabActive,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Icon
              name="magnifier"
              size={12}
              color={office ? '#FBF6EA' : casting.director ? BRASS : colors.textDim}
            />
            <View>
              <Text style={[styles.officeTabLabel, office && styles.officeTabTextActive]}>
                {casting.director ? 'SCOUTING' : 'NO SCOUT'}
              </Text>
              <Text style={[styles.officeTabValue, office && styles.officeTabTextActive]}>
                {scoutFee > 0 ? `${formatMoneyShort(scoutFee)}/WK` : 'HIRE ONE'}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* ---------------- Upper deck: the pavement ----------------
          An empty trophy case must not be the biggest thing in the room, so with
          nobody signed the pavement collapses to a slim band and hands its height
          to the index below. It only claims a deck once there are stars on it. */}
      {/* The pavement is one row of slabs however many stars are on it, so it takes
          the height of a slab and not a share of the room — a third of this deck was
          cream under the stars before. Everything it does not need goes to the index. */}
      {/* A plain View, not a Deck with flex={0}. React Native compiles `flex: 0` to
          `flexBasis: 0%`, and in a column container flex-basis sets the main size —
          so it beat the explicit height and collapsed the pavement to nothing. The
          stars were in the DOM and invisible, which is exactly the class of bug that
          only shows up when you look at the screen. */}
      <View
        style={[
          styles.pavementDeck,
          // Tall enough for a slab *and* its nameplate. At 196 the panel cut through
          // the stats row, so every star on the pavement was showing a half-engraved
          // plate — the one part of the screen that is meant to look permanent.
          empty ? styles.bandDeck : { height: wide ? 232 : 206 },
        ]}
      >
        <Panel
          title={empty ? undefined : 'WALK OF FAME'}
          flex={1}
          accent="#C08A1E"
          style={empty ? styles.bandPanel : undefined}
        >
          {empty ? (
            <EmptyPavement best={agents[0]} wide={wide} />
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
      </View>

      {/* ---------------- Lower deck: the card index, the dossier, the office ------ */}
      <Deck flex={1} style={!wide && { flexDirection: 'column' }}>
        {/* On a phone the office takes the whole deck: the index is still one tap away
            and a half-height drawer of cards would be neither. */}
        {office && !wide ? null : (
        <Panel title="ROLODEX" flex={wide ? 5 : pulled ? 3 : 1}>
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
            /* The index was one horizontal row of cards in a panel four times that
               tall. A card index is a drawer, not a shelf: the cards wrap and fill
               the height they are given, so sixty free agents are all in the room
               instead of five plus a scrollbar. */
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              testID="rolodex-scroll"
              contentContainerStyle={styles.index}
            >
              {agents.map((person) => (
                <RolodexCard
                  key={person.id}
                  person={person}
                  selected={selected?.id === person.id}
                  discovered={found.has(person.id)}
                  onPress={() => setSelectedId(selectedId === person.id ? null : person.id)}
                />
              ))}
            </ScrollView>
          )}
        </Panel>
        )}

        {office ? (
          <Panel title="CASTING OFFICE" flex={wide ? 4 : 1} accent={BRASS}>
            <CastingOffice
              game={game}
              director={casting.director}
              spent={casting.spent}
              onHire={(id) => run((g) => hireCastingDirector(g, id))}
              onDismiss={() => run((g) => dismissCastingDirector(g))}
              onOpenFind={(talentId) => {
                // Pulling the card out of the index is the whole point of the row: a
                // find is only useful once you are looking at what you can do with them.
                setSelectedId(talentId);
                setSearch('');
                setRole(undefined);
                setOffice(false);
              }}
            />
          </Panel>
        ) : (wide && selected) || pulled ? (
          /* The dossier is always present when wide; on a phone it only earns its
             space once a card is actually pulled out of the index. */
          <Panel
            title={pulled ? 'DOSSIER' : 'DOSSIER · TOP OF THE INDEX'}
            flex={wide ? 4 : 2}
            accent={colors.accent}
          >
            <Dossier
              person={selected!}
              field={agents}
              castable={castable}
              find={findFor(game, selected!.id)}
              onCast={(productionId) => {
                const result = run((g) => castTalent(g, productionId, selected!.id));
                if (result) setSelectedId(null);
              }}
            />
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
          <Portrait
            seed={person.id}
            size={size * 0.38}
            age={person.age}
            role={person.role}
            starPower={person.starPower}
            retired={person.retired}
            style={styles.medallion}
          />
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
  discovered,
  onPress,
}: {
  person: TalentState;
  selected: boolean;
  discovered: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`talent-card-${person.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        discovered && styles.cardFound,
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {/* The index sorts on fame plus craft, so a discovery — all craft, no fame —
          lands in the middle of sixty cards and reads as one of the crowd. The flag is
          what stops the thing you paid a department to find from being lost in it. */}
      {discovered ? (
        <View style={styles.foundFlag} testID={`found-flag-${person.id}`}>
          <Text style={styles.foundFlagText}>FOUND</Text>
        </View>
      ) : null}

      {/* Punch hole and tab — the two details that make a rectangle read as a card
          sitting in an index rather than a tile in a grid. */}
      <View style={styles.punch} />

      <Portrait
        seed={person.id}
        size={44}
        age={person.age}
        role={person.role}
        starPower={person.starPower}
        retired={person.retired}
        style={{ marginTop: 2 }}
      />
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
  field,
  castable,
  find,
  onCast,
}: {
  person: TalentState;
  field: TalentState[];
  castable: Production[];
  find?: CastingFind;
  onCast: (productionId: string) => void;
}) {
  // Every format they have an opinion about, as bars. Four pills left most of the
  // panel empty and told you less: a bar says how much better the top format is
  // than the fourth, which is the thing you are actually choosing between.
  const affinities = Object.entries(person.genreAffinity)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 8);

  // Where they sit in the sixty cards on the table. A craft of 84 means nothing on
  // its own; "3rd of 60 for craft" is a decision.
  const rank = (key: 'craft' | 'starPower') =>
    field.filter((p) => p[key] > person[key]).length + 1;
  const fee = person.baseSalaryPerEpisode;
  const feeRank = field.filter((p) => p.baseSalaryPerEpisode > fee).length + 1;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // The file reads top-down and the thing you do about it sits on the bottom
      // edge, so a short dossier leaves one gap in the middle rather than a long
      // tail of nothing under the last line.
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <View style={styles.dossierHead}>
        <Portrait
          seed={person.id}
          size={40}
          age={person.age}
          role={person.role}
          starPower={person.starPower}
          retired={person.retired}
        />
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

      {/* Provenance, where there is any. A stranger with craft 88 and a fee of nothing
          looks like a bug; the same person with a line about where they were found
          looks like the reason you employ a casting director. */}
      {find ? (
        <View style={styles.foundNote} testID={`found-note-${person.id}`}>
          <Icon name="magnifier" size={10} color={BRASS} />
          <Text style={styles.foundNoteText}>
            {find.gem ? 'FOUND BY YOUR DEPARTMENT' : 'BROUGHT IN BY YOUR DEPARTMENT'} ·{' '}
            {find.directorName.toUpperCase()}, YEAR {find.year} — {find.provenance}
          </Text>
        </View>
      ) : null}

      <View style={styles.dossierStats}>
        <Stat label="CRAFT" value={person.craft} big />
        <Stat label="STAR" value={person.starPower} big />
        <Stat label="RELY" value={person.reliability} big />
        <Stat label="EGO" value={person.ego} big />
        <Stat label="VERS" value={person.versatility} big />
        <Stat label="MOOD" value={person.morale} big />
      </View>

      {/* Standing in the index — the three ranks that decide whether the numbers
          above are a bargain or a mistake. */}
      <View style={styles.ranks}>
        <RankLine label="CRAFT" place={rank('craft')} of={field.length} />
        <RankLine label="STAR" place={rank('starPower')} of={field.length} />
        <RankLine label="FEE" place={feeRank} of={field.length} invert />
      </View>

      {affinities.length > 0 ? (
        <View style={styles.affinities}>
          <Text style={styles.sectionLabel}>FORMATS</Text>
          {affinities.map(([format, value]) => (
            <View key={format} style={styles.affinityRow}>
              <Text style={styles.affinityLabel} numberOfLines={1}>
                {format.toUpperCase()}
              </Text>
              <View style={styles.affinityTrack}>
                <View
                  style={[
                    styles.affinityFill,
                    {
                      width: `${Math.max(2, Math.min(100, value ?? 0))}%`,
                      backgroundColor: scoreColor(value ?? 0),
                    },
                  ]}
                />
              </View>
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

/**
 * The casting office: who you employ to look, and what they have turned up.
 *
 * The screen has always been able to show you the market. This is the only part of it
 * that changes what the market contains, so it is written as a department you staff
 * rather than a filter you set — a name, a weekly fee, and a file of people who did
 * not exist until somebody was paid to go and find them.
 */
function CastingOffice({
  game,
  director,
  spent,
  onHire,
  onDismiss,
  onOpenFind,
}: {
  game: GameState;
  director?: CastingDirector;
  spent: number;
  onHire: (directorId: string) => void;
  onDismiss: () => void;
  onOpenFind: (talentId: string) => void;
}) {
  const finds = availableFinds(game);
  const gems = finds.filter((f) => f.find.gem).length;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      testID="casting-office-scroll"
      contentContainerStyle={{ paddingBottom: space.sm }}
    >
      {director ? (
        <View style={styles.officeHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.officeName} numberOfLines={1}>
              {director.name}
            </Text>
            <Text style={styles.officeSub} numberOfLines={2}>
              {director.reputation}
            </Text>
          </View>
          <Pressable
            testID="dismiss-casting-director"
            onPress={onDismiss}
            style={({ pressed }) => [styles.dismissButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.dismissText}>LET GO</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.officePitch}>
          <Icon name="magnifier" size={16} color={BRASS} />
          <Text style={styles.officePitchText}>
            A casting director finds people nobody else has a card on. They cost money
            every week and promise nothing — but the good ones turn up craft with no
            price on it yet.
          </Text>
        </View>
      )}

      {director ? (
        <>
          <View style={styles.officeStats}>
            <Stat label="EYE" value={director.quality} big />
            <Readout label="FEE / WK" value={formatMoneyShort(director.feePerWeek)} size="sm" />
            <Readout label="WEEKS" value={String(director.weeksEmployed)} size="sm" />
            <Readout label="SPENT" value={formatMoneyShort(spent)} size="sm" />
          </View>
          <Text style={styles.officeLine}>
            About one find every {weeksPerFind(director.quality)} weeks · {finds.length}{' '}
            found, {gems} of them worth the money
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>ON THE AGENCY'S BOOKS</Text>
          {castingShortlist(game).map((candidate) => (
            <CandidateRow key={candidate.id} candidate={candidate} onHire={onHire} />
          ))}
          {/* The shortlist rolls over, and a player who does not know that will pass on
              the best scout in the game expecting them to still be there in a year. */}
          <Text style={styles.officeFoot}>
            The agency sends new names twice a year. These three do not wait.
          </Text>
        </>
      )}

      {finds.length > 0 ? (
        <>
          <View style={styles.officeDivider} />
          <Text style={styles.sectionLabel}>FOUND · STILL FREE</Text>
          {finds.map(({ find, person }) => (
            <Pressable
              key={find.talentId}
              testID={`find-${find.talentId}`}
              onPress={() => onOpenFind(find.talentId)}
              style={({ pressed }) => [
                styles.findRow,
                find.gem && styles.findRowGem,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Portrait
                seed={person.id}
                size={30}
                age={person.age}
                role={person.role}
                starPower={person.starPower}
                retired={person.retired}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.findName} numberOfLines={1}>
                  {person.name}
                </Text>
                <Text style={styles.findWhere} numberOfLines={1}>
                  {person.role.toUpperCase()} · {person.age} · {find.provenance}
                </Text>
              </View>
              <Stat label="CFT" value={person.craft} />
              <Stat label="STR" value={person.starPower} />
              <Text style={styles.findFee}>
                {formatMoneyShort(person.baseSalaryPerEpisode)}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

/** One casting director for hire: what they see, and what they cost to keep. */
function CandidateRow({
  candidate,
  onHire,
}: {
  candidate: CastingDirector;
  onHire: (directorId: string) => void;
}) {
  return (
    <View style={styles.candidate} testID={`casting-candidate-${candidate.id}`}>
      <View style={{ flex: 1 }}>
        <Text style={styles.candidateName} numberOfLines={1}>
          {candidate.name}
        </Text>
        <Text style={styles.candidateNote} numberOfLines={2}>
          {candidate.reputation}
        </Text>
        <Text style={styles.candidateRate}>
          {formatMoneyShort(candidate.feePerWeek)}/WK · A FIND EVERY{' '}
          {weeksPerFind(candidate.quality)} WEEKS
        </Text>
      </View>
      <Stat label="EYE" value={candidate.quality} big />
      <Pressable
        testID={`hire-casting-director-${candidate.id}`}
        onPress={() => onHire(candidate.id)}
        style={({ pressed }) => [styles.hireButton, pressed && { opacity: 0.7 }]}
      >
        <Icon name="plus" size={12} color="#FBF6EA" />
        <Text style={styles.hireText}>HIRE</Text>
      </Pressable>
    </View>
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

/** Placing in the field, as a filled track. Cheap is good, so FEE counts backwards. */
function RankLine({
  label,
  place,
  of,
  invert,
}: {
  label: string;
  place: number;
  of: number;
  invert?: boolean;
}) {
  const share = of <= 1 ? 1 : (of - place) / (of - 1);
  const good = invert ? 1 - share : share;

  return (
    <View style={styles.rankLine}>
      <Text style={styles.rankLabel}>{label}</Text>
      <View style={styles.rankTrack}>
        <View
          style={[
            styles.rankFill,
            { width: `${Math.max(3, share * 100)}%`, backgroundColor: scoreColor(good * 100) },
          ]}
        />
      </View>
      <Text style={styles.rankValue}>
        {place}/{of}
      </Text>
    </View>
  );
}

/**
 * A new player has signed nobody.
 *
 * This used to be a full deck of cream with one small block floating in it — the
 * emptiest thing in the game given the most room. It is now a single band the height
 * of its own text, and it spends that band on the one figure worth having here: the
 * best card currently in the index, so the pavement points at the drawer below.
 */
function EmptyPavement({ best, wide }: { best?: TalentState; wide: boolean }) {
  return (
    <View style={styles.emptyPavement} testID="walk-of-fame-empty">
      <WalkOfFameStar size={26} brass="#BFB49C" stone="#DED5C1" />
      <Text style={styles.bandTitle}>WALK OF FAME</Text>
      <Text style={styles.bandHint}>EMPTY · ATTACH TALENT TO A SHOW</Text>

      {best && wide ? (
        <View style={styles.bandBest}>
          <Text style={styles.bandBestLabel}>BEST FREE</Text>
          <Text style={styles.bandBestName} numberOfLines={1}>
            {best.name.toUpperCase()}
          </Text>
          <Stat label="CFT" value={best.craft} />
          <Stat label="STR" value={best.starPower} />
          <Text style={styles.bandBestFee}>
            {formatMoneyShort(best.baseSalaryPerEpisode)}/EP
          </Text>
        </View>
      ) : null}
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
  // Round, and it has to be said explicitly: the border is drawn by this View, not by
  // the portrait inside it, so without a radius it framed a circular face in a square
  // and put a hard-edged box across the middle of a five-pointed star.
  medallion: {
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,248,225,0.85)',
  },

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

  // ---- the collapsed pavement band ---------------------------------------
  pavementDeck: { flexDirection: 'row', gap: space.sm },
  bandDeck: { height: 46 },
  bandPanel: { paddingVertical: 4, paddingHorizontal: space.md },
  emptyPavement: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  bandTitle: { fontSize: 9, fontWeight: '900', letterSpacing: 1.6, color: colors.textDim },
  bandHint: {
    flex: 1,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textFaint,
  },
  bandBest: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bandBestLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1, color: colors.textFaint },
  bandBestName: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: colors.text,
    maxWidth: 170,
  },
  bandBestFee: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

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
  index: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    alignItems: 'flex-start',
    paddingBottom: space.sm,
  },
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

  // ---- ranks and formats --------------------------------------------------
  sectionLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.textDim,
    marginBottom: 2,
  },
  ranks: { marginTop: space.sm, gap: 4 },
  rankLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rankLabel: {
    width: 34,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: colors.textDim,
  },
  rankTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  rankFill: { height: '100%' },
  rankValue: {
    width: 44,
    textAlign: 'right',
    fontSize: 9,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

  affinities: { marginTop: space.md, gap: 3 },
  affinityRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  affinityLabel: {
    width: 74,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: colors.textDim,
  },
  affinityTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  affinityFill: { height: '100%' },
  affinityValue: {
    width: 22,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },

  attachHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 'auto',
    paddingTop: space.md,
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

  // ---- the casting office -------------------------------------------------
  officeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  officeTabActive: { backgroundColor: BRASS, borderColor: '#8A6112' },
  officeTabLabel: { fontSize: 7, fontWeight: '900', letterSpacing: 1.2, color: colors.textFaint },
  officeTabValue: {
    fontSize: 11,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  officeTabTextActive: { color: '#FBF6EA' },

  officeHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  officeName: { fontSize: 14, fontWeight: '900', color: colors.text },
  officeSub: { fontSize: 9, color: colors.textDim, marginTop: 1, lineHeight: 12 },
  officePitch: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  officePitchText: { flex: 1, fontSize: 10, color: colors.textDim, lineHeight: 14 },
  officeStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.sm,
    paddingVertical: space.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  officeLine: { fontSize: 9, color: colors.textDim, marginTop: space.xs, lineHeight: 13 },
  officeFoot: { fontSize: 8, color: colors.textFaint, marginTop: space.xs, lineHeight: 11 },
  officeDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: space.md,
  },

  dismissButton: {
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.negative,
  },
  dismissText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.negative },

  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    marginBottom: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candidateName: { fontSize: 11, fontWeight: '900', color: colors.text },
  candidateNote: { fontSize: 9, color: colors.textDim, lineHeight: 12, marginTop: 1 },
  candidateRate: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: colors.textFaint,
    marginTop: 2,
  },
  hireButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: BRASS,
  },
  hireText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: '#FBF6EA' },

  findRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    marginBottom: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  findRowGem: { borderColor: BRASS, backgroundColor: '#F7E9C8' },
  findName: { fontSize: 11, fontWeight: '800', color: colors.text },
  findWhere: { fontSize: 8, color: colors.textFaint, marginTop: 1 },
  findFee: {
    width: 46,
    textAlign: 'right',
    fontSize: 10,
    fontWeight: '900',
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },

  // ---- discovery markers on the index and the dossier ---------------------
  cardFound: { borderColor: BRASS },
  foundFlag: {
    position: 'absolute',
    top: -1,
    right: -1,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderBottomLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
    backgroundColor: BRASS,
  },
  foundFlagText: { fontSize: 6, fontWeight: '900', letterSpacing: 0.8, color: '#FBF6EA' },
  foundNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: '#F7E9C8',
    borderWidth: 1,
    borderColor: BRASS,
  },
  foundNoteText: { flex: 1, fontSize: 8, fontWeight: '800', color: colors.textDim, lineHeight: 11 },
});
