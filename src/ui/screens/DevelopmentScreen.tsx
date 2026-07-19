import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { useAction, useGame } from '../../store/gameStore';
import { archetypeOf, estimateNewShow, pitcherOf, totalCash } from '../../store/selectors';
import {
  acceptOffer,
  declineOffer,
  developOriginal,
  greenlightPitch,
  passOnPitch,
} from '../../engine/actions';
import { AUDIENCE_SEGMENTS, SHOW_ARCHETYPES } from '../../data';
import { formatSlotKey } from '../../engine/schedule';
import { appealProfile, potentialAudience } from '../../engine/audience';
import {
  AXES,
  type Attributes,
  type Format,
  type GameState,
  type SegmentId,
  type ShowArchetype,
} from '../../engine/types';
import { ScoreBar, SegmentBar, SegmentLegend } from '../components';
import { Deck, Panel, Readout, Room } from '../game/Room';
import { Poster } from '../Poster';
import { Icon, type IconName } from '../icons';
import { colors, deltaColor, formatMoneyShort, radius, space } from '../theme';

type Tab = 'pitches' | 'offers' | 'catalogue';

/**
 * The pitch table.
 *
 * Development used to be a scrolling document of cards, which meant the most physical
 * decision in the game — yes or no to somebody's idea — read like reading a web page.
 * Here it is a room instead: a table with a pile of pitch cards on it, the top one live
 * under your finger. You throw it right to green-light and left to pass.
 *
 * Swipe is never the *only* way through. It is undiscoverable on a first play and
 * untestable from the screenshot harness, so the two buttons under the table do exactly
 * what the two directions do, and every commit — finger or button — runs the same
 * `commit()` path so the two can never drift apart.
 *
 * All three sources of shows share the table. A pitch, a channel's offer and a
 * catalogue idea are different underneath but identical as a decision, so they are
 * flattened into one `TableCard` shape and dealt from the same pile.
 */
