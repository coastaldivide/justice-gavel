/**
 * OfflineBanner — Self-contained offline indicator.
 *
 * Detects network state internally via @react-native-community/netinfo.
 * Drop anywhere in the tree — shows automatically when offline.
 * Placed in App.tsx so it appears on every screen without any props.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

// Graceful import — netinfo may not be installed in all environments
let useNetInfo: unknown = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useNetInfo = require('@react-native-community/netinfo').useNetInfo;
} catch {}

function OfflineBanner() {
  const netInfo  = useNetInfo ? (useNetInfo as any)() : null;
  const isOnline = netInfo ? netInfo.isConnected !== false : true;
  const [opacity] = useState(new Animated.Value(0));

  useEffect(() => {
    Animated.timing(opacity, {
      toValue:         isOnline ? 0 : 1,
      duration:        300,
      useNativeDriver: true,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    }).start();
  }, [isOnline]);

  if (isOnline && !(opacity as any)._value) return null;

  return (
    <Animated.View style={[styles.banner, { opacity }]} accessibilityRole="alert" accessibilityLabel="You are offline — showing cached data">
      <Text style={styles.icon}>📵</Text>
      <Text style={styles.text}>No connection — showing cached data</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    zIndex:          9999,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    paddingVertical: 6,
    backgroundColor: '#2C1800',
    borderBottomWidth: 1,
    borderBottomColor: '#E65100',
  },
  icon: { fontSize: 14 },
  text: { fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700', color: '#FFA726' },
});

export default React.memo(OfflineBanner);
