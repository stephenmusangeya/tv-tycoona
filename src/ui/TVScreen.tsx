import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { colors, space } from './theme';
import { SegmentBar } from './components';
import type { Production, SegmentId } from '../engine/types';

/**
 * The broadcast monitor.
 *
 * The dashboard's headline information is rendered *inside a television* — bezel,
 * phosphor glow, scanlines, tally light. It is the one place in the app where the
 * chrome is doing emotional work rather than informational work: a management sim
 * that looks like a spreadsheet reads as a website, and this is a game about
 * television, so the most important numbers should arrive the way television does.
 *
 * When nothing is on air the set shows static and NO SIGNAL, which communicates
 * "you have no shows" far more forcefully than an empty state ever could.
 */

const SCANLINE_SPACING = 3;

export interface ResultLine {
  productionId: string;
  title: string;
  viewers: number;
  previous?: number;
  viewersBySegment: Record<SegmentId, number>;
}

export function TVScreen({
  airing,
  viewers,
  breakdown,
  year,
  week,
  channelLabel,
  results,
  onResultsDone,
}: {
  airing?: Production;
  viewers?: number;
  breakdown?: Record<SegmentId, number>;
  year: number;
  week: number;
  channelLabel: string;
  /**
   * This week's overnights. When present the set switches to a results broadcast
   * instead of a modal over the top of everything — a television is exactly the right
   * object to deliver ratings, and a popup every single week was maddening.
   */
  results?: ResultLine[];
  onResultsDone?: () => void;
}) {
  const isLive = Boolean(airing);

  // The tally light breathes while you are on air. Small, but it makes the set feel
  // powered rather than drawn.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isLive) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isLive, pulse]);

  const tallyOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

  // Results reel: advance a slide roughly every 1.6s, then return to normal service.
  const reel = results && results.length > 0 ? results : undefined;
  const [slide, setSlide] = useState(0);
  const flick = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!reel) return;
    setSlide(0);
  }, [reel]);

  useEffect(() => {
    if (!reel) return;
    // A channel-change flicker between slides.
    flick.setValue(0);
    Animated.timing(flick, { toValue: 1, duration: 260, useNativeDriver: true }).start();

    const timer = setTimeout(() => {
      if (slide + 1 < reel.length) setSlide((n) => n + 1);
      else onResultsDone?.();
    }, 1700);
    return () => clearTimeout(timer);
  }, [reel, slide, flick, onResultsDone]);

  const current = reel?.[slide];

  return (
    <View style={styles.cabinet}>
      {/* --- Screen --- */}
      <View style={[styles.screen, isLive && styles.screenLive]}>
        <Scanlines />

        {/* Status strip */}
        <View style={styles.statusStrip}>
          <View style={styles.tallyGroup}>
            <Animated.View
              style={[
                styles.tally,
                { backgroundColor: isLive ? colors.negative : colors.tvTextFaint },
                isLive ? { opacity: tallyOpacity } : null,
              ]}
            />
            <Text style={[styles.tallyText, isLive && { color: colors.negative }]}>
              {isLive ? 'ON AIR' : 'OFF AIR'}
            </Text>
          </View>
          <Text style={styles.channel} numberOfLines={1}>
            {channelLabel}
          </Text>
          <Text style={styles.timecode}>
            Y{year} · W{String(week).padStart(2, '0')}
          </Text>
        </View>

        {/* Picture */}
        {current ? (
          <Animated.View style={[styles.picture, { opacity: flick }]}>
            <Text style={styles.reelKicker}>
              THE OVERNIGHTS · {slide + 1} OF {reel!.length}
            </Text>
            <Text style={styles.showTitle} numberOfLines={2}>
              {current.title}
            </Text>

            <View style={styles.viewerRow}>
              <Text style={styles.viewerNumber}>{current.viewers.toFixed(1)}</Text>
              <Text style={styles.viewerUnit}>M VIEWERS</Text>
              {current.previous !== undefined ? (
                <Text
                  style={[
                    styles.reelDelta,
                    {
                      color:
                        current.viewers >= current.previous
                          ? colors.tvText
                          : '#E08A80',
                    },
                  ]}
                >
                  {current.viewers >= current.previous ? '▲' : '▼'}{' '}
                  {Math.abs(current.viewers - current.previous).toFixed(1)}M
                </Text>
              ) : null}
            </View>

            <View style={styles.demoWrap}>
              <Text style={styles.demoLabel}>AUDIENCE</Text>
              <SegmentBar breakdown={current.viewersBySegment} height={7} />
            </View>

            {/* Progress pips so the reel reads as a sequence, not a glitch. */}
            <View style={styles.pips}>
              {reel!.map((r, i) => (
                <View
                  key={r.productionId}
                  style={[styles.pip, i === slide && styles.pipOn]}
                />
              ))}
            </View>
          </Animated.View>
        ) : airing ? (
          <View style={styles.picture}>
            <Text style={styles.nowLabel}>NOW BROADCASTING</Text>
            <Text style={styles.showTitle} numberOfLines={2}>
              {airing.title}
            </Text>

            <View style={styles.viewerRow}>
              <Text style={styles.viewerNumber}>
                {viewers !== undefined ? viewers.toFixed(1) : '—'}
              </Text>
              <Text style={styles.viewerUnit}>M VIEWERS</Text>
            </View>

            <Text style={styles.episodeLine}>
              SEASON {airing.season} · EPISODE {airing.episodesAiredThisSeason} OF{' '}
              {airing.episodesPerSeason}
            </Text>

            {/* Everything below is pinned to the foot of the picture. The set used to
                centre a short stack of text in a tall screen, which left a large dead
                area under it — the single most-noted flaw in the room. Filling the
                bottom with the season's run and the show's standing uses the height
                for information instead of for emptiness. */}
            <View style={styles.pictureFoot}>
              <View style={styles.runWrap}>
                <View style={styles.runHead}>
                  <Text style={styles.demoLabel}>THIS SEASON</Text>
                  <Text style={styles.runCount}>
                    {airing.episodesAiredThisSeason}/{airing.episodesPerSeason}
                  </Text>
                </View>
                {/* One notch per episode, lit as it airs — a season reads as a run of
                    programmes rather than a fraction. */}
                <View style={styles.runStrip}>
                  {Array.from({ length: Math.min(airing.episodesPerSeason, 40) }).map(
                    (_, i) => {
                      const scale = airing.episodesPerSeason / Math.min(airing.episodesPerSeason, 40);
                      const aired = (i + 1) * scale <= airing.episodesAiredThisSeason;
                      return <View key={i} style={[styles.runNotch, aired && styles.runNotchOn]} />;
                    },
                  )}
                </View>
              </View>

              {breakdown ? (
                <View style={styles.demoWrap}>
                  <Text style={styles.demoLabel}>AUDIENCE</Text>
                  <SegmentBar breakdown={breakdown} height={7} />
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.picture}>
            <Static />
            <Text style={styles.noSignal}>NO SIGNAL</Text>
            <Text style={styles.noSignalBody}>
              You have nothing on air. Make a show.
            </Text>
          </View>
        )}

        {/* Vignette edges — cheap CRT curvature cue */}
        <View style={[styles.vignetteTop, { pointerEvents: "none" }]} />
        <View style={[styles.vignetteBottom, { pointerEvents: "none" }]} />
      </View>

      {/* --- Cabinet furniture --- */}
      <View style={styles.chin}>
        <View style={styles.speaker}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={styles.speakerSlot} />
          ))}
        </View>
        <View style={styles.knobRow}>
          <View style={styles.knob} />
          <View style={[styles.knob, styles.knobSmall]} />
        </View>
      </View>
    </View>
  );
}