export function DevelopmentScreen({
  onOpenShow,
  forceCatalogue = false,
}: {
  onOpenShow: (id: string) => void;
  /** Set when the player arrived via "Make a Show" — go straight to the catalogue. */
  forceCatalogue?: boolean;
}) {
  const game = useGame();
  const run = useAction();
  const { width } = useWindowDimensions();

  // Open on whichever pile has something on it. A new studio has no pitches and no
  // offers, so defaulting to pitches left the player staring at an empty table.
  const [tab, setTab] = useState<Tab>(() => {
    if (forceCatalogue) return 'catalogue';
    return game && game.pitches.length > 0 ? 'pitches' : 'catalogue';
  });
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);

  // Every hook runs before the early return below, or hook order changes the moment
  // `game` goes from null to loaded.
  const inProduction = useMemo(
    () =>
      new Set(
        Object.values(game?.productions ?? {})
          .filter((p) => p.status !== 'cancelled' && p.status !== 'ended')
          .map((p) => p.archetypeId),
      ),
    [game, game?.absoluteWeek, game?.nextId],
  );

  /*
   * Deal what the studio can actually make, first.
   *
   * The pile used to come out in data order, which meant a studio starting on $10M
   * opened the table on a show it could not afford and met a dead GREEN-LIGHT button
   * as its very first interaction. That reads as the game being broken rather than as
   * the show being expensive.
   *
   * Affordable ideas now lead, cheapest first — which also happens to be the correct
   * advice, since cheap high-volume formats are the route to repeats and the only
   * viable opening. Everything unaffordable stays in the pile, cheapest first, so the
   * player can still see what they are working toward and the pile doubles as a
   * price list.
   */
  const catalogue = useMemo(() => {
    const available = SHOW_ARCHETYPES.filter((a) => !inProduction.has(a.id));
    const budget = totalCash(game!);

    // The same measure the card and the GREEN-LIGHT button use, so the ordering and
    // the button can never disagree about what is affordable.
    const fits = (a: (typeof available)[number]) =>
      budget + estimateNewShow(a).perSeries > 0;

    return available.sort((a, b) => {
      const aFits = fits(a);
      const bFits = fits(b);
      if (aFits !== bFits) return aFits ? -1 : 1;
      return a.baseCostPerEpisode - b.baseCostPerEpisode;
    });
  }, [inProduction, game?.absoluteWeek]);

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

  const wide = width > 820;
  const cash = totalCash(game);
  const threshold = Math.min(120, Math.max(70, width * 0.2));

  const pile = buildPile({
    tab,
    game,
    catalogue,
    cash,
    run,
    onOpenShow,
    // Wrapping means the ideas pile can never trap you on its last card.
    next: () => setCursor((c) => (c + 1) % Math.max(1, catalogue.length)),
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
      if (dir === 1) card.greenlight();
      else card.pass();
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

  const tabs: [Tab, string, IconName, number | null][] = [
    ['pitches', 'PITCHES', 'microphone', game.pitches.length],
    ['offers', 'OFFERS', 'envelope', game.offers.length],
    ['catalogue', 'IDEAS', 'bulb', catalogue.length],
  ];

  return (
    <Room>
      {/* ---------------- Title bar: which pile, and what you have to spend ---------
          One row on a wide screen; on a phone the three piles need the full width to
          themselves, so identity and cash sit above them. */}
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <Icon name="clapper" size={16} color={colors.accent} />
          <Text style={styles.brandText}>PITCH TABLE</Text>
        </View>

        {wide ? <PileTabs tabs={tabs} tab={tab} onPick={goTab} /> : null}

        <Readout label="TO SPEND" value={formatMoneyShort(cash)} size="sm" />
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
                      transform: [
                        { translateX: pan.x },
                        { translateY: pan.y },
                        { rotate },
                      ],
                    },
                  ]}
                >
                  <CardFace card={card} />

                  <Animated.View
                    pointerEvents="none"
                    style={[styles.stamp, styles.stampYes, { opacity: yesOpacity }]}
                  >
                    <Text style={[styles.stampText, { color: colors.positive }]}>
                      GREEN-LIGHT
                    </Text>
                  </Animated.View>
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.stamp, styles.stampNo, { opacity: noOpacity }]}
                  >
                    <Text style={[styles.stampText, { color: colors.negative }]}>PASS</Text>
                  </Animated.View>
                </Animated.View>
              </View>
            ) : (
              <EmptyTable tab={tab} onCatalogue={() => goTab('catalogue')} />
            )}
          </View>
          )}

          {/* ------------- The rail: pass, count, green-light ---------------------- */}
          <View style={styles.rail}>
            <Pressable
              testID={PASS_ID[tab]}
              disabled={!card}
              onPress={() => commit(-1)}
              style={({ pressed }) => [
                styles.railButton,
                styles.pass,
                (!card || pressed) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.railText, { color: colors.negative }]}>
                {tab === 'offers' ? 'DECLINE' : 'PASS'}
              </Text>
            </Pressable>

            <View style={styles.railMiddle}>
              <Text style={styles.railCount}>
                {pile.length > 0 ? `${index + 1}/${pile.length}` : '0/0'}
              </Text>
              <Pressable
                testID={open ? 'hide-details' : 'see-details'}
                disabled={!card}
                onPress={() => setOpen((v) => !v)}
                style={styles.detailToggle}
              >
                <Icon name="magnifier" size={11} color={colors.textDim} />
                <Text style={styles.detailToggleText}>{open ? 'HIDE' : 'DETAILS'}</Text>
              </Pressable>
            </View>

            <Pressable
              testID={YES_ID[tab]}
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
                {tab === 'offers' ? 'ACCEPT' : 'GREEN-LIGHT'}
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
/* The card                                                                   */
/* ------------------------------------------------------------------------- */

/** A figure printed on the card or in the numbers panel. */
type Figure = { label: string; value: string; color?: string };

