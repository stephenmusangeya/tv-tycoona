import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { useAction, useGame } from '../../store/gameStore';
import { estimateNewShow, pitcherOf, totalCash } from '../../store/selectors';
import {
  acceptOffer,
  availableFor,
  availableProducers,
  blueprintFor,
  createShow,
  declineOffer,
  genresFor,
  greenlightPitch,
  greenlightRevisedPitch,
  orderOptions,
  passOnPitch,
  previewShow,
  revisionPreview,
  rolesFor,
  type PitchRevision,
  type ShowBlueprint,
} from '../../engine/actions';
import { AUDIENCE_SEGMENTS, findConcept } from '../../data';
import { formatSlotKey } from '../../engine/schedule';
import { appealProfile, potentialAudience } from '../../engine/audience';
import {
  ANGLES,
  AXES,
  FORMATS,
  type Angle,
  type Attributes,
  type Format,
  type GameState,
  type Production,
  type SegmentId,
  type TalentState,
} from '../../engine/types';
import { ScoreBar, SegmentBar, SegmentLegend } from '../components';
import { Deck, Panel, Readout, Room } from '../game/Room';
import { Poster } from '../Poster';
import { Icon, type IconName } from '../icons';
import { colors, deltaColor, formatMoneyShort, radius, space } from '../theme';

type Tab = 'mine' | 'pitches' | 'offers';

/**
 * Development — the room where shows come from.
 *
 * It used to be a shop. A pile of 120 catalogue entries sat here from the first week,
 * priced identically in every save, and "making a show" meant choosing one off the
 * menu. That is the opposite of running a studio, and nothing on the screen had any
 * provenance: the shows were from nowhere.
 *
 * Now there are only two ways a show can be on this table. Either you made it — hired a
 * producer, named it, decided what it was and cast it — or somebody in the industry
 * brought it to you. Everything here is one of those two things, plus the door to
 * making another.
 *
 * The physical read stays: a table with a pile of cards, the top one live under your
 * finger, thrown right to say yes and left to say no. Swipe is never the only way
 * through — it is undiscoverable on a first play and untestable from the screenshot
 * harness — so the two buttons under the table run the identical `commit()` path.
 */
