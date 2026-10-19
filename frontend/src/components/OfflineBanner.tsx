/**
 * OfflineBanner.tsx — replaces OfflineStatusScreen.tsx
 *
 * A full screen dedicated to "you are offline" is jarring and breaks
 * navigation. A banner at the top of any screen is the correct pattern.
 * NetInfo already installed — hook into network state from the store.
 *
 * Usage:
 *   import { OfflineBanner } from '../components/OfflineBanner';
 *   // Place at the top of any screen:
 *   <OfflineBanner />
 *
 * Or use the AppNavigator-level wrapper to show it on all screens.
 */

import React from 'react';
import { COLORS } from '../constants/theme';
import { Text, StyleSheet, Animated } from 'react-native';
import { useNetwork } from '../store';
import { t, useLang } from '../i18n';

export function OfflineBanner() {
  useLang();
  const isOnline = useNetwork();
  const opacity  = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: isOnline ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOnline, opacity]);

  if (isOnline) return null;

  return (
    <Animated.View style={[styles.banner, { opacity }]}>
      <Text style={styles.icon}>📵</Text>
      <Text style={styles.text}>{t('x_offline_banner_no_internet_connection_some')}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor:  COLORS.textPrimary,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    paddingVertical:  10,
    paddingHorizontal:16,
    gap: 8,
  },
  icon: { fontSize: 14 },
  text: { color: COLORS.white, fontSize: 13, fontWeight: '500', flex: 1 },
});

export default OfflineBanner;