/** Horizontal scanlines across the picture. */
function Scanlines() {
  return (
    <View style={[styles.scanlineLayer, { pointerEvents: "none" }]}>
      {Array.from({ length: 90 }).map((_, i) => (
        <View key={i} style={[styles.scanline, { top: i * SCANLINE_SPACING }]} />
      ))}
    </View>
  );
}

/** Fake snow for the dead-channel state. */
function Static() {
  // A fixed pseudo-random arrangement — it should look like noise, not animate and
  // pull attention away from the message.
  const flecks = Array.from({ length: 60 }).map((_, i) => {
    const x = (i * 37) % 100;
    const y = (i * 53) % 100;
    const size = 1 + ((i * 7) % 3);
    return { x, y, size, key: i };
  });

  return (
    <View style={[styles.staticLayer, { pointerEvents: "none" }]}>
      {flecks.map((fleck) => (
        <View
          key={fleck.key}
          style={{
            position: 'absolute',
            left: `${fleck.x}%`,
            top: `${fleck.y}%`,
            width: fleck.size,
            height: fleck.size,
            backgroundColor: colors.tvTextDim,
            opacity: 0.22,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cabinet: {
    flex: 1,
    backgroundColor: colors.tvCabinet,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.tvCabinetEdge,
    padding: space.sm,
    // A faint outer shadow so the set reads as an object sitting in the room.
    // boxShadow rather than the shadow* props, which are deprecated in RN 0.86.
    boxShadow: '0px 8px 18px rgba(0, 0, 0, 0.6)',
    elevation: 8,
  },

  screen: {
    backgroundColor: colors.tvScreen,
    borderRadius: 10,
    overflow: 'hidden',
    flex: 1,
    minHeight: 200,
    borderWidth: 1,
    borderColor: colors.tvScreenEdge,
  },
  screenLive: {
    // Phosphor bloom when there is a picture.
    boxShadow: `0px 0px 22px rgba(245, 166, 35, 0.22)`,
  },

  staticLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scanlineLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  scanline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#000',
    opacity: 0.28,
  },

  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3340',
    zIndex: 3,
  },
  tallyGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tally: { width: 8, height: 8, borderRadius: 4 },
  tallyText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: colors.tvTextDim,
  },
  channel: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: colors.tvTextDim },
  timecode: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
  },

  picture: { flex: 1, padding: space.lg, zIndex: 3, justifyContent: 'center' },

  /** Pinned to the foot of the picture, so a tall screen is filled rather than hollow. */
  pictureFoot: { marginTop: 'auto', gap: space.md },
  runWrap: { gap: 5 },
  runHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  runCount: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.tvTextDim,
    fontVariant: ['tabular-nums'],
  },
  runStrip: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  runNotch: {
    flex: 1,
    height: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(247,241,228,0.14)',
  },
  runNotchOn: { backgroundColor: colors.accent },

  nowLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.accentDeep,
    marginBottom: space.xs,
  },
  showTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.tvText,
    letterSpacing: -0.3,
    lineHeight: 30,
  },

  viewerRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: space.md },
  viewerNumber: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.accent,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  viewerUnit: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: colors.tvTextDim },

  episodeLine: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.tvTextFaint,
    marginTop: space.xs,
  },

  reelKicker: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.accent,
    marginBottom: space.xs,
  },
  reelDelta: { fontSize: 12, fontWeight: '900', marginLeft: space.sm },
  pips: { flexDirection: 'row', gap: 5, marginTop: space.md },
  pip: {
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  pipOn: { backgroundColor: colors.accent },

  demoWrap: { marginTop: space.lg },
  demoLabel: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: colors.tvTextFaint,
    marginBottom: 5,
  },

  noSignal: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.tvTextDim,
    textAlign: 'center',
    marginTop: space.xl,
  },
  noSignalBody: {
    fontSize: 12,
    color: colors.tvTextFaint,
    textAlign: 'center',
    marginTop: space.sm,
    letterSpacing: 0.4,
  },

  vignetteTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 26,
    backgroundColor: '#000',
    opacity: 0.25,
    zIndex: 1,
  },
  vignetteBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 26,
    backgroundColor: '#000',
    opacity: 0.3,
    zIndex: 1,
  },

  chin: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
    paddingBottom: 2,
  },
  speaker: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  speakerSlot: { width: 2, height: 9, borderRadius: 1, backgroundColor: colors.tvCabinetEdge },
  knobRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  knob: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.tvCabinetEdge,
    borderWidth: 1,
    borderColor: '#B3A488',
  },
  knobSmall: { width: 8, height: 8, borderRadius: 4 },
});
