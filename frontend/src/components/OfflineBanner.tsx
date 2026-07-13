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
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useNetwork } from '../store';

export function OfflineBanner() {
  const isOnline = useNetwork();
  const opacity  = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: isOnline ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOnline]);

  if (isOnline) return null;

  return (
    <Animated.View style={[styles.banner, { opacity }]}>
      <Text style={styles.icon}>📵</Text>
      <Text style={styles.text}>No internet connection — some features unavailable</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor:  '#1C1C1E',
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    paddingVertical:  10,
    paddingHorizontal:16,
    gap: 8,
  },
  icon: { fontSize: 14 },
  text: { color: '#fff', fontSize: 13, fontWeight: '500', flex: 1 },
});

export default OfflineBanner;