/**
 * One decision, whatever it came from.
 *
 * A pitch, an offer and a catalogue idea are three different engine objects but the
 * same physical act — take it or don't — so the table only ever sees this.
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
  greenlight: () => void;
  pass: () => void;
};

/** The three piles, as a segmented switch. */
function PileTabs({
  tabs,
  tab,
  onPick,
  grow = false,
}: {
  tabs: [Tab, string, IconName, number | null][];
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
            {count !== null ? (
              <Text style={[styles.tabCount, on && styles.tabCountOn]}>{count}</Text>
            ) : null}
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
        <Poster
          seed={card.seed}
          format={card.format}
          size="md"
          style={{ width: 76, height: 102 }}
        />

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

      {/* The other half of the decision. The card used to stretch to the whole table
          and left ~280px of nothing here; what belongs in it is the thing a
          commissioner actually weighs — what the show is *like*, on the eight axes the
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
 * The numbers beside the table.
 *
 * This used to be seven rows and a bar in a 780px column, so two thirds of the panel
 * was blank cream. The column is now the whole case for or against the show, in the
 * order a commissioner would ask for it: what it nets, what it costs, and — the part
 * the card can only give as percentages — how many people that actually is.
 *
 * `contentContainerStyle` grows to the panel and spreads the blocks, so a short card
 * fills the column instead of stacking at the top; a long one simply scrolls.
 */
function Details({ card, full }: { card: TableCard; full: boolean }) {
  const appeal = card.attributes ? appealProfile(card.attributes) : null;
  const reach = card.attributes ? potentialAudience(card.attributes) : null;
  const totalReach = reach ? Object.values(reach).reduce((sum, v) => sum + v, 0) : 0;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.detailBody}
    >
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
            <Text style={[styles.detailValue, f.color ? { color: f.color } : null]}>
              {f.value}
            </Text>
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

/** The rest of the pile, listed — and the only way to reach idea 90 of 120. */
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
            <Poster
              seed={card.seed}
              format={card.format}
              size="sm"
              style={{ width: 24, height: 32 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pileTitle, on && { color: colors.accent }]} numberOfLines={1}>
                {card.title}
              </Text>
              <Text style={styles.pileMeta} numberOfLines={1}>
                {card.figures[0]?.value ?? '—'}
              </Text>
            </View>
            {!card.affordable ? (
              <Icon name="key" size={11} color={colors.negative} />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EmptyTable({ tab, onCatalogue }: { tab: Tab; onCatalogue: () => void }) {
  const copy: Record<Tab, [IconName, string, string]> = {
    pitches: ['microphone', 'NO PITCHES', 'Nobody knows you yet. Make your own show.'],
    offers: ['envelope', 'NO OFFERS', 'Channels bid once a show is finished.'],
    catalogue: ['bulb', 'NOTHING LEFT', 'Every idea is already in production.'],
  };
  const [icon, head, body] = copy[tab];

  return (
    <View style={styles.empty}>
      <Icon name={icon} size={30} color={colors.textFaint} />
      <Text style={styles.emptyHead}>{head}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {tab !== 'catalogue' ? (
        <Pressable testID="goto-catalogue" onPress={onCatalogue} style={styles.emptyButton}>
          <Icon name="plus" size={12} color={colors.accent} />
          <Text style={styles.emptyButtonText}>THE IDEAS PILE</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------- */
/* Building the pile                                                          */
/* ------------------------------------------------------------------------- */

/**
 * testIDs are tab-specific because the harness drives by id and never by text, and
 * "commission a show" and "accept a channel's offer" are different enough events that
 * a screenshot run wants to name which one it is tapping.
 */
const YES_ID: Record<Tab, string> = {
  pitches: 'greenlight-pitch',
  offers: 'accept-offer',
  catalogue: 'commission-show',
};
const PASS_ID: Record<Tab, string> = {
  pitches: 'pass-pitch',
  offers: 'decline-offer',
  catalogue: 'skip-show',
};

/**
 * Deal the pile for a tab.
 *
 * The affordability test is the same one for every source: what matters is not the
 * sticker price but whether the studio still has money once the whole run has been
 * paid for, because production costs land per episode over the series rather than
 * up front. `perSeries` is already negative when a show loses money, so the sum is
 * simply cash-after.
 */
function buildPile({
  tab,
  game,
  catalogue,
  cash,
  run,
  onOpenShow,
  next,
}: {
  tab: Tab;
  game: GameState;
  catalogue: ShowArchetype[];
  cash: number;
  run: <T>(
    fn: (g: GameState) => { ok: true; value: T } | { ok: false; reason: string },
  ) => T | undefined;
  onOpenShow: (id: string) => void;
  next: () => void;
}): TableCard[] {
  if (tab === 'pitches') {
    return game.pitches.map((pitch) => {
      const arch = archetypeOf(pitch);
      // Pitchers ask for their own number, so the estimate is scaled to what they want.
      const multiplier =
        arch.baseCostPerEpisode > 0
          ? pitch.estimatedCostPerEpisode / arch.baseCostPerEpisode
          : 1;
      const est = estimateNewShow(arch, multiplier);
      const pitcher = pitcherOf(game, pitch);
      const after = cash + est.perSeries;

      return {
        key: pitch.id,
        kind: 'pitches' as const,
        seed: pitch.archetypeId,
        title: pitch.title,
        format: pitch.format,
        era: arch.era,
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
        detail: [
          ...costDetail(est, after),
          { label: 'Expires', value: `wk ${pitch.expiresWeek}` },
        ],
        affordable: after > 0,
        shortfall: fundingLine(after),
        greenlight: () => {
          const production = run((g) => greenlightPitch(g, pitch.id));
          if (production) onOpenShow(production.id);
        },
        pass: () => {
          run((g) => passOnPitch(g, pitch.id));
        },
      };
    });
  }

  if (tab === 'offers') {
    return game.offers.flatMap((offer) => {
      const production = game.productions[offer.productionId];
      const network = game.companies[offer.networkId];
      if (!production || !network) return [];

      const arch = archetypeOf(production);
      const episodes = production.episodesPerSeason;
      const perSeries = offer.licenseFeePerEpisode * episodes;

      return [
        {
          key: offer.id,
          kind: 'offers' as const,
          seed: production.id,
          title: production.title,
          format: production.format,
          era: arch.era,
          logline: arch.logline,
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
          greenlight: () => {
            run((g) => acceptOffer(g, offer.id));
          },
          pass: () => {
            run((g) => declineOffer(g, offer.id));
          },
        },
      ];
    });
  }

  return catalogue.map((arch) => {
    const est = estimateNewShow(arch);
    const after = cash + est.perSeries;

    return {
      key: arch.id,
      kind: 'catalogue' as const,
      seed: arch.id,
      title: arch.title,
      format: arch.format,
      era: `${arch.genre} · ${arch.era}`,
      logline: arch.logline,
      attributes: arch.attributes,
      figures: costFigures(est),
      headline: costHeadline(est, after),
      detail: [
        ...costDetail(est, after),
        { label: 'Series until repeats', value: String(est.seriesToRepeats) },
      ],
      affordable: after > 0,
      shortfall: fundingLine(after),
      greenlight: () => {
        const production = run((g) => developOriginal(g, arch.id));
        if (production) onOpenShow(production.id);
      },
      // Passing on an idea costs nothing and removes nothing; it just deals the next.
      pass: next,
    };
  });
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
    brand: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    brandText: {
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: colors.accent,
    },

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
    // Two columns exactly — `flexBasis: 48%` rather than flex so the last row of an
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

    rail: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
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
    railCount: {
      fontSize: 12,
      fontWeight: '900',
      color: colors.textDim,
      fontVariant: ['tabular-nums'],
    },
    detailToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    detailToggleText: {
      fontSize: 8,
      fontWeight: '900',
      letterSpacing: 1,
      color: colors.textDim,
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
