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
import { playerShows, playerStudio, totalCash } from './src/store/selectors';

import { useGame, useGameStore } from './src/store/gameStore';
import { DeskRoom } from './src/ui/screens/DeskRoom';
import { DevelopmentScreen } from './src/ui/screens/DevelopmentScreen';
import { IndustryScreen } from './src/ui/screens/IndustryScreen';
import { ShowDetailScreen } from './src/ui/screens/ShowDetailScreen';
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

  const [tab, setTab] = useState<TabKey>('dashboard');
  const [openShowId, setOpenShowId] = useState<string | null>(null);
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

  const compactRail = width < 760;
  const studio = playerStudio(game);
  const shows = playerShows(game);

  const navItems: NavItem<TabKey>[] = [
    { key: 'dashboard', label: 'The Desk', glyph: '▣' },
    { key: 'slate', label: 'My Shows', glyph: '☰', badge: shows.length || undefined },
    {
      key: 'development',
      label: 'New Shows',
      glyph: '✦',
      badge: game.pitches.length + game.offers.length || undefined,
    },
    { key: 'inbox', label: 'Inbox', glyph: '✉', badge: unread || undefined },
    { key: 'talent', label: 'Talent', glyph: '☺' },
    { key: 'industry', label: 'Industry', glyph: '◈' },
  ];

  const goMakeShow = () => {
    setTab('development');
    setMakeShowNonce((n) => n + 1);
  };

  return (
    <SafeAreaView style={styles.app} edges={['top', 'bottom', 'left']}>
      <StatusBar style="light" />

      <View style={styles.shell}>
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

        <View style={{ flex: 1 }}>
          {tab === 'dashboard' ? (
            <DeskRoom onOpenShow={setOpenShowId} onMakeShow={goMakeShow} />
          ) : null}
          {tab === 'slate' ? (
            <SlateScreen onOpenShow={setOpenShowId} onMakeShow={goMakeShow} />
          ) : null}
          {tab === 'development' ? (
            <DevelopmentScreen
              key={`dev-${makeShowNonce}`}
              onOpenShow={setOpenShowId}
              forceCatalogue={makeShowNonce > 0}
            />
          ) : null}
          {tab === 'inbox' ? <InboxScreen /> : null}
          {tab === 'talent' ? <TalentScreen /> : null}
          {tab === 'industry' ? <IndustryScreen /> : null}
        </View>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

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
        visible={openShowId !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenShowId(null)}
      >
        <SafeAreaView style={styles.app} edges={['top']}>
          {openShowId ? (
            <ShowDetailScreen productionId={openShowId} onClose={() => setOpenShowId(null)} />
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
