import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Sidebar, type NavItem } from './src/ui/Sidebar';
import { PhoneStatusBar, PhoneTabBar } from './src/ui/PhoneChrome';
import { Onboarding, useOnboarding } from './src/ui/Onboarding';
import { playerShows, playerStudio, totalCash } from './src/store/selectors';

import { useGame, useGameStore } from './src/store/gameStore';
import { DeskRoom } from './src/ui/screens/DeskRoom';
import { DevelopmentScreen } from './src/ui/screens/DevelopmentScreen';
import { IndustryScreen } from './src/ui/screens/IndustryScreen';
import { ShowDetailScreen, type ShowSubject } from './src/ui/screens/ShowDetailScreen';
import { SlateScreen } from './src/ui/screens/SlateScreen';
import { TalentScreen } from './src/ui/screens/TalentScreen';
import { InboxScreen, useUnreadCount } from './src/ui/screens/InboxScreen';
import { MenuScreen } from './src/ui/screens/MenuScreen';
import { TitleScreen } from './src/ui/screens/TitleScreen';
import { Button, Card } from './src/ui/components';
import { colors, space } from './src/ui/theme';

/**
 * App shell.
 *
 * Navigation is a hand-rolled tab bar rather than a router: the game is five sibling
 * screens plus one modal, and a routing library would add a dependency and a build
 * surface without buying anything the game needs.
 *
 * SafeAreaView comes from react-native-safe-area-context — the core component of the
 * same name is deprecated in React Native 0.86 and warns at runtime.
 */

type TabKey = 'dashboard' | 'slate' | 'development' | 'inbox' | 'talent' | 'industry';

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const game = useGame();
  const loading = useGameStore((s) => s.loading);
  const bootstrap = useGameStore((s) => s.bootstrap);
  const notice = useGameStore((s) => s.notice);
  const setNotice = useGameStore((s) => s.setNotice);
  const { width } = useWindowDimensions();
  const unread = useUnreadCount();
  const onboarding = useOnboarding();

  const [tab, setTab] = useState<TabKey>('dashboard');
  // The modal can be pointed at a real production or at an idea from the catalogue,
  // so it holds a tagged subject rather than a bare id.
  const [openShow, setOpenShow] = useState<ShowSubject | null>(null);
  // Bumped when "Make a Show" is pressed, to remount Development on its Commission
  // tab even if the player is already looking at that screen.
  const [makeShowNonce, setMakeShowNonce] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Refusals are transient — clear them so a stale message never lingers.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!game) {
    return (
      <SafeAreaView style={styles.app}>
        <StatusBar style="light" />
        <TitleScreen onOpenMenu={() => setMenuOpen(true)} />
        <Modal
          visible={menuOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setMenuOpen(false)}
        >
          <SafeAreaView style={styles.app} edges={['top']}>
            <MenuScreen onClose={() => setMenuOpen(false)} />
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    );
  }

  /*
   * Phones get their own chrome rather than a squeezed rail.
   *
   * The rail is right on a desktop or tablet — vital signs and the two driving
   * actions permanently on screen, the way a control panel should work. On a phone it
   * costs 74px of a 390px viewport, so a fifth of the width is furniture before the
   * game gets any, and the rooms are tight at that size already. Below 700px the same
   * controls move to a status bar on top and a tab bar at the bottom: cheaper in
   * space, and where thumbs already are.
   */
  const phone = width < 700;
  const compactRail = width < 900;
  const studio = playerStudio(game);
  const shows = playerShows(game);

  const navItems: NavItem<TabKey>[] = [
    { key: 'dashboard', label: 'The Desk', icon: 'television' },
    { key: 'slate', label: 'My Shows', icon: 'shelf', badge: shows.length || undefined },
    {
      key: 'development',
      label: 'New Shows',
      icon: 'bulb',
      badge: game.pitches.length + game.offers.length || undefined,
    },
    { key: 'inbox', label: 'Inbox', icon: 'envelope', badge: unread || undefined },
    { key: 'talent', label: 'Talent', icon: 'star' },
    { key: 'industry', label: 'Industry', icon: 'broadcast' },
  ];

  // Screens hand over a bare production id and always have; archetype opening is an
  // extra entry point rather than a replacement, so this signature stays a string.
  const openProduction = (id: string) => setOpenShow({ kind: 'production', id });
  // Pitches and catalogue ideas are archetypes, not productions — a poster on an
  // undecided pitch has to open something, and this is the something.
  const openArchetype = (id: string) => setOpenShow({ kind: 'archetype', id });

  const goMakeShow = () => {
    setTab('development');
    setMakeShowNonce((n) => n + 1);
  };

  return (
    <SafeAreaView style={styles.app} edges={['top', 'bottom', 'left']}>
      <StatusBar style="light" />

      {phone ? (
        <PhoneStatusBar
          studioName={studio?.name ?? 'Studio'}
          cash={totalCash(game)}
          year={game.year}
          week={game.week}
          onMakeShow={goMakeShow}
          onOpenMenu={() => setMenuOpen(true)}
        />
      ) : null}

      <View style={styles.shell}>
        {!phone ? (
          <Sidebar
            items={navItems}
            active={tab}
            onSelect={setTab}
            compact={compactRail}
            studioName={studio?.name ?? 'Studio'}
            cash={totalCash(game)}
            year={game.year}
            week={game.week}
            onMakeShow={goMakeShow}
            onOpenMenu={() => setMenuOpen(true)}
          />
        ) : null}

        <View style={{ flex: 1 }}>
          {tab === 'dashboard' ? (
            <DeskRoom
              onOpenShow={openProduction}
              onMakeShow={goMakeShow}
              onOpenArchetype={openArchetype}
            />
          ) : null}
          {tab === 'slate' ? (
            <SlateScreen onOpenShow={openProduction} onMakeShow={goMakeShow} />
          ) : null}
          {tab === 'development' ? (
            <DevelopmentScreen
              key={`dev-${makeShowNonce}`}
              onOpenShow={openProduction}
              forceCatalogue={makeShowNonce > 0}
            />
          ) : null}
          {tab === 'inbox' ? <InboxScreen onOpenShow={openProduction} /> : null}
          {tab === 'talent' ? <TalentScreen /> : null}
          {tab === 'industry' ? <IndustryScreen /> : null}
        </View>
      </View>

      {phone ? <PhoneTabBar items={navItems} active={tab} onSelect={setTab} /> : null}

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {/* Shown over the desk on a first run, never over the title screen — the point
          is to explain the room the player has just walked into. */}
      {onboarding.show ? <Onboarding onDone={onboarding.dismiss} /> : null}

      <Modal
        visible={menuOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setMenuOpen(false)}
      >
        <SafeAreaView style={styles.app} edges={['top']}>
          <MenuScreen onClose={() => setMenuOpen(false)} />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={openShow !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenShow(null)}
      >
        <SafeAreaView style={styles.app} edges={['top']}>
          {openShow ? (
            <ShowDetailScreen
              subject={openShow}
              onClose={() => setOpenShow(null)}
              // Commissioning an idea turns it into a production; keep the modal open
              // and re-point it, so the player lands on the show they just made.
              onOpenProduction={openProduction}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  shell: { flex: 1, flexDirection: 'row' },
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },


  notice: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: 92,
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${colors.negative}66`,
    padding: space.md,
  },
  noticeText: { fontSize: 12, color: colors.text, lineHeight: 17 },
});