export function DevelopmentScreen({
  onOpenShow,
  forceCatalogue = false,
}: {
  onOpenShow: (id: string) => void;
  /**
   * Set when the player arrived via "Make a Show" on the rail.
   *
   * The name is inherited from when that button opened the catalogue; it now opens the
   * create-a-show flow, which is what the button always meant.
   */
  forceCatalogue?: boolean;
}) {
  const game = useGame();
  const run = useAction();
  const { width } = useWindowDimensions();

  // Open on whichever pile has something on it. A studio with pitches waiting should
  // see them; one with only its own slate should see that rather than an empty table.
  const [tab, setTab] = useState<Tab>(() => (game && game.pitches.length > 0 ? 'pitches' : 'mine'));
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);

  /**
   * The editor: either a blank show being invented, or a pitch being rewritten.
   *
   * One piece of state for both, because they are the same act — deciding what a show
   * is — and the only difference is whether somebody else started it.
   */
  const [editing, setEditing] = useState<EditorSession | null>(() =>
    forceCatalogue && game ? newSession(game) : null,
  );

  const pan = useRef(new Animated.ValueXY()).current;
  /** Latest deal handlers, so the PanResponder built once never reads a stale card. */
  const live = useRef<{ commit: (dir: 1 | -1) => void; threshold: number }>({
    commit: () => {},
    threshold: 110,
  });
  const flying = useRef(false);

  const responder = useRef(
    PanResponder.create({
      // Claim only clear horizontal intent, so an internal scroll still wins vertically.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => pan.setValue({ x: g.dx, y: g.dy * 0.35 }),
      onPanResponderRelease: (_e, g) => {
        const { commit, threshold } = live.current;
        // Velocity counts as well as distance — a fast flick is a decision even if short.
        const thrown = Math.abs(g.dx) > threshold || Math.abs(g.vx) > 0.7;
        if (thrown && !flying.current) commit(g.dx > 0 ? 1 : -1);
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
    }),
  ).current;

  if (!game) return null;

  // Not memoised: the store mutates GameState in place and signals React with a
  // revision counter, so a dependency array over the game object would never see the
  // slate change. It is a filter over a few dozen productions, once a render.
  const mine = studioSlate(game);

  const wide = width > 820;
  const cash = totalCash(game);
  const threshold = Math.min(120, Math.max(70, width * 0.2));

  const pile = buildPile({
    tab,
    game,
    mine,
    cash,
    run,
    onOpenShow,
    onNotes: (pitchId) => setEditing(notesSession(game, pitchId)),
    // Wrapping means your own slate can never trap you on its last card.
    next: () => setCursor((c) => (c + 1) % Math.max(1, pile.length || 1)),
  });
  const index = pile.length > 0 ? Math.min(cursor, pile.length - 1) : 0;
  const card = pile[index];

  const goTab = (next: Tab) => {
    setTab(next);
    setCursor(0);
    setOpen(false);
    pan.setValue({ x: 0, y: 0 });
  };

  /**
   * The one path both the finger and the buttons run through.
   *
   * The card is flung clear first and the engine action fires on landing, so the
   * player sees the decision leave the table rather than the row vanishing under them.
   */
  const commit = (dir: 1 | -1) => {
    if (!card || flying.current) return;
    // Refusing after the fact is the thing the card's cost strip exists to prevent.
    if (dir === 1 && !card.affordable) return;

    flying.current = true;
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(
        dir === 1 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }

    Animated.timing(pan, {
      toValue: { x: dir * (width + 400), y: 40 },
      duration: 220,
      useNativeDriver: false,
    }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      flying.current = false;
      setOpen(false);
      if (dir === 1) card.yes.act();
      else card.no.act();
    });
  };

  live.current = { commit, threshold };

  const rotate = pan.x.interpolate({
    inputRange: [-300, 0, 300],
    outputRange: ['-14deg', '0deg', '14deg'],
    extrapolate: 'clamp',
  });
  const yesOpacity = pan.x.interpolate({
    inputRange: [10, threshold],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const noOpacity = pan.x.interpolate({
    inputRange: [-threshold, -10],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const tabs: [Tab, string, IconName, number][] = [
    ['mine', 'MY SHOWS', 'shelf', mine.length],
    ['pitches', 'PITCHES', 'microphone', game.pitches.length],
    ['offers', 'OFFERS', 'envelope', game.offers.length],
  ];

  if (editing) {
    return (
      <ShowEditor
        session={editing}
        game={game}
        wide={wide}
        onChange={(session) => setEditing(session)}
        onCancel={() => setEditing(null)}
        onDone={(productionId) => {
          setEditing(null);
          setCursor(0);
          setTab('mine');
          if (productionId) onOpenShow(productionId);
        }}
        run={run}
      />
    );
  }

  return (
    <Room>
      {/* ---------------- Title bar: which pile, and what you have to spend ---------
          One row on a wide screen; on a phone the piles need the full width to
          themselves, so identity and cash sit above them. */}
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <Icon name="clapper" size={16} color={colors.accent} />
          <Text style={styles.brandText}>DEVELOPMENT</Text>
        </View>

        {wide ? <PileTabs tabs={tabs} tab={tab} onPick={goTab} /> : null}

        <View style={styles.topRight}>
          <Readout label="TO SPEND" value={formatMoneyShort(cash)} size="sm" />
          <Pressable
            testID="open-create"
            onPress={() => setEditing(newSession(game))}
            style={({ pressed }) => [styles.makeButton, pressed && { opacity: 0.75 }]}
          >
            <Icon name="plus" size={12} color="#FDF6E8" />
            <Text style={styles.makeButtonText}>MAKE A SHOW</Text>
          </Pressable>
        </View>
      </View>

      {!wide ? (
        <View style={styles.tabBar}>
          <PileTabs tabs={tabs} tab={tab} onPick={goTab} grow />
        </View>
      ) : null}

      {/* ---------------- The table itself ---------------------------------------- */}
      <Deck flex={1}>
        {wide ? (
          <Panel title="THE PILE" flex={2}>
            <PileList
              pile={pile}
              index={index}
              onPick={(i) => {
                setCursor(i);
                setOpen(false);
                pan.setValue({ x: 0, y: 0 });
              }}
            />
          </Panel>
        ) : null}

        <Panel flex={5} style={styles.tablePanel}>
          {/* On a phone there is no room for a numbers column, so DETAILS turns the
              card over in place. An overlay was tried first and covered the rail —
              the controls must never be the thing that gets buried. */}
          {!wide && open && card ? (
            <View style={styles.felt}>
              <View style={styles.back}>
                <Text style={styles.backTitle} numberOfLines={1}>
                  {card.title}
                </Text>
                <Details card={card} full />
              </View>
            </View>
          ) : (
            <View style={styles.felt}>
              {card ? (
                <View style={styles.stack}>
                  {/* Two cards peeking beneath, so the table reads as a physical pile. */}
                  {pile[index + 2] ? <UnderCard depth={2} /> : null}
                  {pile[index + 1] ? <UnderCard depth={1} /> : null}

                  <Animated.View
                    testID="pitch-card"
                    {...responder.panHandlers}
                    style={[
                      styles.cardShell,
                      styles.cardLive,
                      {
                        transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }],
                      },
                    ]}
                  >
                    <CardFace card={card} />

                    <Animated.View
                      pointerEvents="none"
                      style={[styles.stamp, styles.stampYes, { opacity: yesOpacity }]}
                    >
                      <Text style={[styles.stampText, { color: colors.positive }]}>
                        {card.yes.label}
                      </Text>
                    </Animated.View>
                    <Animated.View
                      pointerEvents="none"
                      style={[styles.stamp, styles.stampNo, { opacity: noOpacity }]}
                    >
                      <Text style={[styles.stampText, { color: colors.negative }]}>
                        {card.no.label}
                      </Text>
                    </Animated.View>
                  </Animated.View>
                </View>
              ) : (
                <EmptyTable tab={tab} onCreate={() => setEditing(newSession(game))} />
              )}
            </View>
          )}

          {/* ------------- The rail: no, count, yes ------------------------------- */}
          <View style={styles.rail}>
            <Pressable
              testID={card?.no.id ?? 'pass-pitch'}
              disabled={!card}
              onPress={() => commit(-1)}
              style={({ pressed }) => [
                styles.railButton,
                styles.pass,
                (!card || pressed) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.railText, { color: colors.negative }]}>
                {card?.no.label ?? 'PASS'}
              </Text>
            </Pressable>

            <View style={styles.railMiddle}>
              <Text style={styles.railCount}>
                {pile.length > 0 ? `${index + 1}/${pile.length}` : '0/0'}
              </Text>
              <View style={styles.railMiddleRow}>
                <Pressable
                  testID={open ? 'hide-details' : 'see-details'}
                  disabled={!card}
                  onPress={() => setOpen((v) => !v)}
                  style={styles.detailToggle}
                >
                  <Icon name="magnifier" size={11} color={colors.textDim} />
                  <Text style={styles.detailToggleText}>{open ? 'HIDE' : 'DETAILS'}</Text>
                </Pressable>

                {/* A pitch is somebody else's show until you have had your say. */}
                {card?.notes ? (
                  <Pressable testID="revise-pitch" onPress={card.notes} style={styles.detailToggle}>
                    <Icon name="palette" size={11} color={colors.accent} />
                    <Text style={[styles.detailToggleText, { color: colors.accent }]}>NOTES</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Pressable
              testID={card?.yes.id ?? 'greenlight-pitch'}
              disabled={!card || !card.affordable}
              onPress={() => commit(1)}
              style={({ pressed }) => [
                styles.railButton,
                styles.yes,
                (!card || !card.affordable) && styles.yesDead,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={[styles.railText, { color: '#FDF6E8' }]}>
                {card?.yes.label ?? 'GREEN-LIGHT'}
              </Text>
            </Pressable>
          </View>
        </Panel>

        {/* On a wide screen the numbers live beside the card; on a phone they are a
            sheet over the table, because there is nowhere else for them to go. */}
        {wide ? (
          <Panel title="THE NUMBERS" flex={2}>
            {card ? <Details card={card} full={open} /> : <Text style={styles.dim}>—</Text>}
          </Panel>
        ) : null}
      </Deck>
    </Room>
  );
}

/* ------------------------------------------------------------------------- */
/* Making a show                                                              */
/* ------------------------------------------------------------------------- */

/**
 * What the editor is working on.
 *
 * `pitchId` is what separates inventing a show from rewriting somebody else's: with it
 * set, the same controls become studio notes on an existing pitch and are costed as
 * notes rather than as a fresh commission.
 */
interface EditorSession {
  blueprint: ShowBlueprint;
  pitchId?: string;
  step: 'idea' | 'people' | 'result';
}

function newSession(game: GameState): EditorSession {
  /*
   * Open on something the studio can actually afford.
   *
   * The default used to be a sitcom, which is near the top of the cost ladder: a new
   * player with $10M opened the room to a $19.6M series and a CASH AFTER figure already
   * in red, with the MAKE IT button dead. That teaches exactly the wrong lesson for a
   * game whose whole opening move is "start small and build a library".
   *
   * So the room opens on the cheapest format this studio can fund outright, and only
   * falls back to a sitcom if it could somehow afford anything. The player is free to
   * climb from there — but the first thing they see is a show they can make.
   */
  const cash = totalCash(game);
  const affordable = FORMATS.map((format) => {
    const draft = blueprintFor(format);
    return { format, cost: draft.budgetPerEpisode * draft.episodesPerSeason };
  })
    .filter((option) => option.cost <= cash * 0.6)
    .sort((a, b) => b.cost - a.cost);

  const blueprint = blueprintFor(affordable[0]?.format ?? 'sitcom');
  // Put the best free producer in the chair by default: the flow should open on a show
  // that could actually be made, not on a form full of empty required fields.
  blueprint.producerId = availableProducers(game)[0]?.id;
  return { blueprint, step: 'idea' };
}

function notesSession(game: GameState, pitchId: string): EditorSession {
  const pitch = game.pitches.find((p) => p.id === pitchId);
  const concept = pitch ? findConcept(game.concepts, pitch.archetypeId) : undefined;

  return {
    pitchId,
    step: 'idea',
    blueprint: {
      title: pitch?.title ?? '',
      format: pitch?.format ?? 'drama',
      genre: '',
      angle: 'straight',
      episodesPerSeason: concept?.episodesPerSeason ?? 16,
      budgetPerEpisode: pitch?.estimatedCostPerEpisode ?? 1_000_000,
      castIds: [],
      writerIds: [],
    },
  };
}

const STEPS: Array<[EditorSession['step'], string, IconName]> = [
  ['idea', 'THE IDEA', 'bulb'],
  ['people', 'THE PEOPLE', 'star'],
  ['result', 'WHAT YOU GET', 'television'],
];

/**
 * The commissioning desk.
 *
 * Three columns on a wide screen — what the show is, who makes it, and what that adds
 * up to — and the same three as steps on a phone, because a room never scrolls as a
 * whole. Every control writes into the blueprint and the third column recomputes from
 * the engine on every keystroke, so the player can see a choice land in the numbers
 * before committing to it. That is the difference between a creative decision and a
 * form.
 */
function ShowEditor({
  session,
  game,
  wide,
  onChange,
  onCancel,
  onDone,
  run,
}: {
  session: EditorSession;
  game: GameState;
  wide: boolean;
  onChange: (session: EditorSession) => void;
  onCancel: () => void;
  onDone: (productionId?: string) => void;
  run: Runner;
}) {
  const { blueprint, pitchId } = session;
  const notesMode = Boolean(pitchId);
  const pitch = pitchId ? game.pitches.find((p) => p.id === pitchId) : undefined;

  const set = (patch: Partial<ShowBlueprint>) =>
    onChange({ ...session, blueprint: { ...blueprint, ...patch } });

  // Changing format changes what a normal order and a normal budget even are, so the
  // dependent fields are reset with it rather than left pointing at the old show.
  const setFormat = (format: Format) => {
    const fresh = blueprintFor(format, blueprint.title);
    onChange({
      ...session,
      blueprint: {
        ...fresh,
        producerId: blueprint.producerId,
        castIds: [],
        writerIds: [],
        directorId: undefined,
        hostId: undefined,
      },
    });
  };

  const preview = previewShow(game, blueprint);
  const revised = pitch ? revisionPreview(game, pitch, toRevision(blueprint)) : undefined;
  const cash = totalCash(game);

  const roles = rolesFor(blueprint.format);
  const orders = orderOptions(blueprint.format);
  const orderIndex = nearestIndex(orders, blueprint.episodesPerSeason);

  const budgetStep = Math.max(25_000, Math.round(preview.requiredCostPerEpisode * 0.1));

  const commit = () => {
    if (notesMode && pitch) {
      const production = run((g) => greenlightRevisedPitch(g, pitch.id, toRevision(blueprint)));
      onDone(production?.id);
      return;
    }
    const production = run((g) => createShow(g, blueprint));
    if (production) onDone(production.id);
  };

  const showStep = (step: EditorSession['step']) => wide || session.step === step;

  const blocker = notesMode ? undefined : preview.blocker;

  return (
    <Room>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <Icon name={notesMode ? 'palette' : 'plus'} size={16} color={colors.accent} />
          <Text style={styles.brandText}>{notesMode ? 'STUDIO NOTES' : 'MAKE A SHOW'}</Text>
        </View>

        {!wide ? (
          <View style={styles.tabs}>
            {STEPS.map(([key, label, icon]) => {
              const on = session.step === key;
              return (
                <Pressable
                  key={key}
                  testID={`create-step-${key}`}
                  onPress={() => onChange({ ...session, step: key })}
                  style={[styles.tab, on && styles.tabOn]}
                >
                  <Icon name={icon} size={11} color={on ? colors.accent : colors.textFaint} />
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Readout label="TO SPEND" value={formatMoneyShort(cash)} size="sm" />
      </View>

      <Deck flex={1}>
        {showStep('idea') ? (
          <Panel title="THE IDEA" flex={2} style={styles.editorPanel}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.form}>
              <Field label="TITLE">
                <TextInput
                  testID="create-title"
                  value={blueprint.title}
                  onChangeText={(title) => set({ title })}
                  placeholder="Name the show"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
              </Field>

              {/* A pitch arrives with its format fixed — that is what was pitched. You
                  can re-angle it, retitle it and re-order it, but you cannot turn a
                  drama into a game show and still call it their show. */}
              {!notesMode ? (
                <Field label="FORMAT">
                  <View style={styles.chips}>
                    {FORMATS.map((format) => (
                      <Chip
                        key={format}
                        testID={`format-${format}`}
                        label={format.toUpperCase()}
                        on={blueprint.format === format}
                        onPress={() => setFormat(format)}
                      />
                    ))}
                  </View>
                </Field>
              ) : (
                <Field label="FORMAT">
                  <Text style={styles.fixedValue}>{blueprint.format.toUpperCase()}</Text>
                </Field>
              )}

              <Field label="GENRE" hint="what it is about">
                <View style={styles.chips}>
                  {genresFor(blueprint.format).map((genre) => (
                    <Chip
                      key={genre.id}
                      testID={`genre-${genre.id}`}
                      label={genre.name.toUpperCase()}
                      on={blueprint.genre === genre.id}
                      onPress={() => set({ genre: genre.id })}
                    />
                  ))}
                </View>
              </Field>

              <Field label="ANGLE" hint="how it is played">
                <View style={styles.chips}>
                  {ANGLES.map((angle) => (
                    <Chip
                      key={angle}
                      testID={`angle-${angle}`}
                      label={angle.toUpperCase()}
                      on={blueprint.angle === angle}
                      onPress={() => set({ angle })}
                    />
                  ))}
                </View>
              </Field>

              <Field label="ORDER" hint="episodes a series">
                <Stepper
                  testIDDown="order-down"
                  testIDUp="order-up"
                  value={String(blueprint.episodesPerSeason)}
                  onDown={() =>
                    set({ episodesPerSeason: orders[Math.max(0, orderIndex - 1)] })
                  }
                  onUp={() =>
                    set({
                      episodesPerSeason: orders[Math.min(orders.length - 1, orderIndex + 1)],
                    })
                  }
                />
              </Field>

              <Field
                label="BUDGET / EP"
                hint={`needs ${formatMoneyShort(preview.requiredCostPerEpisode)}`}
              >
                <Stepper
                  testIDDown="budget-down"
                  testIDUp="budget-up"
                  value={formatMoneyShort(blueprint.budgetPerEpisode)}
                  onDown={() =>
                    set({
                      budgetPerEpisode: Math.max(
                        budgetStep,
                        blueprint.budgetPerEpisode - budgetStep,
                      ),
                    })
                  }
                  onUp={() => set({ budgetPerEpisode: blueprint.budgetPerEpisode + budgetStep })}
                />
                <Pressable
                  testID="budget-match"
                  onPress={() => set({ budgetPerEpisode: preview.requiredCostPerEpisode })}
                  style={styles.ghostButton}
                >
                  <Text style={styles.ghostButtonText}>FUND IT PROPERLY</Text>
                </Pressable>
              </Field>
            </ScrollView>
          </Panel>
        ) : null}

        {showStep('people') ? (
          <Panel title="THE PEOPLE" flex={2} style={styles.editorPanel}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.form}>
              {/* The producer is the hire. Their craft — filtered through their feel for
                  this format — is what the show can be at its best, so they are the
                  first decision on the page and the only compulsory one. */}
              <Field label="PRODUCER" hint="develops the show">
                <PersonList
                  people={availableProducers(game).slice(0, 30)}
                  format={blueprint.format}
                  selected={blueprint.producerId ? [blueprint.producerId] : []}
                  prefix="producer"
                  onToggle={(id) =>
                    set({ producerId: blueprint.producerId === id ? undefined : id })
                  }
                />
              </Field>

              {roles.scripted ? (
                <>
                  <Field label="CAST" hint="actors carry the tone">
                    <PersonList
                      people={availableFor(game, 'actor', blueprint.format, 24)}
                      format={blueprint.format}
                      selected={blueprint.castIds ?? []}
                      prefix="cast"
                      onToggle={(id) => set({ castIds: toggle(blueprint.castIds ?? [], id) })}
                    />
                  </Field>
                  <Field label="WRITERS">
                    <PersonList
                      people={availableFor(game, 'writer', blueprint.format, 16)}
                      format={blueprint.format}
                      selected={blueprint.writerIds ?? []}
                      prefix="writer"
                      onToggle={(id) => set({ writerIds: toggle(blueprint.writerIds ?? [], id) })}
                    />
                  </Field>
                  <Field label="DIRECTOR">
                    <PersonList
                      people={availableFor(game, 'director', blueprint.format, 16)}
                      format={blueprint.format}
                      selected={blueprint.directorId ? [blueprint.directorId] : []}
                      prefix="director"
                      onToggle={(id) =>
                        set({ directorId: blueprint.directorId === id ? undefined : id })
                      }
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="HOST" hint="unscripted lives or dies on them">
                    <PersonList
                      people={availableFor(game, 'host', blueprint.format, 20)}
                      format={blueprint.format}
                      selected={blueprint.hostId ? [blueprint.hostId] : []}
                      prefix="host"
                      onToggle={(id) => set({ hostId: blueprint.hostId === id ? undefined : id })}
                    />
                  </Field>
                  <Field label="WRITERS">
                    <PersonList
                      people={availableFor(game, 'writer', blueprint.format, 16)}
                      format={blueprint.format}
                      selected={blueprint.writerIds ?? []}
                      prefix="writer"
                      onToggle={(id) => set({ writerIds: toggle(blueprint.writerIds ?? [], id) })}
                    />
                  </Field>
                </>
              )}
            </ScrollView>
          </Panel>
        ) : null}

        {showStep('result') ? (
          <Panel title="WHAT YOU GET" flex={2} style={styles.editorPanel}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.form}>
              <Outcome
                preview={preview}
                blueprint={blueprint}
                cash={cash}
                notes={
                  revised
                    ? { friction: revised.friction, chemistry: revised.chemistry }
                    : undefined
                }
                attributes={revised ? revised.attributes : preview.attributes}
              />
            </ScrollView>
          </Panel>
        ) : null}
      </Deck>

      <View style={styles.rail}>
        <Pressable
          testID="create-cancel"
          onPress={onCancel}
          style={({ pressed }) => [styles.railButton, styles.pass, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.railText, { color: colors.negative }]}>BACK</Text>
        </Pressable>

        <View style={styles.railMiddle}>
          <Text style={styles.railCount} numberOfLines={1}>
            {blocker ?? (notesMode ? 'YOUR SHOW NOW' : 'READY')}
          </Text>
        </View>

        <Pressable
          testID={notesMode ? 'greenlight-revised' : 'create-confirm'}
          disabled={Boolean(blocker)}
          onPress={commit}
          style={({ pressed }) => [
            styles.railButton,
            styles.yes,
            blocker ? styles.yesDead : null,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={[styles.railText, { color: '#FDF6E8' }]}>
            {notesMode ? 'GREEN-LIGHT' : 'MAKE IT'}
          </Text>
        </Pressable>
      </View>
    </Room>
  );
}

/** Only the fields a studio is entitled to change on somebody else's pitch. */
function toRevision(blueprint: ShowBlueprint): PitchRevision {
  return {
    title: blueprint.title,
    angle: blueprint.angle,
    genre: blueprint.genre || undefined,
    episodesPerSeason: blueprint.episodesPerSeason,
    budgetPerEpisode: blueprint.budgetPerEpisode,
    producerId: blueprint.producerId,
    castIds: [
      ...(blueprint.castIds ?? []),
      ...(blueprint.writerIds ?? []),
      blueprint.directorId,
      blueprint.hostId,
    ].filter((id): id is string => Boolean(id)),
  };
}

/** What the choices add up to — the panel that makes the form a decision. */
function Outcome({
  preview,
  blueprint,
  cash,
  notes,
  attributes,
}: {
  preview: ReturnType<typeof previewShow>;
  blueprint: ShowBlueprint;
  cash: number;
  notes?: { friction: number; chemistry: number };
  attributes: Attributes;
}) {
  const est = estimateNewShow(
    preview.concept,
    blueprint.budgetPerEpisode / Math.max(1, preview.requiredCostPerEpisode),
  );
  const after = cash - preview.upfrontCost + est.perSeries;
  const appeal = appealProfile(attributes);

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.headline}>
        <Readout
          label="QUALITY"
          value={String(Math.round(preview.projectedQuality))}
          color={deltaColor(preview.projectedQuality - 50)}
          size="sm"
        />
        <Readout
          label="FUNDING"
          value={String(Math.round(preview.funding))}
          color={deltaColor(preview.funding - 50)}
          size="sm"
        />
        <Readout
          label="CASH AFTER"
          value={formatMoneyShort(after)}
          color={deltaColor(after)}
          size="sm"
        />
      </View>

      <Text style={styles.detailHead}>THE MONEY</Text>
      <Row label="Development fee" value={formatMoneyShort(-preview.upfrontCost)} bad />
      <Row label="Budget / ep" value={formatMoneyShort(-blueprint.budgetPerEpisode)} bad />
      <Row label="Needs / ep" value={formatMoneyShort(preview.requiredCostPerEpisode)} />
      <Row label="Wages / ep" value={formatMoneyShort(-preview.talentCostPerEpisode)} bad />
      <Row label="Channel pays / ep" value={formatMoneyShort(est.expectedFee)} />
      <Row
        label={`Net / series (${est.episodes} eps)`}
        value={formatMoneyShort(est.perSeries)}
        bad={est.perSeries < 0}
      />

      {notes ? (
        <>
          <Text style={styles.detailHead}>YOUR NOTES</Text>
          <Row
            label="Fighting the material"
            value={`${Math.round(notes.friction * 100)}%`}
            bad={notes.friction > 0.15}
          />
          <Row
            label="Chemistry it starts on"
            value={String(Math.round(notes.chemistry))}
            bad={notes.chemistry < 45}
          />
        </>
      ) : null}

      <Text style={styles.detailHead}>WHO WATCHES</Text>
      <SegmentBar breakdown={appeal} height={8} />
      <SegmentLegend breakdown={appeal} />

      <Text style={styles.detailHead}>WHAT IT'S LIKE</Text>
      {AXES.map((axis) => (
        <ScoreBar key={axis} label={axisLabel(axis)} value={attributes[axis]} />
      ))}
    </View>
  );
}

function Row({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.detailValue, bad ? { color: colors.negative } : null]}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Chip({
  testID,
  label,
  on,
  onPress,
}: {
  testID: string;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({
  testIDDown,
  testIDUp,
  value,
  onDown,
  onUp,
}: {
  testIDDown: string;
  testIDUp: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable testID={testIDDown} onPress={onDown} style={styles.stepButton}>
        <Text style={styles.stepButtonText}>–</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable testID={testIDUp} onPress={onUp} style={styles.stepButton}>
        <Text style={styles.stepButtonText}>+</Text>
      </Pressable>
    </View>
  );
}

/** A castable list. Craft is shown *for this format*, which is the number that matters. */
function PersonList({
  people,
  format,
  selected,
  prefix,
  onToggle,
}: {
  people: TalentState[];
  format: Format;
  selected: string[];
  prefix: string;
  onToggle: (id: string) => void;
}) {
  if (people.length === 0) {
    return <Text style={styles.dim}>Nobody free right now.</Text>;
  }

  const chosen = new Set(selected);

  return (
    <View style={styles.people}>
      {people.map((person) => {
        const on = chosen.has(person.id);
        const affinity = person.genreAffinity[format] ?? Math.round(person.versatility * 0.6);
        return (
          <Pressable
            key={person.id}
            testID={`${prefix}-${person.id}`}
            onPress={() => onToggle(person.id)}
            style={[styles.person, on && styles.personOn]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.personName, on && { color: colors.accent }]} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={styles.personMeta} numberOfLines={1}>
                {`craft ${Math.round(person.craft)} · fit ${Math.round(affinity)} · star ${Math.round(person.starPower)}`}
              </Text>
            </View>
            <Text style={styles.personFee}>
              {`${formatMoneyShort(person.baseSalaryPerEpisode)}/ep`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function nearestIndex(options: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < options.length; i++) {
    if (Math.abs(options[i] - value) < Math.abs(options[best] - value)) best = i;
  }
  return best;
}

/* ------------------------------------------------------------------------- */
/* The card                                                                   */
/* ------------------------------------------------------------------------- */

/** A figure printed on the card or in the numbers panel. */
type Figure = { label: string; value: string; color?: string };

/** What the two buttons under the table do for this card. */
type Choice = { id: string; label: string; act: () => void };

/**
 * One decision, whatever it came from.
 *
 * Your own show, a pitch and a channel's offer are three different engine objects but
 * the same physical act — take it or don't — so the table only ever sees this.
 */
type TableCard = {
  key: string;
  kind: Tab;
  seed: string;
  title: string;
  format: Format;
  era: string;
  logline: string;
  from?: string;
  fromStats?: Figure[];
  attributes?: Attributes;
  /** The three figures printed across the face of the card. */
  figures: Figure[];
  /** The same decision, as the three figures at the head of the numbers column. */
  headline: Figure[];
  detail: Figure[];
  /** False when the whole run would bankrupt the studio — shown, not enforced late. */
  affordable: boolean;
  shortfall: string;
  yes: Choice;
  no: Choice;
  /** Present when the card can be rewritten before it is accepted. */
  notes?: () => void;
};

/** The piles, as a segmented switch. */
function PileTabs({
  tabs,
  tab,
  onPick,
  grow = false,
}: {
  tabs: [Tab, string, IconName, number][];
  tab: Tab;
  onPick: (t: Tab) => void;
  grow?: boolean;
}) {
  return (
    <View style={[styles.tabs, grow && { flex: 1 }]}>
      {tabs.map(([key, label, icon, count]) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            testID={`tab-${key}`}
            onPress={() => onPick(key)}
            style={[styles.tab, grow && { flex: 1 }, on && styles.tabOn]}
          >
            <Icon name={icon} size={12} color={on ? colors.accent : colors.textFaint} />
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
            <Text style={[styles.tabCount, on && styles.tabCountOn]}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CardFace({ card }: { card: TableCard }) {
  const appeal = card.attributes ? appealProfile(card.attributes) : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Poster seed={card.seed} format={card.format} size="md" style={{ width: 76, height: 102 }} />

        <View style={styles.cardHead}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {card.title}
          </Text>
          <View style={styles.tagRow}>
            <Text style={styles.tag}>{card.format.toUpperCase()}</Text>
            <Text style={styles.tagDim}>{card.era.toUpperCase()}</Text>
          </View>
          <Text style={styles.logline} numberOfLines={4}>
            {card.logline}
          </Text>
        </View>
      </View>

      {card.from ? (
        <View style={styles.fromRow}>
          <Icon name="microphone" size={12} color={colors.textDim} />
          <Text style={styles.fromText} numberOfLines={1}>
            {card.from}
          </Text>
          <View style={styles.fromStats}>
            {(card.fromStats ?? []).map((f) => (
              <View key={f.label} style={styles.fromStat}>
                <Text style={styles.microLabel}>{f.label}</Text>
                <Text style={styles.microValue}>{f.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Who would watch it, on the face rather than behind a toggle — it is half the
          decision and the card had a hole in the middle without it. */}
      {appeal ? (
        <View style={styles.appeal}>
          <Text style={styles.appealLabel}>WHO WATCHES</Text>
          <SegmentBar breakdown={appeal} height={8} />
          <SegmentLegend breakdown={appeal} />
        </View>
      ) : null}

      {/* The other half of the decision: what the show is *like*, on the eight axes the
          taste model scores. Two columns, because eight stacked rows is a page. */}
      {card.attributes ? (
        <View style={styles.profile}>
          <Text style={styles.appealLabel}>WHAT IT'S LIKE</Text>
          <View style={styles.axisGrid}>
            {AXES.map((axis) => (
              <View key={axis} style={styles.axisCell}>
                <AxisMeter label={axisLabel(axis)} value={card.attributes![axis]} />
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.figures}>
        {card.figures.map((f) => (
          <Readout key={f.label} label={f.label} value={f.value} color={f.color} size="md" />
        ))}
      </View>

      <View style={[styles.money, !card.affordable && styles.moneyBad]}>
        <Icon
          name={card.affordable ? 'ticket' : 'key'}
          size={12}
          color={card.affordable ? colors.textDim : colors.negative}
        />
        <Text
          style={[styles.moneyText, !card.affordable && { color: colors.negative }]}
          numberOfLines={1}
        >
          {card.shortfall}
        </Text>
      </View>
    </View>
  );
}

/**
 * One axis, small enough that eight of them fit on a card.
 *
 * `ScoreBar` is the app-wide version and is right for a full-width panel, but its
 * 96px label column leaves no track at all in a half-card column, so the label sits
 * above the bar here rather than beside it.
 */
function AxisMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value / 100));

  return (
    <View style={styles.axis}>
      <View style={styles.axisHead}>
        <Text style={styles.axisLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.axisValue}>{Math.round(value)}</Text>
      </View>
      <View style={styles.axisTrack}>
        <View style={[styles.axisFill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

/** The next card down — outline only; it exists to give the pile thickness. */
function UnderCard({ depth }: { depth: 1 | 2 }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.cardShell,
        styles.under,
        {
          transform: [{ translateY: depth * 9 }, { scale: 1 - depth * 0.035 }],
          opacity: depth === 1 ? 0.7 : 0.4,
        },
      ]}
    />
  );
}

/**
 * The numbers beside the table — the whole case for or against, in the order a
 * commissioner would ask for it: what it nets, what it costs, and how many people that
 * actually is.
 */
function Details({ card, full }: { card: TableCard; full: boolean }) {
  const appeal = card.attributes ? appealProfile(card.attributes) : null;
  const reach = card.attributes ? potentialAudience(card.attributes) : null;
  const totalReach = reach ? Object.values(reach).reduce((sum, v) => sum + v, 0) : 0;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailBody}>
      {/* The three figures the decision turns on, at the top where the eye lands. */}
      <View style={styles.headline}>
        {card.headline.map((f) => (
          <Readout key={f.label} label={f.label} value={f.value} color={f.color} size="sm" />
        ))}
      </View>

      <View>
        <Text style={styles.detailHead}>THE MONEY</Text>
        {card.detail.map((f) => (
          <View key={f.label} style={styles.detailRow}>
            <Text style={styles.detailLabel} numberOfLines={1}>
              {f.label}
            </Text>
            <Text style={[styles.detailValue, f.color ? { color: f.color } : null]}>{f.value}</Text>
          </View>
        ))}
      </View>

      {/* Millions, not percentages. The card carries the share split; what it cannot
          show is the size of the pool, which is what a channel is actually buying. */}
      {appeal && reach ? (
        <View>
          <Text style={styles.detailHead}>WHO WATCHES</Text>
          <SegmentBar breakdown={appeal} height={8} />
          <View style={styles.reachHead}>
            <View style={styles.reachHeadSpacer} />
            <Text style={styles.reachHeadCell}>SHARE</Text>
            <Text style={styles.reachHeadCell}>VIEWERS</Text>
          </View>
          {AUDIENCE_SEGMENTS.map((segment) => {
            const id = segment.id as SegmentId;
            const share = totalReach > 0 ? reach[id] / totalReach : 0;
            return (
              <View key={segment.id} style={styles.reachRow}>
                <View
                  style={[
                    styles.reachDot,
                    { backgroundColor: colors.segments[segment.id] ?? colors.textFaint },
                  ]}
                />
                <Text style={styles.reachLabel} numberOfLines={1}>
                  {segment.name}
                </Text>
                <Text style={styles.reachCell}>{`${Math.round(share * 100)}%`}</Text>
                <Text style={[styles.reachCell, styles.reachCellStrong]}>
                  {`${reach[id].toFixed(1)}M`}
                </Text>
              </View>
            );
          })}
          <View style={[styles.reachRow, styles.reachTotal]}>
            <Text style={styles.reachLabel}>Ceiling</Text>
            <Text style={[styles.reachCell, styles.reachCellStrong]}>
              {`${totalReach.toFixed(1)}M`}
            </Text>
          </View>
        </View>
      ) : null}

      {card.from ? (
        <View>
          <Text style={styles.detailHead}>
            {card.kind === 'offers' ? 'THE CHANNEL' : 'THE PITCH'}
          </Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel} numberOfLines={2}>
              {card.from}
            </Text>
          </View>
          {(card.fromStats ?? []).map((f) => (
            <View key={f.label} style={styles.detailRow}>
              <Text style={styles.detailLabel} numberOfLines={1}>
                {f.label}
              </Text>
              <Text style={styles.detailValue}>{f.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* DETAILS opens the axes. The card shows them as bars; this is the graded
          version, and it is what makes the toggle worth pressing on a wide screen. */}
      {full && card.attributes ? (
        <View>
          <Text style={styles.detailHead}>WHAT IT'S LIKE</Text>
          {AXES.map((axis) => (
            <ScoreBar key={axis} label={axisLabel(axis)} value={card.attributes![axis]} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** The rest of the pile, listed. */
function PileList({
  pile,
  index,
  onPick,
}: {
  pile: TableCard[];
  index: number;
  onPick: (i: number) => void;
}) {
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {pile.map((card, i) => {
        const on = i === index;
        return (
          <Pressable
            key={card.key}
            testID={`pile-${i}`}
            onPress={() => onPick(i)}
            style={[styles.pileRow, on && styles.pileRowOn]}
          >
            <Poster seed={card.seed} format={card.format} size="sm" style={{ width: 24, height: 32 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pileTitle, on && { color: colors.accent }]} numberOfLines={1}>
                {card.title}
              </Text>
              <Text style={styles.pileMeta} numberOfLines={1}>
                {card.figures[0]?.value ?? '—'}
              </Text>
            </View>
            {!card.affordable ? <Icon name="key" size={11} color={colors.negative} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EmptyTable({ tab, onCreate }: { tab: Tab; onCreate: () => void }) {
  const copy: Record<Tab, [IconName, string, string]> = {
    mine: ['shelf', 'NOTHING IN DEVELOPMENT', 'A studio with no shows is a rented office.'],
    pitches: ['microphone', 'NO PITCHES', 'Nobody has brought you anything this week.'],
    offers: ['envelope', 'NO OFFERS', 'Channels bid once a show is finished.'],
  };
  const [icon, head, body] = copy[tab];

  return (
    <View style={styles.empty}>
      <Icon name={icon} size={30} color={colors.textFaint} />
      <Text style={styles.emptyHead}>{head}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      <Pressable testID="empty-create" onPress={onCreate} style={styles.emptyButton}>
        <Icon name="plus" size={12} color={colors.accent} />
        <Text style={styles.emptyButtonText}>MAKE A SHOW</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------------- */
/* Building the pile                                                          */
/* ------------------------------------------------------------------------- */

type Runner = <T>(
  fn: (g: GameState) => { ok: true; value: T } | { ok: false; reason: string },
) => T | undefined;

/** Everything the studio owns that has not finished — in development, or on air. */
function studioSlate(game: GameState): Production[] {
  const mine = new Set(
    [game.player.studioId, game.player.networkId, game.player.streamerId].filter(Boolean),
  );
  return Object.values(game.productions)
    .filter((p) => mine.has(p.ownerId) && p.status !== 'cancelled' && p.status !== 'ended')
    .sort((a, b) => rank(a) - rank(b) || b.quality - a.quality);
}

function rank(production: Production): number {
  if (production.status === 'development') return 0;
  if (production.status === 'hiatus') return 1;
  return 2;
}

/**
 * Deal the pile for a tab.
 *
 * The affordability test is the same one for every source: what matters is not the
 * sticker price but whether the studio still has money once the whole run has been
 * paid for, because production costs land per episode over the series rather than up
 * front. `perSeries` is already negative when a show loses money, so the sum is simply
 * cash-after.
 */
function buildPile({
  tab,
  game,
  mine,
  cash,
  run,
  onOpenShow,
  onNotes,
  next,
}: {
  tab: Tab;
  game: GameState;
  mine: Production[];
  cash: number;
  run: Runner;
  onOpenShow: (id: string) => void;
  onNotes: (pitchId: string) => void;
  next: () => void;
}): TableCard[] {
  if (tab === 'pitches') {
    return game.pitches.map((pitch) => {
      const arch = findConcept(game.concepts, pitch.archetypeId);
      // Pitchers ask for their own number, so the estimate is scaled to what they want.
      const base = arch?.baseCostPerEpisode ?? pitch.estimatedCostPerEpisode;
      const multiplier = base > 0 ? pitch.estimatedCostPerEpisode / base : 1;
      const est = estimateNewShow(
        arch ?? fallbackConcept(pitch.title, pitch.format, pitch.estimatedCostPerEpisode),
        multiplier,
      );
      const pitcher = pitcherOf(game, pitch);
      const after = cash + est.perSeries;

      return {
        key: pitch.id,
        kind: 'pitches' as const,
        seed: pitch.archetypeId,
        title: pitch.title,
        format: pitch.format,
        era: arch?.era ?? '',
        logline: pitch.logline,
        from: pitcher ? `${pitcher.name} · ${pitcher.role}` : undefined,
        fromStats: pitcher
          ? [
              { label: 'CRAFT', value: String(Math.round(pitcher.craft)) },
              { label: 'STAR', value: String(Math.round(pitcher.starPower)) },
              { label: 'EGO', value: String(Math.round(pitcher.ego)) },
            ]
          : undefined,
        attributes: pitch.attributes,
        figures: costFigures(est),
        headline: costHeadline(est, after),
        detail: [...costDetail(est, after), { label: 'Expires', value: `wk ${pitch.expiresWeek}` }],
        affordable: after > 0,
        shortfall: fundingLine(after),
        yes: {
          id: 'greenlight-pitch',
          label: 'GREEN-LIGHT',
          act: () => {
            const production = run((g) => greenlightPitch(g, pitch.id));
            if (production) onOpenShow(production.id);
          },
        },
        no: {
          id: 'pass-pitch',
          label: 'PASS',
          act: () => {
            run((g) => passOnPitch(g, pitch.id));
          },
        },
        notes: () => onNotes(pitch.id),
      };
    });
  }

  if (tab === 'offers') {
    return game.offers.flatMap((offer) => {
      const production = game.productions[offer.productionId];
      const network = game.companies[offer.networkId];
      if (!production || !network) return [];

      const arch = findConcept(game.concepts, production.archetypeId);
      const episodes = production.episodesPerSeason;
      const perSeries = offer.licenseFeePerEpisode * episodes;

      return [
        {
          key: offer.id,
          kind: 'offers' as const,
          seed: production.id,
          title: production.title,
          format: production.format,
          era: arch?.era ?? '',
          logline: arch?.logline ?? '',
          from: `${network.name} · ${((network.reach ?? 0) * 100).toFixed(0)}% reach`,
          fromStats: [
            { label: 'SERIES', value: String(offer.seasons) },
            { label: 'SLOT', value: formatSlotKey(offer.slotKey) },
          ],
          attributes: production.attributes,
          figures: [
            { label: 'FEE / EP', value: formatMoneyShort(offer.licenseFeePerEpisode) },
            { label: 'EPISODES', value: String(episodes) },
            { label: 'PER SERIES', value: formatMoneyShort(perSeries), color: colors.positive },
          ],
          headline: [
            {
              label: 'FEE / EP',
              value: formatMoneyShort(offer.licenseFeePerEpisode),
              color: colors.positive,
            },
            {
              label: 'WHOLE DEAL',
              value: formatMoneyShort(perSeries * offer.seasons),
              color: colors.positive,
            },
            {
              label: 'CASH AFTER',
              value: formatMoneyShort(cash + perSeries),
              color: deltaColor(cash + perSeries),
            },
          ],
          detail: [
            { label: 'Channel', value: network.name },
            { label: 'Reach', value: `${((network.reach ?? 0) * 100).toFixed(0)}%` },
            { label: 'Slot', value: formatSlotKey(offer.slotKey) },
            { label: 'Series ordered', value: String(offer.seasons) },
            {
              label: 'Whole deal',
              value: formatMoneyShort(perSeries * offer.seasons),
              color: colors.positive,
            },
            { label: 'Expires', value: `wk ${offer.expiresWeek}` },
          ],
          // Money in, never out — an offer can always be taken.
          affordable: true,
          shortfall: `CASH AFTER ${formatMoneyShort(cash + perSeries)}`,
          yes: {
            id: 'accept-offer',
            label: 'ACCEPT',
            act: () => {
              run((g) => acceptOffer(g, offer.id));
            },
          },
          no: {
            id: 'decline-offer',
            label: 'DECLINE',
            act: () => {
              run((g) => declineOffer(g, offer.id));
            },
          },
        },
      ];
    });
  }

  // Your own slate. Nothing to accept or refuse here — these are already yours — so the
  // rail becomes "look at it" and "show me the next one".
  return mine.map((production) => {
    const arch = findConcept(game.concepts, production.archetypeId);
    const weeks = production.developmentWeeksRemaining ?? 0;
    const fee = production.deal?.licenseFeePerEpisode ?? 0;
    const net = fee - production.budgetPerEpisode - production.marketingPerEpisode;

    return {
      key: production.id,
      kind: 'mine' as const,
      seed: production.archetypeId,
      title: production.title,
      format: production.format,
      era: `${production.angle} · ${arch?.genre ?? ''}`.trim(),
      logline: arch?.logline ?? '',
      attributes: production.attributes,
      figures: [
        { label: 'QUALITY', value: String(Math.round(production.quality)) },
        { label: 'EPISODES', value: String(production.episodesPerSeason) },
        { label: 'BUDGET / EP', value: formatMoneyShort(production.budgetPerEpisode) },
      ],
      headline: [
        {
          label: 'QUALITY',
          value: String(Math.round(production.quality)),
          color: deltaColor(production.quality - 50),
        },
        { label: 'BUZZ', value: String(Math.round(production.buzz)) },
        { label: 'NET / EP', value: formatMoneyShort(net), color: deltaColor(net) },
      ],
      detail: [
        { label: 'Status', value: statusWord(production, weeks) },
        { label: 'Series', value: String(production.season) },
        { label: 'Budget / ep', value: formatMoneyShort(-production.budgetPerEpisode) },
        { label: 'Marketing / ep', value: formatMoneyShort(-production.marketingPerEpisode) },
        { label: 'Channel pays / ep', value: formatMoneyShort(fee) },
        { label: 'Net / ep', value: formatMoneyShort(net), color: deltaColor(net) },
      ],
      affordable: true,
      shortfall: statusWord(production, weeks).toUpperCase(),
      yes: { id: 'open-show', label: 'OPEN', act: () => onOpenShow(production.id) },
      no: { id: 'next-show', label: 'NEXT', act: next },
    };
  });
}

function statusWord(production: Production, weeks: number): string {
  if (production.status === 'development') {
    return weeks > 0 ? `In development · ${weeks} wks` : 'Ready to sell';
  }
  if (production.status === 'airing') {
    return `On air · ep ${production.episodesAiredThisSeason}/${production.episodesPerSeason}`;
  }
  return production.deal ? 'Between series' : 'Looking for a channel';
}

/** A stand-in so a pitch whose concept has gone missing still costs something sane. */
function fallbackConcept(title: string, format: Format, cost: number) {
  return {
    id: '',
    title,
    format,
    genre: '',
    logline: '',
    era: '',
    attributes: {} as Attributes,
    baseCostPerEpisode: cost,
    episodesPerSeason: 13,
    castSize: 6,
    requiredRoles: [],
    tags: [],
  };
}

type Estimate = ReturnType<typeof estimateNewShow>;

/** The three figures printed on the face of a card you are paying for. */
function costFigures(est: Estimate): Figure[] {
  return [
    { label: 'COST / EP', value: formatMoneyShort(est.costPerEpisode) },
    { label: 'EPISODES', value: String(est.episodes) },
    { label: 'WHOLE SERIES', value: formatMoneyShort(est.seriesCost) },
  ];
}

/** The same decision, sized for the top of the numbers column. */
function costHeadline(est: Estimate, after: number): Figure[] {
  return [
    { label: 'NET / EP', value: formatMoneyShort(est.perEpisode), color: deltaColor(est.perEpisode) },
    {
      label: 'NET / SERIES',
      value: formatMoneyShort(est.perSeries),
      color: deltaColor(est.perSeries),
    },
    { label: 'CASH AFTER', value: formatMoneyShort(after), color: deltaColor(after) },
  ];
}

function costDetail(est: Estimate, after: number): Figure[] {
  return [
    { label: 'Budget / ep', value: formatMoneyShort(-est.budget), color: colors.negative },
    { label: 'Marketing / ep', value: formatMoneyShort(-est.marketing), color: colors.negative },
    { label: 'Channel pays / ep', value: formatMoneyShort(est.expectedFee), color: colors.positive },
    {
      label: 'Net / ep',
      value: formatMoneyShort(est.perEpisode),
      color: deltaColor(est.perEpisode),
    },
    {
      label: `Net / series (${est.episodes} eps)`,
      value: formatMoneyShort(est.perSeries),
      color: deltaColor(est.perSeries),
    },
    { label: 'Cash after', value: formatMoneyShort(after), color: deltaColor(after) },
  ];
}

function fundingLine(after: number): string {
  return after > 0
    ? `CASH AFTER ${formatMoneyShort(after)}`
    : `SHORT ${formatMoneyShort(Math.abs(after))}`;
}

function axisLabel(axis: string): string {
  if (axis === 'wholesomeness') return 'Wholesome';
  if (axis === 'entertainment') return 'Entertain';
  return axis.charAt(0).toUpperCase() + axis.slice(1);
}

const styles = makeStyles();

function makeStyles() {
  return StyleSheet.create({
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      paddingHorizontal: space.sm,
      paddingVertical: 2,
    },
    topRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    brand: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    brandText: {
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: colors.accent,
    },

    makeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: space.sm,
      paddingVertical: 6,
      borderRadius: radius.sm,
      backgroundColor: colors.accent,
    },
    makeButtonText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.1, color: '#FDF6E8' },

    tabs: {
      flexDirection: 'row',
      gap: 3,
      backgroundColor: colors.surface,
      borderRadius: radius.sm,
      padding: 3,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: space.sm,
      paddingVertical: 5,
      borderRadius: 6,
    },
    tabOn: { backgroundColor: colors.surfaceHigh },
    tabText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: colors.textFaint },
    tabTextOn: { color: colors.text },
    tabCount: {
      fontSize: 9,
      fontWeight: '900',
      color: colors.textFaint,
      fontVariant: ['tabular-nums'],
    },
    tabCountOn: { color: colors.accent },

    tablePanel: { padding: space.sm },
    editorPanel: { padding: space.sm },
    felt: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: 'rgba(120,100,70,0.07)',
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.sm,
    },
    // No height: the stack takes the height of the card lying on top of it, and the
    // felt centres it. Stretching the card to the table left a hollow middle, and a
    // 440×780 rectangle of mostly-nothing does not read as a card anyway.
    stack: {
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      marginBottom: 18,
    },

    cardShell: {
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderBright,
      overflow: 'hidden',
      boxShadow: '0px 6px 18px rgba(60,45,30,0.22)',
    },
    // The live card is the one in flow — it is what gives the stack its size. zIndex
    // is load-bearing: absolutely positioned siblings otherwise paint over it and the
    // blank under-cards would cover the pitch.
    cardLive: { position: 'relative', zIndex: 1 },
    under: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surfaceAlt,
    },

    card: { padding: space.md, gap: space.sm },
    cardTop: { flexDirection: 'row', gap: space.md },
    cardHead: { flex: 1, gap: 3 },
    cardTitle: { fontSize: 19, fontWeight: '900', color: colors.text, letterSpacing: -0.3 },
    tabBar: { flexDirection: 'row', paddingHorizontal: space.sm },
    tagRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
    appeal: { gap: 3 },
    profile: { gap: 5, paddingTop: space.xs },
    axisGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 5 },
    // Two columns exactly — `flexBasis: 47%` rather than flex so the last row of an
    // odd count keeps its column width instead of spanning.
    axisCell: { flexBasis: '47%', flexGrow: 1 },
    axis: { gap: 2 },
    axisHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    axisLabel: { fontSize: 9, fontWeight: '700', color: colors.textDim, flexShrink: 1 },
    axisValue: {
      fontSize: 9,
      fontWeight: '900',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    axisTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.surfaceHigh,
      overflow: 'hidden',
    },
    axisFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
    appealLabel: {
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1.2,
      color: colors.textFaint,
    },
    tag: {
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1,
      color: colors.accent,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: 'hidden',
    },
    tagDim: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textFaint },
    logline: { fontSize: 12, color: colors.textDim, lineHeight: 17, marginTop: 2 },

    fromRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    fromText: { fontSize: 11, fontWeight: '800', color: colors.text, flexShrink: 1 },
    fromStats: { flexDirection: 'row', gap: space.sm, marginLeft: 'auto' },
    fromStat: { alignItems: 'flex-end' },
    microLabel: { fontSize: 7, fontWeight: '800', letterSpacing: 0.8, color: colors.textFaint },
    microValue: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },

    figures: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },

    money: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 5,
      paddingHorizontal: space.sm,
      borderRadius: 6,
      backgroundColor: colors.surfaceAlt,
    },
    moneyBad: { backgroundColor: colors.negativeSoft },
    moneyText: { fontSize: 10, fontWeight: '800', color: colors.textDim },

    stamp: {
      position: 'absolute',
      top: 18,
      paddingHorizontal: space.sm,
      paddingVertical: 4,
      borderWidth: 3,
      borderRadius: 6,
      backgroundColor: 'rgba(255,255,255,0.82)',
    },
    stampYes: { left: 16, transform: [{ rotate: '-12deg' }], borderColor: colors.positive },
    stampNo: { right: 16, transform: [{ rotate: '12deg' }], borderColor: colors.negative },
    stampText: { fontSize: 15, fontWeight: '900', letterSpacing: 1.6 },

    rail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      marginTop: space.sm,
      paddingHorizontal: space.sm,
    },
    railButton: {
      flex: 3,
      height: 40,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pass: { borderWidth: 2, borderColor: colors.negative },
    yes: { backgroundColor: colors.accent },
    yesDead: { backgroundColor: colors.borderBright },
    railText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
    railMiddle: { flex: 2, alignItems: 'center', gap: 2 },
    railMiddleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    railCount: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.textDim,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    detailToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    detailToggleText: {
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1,
      color: colors.textDim,
    },

    // --- the editor ---
    form: { gap: space.md, paddingBottom: space.md },
    field: { gap: 5 },
    fieldHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    fieldLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: colors.textFaint },
    fieldHint: { fontSize: 9, color: colors.textFaint, fontStyle: 'italic' },
    fixedValue: { fontSize: 12, fontWeight: '900', color: colors.text, letterSpacing: 1 },
    input: {
      borderWidth: 1,
      borderColor: colors.borderBright,
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      paddingHorizontal: space.sm,
      paddingVertical: 8,
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    chip: {
      paddingHorizontal: space.sm,
      paddingVertical: 5,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    chipText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.9, color: colors.textDim },
    chipTextOn: { color: colors.accent },

    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      alignSelf: 'flex-start',
    },
    stepButton: {
      width: 34,
      height: 30,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderBright,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    stepButtonText: { fontSize: 16, fontWeight: '900', color: colors.text },
    stepValue: {
      fontSize: 14,
      fontWeight: '900',
      color: colors.text,
      minWidth: 72,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    ghostButton: {
      alignSelf: 'flex-start',
      paddingHorizontal: space.sm,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    ghostButtonText: { fontSize: 8, fontWeight: '900', letterSpacing: 1, color: colors.textDim },

    people: { gap: 3 },
    person: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.sm,
      paddingVertical: 5,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    personOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    personName: { fontSize: 11, fontWeight: '900', color: colors.text },
    personMeta: { fontSize: 9, color: colors.textFaint, fontVariant: ['tabular-nums'] },
    personFee: {
      fontSize: 10,
      fontWeight: '900',
      color: colors.textDim,
      fontVariant: ['tabular-nums'],
    },

    // flexGrow so a short card spreads down the column rather than piling at the top;
    // once the content is taller than the panel this does nothing and it scrolls.
    detailBody: { flexGrow: 1, justifyContent: 'space-between', gap: space.sm },
    headline: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: space.xs,
      paddingBottom: space.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },

    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: 3,
    },
    detailLabel: { fontSize: 10, color: colors.textDim, flex: 1 },
    detailValue: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    detailHead: {
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1.2,
      color: colors.textFaint,
      marginTop: space.md,
      marginBottom: space.xs,
    },

    reachHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: space.sm,
      marginBottom: 2,
    },
    reachHeadSpacer: { flex: 1 },
    reachHeadCell: {
      width: 42,
      textAlign: 'right',
      fontSize: 7,
      fontWeight: '900',
      letterSpacing: 0.9,
      color: colors.textFaint,
    },
    reachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
    reachDot: { width: 7, height: 7, borderRadius: 4 },
    reachLabel: { flex: 1, fontSize: 10, color: colors.textDim },
    reachCell: {
      width: 42,
      textAlign: 'right',
      fontSize: 10,
      color: colors.textDim,
      fontVariant: ['tabular-nums'],
    },
    reachCellStrong: { fontWeight: '900', color: colors.text },
    reachTotal: {
      marginTop: 3,
      paddingTop: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },

    pileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 5,
      paddingHorizontal: 5,
      borderRadius: 6,
    },
    pileRowOn: { backgroundColor: colors.surfaceHigh },
    pileTitle: { fontSize: 11, fontWeight: '800', color: colors.text },
    pileMeta: {
      fontSize: 9,
      color: colors.textFaint,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },

    empty: { alignItems: 'center', gap: 6, padding: space.lg },
    emptyHead: { fontSize: 13, fontWeight: '900', letterSpacing: 1.4, color: colors.textDim },
    emptyBody: { fontSize: 11, color: colors.textFaint, textAlign: 'center', maxWidth: 260 },
    emptyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.sm,
      borderWidth: 2,
      borderColor: colors.accent,
    },
    emptyButtonText: {
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 1.2,
      color: colors.accent,
    },

    back: {
      flex: 1,
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderBright,
      padding: space.md,
    },
    backTitle: {
      fontSize: 13,
      fontWeight: '900',
      color: colors.text,
      marginBottom: space.sm,
    },

    dim: { fontSize: 11, color: colors.textFaint },
  });
}
